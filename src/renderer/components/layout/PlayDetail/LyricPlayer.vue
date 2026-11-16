<template>
  <div :class="['right', $style.right]" :style="lrcFontSize">
    <transition enter-active-class="animated fadeIn" leave-active-class="animated fadeOut">
      <div
        v-show="!isShowLrcSelectContent"
        ref="dom_lyric"
        :class="['lyric', $style.lyric, { [$style.draging]: isMsDown }, { [$style.lrcActiveZoom]: isZoomActiveLrc }, { [$style.focusGradient]: isFocusGradient }]" :style="lrcStyles"
        @wheel="handleWheel" @mousedown="handleLyricMouseDown" @touchstart="handleLyricTouchStart"
        @contextmenu.stop="handleShowLyricMenu"
      >
        <div :class="['pre', $style.lyricSpace]" />
        <div ref="dom_lyric_text" />
        <div :class="$style.lyricSpace" />
      </div>
    </transition>
    <transition enter-active-class="animated fadeIn" leave-active-class="animated fadeOut">
      <div v-if="isShowLyricProgressSetting" v-show="isStopScroll && canSeek" :class="$style.skip" data-lyric-seek-guide>
        <div :class="$style.line" aria-hidden="true" />
        <span :class="$style.label">{{ timeStr }}</span>
        <base-btn
          type="button" :class="$style.skipBtn" :disabled="!canSeek"
          :aria-label="$t('player__lyric_seek_time', { time: timeStr })" :title="$t('player__lyric_seek_time', { time: timeStr })"
          @mouseenter="handleSkipMouseEnter" @mouseleave="handleSkipMouseLeave" @focus="handleSkipFocus" @blur="handleSkipBlur"
          @click.stop="handleSkipPlay" @keydown.stop @keyup.stop
        >
          <svg aria-hidden="true" viewBox="0 0 1024 1024" width="12" height="12">
            <use xlink:href="#icon-play" />
          </svg>
          {{ $t('player__lyric_seek') }}
        </base-btn>
      </div>
    </transition>
    <transition enter-active-class="animated fadeIn" leave-active-class="animated fadeOut">
      <div v-if="isShowLrcSelectContent" ref="dom_lrc_select_content" tabindex="-1" :class="[$style.lyricSelectContent, 'select', 'scroll', 'lyricSelectContent']" @contextmenu="handleCopySelectText">
        <div v-for="(info, index) in lyric.lines" :key="index" :class="[$style.lyricSelectline, { [$style.lrcActive]: lyric.line == index }]">
          <span>{{ info.text }}</span>
          <template v-for="(lrc, i) in info.extendedLyrics" :key="i">
            <br>
            <span :class="$style.lyricSelectlineExtended">{{ lrc }}</span>
          </template>
        </div>
      </div>
    </transition>
    <LyricMenu v-model="lyricMenuVisible" :xy="lyricMenuXY" :lyric-info="lyricInfo" @update-lyric="handleUpdateLyric" />
  </div>
</template>

<script>
import { clipboardWriteText } from '@common/utils/electron'
import { lyric } from '@renderer/store/player/lyric'
import { playProgress } from '@renderer/store/player/playProgress'
import { isFullscreen } from '@renderer/store'
import {
  isPlay,
  isShowPlayerDetail,
  isShowLrcSelectContent,
  isShowPlayComment,
  musicInfo as playerMusicInfo,
  playMusicInfo,
} from '@renderer/store/player/state'
import {
  setMusicInfo,
} from '@renderer/store/player/action'
import { onMounted, onBeforeUnmount, computed, reactive, ref, nextTick, watch } from '@common/utils/vueTools'
import useLyric from '@renderer/utils/compositions/useLyric'
import LyricMenu from './components/LyricMenu.vue'
import { appSetting } from '@renderer/store/setting'
import { setLyricOffset } from '@renderer/core/lyric'
import useSelectAllLrc from './useSelectAllLrc'

export default {
  components: {
    LyricMenu,
  },
  setup() {
    const isZoomActiveLrc = computed(() => appSetting['playDetail.isZoomActiveLrc'])
    // The focus gradient belongs to the adaptive background; with it off the
    // lyric sheet keeps the stock uniform look.
    const isFocusGradient = computed(() => !!appSetting['ui.ambientBackground'])
    const isShowLyricProgressSetting = computed(() => appSetting['playDetail.isShowLyricProgressSetting'] && isShowPlayerDetail.value && !isShowLrcSelectContent.value)

    const {
      dom_lyric,
      dom_lyric_text,
      isMsDown,
      isStopScroll,
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
    } = useLyric({ isPlay, lyric, playProgress, musicInfo: playerMusicInfo, isShowLyricProgressSetting })

    const dom_lrc_select_content = useSelectAllLrc()

    // Rows are indexed against the active line so this works for both line-level
    // and word-level lyrics instead of relying on the transient `.played` class
    // the font player puts on the row that just finished. Passed rows dim but
    // stay readable; upcoming rows dim more and brighten as they move into focus.
    let cachedRows = []
    let revealRow = null
    const markFocusRows = () => {
      const container = dom_lyric.value
      if (!container) return
      cachedRows = [...container.querySelectorAll('.line-content')]
      const current = lyric.line
      const enabled = isFocusGradient.value
      cachedRows.forEach((row, index) => {
        const passed = enabled && current >= 0 && index < current
        const upcoming = enabled && current >= 0 && index > current
        row.classList.toggle('isPassed', passed)
        row.classList.toggle('isUpcoming', upcoming)
        if (passed || upcoming) row.dataset.lyricDistance = String(Math.min(Math.abs(index - current), 3))
        else delete row.dataset.lyricDistance
        // Lines behind the playhead were sung completely, so their translation keeps
        // the full tone its finished karaoke ended on.
        if (passed) row.style.setProperty('--lyric-reveal', '1')
        else row.style.removeProperty('--lyric-reveal')
      })
      revealRow = null
    }
    watch([
      () => lyric.line,
      () => lyric.lines,
      isFocusGradient,
    ], () => {
      void nextTick(markFocusRows)
    }, { flush: 'post' })

    // Word-level lyrics publish how much of the line has been sung: the translation
    // and romanization below it are wiped in with that share.
    const parseTimestamp = label => {
      const [whole, fraction = ''] = label.split('.')
      const seconds = whole.split(':').reduce((total, part) => total * 60 + Number(part), 0)
      return seconds * 1000 + Number(fraction.padEnd(3, '0'))
    }
    const karaokeLines = computed(() => {
      const map = new Map()
      for (const row of String(playerMusicInfo.lxlrc ?? '').split('\n')) {
        const match = /^\[([^\]]+)\](.*)$/.exec(row.trimEnd())
        if (!match) continue
        const marks = [...match[2].matchAll(/<(\d+),(\d+)>/g)]
        if (!marks.length) continue
        const words = []
        let chars = 0
        marks.forEach((mark, index) => {
          const text = match[2].slice(mark.index + mark[0].length, marks[index + 1]?.index ?? match[2].length)
          const length = [...text].length
          if (!length) return
          words.push({
            start: Number(mark[1]),
            duration: Math.max(1, Number(mark[2])),
            length,
          })
          chars += length
        })
        if (!words.length) continue
        map.set(parseTimestamp(match[1]), { words, chars })
      }
      return map
    })
    // The translation and romanization sweep in with the karaoke. The playback tick
    // only arrives a few times a second, which left the wipe a quarter of a second
    // behind the sung characters, so the sweep runs on an animation frame between
    // ticks: the last tick anchors the clock and each frame extends it, keeping the
    // error at one tick at most and starting over on every seek or pause.
    let revealFrame = null
    let revealBase = 0
    let revealTickAt = 0
    // A stalled stream stops the ticks while playback still looks active; capping the
    // extension keeps the wipe from running away from the audio.
    const REVEAL_LEAD_MAX = 320

    const writeReveal = () => {
      const line = lyric.lines[lyric.line]
      const timing = line ? karaokeLines.value.get(line.time) : null
      const row = cachedRows[lyric.line]
      if (!isFocusGradient.value || !timing || !row) {
        if (revealRow) revealRow.style.removeProperty('--lyric-reveal')
        revealRow = null
        return
      }
      const offset = (lyric.offset || 0) + (lyric.tempOffset || 0)
      const lead = isPlay.value ? Math.min(performance.now() - revealTickAt, REVEAL_LEAD_MAX) : 0
      const now = revealBase + lead + offset
      // Characters are weighted the same way the karaoke spans cover them, so the
      // sweep keeps pace with the sung share of the line.
      let revealed = 0
      for (const word of timing.words) {
        const sung = (now - (line.time + word.start)) / word.duration
        if (sung > 0) revealed += word.length * Math.min(1, sung)
      }
      if (revealRow && revealRow !== row) revealRow.style.removeProperty('--lyric-reveal')
      revealRow = row
      row.style.setProperty('--lyric-reveal', String(revealed / timing.chars))
    }
    const stepReveal = () => {
      writeReveal()
      revealFrame = window.requestAnimationFrame(stepReveal)
    }
    const startReveal = () => {
      if (revealFrame != null) return
      // Playback resumes from the last known position, so the clock restarts here
      // instead of trusting a tick stamp that may be seconds old.
      revealTickAt = performance.now()
      revealFrame = window.requestAnimationFrame(stepReveal)
    }
    const stopReveal = () => {
      if (revealFrame == null) return
      window.cancelAnimationFrame(revealFrame)
      revealFrame = null
    }
    // Only animate while something is actually moving; a paused sheet keeps the
    // value the last frame wrote and stays off the frame loop.
    const syncRevealLoop = () => {
      if (isPlay.value && isFocusGradient.value) {
        startReveal()
        return
      }
      stopReveal()
      writeReveal()
    }
    watch(() => playProgress.nowPlayTime, () => {
      revealBase = playProgress.nowPlayTime * 1000
      revealTickAt = performance.now()
      writeReveal()
    })
    watch([isPlay, isFocusGradient], syncRevealLoop)
    watch([
      () => lyric.line,
      () => lyric.lines,
      isFocusGradient,
      karaokeLines,
    ], () => {
      void nextTick(() => {
        markFocusRows()
        writeReveal()
        syncRevealLoop()
      })
    }, { flush: 'post' })

    watch([isFullscreen, isShowPlayComment], () => {
      setTimeout(handleScrollLrc, 400)
    })

    const lyricMenuVisible = ref(false)
    const lyricMenuXY = reactive({
      x: 0,
      y: 0,
    })
    const lyricInfo = reactive({
      lyric: '',
      tlyric: '',
      rlyric: '',
      lxlyric: '',
      rawlyric: '',
      musicInfo: null,
    })
    const updateMusicInfo = () => {
      lyricInfo.lyric = playerMusicInfo.lrc
      lyricInfo.tlyric = playerMusicInfo.tlrc
      lyricInfo.rlyric = playerMusicInfo.rlrc
      lyricInfo.lxlyric = playerMusicInfo.lxlrc
      lyricInfo.rawlyric = playerMusicInfo.rawlrc
      lyricInfo.musicInfo = playMusicInfo.musicInfo
    }
    const handleShowLyricMenu = event => {
      updateMusicInfo()
      lyricMenuXY.x = event.pageX
      lyricMenuXY.y = event.pageY
      if (lyricMenuVisible.value) return
      void nextTick(() => {
        lyricMenuVisible.value = true
      })
    }
    const handleUpdateLyric = ({ lyric, tlyric, rlyric, lxlyric, offset }) => {
      lyricInfo.lyric = lyric
      lyricInfo.tlyric = tlyric
      lyricInfo.rlyric = rlyric
      lyricInfo.lxlyric = lxlyric
      setMusicInfo({
        lrc: lyric,
        tlrc: tlyric,
        rlrc: rlyric,
        lxlrc: lxlyric,
      })
      console.log(offset)
      setLyricOffset(offset)
    }

    const lrcStyles = computed(() => {
      return {
        textAlign: appSetting['playDetail.style.align'],
        '--lyric-transform-origin': appSetting['playDetail.style.align'],
        '--lyric-zoom-margins': appSetting['playDetail.style.align'] === 'left' ? '0 auto' : appSetting['playDetail.style.align'] === 'right' ? 'auto 0' : 'auto',
      }
    })
    const lrcFontSize = computed(() => {
      let size = appSetting['playDetail.style.fontSize'] / 100
      if (isFullscreen.value) size = size *= 1.4
      return {
        '--playDetail-lrc-font-size': (isShowPlayComment.value ? size * 0.82 : size) + 'rem',
      }
    })

    onMounted(() => {
      window.app_event.on('musicToggled', updateMusicInfo)
      window.app_event.on('lyricUpdated', updateMusicInfo)
      revealBase = playProgress.nowPlayTime * 1000
      revealTickAt = performance.now()
      void nextTick(() => {
        markFocusRows()
        syncRevealLoop()
      })
    })
    onBeforeUnmount(() => {
      window.app_event.off('musicToggled', updateMusicInfo)
      window.app_event.off('lyricUpdated', updateMusicInfo)
      stopReveal()
    })

    return {
      appSetting,
      isFocusGradient,
      dom_lyric,
      dom_lyric_text,
      dom_lrc_select_content,
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
      lyric,
      lrcStyles,
      lrcFontSize,
      isShowLrcSelectContent,
      isShowLyricProgressSetting,
      isZoomActiveLrc,
      isStopScroll,
      lyricMenuVisible,
      lyricMenuXY,
      handleShowLyricMenu,
      handleUpdateLyric,
      lyricInfo,
    }
  },
  methods: {
    handleCopySelectText() {
      let str = window.getSelection().toString()
      str = str.trim()
      if (!str.length) return
      clipboardWriteText(str)
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.right {
  flex: 0 0 60%;
  // padding: 0 30px;
  position: relative;
  transition: flex-basis @transition-normal;
}
.right[data-ambient-lyrics] {
  isolation: isolate;
  // One predictable colour for the whole lyric sheet: the adaptive background
  // publishes pure white or near-black from the reading area, never a tinted accent.
  --lyric-idle-color: var(--lyric-text, var(--color-450));
  // Every row keeps full opacity: only the zoom marks the current line, so
  // switching lines never brightens or dims the sheet.
  --lyric-idle-opacity: 1;
  --lyric-active-color: var(--lyric-text, var(--color-450));

  :global {
    // Soft shadow behind the glyphs instead of an outline, so the lyrics stay
    // readable over busy artwork without drawing a border around every letter.
    // It has to be a composited drop shadow, not text-shadow: karaoke rows paint
    // their letters as a background clipped to the text with a transparent fill,
    // and text-shadow is drawn above that background, so it lands on the glyphs.
    // The blur also stays inside the row so it never covers the neighbouring line.
    .line-content {
      filter:
        drop-shadow(0 1px 2px var(--lyric-shadow, rgba(0, 0, 0, .45)))
        drop-shadow(0 2px 4px var(--lyric-shadow, rgba(0, 0, 0, .45)));
    }
    // Karaoke progress keeps the same hue: unplayed characters sit at 55% alpha,
    // played ones use the full lyric colour. Translation and romanization keep the
    // same unplayed tone and brighten with the characters above them, so the whole
    // group fades in together instead of leaving the translation permanently dim.
    .line-content.font-mode > .line > .font-lrc > span {
      background-color: color-mix(in srgb, var(--lyric-idle-color) 55%, transparent);
    }
    // Only word-level rows publish a reveal: line-level lyrics have no progress to
    // follow, so their translations keep the stock full-strength colour.
    // The reveal is the same sweep the karaoke characters use, applied to the whole
    // translation and romanization line: the sung share is painted in the full tone
    // and the rest stays at the unplayed tone, so the group advances as one.
    .line-content.font-mode .extended .font-lrc {
      background-color: color-mix(in srgb, var(--lyric-idle-color) 55%, transparent);
      background-image: linear-gradient(var(--lyric-active-color, var(--lyric-idle-color)), var(--lyric-active-color, var(--lyric-idle-color)));
      background-repeat: no-repeat;
      background-size: calc(var(--lyric-reveal, 0) * 100%) 100%;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
    }
  }

  .lyricSelectline { opacity: var(--lyric-idle-opacity); }
  .lyricSelectline.lrcActive {
    opacity: 1;
  }
}
// Lyrics sit directly on the artwork; readability comes from the adaptive text
// colours plus the shadow, not from a background layer.
.lyric {
  text-align: center;
  height: 100%;
  overflow: hidden;
  font-size: var(--playDetail-lrc-font-size, 16px);
  -webkit-mask-image: linear-gradient(transparent 0%, #fff 20%,  #fff 80%, transparent 100%);
  cursor: grab;
  &.draging {
    cursor: grabbing;
  }
  :global {
    .font-lrc {
      color: var(--lyric-idle-color, var(--color-450));
      transition: var(--duration-normal) var(--ease-standard);
      transition-property: color, opacity;
    }
    .line-content {
      line-height: 1.2;
      padding: calc(var(--playDetail-lrc-font-size, 16px) / 2) 1px;
      overflow-wrap: break-word;
      color: var(--lyric-idle-color, var(--color-450));
      opacity: var(--lyric-idle-opacity, .64);
      transition: var(--duration-normal) var(--ease-standard);
      transition-property: color, opacity;

      .extended {
        font-size: 0.8em;
        margin-top: 5px;
      }
      &.line-mode {
        .font-lrc {
          transition: color var(--duration-normal) var(--ease-standard);
        }
      }
      &.font-mode.played > .line > .font-lrc {
        color: var(--lyric-active-color, var(--color-primary-dark-200));
      }
      &.active {
        opacity: 1;
      }
      &.font-mode .extended .font-lrc {
        transition: color var(--duration-slow) var(--ease-standard);
      }

      &.font-mode > .line > .font-lrc {
          > span {
          transition: opacity var(--duration-normal) var(--ease-standard);
          font-size: 1em;
          background-repeat: no-repeat;
          background-color: var(--lyric-idle-color, var(--color-450));
          background-image: -webkit-linear-gradient(top, var(--lyric-active-color, var(--color-primary-dark-200)), var(--lyric-active-color, var(--color-primary-dark-200)));
          -webkit-text-fill-color: transparent;
          -webkit-background-clip: text;
          background-size: 0 100%;
        }
      }
    }
  }
  // p {
  //   padding: 8px 0;
  //   line-height: 1.2;
  //   overflow-wrap: break-word;
  //   transition: @transition-normal !important;
  //   transition-property: color, font-size;
  // }
  // .lrc-active {
  //   color: var(--color-primary);
  //   font-size: 1.2em;
  // }
}
.lrcActiveZoom {
  --lyric-active-scale: 1.14;
  :global {
    .line-content {
      // Reserve width and keep row layout stable while the whole lyric group scales.
      width: calc(100% / var(--lyric-active-scale));
      margin-inline: var(--lyric-zoom-margins, auto);
      transform: scale(1);
      transform-origin: var(--lyric-transform-origin, center) center;
      // Overshooting curve: the active row grows slightly past its target and
      // settles back, giving a light spring feel without a per-frame JS loop.
      transition:
        transform var(--duration-slow) cubic-bezier(0.34, 1.56, 0.64, 1),
        color var(--duration-slow) var(--ease-standard),
        opacity var(--duration-slow) var(--ease-standard);
      .font-lrc {
        transition-duration: var(--duration-slow);
      }
      &.active {
        transform: scale(var(--lyric-active-scale));
      }
    }
  }
}

// Adaptive-background only: rows above the active line stay readable but dim,
// rows below are dimmer still and brighten as they move into focus.
.focusGradient {
  :global(.line-content.isPassed) { opacity: .44; }

  :global(.line-content.isPassed[data-lyric-distance="2"]) { opacity: .33; }

  :global(.line-content.isPassed[data-lyric-distance="3"]) { opacity: .27; }

  :global(.line-content.isUpcoming) { opacity: .62; }

  :global(.line-content.isUpcoming[data-lyric-distance="2"]) { opacity: .5; }

  :global(.line-content.isUpcoming[data-lyric-distance="3"]) { opacity: .38; }

  // The active row stays fully lit for as long as it is the current line: it only
  // dims once the next line takes over, in step with the sheet starting to move.
  :global(.line-content.active) { opacity: 1; }
}

.skip {
  position: absolute;
  top: 50%;
  left: 0;
  width: 100%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 1;
  pointer-events: none;
  .line {
    flex: 1;
    min-width: 0;
    border-top: 1px solid var(--color-primary-dark-100);
    opacity: .45;
  }
  .label {
    flex: none;
    line-height: 1.2;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--color-primary-dark-100);
  }
  .skipBtn {
    flex: none;
    min-width: 64px;
    height: 32px;
    padding: 0 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: 13px;
    white-space: nowrap;
    pointer-events: auto;
  }
}
.lyricSelectContent {
  position: absolute;
  left: 0;
  top: 0;
  // text-align: center;
  height: 100%;
  width: 100%;
  font-size: var(--playDetail-lrc-font-size, 16px);
  z-index: 10;
  color: var(--lyric-idle-color, var(--color-400));

  .lyricSelectline {
    padding: calc(var(--playDetail-lrc-font-size, 16px) / 2) 1px;
    overflow-wrap: break-word;
    transition: color var(--duration-normal) var(--ease-standard) !important;
    line-height: 1.3;
  }
  .lyricSelectlineExtended {
    font-size: 14px;
  }
  .lrcActive {
    color: var(--lyric-active-color, var(--color-primary));
    font-weight: var(--playDetail-font-weight, 400);
  }
}

.lyricSpace {
  height: 70%;
}

</style>
