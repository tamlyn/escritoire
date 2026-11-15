import { type Api, apiMethods, type EventSubscriber, type Events } from './api'

/**
 * The API over a WebSocket, for every client, the desktop window included.
 * A client first sends a `Hello` with its token; nothing else is accepted
 * until it has. Then each `Request` gets one `Reply` with the same id, and
 * `Push`es arrive whenever main sends an event. Everything is JSON.
 */
export type Hello = { token: string }
export type Request = { id: number; method: string; args: unknown[] }
export type Reply = { id: number; result?: unknown } | { id: number; error: string }
export type Push = { event: string; payload: unknown }

/** Why main closes the connection of a client whose token it doesn't know, such as a revoked one. */
export const notAuthorised = 'Not authorised'

/** Where to reach main's API, and the token that admits this client. */
export type ApiConnection = { url: string; token: string }

export type ApiClient = { api: Api; subscribe: EventSubscriber; close(): void }

/**
 * Calls made before the socket opens wait for it, in order. Once the
 * connection is lost, calls in flight and all later ones fail, and `onLost`
 * says why: `notAuthorised` if main doesn't know the token.
 */
export function connectApi(connection: Promise<ApiConnection>, { onLost }: { onLost?: (error: Error) => void } = {}): ApiClient {
  const calls = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>()
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  let nextId = 1
  let lost: Error | undefined

  const opened = connection.then(({ url, token }) => new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.onopen = () => {
      socket.send(JSON.stringify({ token } satisfies Hello))
      resolve(socket)
    }
    socket.onmessage = (event) => receive(JSON.parse(event.data as string) as Reply | Push)
    socket.onclose = (event) => {
      lost = new Error(event.reason || 'Lost the connection to Escritoire')
      for (const call of calls.values()) call.reject(lost)
      calls.clear()
      reject(lost)
      onLost?.(lost)
    }
  }))
  // Reported to whoever calls next.
  opened.catch(() => {})

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
    const socket = await opened
    if (lost) throw lost
    // JSON turns a trailing undefined argument into null; left off, it arrives as undefined.
    let end = args.length
    while (end > 0 && args[end - 1] === undefined) end--
    const id = nextId++
    return new Promise((resolve, reject) => {
      calls.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, args: args.slice(0, end) } satisfies Request))
    })
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

  return { api, subscribe, close: () => void opened.then((socket) => socket.close(), () => {}) }
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
