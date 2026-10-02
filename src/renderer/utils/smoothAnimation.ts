import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import { appSetting, isShowAnimation } from '@renderer/store/setting'
import { finishMotions, MOTION_DURATION, MOTION_EASING } from './motion'

/** One clock for CSS transitions, page motion and the player cover. */
export const useSmoothAnimation = () => {
  const root = document.documentElement
  const update = () => {
    const requestedSpeed = Number(appSetting['ui.animationSpeed'])
    const speed = Number.isFinite(requestedSpeed) ? Math.max(0.5, Math.min(1.5, requestedSpeed)) : 1
    const enabled = appSetting['ui.smoothAnimation'] && isShowAnimation.value && !appSetting['ui.lowPowerMode']
    root.dataset.motionEnabled = String(enabled)
    root.dataset.motionSpeed = String(speed)
    root.style.setProperty('--motion-speed', String(speed))
    root.style.setProperty('--ease-standard', MOTION_EASING)
    root.style.setProperty('--ease-emphasized', MOTION_EASING)
    for (const [name, duration] of Object.entries(MOTION_DURATION)) {
      // Keep an end event for existing Vue transitions when motion is off.
      root.style.setProperty(`--duration-${name}`, `${enabled ? duration / speed : 0.01}ms`)
    }
    finishMotions()
    window.dispatchEvent(new Event('lx-motion-change'))
  }
  // Only settings changes should finish motion; event listeners can read other refs.
  watch([
    () => appSetting['ui.animationSpeed'],
    () => appSetting['ui.smoothAnimation'],
    () => appSetting['ui.lowPowerMode'],
    isShowAnimation,
  ], update, { immediate: true })
  onBeforeUnmount(finishMotions)
}
