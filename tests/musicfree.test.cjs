const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

const load = loader()
const { MusicFreeManager } = load('src/main/modules/musicFree/manager.ts')
const { createMusicFreeSource, musicFreeSong, musicFreeQuality } = load('src/renderer/utils/musicSdk/plugins/musicFree.js')
const { toNewMusicInfo, toOldMusicInfo } = load('src/common/utils/tools.ts')
const { musicFreeUrl, musicFreeHeaders, requestMusicFree } = load('src/main/modules/musicFree/network.ts')
const { isMusicFreeSource } = load('src/common/musicFree.ts')
const plugin = { id: 'musicfree_0123456789abcdef01234567', name: 'Test source', version: '1.0.0', author: 'Test', methods: ['search', 'getMediaSource', 'getLyric'], primaryKey: ['id', 'aid'], supportedSearchType: ['music'], userVariables: [], variables: {}, enabled: true }

test('MusicFree compound identity and arbitrary fields survive both LX song formats and disk JSON', () => {
  const item = { id: '123', aid: 0, title: 'Song', artist: 'Artist', album: 'Album', duration: 125, artwork: 'https://example.com/a.png', nested: { required: ['A', 1] }, source: 'external', meta: { detail: true } }
  const old = musicFreeSong(plugin, item)
  assert.equal(old.interval, '02:05')
  const restored = toOldMusicInfo(JSON.parse(JSON.stringify(toNewMusicInfo(old))))
  assert.deepEqual(restored.musicfree, { ...item, platform: plugin.name })
  assert.notEqual(musicFreeSong(plugin, { ...item, aid: 1 }).songmid, old.songmid)
  assert.equal(musicFreeSong(plugin, { ...item, aid: null }), null)
  assert.equal(musicFreeSong(plugin, { ...item, title: '' }), null)
})

test('MusicFree protocol qualities are mapped in order, without claiming unsupported higher tiers', async() => {
  const calls = []
  const source = createMusicFreeSource(plugin, (id, method, args) => {
    calls.push({ id, method, args })
    return { promise: Promise.resolve(method === 'getLyric' ? { rawLrc: '[00:00.00]Lyric', translation: '[00:00.00]翻译' } : { url: 'https://example.com/song' }), cancelHttp() {} }
  }).source
  const song = musicFreeSong(plugin, { id: 'id', aid: 1, title: 'Song', custom: true })
  for (const quality of ['128k', '192k', '320k', 'flac']) {
    assert.equal((await source.getMusicUrl(song, quality).promise).type, quality)
  }
  assert.deepEqual(calls.map(call => call.args[1]), ['low', 'standard', 'high', 'super'])
  assert.deepEqual(await source.getLyric(song).promise, { lyric: '[00:00.00]Lyric', tlyric: '[00:00.00]翻译' })
  assert.equal(musicFreeQuality('hires'), 'super')
})

test('MusicFree page boundaries use the plugin page size and final-page flag', async() => {
  const source = createMusicFreeSource(plugin, (_id, _method, args) => ({ promise: Promise.resolve({ isEnd: args[1] === 3, data: Array.from({ length: args[1] === 3 ? 2 : 8 }, (_, i) => ({ id: i + args[1] * 8, aid: 0, title: 'Song' })) }) })).source
  const first = await source.musicSearch.search('query', 1, 30)
  assert.equal(first.limit, 8)
  assert.equal(first.allPage, 2)
  const final = await source.musicSearch.search('query', 3, 30)
  assert.equal(final.limit, 8)
  assert.equal(final.total, 18)
  assert.equal(final.allPage, 3)
  assert.equal(createMusicFreeSource({ ...plugin, supportedSearchType: ['album'] }, () => {}).source.musicSearch, undefined)
})

test('MusicFree imports persist only after inspection, update stable IDs, and survive a manager restart', async() => {
  let disk = {}
  const store = { get: key => structuredClone(disk[key]), set: async(key, value) => { disk[key] = structuredClone(value) } }
  const manager = new MusicFreeManager(store)
  const inspect = async() => ({ name: 'Stable', version: '1.0.0', author: '', methods: ['search'], primaryKey: ['id'], supportedSearchType: ['music'], userVariables: [{ key: 'token', title: 'Token' }] })
  const result = await manager.import('module.exports = {}', inspect)
  assert(isMusicFreeSource(result.id))
  assert.equal(result.script, undefined)
  await manager.configure(result.id, false, { token: 'configured-value' })
  const next = await manager.import('module.exports = { updated: true }', inspect)
  assert.equal(next.id, result.id)
  assert.equal(next.enabled, false)
  assert.equal(next.variables.token, 'configured-value')
  const before = JSON.stringify(disk)
  await assert.rejects(manager.import('broken', async() => { throw new Error('Syntax error') }), /Syntax error/)
  assert.equal(JSON.stringify(disk), before)
  assert.deepEqual(new MusicFreeManager(store).list(), manager.list())
  await manager.remove(result.id)
  assert.deepEqual(manager.list(), [])
})

test('MusicFree network policy rejects local targets and malformed headers', async() => {
  for (const url of ['file:///C:/config', 'http://localhost/a', 'http://127.0.0.1/a', 'http://10.1.1.1/a', 'https://[::1]/', 'https://user:pass@example.com']) assert.throws(() => musicFreeUrl(url))
  assert.equal(musicFreeUrl('https://example.com:8443/').port, '8443')
  assert.throws(() => musicFreeHeaders({ Host: 'localhost' }))
  assert.deepEqual(musicFreeHeaders({ Host: 'example.com', 'Sec-Fetch-Site': 'same-site', Connection: 'keep-alive' }, 'example.com'), { 'sec-fetch-site': 'same-site' })
  assert.throws(() => musicFreeHeaders({ Referer: 'https://example.com\r\nInjected: yes' }))
  assert.deepEqual(musicFreeHeaders({ 'User-Agent': 'MusicFree', Cookie: 'explicit=value' }), { 'user-agent': 'MusicFree', cookie: 'explicit=value' })
  await assert.rejects(requestMusicFree('https://example.com', { data: { not: 'serialized' } }).promise, /正文/)
})

test('MusicFree configuration is encrypted at rest and failure never replaces saved records', async() => {
  let disk = [], encryptionAvailable = true
  const protectedLoad = loader({ electron: { safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    getSelectedStorageBackend: () => 'test-keyring',
    encryptString: value => Buffer.from('sealed:' + value),
    decryptString: value => value.toString().slice(7),
  } } })
  const { protectedMusicFreeStore } = protectedLoad('src/main/modules/musicFree/store.ts')
  const store = protectedMusicFreeStore({ get: () => structuredClone(disk), set: async(_key, value) => { disk = structuredClone(value) } })
  await store.set('plugins', [{ ...plugin, script: 'script', variables: { token: 'private-token' } }])
  assert(!JSON.stringify(disk).includes('private-token'))
  assert.equal(store.get('plugins')[0].variables.token, 'private-token')
  const before = JSON.stringify(disk)
  encryptionAvailable = false
  await assert.rejects(store.set('plugins', [{ ...plugin, script: 'script', variables: { token: 'new-value' } }]), /系统安全存储/)
  assert.equal(JSON.stringify(disk), before)
})

test('MusicFree songs pass backup and WebDAV validation without weakening other source checks', () => {
  const schemaLoad = loader({ '@common/utils': { log: { error() {} } }, 'electron-log/node': { error() {} } })
  const { validateBackupData } = schemaLoad('src/common/backup.ts')
  const { validateData } = schemaLoad('src/main/modules/webdav/data.ts')
  const song = toNewMusicInfo(musicFreeSong(plugin, { id: 1, aid: 0, title: 'Saved', extra: { key: 'preserved' } }))
  const backup = validateBackupData({ playlists: [{ id: 'custom', name: 'Saved', list: [song] }] })
  assert.equal(backup.playlists[0].list[0].meta.musicfree.extra.key, 'preserved')
  assert.doesNotThrow(() => validateData({ playlists: { defaultList: [song], loveList: [], userList: [] } }, ['playlists']))
  assert.throws(() => validateBackupData({ playlists: [{ id: 'custom', name: 'Saved', list: [{ ...song, source: 'unknown-source' }] }] }))
})

test('MusicFree playback bypasses LX initialization and stale URL cache, and falls back through plugin qualities', async t => {
  const previousWindow = global.window
  t.after(() => { global.window = previousWindow })
  global.window = { lx: { apiInitPromise: [Promise.resolve(false)] }, i18n: { t: key => key } }
  const song = toNewMusicInfo(musicFreeSong(plugin, { id: 1, aid: 0, title: 'Playback' }))
  const qualities = [], saves = [], reads = []
  const overrides = {
    '@renderer/store': { apiSource: { value: '' }, qualityList: { value: {} } },
    '@renderer/store/utils': { assertApiSupport: () => true },
    '@renderer/utils/musicSdk': { [plugin.id]: { getMusicUrl: (_item, type) => {
      qualities.push(type)
      return { promise: type === 'flac' ? Promise.reject(Error('No super quality')) : Promise.resolve({ type, url: 'http://127.0.0.1:12345/musicfree/fresh' }) }
    } } },
    '@renderer/utils/musicCover': { getMusicCoverUrl: async() => '' },
    '@renderer/utils/ipc': { getMusicUrl: async() => { reads.push(true); return 'http://127.0.0.1:11111/musicfree/stale' }, saveMusicUrl: (...args) => { saves.push(args) } },
    '@renderer/store/setting': { appSetting: { 'player.playQuality': 'flac' } },
    '@renderer/utils': { toOldMusicInfo, toNewMusicInfo },
    '@renderer/utils/message': { requestMsg: { tooManyRequests: 'rate limit' } },
    '@renderer/utils/musicSdk/api-source': {},
    '@renderer/store/list/action': { updateListMusics() {} },
  }
  const rendererLoad = loader(overrides)
  const utils = rendererLoad('src/renderer/core/music/utils.ts')
  assert.deepEqual(utils.getTryQualityList('192k', song), ['192k', '128k'])
  const online = rendererLoad('src/renderer/core/music/online.ts')
  const url = await online.getMusicUrl({ musicInfo: song, quality: 'flac', isRefresh: false, allowToggleSource: false })
  assert.equal(url, 'http://127.0.0.1:12345/musicfree/fresh')
  assert.deepEqual(qualities, ['flac', '320k'])
  assert.deepEqual(reads, [])
  assert.deepEqual(saves, [])
})

const runtimeHarness = () => {
  let listener
  const responses = new Map()
  const network = []
  const context = vm.createContext({
    URL, URLSearchParams, Headers, Response, Request, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, AbortController,
    setTimeout, clearTimeout, console, atob, btoa, fetch, crypto: require('node:crypto').webcrypto,
    navigator: { userAgent: 'Test' }, location: { href: 'https://sandbox.example/' },
    musicFreeBridge: {
      listen: callback => { listener = callback },
      request: async packet => { network.push(packet); return { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, data: '{"value":3}' } },
      cancel() {},
      reply: packet => { const task = responses.get(packet.id); if (task) packet.error ? task.reject(new Error(packet.error)) : task.resolve(packet.value) },
    },
  })
  context.window = context
  context.self = context
  vm.runInContext(fs.readFileSync('dist/musicfree-runtime.js', 'utf8'), context, { timeout: 5000 })
  return {
    create: (script, variables) => context.createMusicFreeRuntime(script, variables),
    call: (method, args = []) => new Promise((resolve, reject) => { const id = String(responses.size + 1); responses.set(id, { resolve, reject }); listener({ id, method, args }) }),
    network,
  }
}

test('the actual browser runtime supports CommonJS, all documented dependencies, axios instances and plugin variables', async() => {
  const harness = runtimeHarness()
  const metadata = harness.create(`
    const axios = require('axios').create({ baseURL: 'https://example.com' });
    const cheerio = require('cheerio'), crypto = require('crypto-js');
    const dayjs = require('dayjs'), integer = require('big-integer'), qs = require('qs'), he = require('he');
    const webdav = require('webdav');
    module.exports = { platform: 'Fixture', primaryKey: ['id'], userVariables: [{ key: 'token' }],
      async search(query,page,type) {
        const result = await axios.get('/search', { params: { query, page } });
        return { data: [{ id: '1', title: cheerio.load('<b>Title</b>')('b').text(),
          checks: [crypto.MD5('abc').toString(), dayjs('2026-10-18').format('YYYY-MM-DD'), integer('999999999999999999').plus(1).toString(), qs.stringify({ a: 1 }), he.decode('&amp;'), typeof webdav.createClient, env.getUserVariables().token, result.data.value, typeof require, typeof process] }] };
      }
    };`, { token: 'configured' })
  assert.equal(metadata.name, 'Fixture')
  const result = await harness.call('search', ['query', 1, 'music'])
  assert.equal(result.data[0].title, 'Title')
  assert.deepEqual(Array.from(result.data[0].checks), ['900150983cd24fb0d6963f7d28e17f72', '2026-10-18', '1000000000000000000', 'a=1', '&', 'function', 'configured', 3, 'function', 'undefined'])
  assert.match(harness.network[0].url, /^https:\/\/example.com\/search\?query=query&page=1$/)
  assert.throws(() => runtimeHarness().create("require('fs'); module.exports={platform:'Bad'}"), /不支持.*fs/)
  assert.throws(() => runtimeHarness().create('module.exports={ name: "LX only" }'), /platform/)
})
