import { join } from 'node:path'
import { generateVAPIDKeys, sendNotification, WebPushError } from 'web-push'
import type { PushPayload, PushSubscription } from '../shared/remote'
import { readJson, writeJson } from './json-file'

type VapidKeys = { publicKey: string; privateKey: string }

// Push services want a contact for the sender, which needn't be anyone's address.
// Apple refuses subjects it considers local, so this is a public domain's.
const subject = 'mailto:push@example.com'
const timeToLiveSeconds = 24 * 60 * 60

/** Sends Web Push messages, encrypted to the browser, so the push services can't read them. */
export class PushSender {
  private keys: Promise<VapidKeys> | undefined

  constructor(private readonly dataDir: string) {}

  async publicKey(): Promise<string> {
    return (await this.vapidKeys()).publicKey
  }

  /** `gone` means the browser has withdrawn the subscription, so it should be forgotten. */
  async send(subscription: PushSubscription, payload: PushPayload): Promise<'sent' | 'gone'> {
    try {
      await sendNotification(subscription, JSON.stringify(payload), {
        TTL: timeToLiveSeconds,
        urgency: 'high',
        vapidDetails: { subject, ...(await this.vapidKeys()) },
      })
      return 'sent'
    } catch (error) {
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) return 'gone'
      throw error
    }
  }

  private vapidKeys(): Promise<VapidKeys> {
    this.keys ??= this.loadKeys().catch((error: unknown) => {
      this.keys = undefined
      throw error
    })
    return this.keys
  }

  private async loadKeys(): Promise<VapidKeys> {
    const path = join(this.dataDir, 'web-push.json')
    const saved = (await readJson(path)) as VapidKeys | undefined
    if (saved) return saved
    const keys = generateVAPIDKeys()
    await writeJson(path, keys)
    return keys
  }
}
