import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { type Api, apiMethods, type EventSubscriber, eventNames } from '../shared/api'

const api = Object.fromEntries(
  apiMethods.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(method, ...args)]),
) as Api

const subscribe: EventSubscriber = (name, listener) => {
  if (!eventNames.includes(name)) throw new Error(`Unknown event: ${name}`)
  const handler = (_event: IpcRendererEvent, payload: Parameters<typeof listener>[0]) =>
    listener(payload)
  ipcRenderer.on(name, handler)
  return () => ipcRenderer.off(name, handler)
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('subscribe', subscribe)
