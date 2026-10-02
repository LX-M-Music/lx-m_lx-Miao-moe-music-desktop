interface VisualFrame { id: number, timer: boolean }
interface PerformanceHost {
  isLowPowerMode: () => boolean
  getPerformancePolicy: (enabled: boolean) => { visualizerPixels: number, visualizerDpr: number }
  requestVisualFrame: (callback: FrameRequestCallback) => VisualFrame
  cancelVisualFrame: (frame: VisualFrame | null) => void
}
const host = () => (window as Window & { __lxPluginHost?: { performance?: PerformanceHost } }).__lxPluginHost?.performance

// Older hosts have no performance API. Keep their original rendering behavior.
export const isLowPowerMode = () => host()?.isLowPowerMode() ?? false
export const getPerformancePolicy = (enabled: boolean) => host()?.getPerformancePolicy(enabled) ?? { visualizerPixels: 8_000_000, visualizerDpr: 2 }
export const requestVisualFrame = (callback: FrameRequestCallback): VisualFrame => host()?.requestVisualFrame(callback) ?? { id: requestAnimationFrame(callback), timer: false }
export const cancelVisualFrame = (frame: VisualFrame | null) => {
  if (!frame) return
  const api = host()
  if (api) api.cancelVisualFrame(frame)
  else if (frame.timer) clearTimeout(frame.id)
  else cancelAnimationFrame(frame.id)
}
