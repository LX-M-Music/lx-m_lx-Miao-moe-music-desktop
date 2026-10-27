import { rendererSend, rendererInvoke, rendererOn } from '@common/rendererIpc'
import { WIN_MINI_PLAYER_RENDERER_EVENT_NAME as ipc } from '@common/ipcNames'

export const getSetting = async() => rendererInvoke<LX.MiniPlayer.Config>(ipc.get_config)
export const saveSetting = async(config: Partial<LX.MiniPlayer.Config>) => rendererInvoke(ipc.set_config, config)
export const setWindowBounds = (bounds: LX.MiniPlayer.NewBounds) => { rendererSend(ipc.set_win_bounds, bounds) }
export const showMainWindow = () => { rendererSend(ipc.show_main_window) }
export const connectMainWindow = () => { rendererSend(ipc.request_main_window_channel) }
export const listen = <T = any>(name: string, listener: LX.IpcRendererEventListenerParams<T>) => { rendererOn<T>(name, listener) }
