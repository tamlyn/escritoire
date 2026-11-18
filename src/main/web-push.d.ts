declare module 'web-push' {
  export class WebPushError extends Error {
    statusCode: number
  }
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string }
  export function sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: {
      TTL: number
      urgency: 'high'
      vapidDetails: { subject: string; publicKey: string; privateKey: string }
    },
  ): Promise<unknown>
}
