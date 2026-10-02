const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled, seedTrack, showDetail } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, install, startSilentAudio } = require('./helpers/plugin-fixture.cjs')

const artifacts = path.resolve('output/playwright/low-power')
const background = '[data-ambient-background="shared"]'
const update = async(page, setting) => {
  await page.evaluate(setting => window.lxData.updateSetting(setting), setting)
  await page.waitForFunction(setting => Object.entries(setting).every(([key, value]) => window.lxData.appSetting[key] === value), setting)
}
const backend = (page, value) => page.waitForFunction(({ background, value }) => document.querySelector(background)?.dataset.ambientRenderer === value, { background, value })
const keptPreferences = ['common.isShowAnimation', 'ui.smoothAnimation', 'ui.ambientBackground', 'ui.ambientBackgroundQuality', 'ui.ambientBackgroundAutoContrast', 'ui.ambientBackgroundPlayDetailMask', 'player.gaplessPlayback', 'player.fadeInFadeOut', 'player.playbackRate', 'player.audioVisualization', 'desktopLyric.audioVisualization', 'player.isShowLyricTranslation', 'player.isShowLyricRoma']
const preferences = page => page.evaluate(keys => Object.fromEntries(keys.map(key => [key, window.lxData.appSetting[key]])), keptPreferences)
const playing = page => page.evaluate(() => {
  const audio = window.__lxPluginHost.player.getAudioElement()
  return { paused: audio.paused, time: audio.currentTime, source: audio.src, rate: audio.playbackRate }
})
const clockAdvances = async(page, before) => {
  await page.waitForFunction(before => {
    const audio = window.__lxPluginHost.player.getAudioElement()
    return !audio.paused && audio.src === before.source && audio.currentTime !== before.time && audio.playbackRate === before.rate
  }, before)
}

test('Advanced low power switches live, releases WebGL, preserves playback and persists locally', { timeout: 120000 }, async t => {
  await fs.mkdir(artifacts, { recursive: true })
  let fixture = await launch({ disableHardwareAcceleration: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-backgrounding-occluded-windows'] })
  const output = fixture.output
  t.after(async() => fixture.app.close())
  let { app, page } = fixture
  page.setDefaultTimeout(12000)
  assert.equal(await page.evaluate(() => window.lxData.appSetting['ui.lowPowerMode']), false)
  await update(page, { 'ui.ambientBackground': false })
  await page.locator(background).waitFor({ state: 'detached' })
  await page.evaluate(() => {
    window.__lowPowerPrograms = new Set()
    const prototype = WebGLRenderingContext.prototype
    const create = prototype.createProgram
    const remove = prototype.deleteProgram
    prototype.createProgram = function() {
      const program = create.call(this)
      if (this.canvas.closest('[data-ambient-background]')) window.__lowPowerPrograms.add(program)
      return program
    }
    prototype.deleteProgram = function(program) { window.__lowPowerPrograms.delete(program); return remove.call(this, program) }
  })
  await update(page, { 'ui.ambientBackground': true, 'ui.ambientBackgroundQuality': 'full', 'ui.ambientBackgroundAutoContrast': true, 'player.isShowLyricTranslation': true })
  await seedTrack(page)
  await page.evaluate(() => {
    window.lx.isPlayedStop = false
    window.lxData.musicInfo.lrc = '[00:00.000]First lyric\n[00:00.600]Second lyric\n[00:01.200]Third lyric'
    window.lxData.musicInfo.tlrc = '[00:00.000]第一句\n[00:00.600]第二句\n[00:01.200]第三句'
    window.app_event.lyricUpdated()
  })
  await page.evaluate(() => { window.__lxPluginHost.player.getAudioElement().muted = true })
  await startSilentAudio(page, 30)
  await backend(page, 'kawarp')
  await page.waitForFunction(() => window.__lowPowerPrograms.size === 2)
  await route(page, '/setting?name=SettingAdvanced')
  await settled(page)
  await page.locator('#setting_advanced_low_power_enabled').waitFor({ state: 'attached' })
  const before = await preferences(page)
  const audio = await playing(page)
  await page.locator('label[for="setting_advanced_low_power_enabled"]').click()
  await backend(page, 'low-power')
  await page.waitForFunction(() => document.documentElement.dataset.lowPowerMode === 'true' && document.documentElement.dataset.motionEnabled === 'false')
  await page.waitForFunction(() => window.__lowPowerPrograms.size === 0)
  await clockAdvances(page, audio)
  assert.deepEqual(await preferences(page), before)
  const size = await page.locator(background + ' canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height, pixels: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0), webgl: !!canvas.getContext('webgl') }))
  assert(Math.max(size.width, size.height) <= 384)
  assert(size.pixels)
  assert.equal(size.webgl, false)
  assert.equal(await page.locator('[data-ambient-snapshot]').count(), 0)
  await page.screenshot({ path: path.join(artifacts, 'advanced.png') })
  await showDetail(page, true)
  await settled(page)
  await page.waitForSelector('.lyric .line-content.active')
  await page.evaluate(() => window.app_event.setProgress(0))
  await page.waitForFunction(() => document.querySelector('.lyric .line-content.active')?.textContent.includes('First lyric'))
  const firstLine = await page.locator('.lyric .line-content.active').textContent()
  await page.waitForFunction(firstLine => document.querySelector('.lyric .line-content.active')?.textContent !== firstLine, firstLine)
  assert((await page.locator('.lyric .line-content').allTextContents()).some(text => text.includes('第一句')))
  const adaptive = await page.locator('[data-player-detail]').evaluate(element => getComputedStyle(element).getPropertyValue('--ambient-lyric-accent').trim())
  assert(adaptive, 'adaptive foreground colors remain available')
  await page.screenshot({ path: path.join(artifacts, 'playback.png') })
  await showDetail(page, false)
  await settled(page)
  await route(page, '/setting?name=SettingAdvanced')
  await page.locator('label[for="setting_advanced_low_power_enabled"]').click()
  await backend(page, 'kawarp')
  await page.waitForFunction(() => window.__lowPowerPrograms.size === 2 && document.documentElement.dataset.motionEnabled === 'true')
  assert.deepEqual(await preferences(page), before)
  await clockAdvances(page, audio)
  const search = page.locator('input[aria-label="搜索设置项"]')
  await search.fill('低功耗')
  await page.locator('#advanced_low_power').waitFor({ state: 'visible' })
  await page.locator('label[for="setting_advanced_low_power_enabled"]').click()
  await backend(page, 'low-power')
  await search.fill('')
  await update(page, { 'desktopLyric.enable': true })
  const desktop = app.windows().find(window => window.url().includes('lyric.html')) ?? await app.waitForEvent('window', { predicate: window => window.url().includes('lyric.html') })
  await desktop.waitForFunction(() => document.documentElement.dataset.lowPowerMode === 'true')
  assert.equal(await desktop.evaluate(() => window.__lxPluginHost.performance.isLowPowerMode()), true)
  await update(page, { 'desktopLyric.enable': false })
  assert.deepEqual(fixture.errors, [])
  await app.close()
  fixture = await launch({ profilePath: output, initializeMotion: false })
  ;({ page } = fixture)
  await page.waitForFunction(() => document.documentElement.dataset.lowPowerMode === 'true')
  await backend(page, 'low-power')
  assert.deepEqual(await preferences(page), before)
  assert.deepEqual(fixture.errors, [])
})

const song = (id, url) => ({ id, source: 'wy', name: id, singer: 'Low power fixture', interval: '03:40', meta: { picUrl: url, songId: id, albumName: 'Cache measurement', qualitys: [], _qualitys: {} } })
const row = async(page, info) => {
  await page.evaluate(info => { window.__motionComponents().find(c => c.type.name === 'MusicList' && 'list' in c.setupState).setupState.list = [info] }, info)
  await page.waitForFunction(name => document.querySelector('#view [data-cover-image]')?.naturalWidth === 640 && document.querySelector('#view [data-music-cell="name"] [aria-label]')?.getAttribute('aria-label') === name, info.name)
}
const usage = async page => {
  await route(page, '/setting?name=SettingOther')
  await settled(page)
  const refresh = page.getByRole('button', { name: '刷新占用', exact: true })
  await refresh.click()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-cache-manager] button')].every(button => !button.disabled))
  const read = async label => {
    const text = await page.locator('[data-cache-manager] > div').filter({ hasText: label }).locator('span').textContent()
    const match = /：\s*([\d.]+)\s*(\w+)/.exec(text)
    assert(match, text)
    return Number(match[1]) * ({ B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[match[2]] ?? 1)
  }
  return { memory: await read('共享封面内存'), disk: await read('封面磁盘缓存') }
}
const privateMemory = async page => {
  const session = await page.context().newCDPSession(page)
  try {
    const samples = []
    for (let i = 0; i < 3; i++) {
      await session.send('HeapProfiler.collectGarbage')
      await page.waitForTimeout(150)
      samples.push(await page.evaluate(async() => (await process.getProcessMemoryInfo()).private))
    }
    return samples.sort((a, b) => a - b)[1] * 1024
  } finally { await session.detach() }
}

test('cover memory shrinks while active images retain quality and evicted images reload offline', { timeout: 120000 }, async t => {
  await fs.mkdir(artifacts, { recursive: true })
  const requests = new Map()
  let offline = false
  const server = http.createServer((req, res) => {
    requests.set(req.url, (requests.get(req.url) ?? 0) + 1)
    res.writeHead(offline ? 503 : 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' })
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#297c88"/></svg>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const fixture = await launch()
  const { app, page } = fixture
  t.after(async() => { await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  page.setDefaultTimeout(10000)
  await update(page, { 'common.isShowAnimation': false, 'ui.ambientBackground': false })
  const songs = Array.from({ length: 40 }, (_, index) => song(`cache-${index}`, `http://127.0.0.1:${server.address().port}/${index}.svg`))
  await route(page, '/list')
  await settled(page)
  await page.evaluate(info => {
    Object.assign(window.lxData.playMusicInfo, { musicInfo: info, listId: 'default' })
    Object.assign(window.lxData.musicInfo, { id: info.id, pic: info.meta.picUrl, name: info.name, singer: info.singer, album: info.meta.albumName })
  }, songs[0])
  await page.waitForFunction(() => [...document.querySelectorAll('#player [data-player-cover] img')].some(image => image.naturalWidth === 640))
  const active = await page.locator('#player [data-player-cover] img').last().getAttribute('src')
  await page.evaluate(() => {
    window.__lowPowerReleases = 0
    const webFrame = require('electron').webFrame
    const clearCache = webFrame.clearCache
    webFrame.clearCache = () => { window.__lowPowerReleases++; clearCache.call(webFrame) }
    window.__lowPowerRevoked = []
    const revoke = URL.revokeObjectURL
    URL.revokeObjectURL = url => { window.__lowPowerRevoked.push(url); revoke(url) }
  })
  for (const info of songs) await row(page, info)
  const normal = await usage(page)
  const normalPrivate = await privateMemory(page)
  const normalResources = await page.evaluate(() => require('electron').webFrame.getResourceUsage())
  assert(normal.memory > 24 * 1024 * 1024 && normal.memory <= 32 * 1024 * 1024)
  await update(page, { 'ui.lowPowerMode': true })
  const low = await usage(page)
  const lowPrivate = await privateMemory(page)
  const lowResources = await page.evaluate(() => require('electron').webFrame.getResourceUsage())
  assert.equal(await page.evaluate(() => window.__lowPowerReleases), 1, 'unused web resources are released once when enabling the mode')
  assert(low.memory <= 8 * 1024 * 1024)
  assert(low.memory < normal.memory / 2)
  assert.equal(low.disk, normal.disk)
  assert.equal(await page.evaluate(active => window.__lowPowerRevoked.includes(active), active), false)
  assert.equal(await page.locator('#player [data-player-cover] img').last().getAttribute('src'), active)
  assert.equal(await page.locator('#player [data-player-cover] img').last().evaluate(image => image.naturalWidth), 640)
  offline = true
  const evicted = songs[20]
  const requestCount = requests.get('/20.svg')
  await route(page, '/list')
  await settled(page)
  await row(page, evicted)
  assert.equal(requests.get('/20.svg'), requestCount)
  await update(page, { 'ui.lowPowerMode': false })
  for (const info of songs.slice(10, 30)) await row(page, info)
  const restored = await usage(page)
  assert(restored.memory > low.memory * 2)
  await route(page, '/list')
  await settled(page)
  await row(page, songs[0])
  assert.equal(await page.locator('#view [data-cover-image]').first().getAttribute('src'), active)
  assert.deepEqual(fixture.errors, [])
  const report = { scenario: '40 different 640x640 covers visited sequentially; one playing cover leased; background disabled; cache figures read from the UI and rounded to 2 decimals; renderer private memory is the median of 3 post-GC samples', electron: await page.evaluate(() => process.versions.electron), normal, low, restored, normalPrivate, lowPrivate, normalResources, lowResources }
  await fs.writeFile(path.join(artifacts, `memory-${report.electron}.json`), JSON.stringify(report, null, 2) + '\n')
  console.log('Low-power memory measurement:', JSON.stringify(report))
})

test('updated compiled visualization obeys the low-power clock in both windows without interrupting audio', { timeout: 120000 }, async t => {
  const fixture = await launch()
  const { app, page } = fixture
  t.after(async() => app.close())
  page.setDefaultTimeout(15000)
  await mockGitHub(app)
  await page.evaluate(() => {
    const connect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function(target, ...args) {
      if (target instanceof AudioDestinationNode) {
        const silence = this.context.createGain()
        silence.gain.value = 0
        connect.call(silence, target)
        return connect.call(this, silence, ...args)
      }
      return connect.call(this, target, ...args)
    }
  })
  await openStore(page)
  await install(page, 'audio-visualizer')
  await seedTrack(page)
  await update(page, { 'ui.ambientBackground': false, 'player.audioVisualization': true, 'desktopLyric.audioVisualization': true })
  await page.evaluate(() => {
    window.lx.isPlayedStop = false
    window.lxData.musicInfo.lrc = '[00:00.000]Visualizer check\n[00:01.000]Test signal'
    window.app_event.lyricUpdated()
  })
  await startSilentAudio(page, 30)
  await page.waitForFunction(() => window.__lxPluginHost.playerState.isPlay.value)
  await showDetail(page, true)
  await settled(page)
  await page.waitForSelector('[data-plugin-visualizer="main"] canvas')
  const probe = async(page, selector) => page.evaluate(selector => {
    const canvas = document.querySelector(selector)
    const context = canvas.getContext('2d')
    canvas.__lowPowerDraws = 0
    const clear = context.clearRect.bind(context)
    context.clearRect = (...args) => { canvas.__lowPowerDraws++; return clear(...args) }
  }, selector)
  const canvas = '[data-plugin-visualizer="main"] canvas'
  await probe(page, canvas)
  const audio = await playing(page)
  await update(page, { 'ui.lowPowerMode': true })
  await page.setViewportSize({ width: 3840, height: 2160 })
  await page.waitForTimeout(250)
  const samples = async page => page.evaluate(() => [...document.querySelectorAll('[data-plugin-visualizer] canvas')].map(canvas => ({ draws: canvas.__lowPowerDraws, pixels: canvas.width * canvas.height, density: canvas.width / canvas.clientWidth, visible: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0), hidden: document.hidden, isPlay: window.__lxPluginHost.playerState?.isPlay.value ?? window.__lxPluginHost.lyricState?.isPlay.value })))
  const check = async(page, selector) => {
    await page.evaluate(selector => { document.querySelector(selector).__lowPowerDraws = 0 }, selector)
    await page.waitForTimeout(1100)
    for (const sample of await samples(page)) {
      assert(sample.draws > 0 && sample.draws <= 36, JSON.stringify(sample))
      assert(sample.pixels <= 1001000)
      assert(sample.density <= 1.01)
      assert(sample.visible)
    }
  }
  await check(page, canvas)
  const lowPixels = await page.locator(canvas).evaluate(canvas => canvas.width * canvas.height)
  await update(page, { 'desktopLyric.enable': true })
  const desktop = app.windows().find(window => window.url().includes('lyric.html')) ?? await app.waitForEvent('window', { predicate: window => window.url().includes('lyric.html') })
  await desktop.waitForFunction(() => document.documentElement.dataset.lowPowerMode === 'true')
  const desktopCanvas = '[data-plugin-visualizer="desktop"] canvas'
  await desktop.locator(desktopCanvas).waitFor()
  await probe(desktop, desktopCanvas)
  await page.waitForTimeout(250)
  await check(desktop, desktopCanvas)
  await clockAdvances(page, audio)
  await update(page, { 'ui.lowPowerMode': false })
  await desktop.waitForFunction(() => document.documentElement.dataset.lowPowerMode === 'false')
  assert.equal(await page.evaluate(() => window.__lxPluginHost.performance.isLowPowerMode()), false)
  await page.waitForFunction(({ canvas, lowPixels }) => {
    const element = document.querySelector(canvas)
    return element.width * element.height > lowPixels * 2
  }, { canvas, lowPixels })
  await clockAdvances(page, audio)
  assert.deepEqual(fixture.errors, [])
})
