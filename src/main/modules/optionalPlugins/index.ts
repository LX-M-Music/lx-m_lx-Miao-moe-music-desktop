import { app, BrowserWindow, dialog, ipcMain, net } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { OFFICIAL_PLUGIN_ROOT, PLUGIN_CATALOG_FILE, PLUGIN_IPC, pluginSourceUrls, pluginText, comparePluginVersions, type PluginPackageFormat, type PluginId, type PluginStoreSnapshot, type PluginTransferLabels, type PluginTransferResult } from '@common/optionalPlugins'
import { getWebContents } from '../winMain/main'
import { PluginManager, PluginTransferError } from './manager'
import { importDropInPlugins } from './dropIn'
import { compilePluginSource } from './compiler'
import { errorForTransport } from '@common/utils/errorMessage'
import { assertIpcRequest } from '@main/utils/ipcPolicy'

const handle = (name: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) => {
  ipcMain.handle(name, async(event, ...args) => {
    try { assertIpcRequest(event, name, args[0], args.slice(1)); return await listener(event, ...args) } catch (error) { throw errorForTransport(error) }
  })
}

let manager: PluginManager
export const getPluginManager = () => manager
export const notifyPluginBackupRestored = async() => {
  const snapshot = await manager.backupRestored()
  for (const window of BrowserWindow.getAllWindows()) if (!window.webContents.isDestroyed()) window.webContents.send(PLUGIN_IPC.changed, snapshot)
}

const OFFICIAL_FETCH_TIMEOUT = 30_000
const MIRROR_CATALOG_TIMEOUT = 8_000
const MIRROR_PACKAGE_TIMEOUT = 20_000
let activePluginMirrorPrefix = ''
let pluginMirrorUnavailable = false
let lastPluginMirrorSetting = false

const requestPluginBytes = async(url: string, maxBytes: number, timeoutMs: number) => new Promise<Buffer>((resolve, reject) => {
  // net.request also supports the Electron 22 Windows 7 build and the app's proxy.
  const request = net.request({ url, partition: 'persist:win-main', redirect: 'error' })
  if (url.endsWith('/' + PLUGIN_CATALOG_FILE)) request.setHeader('Cache-Control', 'no-cache')
  let completed = false
  const fail = (error: Error) => {
    if (completed) return
    completed = true
    clearTimeout(timer)
    reject(error)
    request.abort()
  }
  const timer = setTimeout(() => { fail(new Error('Plugin download timed out')) }, timeoutMs)
  request.on('error', fail)
  request.on('response', response => {
    if (response.statusCode < 200 || response.statusCode >= 300) { fail(new Error(`GitHub HTTP ${response.statusCode}`)); return }
    if (Number(response.headers['content-length']) > maxBytes) { fail(new Error('Plugin download is too large')); return }
    const chunks: Buffer[] = []
    let length = 0
    response.on('error', fail)
    response.on('aborted', () => { fail(new Error('Plugin download interrupted')) })
    response.on('data', (chunk: Buffer) => {
      if (completed) return
      length += chunk.length
      if (length > maxBytes) { fail(new Error('Plugin download is too large')); return }
      chunks.push(chunk)
    })
    response.on('end', () => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      resolve(Buffer.concat(chunks))
    })
  })
  request.end()
})

// Mirrors are tried first and the official source always remains the fallback.
// A mirror that worked for the catalog is preferred for package downloads, while a
// session-wide outage skips repeated timeouts until the option is toggled again.
const fetchPluginBytes = async(url: string, maxBytes: number) => {
  if (!url.startsWith(OFFICIAL_PLUGIN_ROOT)) throw new Error('Invalid official plugin URL')
  const useMirror = global.lx.appSetting['plugin.useMirror']
  if (useMirror !== lastPluginMirrorSetting) {
    lastPluginMirrorSetting = useMirror
    activePluginMirrorPrefix = ''
    pluginMirrorUnavailable = false
  }
  if (!useMirror || pluginMirrorUnavailable) return requestPluginBytes(url, maxBytes, OFFICIAL_FETCH_TIMEOUT)

  const sources = pluginSourceUrls(url, true)
  const candidates = activePluginMirrorPrefix
    ? [...sources.filter(source => source.startsWith(activePluginMirrorPrefix)), ...sources.filter(source => !source.startsWith(activePluginMirrorPrefix))]
    : sources
  const catalog = url.endsWith('/' + PLUGIN_CATALOG_FILE)
  let mirrorFailed = false
  let lastError: Error | undefined
  for (const candidate of candidates) {
    const official = candidate === url
    const timeout = official ? OFFICIAL_FETCH_TIMEOUT : catalog ? MIRROR_CATALOG_TIMEOUT : MIRROR_PACKAGE_TIMEOUT
    try {
      const data = await requestPluginBytes(candidate, maxBytes, timeout)
      activePluginMirrorPrefix = official ? '' : candidate.slice(0, candidate.length - url.length)
      if (official && mirrorFailed) pluginMirrorUnavailable = true
      return data
    } catch (error: any) {
      if (!official) mirrorFailed = true
      lastError = error
    }
  }
  if (mirrorFailed) pluginMirrorUnavailable = true
  throw lastError ?? new Error('Plugin download failed')
}

const resolveDropInDirectory = () => {
  if (process.env.LX_PLUGIN_DROPIN_DIR) return path.resolve(process.env.LX_PLUGIN_DROPIN_DIR)
  // Unpackaged runs (development and tests) keep the folder with the isolated app
  // data, because their executable directory is shared by Electron itself.
  if (!app.isPackaged) return path.join(app.getPath('userData'), 'Plugins')
  return path.join(process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(app.getPath('exe')), 'Plugins')
}

export default () => {
  manager = new PluginManager(path.join(global.lxDataPath, 'plugins'), fetchPluginBytes, {
    compileSource: compilePluginSource,
    onCompile: id => {
      try {
        const contents = getWebContents()
        if (!contents.isDestroyed()) contents.send(PLUGIN_IPC.progress, { phase: 'compiling', id })
      } catch {
        // The main window may not exist yet while drop-in plugins compile during startup.
      }
    },
  })
  const broadcast = (snapshot: PluginStoreSnapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed()) window.webContents.send(PLUGIN_IPC.changed, snapshot)
    }
    return snapshot
  }
  let dropInScan: Promise<Awaited<ReturnType<typeof importDropInPlugins>>> | null = null
  const scanDropInDirectory = async() => {
    if (dropInScan) return dropInScan
    dropInScan = (async() => {
      const directory = resolveDropInDirectory()
      await fs.mkdir(directory, { recursive: true }).catch(() => {})
      return importDropInPlugins({ manager, directory, statePath: path.join(global.lxDataPath, 'plugins', 'drop-in.json') })
    })().finally(() => { dropInScan = null })
    return dropInScan
  }
  void (async() => {
    const result = await scanDropInDirectory()
    if (result.snapshot) broadcast(result.snapshot)
  })().catch(error => { console.error('Drop-in plugin scan failed:', error) })
  handle(PLUGIN_IPC.list, async() => manager.snapshot())
  handle(PLUGIN_IPC.refresh, async() => broadcast(await manager.refresh()))
  handle(PLUGIN_IPC.scanDropIn, async() => {
    const result = await scanDropInDirectory()
    return { imported: result.imported, failed: result.failed, snapshot: result.snapshot ? broadcast(result.snapshot) : await manager.snapshot() }
  })
  handle(PLUGIN_IPC.install, async(_event, id: PluginId, format?: PluginPackageFormat) => broadcast(await manager.install(id, format)))
  handle(PLUGIN_IPC.uninstall, async(_event, id: PluginId) => broadcast(await manager.uninstall(id)))
  handle(PLUGIN_IPC.setEnabled, async(event, id: PluginId, enabled: boolean) => {
    if (event.sender !== getWebContents() || event.senderFrame !== event.sender.mainFrame) throw new Error('Plugin state changes require the main window')
    return broadcast(await manager.setEnabled(id, enabled))
  })
  handle(PLUGIN_IPC.runtimeResult, async(event, id: PluginId, directory: string, error?: string) => {
    const lyric = event.sender !== getWebContents()
    if (event.senderFrame !== event.sender.mainFrame || (lyric && !new URL(event.sender.getURL()).pathname.endsWith('/lyric.html'))) throw new Error('Invalid plugin runtime window')
    return broadcast(await manager.reportRuntimeResult(id, directory, error, lyric))
  })

  const transferState = { busy: false }
  const transfer = async<T>(event: Electron.IpcMainInvokeEvent, labels: PluginTransferLabels, operation: (window: BrowserWindow) => Promise<PluginTransferResult<T>>): Promise<PluginTransferResult<T>> => {
    if (transferState.busy) return { status: 'error', code: 'busy' }
    if (event.sender !== getWebContents() || event.senderFrame !== event.sender.mainFrame) throw new Error('Plugin transfer requires the main window')
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) return { status: 'cancelled' }
    for (const key of ['title', 'filter', 'confirm', 'cancel', 'trust', 'install', 'replace', 'downgrade', 'unknownVersion'] as const) {
      if (!labels || typeof labels[key] !== 'string' || labels[key].length > 2000) throw new Error('Invalid plugin dialog options')
    }
    transferState.busy = true
    try { return await operation(window) } catch (error) {
      console.error('Plugin transfer failed:', error)
      return { status: 'error', code: error instanceof PluginTransferError ? error.code : 'write_failed', detail: errorForTransport(error).message }
    } finally { transferState.busy = false }
  }
  handle(PLUGIN_IPC.import, async(event, labels: PluginTransferLabels) => transfer(event, labels, async window => {
    const selected = await dialog.showOpenDialog(window, {
      title: labels.title,
      filters: [{ name: labels.filter, extensions: ['lxplugin', 'zip'] }],
      properties: ['openFile'],
    })
    if (selected.canceled || !selected.filePaths.length || window.isDestroyed()) return { status: 'cancelled' }
    const prepared = await manager.prepareImport(selected.filePaths[0])
    const manifest = prepared.manifest
    const downgrade = prepared.previousVersion && comparePluginVersions(manifest.version, prepared.previousVersion) < 0
    const template = !prepared.replacing ? labels.install : downgrade ? labels.downgrade : labels.replace
    const values: Record<string, string> = {
      name: pluginText(manifest.name, global.lx.appSetting['common.langId'] ?? 'zh-cn', manifest.id),
      version: manifest.version,
      previous: prepared.previousVersion ?? labels.unknownVersion,
    }
    const confirmed = await dialog.showMessageBox(window, {
      type: 'question',
      title: labels.title,
      message: template.replace(/\{(name|version|previous)\}/g, (_, key: string) => values[key]),
      detail: `ID: ${manifest.id}\n\n${labels.trust}`,
      buttons: [labels.confirm, labels.cancel],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    if (confirmed.response !== 0 || window.isDestroyed()) return { status: 'cancelled' }
    return { status: 'success', value: { id: manifest.id, snapshot: broadcast(await manager.importPrepared(prepared)) } }
  }))
  handle(PLUGIN_IPC.export, async(event, id: PluginId, labels: PluginTransferLabels) => transfer(event, labels, async window => {
    const archive = await manager.createExport(id)
    const selected = await dialog.showSaveDialog(window, {
      title: labels.title,
      defaultPath: `${archive.manifest.id}-${archive.manifest.version}.${archive.format}`,
      filters: [{ name: labels.filter, extensions: [archive.format] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (selected.canceled || !selected.filePath || window.isDestroyed()) return { status: 'cancelled' }
    const filename = path.extname(selected.filePath) ? selected.filePath : selected.filePath + '.' + archive.format
    return { status: 'success', value: { id, filename: await manager.writeExport(filename, archive.bytes, archive.format) } }
  }))
}
