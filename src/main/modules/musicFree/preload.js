import { contextBridge, ipcRenderer } from 'electron'
import { MUSIC_FREE_IPC as channels } from '@common/musicFree'

contextBridge.exposeInMainWorld('musicFreeBridge', {
  reply: packet => ipcRenderer.send(channels.reply, packet),
  request: packet => ipcRenderer.invoke(channels.network, packet),
  cancel: id => ipcRenderer.send(channels.cancelNetwork, id),
  listen: callback => { ipcRenderer.on(channels.command, (_event, packet) => callback(packet)) },
})
