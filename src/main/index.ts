import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { type Api, apiMethods } from '../shared/api'
import { completeDirectory } from './paths'
import { ProjectStore } from './project-store'

function createApi(store: ProjectStore): Api {
  return {
    getState: async () => store.getState(),
    openProject: (path) => store.openProject(path),
    activateProject: (id) => store.activateProject(id),
    closeProject: (id) => store.closeProject(id),
    removeProject: (id) => store.removeProject(id),
    loadLayout: (projectId) => store.loadLayout(projectId),
    saveLayout: (projectId, layout) => store.saveLayout(projectId, layout),
    completeDirectory,
  }
}

function registerApi(api: Api): void {
  for (const method of apiMethods) {
    const handler = api[method] as (...args: unknown[]) => Promise<unknown>
    ipcMain.handle(method, (_event, ...args) => handler(...args))
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    backgroundColor: '#1c1c1e',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 } }
      : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
    },
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

app.on('window-all-closed', () => app.quit())

// Not top-level await: Electron doesn't emit `ready` until an ES module main
// script has finished evaluating, so awaiting it here would deadlock.
void app.whenReady().then(async () => {
  registerApi(createApi(await ProjectStore.load(app.getPath('userData'))))
  createWindow()
})
