import { shallowRef } from '@common/utils/vueTools'
import { MUSIC_FREE_IPC as channels, MUSIC_FREE_QUALITIES, isMusicFreeSource, type MusicFreeImportResult, type MusicFreePlugin } from '@common/musicFree'
import { rendererInvoke, rendererSend } from '@common/rendererIpc'
import musicSdk from '@renderer/utils/musicSdk'
import { createMusicFreeSource } from '@renderer/utils/musicSdk/plugins/musicFree'
import { getRequestSignal } from '@renderer/utils/requestContext'
import { qualityList } from '@renderer/store'

export const musicFreePlugins = shallowRef<MusicFreePlugin[]>([])
let sequence = 0
const call = (id: string, method: string, args: unknown[]) => {
  const callId = `${Date.now()}-${++sequence}`
  const signal = getRequestSignal()
  const cancelHttp = () => { rendererSend(channels.cancel, { id, callId }) }
  const pending = signal?.aborted ? Promise.reject(signal.reason) : rendererInvoke<unknown, any>(channels.call, { id, callId, method, args })
  signal?.addEventListener('abort', cancelHttp, { once: true })
  return { cancelHttp, promise: pending.finally(() => signal?.removeEventListener('abort', cancelHttp)) }
}
const apply = (plugins: MusicFreePlugin[]) => {
  musicFreePlugins.value = plugins
  const qualities = { ...qualityList.value }
  for (const key of Object.keys(qualities)) if (isMusicFreeSource(key)) Reflect.deleteProperty(qualities, key)
  const enabled = plugins.filter(plugin => plugin.enabled)
  for (const plugin of enabled) qualities[plugin.id] = [...MUSIC_FREE_QUALITIES]
  qualityList.value = qualities
  musicSdk.replaceMusicFreeSources(enabled.map(plugin => createMusicFreeSource(plugin, call)))
}
let initializing: Promise<void> | undefined
export const initMusicFreeSources = async() => {
  initializing ??= rendererInvoke<MusicFreePlugin[]>(channels.list).then(plugins => { apply(plugins) }).catch(error => { initializing = undefined; throw error })
  return initializing
}
export const importMusicFree = async(input: { script?: string, url?: string }) => {
  const result = await rendererInvoke<typeof input, MusicFreeImportResult>(channels.import, input)
  apply(result.plugins)
  return result
}
export const removeMusicFree = async(id: string) => {
  const plugins = await rendererInvoke<string, MusicFreePlugin[]>(channels.remove, id)
  apply(plugins)
}
export const configureMusicFree = async(plugin: MusicFreePlugin, enabled: boolean, variables = plugin.variables) => {
  const plugins = await rendererInvoke<unknown, MusicFreePlugin[]>(channels.configure, { id: plugin.id, enabled, variables })
  apply(plugins)
}
