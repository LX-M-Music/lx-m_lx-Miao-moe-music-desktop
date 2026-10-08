import { createAudioAnalyser } from '@renderer/plugins/player'
import { appSetting } from '@renderer/store/setting'
import { reactive, watch } from '@common/utils/vueTools'
import { setDesktopAnalyserProvider } from '@renderer/core/lyric'
import { preferences } from './preferences'
import { normalizeStyle, type VisualizerStyle } from './styles'
import { createRadialData, radialBins, RADIAL_FFT_SIZE, RADIAL_MIN_DB, RADIAL_MAX_DB } from './radialData'

let active = false
let source: ReturnType<typeof createAudioAnalyser> | null = null
let radialSource: ReturnType<typeof createAudioAnalyser> | null = null
let radialPacket = new Uint8Array()
const previews = reactive({ spectrum: 0, wave: 0, radial: 0 })
const needed = (radial: boolean) => {
  const matches = (style: VisualizerStyle) => (style === 'radial') === radial
  return (radial ? previews.radial > 0 : previews.spectrum + previews.wave > 0) ||
    (appSetting['desktopLyric.enable'] && appSetting['desktopLyric.audioVisualization'] && matches(preferences.desktop))
}
const release = () => {
  source?.dispose()
  source = null
  radialSource?.dispose()
  radialSource = null
  radialPacket = new Uint8Array()
}
const releaseUnused = () => {
  if (!needed(false)) { source?.dispose(); source = null }
  if (!needed(true)) { radialSource?.dispose(); radialSource = null; radialPacket = new Uint8Array() }
}
export const getFrequencyData = (style: VisualizerStyle = 'spectrum') => {
  const radial = normalizeStyle(style) === 'radial'
  if (!active || !needed(radial)) return new Uint8Array()
  if (radial) {
    if (!radialSource) {
      radialSource = createAudioAnalyser()
      radialSource.analyser.fftSize = RADIAL_FFT_SIZE
      radialSource.analyser.minDecibels = RADIAL_MIN_DB
      radialSource.analyser.maxDecibels = RADIAL_MAX_DB
      radialSource.analyser.smoothingTimeConstant = 0.7
      radialPacket = createRadialData(radialSource.analyser.context.sampleRate)
    }
    radialSource.analyser.getByteFrequencyData(radialBins(radialPacket))
    return radialPacket
  }
  source ??= createAudioAnalyser()
  const data = new Uint8Array(source.analyser.frequencyBinCount)
  source.analyser.getByteFrequencyData(data)
  return data
}
export const acquirePreview = (style: VisualizerStyle) => {
  previews[style]++
  let released = false
  return () => {
    if (released) return
    released = true
    previews[style] = Math.max(0, previews[style] - 1)
    releaseUnused()
  }
}
export const activate = () => {
  active = true
  setDesktopAnalyserProvider(() => getFrequencyData(preferences.desktop))
  const stop = watch(() => [needed(false), needed(true)], releaseUnused)
  return () => {
    active = false
    previews.spectrum = previews.wave = previews.radial = 0
    stop()
    setDesktopAnalyserProvider(null)
    release()
  }
}
