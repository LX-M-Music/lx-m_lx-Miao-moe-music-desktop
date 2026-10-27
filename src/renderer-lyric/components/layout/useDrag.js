import { ref, onMounted, onBeforeUnmount, watch } from '@common/utils/vueTools'
import { setWindowBounds, setWindowResizeable } from '@lyric/utils/ipc'
import { isWin } from '@common/utils'
import { setting } from '@lyric/store/state'

export default ({ onStart, onMove } = {}) => {
  const isMsDown = ref(false)
  let drag = null

  const endDrag = () => {
    const previous = drag
    drag = null
    isMsDown.value = false
    if (!previous) return
    if (previous.target.hasPointerCapture(previous.id)) previous.target.releasePointerCapture(previous.id)
    if (!previous.isLyric && isWin) setWindowResizeable(true)
  }
  const handleLyricPointerDown = event => {
    if (drag || event.button !== 0 || !event.isPrimary || setting['desktopLyric.isLock']) return
    // The toolbar only drags from its background; buttons keep their own input.
    if (!onStart && event.target !== event.currentTarget) return
    const isLyric = !!onStart && !!event.target.closest('.font-lrc, .extended')
    drag = {
      id: event.pointerId,
      target: event.currentTarget,
      isLyric,
      x: event.screenX,
      y: event.screenY,
      windowX: window.screenX,
      windowY: window.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      width: window.innerWidth,
      height: window.innerHeight,
    }
    isMsDown.value = isLyric
    event.currentTarget.setPointerCapture(event.pointerId)
    if (isLyric) onStart(event.clientX, event.clientY)
    else {
      // https://github.com/lyswhut/lx-music-desktop/issues/2244
      if (isWin) setWindowResizeable(false)
      event.preventDefault()
    }
  }
  const handlePointerMove = event => {
    if (!drag || drag.id !== event.pointerId) return
    if (setting['desktopLyric.isLock'] || (event.pointerType === 'mouse' && !event.buttons)) {
      endDrag()
      return
    }
    if (drag.isLyric) onMove(event.clientX, event.clientY)
    else {
      // Both the cursor and window origin are fixed in screen coordinates.
      // Absolute targets avoid client-coordinate feedback, queued deltas and
      // accumulated native DIP rounding at fractional display scales.
      if (event.screenX === drag.lastX && event.screenY === drag.lastY) return
      drag.lastX = event.screenX
      drag.lastY = event.screenY
      setWindowBounds({
        x: drag.windowX + event.screenX - drag.x,
        y: drag.windowY + event.screenY - drag.y,
        w: drag.width,
        h: drag.height,
        absolute: true,
      })
    }
  }
  const handlePointerUp = event => {
    if (drag?.id === event.pointerId) endDrag()
  }

  watch(() => setting['desktopLyric.isLock'], locked => { if (locked) endDrag() })
  onMounted(() => {
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('pointercancel', handlePointerUp)
    document.addEventListener('lostpointercapture', handlePointerUp)
    window.addEventListener('blur', endDrag)
  })
  onBeforeUnmount(() => {
    endDrag()
    document.removeEventListener('pointermove', handlePointerMove)
    document.removeEventListener('pointerup', handlePointerUp)
    document.removeEventListener('pointercancel', handlePointerUp)
    document.removeEventListener('lostpointercapture', handlePointerUp)
    window.removeEventListener('blur', endDrag)
  })

  return { isMsDown, handleLyricPointerDown }
}
