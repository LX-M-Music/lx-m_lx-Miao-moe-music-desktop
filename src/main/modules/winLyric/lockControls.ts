import { screen, type BrowserWindow } from 'electron'
import { isLinux } from '@common/utils'
import { MINI_PLAYER_UNLOCK_BUTTON, type MiniPlayerPointer } from '@common/miniPlayer'

export const createLockControls = (window: BrowserWindow, onPointerChange?: (point: MiniPlayerPointer) => void) => {
  let timer: NodeJS.Timeout | null = null
  let isOverUnlock = false
  let previousPoint: MiniPlayerPointer = null
  let previousWidth = 0
  let previousHeight = 0
  const needsPointerTracking = () => global.lx.appSetting['desktopLyric.isLock'] ||
    global.lx.appSetting['desktopLyric.autoHideControls'] || !global.lx.appSetting['desktopLyric.showPlayer'] ||
    global.lx.appSetting['desktopLyric.style.backgroundOpacity'] === 0

  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
  }
  const checkPointer = (force = false) => {
    if (window.isDestroyed()) {
      stop()
      return
    }
    const locked = global.lx.appSetting['desktopLyric.isLock']
    let overUnlock = false
    let relativePoint: MiniPlayerPointer = null
    let windowWidth = 0
    let windowHeight = 0
    if (needsPointerTracking()) {
      // Both screen coordinates and content bounds use DIP, including on scaled displays.
      const bounds = window.getContentBounds()
      const point = screen.getCursorScreenPoint()
      windowWidth = bounds.width
      windowHeight = bounds.height
      if (point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height) {
        relativePoint = { x: point.x - bounds.x, y: point.y - bounds.y }
      }
      if (locked) {
        const { top, right, width, height } = MINI_PLAYER_UNLOCK_BUTTON
        const x = bounds.x + bounds.width - right - width
        const y = bounds.y + top
        overUnlock = point.x >= x && point.x < x + width && point.y >= y && point.y < y + height
      }
    }
    if (force || relativePoint?.x !== previousPoint?.x || relativePoint?.y !== previousPoint?.y || windowWidth !== previousWidth || windowHeight !== previousHeight) {
      previousPoint = relativePoint
      previousWidth = windowWidth
      previousHeight = windowHeight
      // Fully transparent pixels may never deliver DOM hover events. Reveal the
      // controls from the system pointer before asking the user to click them.
      onPointerChange?.(relativePoint)
    }
    if (force || overUnlock !== isOverUnlock) {
      isOverUnlock = overUnlock
      // Keep lyrics click-through, but allow the recovery button to receive clicks.
      // Forward movement even with hover-hide disabled so the button can reveal itself.
      window.setIgnoreMouseEvents(locked && !overUnlock, { forward: !isLinux })
    }
  }
  const update = () => {
    stop()
    checkPointer(true)
    if (!window.isDestroyed() && needsPointerTracking()) {
      timer = setInterval(checkPointer, 100)
    }
  }

  window.once('closed', stop)
  return { update }
}
