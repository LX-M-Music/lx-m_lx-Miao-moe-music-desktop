/* eslint-env browser, node */
// Run the whole file in the application's DevTools Console before reproducing.
(() => {
  if (!window.lxData?.playMusicInfo || !window.app_event) throw new Error('Run this in the LX-M Music application Console.')
  window.lxPlaybackDebug?.stop()
  const fs = require('node:fs')
  const path = require('node:path')
  const { ipcRenderer, shell } = require('electron')
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'lx-playback-debug-'))
  const logPath = path.join(directory, 'playback.jsonl')
  const started = performance.now()
  const dispose = []
  const pending = new Map()
  const media = new Map()
  let bytes = 0
  let sequence = 0
  let stopped = false
  let previousState = ''

  const address = value => {
    if (!value) return null
    try {
      const url = new URL(value)
      if (['http:', 'https:'].includes(url.protocol)) return { protocol: url.protocol, host: url.host }
      return { protocol: url.protocol }
    } catch { return { protocol: 'unknown' } }
  }
  const text = value => String(value ?? '')
    .replace(/https?:\/\/[^\s<>"']+/gi, value => {
      const url = address(value)
      return url?.host ? `${url.protocol}//${url.host}/[omitted]` : '[URL]'
    })
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/["']?\b(authorization|cookie|password|passwd|token|access_token|refresh_token|api[_-]?key|secret)["']?\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\n,;]+)/gi, '$1=[redacted]')
    .split(/\n\s*at\s/)[0].slice(0, 500)
  const song = value => {
    const item = value?.metadata?.musicInfo ?? value
    return item ? {
      id: text(item.id ?? item.songmid),
      source: text(item.source),
      name: text(item.name),
      singer: text(item.singer),
      album: text(item.meta?.albumName ?? item.albumName),
      songId: text(item.meta?.songId ?? item.songmid),
    } : null
  }
  const state = () => ({
    view: text(window.location.hash.split('?')[0]),
    selected: song(window.lxData.playMusicInfo.musicInfo),
    displayed: song(window.lxData.musicInfo),
    listId: text(window.lxData.playMusicInfo.listId),
    queueIndex: window.lxData.playInfo?.playerPlayIndex,
    status: text(window.lxData.status?.value ?? window.lxData.status),
    apiInitSettled: window.lx.apiInitPromise?.[1],
    stoppedByUser: window.lx.isPlayedStop,
  })
  const record = (stage, data = {}) => {
    if (stopped) return
    try {
      const line = JSON.stringify({ time: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started), sequence: ++sequence, stage, ...data }) + '\n'
      const size = Buffer.byteLength(line)
      if (bytes + size > 5 * 1024 * 1024) {
        console.warn('[PlaybackDebug] 5 MB limit reached. Run the script again to continue.')
        stop('size-limit')
        return
      }
      fs.appendFileSync(logPath, line)
      bytes += size
    } catch (error) {
      console.error('[PlaybackDebug] Cannot write the log:', text(error.message))
      stop('write-error')
    }
  }
  const mediaState = element => ({
    mediaId: media.get(element)?.id,
    address: address(element.currentSrc || element.getAttribute('src')),
    paused: element.paused,
    ended: element.ended,
    currentTime: element.currentTime,
    duration: Number.isFinite(element.duration) ? element.duration : null,
    readyState: element.readyState,
    networkState: element.networkState,
    errorCode: element.error?.code ?? null,
    errorMessage: text(element.error?.message),
    buffered: Array.from({ length: Math.min(element.buffered.length, 5) }, (_, index) => [element.buffered.start(index), element.buffered.end(index)]),
  })
  const observeMedia = element => {
    if (stopped || element.tagName !== 'AUDIO' || media.has(element)) return
    media.set(element, { id: media.size + 1 })
    for (const event of ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'pause', 'waiting', 'stalled', 'suspend', 'ended', 'emptied', 'error']) {
      const listener = () => record('media-' + event, { ...mediaState(element), selectedId: state().selected?.id })
      element.addEventListener(event, listener)
      dispose.push(() => element.removeEventListener(event, listener))
    }
    record('media-observed', mediaState(element))
  }
  const replace = (target, key, wrapper) => {
    const original = target[key]
    target[key] = wrapper(original)
    const installed = target[key]
    dispose.push(() => { if (target[key] === installed) target[key] = original })
  }

  const watched = new Set(['winMain_request_user_api', 'winMain_get_music_url'])
  replace(ipcRenderer, 'invoke', original => function(channel, ...args) {
    if (!watched.has(channel) || stopped) return Reflect.apply(original, this, [channel, ...args])
    const request = args[0]
    const requestId = 'request-' + (sequence + 1)
    const requestStart = performance.now()
    const details = channel === 'winMain_request_user_api'
      ? { requestKey: text(request?.requestKey), source: text(request?.data?.source), action: text(request?.data?.action), quality: text(request?.data?.info?.type), song: song(request?.data?.info?.musicInfo) }
      : { cacheKey: text(request) }
    const kind = channel === 'winMain_request_user_api' ? 'source' : 'cache'
    pending.set(requestId, { ...details, kind, startedMs: requestStart })
    record(kind + '-request', { requestId, ...details, selectedId: state().selected?.id })
    const finish = (stage, data) => {
      pending.delete(requestId)
      record(stage, { requestId, ...details, durationMs: Math.round(performance.now() - requestStart), selectedId: state().selected?.id, ...data })
    }
    let result
    try { result = Reflect.apply(original, this, [channel, ...args]) } catch (error) {
      finish(kind + '-error', { message: text(error.message) })
      throw error
    }
    // Observe the original promise; preserve its identity, values and rejection.
    result.then(value => {
      const url = kind === 'source' ? value?.data?.url : value
      finish(kind + '-response', { hasUrl: typeof url === 'string' && !!url, address: address(url) })
    }, error => finish(kind + '-error', { message: text(error.message), code: text(error.code) })).catch(() => {})
    return result
  })
  replace(ipcRenderer, 'send', original => function(channel, ...args) {
    if (channel === 'winMain_request_user_api_cancel') record('source-cancel', { requestKey: text(args[0]), selectedId: state().selected?.id })
    return Reflect.apply(original, this, [channel, ...args])
  })
  for (const method of ['play', 'pause', 'load']) {
    replace(HTMLMediaElement.prototype, method, original => function(...args) {
      observeMedia(this)
      record('media-call-' + method, mediaState(this))
      return Reflect.apply(original, this, args)
    })
  }
  const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')
  const setSrc = function(value) {
    observeMedia(this)
    record('media-source', { mediaId: media.get(this)?.id, address: address(value), selectedId: state().selected?.id })
    return src.set.call(this, value)
  }
  Object.defineProperty(HTMLMediaElement.prototype, 'src', { ...src, get: src.get, set: setSrc })
  dispose.push(() => { if (Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src').set === setSrc) Object.defineProperty(HTMLMediaElement.prototype, 'src', src) })
  document.querySelectorAll('audio').forEach(observeMedia)
  for (const event of ['play', 'pause', 'stop', 'error', 'playerPlaying', 'playerPause', 'playerWaiting', 'playerCanplay', 'playerLoadeddata', 'playerLoadstart', 'playerError', 'playerEnded']) {
    const listener = code => record('app-' + event, { ...state(), errorCode: typeof code === 'number' ? code : null })
    window.app_event.on(event, listener)
    dispose.push(() => window.app_event.off(event, listener))
  }
  const onClick = event => {
    const row = event.target instanceof Element ? event.target.closest('[data-song-id]') : null
    if (row) record('row-' + event.type, { songId: text(row.getAttribute('data-song-id')), name: text(row.querySelector('[data-music-cell="name"]')?.textContent), ...state() })
  }
  for (const event of ['click', 'dblclick']) {
    document.addEventListener(event, onClick, true)
    dispose.push(() => document.removeEventListener(event, onClick, true))
  }
  const onError = event => record('renderer-error', { message: text(event.message ?? event.reason?.message ?? event.reason) })
  for (const event of ['error', 'unhandledrejection']) {
    window.addEventListener(event, onError)
    dispose.push(() => window.removeEventListener(event, onError))
  }
  const poll = setInterval(() => {
    const current = state()
    const signature = JSON.stringify(current)
    if (signature !== previousState) { previousState = signature; record('player-state', current) }
  }, 250)
  const heartbeat = setInterval(() => record('heartbeat', { ...state(), media: [...media.keys()].map(mediaState), pending: [...pending.entries()].map(([requestId, value]) => ({ requestId, kind: value.kind, requestKey: value.requestKey, ageMs: Math.round(performance.now() - value.startedMs) })) }), 2000)
  const lifetime = setTimeout(() => stop('30-minute-limit'), 30 * 60 * 1000)
  dispose.push(() => { clearInterval(poll); clearInterval(heartbeat); clearTimeout(lifetime) })
  const beforeUnload = () => stop('page-unload')
  window.addEventListener('beforeunload', beforeUnload)
  dispose.push(() => window.removeEventListener('beforeunload', beforeUnload))

  function stop(reason = 'manual') {
    if (stopped) return logPath
    if (reason !== 'size-limit' && reason !== 'write-error') record('stop', { reason, ...state(), pendingCount: pending.size })
    stopped = true
    for (const cleanup of dispose.reverse()) { try { cleanup() } catch {} }
    media.clear()
    pending.clear()
    console.info('[PlaybackDebug] Stopped. Log:', logPath)
    return logPath
  }
  window.lxPlaybackDebug = {
    logPath,
    stop,
    openLog: () => shell.showItemInFolder(logPath),
    mark: message => record('marker', { message: text(message), ...state() }),
  }
  const settings = window.lxData.appSetting
  record('start', {
    version: text(window.lxData.versionInfo?.version),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    settings: Object.fromEntries(['common.apiSource', 'player.playQuality', 'player.autoSkipOnError', 'player.togglePlayMethod', 'player.startupAutoPlay', 'player.isSavePlayTime', 'player.gaplessPlayback'].map(key => [key, typeof settings[key] === 'string' ? text(settings[key]) : settings[key]])),
    ...state(),
  })
  ipcRenderer.invoke('winMain_get_user_api_status').then(value => record('source-status', { ready: value.status, name: text(value.apiInfo?.name), version: text(value.apiInfo?.version), message: text(value.message) })).catch(error => record('source-status-error', { message: text(error.message) }))
  console.info('[PlaybackDebug] Ready. Log:', logPath)
  return logPath
})()
