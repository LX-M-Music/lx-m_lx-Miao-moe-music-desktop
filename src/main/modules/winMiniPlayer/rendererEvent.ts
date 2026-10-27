import { MessageChannelMain } from 'electron'
import { registerRendererEvents } from '@main/modules/commonRenderers/common'
import { mainOn, mainHandle } from '@common/mainIpc'
import { WIN_MINI_PLAYER_RENDERER_EVENT_NAME as ipc } from '@common/ipcNames'
import { sendNewMiniPlayerClient, showWindow } from '@main/modules/winMain'
import { getBounds, getMainFrame, sendEvent, setBounds, setResizeable } from './main'
import { buildMiniPlayerConfig, getWindowBounds } from './utils'

export default () => {
  registerRendererEvents(sendEvent)
  mainOn(ipc.show_main_window, () => { showWindow() })
  mainHandle<Partial<LX.MiniPlayer.Config>>(ipc.set_config, async({ params }) => { await global.lx.event_app.update_config(params) })
  mainHandle(ipc.get_config, async() => buildMiniPlayerConfig(global.lx.appSetting))
  mainOn<LX.MiniPlayer.NewBounds>(ipc.set_win_bounds, ({ params }) => {
    const bounds = getBounds()
    if (bounds) setBounds(getWindowBounds(bounds, params))
  })
  mainOn<boolean>(ipc.set_win_resizeable, ({ params }) => { setResizeable(params) })
  mainOn(ipc.request_main_window_channel, ({ event }) => {
    if (event.senderFrame !== getMainFrame()) return
    const { port1, port2 } = new MessageChannelMain()
    sendNewMiniPlayerClient(port1)
    event.senderFrame?.postMessage(ipc.provide_main_window_channel, null, [port2])
  })
}
export const sendConfigChange = (config: Partial<LX.MiniPlayer.Config>) => { sendEvent(ipc.on_config_change, config) }
export const sendMainWindowInitedEvent = () => { sendEvent(ipc.main_window_inited) }
