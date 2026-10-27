import { onNewMiniPlayerProcess } from '@renderer/utils/ipc'
let port: MessagePort | null = null
let actionHandler: ((request: LX.MiniPlayer.Request) => void) | null = null
export const sendMiniPlayerInfo = (info: LX.MiniPlayer.Message) => { port?.postMessage(info) }
export const setMiniPlayerActionHandler = (handler: typeof actionHandler) => { actionHandler = handler }
export const initMiniPlayerChannel = () => {
  onNewMiniPlayerProcess(({ event }) => {
    port?.close()
    port = event.ports[0]
    port.onmessage = ({ data }: MessageEvent<LX.MiniPlayer.Request>) => { actionHandler?.(data) }
  })
}
