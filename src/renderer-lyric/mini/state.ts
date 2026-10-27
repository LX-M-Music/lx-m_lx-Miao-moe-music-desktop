import { ref, shallowReactive } from '@common/utils/vueTools'
import type { MiniPlayerEdgeMotion, MiniPlayerPointer } from '@common/miniPlayer'
import { saveSetting } from './ipc'

export const setting = shallowReactive<LX.MiniPlayer.Config>({
  'miniPlayer.enable': false,
  'miniPlayer.showBorder': false,
  'miniPlayer.autoHideControls': false,
  'miniPlayer.isLock': false,
  'miniPlayer.isAlwaysOnTop': false,
  'miniPlayer.isAlwaysOnTopLoop': false,
  'miniPlayer.isShowTaskbar': false,
  'miniPlayer.fullscreenHide': true,
  'miniPlayer.width': 450,
  'miniPlayer.height': 240,
  'miniPlayer.x': null,
  'miniPlayer.y': null,
  'miniPlayer.isLockScreen': true,
  'miniPlayer.backgroundOpacity': 100,
  'common.langId': 'zh-cn',
  'ui.lowPowerMode': false,
})
export const miniPlayer = shallowReactive<LX.MiniPlayer.State>({
  id: null, name: '', singer: '', album: '', isPlay: false, position: 0, duration: 0, volume: 0, isMute: false,
})
export const miniPlayerCover = ref('')
export const nativePointer = ref<MiniPlayerPointer>(null)
export const edgeMotion = ref<MiniPlayerEdgeMotion>({ edge: null, phase: 'shown', duration: 0 })
export const playerActionFailed = ref(false)
export const updateSetting = async(config: Partial<LX.MiniPlayer.Config>) => {
  await saveSetting(config)
  Object.assign(setting, config)
}
