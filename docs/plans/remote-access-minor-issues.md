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
- **The phone's back gesture leaves the app** rather than returning to the session list, since opening a session adds no history entry. (`phone/PhoneWorkspace.tsx`)

## Step 3: Web Push

- **A subscription rotated while the app is closed stops notifications** until the app is next opened, because `sw.js` has no `pushsubscriptionchange` handler. (`renderer/public/sw.js`)
- **A phone that vanishes while showing a session can miss a push** for up to about 40 seconds, until the heartbeat ends its connection. (`main/clients.ts`)
- **The VAPID private key and push subscriptions are plain JSON in the data directory**, so anyone who can read it could send notifications to the paired phone. (`main/push.ts`)

## Step 4: files and terminals on the phone

- **A terminal started on the phone outlives a lost browser tab.** If the tab is closed or evicted, the shell runs unreachable until its project closes. Main could tie it to the client with a grace period. (`phone/PhoneWorkspace.tsx`)
- **A phone attached to a terminal the desktop closes gets no notice**, and its screen freezes. Reopening it from a stale list starts a new shell under the old id. (`main/terminals.ts`)
- **A phone attached to a terminal at the desktop's size wraps its output** until the phone types and takes the screen to its own size. (`screen/ScreenView.tsx`)
- **Following a file link from a session discards images attached but not sent**, as reconnecting does. (`session/Composer.tsx`)
- **Commits in the blame gutter do nothing on the phone**, which has no commit view. (`phone/PhoneWorkspace.tsx`)

## Offering to run `tailscale serve`

- **Turning remote access off leaves the `tailscale serve` mapping in place.** It reaches nothing while off, but another program that later listens on that port would be published to the tailnet. (`main/remote-access.ts`)
- **A port served over plain HTTP is shown with an `https://` address**, if it was published by hand with `--http`. (`main/tailscale.ts`)
- **Tailscale being stopped or logged out looks like it isn't installed**, so the dialog shows the manual command rather than the reason. (`main/tailscale.ts`)
- **A failed publish can show the wrong output**, as stderr is preferred to stdout, where Tailscale prints its link for enabling HTTPS. (`main/tailscale.ts`)
- **A hung Tailscale daemon makes publishing slow**, since each step waits up to 15 seconds. (`main/tailscale.ts`)
