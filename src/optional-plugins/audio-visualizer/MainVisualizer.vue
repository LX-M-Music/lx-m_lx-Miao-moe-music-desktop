<template>
  <div :class="[$style.content, { [$style.radial]: preferences.main === 'radial' }]" data-plugin-visualizer="main" :data-visualizer-style="preferences.main"><canvas ref="canvas" :class="$style.canvas" /></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from '@common/utils/vueTools'
import { isPlay } from '@renderer/store/player/state'
import { getFrequencyData } from './analyser'
import { createVisualizerRenderer } from './renderer'
import { preferences } from './preferences'
import { requestVisualFrame, cancelVisualFrame } from './performance'

const canvas = ref(null)
let frame = null
let mounted = false
let observer
let renderer
let lyrics
let lyricBounds
const updateBounds = () => {
  lyricBounds = undefined
  if (preferences.main !== 'radial' || !lyrics) return
  const region = lyrics.getBoundingClientRect()
  const surface = canvas.value.getBoundingClientRect()
  lyricBounds = {
    x: Math.max(0, region.left - surface.left),
    y: Math.max(0, region.top - surface.top),
    width: Math.min(region.width, surface.right - region.left),
    height: Math.min(region.height, surface.bottom - region.top),
  }
}
const stop = () => {
  cancelVisualFrame(frame)
  frame = null
}
const render = (time = performance.now()) => {
  frame = null
  if (!mounted) return
  renderer.draw(getFrequencyData(preferences.main), { style: preferences.main, time, bounds: lyricBounds })
  if (isPlay.value && !document.hidden) frame = requestVisualFrame(render)
}
const refresh = () => { stop(); if (mounted) { updateBounds(); render() } }
watch(isPlay, refresh)
watch(() => preferences.main, refresh)
onMounted(() => {
  mounted = true
  renderer = createVisualizerRenderer(canvas.value)
  lyrics = canvas.value.closest('[data-player-detail]')?.querySelector('[data-detail-part="lyrics"]')
  renderer.resize(canvas.value.clientWidth, canvas.value.clientHeight)
  updateBounds()
  observer = new ResizeObserver(entries => {
    const surface = entries.find(entry => entry.target === canvas.value)
    if (surface) renderer.resize(surface.contentRect.width, surface.contentRect.height)
    updateBounds()
    stop()
    frame = requestVisualFrame(render)
  })
  observer.observe(canvas.value)
  if (lyrics) observer.observe(lyrics)
  document.addEventListener('visibilitychange', refresh)
  window.addEventListener('lx-performance-change', refresh)
  render()
})
onBeforeUnmount(() => { mounted = false; stop(); observer?.disconnect(); renderer?.dispose(); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('lx-performance-change', refresh) })
</script>

<style lang="less" module>
.content { position: absolute; inset: 0; pointer-events: none; z-index: 100; }
.radial { z-index: -1; }
.canvas { width: 100%; height: 100%; }
</style>
