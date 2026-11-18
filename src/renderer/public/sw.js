// Shows Web Push notifications. Caches nothing: the app needs its connection to main anyway.

self.addEventListener('push', (event) => {
  const { title, body, session } = event.data.json()
  // The tag makes a newer notification for a session replace the older one.
  event.waitUntil(self.registration.showNotification(title, { body, tag: session.pointer.agentSessionId, icon: '/icon-192.png', data: session }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const session = event.notification.data
  event.waitUntil((async () => {
    const [open] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (open) {
      await open.focus()
      open.postMessage({ goToSession: session })
      return
    }
    const query = new URLSearchParams({
      project: session.projectId,
      agent: session.pointer.agent,
      session: session.pointer.agentSessionId,
      title: session.title,
    })
    await self.clients.openWindow(`/?${query}`)
  })())
})
