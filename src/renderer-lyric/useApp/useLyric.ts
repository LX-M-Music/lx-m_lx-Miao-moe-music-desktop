import { watch } from '@common/utils/vueTools'
import { setLyric, setVertical, setPlaybackRate } from '@lyric/core/lyric'
import { getStatus } from '@lyric/core/mainWindowChannel'
import { isPlay, miniPlayer, setting } from '@lyric/store/state'

export default () => {
  const handleLyricSettingChanged = () => {
    setLyric()
    getStatus()
  }
  watch(() => setting['player.isShowLyricTranslation'], handleLyricSettingChanged)
  watch(() => setting['player.isShowLyricRoma'], handleLyricSettingChanged)
  watch(() => setting['player.isSwapLyricTranslationAndRoma'], handleLyricSettingChanged)
  watch(() => setting['player.isPlayLxlrc'], handleLyricSettingChanged)
  watch(() => setting['player.playbackRate'], (rate) => {
    setPlaybackRate(rate)
    if (isPlay.value) {
      setTimeout(() => {
        getStatus()
      })
    }
  })
  watch([
    () => !setting['desktopLyric.singleLine'] && setting['desktopLyric.direction'] == 'vertical',
    () => setting['desktopLyric.singleLine'],
  ], ([isVertical], [wasVertical]) => {
    if (isVertical !== wasVertical) setVertical(isVertical)
    getStatus()
  })
  // A paused seek changes the player snapshot without emitting a play event.
  // Request its authoritative position once for the single current row.
  watch(() => miniPlayer.position, () => {
    if (setting['desktopLyric.singleLine'] && !miniPlayer.isPlay) getStatus()
  })
}
