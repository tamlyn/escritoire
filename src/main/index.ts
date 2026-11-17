import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import icon from '../../build/icon.png?asset'
import { type Api, apiMethods, type Events } from '../shared/api'
import type { ApiConnection } from '../shared/api-client'
import { codexAdapter } from './agents/codex'
import { claudeAdapter } from './agents/claude'
import { ApiServer, type Connection, tokensMatch } from './api-server'
import { type Client, Clients, type ScreenHost } from './clients'
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
import { DesktopAttention } from './desktop-attention'
import { completeDirectory } from './paths'
import { ProjectFiles } from './project-files'
import { ProjectStore } from './project-store'
import { SessionManager } from './session-manager'
import { SessionStore } from './session-store'
import { watchPresence } from './presence'
import { RemoteAccess } from './remote-access'
import { loadShellEnv } from './shell-env'
import { Supervisor } from './supervisor'
import { ConnectionStore } from './sql/connection-store'
import { Databases } from './sql/databases'
import { separatePassword } from './sql/pgpass'
import { Terminals } from './terminals'
import { Work } from './work'

type Services = {
  clients: Clients
  remote: RemoteAccess
  projects: ProjectStore
  sessions: SessionManager
  sessionStore: SessionStore
  files: ProjectFiles
  terminals: Terminals
  supervisor: Supervisor
  connections: ConnectionStore
  databases: Databases
}

/** The API as one client sees it. */
function createApi(client: Client, { clients, remote, projects, sessions, sessionStore, files, terminals, supervisor, connections, databases }: Services): Api {
  const terminalHost: ScreenHost = {
    attach: (projectId, terminalId, size) => terminals.attach(projectId, terminalId, size),
    detach: (terminalId) => terminals.detach(terminalId),
    write: (_projectId, terminalId, data) => terminals.write(terminalId, data),
    resize: (_projectId, terminalId, size) => terminals.resize(terminalId, size),
  }
  const processHost: ScreenHost = {
    attach: (projectId, processId, size) => supervisor.attach(projectId, processId, size),
    detach: (processId) => supervisor.detach(processId),
    write: (projectId, processId, data) => supervisor.write(projectId, processId, data),
    resize: (projectId, processId, size) => supervisor.resize(projectId, processId, size),
  }
  return {
    getState: async () => clients.state(client, projects.getState()),
    openProject: async (path) => clients.activate(client, await projects.openProject(path)),
    activateProject: async (id) => clients.activate(client, await projects.activateProject(id)),
    closeProject: async (id) => {
      // Failing to save sessions or scrollback mustn't stop the project closing.
      logFailures(await Promise.allSettled([
        sessions.closeProject(id),
        terminals.closeProject(id),
        supervisor.closeProject(id),
        databases.closeProject(id),
      ]))
      return clients.projectsChanged(await projects.closeProject(id), client)
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
      return clients.projectsChanged(await projects.removeProject(id), client)
    },
    loadLayout: (projectId) => projects.loadLayout(projectId),
    saveLayout: (projectId, layout) => projects.saveLayout(projectId, layout),
    completeDirectory,
    getSessionSummaries: async () => sessions.summaries(),
    listPastSessions: (projectId) => sessions.listPastSessions(projectId),
    createSession: (projectId, agent) => sessions.createSession(projectId, agent),
    openSession: (projectId, session) => {
      clients.openSessionView(client, session)
      return sessions.openSession(projectId, session)
    },
    closeSessionView: async (session) => clients.closeSessionView(client, session),
    sendMessage: async (session, input) => sessions.sendMessage(session, input),
    editQueuedMessage: async (session, id, text) => sessions.editQueuedMessage(session, id, text),
    cancelQueuedMessage: async (session, id) => sessions.cancelQueuedMessage(session, id),
    interrupt: (session) => sessions.interrupt(session),
    getSettingChoices: (projectId, agent) => sessions.settingChoices(projectId, agent),
    listCommands: (projectId, agent) => sessions.listCommands(projectId, agent),
    changeSessionSettings: (session, settings) => sessions.changeSettings(session, settings),
    stopTask: (session, taskId) => sessions.stopTask(session, taskId),
    respond: async (session, requestId, response) => sessions.respond(session, requestId, response),
    saveDraft: async (session, draft) => sessions.saveDraft(session, draft),
    setSessionVisible: async (session, visible) => clients.setSessionVisible(client, session, visible),
    closeSession: async (session) => {
      sessions.closeSession(session)
      clients.sessionClosed(session)
    },
    listDirectory: (projectId, path) => files.listDirectory(projectId, path),
    readFile: (projectId, path) => files.readFile(projectId, path),
    writeFile: async (projectId, path, text, expected) => {
      const result = await files.writeFile(projectId, path, text, expected)
      // The watcher ignores the IDE's own writes, but other clients may have the file open.
      if (result === 'saved') clients.sendToOthers(client, 'filesChanged', { projectId, paths: [path] })
      return result
    },
    createFile: (projectId, path) => files.createFile(projectId, path),
    createScratchFile: (projectId, extension) => files.createScratchFile(projectId, extension),
    renameFile: async (projectId, from, to) => {
      await files.rename(projectId, from, to)
      // The file has moved, so the rename succeeded even if its SQL connection is forgotten.
      await connections.moveFiles(projects.getProject(projectId).id, from, to).catch(console.error)
    },
    deleteFile: (projectId, path) => files.delete(projectId, path),
    listProjectFiles: async (projectId) =>
      (await gitFiles(projects.getProject(projectId).path)) ?? files.listAllFiles(projectId),
    attachTerminal: (projectId, terminalId, size) => clients.attachScreen(client, terminalHost, projectId, terminalId, size),
    detachTerminal: async (terminalId) => clients.detachScreen(client, terminalId),
    writeTerminal: async (terminalId, data) => clients.writeScreen(client, terminalId, data),
    resizeTerminal: async (terminalId, size) => clients.resizeScreen(client, terminalId, size),
    closeTerminal: async (projectId, terminalId) => {
      clients.screenClosed(terminalId)
      await terminals.close(projectId, terminalId)
    },
    listProcesses: async () => supervisor.list(),
    startProcess: async (projectId, spec) => (await supervisor.start(projectId, spec)).process,
    stopProcess: (projectId, processId) => supervisor.stop(projectId, processId),
    restartProcess: async (projectId, processId) => void (await supervisor.restart(projectId, processId)),
    removeProcess: async (projectId, processId) => {
      supervisor.remove(projectId, processId)
      clients.screenClosed(processId)
    },
    attachProcess: (projectId, processId, size) => clients.attachScreen(client, processHost, projectId, processId, size),
    detachProcess: async (processId) => clients.detachScreen(client, processId),
    writeProcess: async (_projectId, processId, data) => clients.writeScreen(client, processId, data),
    resizeProcess: async (_projectId, processId, size) => clients.resizeScreen(client, processId, size),
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
      const password = connection.type === 'postgres' ? separatePassword(connection.url) : undefined
      if (connection.type === 'postgres' && password) connection = { ...connection, url: password.url }
      const saved = await connections.save(projects.getProject(projectId).id, connection)
      await password?.save()
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
    // Otherwise a paired device could pair others, which would outlive revoking it.
    getRemoteAccess: async () => desktopOnly(client, () => remote.state()),
    changeRemoteAccess: async (settings) => desktopOnly(client, () => remote.configure(settings)),
    startPairing: async () => desktopOnly(client, () => remote.startPairing()),
    revokeDevice: async (deviceId) => desktopOnly(client, () => remote.revoke(deviceId)),
  }
}

function desktopOnly<T>(client: Client, action: () => T): T {
  if (!client.desktop) throw new Error('Only the desktop can manage remote access.')
  return action()
}

function logFailures(results: PromiseSettledResult<unknown>[]): void {
  for (const result of results) if (result.status === 'rejected') console.error(result.reason)
}

function handleApi(api: Api, work: Work): (method: string, args: unknown[]) => Promise<unknown> {
  const methods = new Set<string>(apiMethods)
  return (method, args) => {
    if (!methods.has(method)) return Promise.reject(new Error(`Unknown method: ${method}`))
    const handler = api[method as keyof Api] as (...args: unknown[]) => Promise<unknown>
    return work.run(() => handler(...args))
  }
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

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    backgroundColor: '#1c1c1e',
    // Linux has no app bundle to take the icon from; macOS ignores this.
    icon,
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
  return window
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
  // Its dependencies are only used once a client connects, after they exist.
  const clients = new Clients({
    lastActiveProject: () => projects.getState().activeProjectId,
    setSessionVisible: (session, visible) => sessions.setVisible(session, visible),
    closeSessionView: (session) => sessions.closeSessionView(session),
    watch: (projectIds) => {
      files.watch(projectIds)
      gitWatcher.watch(projectIds)
    },
  })
  const send = clients.send
  const attention = new DesktopAttention({
    projectName: (projectId) => projects.getState().projects.find((p) => p.id === projectId)?.name ?? '',
    focusSession: (session) => send('focusSession', session),
  })
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
    send: (name, payload) => {
      send(name, payload)
      if (name === 'sessionsChanged') attention.update(payload as Events['sessionsChanged'])
    },
  })
  await sessions.restoreUnread(projects.getState().projects.filter((p) => p.isOpen).map((p) => p.id))
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
  watchPresence((present) => clients.setDesktopPresent(present))

  const apiWork = new Work()
  const remote = await RemoteAccess.load({
    dataDir,
    rendererDir: join(import.meta.dirname, '../renderer'),
    connect: (send) => serve(clients.connect(send, { desktop: false })),
    onChange: (state) => send('remoteAccessChanged', state),
  })
  const services: Services = { clients, remote, projects, sessions, sessionStore, files, terminals, supervisor, connections, databases }
  // The API work belongs to the app rather than the connection, so quitting waits for it all.
  function serve(client: Client): Connection {
    return { handle: handleApi(createApi(client, services), apiWork), close: () => clients.disconnect(client) }
  }

  // The desktop window has a listener of its own, so turning remote access on
  // or off, or changing its port, never disconnects it.
  // Its token is never written down, so only the windows of this launch can know it.
  const desktopToken = randomBytes(32).toString('base64url')
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  const desktopOrigin = rendererUrl ? new URL(rendererUrl).origin : 'file://'
  const server = await ApiServer.start({
    port: 0,
    admits: (request) => request.headers.origin === undefined || request.headers.origin === desktopOrigin,
    connect: (token, send) => tokensMatch(token, desktopToken) ? serve(clients.connect(send, { desktop: true })) : undefined,
  })
  await remote.start()

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
      // Closing the databases first stops any query, which the API call running it would otherwise wait for.
      const databasesClosed = await Promise.allSettled([databases.closeAll()])
      // In dependency order: the renderer starts work for everything, agents call
      // the IDE server, and the IDE server starts processes.
      await apiWork.close()
      const sessionsClosed = await Promise.allSettled([sessions.close()])
      await ideServer.close()
      // Clients first: each one disconnecting changes what's watched.
      const disconnected = await Promise.allSettled([server.close(), remote.close()])
      logFailures([...databasesClosed, ...disconnected, ...(await Promise.allSettled([files.unwatch(), gitWatcher.unwatch(), terminals.closeAll(), supervisor.closeAll()]))])
      if (sessionsClosed[0].status === 'rejected') {
        dialog.showErrorBox("Couldn't save sessions before quitting", String(sessionsClosed[0].reason))
      }
      allowClose = true
      app.quit()
    })()
  })
  ipcMain.handle('apiConnection', (): ApiConnection => ({ url: server.url, token: desktopToken }))
  attention.attach(createWindow())
})
