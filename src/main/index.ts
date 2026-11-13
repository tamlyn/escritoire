import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { type Api, apiMethods, type Events } from '../shared/api'
import { claudeAdapter } from './agents/claude'
import { IdeServer } from './ide-server'
import { registerSupervisorTools } from './ide-tools'
import { completeDirectory } from './paths'
import { ProjectFiles } from './project-files'
import { ProjectStore } from './project-store'
import { SessionManager } from './session-manager'
import { SessionStore } from './session-store'
import { loadShellEnv } from './shell-env'
import { Supervisor } from './supervisor'
import { Terminals } from './terminals'

type Services = {
  projects: ProjectStore
  sessions: SessionManager
  sessionStore: SessionStore
  files: ProjectFiles
  terminals: Terminals
  supervisor: Supervisor
}

function createApi({ projects, sessions, sessionStore, files, terminals, supervisor }: Services): Api {
  return {
    getState: async () => projects.getState(),
    openProject: (path) => projects.openProject(path),
    activateProject: (id) => projects.activateProject(id),
    closeProject: async (id) => {
      sessions.closeProject(id)
      await Promise.all([terminals.closeProject(id), supervisor.closeProject(id)])
      return projects.closeProject(id)
    },
    removeProject: async (id) => {
      sessions.closeProject(id)
      await Promise.all([sessionStore.deleteProject(id), terminals.deleteProject(id), supervisor.closeProject(id)])
      return projects.removeProject(id)
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
    attachTerminal: (projectId, terminalId, size) => terminals.attach(projectId, terminalId, size),
    detachTerminal: async (terminalId) => terminals.detach(terminalId),
    writeTerminal: async (terminalId, data) => terminals.write(terminalId, data),
    resizeTerminal: async (terminalId, size) => terminals.resize(terminalId, size),
    closeTerminal: (projectId, terminalId) => terminals.close(projectId, terminalId),
    listProcesses: async () => supervisor.list(),
    startProcess: async (projectId, spec) => (await supervisor.start(projectId, spec)).process,
    stopProcess: (projectId, processId) => supervisor.stop(projectId, processId),
    restartProcess: async (projectId, processId) => void (await supervisor.restart(projectId, processId)),
    removeProcess: async (projectId, processId) => supervisor.remove(projectId, processId),
    attachProcess: (projectId, processId, size) => supervisor.attach(projectId, processId, size),
    detachProcess: async (processId) => supervisor.detach(processId),
    writeProcess: async (projectId, processId, data) => supervisor.write(projectId, processId, data),
    resizeProcess: async (projectId, processId, size) => supervisor.resize(projectId, processId, size),
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
  const supervisor = new Supervisor({
    projectPath: (projectId) => projects.getProject(projectId).path,
    send: (output) => send('screenOutput', output),
    onChanged: (processes) => send('processesChanged', processes),
  })
  const ideServer = await IdeServer.start((mcp, projectId) => {
    projects.getProject(projectId)
    registerSupervisorTools(mcp, supervisor, projectId)
  })
  const sessions = new SessionManager({
    adapters: { claude: claudeAdapter },
    store: sessionStore,
    projectPath: (projectId) => projects.getProject(projectId).path,
    ideConnection: (projectId) => ideServer.connection(projectId),
    send,
  })
  const files = new ProjectFiles({
    projectPath: (projectId) => projects.getProject(projectId).path,
    send: (payload) => send('filesChanged', payload),
  })
  const terminals = new Terminals({
    dataDir,
    projectPath: (projectId) => projects.getProject(projectId).path,
    send: (output) => send('screenOutput', output),
  })
  // Only the active project is watched.
  projects.onActiveChanged((projectId) => files.watch(projectId))

  // Quitting waits while terminals save their scrollback and processes stop.
  let shutDown = false
  app.on('before-quit', (event) => {
    if (shutDown) return
    event.preventDefault()
    sessions.closeAll()
    void Promise.allSettled([files.unwatch(), terminals.closeAll(), supervisor.closeAll(), ideServer.close()]).then((results) => {
      for (const result of results) if (result.status === 'rejected') console.error(result.reason)
      shutDown = true
      app.quit()
    })
  })
  registerApi(createApi({ projects, sessions, sessionStore, files, terminals, supervisor }))
  createWindow()
})
