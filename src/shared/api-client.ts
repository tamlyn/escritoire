import { type Api, apiMethods, type EventSubscriber, type Events } from './api'

/**
 * The API over a WebSocket, for every client, the desktop window included.
 * A client first sends a `Hello` with its token; nothing else is accepted
 * until it has. Then each `Request` gets one `Reply` with the same id, and
 * `Push`es arrive whenever main sends an event. Everything is JSON.
 */
export type Hello = {
  token: string
  /** The project this client was showing, so reconnecting returns it there. */
  activeProjectId?: string | null
}
export type Request = { id: number; method: string; args: unknown[] }
export type Reply = { id: number; result?: unknown } | { id: number; error: string }
export type Push = { event: string; payload: unknown }

/** Why main closes the connection of a client whose token it doesn't know, such as a revoked one. */
export const notAuthorized = 'Not authorised'

/** Where to reach main's API, and the token that admits this client. */
export type ApiConnection = { url: string; token: string }

export type ApiClient = {
  api: Api
  subscribe: EventSubscriber
  close(): void
  /** Reconnects now if waiting to, or tests an open socket. For when the network or the page comes back. */
  checkConnection(): void
}

export type ApiClientOptions = {
  /** Disconnected and retrying, or for good if the error is `notAuthorized`. */
  onLost?: (error: Error) => void
  onReconnected?: () => void
  activeProjectId?: () => string | null
}

const retryDelaysMs = [1000, 2000, 5000]
const livenessTimeoutMs = 3000

/**
 * Calls made while there is no socket wait for the next one, in order. Calls
 * in flight when the connection is lost fail and are never retried, since
 * main may have acted on them. Only `notAuthorized` ends the retrying.
 */
export function connectApi(
  connection: Promise<ApiConnection>,
  { onLost, onReconnected, activeProjectId }: ApiClientOptions = {},
): ApiClient {
  const calls = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>()
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const waiting: { resolve: (socket: WebSocket) => void; reject: (error: Error) => void }[] = []
  let nextId = 1
  let target: ApiConnection | undefined
  /** The current socket, open or opening. */
  let socket: WebSocket | undefined
  let ended: Error | undefined
  let disconnected = false
  let attempts = 0
  let retry: ReturnType<typeof setTimeout> | undefined

  function open(): void {
    clearTimeout(retry)
    if (!target || ended) return
    const { url, token } = target
    const opening = new WebSocket(url)
    socket = opening
    opening.onopen = () => {
      opening.send(JSON.stringify({ token, activeProjectId: activeProjectId?.() } satisfies Hello))
      attempts = 0
      for (const waiter of waiting.splice(0)) waiter.resolve(opening)
      if (disconnected) {
        disconnected = false
        onReconnected?.()
      }
    }
    opening.onmessage = (event) => receive(JSON.parse(event.data as string) as Reply | Push)
    opening.onclose = (event) => lose(opening, event.reason)
  }

  function lose(lost: WebSocket, reason = ''): void {
    if (lost !== socket) return
    socket = undefined
    lost.onopen = lost.onmessage = lost.onclose = null
    // A dead socket can take minutes to report closing, so it's not waited for.
    lost.close()
    const error = new Error(reason || 'Lost the connection to Escritoire')
    for (const call of calls.values()) call.reject(error)
    calls.clear()
    if (ended) return
    if (reason === notAuthorized) {
      end(error)
      onLost?.(error)
      return
    }
    if (!disconnected) {
      disconnected = true
      onLost?.(error)
    }
    retry = setTimeout(open, retryDelaysMs[Math.min(attempts++, retryDelaysMs.length - 1)])
  }

  function end(error: Error): void {
    ended = error
    clearTimeout(retry)
    for (const waiter of waiting.splice(0)) waiter.reject(error)
  }

  function checkConnection(): void {
    if (!target || ended) return
    if (socket?.readyState !== WebSocket.OPEN) {
      if (socket) lose(socket)
      open()
      return
    }
    // A phone waking up can hold a socket that looks open but is dead. Browsers can't send pings.
    const checked = socket
    const timeout = setTimeout(() => lose(checked), livenessTimeoutMs)
    call('getState', []).catch(() => {}).finally(() => clearTimeout(timeout))
  }

  connection.then((given) => {
    target = given
    open()
  }, end)

  function receive(message: Reply | Push): void {
    if ('event' in message) {
      for (const listener of listeners.get(message.event) ?? []) {
        // One failing listener mustn't keep the event from the others.
        try { listener(message.payload) } catch (error) { console.error(error) }
      }
      return
    }
    const call = calls.get(message.id)
    if (!call) return
    calls.delete(message.id)
    if ('error' in message) call.reject(new Error(message.error))
    else call.resolve(message.result)
  }

  async function call(method: string, args: unknown[]): Promise<unknown> {
    const open = await whenOpen()
    // JSON turns a trailing undefined argument into null; left off, it arrives as undefined.
    let end = args.length
    while (end > 0 && args[end - 1] === undefined) end--
    const id = nextId++
    return new Promise((resolve, reject) => {
      calls.set(id, { resolve, reject })
      open.send(JSON.stringify({ id, method, args: args.slice(0, end) } satisfies Request))
    })
  }

  function whenOpen(): Promise<WebSocket> {
    if (ended) return Promise.reject(ended)
    if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket)
    return new Promise((resolve, reject) => waiting.push({ resolve, reject }))
  }

  const api = Object.fromEntries(
    apiMethods.map((method) => [method, (...args: unknown[]) => call(method, args)]),
  ) as Api

  const subscribe: EventSubscriber = (name, listener) => {
    let named = listeners.get(name)
    if (!named) listeners.set(name, (named = new Set()))
    // Wrapped so the same listener subscribed twice is called twice, and unsubscribes once.
    const wrapped = (payload: unknown) => listener(payload as Events[typeof name])
    named.add(wrapped)
    return () => { named.delete(wrapped) }
  }

  function close(): void {
    end(new Error('Closed the connection to Escritoire'))
    if (socket) lose(socket)
  }

  return { api, subscribe, close, checkConnection }
}

/**
 * Whether values of `T` come through JSON unchanged. JSON drops `undefined`
 * from objects and turns it into `null` in arrays, and has no functions, dates,
 * maps or sets. An optional property is allowed, so code mustn't tell a
 * missing key from an `undefined` one: use `null` for a value that means
 * something.
 */
type JsonSafe<T> = unknown extends T
  ? true
  : T extends string | number | boolean | null
    ? true
    : T extends undefined | bigint | symbol | Function | Date | Map<unknown, unknown> | Set<unknown>
      ? false
      : T extends readonly (infer Element)[]
        ? JsonSafe<Element>
        : false extends {
              [K in keyof T]-?: {} extends Pick<T, K> ? JsonSafe<Exclude<T[K], undefined>> : JsonSafe<T[K]>
            }[keyof T]
          ? false
          : true

// The client leaves off trailing undefined arguments, so optional parameters are safe.
type ArgsSafe<Args extends unknown[]> = Args extends [infer First, ...infer Rest]
  ? JsonSafe<First> extends true ? ArgsSafe<Rest> : false
  : JsonSafe<Exclude<Args[number], undefined>>

type JsonUnsafe =
  | {
      [M in keyof Api]: ArgsSafe<Parameters<Api[M]>> extends true
        ? JsonSafe<Awaited<ReturnType<Api[M]>>> extends true ? never : M
        : M
    }[keyof Api]
  | { [E in keyof Events]: JsonSafe<Events[E]> extends true ? never : E }[keyof Events]

// Fails to compile, naming the method or event, if a value wouldn't survive the socket.
const contractIsJsonSafe: [JsonUnsafe] extends [never] ? true : `Not JSON-safe: ${JsonUnsafe}` = true
