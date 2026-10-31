<template>
  <div
    ref="root" :class="$style.background" data-ambient-background="shared"
    :data-ambient-state="state" :data-ambient-renderer="backend" aria-hidden="true"
  >
    <div ref="visual" :class="$style.visual">
      <div :class="$style.fallback" :style="fallbackStyle" :hidden="backend != 'fallback' && !!preview" />
      <div v-if="previousPreview" ref="previousLayer" :class="$style.fallback" :style="previousFallbackStyle" :hidden="backend != 'fallback'" />
      <canvas ref="canvas" :class="$style.canvas" :hidden="backend == 'fallback' || !preview || !!snapshot" />
      <img v-if="snapshot" :class="$style.canvas" :src="snapshot" data-ambient-snapshot alt="" draggable="false">
      <div v-if="preview && backend == 'fallback'" :class="$style.shade" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { type PropType } from 'vue'
import { computed, ref, watch, onMounted, onBeforeUnmount } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'
import { isWindowVisible } from '@renderer/store'
import { isPlay } from '@renderer/store/player/state'
import { isMotionEnabled } from '@renderer/utils/motion'
import { loadArtwork, type Artwork } from '@renderer/utils/kawarpBackground/artwork'
import { normalizeQuality, surfaceSize } from '@renderer/utils/kawarpBackground/options'
import { createKawarpRenderer } from '@renderer/utils/kawarpBackground/renderer'
import { createLowPowerBackgroundRenderer, lowPowerSurfaceSize } from '@renderer/utils/kawarpBackground/lowPowerRenderer'
import { createArtworkTransition } from '@renderer/utils/kawarpBackground/transition'
import { createAdaptiveColors } from '@renderer/utils/kawarpBackground/adaptiveColors'
import { createStillFrame } from '@renderer/utils/kawarpBackground/stillFrame'
import { createFrameClock } from '@renderer/utils/kawarpBackground/frameClock'
import { parseColor } from '@renderer/utils/kawarpBackground/contrast'

const props = defineProps({
  cover: { type: String as PropType<string | null>, default: '' },
  detail: { type: Boolean, default: false },
  detailVisible: { type: Boolean, default: false },
})
const root = ref<HTMLElement | null>(null)
const visual = ref<HTMLElement | null>(null)
const previousLayer = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const state = ref('static')
const backend = ref('fallback')
const preview = ref('')
const previousPreview = ref('')
const snapshot = ref('')
const stillFrame = createStillFrame(url => { snapshot.value = url })
const fallbackStyle = computed(() => preview.value ? { backgroundImage: `url("${preview.value}")` } : {})
const previousFallbackStyle = computed(() => ({ backgroundImage: `url("${previousPreview.value}")` }))
const motion = ref(isMotionEnabled())
const hidden = ref(document.hidden)
const visible = computed(() => isWindowVisible.value && !hidden.value)
const lowPower = computed(() => appSetting['ui.lowPowerMode'])
const quality = computed(() => lowPower.value ? 'static' : normalizeQuality(appSetting['ui.ambientBackgroundQuality']))
const canMove = computed(() => motion.value && quality.value != 'static')
const adaptiveEnabled = computed(() => props.detailVisible || appSetting['ui.ambientBackgroundAutoContrast'])

let renderer: ReturnType<typeof createKawarpRenderer> = null
let adaptiveColors: ReturnType<typeof createAdaptiveColors> | undefined
let observer: ResizeObserver | undefined
let loader: AbortController | undefined
const transition = createArtworkTransition()
let loadedCover: string | undefined
let sourceDirty = true
let disposed = false
let frame = 0
let snapshotTimer: ReturnType<typeof setTimeout> | undefined
const frameClock = createFrameClock()
let time = 14
let velocity = 0
let width = 1
let height = 1

const stop = () => {
  cancelAnimationFrame(frame)
  clearTimeout(snapshotTimer)
  snapshotTimer = undefined
  frame = 0
  frameClock.reset()
}
const updateSources = () => {
  const current = transition.frame()
  preview.value = (current.done ? current.to : current.to ?? current.from)?.preview ?? ''
  previousPreview.value = !current.done && current.from && current.to && current.from !== current.to ? current.from.preview : ''
}
const paintOpacity = (current: ReturnType<typeof transition.frame>) => {
  const opacity = String(current.opacity)
  const previousOpacity = String(1 - current.mix)
  if (visual.value && visual.value.style.opacity !== opacity) visual.value.style.opacity = opacity
  if (previousLayer.value && previousLayer.value.style.opacity !== previousOpacity) previousLayer.value.style.opacity = previousOpacity
}
const step = (now: number) => {
  frame = 0
  if (!visible.value || disposed) return
  const interval = 1000 / (quality.value == 'full' ? 30 : 20)
  const dt = frameClock.advance(now, interval)
  if (dt == null) { frame = requestAnimationFrame(step); return }
  const current = transition.frame(now)
  const playing = !!renderer && !!current.to && canMove.value && isPlay.value
  velocity += ((playing ? 1 : 0) - velocity) * (1 - Math.exp(-dt * 4.5))
  const requestedSpeed = Number(appSetting['ui.animationSpeed'])
  const speed = Number.isFinite(requestedSpeed) ? Math.max(0.5, Math.min(1.5, requestedSpeed)) : 1
  time += dt * velocity * speed
  const size = lowPower.value ? lowPowerSurfaceSize(width, height) : surfaceSize(width, height, quality.value, window.devicePixelRatio)
  if (preview.value) renderer?.draw(size.width, size.height, time, !current.done, quality.value == 'gentle')
  paintOpacity(current)
  // Always sample the final frame before pausing, including static-quality covers.
  if (!playing && velocity <= 0.005 && current.done) adaptiveColors?.invalidate()
  adaptiveColors?.update(current, backend.value != 'fallback' ? canvas.value : null, playing || velocity > 0.005 || !current.done)
  if (current.done) {
    transition.finish()
    updateSources()
  }
  if (playing || velocity > 0.005 || !current.done) {
    state.value = playing ? 'playing' : 'settling'
    frame = requestAnimationFrame(step)
  } else {
    velocity = 0
    state.value = 'static'
    stop()
    // Wait for resize/settings bursts to settle instead of starting a PNG
    // encoding job on every intermediate window size.
    snapshotTimer = setTimeout(() => {
      snapshotTimer = undefined
      if (!lowPower.value && renderer && preview.value && canvas.value) void stillFrame.capture(canvas.value)
    }, 80)
  }
}

function refresh() {
  if (!root.value || disposed) return
  stop()
  adaptiveColors?.invalidate()
  if (!visible.value) {
    velocity = 0
    state.value = 'hidden'
    return
  }
  // Resume drawing before changing the image, size, motion settings or theme.
  stillFrame.clear()
  const surface = getComputedStyle(root.value).getPropertyValue('--ambient-surface-color').trim()
  renderer?.setShade(parseColor(surface || getComputedStyle(document.documentElement).getPropertyValue('--color-content-background')))
  if (!canMove.value) {
    velocity = 0
    transition.finish()
    updateSources()
    renderer?.finishTransition()
  }
  const current = transition.frame()
  updateSources()
  if (!preview.value) {
    velocity = 0
    transition.finish()
    paintOpacity(transition.frame())
    adaptiveColors?.update(transition.frame(), null)
    state.value = 'static'
    return
  }
  if (sourceDirty && renderer) {
    // Resuming a surface or recovering WebGL continues from the current blend.
    const resumed = transition.resume()
    updateSources()
    const source = resumed.to ?? resumed.from
    if (source) renderer.setSource(source.image, canMove.value && resumed.to && resumed.from ? resumed.remaining : 1, resumed.to ? resumed.from?.image : undefined)
    sourceDirty = false
  }
  paintOpacity(current)
  // Uploads and setting changes get one frame even when animation is stopped.
  frame = requestAnimationFrame(step)
}

watch([visible, () => props.cover], ([active, cover]) => {
  loader?.abort()
  const src = cover ?? ''
  if (!active || src === loadedCover) return
  const current = loader = new AbortController()
  if (src) {
    transition.hold()
    updateSources()
    sourceDirty = true
    // Keep a settled image while the next artwork is downloading. There is no
    // reason to wake WebGL and encode the same frame again during this wait.
    if (!snapshot.value) refresh()
  }
  const apply = (value: Artwork | null) => {
    if (current.signal.aborted || disposed) return
    loadedCover = src
    transition.start(value, canMove.value ? 1200 : 0)
    updateSources()
    sourceDirty = true
    refresh()
  }
  void loadArtwork(src, current.signal).then(apply).catch(() => { apply(null) })
}, { immediate: true })
watch([visible, canMove, quality, isPlay], refresh)
watch([adaptiveEnabled, () => appSetting['ui.ambientBackgroundAutoContrast'], () => props.detail], ([value, library, detail], previous) => {
  adaptiveColors?.setEnabled(value, library)
  // Restoring foreground styles after exit needs no new background frame.
  if (value || detail !== previous[2]) refresh()
}, { flush: 'post' })
watch(() => appSetting['ui.ambientBackgroundPlayDetailMask'], () => {
  if (props.detailVisible) refresh()
}, { flush: 'post' })

const resize = () => {
  width = root.value?.clientWidth ?? 1
  height = root.value?.clientHeight ?? 1
  refresh()
}
const updateVisibility = () => { hidden.value = document.hidden }
const updateMotion = () => { motion.value = isMotionEnabled(); refresh() }
const contextLost = (event: Event) => {
  event.preventDefault()
  stillFrame.clear()
  renderer?.dispose()
  renderer = null
  sourceDirty = true
  backend.value = 'fallback'
  refresh()
}
const contextRestored = () => {
  if (!canvas.value || disposed) return
  renderer = lowPower.value ? createLowPowerBackgroundRenderer(canvas.value) : createKawarpRenderer(canvas.value)
  backend.value = renderer ? lowPower.value ? 'low-power' : 'kawarp' : 'fallback'
  sourceDirty = true
  refresh()
}
onMounted(() => {
  adaptiveColors = createAdaptiveColors(root.value!, refresh)
  adaptiveColors.setEnabled(adaptiveEnabled.value, appSetting['ui.ambientBackgroundAutoContrast'])
  canvas.value!.addEventListener('webglcontextlost', contextLost)
  canvas.value!.addEventListener('webglcontextrestored', contextRestored)
  contextRestored()
  observer = new ResizeObserver(resize)
  observer.observe(root.value!)
  document.addEventListener('visibilitychange', updateVisibility)
  window.addEventListener('lx-motion-change', updateMotion)
  resize()
})
onBeforeUnmount(() => {
  disposed = true
  loader?.abort()
  stillFrame.dispose()
  stop()
  adaptiveColors?.dispose()
  observer?.disconnect()
  document.removeEventListener('visibilitychange', updateVisibility)
  window.removeEventListener('lx-motion-change', updateMotion)
  canvas.value?.removeEventListener('webglcontextlost', contextLost)
  canvas.value?.removeEventListener('webglcontextrestored', contextRestored)
  renderer?.dispose()
  if (renderer) canvas.value?.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext()
  renderer = null
})
</script>

<style lang="less" module>
.background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
  opacity: var(--ambient-background-opacity, .30);
  transition: opacity var(--duration-detail) var(--ease-standard);
}
.visual { position: absolute; inset: 0; opacity: 0; }
.canvas, .fallback, .shade { position: absolute; inset: 0; width: 100%; height: 100%; }
.fallback {
  background-position: center;
  background-size: cover;
  filter: blur(48px);
  transform: scale(1.18);
}
.shade { background: linear-gradient(90deg, transparent 12%, var(--ambient-shade-color, var(--color-content-background)) 115%); opacity: .1; }
</style>
