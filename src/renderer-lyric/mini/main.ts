import { createApp } from 'vue'
import { showLoadError } from '@common/loadErrorNotice'
import { WIN_MINI_PLAYER_RENDERER_EVENT_NAME as ipc, CMMON_EVENT_NAME } from '@common/ipcNames'
import type { MiniPlayerEdge, MiniPlayerEdgeMotion } from '@common/miniPlayer'
import { i18nPlugin } from '../plugins/i18n'
import { connectMainWindow, getSetting, listen } from './ipc'
import { setting, nativePointer, edgeMotion } from './state'
import { initChannel } from './channel'
import App from './App.vue'
import '@root/common/error'

document.title = 'Mini Player - LX-M Music'

void getSetting().then(config => {
  Object.assign(setting, config)
  const updatePerformance = () => { document.documentElement.dataset.lowPowerMode = String(setting['ui.lowPowerMode']) }
  updatePerformance()
  const changeLanguage = () => { window.i18n.setLanguage(setting['common.langId']); window.setLang(setting['common.langId']) }
  changeLanguage()
  listen<Partial<LX.MiniPlayer.Config>>(ipc.on_config_change, ({ params }) => {
    Object.assign(setting, params)
    if ('common.langId' in params) changeLanguage()
    if ('ui.lowPowerMode' in params) updatePerformance()
  })
  listen(ipc.pointer_position, ({ params }) => { nativePointer.value = params })
  listen<MiniPlayerEdge>(ipc.edge_hidden, ({ params }) => { edgeMotion.value = { ...edgeMotion.value, edge: params, phase: params ? 'hidden' : 'shown' } })
  listen<MiniPlayerEdgeMotion>(ipc.edge_motion, ({ params }) => { edgeMotion.value = params })
  listen(ipc.main_window_inited, connectMainWindow)
  listen(CMMON_EVENT_NAME.theme_change, ({ params }) => { window.setTheme(params.theme.colors) })
  initChannel()
  const app = createApp(App)
  app.config.errorHandler = error => { console.error(error); showLoadError(error, 'VIEW_LOAD_FAILED') }
  app.use(i18nPlugin)
  app.mount('#root')
  connectMainWindow()
}).catch(error => { showLoadError(error, 'APP_LOAD_FAILED', () => { window.location.reload() }) })
