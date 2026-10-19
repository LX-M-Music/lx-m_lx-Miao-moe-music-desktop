const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const http = require('node:http')
const { once, EventEmitter } = require('node:events')
const { test } = require('node:test')
const ts = require('typescript')
const { WebSocketServer } = require('ws')
const loadSearch = require('./helpers/load-search-sdk.cjs')

function load(file, imports = {}, globals = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, console, Buffer, AbortController, setTimeout, clearTimeout, ...globals,
    require: name => {
      if (Object.hasOwn(imports, name)) return imports[name]
      if (name.endsWith('requestContext')) return require('./helpers/load-typescript.cjs')()('src/renderer/utils/requestContext.js')
      if (name.startsWith('node:') || ['ws', 'zlib'].includes(name)) return require(name)
      throw Error('Unexpected import: ' + name)
    },
  }, { filename: file })
  return module.exports
}
const common = load('src/common/utils/common.ts')
const plain = value => JSON.parse(JSON.stringify(value))

test('Kuwo recommendation groups include unlabeled playlists and omit artists and other card types', () => {
  const sdk = load('src/renderer/utils/musicSdk/kw/songList.js', {
    '../../request': {}, '../../index': {}, './util': {}, './album': {},
  }).default
  const cards = ['songlist', 'list', 'album', 'artist', 'radio'].map((type, id) => ({ type, id, digest: id + 5, name: type }))
  const result = sdk.filterList2([{ list: cards }, { label: 'empty' }])
  assert.deepEqual(Array.from(result, item => item.name), ['songlist', 'list', 'album'])
  assert(result.every(item => item.source === 'kw' && item.id.startsWith('digest-')))
})

test('Kugou Android search preserves the original title, version suffix and album audio identity', async() => {
  const f = loadSearch(({ url }) => {
    const params = new URL(url).searchParams
    assert.equal(params.get('platform'), 'AndroidFilter')
    assert.equal(params.get('keyword'), '歌曲 & artist')
    return { statusCode: 200, body: { error_code: 0, data: { total: 1, lists: [{
      Audioid: 42, FileHash: 'HASH', FileSize: 128, MixSongID: 999,
      SongName: 'Singer - decorated title', OriSongName: '歌曲', Suffix: '(Live)', Singers: [{ name: 'Singer' }], Duration: 120,
    }] } } }
  })
  const [song] = (await f.sdk('kg').search('歌曲 & artist', 1, 10)).list
  assert.equal(song.name, '歌曲 (Live)')
  assert.equal(song.songmid, 42)
  assert.equal(song.albumAudioId, 999)
  const tools = load('src/common/utils/tools.ts')
  const converted = tools.toNewMusicInfo(song)
  assert.equal(converted.meta.albumAudioId, 999)
  assert.equal(tools.toOldMusicInfo(converted).albumAudioId, 999)
})

test('QQ playlist detail switches to uniform_get_Dissinfo when the old response has no usable cdlist', async() => {
  for (const oldBody of [{ code: 0, subcode: 1 }, { code: 0, subcode: 0, cdlist: [] }]) {
    const calls = []
    const sdk = load('src/renderer/utils/musicSdk/tx/songList.js', {
      '../../index': { ...common, decodeName: value => value, formatPlayCount: String }, '../utils': {},
      '../../request': { httpFetch: (url, options) => {
        calls.push({ url, options })
        return { promise: Promise.resolve({ body: calls.length === 1 ? oldBody : { code: 0, req_1: { code: 0, data: {
          songlist: [], total_song_num: 0, dirinfo: { title: 'Playlist', picurl: 'cover', desc: 'one<br>two', host_nick: 'Author', listennum: 3 },
        } } } }) }
      } },
    }).default
    const result = await sdk.getListDetail('123456789')
    assert.equal(calls.length, 2)
    assert.equal(calls[1].options.body.req_1.method, 'uniform_get_Dissinfo')
    assert.equal(calls[1].options.body.req_1.param.disstid, 123456789)
    assert.equal(result.info.name, 'Playlist')
    assert.equal(result.info.desc, 'one\ntwo')
    assert.equal(result.total, 0)
    assert.equal(result.list.length, 0)
  }
})

test('automatic source matching rejects differing versions and includes the five-second boundary', async() => {
  const versionChars = load('src/renderer/utils/musicSdk/versionChars.ts')
  const imports = Object.fromEntries(['kw', 'kg', 'tx', 'wy', 'mg', 'bd'].map(source => ['./' + source + '/index', {}]))
  Object.assign(imports, { './xm': {}, './api-source': {}, './versionChars': versionChars,
    './plugins/loader': { loadLocalSourcePlugins: () => [], loadRemoteSourcePlugins: async() => [] },
    '@common/musicFree': load('src/common/musicFree.ts'),
    './plugins/sourceEvents': require('./helpers/load-typescript.cjs')({ '@common/utils/vueTools': require('vue') })('src/renderer/utils/musicSdk/plugins/sourceEvents.js'),
  })
  const sdk = load('src/renderer/utils/musicSdk/index.js', imports).default
  const original = { name: 'A Song', singer: 'Artist', albumName: 'Album', interval: '03:00', source: 'kw' }
  for (const suffix of ['(Live)', '(伴奏)', '(Cover)', '(Remix)', '(Acoustic)', '(Piano)', '(Sped Up)', '(Backing Track)']) {
    sdk.searchMusic = async() => [{ source: 'tx', list: [{ ...original, source: 'tx', name: 'A Song ' + suffix }] }]
    assert.equal((await sdk.findMusic(original)).length, 0, suffix)
  }
  for (const [interval, expected] of [['03:05', 1], ['03:06', 0]]) {
    sdk.searchMusic = async() => [{ source: 'tx', list: [{ ...original, source: 'tx', interval }] }]
    assert.equal((await sdk.findMusic(original)).length, expected)
  }
})

const LinePlayer = load('src/common/utils/lyric-font-player/line-player.js', {
  './utils': { getNow: () => 0, TimeoutTools: class { clear() {} } },
}).default
function parseLines(lyric, extendedLyrics = []) {
  const player = new LinePlayer()
  player.setLyric(lyric, extendedLyrics)
  return plain(player.lines)
}

test('LRC fractions retain leading zeros and mixed precisions share translated and repeated time tags', () => {
  const lines = parseLines('[00:01.005]five\n[00:01.05]fifty\n[00:01.5]five hundred\n[00:02]whole\n[01:02:03.05]hours', ['[00:01.050]translation'])
  assert.deepEqual(lines.map(line => line.time), [1005, 1050, 1500, 2000, 3723050])
  assert.deepEqual(lines[1].extendedLyrics, ['translation'])
  assert.equal(parseLines('[00:01.05]first\n[00:01.050]second').length, 1)
  assert.deepEqual(parseLines('[00:01.05][00:02.050]repeat').map(line => line.time), [1050, 2050])
})

test('KRC conversion emits three-digit milliseconds consumed without timing drift', async() => {
  const { deflateSync } = require('node:zlib')
  const input = deflateSync('[1005,100]<0,100,0>word\n[2050,100]<0,100,0>next')
  const key = Buffer.from([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69])
  for (let i = 0; i < input.length; i++) input[i] ^= key[i % key.length]
  const { decodeKrc } = load('src/common/utils/lyricUtils/kg.js', { './util': { decodeName: value => value } })
  const result = await decodeKrc(Buffer.concat([Buffer.from('krc1'), input]).toString('base64'))
  assert.match(result.lyric, /\[00:01\.005]/)
  assert.deepEqual(parseLines(result.lxlyric).map(line => line.time), [1005, 2050])
})

test('Migu uses supplied plain lyrics when mrcUrl is empty and fetches missing metadata by song ID', async() => {
  const metadataIds = [], urls = []
  const sdk = load('src/renderer/utils/musicSdk/mg/lyric.js', {
    './musicInfo': { getMusicInfo: async id => { metadataIds.push(id); return { mrcUrl: 'word-lyrics' } } },
    './utils/mrc': { decrypt: value => value },
    '../../request': { httpFetch: url => { urls.push(url); return { promise: Promise.resolve({ statusCode: 200, body: url === 'word-lyrics' ? '[1005,100](1005,100)word' : '[00:01.05]plain' }) } } },
  }).default
  assert.equal((await sdk.getLyric({ songmid: '42', mrcUrl: '', lrcUrl: 'plain-lyrics' }).promise).lyric, '[00:01.05]plain')
  assert.equal(metadataIds.length, 0)
  const result = await sdk.getLyric({ songmid: '42' }).promise
  assert.deepEqual(metadataIds, ['42'])
  assert.deepEqual(urls, ['plain-lyrics', 'word-lyrics'])
  assert.equal(parseLines(result.lxlyric)[0].time, 1005)
})

test('NetEase header milliseconds and ordinary LRC translations retain their exact timestamps', async() => {
  const getLyric = load('src/renderer/utils/musicSdk/wy/lyric.js', {
    './utils/crypto': { eapi: () => ({}) },
    '../../request': { httpFetch: () => ({ promise: Promise.resolve({ body: { code: 200,
      lrc: { lyric: '{"t":5,"c":[{"tx":"header"}]}\n[00:01.05]line' }, tlyric: { lyric: '[00:01.050]translation' },
    } }) }) },
  }).default
  const info = await getLyric('42').promise
  const lines = parseLines(info.lyric, [info.tlyric])
  assert.deepEqual(lines.map(line => line.time), [5, 1050])
  assert.deepEqual(lines[1].extendedLyrics, ['translation'])
})

test('QQ and NetEase align translated lyrics across minute boundaries and differing fractional widths', async() => {
  const getLyric = load('src/renderer/utils/musicSdk/wy/lyric.js', {
    './utils/crypto': { eapi: () => ({}) },
    '../../request': { httpFetch: () => ({ promise: Promise.resolve({ body: { code: 200,
      lrc: { lyric: '[01:00.005]line' }, yrc: { lyric: '[60005,100](60005,100,0)line' },
      ytlrc: { lyric: '[00:59.95]translation' },
    } }) }) },
  }).default
  const wy = await getLyric('42').promise
  assert.equal(parseLines(wy.lyric, [wy.tlyric])[0].extendedLyrics[0], 'translation')

  const tx = load('src/renderer/utils/musicSdk/tx/lyric.js', {
    '../../request': {}, './musicInfo': {}, '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: {} },
    '@common/rendererIpc': { rendererInvoke: async(_, { lrc, tlrc, rlrc }) => ({ lyric: lrc, tlyric: tlrc, rlyric: rlrc }) },
  }).default
  const result = await tx.parseLyric('[60005,100]line(60005,100)', '[00:59.95]translation', '')
  assert.equal(parseLines(result.lyric, [result.tlyric])[0].extendedLyrics[0], 'translation')
})

test('custom background paths encode spaces, percent, hash and non-ASCII names exactly once', () => {
  const utils = load('src/renderer/store/utils.ts', {
    '@common/utils/common': common, '@common/utils/nodejs': { joinPath: path.join },
    '@common/utils/vueTools': {}, '@renderer/utils/ipc': {}, './index': {},
  })
  const dir = path.resolve('logs/theme fixtures')
  const file = '背景 (test) #100%.png'
  const url = common.encodePath(path.join(dir, file))
  assert.equal(require('node:url').fileURLToPath(url), path.join(dir, file))
  assert.equal(utils.buildBgUrl(file, dir), `url("${url}")`)
  assert.equal(utils.buildBgUrl('https://example.test/cover.png', dir), 'url(https://example.test/cover.png)')
})

test('Linux and Windows tray clicks show the main window while macOS retains its menu behavior', () => {
  for (const platform of ['linux', 'win32', 'darwin']) {
    let tray, shows = 0
    const sdk = load('src/main/modules/tray.ts', {
      electron: { Tray: class extends EventEmitter { constructor() { super(); tray = this } setIgnoreDoubleClickEvents() {} }, nativeImage: { createFromPath: value => value } },
      '@common/utils': { isMac: platform === 'darwin', isWin: platform === 'win32' },
      './winMain': { showWindow: () => { shows++ } }, '@main/app': {}, '@common/constants': {},
    }, { global: { staticPath: '/fixture', lx: { theme: { shouldUseDarkColors: false }, appSetting: { 'tray.enable': true } } } })
    sdk.createTray()
    tray.emit('click')
    assert.equal(shows, platform === 'darwin' ? 0 : 1, platform)
  }
})

test('sync WebSocket connection follows a real redirect and retains its authentication query', { timeout: 10000 }, async t => {
  const server = http.createServer()
  const wss = new WebSocketServer({ noServer: true })
  const paths = []
  server.on('upgrade', (req, socket, head) => {
    paths.push(req.url)
    if (req.url.startsWith('/socket?')) {
      socket.end(`HTTP/1.1 302 Found\r\nLocation: /redirected${req.url}\r\nContent-Length: 0\r\n\r\n`)
    } else wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const sdk = load('src/main/modules/sync/client/client.ts', {
    './utils': {}, './sync': { callObj: {} }, '../log': { info() {}, error() {} },
    '@common/utils/common': common, '../utils': { aesEncrypt: () => 'encrypted/value' },
    '@main/modules/winMain': { sendClientStatus() {} },
    message2call: { createMsg2call: () => ({ remote: {}, createQueueRemote: () => ({}), destroy() {} }) },
    '@common/constants_sync': { SYNC_CODE: { msgConnect: 'connect' }, SYNC_CLOSE_CODE: { normal: 1000, failed: 4000 } },
    '@common/utils/nodejs': { getAddress: () => [] },
  }, { console: { log() {} } })
  t.after(async() => {
    await sdk.disconnect()
    for (const client of wss.clients) client.terminate()
    await new Promise(resolve => wss.close(resolve))
    await new Promise(resolve => server.close(resolve))
  })
  const connection = once(wss, 'connection')
  sdk.connect({ wsProtocol: 'ws:', hostPath: '127.0.0.1:' + server.address().port }, { clientId: 'fixture/id', key: 'fixture' })
  await connection
  assert.equal(paths.length, 2)
  const params = new URL(paths[1], 'http://fixture').searchParams
  assert.equal(params.get('i'), 'fixture/id')
  assert.equal(params.get('t'), 'encrypted/value')
})
