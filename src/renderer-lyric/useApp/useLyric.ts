import { watch } from '@common/utils/vueTools'
import { setLyric, setVertical, setPlaybackRate } from '@lyric/core/lyric'
import { getStatus } from '@lyric/core/mainWindowChannel'
import { isPlay, setting } from '@lyric/store/state'

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
  watch(() => setting['desktopLyric.direction'], direction => {
    setVertical(direction == 'vertical')
    getStatus()
  })
}
