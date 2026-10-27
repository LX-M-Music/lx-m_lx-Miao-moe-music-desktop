import { ref, onMounted, onBeforeUnmount, watch, nextTick } from '@common/utils/vueTools'
import { scrollXRTo } from '@common/utils/renderer'
import { lyric } from '@lyric/store/lyric'
import { isPlay, setting } from '@lyric/store/state'
import useDrag from '../useDrag'

const getOffsetTop = (contentWidth, lineWidth) => {
  switch (setting['desktopLyric.scrollAlign']) {
    case 'top': return contentWidth - lineWidth - 2
    default: return contentWidth * 0.5 - lineWidth / 2
  }
}

export default (isComputeWidth) => {
  const dom_lyric = ref(null)
  const dom_lyric_text = ref(null)
  let isStopScroll = false

  let msDownX = 0
  let msDownScrollX = 0
  let timeout = null
  let cancelScrollFn
  let dom_lines
  let line_widths
  let isSetedLines = false
  let prevActiveLine = 0


  const handleScrollLrc = (duration = 300) => {
    if (!dom_lines?.length || !dom_lyric.value) return
    if (setting['desktopLyric.isSingleLine']) {
      dom_lyric.value.scrollLeft = 0
      return
    }
    if (isStopScroll) return
    let dom_p = dom_lines[lyric.line]

    if (dom_p) {
      let offset = 0
      if (isComputeWidth.value) {
        let prevLineWidth = line_widths[prevActiveLine] ?? 0
        offset = prevActiveLine < lyric.line ? ((dom_lines[prevActiveLine]?.clientWidth ?? 0) - prevLineWidth) : 0
        // console.log(prevActiveLine, dom_lines[prevActiveLine]?.clientHeight ?? 0, prevLineWidth, offset)
      }
      cancelScrollFn = scrollXRTo(dom_lyric.value, dom_p ? (dom_p.offsetLeft + offset - getOffsetTop(dom_lyric.value.clientWidth, dom_p.clientWidth)) : 0, duration)
    } else {
      cancelScrollFn = scrollXRTo(dom_lyric.value, 0, duration)
    }
  }
  const clearLyricScrollTimeout = () => {
    if (!timeout) return
    clearTimeout(timeout)
    timeout = null
  }
  const startLyricScrollTimeout = () => {
    clearLyricScrollTimeout()
    timeout = setTimeout(() => {
      timeout = null
      isStopScroll = false
      if (!isPlay.value) return
      handleScrollLrc()
    }, 3000)
  }

  const { isMsDown, handleLyricPointerDown } = useDrag({
    onStart: (x, y) => {
      if (delayScrollTimeout) {
        clearTimeout(delayScrollTimeout)
        delayScrollTimeout = null
      }
      msDownX = x
      msDownScrollX = dom_lyric.value.scrollLeft
    },
    onMove: (x, y) => {
      if (setting['desktopLyric.isSingleLine']) return
      isStopScroll ||= true
      if (cancelScrollFn) {
        cancelScrollFn()
        cancelScrollFn = null
      }
      dom_lyric.value.scrollLeft = msDownScrollX + msDownX - x
      startLyricScrollTimeout()
    },
  })

  const handleWheel = (event) => {
    if (setting['desktopLyric.isSingleLine']) return
    console.log(event.deltaY)
    if (cancelScrollFn) {
      cancelScrollFn()
      cancelScrollFn = null
    }
    dom_lyric.value.scrollLeft = dom_lyric.value.scrollLeft - event.deltaY
    startLyricScrollTimeout()
  }

  const setLyric = (lines) => {
    const dom_line_content = document.createDocumentFragment()
    // Move the engine's original node, keeping per-word progress and extended rows.
    const current = Math.max(0, Math.min(lyric.line, lines.length - 1))
    const visible = setting['desktopLyric.isSingleLine'] ? lines.slice(current, current + 1) : lines
    for (const line of visible) {
      dom_line_content.appendChild(line.dom_line)
    }
    dom_lyric_text.value.textContent = ''
    dom_lyric_text.value.appendChild(dom_line_content)
    nextTick(() => {
      if (!dom_lyric.value) return
      dom_lines = dom_lyric.value.querySelectorAll('.line-content')
      line_widths = Array.from(dom_lines).map(l => l.clientWidth)
      handleScrollLrc()
    })
  }

  const initLrc = (lines, oLines) => {
    prevActiveLine = 0
    isSetedLines = true
    if (oLines) {
      if (lines.length) {
        setLyric(lines)
      } else {
        cancelScrollFn = scrollXRTo(dom_lyric.value, 0, 300, () => {
          if (lyric.lines !== lines) return
          setLyric(lines)
        }, 50)
      }
    } else {
      setLyric(lines)
    }
  }

  let delayScrollTimeout
  const scrollLine = (line, oldLine) => {
    if (setting['desktopLyric.isSingleLine']) {
      setLyric(lyric.lines)
      return
    }
    setImmediate(() => {
      prevActiveLine = line
    })
    if (line < 0) return
    if (line == 0 && isSetedLines) return isSetedLines = false
    isSetedLines &&= false
    if (oldLine == null || line - oldLine != 1) return handleScrollLrc()

    if (setting['desktopLyric.isDelayScroll']) {
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
  watch(() => setting['desktopLyric.isSingleLine'], () => {
    clearLyricScrollTimeout()
    if (delayScrollTimeout) {
      clearTimeout(delayScrollTimeout)
      delayScrollTimeout = null
    }
    if (cancelScrollFn) {
      cancelScrollFn()
      cancelScrollFn = null
    }
    isStopScroll = false
    setLyric(lyric.lines)
  })

  onMounted(() => {
    initLrc(lyric.lines, null)
  })

  onBeforeUnmount(() => {
    clearLyricScrollTimeout()
    if (delayScrollTimeout) clearTimeout(delayScrollTimeout)
    if (cancelScrollFn) cancelScrollFn()
  })

  return {
    dom_lyric,
    dom_lyric_text,
    isMsDown,
    handleLyricPointerDown,
    handleWheel,
  }
}
