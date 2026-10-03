const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')
const invoke = (page, channel, params) => page.evaluate(({ channel, params }) => require('electron').ipcRenderer.invoke(channel, params), { channel, params })
const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#297c88"/></svg>'

test('playback diagnostics observe real source cancellation, audio progress and deadlines without changing playback', { timeout: 100000 }, async t => {
  const samples = 8000 * 90
  const audio = Buffer.alloc(44 + samples * 2)
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8)
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34)
  audio.write('data', 36); audio.writeUInt32LE(samples * 2, 40)
  const requested = new Set(), closed = new Set(), completed = new Set()
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture').pathname
    requested.add(url)
    res.on('close', () => closed.add(url))
    if (url.startsWith('/slow-')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      const timer = setTimeout(() => { completed.add(url); res.end(JSON.stringify({ url: base + '/audio.wav?token=URL_TOKEN_SECRET' })) }, 2500)
      res.on('close', () => clearTimeout(timer))
      return
    }
    res.writeHead(200, { 'Content-Type': req.url === '/cover.svg' ? 'image/svg+xml' : 'audio/wav', 'Content-Length': req.url === '/cover.svg' ? Buffer.byteLength(artwork) : audio.length, 'Access-Control-Allow-Origin': '*' })
    res.end(req.url === '/cover.svg' ? artwork : audio)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  const output = path.resolve('output/playwright/recording-repro-171322/runtime')
  await fs.mkdir(output, { recursive: true })
  t.after(async() => {
    await app.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  page.setDefaultTimeout(8000)
  const script = '/**\n * @name Playback diagnostic fixture\n * @version 1.0.0\n */\n' + `
    lx.on(lx.EVENT_NAMES.request, async ({info}) => {
      const name = info.musicInfo.name;
      if (name === 'never') return new Promise(() => {});
      if (name === 'rejected') throw new Error('HTTP 403 https://user:URL_SECRET@example.invalid/KEY_SECRET/audio?token=QUERY_SECRET api_key=API_SECRET');
      if (name.startsWith('slow')) return new Promise((resolve, reject) => lx.request(${JSON.stringify(base)} + '/' + name, {timeout: 8000}, (error, response, body) => error ? reject(error) : resolve(body.url)));
      return ${JSON.stringify(base + '/audio.wav?token=URL_TOKEN_SECRET')};
    });
    lx.send(lx.EVENT_NAMES.inited, {sources:{tx:{type:'music',actions:['musicUrl'],qualitys:['128k']}}});`
  const imported = await invoke(page, 'winMain_import_user_api', script)
  await page.evaluate(id => window.lxData.updateSetting({
    'common.apiSource': id, 'player.playQuality': '128k', 'player.autoSkipOnError': false,
    'player.startupAutoPlay': false, 'player.gaplessPlayback': false,
  }), imported.apiInfo.id)
  await page.waitForFunction(() => window.lx.apiInitPromise[1])
  const status = await invoke(page, 'winMain_get_user_api_status')
  assert.equal(status.apiInfo.id, imported.apiInfo.id)
  assert.equal(status.status, true)
  const songs = ['fast', 'slow-a', 'slow-b', 'never'].map((name, index) => ({
    id: 'tx_diagnostic_' + index, name, singer: 'Diagnostic fixture', source: 'tx', interval: '01:30',
    meta: { songId: 'diagnostic_' + index, strMediaMid: 'diagnostic_' + index, albumName: 'Diagnostic', picUrl: base + '/cover.svg', qualitys: [], _qualitys: { '128k': {} } },
  }))
  await invoke(page, 'player_list_add', { position: 0, listInfos: [{ id: 'playback-diagnostic', name: 'Playback diagnostic', source: 'tx', sourceListId: 'diagnostic', locationUpdateTime: null }] })
  await invoke(page, 'player_list_music_overwrite', { listId: 'playback-diagnostic', musicInfos: songs })
  await route(page, '/list?id=playback-diagnostic')
  await settled(page)
  await page.evaluate(() => {
    window.__diagnosticOriginal = {
      invoke: require('electron').ipcRenderer.invoke, send: require('electron').ipcRenderer.send,
      play: HTMLMediaElement.prototype.play, pause: HTMLMediaElement.prototype.pause, load: HTMLMediaElement.prototype.load,
      src: Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src'),
    }
  })
  const diagnostic = await fs.readFile('doc/diagnostics/playback-debug.js', 'utf8')
  const logPath = await page.evaluate(diagnostic)
  const read = async() => (await fs.readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  const waitForPlaying = async name => {
    const started = Date.now()
    while (!(await read()).some(record => record.stage === 'heartbeat' && record.selected?.name === name && record.media.some(element => !element.paused && element.currentTime > 0.4))) {
      if (Date.now() - started > 8000) throw Error('Audio did not progress for ' + name)
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  const play = async(name) => {
    await route(page, '/list?id=playback-diagnostic')
    await settled(page)
    const song = songs.find(item => item.name === name)
    await page.locator(`[data-song-id="${song.id}"] [data-music-cell="name"]`).dblclick()
    await page.waitForFunction(id => window.lxData.playMusicInfo.musicInfo?.id === id, song.id)
  }
  await t.test('successful URL reaches the audio engine and progresses', async() => {
    await play('fast')
    await waitForPlaying('fast')
    const records = await read()
    assert(records.some(record => record.stage === 'source-response' && record.hasUrl))
    assert(records.some(record => record.stage === 'media-playing' && record.address?.host === new URL(base).host))
    await page.screenshot({ path: path.join(output, 'fast-playing.png') })
  })
  await t.test('quick switching cancels the old request and eventually plays the latest track', async() => {
    await play('slow-a')
    const requestStart = Date.now()
    while (!requested.has('/slow-a')) {
      if (Date.now() - requestStart > 2000) throw Error('Slow request was not started')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    await page.waitForTimeout(300)
    await play('slow-b')
    await page.screenshot({ path: path.join(output, 'slow-switch-loading.png') })
    const cancelStart = Date.now()
    while (!closed.has('/slow-a')) {
      if (Date.now() - cancelStart > 1200) throw Error('Old track network connection was not closed after switching')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(completed.has('/slow-a'), false, 'cancellation aborts the upstream connection before it produces a URL')
    assert.equal(closed.has('/slow-b'), false, 'the current track request remains active')
    await waitForPlaying('slow-b')
    const records = await read()
    const a = records.find(record => record.stage === 'source-request' && record.song?.name === 'slow-a')
    assert(a)
    assert(records.some(record => record.stage === 'source-cancel' && record.requestKey === a.requestKey))
    assert(records.some(record => record.stage === 'source-error' && record.requestId === a.requestId))
    assert(!records.some(record => record.stage === 'source-response' && record.requestId === a.requestId))
    assert(records.some(record => record.stage === 'media-playing' && record.selectedId === songs[2].id))
    await route(page, '/list?id=playback-diagnostic')
    await settled(page)
    await page.screenshot({ path: path.join(output, 'slow-switch-recovered.png') })
  })
  await t.test('failed source responses and markers omit credentials and signed URLs', async() => {
    await assert.rejects(invoke(page, 'winMain_request_user_api', { requestKey: 'redaction-fixture', data: { source: 'tx', action: 'musicUrl', info: { type: '128k', musicInfo: { name: 'rejected' } } } }), /HTTP 403/)
    await page.evaluate(() => window.lxPlaybackDebug.mark('问题出现 https://user:MARK_SECRET@audio.invalid/PATH_SECRET?token=MARK_QUERY_SECRET token=MARK_TOKEN_SECRET'))
    const log = await fs.readFile(logPath, 'utf8')
    for (const secret of ['URL_SECRET', 'KEY_SECRET', 'QUERY_SECRET', 'API_SECRET', 'URL_TOKEN_SECRET', 'MARK_SECRET', 'PATH_SECRET', 'MARK_QUERY_SECRET', 'MARK_TOKEN_SECRET']) assert(!log.includes(secret), secret)
    assert((await read()).some(record => record.stage === 'source-error' && record.requestKey === 'redaction-fixture' && record.message.includes('HTTP 403')))
  })
  await t.test('a source which never answers ends with a visible error instead of indefinite loading', async() => {
    const started = Date.now()
    await play('never')
    await page.waitForFunction(() => /ETIMEDOUT|AUDIO_URL_LOAD_FAILED/.test(String(window.lxData.status.value)), null, { timeout: 38000 })
    assert(Date.now() - started < 36000)
    assert.equal(await page.evaluate(() => window.lxData.playMusicInfo.musicInfo.name), 'never')
    const records = await read()
    assert(records.some(record => record.stage === 'source-request' && record.song?.name === 'never'))
    assert(records.some(record => record.stage === 'app-error' && /ETIMEDOUT|AUDIO_URL_LOAD_FAILED/.test(record.status)))
    await page.screenshot({ path: path.join(output, 'never-source-error.png') })
  })
  await t.test('stopping restores all hooks and keeps the log readable after exit', async() => {
    assert.deepEqual(await page.evaluate(() => {
      window.lxPlaybackDebug.stop()
      const old = window.__diagnosticOriginal
      return ['invoke', 'send'].map(key => require('electron').ipcRenderer[key] === old[key])
        .concat(['play', 'pause', 'load'].map(key => HTMLMediaElement.prototype[key] === old[key]))
        .concat(Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src').set === old.src.set)
    }), [true, true, true, true, true, true])
    const before = (await fs.stat(logPath)).size
    await page.waitForTimeout(300)
    assert.equal((await fs.stat(logPath)).size, before)
    await fs.copyFile(logPath, path.join(output, 'playback.jsonl'))
    assert.equal((await read()).at(-1).stage, 'stop')
  })
  await t.test('the documented local-file command works and repeat execution removes old observers', async() => {
    const nextPath = await page.evaluate(filename => require('node:vm').runInThisContext(require('node:fs').readFileSync(filename, 'utf8')), path.resolve('doc/diagnostics/playback-debug.js'))
    const finalPath = await page.evaluate(diagnostic)
    assert.notEqual(nextPath, finalPath)
    assert.equal(JSON.parse((await fs.readFile(nextPath, 'utf8')).trim().split('\n').at(-1)).stage, 'stop')
    assert.equal(await page.evaluate(() => {
      window.lxPlaybackDebug.stop()
      return require('electron').ipcRenderer.invoke === window.__diagnosticOriginal.invoke && HTMLMediaElement.prototype.play === window.__diagnosticOriginal.play
    }), true)
  })
  assert.deepEqual(fixture.errors, [])
  t.diagnostic('Playback trace and screenshots: ' + output)
})
