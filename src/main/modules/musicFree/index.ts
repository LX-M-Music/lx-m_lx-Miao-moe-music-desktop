import { ipcMain } from 'electron'
import { mainHandle, mainOn } from '@common/mainIpc'
import { MUSIC_FREE_IPC as channels, type MusicFreeImportResult } from '@common/musicFree'
import { errorForTransport, formatError } from '@common/utils/errorMessage'
import { validateIpcValue } from '@main/utils/ipcPolicy'
import getStore from '@main/utils/store'
import { sourceError } from '../sourcePlugins/network'
import { requestMusicFree, musicFreeUrl } from './network'
import { createMusicFreeMedia } from './media'
import { MusicFreeManager } from './manager'
import { protectedMusicFreeStore } from './store'
import { callMusicFreeRuntime, createMusicFreeRuntime, MUSIC_FREE_SANDBOX_URL, type MusicFreeRuntime } from './runtime'

export default () => {
  let manager: MusicFreeManager
  const getManager = () => (manager ??= new MusicFreeManager(protectedMusicFreeStore(getStore('musicfree', false))))
  const runtimes = new Map<string, MusicFreeRuntime>()
  const windows = new WeakMap<Electron.WebContents, MusicFreeRuntime>()
  const loading = new Map<string, Promise<MusicFreeRuntime>>()
  const calls = new Map<string, { cancelled: boolean, runtime?: MusicFreeRuntime }>()
  const reservations = new Map<MusicFreeRuntime, number>()
  const waiting = new Set<() => void>()
  let creating = 0
  const wake = () => { for (const resolve of waiting) resolve(); waiting.clear() }
  const reserve = (runtime: MusicFreeRuntime) => { reservations.set(runtime, (reservations.get(runtime) ?? 0) + 1); return runtime }
  const register = (runtime: MusicFreeRuntime) => { windows.set(runtime.window.webContents, runtime) }
  const fromSandbox = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
    const runtime = windows.get(event.sender)
    if (!runtime || runtime.window.isDestroyed() || event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== MUSIC_FREE_SANDBOX_URL) throw sourceError('MUSICFREE_SENDER_DENIED', 'MusicFree 窗口身份无效')
    return runtime
  }
  const invalidate = (id: string) => { for (const [key, runtime] of runtimes) if (key.endsWith(':' + id)) { runtime.dispose(); runtimes.delete(key) } }
  const runtimeFor = async(owner: Electron.WebContents, id: string) => {
    const record = getManager().get(id)
    if (!record.enabled) throw sourceError('MUSICFREE_DISABLED', '此 MusicFree 音源已停用')
    const key = `${owner.id}:${id}`
    const existing = runtimes.get(key)
    if (existing && !existing.window.isDestroyed()) { runtimes.delete(key); runtimes.set(key, existing); return reserve(existing) }
    if (loading.has(key)) return reserve(await loading.get(key)!)
    const task = (async() => {
      for (const [otherKey, runtime] of runtimes) if (runtime.window.isDestroyed()) runtimes.delete(otherKey)
      while (runtimes.size + creating >= 8) {
        const idle = [...runtimes].find(([, runtime]) => !runtime.pending.size && !reservations.get(runtime))
        if (idle) { idle[1].dispose(); runtimes.delete(idle[0]) } else await new Promise<void>(resolve => { waiting.add(resolve) })
        if (owner.isDestroyed()) throw sourceError('MUSICFREE_OWNER_CLOSED', 'MusicFree 所属窗口已关闭')
      }
      creating++
      try {
        const runtime = await createMusicFreeRuntime(owner, record.script, record.variables, register)
        try {
          const current = getManager().get(id)
          if (current.script !== record.script || !current.enabled || JSON.stringify(current.variables) !== JSON.stringify(record.variables)) throw sourceError('MUSICFREE_CHANGED', 'MusicFree 音源已变更，请重试')
          runtimes.set(key, runtime)
          return reserve(runtime)
        } catch (error) { runtime.dispose(); throw error }
      } finally { creating--; wake() }
    })().finally(() => { loading.delete(key); wake() })
    loading.set(key, task)
    return task
  }
  const inspect = (owner: Electron.WebContents) => async(script: string, variables: Record<string, string>) => {
    const runtime = await createMusicFreeRuntime(owner, script, variables, register)
    try { return runtime.metadata } finally { runtime.dispose() }
  }
  mainHandle(channels.list, async() => getManager().list())
  mainHandle<{ script?: string, url?: string }, MusicFreeImportResult>(channels.import, async({ event, params }) => {
    const imported: string[] = []
    const errors: string[] = []
    const importScript = async(script: string, url?: string) => {
      const plugin = await getManager().import(script, inspect(event.sender), url)
      invalidate(plugin.id)
      imported.push(plugin.name)
    }
    let content = params.script
    if (params.url && content == null) {
      const response = await requestMusicFree(musicFreeUrl(params.url).href, {}, 2 * 1024 * 1024).promise
      if (response.status !== 200 || typeof response.data !== 'string') throw sourceError('MUSICFREE_IMPORT_FAILED', '无法下载 MusicFree 插件或订阅')
      content = response.data
    }
    if (typeof content !== 'string') throw sourceError('MUSICFREE_IMPORT_INVALID', '请选择 MusicFree JS 文件或订阅地址')
    content = content.replace(/^\uFEFF/, '').trim()
    if (content.startsWith('{') || content.startsWith('[')) {
      const parsed = JSON.parse(content)
      const entries = Array.isArray(parsed) ? parsed : parsed.plugins
      if (!Array.isArray(entries) || !entries.length || entries.length > 40) throw sourceError('MUSICFREE_SUBSCRIPTION_INVALID', 'MusicFree 订阅应包含 1–40 个插件地址')
      for (const entry of entries) {
        try {
          const raw = typeof entry === 'string' ? entry : entry?.url
          const url = musicFreeUrl(params.url ? new URL(raw, params.url).href : raw).href
          const response = await requestMusicFree(url, {}, 2 * 1024 * 1024).promise
          if (response.status !== 200 || typeof response.data !== 'string') throw new Error('插件下载失败')
          await importScript(response.data, url)
        } catch (error) { errors.push(`${String(entry?.name ?? entry?.url ?? entry).slice(0, 100)}: ${formatError(error, '', 'MUSICFREE_IMPORT_FAILED')}`) }
      }
    } else await importScript(content, params.url)
    return { plugins: getManager().list(), imported, errors }
  })
  mainHandle<string, any>(channels.remove, async({ params }) => { const result = await getManager().remove(params); invalidate(params); return result })
  mainHandle<{ id: string, enabled: boolean, variables: Record<string, string> }, any>(channels.configure, async({ params }) => {
    const result = await getManager().configure(params.id, params.enabled, params.variables)
    invalidate(params.id)
    return result
  })
  mainHandle<{ id: string, callId: string, method: string, args: unknown[] }, any>(channels.call, async({ event, params }) => {
    const key = `${event.sender.id}:${params.id}:${params.callId}`
    if (calls.has(key)) throw sourceError('MUSICFREE_CALL_DUPLICATE', 'MusicFree 请求标识重复')
    const call: { cancelled: boolean, runtime?: MusicFreeRuntime } = { cancelled: false }
    calls.set(key, call)
    try {
      const runtime = await runtimeFor(event.sender, params.id)
      call.runtime = runtime
      if (call.cancelled) throw Object.assign(new Error('Request cancelled'), { name: 'AbortError' })
      if (params.method === 'getMediaSource' && !runtime.metadata.methods.includes(params.method)) return { url: await createMusicFreeMedia(params.args[0]) }
      if (params.method === 'getLyric' && !runtime.metadata.methods.includes(params.method)) {
        const item = params.args[0] as any
        if (typeof item?.rawLrc === 'string') return { rawLrc: item.rawLrc }
        if (typeof item?.lrc === 'string') {
          const response = await requestMusicFree(item.lrc).promise
          if (response.status !== 200) throw new Error('MusicFree 歌词下载失败')
          return { rawLrc: response.data }
        }
        return null
      }
      const value = await callMusicFreeRuntime(runtime, params.callId, params.method, params.args)
      if (params.method === 'getMediaSource') return { url: await createMusicFreeMedia(value) }
      return value
    } finally {
      if (call.runtime) {
        const count = (reservations.get(call.runtime) ?? 1) - 1
        if (count) reservations.set(call.runtime, count)
        else reservations.delete(call.runtime)
      }
      calls.delete(key)
      wake()
    }
  })
  mainOn<{ id: string, callId: string }>(channels.cancel, ({ event, params }) => {
    const call = calls.get(`${event.sender.id}:${params.id}:${params.callId}`)
    if (!call) return
    call.cancelled = true
    const runtime = call.runtime
    const task = runtime?.pending.get(params.callId)
    if (!runtime || !task) return
    task.reject(Object.assign(new Error('Request cancelled'), { name: 'AbortError' }))
    runtime.window.webContents.send(channels.command, { id: params.callId, cancel: true })
  })
  ipcMain.on(channels.reply, (event, packet) => {
    try {
      const runtime = fromSandbox(event)
      validateIpcValue(packet)
      const task = runtime.pending.get(packet?.id)
      if (!task) return
      clearTimeout(task.timer)
      runtime.pending.delete(packet.id)
      if (packet.error) task.reject(new Error(String(packet.error).slice(0, 2000)))
      else task.resolve(packet.value)
    } catch (error) { console.warn('MusicFree reply rejected:', error) }
  })
  ipcMain.handle(channels.network, async(event, packet) => {
    try {
      const runtime = fromSandbox(event)
      validateIpcValue(packet)
      if (!packet || typeof packet.id !== 'string' || packet.id.length > 100 || typeof packet.url !== 'string' || runtime.network.size >= 8 || runtime.network.has(packet.id)) throw sourceError('MUSICFREE_NETWORK_LIMIT', 'MusicFree 网络请求无效或过多')
      const request = requestMusicFree(packet.url, packet.options)
      runtime.network.set(packet.id, request.cancelHttp)
      try { return await request.promise } finally { runtime.network.delete(packet.id) }
    } catch (error) { throw errorForTransport(error) }
  })
  ipcMain.on(channels.cancelNetwork, (event, id) => {
    try { if (typeof id === 'string') fromSandbox(event).network.get(id)?.() } catch (error) { console.warn('MusicFree cancellation rejected:', error) }
  })
}
