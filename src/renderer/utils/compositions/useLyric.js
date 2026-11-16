import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from '@common/utils/vueTools'
import { formatPlayTime2 } from '@common/utils/common'
import { isMotionEnabled, scrollWithSpring } from '@renderer/utils/motion'
import { play } from '@renderer/core/player/action'
import { appSetting } from '@renderer/store/setting'

export default ({ isPlay, lyric, playProgress, musicInfo, isShowLyricProgressSetting }) => {
  const dom_lyric = ref(null)
  const dom_lyric_text = ref(null)
  const isMsDown = ref(false)
  const isStopScroll = ref(false)
  const seekTime = ref(null)
  // Row under the guide; the jump centres this row instead of the playing one.
  const seekLine = ref(null)
  const timeStr = computed(() => seekTime.value == null ? '--:--' : formatPlayTime2(seekTime.value))
  const canSeek = computed(() => seekTime.value != null)

  let msDownY = 0
  let msDownScrollY = 0
  let timeout = null
  let cancelScrollFn
  let dom_lines
  let isSetedLines = false
  let isSkipMouseEnter = false
  let isSkipFocused = false
  let seekFrame = null
  let resizeObserver
  let delayScrollTimeout
  // Row a jump is settling on; see handleScrollLrc.
  let jumpIndex = null
  let jumpAt = 0
  const JUMP_GUARD_MS = 600

  const handleSkipPlay = () => {
    // Recalculate on click as scrolling, resizing or lyric offsets may have changed.
    updateSeekTime()
    const time = seekTime.value
    // The row the guide sits on, not the row that is still playing: the store only
    // follows the seek on the next progress tick, and scrolling to the old row first
    // made the sheet jump back before it caught up.
    const index = seekLine.value
    if (time == null) return
    resetManualScroll()
    if (index != null) {
      jumpIndex = index
      jumpAt = performance.now()
    }
    window.app_event.setProgress(time)
    if (!isPlay.value) play()
    nextTick(() => handleScrollLrc(undefined, true, index == null ? undefined : index))
  }
  const handleSkipMouseEnter = () => {
    isSkipMouseEnter = true
    clearLyricScrollTimeout()
  }
  const handleSkipMouseLeave = () => {
    isSkipMouseEnter = false
    startLyricScrollTimeout()
  }
  const handleSkipFocus = () => {
    isSkipFocused = true
    clearLyricScrollTimeout()
  }
  const handleSkipBlur = () => {
    isSkipFocused = false
    startLyricScrollTimeout()
  }

  const updateSeekTime = () => {
    const container = dom_lyric.value
    if (!isShowLyricProgressSetting.value || !isStopScroll.value || !musicInfo.id || !container || !dom_lines?.length || !lyric.lines.length) {
      seekTime.value = null
      seekLine.value = null
      return
    }
    const rect = container.getBoundingClientRect()
    if (!rect.height) {
      seekTime.value = null
      seekLine.value = null
      return
    }
    const center = rect.top + rect.height / 2
    // Use complete row bounds, including wrapped lines and translations. Hit testing
    // the left edge can land on blank space and incorrectly select the last lyric.
    let low = 0
    let high = Math.min(dom_lines.length, lyric.lines.length) - 1
    while (low < high) {
      const mid = (low + high) >> 1
      if (dom_lines[mid].getBoundingClientRect().bottom <= center) low = mid + 1
      else high = mid
    }
    const lineTime = lyric.lines[low].time
    if (!Number.isFinite(lineTime)) {
      seekTime.value = null
      seekLine.value = null
      return
    }
    const time = Math.max((lineTime - lyric.offset - lyric.tempOffset) / 1000, 0)
    const duration = playProgress.maxPlayTime
    seekTime.value = duration > 0 && Number.isFinite(duration) ? Math.min(time, duration) : time
    seekLine.value = low
  }
  const setTime = () => {
    if (!isStopScroll.value) return
    if (seekFrame != null) return
    seekFrame = window.requestAnimationFrame(() => {
      seekFrame = null
      updateSeekTime()
    })
  }
  const cancelAutoScroll = () => {
    cancelScrollFn?.()
    cancelScrollFn = null
    clearTimeout(delayScrollTimeout)
    delayScrollTimeout = null
  }
  const resetManualScroll = () => {
    clearLyricScrollTimeout()
    isStopScroll.value = false
    isMsDown.value = false
    isSkipMouseEnter = false
    isSkipFocused = false
    seekTime.value = null
    seekLine.value = null
    jumpIndex = null
    if (seekFrame != null) window.cancelAnimationFrame(seekFrame)
    seekFrame = null
  }

  // `index` lets a jump centre the row the guide was over before the store catches
  // up with the seek; everything else follows the playing line. While a jump is
  // still settling the engine keeps reporting the line that was playing, and a
  // reflow in that window used to start a scroll to it, so every scroll keeps
  // aiming at the jump row until the engine agrees.
  const handleScrollLrc = (duration = 300, seeking = false, index) => {
    if (!dom_lines?.length || !dom_lyric.value?.clientHeight) return
    if (isSkipMouseEnter || isSkipFocused) return
    if (isStopScroll.value) return
    let focusLine = index ?? lyric.line
    if (index == null && jumpIndex != null) {
      if (lyric.line === jumpIndex || performance.now() - jumpAt > JUMP_GUARD_MS) jumpIndex = null
      else focusLine = jumpIndex
    }
    const lineIndex = Math.max(0, Math.min(dom_lines.length - 1, focusLine))
    const dom_p = dom_lines[lineIndex]
    cancelScrollFn?.()
    // Center the complete lyric group, including wrapped translations/romaji.
    // Scaling around the row's center keeps this anchor stable during zoom.
    const target = dom_p ? dom_p.offsetTop + dom_p.offsetHeight / 2 - dom_lyric.value.clientHeight / 2 : 0
    if (!duration || !isMotionEnabled()) {
      dom_lyric.value.scrollTop = target
      cancelScrollFn = null
      return
    }
    // Dense lyrics get a stiffer spring than sparse ones, so fast songs and
    // ballads both settle at the right pace.
    const currentLine = lyric.lines[lineIndex]
    const previousLine = lyric.lines[lineIndex - 1]
    const interval = currentLine && previousLine ? currentLine.time - previousLine.time : undefined
    cancelScrollFn = scrollWithSpring(dom_lyric.value, target, { interval, seeking })
  }
  const clearLyricScrollTimeout = () => {
    if (!timeout) return
    clearTimeout(timeout)
    timeout = null
  }
  const startLyricScrollTimeout = () => {
    clearLyricScrollTimeout()
    if (isSkipMouseEnter || isSkipFocused || isMsDown.value || !isStopScroll.value) return
    timeout = setTimeout(() => {
      timeout = null
      resetManualScroll()
      if (!isPlay.value) return
      handleScrollLrc()
    }, 3000)
  }
  const handleLyricDown = (y) => {
    if (!dom_lyric.value) return
    cancelAutoScroll()
    clearLyricScrollTimeout()
    isMsDown.value = true
    msDownY = y
    msDownScrollY = dom_lyric.value.scrollTop
  }
  const handleLyricMouseDown = event => {
    if (event.button !== 0) return
    handleLyricDown(event.clientY)
  }
  const handleLyricTouchStart = event => {
    if (event.changedTouches.length) {
      const touch = event.changedTouches[0]
      handleLyricDown(touch.clientY)
    }
  }
  const handleMouseMsUp = () => {
    if (!isMsDown.value) return
    isMsDown.value = false
    startLyricScrollTimeout()
  }
  const handleMove = (y) => {
    if (isMsDown.value) {
      isStopScroll.value ||= true
      cancelAutoScroll()
      dom_lyric.value.scrollTop = msDownScrollY + msDownY - y
      startLyricScrollTimeout()
      setTime()
    }
  }
  const handleMouseMsMove = event => {
    handleMove(event.clientY)
  }
  const handleTouchMove = (e) => {
    if (e.changedTouches.length) {
      const touch = e.changedTouches[0]
      handleMove(touch.clientY)
    }
  }

  const handleWheel = (event) => {
    if (!dom_lyric.value || !event.deltaY || event.ctrlKey) return
    event.preventDefault()
    isStopScroll.value ||= true
    cancelAutoScroll()
    const unit = event.deltaMode === 1 ? parseFloat(window.getComputedStyle(dom_lyric.value).fontSize) : event.deltaMode === 2 ? dom_lyric.value.clientHeight : 1
    dom_lyric.value.scrollTop += event.deltaY * unit
    startLyricScrollTimeout()
    setTime()
  }

  const setLyric = (lines) => {
    if (!dom_lyric.value || !dom_lyric_text.value) return
    const currentLine = lyric.line
    const previousLine = dom_lines?.[currentLine]
    const lineOffset = previousLine && dom_lyric.value && previousLine.time == lines[currentLine]?.time
      ? previousLine.offsetTop - dom_lyric.value.scrollTop
      : null
    if (cancelScrollFn) {
      cancelScrollFn()
      cancelScrollFn = null
    }
    const dom_line_content = document.createDocumentFragment()
    for (const line of lines) {
      dom_line_content.appendChild(line.dom_line)
    }
    dom_lyric_text.value.textContent = ''
    dom_lyric_text.value.appendChild(dom_line_content)
    nextTick(() => {
      if (!dom_lyric.value) return
      dom_lines = dom_lyric.value.querySelectorAll('.line-content')
      const currentLineDom = dom_lines[currentLine]
      if (lineOffset != null && currentLineDom && isStopScroll.value) {
        dom_lyric.value.scrollTop = currentLineDom.offsetTop - lineOffset
      } else {
        handleScrollLrc(undefined, true)
      }
      isSetedLines = false
      setTime()
    })
  }

  const initLrc = (lines) => {
    isSetedLines = true
    seekTime.value = null
    if (!lines.length) {
      cancelAutoScroll()
      resetManualScroll()
      if (dom_lyric.value) dom_lyric.value.scrollTop = 0
    }
    // Clear old rows immediately: a new wheel/drag can cancel a scroll animation.
    setLyric(lines)
  }

  const scrollLine = (line, oldLine) => {
    clearTimeout(delayScrollTimeout)
    delayScrollTimeout = null
    if (line < 0) return
    if (isSetedLines) return
    if (oldLine == null || line - oldLine != 1) return handleScrollLrc()

    // Enlarging the next lyric and moving it up must begin together.
    if (appSetting['playDetail.isDelayScroll'] && !appSetting['playDetail.isZoomActiveLrc']) {
      delayScrollTimeout = setTimeout(() => {
        delayScrollTimeout = null
        handleScrollLrc(600)
      }, 600)
    } else {
      handleScrollLrc()
    }
  }

  watch(() => lyric.lines, initLrc)
  watch(() => lyric.line, scrollLine)
  watch(() => musicInfo.id, () => {
    cancelAutoScroll()
    resetManualScroll()
  })
  watch(isShowLyricProgressSetting, enabled => {
    if (!enabled) resetManualScroll()
  })
  watch(() => [lyric.offset, lyric.tempOffset, playProgress.maxPlayTime], setTime)

  onMounted(() => {
    document.addEventListener('mousemove', handleMouseMsMove)
    document.addEventListener('mouseup', handleMouseMsUp)
    document.addEventListener('touchmove', handleTouchMove)
    document.addEventListener('touchend', handleMouseMsUp)
    document.addEventListener('touchcancel', handleMouseMsUp)
    dom_lyric.value.addEventListener('scroll', setTime, { passive: true })
    resizeObserver = new window.ResizeObserver(() => {
      setTime()
      // Reflow can change both the viewport and the active row's height.
      // Manual lyric browsing remains suspended in handleScrollLrc.
      handleScrollLrc(0)
    })
    resizeObserver.observe(dom_lyric.value)
    resizeObserver.observe(dom_lyric_text.value)

    initLrc(lyric.lines)
  })

  onBeforeUnmount(() => {
    cancelAutoScroll()
    resetManualScroll()
    resizeObserver?.disconnect()
    dom_lyric.value?.removeEventListener('scroll', setTime)
    document.removeEventListener('mousemove', handleMouseMsMove)
    document.removeEventListener('mouseup', handleMouseMsUp)
    document.removeEventListener('touchmove', handleTouchMove)
    document.removeEventListener('touchend', handleMouseMsUp)
    document.removeEventListener('touchcancel', handleMouseMsUp)
  })

  return {
    dom_lyric,
    dom_lyric_text,
    isStopScroll,
    isMsDown,
    timeStr,
    canSeek,
    handleLyricMouseDown,
    handleLyricTouchStart,
    handleWheel,
    handleSkipPlay,
    handleSkipMouseEnter,
    handleSkipMouseLeave,
    handleSkipFocus,
    handleSkipBlur,
    handleScrollLrc,
  }
}
