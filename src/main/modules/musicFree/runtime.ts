import { BrowserWindow, session } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { MUSIC_FREE_IPC as channels, type MusicFreePlugin } from '@common/musicFree'
import { validateIpcValue } from '@main/utils/ipcPolicy'
import { sourceError } from '../sourcePlugins/network'

export const MUSIC_FREE_SANDBOX_URL = 'data:text/html;charset=UTF-8,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-eval\'; connect-src \'none\'; frame-src \'none\'; worker-src \'none\'; form-action \'none\'; base-uri \'none\'"><title>MusicFree</title>')
export interface MusicFreeRuntime {
  owner: Electron.WebContents
  window: Electron.BrowserWindow
  metadata: Omit<MusicFreePlugin, 'id' | 'variables' | 'enabled'>
  pending: Map<string, { resolve: (value: any) => void, reject: (error: Error) => void, timer: NodeJS.Timeout }>
  network: Map<string, () => void>
  dispose: () => void
}
let runtimeBundle: Promise<string> | undefined

export const createMusicFreeRuntime = async(owner: Electron.WebContents, script: string, variables: Record<string, string>, register: (runtime: MusicFreeRuntime) => void): Promise<MusicFreeRuntime> => {
  const partition = session.fromPartition('musicfree-' + randomUUID())
  partition.setPermissionRequestHandler((_contents, _permission, reply) => { reply(false) })
  partition.setPermissionCheckHandler(() => false)
  partition.webRequest.onBeforeRequest((details, reply) => { reply({ cancel: details.resourceType !== 'mainFrame' || details.url !== MUSIC_FREE_SANDBOX_URL }) })
  const window = new BrowserWindow({ show: false, webPreferences: { session: partition, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, navigateOnDragDrop: false, disableDialogs: true, backgroundThrottling: false, preload: path.join(__dirname, 'musicfree-preload.js') } })
  let disposed = false
  const runtime: MusicFreeRuntime = {
    owner,
    window,
    metadata: { name: '', version: '', author: '', methods: [], primaryKey: [], supportedSearchType: [], userVariables: [] },
    pending: new Map(),
    network: new Map(),
    dispose() {
      if (disposed) return
      disposed = true
      owner.removeListener('destroyed', dispose)
      owner.removeListener('render-process-gone', dispose)
      owner.removeListener('did-start-navigation', navigate)
      for (const task of runtime.pending.values()) { clearTimeout(task.timer); task.reject(sourceError('MUSICFREE_RUNTIME_CLOSED', 'MusicFree 运行环境已关闭，请重试')) }
      runtime.pending.clear()
      for (const cancel of runtime.network.values()) cancel()
      runtime.network.clear()
      if (!window.isDestroyed()) window.destroy()
    },
  }
  const dispose = () => { runtime.dispose() }
  const navigate = (_event: Electron.Event, _url: string, sameDocument: boolean, mainFrame: boolean) => { if (mainFrame && !sameDocument) dispose() }
  register(runtime)
  owner.once('destroyed', dispose)
  owner.once('render-process-gone', dispose)
  owner.on('did-start-navigation', navigate)
  window.once('closed', dispose)
  window.webContents.once('render-process-gone', dispose)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => { event.preventDefault() })
  window.webContents.on('will-redirect', event => { event.preventDefault() })
  window.webContents.on('will-attach-webview', event => { event.preventDefault() })
  let timer: NodeJS.Timeout | undefined
  try {
    const metadata = await Promise.race([
      (async() => {
        runtimeBundle ??= fs.readFile(path.join(__dirname, 'musicfree-runtime.js'), 'utf8')
        const bundle = await runtimeBundle
        await window.loadURL(MUSIC_FREE_SANDBOX_URL)
        await window.webContents.executeJavaScript(bundle)
        return window.webContents.executeJavaScript(`window.createMusicFreeRuntime(${JSON.stringify(script)}, ${JSON.stringify(variables)})`)
      })(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { reject(sourceError('MUSICFREE_INIT_TIMEOUT', 'MusicFree 插件初始化超时')) }, 10000) }),
    ])
    validateIpcValue(metadata)
    if (!metadata || typeof metadata.name !== 'string' || metadata.name.length > 100 || !Array.isArray(metadata.methods) || !Array.isArray(metadata.primaryKey)) throw sourceError('MUSICFREE_PLUGIN_INVALID', 'MusicFree 插件信息无效')
    runtime.metadata = metadata
    return runtime
  } catch (error) { runtime.dispose(); throw error } finally { clearTimeout(timer) }
}

export const callMusicFreeRuntime = async(runtime: MusicFreeRuntime, callId: string, method: string, args: unknown[]): Promise<any> => {
  if (runtime.window.isDestroyed() || !runtime.metadata.methods.includes(method)) throw sourceError('MUSICFREE_METHOD_MISSING', 'MusicFree 插件未提供此功能')
  if (runtime.pending.size >= 8 || runtime.pending.has(callId)) throw sourceError('MUSICFREE_CALL_LIMIT', 'MusicFree 请求过多，请稍后再试')
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(sourceError('MUSICFREE_CALL_TIMEOUT', 'MusicFree 插件执行超时')); runtime.dispose() }, 30000)
    runtime.pending.set(callId, { resolve, reject, timer })
    runtime.window.webContents.send(channels.command, { id: callId, method, args })
  })
}
