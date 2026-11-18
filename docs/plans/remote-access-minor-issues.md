# Remote access: minor issues from code review

Found while reviewing each step and left for now. None loses work.

## Step 1: reconnecting by snapshot

- **A socket that dies while the page stays in the foreground goes unnoticed** until the OS reports the failure, which can take minutes. The client only tests its socket on `online` and when the page becomes visible. (`shared/api-client.ts`)
- **Backoff resets when the socket opens**, before main has admitted the client. A server that accepts and promptly drops a client is retried every second, remounting the app each time. (`shared/api-client.ts`)
- **`checkConnection` restarts a socket that is still connecting**, so `online` and `visibilitychange` firing together can discard a handshake that was about to succeed. (`shared/api-client.ts`)
- **The three-second liveness check can replace a slow but working socket** on a poor network, which costs a remount. (`shared/api-client.ts`)
