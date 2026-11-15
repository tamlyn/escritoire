import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { type Api, apiMethods, type Events } from '../shared/api'
import { codexAdapter } from './agents/codex'
import { claudeAdapter } from './agents/claude'
import {
  gitBlame,
  gitCommit,
  gitDiff,
  gitFiles,
  gitHeadText,
  gitHistory,
  gitPull,
  gitPush,
  gitSummary,
  gitSwitch,
  GitWatcher,
} from './git'
import { IdeServer } from './ide-server'
import { registerSupervisorTools } from './ide-tools'
import { completeDirectory } from './paths'
import { ProjectFiles } from './project-files'
import { ProjectStore } from './project-store'
import { SessionManager } from './session-manager'
import { SessionStore } from './session-store'
import { loadShellEnv } from './shell-env'
import { Supervisor } from './supervisor'
import { ConnectionStore } from './sql/connection-store'
import { Databases } from './sql/databases'
import { movePasswordToPgpass } from './sql/pgpass'
import { Terminals } from './terminals'
import { Work } from './work'

type Services = {
  projects: ProjectStore
  sessions: SessionManager
  sessionStore: SessionStore
  files: ProjectFiles
  terminals: Terminals
  supervisor: Supervisor
  connections: ConnectionStore
  databases: Databases
}

function createApi({ projects, sessions, sessionStore, files, terminals, supervisor, connections, databases }: Services): Api {
  return {
    getState: async () => projects.getState(),
    openProject: (path) => projects.openProject(path),
    activateProject: (id) => projects.activateProject(id),
    closeProject: async (id) => {
      // Failing to save sessions or scrollback mustn't stop the project closing.
      logFailures(await Promise.allSettled([
        sessions.closeProject(id),
        terminals.closeProject(id),
        supervisor.closeProject(id),
        databases.closeProject(id),
      ]))
      return projects.closeProject(id)
    },
    removeProject: async (id) => {
      await sessions.closeProject(id).catch(console.error)
      await Promise.all([
        sessionStore.deleteProject(id),
        terminals.deleteProject(id),
        supervisor.closeProject(id),
        databases.closeProject(id),
        connections.deleteProject(id),
      ])
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
    sendMessage: async (session, input) => sessions.sendMessage(session, input),
    interrupt: (session) => sessions.interrupt(session),
    getSettingChoices: (projectId, agent) => sessions.settingChoices(projectId, agent),
    changeSessionSettings: (session, settings) => sessions.changeSettings(session, settings),
    stopTask: (session, taskId) => sessions.stopTask(session, taskId),
    respond: async (session, requestId, response) => sessions.respond(session, requestId, response),
    saveDraft: async (session, draft) => sessions.saveDraft(session, draft),
    setSessionVisible: async (session, visible) => sessions.setVisible(session, visible),
    closeSession: async (session) => sessions.closeSession(session),
    listDirectory: (projectId, path) => files.listDirectory(projectId, path),
    readFile: (projectId, path) => files.readFile(projectId, path),
    writeFile: (projectId, path, text, expected) => files.writeFile(projectId, path, text, expected),
    createFile: (projectId, path) => files.createFile(projectId, path),
    createScratchFile: (projectId, extension) => files.createScratchFile(projectId, extension),
    renameFile: async (projectId, from, to) => {
      await files.rename(projectId, from, to)
      await connections.moveFiles(projects.getProject(projectId).id, from, to)
    },
    deleteFile: (projectId, path) => files.delete(projectId, path),
    listProjectFiles: async (projectId) =>
      (await gitFiles(projects.getProject(projectId).path)) ?? files.listAllFiles(projectId),
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
    getGitSummary: (projectId) => gitSummary(projects.getProject(projectId).path),
    getGitDiff: (projectId, request) =>
      gitDiff(projects.getProject(projectId).path, request, (path) => files.readFile(projectId, path)),
    getGitHistory: (projectId) => gitHistory(projects.getProject(projectId).path),
    getGitCommit: (projectId, hash) => gitCommit(projects.getProject(projectId).path, hash),
    getGitBlame: (projectId, path, text) => gitBlame(projects.getProject(projectId).path, path, text),
    getGitHeadText: (projectId, path) => gitHeadText(projects.getProject(projectId).path, path),
    switchGitBranch: (projectId, branch) => gitSwitch(projects.getProject(projectId).path, branch),
    pullGit: (projectId) => gitPull(projects.getProject(projectId).path),
    pushGit: (projectId) => gitPush(projects.getProject(projectId).path),
    listConnections: (projectId) => connections.get(projects.getProject(projectId).id),
    saveConnection: async (projectId, connection) => {
      if (connection.type === 'postgres') connection = { ...connection, url: await movePasswordToPgpass(connection.url) }
      const saved = await connections.save(projects.getProject(projectId).id, connection)
      await databases.closeConnection(projectId, connection.id)
      return saved
    },
    deleteConnection: async (projectId, connectionId) => {
      await databases.closeConnection(projectId, connectionId)
      return connections.delete(projects.getProject(projectId).id, connectionId)
    },
    setFileConnection: (projectId, path, connectionId) =>
      connections.setFileConnection(projects.getProject(projectId).id, path, connectionId),
    runSql: (projectId, connectionId, runId, statements) =>
      databases.run(projects.getProject(projectId).id, connectionId, runId, statements),
    cancelSql: (runId) => databases.cancel(runId),
  }
}

function logFailures(results: PromiseSettledResult<unknown>[]): void {
  for (const result of results) if (result.status === 'rejected') console.error(result.reason)
}

function registerApi(api: Api, work: Work): void {
  for (const method of apiMethods) {
    const handler = api[method] as (...args: unknown[]) => Promise<unknown>
    ipcMain.handle(method, (_event, ...args) => work.run(() => handler(...args)))
  }
}

function send<K extends keyof Events>(name: K, payload: Events[K]): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(name, payload)
}

// The window controls drawn over the header on Windows and Linux. Electron
// can't read CSS variables, so these are the header's --chrome and --foreground
// in hex; one pixel shorter than the header so its bottom border shows.
function titleBarOverlay(): Electron.TitleBarOverlay {
  return nativeTheme.shouldUseDarkColors
    ? { color: '#0b0b0b', symbolColor: '#e8e8e8', height: 39 }
    : { color: '#f5f5f5', symbolColor: '#0a0a0a', height: 39 }
}

let allowClose = false

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    backgroundColor: '#1c1c1e',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay() }),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
    },
  })

  if (process.platform !== 'darwin') {
    // Hidden rather than removed, so its shortcuts (reload, dev tools, zoom) still work.
    window.setMenuBarVisibility(false)
    const updateOverlay = () => window.setTitleBarOverlay(titleBarOverlay())
    nativeTheme.on('updated', updateOverlay)
    window.once('closed', () => nativeTheme.off('updated', updateOverlay))
  }

  window.on('close', (event) => {
    if (!allowClose) { event.preventDefault(); app.quit() }
  })
  window.once('ready-to-show', () => window.show())
  // Links that open a new window (a process's port, say) go to the default browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

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
    adapters: { claude: claudeAdapter, codex: codexAdapter },
    store: sessionStore,
    projectPath: (projectId) => projects.getProject(projectId).path,
    ideConnection: (projectId) => ideServer.connection(projectId),
    send,
  })
  const files = new ProjectFiles({
    projectPath: (projectId) => projects.getProject(projectId).path,
    send: (payload) => send('filesChanged', payload),
    onAnyChange: (projectId) => send('gitChanged', { projectId }),
    trash: (path) => shell.trashItem(path),
  })
  const gitWatcher = new GitWatcher({
    projectPath: (projectId) => projects.getProject(projectId).path,
    onChanged: (projectId) => send('gitChanged', { projectId }),
  })
  const terminals = new Terminals({
    dataDir,
    projectPath: (projectId) => projects.getProject(projectId).path,
    send: (output) => send('screenOutput', output),
  })
  const connections = new ConnectionStore(dataDir)
  const databases = new Databases({
    projectPath: (projectId) => projects.getProject(projectId).path,
    connection: (projectId, connectionId) => connections.getConnection(projectId, connectionId),
  })
  // Only the active project is watched.
  projects.onActiveChanged((projectId) => {
    files.watch(projectId)
    gitWatcher.watch(projectId)
  })

  const ipc = new Work()
  let shuttingDown = false
  app.on('before-quit', (event) => {
    if (allowClose) return
    event.preventDefault()
    if (shuttingDown) return
    shuttingDown = true
    void (async () => {
      try {
        await Promise.all(BrowserWindow.getAllWindows().map((window) =>
          window.webContents.executeJavaScript('window.flushEdits()')))
      } catch (error) {
        // Unsaved edits are still in the editor, so the user can copy them before quitting again.
        shuttingDown = false
        await Promise.allSettled(BrowserWindow.getAllWindows().map((window) =>
          window.webContents.executeJavaScript('document.body.inert = false')))
        dialog.showErrorBox("Couldn't save before quitting", String(error))
        return
      }
      // In dependency order: the renderer starts work for everything, agents call
      // the IDE server, and the IDE server starts processes.
      await ipc.close()
      const sessionsClosed = await Promise.allSettled([sessions.close()])
      await ideServer.close()
      logFailures(await Promise.allSettled([files.unwatch(), gitWatcher.unwatch(), terminals.closeAll(), supervisor.closeAll(), databases.closeAll()]))
      if (sessionsClosed[0].status === 'rejected') {
        dialog.showErrorBox("Couldn't save sessions before quitting", String(sessionsClosed[0].reason))
      }
      allowClose = true
      app.quit()
    })()
  })
  registerApi(createApi({ projects, sessions, sessionStore, files, terminals, supervisor, connections, databases }), ipc)
  createWindow()
})
