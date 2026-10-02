const normal = {
  coverBytes: 32 * 1024 * 1024,
  coverEntries: 256,
  backgroundArtworks: 6,
  coverUrls: Infinity,
  visualizerPixels: 8_000_000,
  visualizerDpr: 2,
} as const
const lowPower = {
  coverBytes: 8 * 1024 * 1024,
  coverEntries: 48,
  backgroundArtworks: 1,
  coverUrls: 64,
  visualizerPixels: 1_000_000,
  visualizerDpr: 1,
} as const

export const getPerformancePolicy = (enabled: boolean) => enabled ? lowPower : normal
export const isLowPowerMode = () => document.documentElement.dataset.lowPowerMode === 'true'
export interface VisualFrame { id: number, timer: boolean }

// Only visual effects use this clock. Audio, lyric timing and services keep theirs.
export const requestVisualFrame = (callback: FrameRequestCallback): VisualFrame => isLowPowerMode()
  ? { id: window.setTimeout(() => { callback(performance.now()) }, Math.ceil(1000 / 30)), timer: true }
  : { id: requestAnimationFrame(callback), timer: false }
export const cancelVisualFrame = (frame: VisualFrame | null) => {
  if (!frame) return
  if (frame.timer) clearTimeout(frame.id)
  else cancelAnimationFrame(frame.id)
}
