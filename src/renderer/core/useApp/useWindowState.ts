import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import { type WindowState } from '@common/config'
import { isFullscreen, isMaximized, isWindowVisible, windowFontSize } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'
import { getWindowState, onWindowStateChanged } from '@renderer/utils/ipc'

export default () => {
  const updateLayout = () => {
    const root = document.documentElement
    const expanded = isFullscreen.value || isMaximized.value
    root.classList.toggle('fullscreen', isFullscreen.value)
    root.classList.toggle('maximized', isMaximized.value)
    root.classList.toggle('transparent', !window.dt && !expanded)
    root.classList.toggle('disableTransparent', window.dt && !expanded)

    // Keep the user's font choice independent of window size and state.
    windowFontSize.value = appSetting['common.fontSize']
    root.style.fontSize = `${windowFontSize.value}px`
    window.lx.rootOffset = parseFloat(getComputedStyle(root).paddingLeft) || 0
  }

  const updateState = (state: WindowState) => {
    isMaximized.value = state.isMaximized
    isFullscreen.value = state.isFullscreen
    isWindowVisible.value = state.isVisible !== false
  }
  let receivedState = false
  const stopWindowState = onWindowStateChanged(({ params }) => {
    receivedState = true
    updateState(params)
  })
  void getWindowState().then(state => {
    if (!receivedState) updateState(state)
  })

  watch([isFullscreen, isMaximized, () => appSetting['common.fontSize']], updateLayout, { immediate: true })
  window.addEventListener('resize', updateLayout)
  onBeforeUnmount(() => {
    stopWindowState()
    window.removeEventListener('resize', updateLayout)
  })
}
