import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'
import { getLyricDetailFontFamily, parseFontStack } from '@common/fonts'
import { HOTKEY_COMMON } from '@common/hotKey'
import { musicInfo, isPlay, isShowPlayerDetail } from '@renderer/store/player/state'
import { lyric } from '@renderer/store/player/lyric'
import { playProgress } from '@renderer/store/player/playProgress'
import { getRawLyricLines } from '@renderer/core/lyric'
import { getAudioElement, createAudioAnalyser } from '@renderer/plugins/player'
import { FOLIA_CHANNEL, type FoliaConfig, type FoliaFrame, type FoliaSong } from './protocol'
import { buildTimeline, demoSong } from './timeline'
import { preferences } from './preferences'
import { createStageStateSender } from './stateSync'

export default (element: Ref<HTMLIFrameElement | null>, preview: boolean) => {
  const ready = ref(false)
  const failed = ref(false)
  let frameId = 0
  let loadTimer: ReturnType<typeof setTimeout> | undefined
  let analyser: ReturnType<typeof createAudioAnalyser> | undefined
  let frequency = new Uint8Array(0)
  let observer: MutationObserver | undefined
  let layoutObserver: ResizeObserver | undefined
  let controls: HTMLElement | null = null
  let disposed = false
  let buffering = false
  const audio = getAudioElement()
  const fontFamily = computed(() => getLyricDetailFontFamily(appSetting['common.font'], (appSetting as Partial<LX.AppSetting>)['playDetail.useAppFont']))
  const fontFamilies = computed(() => parseFontStack(fontFamily.value))
  const demoStart = performance.now()
  const offset = () => (lyric.offset + lyric.tempOffset) / 1000
  const send = (type: string, data: unknown) => {
    if (ready.value && !disposed) element.value?.contentWindow?.postMessage({ channel: FOLIA_CHANNEL, type, data }, '*')
  }
  const stateSender = createStageStateSender(send)
  const toggleFullscreen = () => {
    if (preview || disposed || !isShowPlayerDetail.value) return
    window.key_event.emit(HOTKEY_COMMON.fullscreen_toggle.action)
  }
  const fail = () => {
    failed.value = true
    ready.value = false
    cancelAnimationFrame(frameId)
    clearTimeout(loadTimer)
    analyser?.dispose()
    analyser = undefined
  }
  const syncState = () => {
    if (!ready.value || disposed) return
    const currentControls = preview ? null : element.value?.closest('[data-player-detail]')?.querySelector<HTMLElement>('[data-detail-part="controls"]') ?? null
    if (controls !== currentControls) {
      layoutObserver?.disconnect()
      controls = currentControls
      if (controls) {
        layoutObserver ??= new ResizeObserver(syncState)
        layoutObserver.observe(controls)
      }
    }
    const buildSong = (): FoliaSong => preview ? demoSong : {
      id: musicInfo.id ?? '',
      title: musicInfo.name,
      artist: musicInfo.singer,
      album: musicInfo.album,
      coverUrl: musicInfo.pic ?? '',
      duration: playProgress.maxPlayTime,
      lines: buildTimeline(getRawLyricLines(), playProgress.maxPlayTime),
    }
    const config: FoliaConfig = {
      mode: preferences.mode,
      language: window.i18n.locale,
      fontFamily: fontFamily.value,
      fontFamilies: fontFamilies.value,
      fontScale: Math.max(0.5, Math.min(2, appSetting['playDetail.style.fontSize'] / 140)),
      reducedMotion: document.documentElement.dataset.motionEnabled === 'false',
      bottomInset: controls?.offsetHeight ?? 0,
    }
    stateSender.sync(preview ? [demoSong] : [
      lyric.lines, musicInfo.id, musicInfo.name, musicInfo.singer, musicInfo.album,
      musicInfo.lrc, musicInfo.lxlrc, musicInfo.tlrc, musicInfo.rlrc, musicInfo.pic, playProgress.maxPlayTime,
    ], buildSong, config)
  }
  const syncFrame = () => {
    if (!ready.value || disposed) return false
    const playing = preview ? !isShowPlayerDetail.value : !audio.paused && !audio.ended && !audio.seeking && !buffering && audio.readyState >= 3
    if (!preview && playing && !analyser) {
      analyser = createAudioAnalyser()
      analyser.analyser.fftSize = 512
      frequency = new Uint8Array(analyser.analyser.frequencyBinCount)
    }
    if (analyser) analyser.analyser.getByteFrequencyData(frequency)
    const bands = [0, 0, 0, 0, 0]
    if (preview && playing) bands.fill(0.18 + Math.sin(performance.now() / 420) * 0.1)
    else if (playing && frequency.length) {
      const limits = [0, 4, 12, 36, 90, frequency.length]
      for (let band = 0; band < bands.length; band++) {
        for (let index = limits[band]; index < limits[band + 1]; index++) bands[band] += frequency[index] / 255
        bands[band] /= limits[band + 1] - limits[band]
      }
    }
    const frame: FoliaFrame = {
      time: preview ? ((performance.now() - demoStart) / 1000) % demoSong.duration : audio.currentTime + offset(),
      playing,
      rate: preview ? 1 : audio.playbackRate,
      power: bands.reduce((sum, value) => sum + value, 0) / bands.length,
      bands,
      spectrum: frequency,
    }
    send('frame', frame)
    return playing
  }
  let lastFrame = 0
  const tick = (now: number) => {
    if (disposed || !ready.value) return
    if (now - lastFrame >= 30) { lastFrame = now; if (!syncFrame()) return }
    frameId = requestAnimationFrame(tick)
  }
  const restartClock = () => {
    cancelAnimationFrame(frameId)
    if (syncFrame()) frameId = requestAnimationFrame(tick)
  }
  const receive = (event: MessageEvent) => {
    if (disposed || event.source !== element.value?.contentWindow || event.data?.channel !== FOLIA_CHANNEL) return
    if (event.data.type === 'ready') {
      clearTimeout(loadTimer)
      stateSender.reset()
      ready.value = true
      syncState()
      restartClock()
    } else if (event.data.type === 'error') fail()
    else if (event.data.type === 'toggle-fullscreen') toggleFullscreen()
    else if (event.data.type === 'exit-fullscreen' && document.documentElement.classList.contains('fullscreen')) toggleFullscreen()
    else if (event.data.type === 'seek' && !preview && Number.isFinite(event.data.data)) {
      window.app_event.setProgress(Math.max(0, Math.min(playProgress.maxPlayTime, event.data.data - offset())))
    }
  }
  const audioEvent = (event: Event) => {
    if (['waiting', 'stalled', 'seeking'].includes(event.type)) buffering = true
    else if (['playing', 'canplay', 'seeked'].includes(event.type)) buffering = false
    restartClock()
  }
  const audioEvents = ['playing', 'canplay', 'pause', 'ended', 'waiting', 'stalled', 'seeking', 'seeked', 'ratechange', 'timeupdate']
  watch([() => lyric.lines, () => musicInfo.id, () => musicInfo.name, () => musicInfo.singer, () => musicInfo.album, () => musicInfo.lrc, () => musicInfo.lxlrc, () => musicInfo.tlrc, () => musicInfo.rlrc, () => musicInfo.pic, () => preferences.mode, () => appSetting['common.langId'], fontFamily, () => appSetting['playDetail.style.fontSize'], () => playProgress.maxPlayTime], syncState, { flush: 'post' })
  watch([isPlay, () => lyric.offset, () => lyric.tempOffset, isShowPlayerDetail], restartClock, { flush: 'post' })
  watch(element, value => {
    ready.value = false
    cancelAnimationFrame(frameId)
    clearTimeout(loadTimer)
    layoutObserver?.disconnect()
    controls = null
    if (value) loadTimer = setTimeout(fail, 15000)
  })
  onMounted(() => {
    window.addEventListener('message', receive)
    if (!preview) for (const event of audioEvents) audio.addEventListener(event, audioEvent)
    observer = new MutationObserver(syncState)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion-enabled'] })
  })
  onBeforeUnmount(() => {
    disposed = true
    cancelAnimationFrame(frameId)
    clearTimeout(loadTimer)
    observer?.disconnect()
    layoutObserver?.disconnect()
    window.removeEventListener('message', receive)
    for (const event of audioEvents) audio.removeEventListener(event, audioEvent)
    analyser?.dispose()
  })
  return { ready, failed, toggleFullscreen, retry: () => { failed.value = false; void nextTick(syncState) } }
}
