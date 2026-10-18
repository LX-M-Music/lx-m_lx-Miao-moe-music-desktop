const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { test } = require('node:test')
const { _electron } = require('playwright-core')

const project = path.resolve(__dirname, '..')
const lxScript = '/**\n * @name LX 回归音源\n * @version 1.0.0\n */\n' +
  "lx.on(lx.EVENT_NAMES.request, async () => 'https://mf-fixture.example/audio.wav'); lx.send(lx.EVENT_NAMES.inited, {sources:{kw:{type:'music',actions:['musicUrl'],qualitys:['128k']}}});"
const pluginScript = `/**
 * @name MusicFree CommonJS fixture
 */
const axios = require('axios'), cheerio = require('cheerio'), crypto = require('crypto-js');
module.exports = {
  platform: 'MusicFree 回归音源', version: '1.0.0', author: 'Fixture', primaryKey: ['id', 'aid'],
  userVariables: [{ key: 'token', title: '测试变量' }],
  async search(query, page, type) {
    if (typeof process !== 'undefined' || typeof window.require !== 'undefined') throw Error('Node was exposed');
    const data = (await axios.get('https://mf-fixture.example/' + (query === 'slow' ? 'slow' : 'search'), { params: { query, page, type }, headers: { Host: 'mf-fixture.example', 'Sec-Fetch-Site': 'same-site' } })).data;
    return { isEnd: page >= 2, data: data.map(item => ({ ...item, title: cheerio.load('<b>'+item.title+'</b>')('b').text(), extra: { signature: crypto.MD5('fixture').toString() } })) };
  },
  async getMediaSource(item, quality) {
    if (item.aid !== 'variant' || item.extra.signature !== crypto.MD5('fixture').toString()) throw Error('Song fields were lost');
    return { url: 'https://mf-fixture.example/audio.wav?quality='+quality, headers: { Host: 'mf-fixture.example', Referer: 'https://required.example/', 'X-Fixture-Variable': env.getUserVariables().token || '' }, userAgent: 'MF Fixture Agent' };
  },
  async getLyric() { return { rawLrc: '[00:00.00]MusicFree 歌词测试', translation: '[00:00.00]Translation' }; },
  async getMusicInfo() { return { artwork: 'https://mf-fixture.example/cover.svg' }; }
};`

async function launchHidden(profile, port) {
  await fs.mkdir(path.join(profile, 'portable'), { recursive: true })
  const wrapper = path.join(profile, 'wrapper.cjs')
  await fs.writeFile(wrapper, `
const electron = require('electron'), http = require('node:http'), https = require('node:https');
electron.app.setAppPath(${JSON.stringify(project)});
electron.app.getVersion = () => ${JSON.stringify(require('../package.json').version)};
electron.app.setAsDefaultProtocolClient = () => false;
electron.app.removeAsDefaultProtocolClient = () => false;
const request = http.request;
for (const transport of [http, https]) {
  const original = transport.request;
  transport.request = function(url, options, ...rest) {
    if (url instanceof URL && url.hostname === 'mf-fixture.example') return request.call(http, new URL('http://127.0.0.1:${port}' + url.pathname + url.search), { ...options, agent: false, lookup: undefined, headers: { ...options.headers, Host: 'mf-fixture.example' } }, ...rest);
    return original.call(this, url, options, ...rest);
  };
}
electron.app.on('browser-window-created', (_event, window) => {
  window.show = () => {}; window.showInactive = () => {};
  window.webContents.setBackgroundThrottling(false);
  window.webContents.setAudioMuted(true);
});
electron.app.on('web-contents-created', (_event, contents) => {
  const loadURL = contents.loadURL.bind(contents);
  contents.loadURL = (url, options) => {
    const parsed = new URL(url);
    const target = parsed.origin === 'http://localhost:9080' ? ${JSON.stringify(pathToFileURL(path.join(project, 'dist/index.html')).href)}
      : parsed.origin === 'http://localhost:9081' ? ${JSON.stringify(pathToFileURL(path.join(project, 'dist/lyric.html')).href)} : null;
    return loadURL(target ? target + parsed.search : url, options);
  };
});
require(${JSON.stringify(path.join(project, 'dist/main.js'))});`)
  const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ executablePath: require('electron'), args: [wrapper, '-hidden', '-dha'], env })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(10000)
  await page.waitForSelector('#container')
  await page.evaluate(() => {
    window.__mfAudios = []
    window.__mfDecoded = []
    const observeAudio = audio => {
      if (window.__mfAudios.includes(audio)) return
      window.__mfAudios.push(audio)
      audio.addEventListener('loadeddata', () => window.__mfDecoded.push({ duration: audio.duration, src: audio.src }))
    }
    const srcProperty = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')
    Object.defineProperty(HTMLMediaElement.prototype, 'src', { ...srcProperty, set(value) { observeAudio(this); srcProperty.set.call(this, value) } })
    const originalPlay = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function(...args) {
      observeAudio(this)
      return originalPlay.apply(this, args)
    }
    Object.assign(window.lxData.appSetting, { 'common.isAgreePact': true, 'common.showChangeLog': false, 'common.isShowAnimation': false, 'player.startupAutoPlay': false, 'player.playQuality': '128k', 'list.actionButtonsVisible': true })
    window.lxData.versionInfo.showModal = false
    window.lxData.versionInfo.newVersion = { version: window.lxData.versionInfo.version, history: [], desc: '' }
    window.__mfComponents = () => {
      const result = []
      const visit = node => {
        if (!node) return
        if (Array.isArray(node)) return node.forEach(visit)
        if (node.component) { result.push(node.component); visit(node.component.subTree) }
        else if (Array.isArray(node.children)) node.children.forEach(visit)
      }
      visit(document.querySelector('#root')._vnode)
      return result
    }
    window.__mfSongs = () => window.__mfComponents().find(component => Array.isArray(component.props.list) && 'checkApiSource' in component.props)?.props.list
    for (const component of window.__mfComponents()) if ('isShowChangeLog' in component.setupState) component.setupState.isShowChangeLog = false
  })
  await page.evaluate(port => {
    const http = require('node:http'), https = require('node:https')
    const originalHttp = http.request
    for (const transport of [http, https]) {
      const original = transport.request
      transport.request = function(options, ...args) {
        if ((options.hostname ?? options.host) === 'mf-fixture.example') return originalHttp.call(http, { ...options, protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1', port, agent: undefined, headers: { ...options.headers, Host: 'mf-fixture.example' } }, ...args)
        return original.call(this, options, ...args)
      }
    }
  }, port)
  await page.route('https://mf-fixture.example/cover.svg', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#34947a"/></svg>' }))
  return { app, page, errors }
}
const route = (page, url) => page.evaluate(url => document.querySelector('#root').__vue_app__.config.globalProperties.$router.push(url), url)
const screenshot = async(fixture, filename) => {
  await fixture.page.waitForTimeout(150)
  const window = await fixture.app.browserWindow(fixture.page)
  try {
    await window.evaluate(async window => { await window.capturePage(undefined, { stayHidden: true, stayAwake: true }) })
    await fixture.page.waitForTimeout(150)
    const data = await window.evaluate(async window => (await window.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'))
    await fs.writeFile(filename, Buffer.from(data, 'base64'))
  } finally { await window.dispose() }
}
const waitFor = async(predicate) => {
  const until = Date.now() + 10000
  while (!predicate()) { if (Date.now() > until) throw Error('Fixture condition timed out'); await new Promise(resolve => setTimeout(resolve, 25)) }
}

test('shared custom-source manager imports LX/MusicFree, searches, plays, persists across restart and removes both formats', { timeout: 120000 }, async t => {
  const output = path.resolve('output/playwright/musicfree-compat')
  await fs.mkdir(output, { recursive: true })
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-musicfree-check-'))
  const audio = Buffer.alloc(44 + 44100 * 2)
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(44100, 24); audio.writeUInt32LE(88200, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40)
  for (let index = 0; index < 44100; index++) audio.writeInt16LE(Math.round(Math.sin(index * Math.PI * 880 / 44100) * 1000), 44 + index * 2)
  const audioRequests = []
  let slowClosed = false
  let slowStarted = false
  let subscriptionRequests = 0
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture')
    if (url.pathname === '/plugin.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(pluginScript) }
    else if (url.pathname === '/lx-plugin.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(lxScript.replace('LX 回归音源', 'LX 在线回归音源')) }
    else if (url.pathname === '/subscription.json') { subscriptionRequests++; response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ plugins: [{ name: 'Fixture', url: './plugin.js' }] })) }
    else if (url.pathname === '/search') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify([{ id: Number(url.searchParams.get('page') || 1), aid: 'variant', title: 'MusicFree 测试歌曲', artist: '兼容验证', album: 'Fixture', duration: 1 }]))
    } else if (url.pathname === '/slow') { slowStarted = true; response.writeHead(200); response.write('['); response.on('close', () => { slowClosed = true }) }
    else if (url.pathname === '/audio.wav') {
      audioRequests.push({ headers: request.headers, quality: url.searchParams.get('quality') })
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '')
      const start = range ? Number(range[1]) : 0
      const end = range && range[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1
      const bytes = audio.subarray(start, end + 1)
      response.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': bytes.length, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${audio.length}` } : {}) })
      response.end(request.method === 'HEAD' ? undefined : bytes)
    } else if (url.pathname === '/cover.svg') { response.writeHead(200, { 'Content-Type': 'image/svg+xml' }); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#34947a"/></svg>') }
    else { response.writeHead(404); response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let fixture
  try {
    fixture = await launchHidden(profile, server.address().port)
    let { page, app } = fixture
    await route(page, '/setting')
    assert.equal(await page.getByRole('button', { name: '管理 MusicFree 音源', exact: true }).count(), 0)
    assert.equal(await page.locator('#basic_musicfree').count(), 0)
    await page.getByRole('button', { name: '自定义源管理', exact: true }).click()
    const modal = page.locator('[data-user-api-manager]')
    const localPlugin = path.join(profile, 'fixture.js')
    const localLx = path.join(profile, 'lx-fixture.js')
    await fs.writeFile(localPlugin, pluginScript)
    await fs.writeFile(localLx, lxScript)
    await app.evaluate(({ dialog }, filenames) => { dialog.showOpenDialog = async() => ({ canceled: false, filePaths: filenames }) }, [localPlugin, localLx])
    await modal.getByRole('button', { name: '本地导入', exact: true }).click()
    await modal.getByText('已导入或更新 2 个自定义源', { exact: true }).waitFor()
    const lxRow = modal.locator('[data-source-id]').filter({ has: page.getByRole('heading', { name: /LX 回归音源/ }) })
    await lxRow.getByRole('checkbox', { name: '允许显示更新弹窗', exact: true }).click()
    await page.waitForFunction(async() => !(await require('electron').ipcRenderer.invoke('winMain_get_user_api_list')).find(api => api.name === 'LX 回归音源').allowShowUpdateAlert)
    const onlineImport = async url => {
      await modal.getByRole('button', { name: '在线导入', exact: true }).click()
      const online = page.locator('[data-user-api-online-import]')
      await online.getByRole('textbox').fill(url)
      await online.getByRole('button', { name: '导入', exact: true }).click()
      await online.waitFor({ state: 'hidden' })
      await modal.getByText('已导入或更新 1 个自定义源', { exact: true }).waitFor()
    }
    await onlineImport('https://mf-fixture.example/subscription.json')
    assert.equal(subscriptionRequests, 1)
    await onlineImport('https://mf-fixture.example/lx-plugin.js')
    assert.equal(await modal.locator('[data-source-id]').count(), 3)
    const localSubscription = path.join(profile, 'subscription.json')
    await fs.writeFile(localSubscription, JSON.stringify({ plugins: [{ name: 'Fixture', url: 'https://mf-fixture.example/plugin.js' }] }))
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [filename] }) }, localSubscription)
    await modal.getByRole('button', { name: '本地导入', exact: true }).click()
    await modal.getByText('已导入或更新 1 个自定义源', { exact: true }).waitFor()
    const pluginId = await modal.locator('[data-musicfree-id]').getAttribute('data-musicfree-id')
    assert.match(pluginId, /^musicfree_[a-f\d]{24}$/)
    await modal.getByText('插件配置', { exact: true }).click()
    await modal.getByLabel('测试变量').fill('fixture-token')
    await modal.getByRole('button', { name: '保存配置', exact: true }).click()
    await modal.getByText('插件配置已保存', { exact: true }).waitFor()
    assert(await modal.getByRole('status').evaluate(element => element.clientHeight >= element.scrollHeight))
    const dataPath = await app.evaluate(() => global.lxDataPath)
    assert(!(await fs.readFile(path.join(dataPath, 'musicfree.json'), 'utf8')).includes('fixture-token'))
    await screenshot(fixture, path.join(output, 'musicfree-config.png'))
    await modal.getByText('插件配置', { exact: true }).click()
    await modal.locator('ul').evaluate(element => { element.scrollTop = 0 })
    await screenshot(fixture, path.join(output, 'musicfree-settings.png'))
    // Close through the actual modal control, then use the new search tab.
    await page.locator('#view button[aria-label="关闭"]').last().click()
    await route(page, `/search?text=MusicFree&source=${pluginId}&type=music`)
    await page.getByText('MusicFree 测试歌曲', { exact: true }).first().waitFor()
    assert(await page.getByText('MusicFree 回归音源', { exact: true }).count())
    const song = await page.evaluate(() => JSON.parse(JSON.stringify(window.__mfSongs()[0])))
    assert.equal(song.meta.musicfree.aid, 'variant')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-music-cell="cover"] img')].some(image => image.complete && image.naturalWidth > 0))
    const headerBounds = await page.evaluate(() => {
      const platforms = document.querySelector('[data-search-sources]').getBoundingClientRect()
      const types = document.querySelector('[data-search-sources]').nextElementSibling.getBoundingClientRect()
      return { platformsRight: platforms.right, typesLeft: types.left, typesRight: types.right, viewport: innerWidth }
    })
    assert(headerBounds.platformsRight <= headerBounds.typesLeft + 1)
    assert(headerBounds.typesRight <= headerBounds.viewport)
    await screenshot(fixture, path.join(output, 'musicfree-search.png'))
    // More sources than the runtime cap must queue rather than fail aggregation.
    const queuedSources = await page.evaluate(async script => {
      const ipc = require('electron').ipcRenderer
      const ids = []
      try {
        for (let index = 0; index < 9; index++) {
          const name = 'Queue fixture ' + index
          const result = await ipc.invoke('musicfree:import', { script: script.replace('MusicFree 回归音源', name) })
          ids.push(result.plugins.find(plugin => plugin.name === name).id)
        }
        const results = await Promise.all(ids.map((id, index) => ipc.invoke('musicfree:call', { id, callId: 'queue-' + index, method: 'search', args: ['queued', 1, 'music'] })))
        return results.length
      } finally { for (const id of ids) await ipc.invoke('musicfree:remove', id) }
    }, pluginScript)
    assert.equal(queuedSources, 9)
    await page.evaluate(async song => {
      await require('electron').ipcRenderer.invoke('player_list_music_add', { id: 'love', musicInfos: [song], addMusicLocationType: 'bottom' })
    }, song)
    // Invoke the production list's play event; this traverses the real player,
    // source adapter, sandbox, main relay and Chromium audio decoder.
    await page.evaluate(() => window.__mfComponents().find(component => Array.isArray(component.props.list) && 'checkApiSource' in component.props).emit('play-list', 0))
    await waitFor(() => audioRequests.length > 0)
    assert.equal(audioRequests[0].headers.referer, 'https://required.example/')
    assert.equal(audioRequests[0].headers['user-agent'], 'MF Fixture Agent')
    assert.equal(audioRequests[0].headers['x-fixture-variable'], 'fixture-token')
    await page.waitForFunction(() => window.lxData.musicInfo.lrc?.includes('MusicFree 歌词测试'))
    await page.waitForFunction(() => window.__mfDecoded.some(audio => audio.duration > 0.9 && audio.duration < 1.1))
    const media = await page.evaluate(async({ pluginId, song }) => require('electron').ipcRenderer.invoke('musicfree:call', { id: pluginId, callId: 'range-verification', method: 'getMediaSource', args: [song.meta.musicfree, 'low'] }), { pluginId, song })
    const partial = await fetch(media.url, { headers: { Range: 'bytes=0-43' } })
    assert.equal(partial.status, 206)
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), audio.subarray(0, 44))
    const head = await fetch(media.url, { method: 'HEAD' })
    assert.equal(Number(head.headers.get('content-length')), audio.length)
    // Cancel a request with a stalled body by leaving the search page.
    await route(page, `/search?text=slow&source=${pluginId}&type=music`)
    await waitFor(() => slowStarted)
    await route(page, '/setting')
    await waitFor(() => slowClosed)
    assert.deepEqual(fixture.errors, [])
    await app.close()

    fixture = await launchHidden(profile, server.address().port)
    ;({ page, app } = fixture)
    const saved = await page.evaluate(async() => require('electron').ipcRenderer.invoke('player_list_music_get', 'love'))
    assert.equal(saved[0].meta.musicfree.extra.signature, song.meta.musicfree.extra.signature)
    const plugins = await page.evaluate(async() => require('electron').ipcRenderer.invoke('musicfree:list'))
    assert.equal(plugins[0].variables.token, 'fixture-token')
    await route(page, `/search?text=after-restart&source=${pluginId}&type=music`)
    await page.getByText('MusicFree 测试歌曲', { exact: true }).first().waitFor()
    await route(page, '/setting')
    await page.getByRole('button', { name: '自定义源管理', exact: true }).click()
    const restoredModal = page.locator('[data-user-api-manager]')
    assert.equal(await restoredModal.locator('[data-source-id]').count(), 3)
    const mfRow = restoredModal.locator('[data-musicfree-id]')
    await mfRow.getByRole('checkbox', { name: '启用', exact: true }).click()
    await page.waitForFunction(async() => !(await require('electron').ipcRenderer.invoke('musicfree:list'))[0].enabled)
    await mfRow.getByRole('checkbox', { name: '启用', exact: true }).click()
    await page.waitForFunction(async() => (await require('electron').ipcRenderer.invoke('musicfree:list'))[0].enabled)
    await mfRow.getByRole('button', { name: '移除', exact: true }).click()
    await mfRow.waitFor({ state: 'detached' })
    assert.deepEqual(await page.evaluate(async() => require('electron').ipcRenderer.invoke('musicfree:list')), [])
    for (let index = 0; index < 2; index++) {
      await restoredModal.locator('[data-source-id]').first().getByRole('button', { name: '移除', exact: true }).click()
      await page.waitForFunction(count => document.querySelectorAll('[data-user-api-manager] [data-source-id]').length === count, 1 - index)
    }
    await restoredModal.getByText('这里竟然是空的😲', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(async() => require('electron').ipcRenderer.invoke('winMain_get_user_api_list')), [])
    assert.deepEqual(fixture.errors, [])
    await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ pluginId, songId: song.id, unifiedManager: true, separateEntryRemoved: true, mixedFileImport: true, lxOnlineImport: true, musicFreeOnlineSubscription: true, relativeSubscriptionUrl: true, localSubscription: true, imported: true, searched: true, cover: true, queuedSources, decodedAudio: true, lyric: true, headersForwarded: true, cancelled: slowClosed, restart: true, favoritePreserved: true, removedBothFormats: true, errors: fixture.errors }, null, 2))
    t.diagnostic('MusicFree production verification: ' + output)
  } catch (error) {
    if (fixture) {
      await fs.writeFile(path.join(output, 'failure.txt'), await fixture.page.locator('body').innerText().catch(() => 'Page unavailable'))
      await fs.writeFile(path.join(output, 'audio-states.json'), JSON.stringify(await fixture.page.evaluate(() => ({ decoded: window.__mfDecoded, audios: window.__mfAudios?.map(audio => ({ src: audio.src, duration: audio.duration, readyState: audio.readyState, error: audio.error?.message })) })).catch(() => ({})), null, 2))
      await screenshot(fixture, path.join(output, 'failure.png')).catch(() => {})
      t.diagnostic(JSON.stringify({ errors: fixture.errors, profile }))
    }
    throw error
  } finally {
    if (fixture) await fixture.app.close().catch(() => {})
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
