import { contextBridge, ipcRenderer } from 'electron'
import type { ApiConnection } from '../shared/api-client'

// The API itself goes over a WebSocket, as from a browser; this only says where, with a token.
contextBridge.exposeInMainWorld('desktop', {
  apiConnection: (): Promise<ApiConnection> => ipcRenderer.invoke('apiConnection'),
})
