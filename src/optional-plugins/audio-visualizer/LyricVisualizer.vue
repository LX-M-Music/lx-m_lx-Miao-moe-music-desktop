<template>
  <div :class="$style.content" data-plugin-visualizer="desktop" :data-visualizer-style="preferences.desktop"><canvas ref="canvas" :class="$style.canvas" /></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from '@common/utils/vueTools'
import { useEvent, getAnalyserDataArray } from '@lyric/core/mainWindowChannel'
import { isPlay } from '@lyric/store/state'
import { createVisualizerRenderer } from './renderer'
import { preferences } from './preferences'
import { requestVisualFrame, cancelVisualFrame, isLowPowerMode } from './performance'

const canvas = ref(null)
let mounted = false
let frame = null
let resizeFrame = null
let pending = false
let observer
let renderer
let lastData = new Uint8Array()
const draw = () => { if (mounted) renderer.draw(lastData, { desktop: true, style: preferences.desktop, time: performance.now() }) }
const stop = () => {
  cancelVisualFrame(frame)
  frame = null
}
const request = () => {
  frame = null
  if (!mounted || pending || (isLowPowerMode() && document.hidden)) return
  pending = true
  getAnalyserDataArray()
}
useEvent(event => {
  if (event.action !== 'send_analyser_data_array' || !mounted) return
  pending = false
  lastData = event.data
  draw()
  stop()
  if (isPlay.value && (!isLowPowerMode() || !document.hidden)) frame = requestVisualFrame(request)
})
const refresh = () => { stop(); if (isPlay.value) request(); else draw() }
watch(isPlay, refresh)
watch(() => preferences.desktop, () => {
  lastData = new Uint8Array()
  draw()
  if (isPlay.value) request()
})
onMounted(() => {
  mounted = true
  renderer = createVisualizerRenderer(canvas.value)
  renderer.resize(canvas.value.clientWidth, canvas.value.clientHeight)
  observer = new ResizeObserver(entries => {
    const size = entries[0].contentRect
    renderer.resize(size.width, size.height)
    cancelVisualFrame(resizeFrame)
    resizeFrame = requestVisualFrame(() => { resizeFrame = null; draw() })
  })
  observer.observe(canvas.value)
  document.addEventListener('visibilitychange', refresh)
  window.addEventListener('lx-performance-change', refresh)
  if (isPlay.value) request()
})
onBeforeUnmount(() => {
  mounted = false
  stop()
  cancelVisualFrame(resizeFrame)
  observer?.disconnect()
  renderer?.dispose()
  lastData = new Uint8Array()
  document.removeEventListener('visibilitychange', refresh)
  window.removeEventListener('lx-performance-change', refresh)
})
</script>

<style lang="less" module>
.content { position: absolute; inset: 0; pointer-events: none; z-index: -1; }
.canvas { width: 100%; height: 100%; }
</style>
