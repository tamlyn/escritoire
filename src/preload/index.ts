import { contextBridge, ipcRenderer } from 'electron'
import { type Api, apiMethods } from '../shared/api'

const api = Object.fromEntries(
  apiMethods.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(method, ...args)]),
) as Api

contextBridge.exposeInMainWorld('api', api)
