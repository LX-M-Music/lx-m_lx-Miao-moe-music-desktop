<template>
  <div class="mini-edge-content" :class="{ 'edge-collapsed': collapsed, 'edge-moving': moving }" :data-edge="edgeMotion.edge" :data-edge-phase="edgeMotion.phase" :style="motionStyle">
    <div id="background" :style="{ opacity: backgroundOpacity }" aria-hidden="true" />
    <div id="container" :class="{ lock: setting['miniPlayer.isLock'], 'show-border': setting['miniPlayer.showBorder'] }" data-mini-window>
      <div id="main"><mini-player /></div>
    </div>
    <button v-if="setting['miniPlayer.isLock']" type="button" class="mini-unlock" data-mini-unlock :style="unlockStyle" :aria-label="$t('mini_player__unlock')" @click="updateSetting({ 'miniPlayer.isLock': false })">
      <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0M12 14v3" /></svg>
    </button>
    <template v-if="windowOS !== 'windows' && !setting['miniPlayer.isLock'] && !moving">
      <div v-for="edge in resizeEdges" :key="edge" class="mini-resize" :class="`mini-resize-${edge}`" @mousedown.self="handleMouseDown(edge, $event)" @touchstart.self="handleTouchDown(edge, $event)" />
    </template>
  </div>
  <div v-if="edgeMotion.edge" class="mini-edge-handle" :data-mini-edge="edgeMotion.edge" :style="{ opacity: collapsed ? 1 : 0, transitionDuration: `${edgeMotion.duration}ms` }" aria-hidden="true" />
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { MINI_PLAYER_UNLOCK_BUTTON, MINI_PLAYER_EDGE_STRIP } from '@common/miniPlayer'
import { edgeMotion, setting, updateSetting } from './state'
import MiniPlayer from './MiniPlayer.vue'
import useWindowSize from './useWindowSize'
const windowOS = window.os
const resizeEdges = ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
const { handleMouseDown, handleTouchDown } = useWindowSize()
const backgroundOpacity = computed(() => Math.min(100, Math.max(0, setting['miniPlayer.backgroundOpacity'])) / 100)
const collapsed = computed(() => edgeMotion.value.phase === 'hiding' || edgeMotion.value.phase === 'hidden')
const moving = computed(() => edgeMotion.value.phase === 'hiding' || edgeMotion.value.phase === 'showing')
const motionStyle = computed(() => ({ '--edge-duration': `${edgeMotion.value.duration}ms`, '--edge-strip': `${MINI_PLAYER_EDGE_STRIP}px` }))
const unlockStyle = Object.fromEntries(Object.entries(MINI_PLAYER_UNLOCK_BUTTON).map(([key, value]) => [key, `${value}px`]))
</script>
<style lang="less">
@import '../assets/styles/reset.less';
body { margin: 0; height: 100vh; overflow: hidden; user-select: none; color: #f5f7fa; font-family: system-ui, sans-serif; }
#root, #container, #main { height: 100%; }
#container, #main { position: relative; box-sizing: border-box; }
.mini-edge-content { position: relative; width: 100%; height: 100%; transform: translate(0, 0); transition: transform var(--edge-duration, 0ms) cubic-bezier(.22, 1, .36, 1); }
.mini-edge-content.edge-moving { will-change: transform; }
.mini-edge-content[data-edge-phase="hidden"] { visibility: hidden; }
.mini-edge-content.edge-collapsed[data-edge="left"] { transform: translateX(calc(-100% + var(--edge-strip))); }
.mini-edge-content.edge-collapsed[data-edge="right"] { transform: translateX(calc(100% - var(--edge-strip))); }
.mini-edge-content.edge-collapsed[data-edge="top"] { transform: translateY(calc(-100% + var(--edge-strip))); }
#background { position: absolute; inset: 0; border-radius: 14px; background: #131920; pointer-events: none; }
.show-border::after { content: ''; position: absolute; inset: 0; border-radius: 14px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.16); pointer-events: none; }
.mini-unlock { position: fixed; z-index: 30; border: 0; border-radius: 8px; background: #26323e; color: #fff; cursor: pointer; -webkit-app-region: no-drag; svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; } }
.mini-edge-handle { position: fixed; inset: 0; z-index: 40; border-radius: 3px; background: #26323e; box-shadow: inset 0 0 0 1px rgba(255,255,255,.28); pointer-events: none; -webkit-app-region: no-drag; transition: opacity .24s ease; }
.mini-edge-handle[data-mini-edge="left"] { right: auto; width: 6px; }
.mini-edge-handle[data-mini-edge="right"] { left: auto; width: 6px; }
.mini-edge-handle[data-mini-edge="top"] { bottom: auto; height: 6px; }
.mini-resize { position: fixed; z-index: 20; width: 6px; height: 6px; }
.mini-resize-left, .mini-resize-right { top: 6px; bottom: 6px; height: auto; cursor: ew-resize; }
.mini-resize-top, .mini-resize-bottom { left: 6px; right: 6px; width: auto; cursor: ns-resize; }
.mini-resize-left, .mini-resize-top-left, .mini-resize-bottom-left { left: 0; }
.mini-resize-right, .mini-resize-top-right, .mini-resize-bottom-right { right: 0; }
.mini-resize-top, .mini-resize-top-left, .mini-resize-top-right { top: 0; }
.mini-resize-bottom, .mini-resize-bottom-left, .mini-resize-bottom-right { bottom: 0; }
.mini-resize-top-left, .mini-resize-bottom-right { cursor: nwse-resize; }
.mini-resize-top-right, .mini-resize-bottom-left { cursor: nesw-resize; }
</style>
