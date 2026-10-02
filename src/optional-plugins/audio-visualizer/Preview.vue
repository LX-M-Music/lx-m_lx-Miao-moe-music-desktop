<template>
  <canvas ref="canvas" :class="$style.canvas" :data-visualizer-preview="kind" aria-hidden="true" />
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from '@common/utils/vueTools'
import { isPlay } from '@renderer/store/player/state'
import { acquirePreview, getFrequencyData } from './analyser'
import { createVisualizerRenderer } from './renderer'
import { demoSpectrum } from './styles'
import { demoRadialData } from './radialData'
import { requestVisualFrame, cancelVisualFrame } from './performance'

const props = defineProps({ kind: { type: String, required: true }, live: Boolean })
const canvas = ref(null)
let frame = null
let mounted = false
let observer
let release
let renderer
const stop = () => { cancelVisualFrame(frame); frame = null }
const draw = (time = 1400) => {
  frame = null
  if (!mounted) return
  const data = props.live && isPlay.value ? getFrequencyData(props.kind) : props.kind === 'radial' ? demoRadialData(time) : demoSpectrum(time)
  renderer.draw(data, { style: props.kind, preview: true, time })
  if (props.live && !document.hidden) frame = requestVisualFrame(draw)
}
const refresh = () => { stop(); draw() }
watch(() => props.kind, () => {
  release?.()
  if (mounted && props.live) release = acquirePreview(props.kind)
  refresh()
})
watch(isPlay, refresh)
onMounted(() => {
  mounted = true
  renderer = createVisualizerRenderer(canvas.value)
  renderer.resize(canvas.value.clientWidth, canvas.value.clientHeight)
  if (props.live) release = acquirePreview(props.kind)
  observer = new ResizeObserver(entries => {
    const size = entries[0].contentRect
    renderer.resize(size.width, size.height)
    stop()
    frame = requestVisualFrame(draw)
  })
  observer.observe(canvas.value)
  document.addEventListener('visibilitychange', refresh)
  window.addEventListener('lx-performance-change', refresh)
  draw()
})
onBeforeUnmount(() => {
  mounted = false
  stop()
  observer?.disconnect()
  release?.()
  renderer?.dispose()
  document.removeEventListener('visibilitychange', refresh)
  window.removeEventListener('lx-performance-change', refresh)
})
</script>

<style lang="less" module>
.canvas { display: block; width: 100%; height: 100%; pointer-events: none; }
</style>
