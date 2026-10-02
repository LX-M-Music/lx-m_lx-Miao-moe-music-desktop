import { showLoadError } from '@common/loadErrorNotice'
import { ipcRenderer } from 'electron'
import { PLUGIN_IPC, type PluginStoreSnapshot } from '@common/optionalPlugins'
import { createPluginRuntime } from '@common/optionalPluginRuntime'
import * as performancePolicy from '@common/performance'
import { isPlay, setting } from './state'
import { useEvent, getAnalyserDataArray } from '@lyric/core/mainWindowChannel'

export const pluginRuntime = createPluginRuntime({
  performance: performancePolicy,
  lyricState: { isPlay, setting },
  lyricChannel: { useEvent, getAnalyserDataArray },
}, true, async(id, directory, error) => ipcRenderer.invoke(PLUGIN_IPC.runtimeResult, id, directory, error))
export const initOptionalPlugins = () => {
  const reportError = (error: unknown) => { console.error(error); showLoadError(error, 'PLUGIN_LOAD_FAILED') }
  const onChange = (_event: Electron.IpcRendererEvent, snapshot: PluginStoreSnapshot) => { void pluginRuntime.sync(snapshot).catch(reportError) }
  ipcRenderer.on(PLUGIN_IPC.changed, onChange)
  void (async() => { await pluginRuntime.sync(await ipcRenderer.invoke(PLUGIN_IPC.list)) })().catch(reportError)
  return () => {
    ipcRenderer.removeListener(PLUGIN_IPC.changed, onChange)
    void pluginRuntime.dispose()
  }
}
