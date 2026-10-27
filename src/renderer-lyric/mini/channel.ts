import { WIN_MINI_PLAYER_RENDERER_EVENT_NAME as ipc } from '@common/ipcNames'
import { listen } from './ipc'
import { miniPlayer, miniPlayerCover, playerActionFailed } from './state'

let mainPort: MessagePort | null = null
export const sendPlayerRequest = (request: LX.MiniPlayer.Request) => {
  playerActionFailed.value = false
  mainPort?.postMessage(request)
}
export const initChannel = () => {
  listen(ipc.provide_main_window_channel, ({ event }) => {
    mainPort?.close()
    const [port] = event.ports
    mainPort = port
    port.onmessage = ({ data }: MessageEvent<LX.MiniPlayer.Message>) => {
      if (data.action === 'set_player_state') {
        if (data.data.id !== miniPlayer.id) miniPlayerCover.value = ''
        Object.assign(miniPlayer, data.data)
      } else if (data.action === 'set_player_cover') {
        if (data.data.id === miniPlayer.id) miniPlayerCover.value = data.data.url
      } else if (data.action === 'player_action_failed') playerActionFailed.value = true
    }
    sendPlayerRequest({ action: 'get_player_state' })
  })
}
