<template>
  <div :class="['right', $style.right]" :style="lrcFontSize">
    <transition enter-active-class="animated fadeIn" leave-active-class="animated fadeOut">
      <div
        v-show="!isShowLrcSelectContent"
        ref="dom_lyric"
        :class="['lyric', $style.lyric, { [$style.draging]: isMsDown }, { [$style.lrcActiveZoom]: isZoomActiveLrc }]" :style="lrcStyles"
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
    })
    onBeforeUnmount(() => {
      window.app_event.off('musicToggled', updateMusicInfo)
      window.app_event.off('lyricUpdated', updateMusicInfo)
    })

    return {
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
  --lyric-idle-color: var(--color-font);
  --lyric-idle-opacity: .68;
  --lyric-surface-color: var(--ambient-surface-color, var(--color-surface));
  --lyric-active-color: var(--ambient-lyric-accent, var(--color-primary-dark-400));

  :global(#root[data-ambient-controls]) & {
    // Resolve the shared idle color at the reading panel so original,
    // translated and romanized lyrics keep the same contrast and opacity.
    --lyric-idle-color: var(--color-450);
    --lyric-idle-opacity: .78;
  }

  // A soft local surface keeps the moving artwork from washing out the text.
  &::before {
    content: '';
    position: absolute;
    inset: -12px;
    z-index: -1;
    border-radius: 32px;
    background: var(--lyric-surface-color);
    opacity: .26;
    filter: blur(36px);
    -webkit-mask-image: radial-gradient(ellipse closest-side at center, #000, transparent 100%);
    mask-image: radial-gradient(ellipse closest-side at center, #000, transparent 100%);
    pointer-events: none;
  }

  :global {
    .font-lrc {
      --lyric-active-color: var(--ambient-local-lyric-accent, var(--ambient-lyric-accent, var(--color-primary-dark-400)));
    }
    .line-content:not(.active) .font-lrc {
      --lyric-active-color: var(--lyric-idle-color);
    }
  }

  .lyricSelectline { opacity: var(--lyric-idle-opacity); }
  .lyricSelectline.lrcActive {
    opacity: 1;
  }
}
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
      &.line-mode.active .font-lrc, &.font-mode.played .font-lrc {
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
      transition: transform var(--duration-slow) var(--ease-standard), color var(--duration-slow) var(--ease-standard), opacity var(--duration-slow) var(--ease-standard);
      .font-lrc {
        transition-duration: var(--duration-slow);
      }
      &.active {
        transform: scale(var(--lyric-active-scale));
      }
    }
  }
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
