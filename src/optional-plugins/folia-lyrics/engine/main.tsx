import './adapters/frameRate'
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig, motionValue } from 'framer-motion'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { FOLIA_CHANNEL, FOLIA_INTERACTIVE_TARGETS, type FoliaConfig, type FoliaFrame, type FoliaSong } from '../protocol'
import { getLineRenderEndTime } from './vendor/src/utils/lyrics/renderHints'
import { DEFAULT_MONET_TUNING } from './vendor/src/types'
import { playerBottomInset } from './adapters/bottomBar'
import './styles.css'

// React receives discrete song/configuration updates; its lyric clock remains a MotionValue.
const renderers = {
  classic: React.lazy(() => import('./vendor/src/components/visualizer/classic/Visualizer')),
  fume: React.lazy(() => import('./vendor/src/components/visualizer/fume/VisualizerFume')),
  partita: React.lazy(() => import('./vendor/src/components/visualizer/partita/VisualizerPartita')),
  tilt: React.lazy(() => import('./vendor/src/components/visualizer/tilt/VisualizerTilt')),
  cadenza: React.lazy(() => import('./vendor/src/components/visualizer/cadenza/VisualizerCadenza')),
  cappella: React.lazy(() => import('./vendor/src/components/visualizer/cappella/VisualizerCappella')),
  claddagh: React.lazy(() => import('./vendor/src/components/visualizer/claddagh/VisualizerCladdagh')),
  diorama: React.lazy(() => import('./vendor/src/components/visualizer/diorama/VisualizerDiorama')),
  monet: React.lazy(() => import('./vendor/src/components/visualizer/monet/VisualizerMonet')),
  pendolo: React.lazy(() => import('./vendor/src/components/visualizer/pendolo/VisualizerPendolo')),
  sonnet: React.lazy(() => import('./vendor/src/components/visualizer/sonnet/VisualizerSonnet')),
  tempera: React.lazy(() => import('./vendor/src/components/visualizer/tempera/VisualizerTempera')),
  still: React.lazy(() => import('./vendor/src/components/visualizer/still/VisualizerStill')),
}
void i18n.use(initReactI18next).init({ lng: 'zh', fallbackLng: 'en', interpolation: { escapeValue: false }, resources: {
  zh: { translation: { ui: { waitingForMusic: '等待歌词', noTrack: '暂无歌曲' }, common: { reset: '重置' } } },
  en: { translation: { ui: { waitingForMusic: 'Waiting for lyrics', noTrack: 'No track' }, common: { reset: 'Reset' } } },
} })
const currentTime = motionValue(0)
const audioPower = motionValue(0)
const audioBands = { bass: motionValue(0), lowMid: motionValue(0), mid: motionValue(0), vocal: motionValue(0), treble: motionValue(0), spectrum: motionValue(new Uint8Array(0)) }
const send = (type: string, data?: unknown) => parent.postMessage({ channel: FOLIA_CHANNEL, type, data }, '*')
const seek = (time: number) => send('seek', time)
const theme = { name: 'LX-M Folia', backgroundColor: '#111b2c', primaryColor: '#f5f7fb', secondaryColor: '#a9bed0', accentColor: '#74dab5', fontStyle: 'sans' as const, animationIntensity: 'normal' as const }
const monetTuning = { ...DEFAULT_MONET_TUNING, showAudioVisualization: false }
let webGLAvailable: boolean | undefined
function hasWebGL() {
  if (webGLAvailable === undefined) {
    const context = document.createElement('canvas').getContext('webgl2')
    webGLAvailable = !!context
    context?.getExtension('WEBGL_lose_context')?.loseContext()
  }
  return webGLAvailable
}

class RenderBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { send('error', error.message) }
  render() { return this.state.failed ? null : this.props.children }
}
function App() {
  const [state, setState] = useState<{ song: FoliaSong, config: FoliaConfig } | null>(null)
  const [lineIndex, setLineIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [, setPausedTime] = useState(0)
  const stateRef = useRef(state)
  // Renderer layout/scene caches depend on theme identity, not only its values.
  const rendererTheme = useMemo(() => ({
    ...theme,
    fontFamily: state?.config.fontFamilies?.[0] || state?.config.fontFamily || undefined,
    fontFamilyStack: state?.config.fontFamilies?.slice(1),
  }), [state?.config.fontFamily])
  useEffect(() => {
    let frameId = 0
    let clock: FoliaFrame | null = null
    let clockAt = 0
    let previousLineIndex: number | null = null
    let previousPlaying = false
    const applyTime = (time: number) => {
      currentTime.set(time)
      const lines = stateRef.current?.song.lines ?? []
      let low = 0, high = lines.length - 1, index = -1
      while (low <= high) {
        const mid = (low + high) >> 1
        if (lines[mid].startTime <= time) { index = mid; low = mid + 1 } else high = mid - 1
      }
      if (index >= 0 && time > getLineRenderEndTime(lines[index])) index = -1
      if (index !== previousLineIndex) {
        previousLineIndex = index
        setLineIndex(index)
        document.documentElement.dataset.line = String(index)
      }
      document.documentElement.dataset.time = time.toFixed(3)
    }
    const tick = () => {
      if (!clock?.playing) return
      applyTime(clock.time + Math.min((performance.now() - clockAt) / 1000, 0.15) * clock.rate)
      frameId = requestAnimationFrame(tick)
    }
    const receive = (event: MessageEvent) => {
      if (event.source !== parent || event.data?.channel !== FOLIA_CHANNEL) return
      const { type, data } = event.data
      if (type === 'state' || type === 'config') {
        const next = type === 'config' ? stateRef.current && { ...stateRef.current, config: data } : data
        if (!next || !renderers[next.config?.mode as keyof typeof renderers] || !Array.isArray(next.song?.lines)) return
        playerBottomInset.set(Math.max(0, Number(next.config.bottomInset) || 0))
        stateRef.current = next
        setState(next)
        const language = next.config.language.startsWith('zh') ? 'zh' : 'en'
        if (i18n.language !== language) void i18n.changeLanguage(language)
        document.documentElement.dataset.mode = next.config.mode
        if (clock) applyTime(clock.time)
      } else if (type === 'frame' && Number.isFinite(data?.time)) {
        clock = data
        clockAt = performance.now()
        cancelAnimationFrame(frameId)
        if (data.playing !== previousPlaying) { previousPlaying = data.playing; setPlaying(data.playing) }
        // Canvas modes stop their RAF while paused; a seek still needs one fresh draw.
        if (!data.playing) setPausedTime(data.time)
        if (document.documentElement.dataset.playing !== String(data.playing)) document.documentElement.dataset.playing = String(data.playing)
        audioPower.set(data.power)
        ;[audioBands.bass, audioBands.lowMid, audioBands.mid, audioBands.vocal, audioBands.treble].forEach((band, index) => band.set(data.bands[index] ?? 0))
        audioBands.spectrum.set(data.spectrum)
        applyTime(data.time)
        if (data.playing) frameId = requestAnimationFrame(tick)
      }
    }
    const doubleClick = (event: MouseEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest(FOLIA_INTERACTIVE_TARGETS)) return
      event.preventDefault()
      send('toggle-fullscreen')
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || !(event.target instanceof Element) || event.target.closest(FOLIA_INTERACTIVE_TARGETS)) return
      send('exit-fullscreen')
    }
    window.addEventListener('message', receive)
    window.addEventListener('dblclick', doubleClick, true)
    window.addEventListener('keydown', keyDown)
    send('ready')
    return () => {
      window.removeEventListener('message', receive)
      window.removeEventListener('dblclick', doubleClick, true)
      window.removeEventListener('keydown', keyDown)
      cancelAnimationFrame(frameId)
    }
  }, [])
  if (!state) return null
  const { song, config } = state
  const Renderer = renderers[config.mode]
  if (!song.lines.length) return <div className="folia-empty">{config.language.startsWith('zh') ? '暂无歌词' : 'No lyrics available'}</div>
  if (['diorama', 'sonnet', 'tempera'].includes(config.mode) && !hasWebGL()) {
    return <div className="folia-empty" data-folia-unavailable role="status">{config.language.startsWith('zh') ? '此样式需要 WebGL，请启用硬件加速或选择其他样式。' : 'This style needs WebGL. Enable hardware acceleration or choose another style.'}</div>
  }
  return <MotionConfig reducedMotion={config.reducedMotion ? 'always' : 'never'}>
    <RenderBoundary key={config.mode + song.id}>
      <Suspense fallback={null}>
        <Renderer currentTime={currentTime} currentLineIndex={lineIndex} lines={song.lines} theme={rendererTheme}
          audioPower={audioPower} audioBands={audioBands} showText paused={!playing} staticMode={config.reducedMotion}
          songTitle={song.title} songArtist={song.artist} songAlbum={song.album} coverUrl={song.coverUrl || undefined} seed={song.id}
          lyricsFontScale={config.fontScale} isPlayerChromeHidden showSubtitleTranslation
          monetTuning={monetTuning}
          onLyricLineSeek={seek} />
      </Suspense>
    </RenderBoundary>
  </MotionConfig>
}
createRoot(document.getElementById('root')!).render(<App />)
