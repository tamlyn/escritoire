# Remote access: minor issues from code review

Found while reviewing each step and left for now. None loses work.

## Step 1: reconnecting by snapshot

- **A socket that dies while the page stays in the foreground goes unnoticed** until the OS reports the failure, which can take minutes. The client only tests its socket on `online` and when the page becomes visible. (`shared/api-client.ts`)
- **Backoff resets when the socket opens**, before main has admitted the client. A server that accepts and promptly drops a client is retried every second, remounting the app each time. (`shared/api-client.ts`)
- **`checkConnection` restarts a socket that is still connecting**, so `online` and `visibilitychange` firing together can discard a handshake that was about to succeed. (`shared/api-client.ts`)
- **The three-second liveness check can replace a slow but working socket** on a poor network, which costs a remount. (`shared/api-client.ts`)

## Step 2: the phone layout

- **The phone can't close a session.** A session started on the phone has no desktop tab, so its agent keeps running until the project closes. The plan accepted this (problem 5); a close control may be wanted once it's been used.
- **Sessions with no desktop tab lose their unread state on restart**, because `restoreUnread` only restores sessions that have a tab. (`main/index.ts`)
- **The desktop window gets the `compact` styles when narrowed**, such as larger inputs, though it keeps the desktop layout. (`renderer/src/styles.css`)
- **The phone's back gesture leaves the app** rather than returning to the session list, since opening a session adds no history entry. (`phone/PhoneWorkspace.tsx`)

## Step 3: Web Push

- **A subscription rotated while the app is closed stops notifications** until the app is next opened, because `sw.js` has no `pushsubscriptionchange` handler. (`renderer/public/sw.js`)
- **A phone that vanishes while showing a session can miss a push** for up to about 40 seconds, until the heartbeat ends its connection. (`main/clients.ts`)
- **The VAPID private key and push subscriptions are plain JSON in the data directory**, so anyone who can read it could send notifications to the paired phone. (`main/push.ts`)
