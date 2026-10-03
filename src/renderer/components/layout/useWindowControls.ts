import { computed } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'

/**
 * 窗口控制按钮共享配置（主窗口侧栏 / 播放详情左、右标题栏通用）
 * - enabled: 关闭自定义风格时恢复主题默认按钮
 * - style: default 中性灰圆点 / traffic 红绿灯
 * - iconMode: always 图标常亮 / hover 悬停显示，两种风格均可选择
 */
export const useWindowControls = () => {
  const isCustomStyle = computed(() => appSetting['ui.windowControlsEnabled'])
  const isTrafficStyle = computed(() => isCustomStyle.value && appSetting['ui.windowControlStyle'] == 'traffic')
  const isIconAlways = computed(() => isCustomStyle.value && appSetting['ui.windowControlsIconMode'] == 'always')
  return { isCustomStyle, isTrafficStyle, isIconAlways }
}
