import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import { sendMiniPlayerInfo, setMiniPlayerActionHandler, initMiniPlayerChannel } from '@renderer/core/miniPlayer'
import { playNext, playPrev, togglePlay } from '@renderer/core/player'
import { musicInfo, playerCover, isPlay } from '@renderer/store/player/state'
import { playProgress } from '@renderer/store/player/playProgress'
import { volume, isMute } from '@renderer/store/player/volume'
import { appSetting } from '@renderer/store/setting'

export default () => {
  initMiniPlayerChannel()
  let coverGeneration = 0
  let cover = { id: null as string | null, url: '' }
  const sendState = () => {
    if (!appSetting['miniPlayer.enable']) return
    sendMiniPlayerInfo({
      action: 'set_player_state',
      data: {
        id: musicInfo.id,
        name: musicInfo.name,
        singer: musicInfo.singer,
        album: musicInfo.album,
        isPlay: isPlay.value,
        position: playProgress.nowPlayTime,
        duration: playProgress.maxPlayTime,
        volume: volume.value,
        isMute: isMute.value,
      },
    })
  }
  const sendCover = () => { sendMiniPlayerInfo({ action: 'set_player_cover', data: cover }) }

  watch([() => appSetting['miniPlayer.enable'], () => musicInfo.id, playerCover], async([enabled, id, src]) => {
    const generation = ++coverGeneration
    cover = { id, url: '' }
    if (!enabled) return
    sendState()
    sendCover()
    if (!src) return
    try {
      // Reuse the already cached cover and transfer pixels once; blob URLs belong to their renderer.
      const image = new Image()
      image.src = src
      await image.decode()
      if (generation !== coverGeneration) return
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight))
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
      cover = { id, url: canvas.toDataURL('image/webp', 0.9) }
      sendCover()
    } catch {
      // The player keeps its placeholder when no decodable cover is available.
    }
  }, { immediate: true })

  watch([
    () => appSetting['miniPlayer.enable'], () => musicInfo.id, () => musicInfo.name,
    () => musicInfo.singer, () => musicInfo.album, isPlay, volume, isMute,
    () => playProgress.nowPlayTime, () => playProgress.maxPlayTime,
  ], sendState)

  const handleAction = async(request: LX.MiniPlayer.Request) => {
    switch (request.action) {
      case 'get_player_state': sendState(); sendCover(); break
      case 'player_toggle_play': togglePlay(); break
      case 'player_prev': await playPrev(); break
      case 'player_next': await playNext(); break
      case 'player_seek':
        if (request.data.id === musicInfo.id && Number.isFinite(request.data.time) && playProgress.maxPlayTime > 0) {
          window.app_event.setProgress(Math.max(0, Math.min(playProgress.maxPlayTime, request.data.time)))
        }
        break
      case 'player_volume':
        if (Number.isFinite(request.data)) window.app_event.setVolume(Math.max(0, Math.min(1, request.data)))
        break
      case 'player_mute': window.app_event.setVolumeIsMute(!isMute.value); break
    }
  }
  setMiniPlayerActionHandler(request => {
    void handleAction(request).catch(() => { sendMiniPlayerInfo({ action: 'player_action_failed' }) })
  })
  onBeforeUnmount(() => {
    coverGeneration++
    setMiniPlayerActionHandler(null)
  })
}
