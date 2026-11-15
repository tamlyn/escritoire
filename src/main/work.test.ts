import { expect, it } from 'vitest'
import { Work } from './work'

it('waits for work under way, cancels it and refuses more', async () => {
  const work = new Work()
  let finish!: () => void
  const slow = work.run(() => new Promise<string>((resolve) => { finish = () => resolve('done') }))
  const cancellable = work.run((signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason))
  }))

  let closed = false
  const closing = work.close().then(() => { closed = true })
  await expect(cancellable).rejects.toThrow('Closed')
  await expect(work.run(async () => 'late')).rejects.toThrow('Closed')
  expect(closed).toBe(false)

  finish()
  await closing
  await expect(slow).resolves.toBe('done')
})

it('leaves failures to whoever started the work', async () => {
  const work = new Work()
  const failing = work.run(() => { throw new Error('Broken') })
  await expect(failing).rejects.toThrow('Broken')
  await expect(work.close()).resolves.toBeUndefined()
})
