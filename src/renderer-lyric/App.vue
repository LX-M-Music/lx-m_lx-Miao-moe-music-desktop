<template>
  <div id="background" :style="{ opacity: backgroundOpacity }" aria-hidden="true" />
  <div id="container" :class="[{ lock: setting['desktopLyric.isLock'] }, { hide: isHoverHide }, { transparent: backgroundOpacity === 0, 'native-window-hover': nativePointer !== null, 'show-border': setting['desktopLyric.showBorder'] }]">
    <div id="main">
      <div class="mini-lyrics" :class="{ 'native-lyric-drag': !isShowResize && !setting['desktopLyric.isLock'], 'with-player': setting['desktopLyric.showPlayer'], 'single-line': setting['desktopLyric.singleLine'], 'align-start': setting['desktopLyric.scrollAlign'] === 'top', paused: !setting['desktopLyric.showPlayer'] && isHide, vertical: !setting['desktopLyric.singleLine'] && setting['desktopLyric.direction'] === 'vertical' }" data-mini-lyrics>
        <span class="mini-lyric-drag-surface" aria-hidden="true" />
        <layout-lyric-single-line v-if="setting['desktopLyric.singleLine']" />
        <layout-lyric-vertical v-else-if="setting['desktopLyric.direction'] == 'vertical'" />
        <layout-lyric-horizontal v-else />
      </div>
      <!-- Windows applies native drag regions in DOM order. Keep the header
           after offscreen lyrics so their no-drag regions cannot block it. -->
      <mini-player />
      <transition enter-active-class="animated-fast fadeIn" leave-active-class="animated-fast fadeOut">
        <common-audio-visualizer v-if="setting['desktopLyric.audioVisualization']" />
      </transition>
      <common-plugin-contributions name="desktopLyricOverlay" />
    </div>
    <template v-if="isShowResize">
      <div class="resize resize-left" @mousedown.self="handleMouseDown('left', $event)" @touchstart.self="handleTouchDown('left', $event)" />
      <div class="resize resize-top" @mousedown.self="handleMouseDown('top', $event)" @touchstart.self="handleTouchDown('top', $event)" />
      <div class="resize resize-right" @mousedown.self="handleMouseDown('right', $event)" @touchstart.self="handleTouchDown('right', $event)" />
      <div class="resize resize-bottom" @mousedown.self="handleMouseDown('bottom', $event)" @touchstart.self="handleTouchDown('bottom', $event)" />
      <div class="resize resize-top-left" @mousedown.self="handleMouseDown('top-left', $event)" @touchstart.self="handleTouchDown('top-left', $event)" />
      <div class="resize resize-top-right" @mousedown.self="handleMouseDown('top-right', $event)" @touchstart.self="handleTouchDown('top-right', $event)" />
      <div class="resize resize-bottom-left" @mousedown.self="handleMouseDown('bottom-left', $event)" @touchstart.self="handleTouchDown('bottom-left', $event)" />
      <div class="resize resize-bottom-right" @mousedown.self="handleMouseDown('bottom-right', $event)" @touchstart.self="handleTouchDown('bottom-right', $event)" />
    </template>
    <layout-icons />
  </div>
  <button
    v-if="setting['desktopLyric.isLock']" type="button" class="mini-unlock" :class="{ 'native-pointer-over': nativeUnlockHover }" data-mini-unlock :style="unlockStyle"
    :title="$t('desktop_lyric__unlock')" :aria-label="$t('desktop_lyric__unlock')"
    @click="updateSetting({ 'desktopLyric.isLock': false })"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0M12 14v3" /></svg>
  </button>
</template>

<script setup>
import useWindowSize from '@lyric/useApp/useWindowSize'
import useHoverHide from '@lyric/useApp/useHoverHide'
import { computed, onMounted, onBeforeUnmount } from '@common/utils/vueTools'
import { nativePointer, setting } from '@lyric/store/state'
import { updateSetting } from '@lyric/store/action'
import { MINI_PLAYER_UNLOCK_BUTTON } from '@common/miniPlayer'
import { onPointerPosition, sendConnectMainWindowEvent } from '@lyric/utils/ipc'
import useCommon from '@lyric/useApp/useCommon'
import useLyric from '@lyric/useApp/useLyric'
import useTheme from '@lyric/useApp/useTheme'
import { init as initLyricPlayer } from '@lyric/core/lyric'
import usePauseHide from '@lyric/useApp/usePauseHide'
import { initOptionalPlugins } from '@lyric/store/optionalPlugins'
import MiniPlayer from '@lyric/components/layout/MiniPlayer.vue'

const isShowResize = window.os != 'windows'
useCommon()
onBeforeUnmount(initOptionalPlugins())
const { handleMouseDown, handleTouchDown } = useWindowSize()
const isHoverHide = useHoverHide()
useLyric()
useTheme()
const isHide = usePauseHide()
const backgroundOpacity = computed(() => Math.min(100, Math.max(0, Number(setting['desktopLyric.style.backgroundOpacity']) || 0)) / 100)
const unlockStyle = Object.fromEntries(Object.entries(MINI_PLAYER_UNLOCK_BUTTON).map(([key, value]) => [key, `${value}px`]))
const nativeUnlockHover = computed(() => {
  const point = nativePointer.value
  if (!point) return false
  const { top, right, width, height } = MINI_PLAYER_UNLOCK_BUTTON
  const x = window.innerWidth - right - width
  return point.x >= x && point.x < x + width && point.y >= top && point.y < top + height
})
onBeforeUnmount(onPointerPosition(({ params: point }) => { nativePointer.value = point }))


onMounted(() => {
  initLyricPlayer()
  sendConnectMainWindowEvent()
})

</script>

<style lang="less">
@import './assets/styles/index.less';
@import './assets/styles/layout.less';

body {
  user-select: none;
  height: 100vh;
  box-sizing: border-box;
  color: #fff;
}

#root {
  height: 100%;
}

#container {
  position: relative;
  box-sizing: border-box;
  height: 100%;
  transition: opacity .3s ease;
  opacity: 1;
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 9;
    border-radius: 14px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .16);
    pointer-events: none;
    opacity: 0;
    transition: opacity .18s ease;
  }
  &.show-border::after { opacity: 1; }
  &.hide {
    opacity: .04;

    &:not(.lock):hover {
      opacity: 1;
    }
    &:not(.lock):has(.native-controls-hover, .options-open, .mini-controls :focus-visible) {
      opacity: 1;
    }
  }
}

#background {
  position: absolute;
  inset: 0;
  border-radius: 14px;
  background-color: #131920;
  pointer-events: none;
  transition: opacity @transition-theme;
}

@resize-width: 6px;
.resize {
  z-index: 2;
}
.resize-left {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  width: @resize-width;
  cursor: ew-resize;
  // background-color: rgba(0, 0, 0, 1);
}
.resize-right {
  position: absolute;
  right: 0;
  top: 0;
  height: 100%;
  width: @resize-width;
  cursor: ew-resize;
}
.resize-top {
  position: absolute;
  left: 0;
  top: 0;
  height: 4px;
  width: 100%;
  cursor: ns-resize;
}
.resize-bottom {
  position: absolute;
  left: 0;
  bottom: 0;
  height: @resize-width;
  width: 100%;
  cursor: ns-resize;
}
.resize-top-left {
  position: absolute;
  left: 0;
  top: 0;
  width: @resize-width;
  height: @resize-width;
  cursor: nwse-resize;
  // background-color: rgba(0, 0, 0, 1);
}
.resize-top-right {
  position: absolute;
  right: 0;
  top: 0;
  width: @resize-width;
  height: @resize-width;
  cursor: nesw-resize;
  // background-color: rgba(0, 0, 0, 1);
}
.resize-bottom-left {
  position: absolute;
  left: 0;
  bottom: 0;
  width: @resize-width;
  height: @resize-width;
  cursor: nesw-resize;
  // background-color: rgba(0, 0, 0, 1);
}
.resize-bottom-right {
  position: absolute;
  right: 0;
  bottom: 0;
  width: @resize-width;
  height: @resize-width;
  cursor: nwse-resize;
  // background-color: rgba(0, 0, 0, 1);
}

#main {
  position: relative;
  box-sizing: border-box;
  height: 100%;
  transition: background-color @transition-theme;
  min-height: 0;
  border-radius: @radius-border;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  > .mini-player { order: -1; }

}

.mini-lyrics {
  flex: 1;
  min-height: 0;
  position: relative;
  touch-action: none;
  opacity: 1;
  transition: opacity .3s ease;
  // Keep the scroll viewport below the floating controls even when they hide,
  // so hovering the header never moves or covers lyrics. Preserve space for a
  // lyric line when the window is reduced to a short desktop-lyric strip.
  --mini-header-space: clamp(0px, calc(100vh - 64px), 44px);
  &:not(.with-player) { margin-top: var(--mini-header-space); }
  -webkit-mask-image: linear-gradient(transparent, #000 14%, #000 86%, transparent);
  mask-image: linear-gradient(transparent, #000 14%, #000 86%, transparent);
  &.vertical {
    -webkit-mask-image: linear-gradient(to right, transparent, #000 14%, #000 86%, transparent);
    mask-image: linear-gradient(to right, transparent, #000 14%, #000 86%, transparent);
  }
  // Start-aligned lyrics need their first line/column fully visible.
  &.align-start {
    -webkit-mask-image: linear-gradient(#000 86%, transparent);
    mask-image: linear-gradient(#000 86%, transparent);
    &.vertical {
      -webkit-mask-image: linear-gradient(to right, transparent, #000 14%);
      mask-image: linear-gradient(to right, transparent, #000 14%);
    }
  }
  // Paused lyrics should remain readable even with a fully transparent window.
  &.single-line {
    -webkit-mask-image: none;
    mask-image: none;
  }
  &.paused { opacity: .7; }
  .mini-lyric-drag-surface { display: none; }
  &.native-lyric-drag {
    // Electron 22 misplaces native regions on pseudo-elements. A real element
    // keeps the lyric margins draggable without blocking the floating header.
    .mini-lyric-drag-surface {
      display: block;
      position: absolute;
      inset: 0;
      pointer-events: none;
      -webkit-app-region: drag;
    }
    &:not(.with-player) .mini-lyric-drag-surface { top: calc(44px - var(--mini-header-space)); }
    .font-lrc, .extended { -webkit-app-region: no-drag; }
  }
}

#container:not(.lock):hover .mini-lyrics.paused,
#container:not(.lock):has(.native-controls-hover, .options-open, .mini-controls :focus-visible) .mini-lyrics.paused {
  opacity: 1;
}

// Native captions consume clicks before the renderer. Let menu controls and
// clicks that dismiss keyboard focus reach the page before enabling dragging.
#main:has(.mini-player .mini-options, .mini-player .mini-controls :focus-visible, .mini-player .mini-header:hover, .mini-player .mini-track:hover) .mini-lyrics .mini-lyric-drag-surface {
  // Removing the surface also removes its native region on Chromium 108;
  // a no-drag exclusion here can otherwise cover the floating header.
  display: none;
}

.transparent .mini-track-info {
  text-shadow: 0 1px 4px rgba(0, 0, 0, .8);
}

.mini-unlock {
  position: fixed;
  z-index: 10;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, .2);
  border-radius: 8px;
  color: #f5f7fa;
  background: rgba(17, 22, 30, .94);
  cursor: pointer;
  -webkit-app-region: no-drag;
  opacity: .85;
  transition: opacity .18s ease;
  // Stay outside the faded/locked container so recovery remains visible and usable.
  &:hover, &:focus-visible, &.native-pointer-over { opacity: 1; }
  &:focus-visible { outline: 2px solid var(--color-primary, #56cc9b); outline-offset: 1px; }
  svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
}
@media (prefers-reduced-motion: reduce) { .mini-unlock, .mini-lyrics, #container::after { transition: none !important; } }

</style>
