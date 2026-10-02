import AudioMotionAnalyzer from 'audiomotion-analyzer'
import { RADIAL_FFT_SIZE, RADIAL_MIN_DB, RADIAL_MAX_DB, readRadialData } from './radialData'
import { isLowPowerMode } from './performance'

type FrameAnalyzer = AudioMotionAnalyzer & { renderFrame: (timestamp: number) => void }

// audioMotion owns rendering and logarithmic frequency bands. This small input
// adapter supplies the player's FFT to every canvas, including desktop lyrics,
// without opening audio devices or creating an AudioContext in another window.
export const createRadialRenderer = () => {
  let bins: Uint8Array = new Uint8Array()
  const context = {
    sampleRate: 48000,
    state: 'running',
    createGain: () => ({ ...node(), gain: { value: 1 } }),
    createChannelSplitter: () => node(),
    createChannelMerger: () => node(),
    createAnalyser: () => ({
      ...node(),
      fftSize: RADIAL_FFT_SIZE,
      get frequencyBinCount(): number { return this.fftSize / 2 },
      minDecibels: RADIAL_MIN_DB,
      maxDecibels: RADIAL_MAX_DB,
      smoothingTimeConstant: 0.7,
      getFloatFrequencyData: (output: Float32Array) => {
        for (let i = 0; i < output.length; i++) output[i] = bins[i] ? RADIAL_MIN_DB + bins[i] / 255 * (RADIAL_MAX_DB - RADIAL_MIN_DB) : -Infinity
      },
    }),
  }
  function node() { return { context, connect() {}, disconnect() {} } }
  const canvas = document.createElement('canvas')
  const analyzer = new AudioMotionAnalyzer(document.createElement('div'), {
    audioCtx: context as unknown as AudioContext,
    canvas,
    connectSpeakers: false,
    start: false,
    width: 128,
    height: 128,
    fftSize: RADIAL_FFT_SIZE,
    minDecibels: RADIAL_MIN_DB,
    maxDecibels: RADIAL_MAX_DB,
    minFreq: 30,
    maxFreq: 16000,
    mode: 4,
    radial: true,
    radius: 0.75,
    mirror: -1,
    barSpace: 0.2,
    gradient: 'prism',
    showPeaks: false,
    showScaleX: false,
    showScaleY: false,
    showBgColor: false,
    overlay: true,
    bgAlpha: 0,
  }) as FrameAnalyzer
  let pixels = 0
  let lastRatio = 0
  return {
    canvas,
    draw(packet: Uint8Array, size: number, timestamp: number) {
      const frame = readRadialData(packet)
      if (!frame || !frame.bins.some(value => value > 0)) return false
      bins = frame.bins
      if (context.sampleRate !== frame.sampleRate) {
        context.sampleRate = frame.sampleRate
        analyzer.setFreqRange(30, Math.min(16000, frame.sampleRate / 2))
      }
      const ratio = window.devicePixelRatio || 1
      const nextPixels = Math.max(32, Math.min(isLowPowerMode() ? 640 : 1400, Math.round(size * Math.min(ratio, isLowPowerMode() ? 1 : 2))))
      if (pixels !== nextPixels || lastRatio !== ratio) {
        pixels = nextPixels
        lastRatio = ratio
        analyzer.setCanvasSize(pixels / ratio, pixels / ratio)
      }
      analyzer.renderFrame(timestamp)
      return true
    },
    dispose() {
      analyzer.destroy()
      canvas.width = canvas.height = 0
      bins = new Uint8Array()
    },
  }
}
