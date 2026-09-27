import { computed } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'

/**
 * 窗口控制按钮共享配置（主窗口侧栏 / 播放详情左、右标题栏通用）
 * - style: default 中性灰圆点 / traffic 红绿灯
 * - iconMode: always 图标常亮 / hover 悬停显示（traffic 红绿灯下图标强制常亮）
 */
export const useWindowControls = () => {
  const isTrafficStyle = computed(() => appSetting['ui.windowControlStyle'] == 'traffic')
  const isIconAlways = computed(() => isTrafficStyle.value || appSetting['ui.windowControlsIconMode'] == 'always')
  return { isTrafficStyle, isIconAlways }
}
