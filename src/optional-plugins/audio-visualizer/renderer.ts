import { drawSpectrum } from './spectrum'
import { createRadialRenderer } from './radial'
import { normalizeStyle, type VisualizerStyle } from './styles'
import { getPerformancePolicy, isLowPowerMode } from './performance'

interface Bounds { x: number, y: number, width: number, height: number }
interface Options { style: VisualizerStyle, desktop?: boolean, preview?: boolean, time?: number, bounds?: Bounds }

export const createVisualizerRenderer = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext('2d')
  let width = 0
  let height = 0
  let radial: ReturnType<typeof createRadialRenderer> | null = null
  const emptySpectrum = new Uint8Array()
  const dispose = () => {
    if (!radial) return
    radial.dispose()
    radial = null
    delete canvas.dataset.visualizerEngine
  }
  return {
    dispose,
    resize(nextWidth: number, nextHeight: number) {
      width = Math.max(0, Math.round(nextWidth))
      height = Math.max(0, Math.round(nextHeight))
    },
    draw(data: Uint8Array, options: Options) {
      if (!context) return
      // CSS dimensions come from ResizeObserver; only the cheap DPR value is checked per frame.
      const policy = getPerformancePolicy(isLowPowerMode())
      const ratio = Math.min(window.devicePixelRatio || 1, policy.visualizerDpr, Math.sqrt(policy.visualizerPixels / Math.max(1, width * height)))
      const pixelWidth = Math.round(width * ratio)
      const pixelHeight = Math.round(height * ratio)
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      if (normalizeStyle(options.style) !== 'radial') {
        dispose()
        // A style change can precede the next desktop-lyric packet.
        drawSpectrum(context, data.length <= 128 ? data : emptySpectrum, { ...options, width, height })
        return
      }
      const area = options.bounds ?? { x: 0, y: 0, width, height }
      const size = Math.min(area.width, area.height, options.preview ? 220 : 640) * (options.preview ? 0.9 : 0.88)
      if (size < 8) return
      radial ??= createRadialRenderer()
      canvas.dataset.visualizerEngine = 'audioMotion-4.5.4'
      if (!radial.draw(data, size, options.time ?? performance.now())) return
      context.save()
      context.globalAlpha = options.preview ? 0.95 : options.desktop ? 0.4 : 0.32
      context.drawImage(radial.canvas, area.x + (area.width - size) / 2, area.y + (area.height - size) / 2, size, size)
      context.restore()
    },
  }
}
