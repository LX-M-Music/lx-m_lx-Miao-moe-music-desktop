import { formatError } from '@common/utils/errorMessage'
import { reactive, computed } from '@common/utils/vueTools'
import defaultSetting from '@common/defaultSetting'
import { updateSetting as saveSetting } from '@renderer/utils/ipc'
import { dialog } from '@renderer/plugins/Dialog'

export const appSetting = window.lxData.appSetting = reactive<LX.AppSetting>({ ...defaultSetting })

export const isShowAnimation = computed(() => {
  return appSetting['common.isShowAnimation']
})


export const initSetting = (newSetting: LX.AppSetting) => {
  mergeSetting(newSetting)
}

export const mergeSetting = (newSetting: Partial<LX.AppSetting>) => {
  for (const [key, value] of Object.entries(newSetting)) {
    // @ts-expect-error
    appSetting[key] = value
  }
  if (newSetting['common.showErrorDialog'] === false) globalThis.document?.querySelector('[data-app-load-error]')?.remove()
}

// Keep the original promise so fire-and-forget callers use the rejection handler attached below.
// eslint-disable-next-line @typescript-eslint/promise-function-async
export const updateSetting = window.lxData.updateSetting = (setting: Partial<LX.AppSetting>) => {
  const task = saveSetting(setting)
  void task.catch(error => { void dialog.error({ message: formatError(error, window.i18n.t('setting__backup_config_failed'), 'CONFIG_SAVE_FAILED') }) })
  return task
}

/**
 * 保存是否同意协议
 * @param isAgreePact 是否同意协议
 */
export const saveAgreePact = (isAgreePact: boolean) => {
  void updateSetting({ 'common.isAgreePact': isAgreePact })
}

/**
 * 保存音频输出id
 * @param id 媒体驱动id
 */
export const saveMediaDeviceId = (id: string) => {
  void updateSetting({ 'player.mediaDeviceId': id })
}

/**
 * 保存音量大小
 * @param volume 音量
 */
export const saveVolume = (volume: number) => {
  void updateSetting({ 'player.volume': volume })
}

/**
 * 设置是否静音
 * @param isMute 是否静音
 */
export const saveVolumeIsMute = (isMute: boolean) => {
  void updateSetting({ 'player.isMute': isMute })
}

/**
 * 设置播放速率
 * @param rate 播放速率
 */
export const savePlaybackRate = (rate: number) => {
  void updateSetting({ 'player.playbackRate': rate })
}


/**
 * 设置是否开启桌面歌词
 * @param enabled
 */
export const setVisibleDesktopLyric = (enabled: boolean) => {
  void updateSetting({ 'desktopLyric.enable': enabled })
}

/**
 * 设置是否锁定桌面歌词
 * @param isLock
 */
export const setLockDesktopLyric = (isLock: boolean) => {
  void updateSetting({ 'desktopLyric.isLock': isLock })
}

/**
 * 设置切歌模式
 * @param mode
 */
export const setTogglePlayMode = (mode: LX.AppSetting['player.togglePlayMethod']) => {
  void updateSetting({ 'player.togglePlayMethod': mode })
}

/**
 * 设置API id
 * @param sourceId
 */
export const setApiSource = (sourceId: string) => {
  void updateSetting({ 'common.apiSource': sourceId })
}

/**
 * 设置播放详情页歌词字体大小
 * @param size 字体大小
 */
export const setPlayDetailLyricFont = (size: number) => {
  void updateSetting({ 'playDetail.style.fontSize': size })
}

/**
 * 设置播放详情页歌词对齐方式
 * @param align 对齐方式
 */
export const setPlayDetailLyricAlign = (align: LX.AppSetting['playDetail.style.align']) => {
  void updateSetting({ 'playDetail.style.align': align })
}

/**
 * 设置播放详情页音频可视化
 * @param enable 是否启用
 */
export const setEnableAudioVisualization = (enable: boolean) => {
  void updateSetting({ 'player.audioVisualization': enable })
}
