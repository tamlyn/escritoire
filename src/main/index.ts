import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { type Api, type AppState, apiMethods, type Events } from '../shared/api'
import { claudeAdapter } from './agents/claude'
import { completeDirectory } from './paths'
import { ProjectFiles } from './project-files'
import { ProjectStore } from './project-store'
import { SessionManager } from './session-manager'
import { SessionStore } from './session-store'
import { loadShellEnv } from './shell-env'

type Services = {
  projects: ProjectStore
  sessions: SessionManager
  sessionStore: SessionStore
  files: ProjectFiles
}

function createApi({ projects, sessions, sessionStore, files }: Services): Api {
  // Only the active project is watched, so follow it whenever it may change.
  const watchActive = async (state: Promise<AppState>) => {
    const changed = await state
    files.watch(changed.activeProjectId)
    return changed
  }

  return {
    getState: async () => projects.getState(),
    openProject: (path) => watchActive(projects.openProject(path)),
    activateProject: (id) => watchActive(projects.activateProject(id)),
    closeProject: async (id) => {
      sessions.closeProject(id)
      return watchActive(projects.closeProject(id))
    },
    removeProject: async (id) => {
      sessions.closeProject(id)
      await sessionStore.deleteProject(id)
      return watchActive(projects.removeProject(id))
    },
    loadLayout: (projectId) => projects.loadLayout(projectId),
    saveLayout: (projectId, layout) => projects.saveLayout(projectId, layout),
    completeDirectory,
    getSessionSummaries: async () => sessions.summaries(),
    listPastSessions: (projectId) => sessions.listPastSessions(projectId),
    createSession: (projectId, agent) => sessions.createSession(projectId, agent),
    openSession: (projectId, session) => sessions.openSession(projectId, session),
    closeSessionView: async (session) => sessions.closeSessionView(session),
    sendMessage: async (session, text) => sessions.sendMessage(session, text),
    interrupt: (session) => sessions.interrupt(session),
    respond: async (session, requestId, response) => sessions.respond(session, requestId, response),
    saveDraft: async (session, draft) => sessions.saveDraft(session, draft),
    setSessionVisible: async (session, visible) => sessions.setVisible(session, visible),
    closeSession: async (session) => sessions.closeSession(session),
    listDirectory: (projectId, path) => files.listDirectory(projectId, path),
    readFile: (projectId, path) => files.readFile(projectId, path),
    writeFile: (projectId, path, text) => files.writeFile(projectId, path, text),
  }
}

function registerApi(api: Api): void {
  for (const method of apiMethods) {
    const handler = api[method] as (...args: unknown[]) => Promise<unknown>
    ipcMain.handle(method, (_event, ...args) => handler(...args))
  }
}

function send<K extends keyof Events>(name: K, payload: Events[K]): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(name, payload)
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

// Started before `ready` so the shell runs while Electron starts up. Agents and
// their settings lookups read the environment, so the API waits for it.
const shellEnv = loadShellEnv()

// Not top-level await: Electron doesn't emit `ready` until an ES module main
// script has finished evaluating, so awaiting it here would deadlock.
void app.whenReady().then(async () => {
  const dataDir = app.getPath('userData')
  const projects = await ProjectStore.load(dataDir)
  const sessionStore = new SessionStore(dataDir)
  await shellEnv
  const sessions = new SessionManager({
    adapters: { claude: claudeAdapter },
    store: sessionStore,
    projectPath: (projectId) => projects.getProject(projectId).path,
    send,
  })
  const files = new ProjectFiles({
    projectPath: (projectId) => projects.getProject(projectId).path,
    send: (payload) => send('filesChanged', payload),
  })
  files.watch(projects.getState().activeProjectId)
  app.on('before-quit', () => {
    sessions.closeAll()
    void files.unwatch()
  })
  registerApi(createApi({ projects, sessions, sessionStore, files }))
  createWindow()
})
