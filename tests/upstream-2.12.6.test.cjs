const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

function load(filename, imports, globals = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, {
    module, exports: module.exports, console, Buffer, ...globals,
    require: name => {
      assert(Object.hasOwn(imports, name), 'Unexpected import: ' + name)
      return imports[name]
    },
  }, { filename })
  return module.exports
}
const plain = value => JSON.parse(JSON.stringify(value))
const playlist = (source, request) => load(`src/renderer/utils/musicSdk/${source}/songList.js`, {
  '../../request': { httpFetch: request },
  '../../index': { decodeName: value => require('he').decode(String(value ?? '')), formatPlayCount: String, dateFormat: String },
  '../utils': {},
  './util': { signatureParams: () => 'test-signature' },
  '@renderer/utils/musicSdk/kg/vendors/infSign.min': {},
}).default
const response = body => ({ promise: Promise.resolve({ statusCode: 200, body }), cancelHttp() {} })
const basic = { tid: 42, title: 'Songs &amp; Friends', creator: { nick: 'A &amp; B' }, cover: { default_url: 'fallback-cover' },
  play_cnt: 100, modify_time: 1, song_cnt: 121, desc: 'one<br>two' }

test('QQ public recommendations use the new feed, preserve metadata and request the selected page', async() => {
  let payload
  const sdk = playlist('tx', url => {
    payload = JSON.parse(new URL(url).searchParams.get('data'))
    return response({ code: 0, playlist: { code: 0, data: { FeedRsp: {
      List: [{ Playlist: { basic } }, { OtherCard: {} }], FromLimit: 108,
    } } } })
  })
  const result = await sdk.getList('-1', '', 2)
  assert.equal(payload.playlist.module, 'music.playlist.PlaylistSquare')
  assert.equal(payload.playlist.method, 'GetRecommendWhole')
  assert.deepEqual(payload.playlist.param.FeedReq, { From: 36, Size: 36 })
  assert.deepEqual(plain(result.list), [{ id: '42', name: 'Songs & Friends', author: 'A & B', img: 'fallback-cover',
    desc: 'one\ntwo', total: 121, play_count: '100', time: '1000', source: 'tx' }])
  assert.equal(result.total, 108)
  assert.equal(result.page, 2)
  assert.equal(result.limit, 36)
})

test('QQ hottest, newest, previous hottest value and explicit tags use the category endpoint', async() => {
  for (const [sort, tag, expected] of [['3', '', 3], ['2', '', 2], ['5', '', 3], ['-1', '167', 167]]) {
    let request
    const sdk = playlist('tx', url => {
      request = JSON.parse(new URL(url).searchParams.get('data')).playlist
      return response({ code: 0, playlist: { data: { content: { total_cnt: 1, v_item: [{ basic }] } } } })
    })
    const result = await sdk.getList(sort, tag, 3)
    assert.equal(request.method, 'get_category_content')
    assert.equal(request.param.category_id, expected)
    assert.equal(request.param.page, 2)
    assert.equal(result.list[0].id, '42')
  }
})

test('changing QQ public recommendation pages cancels the previous request', async() => {
  let cancelCount = 0, requests = 0
  const sdk = playlist('tx', () => {
    if (++requests > 1) return response({ code: 0, playlist: { code: 0, data: { FeedRsp: { FromLimit: 0 } } } })
    let cancel
    return { promise: new Promise((resolve, reject) => { cancel = reject }),
      cancelHttp() { cancelCount++; cancel(Error('cancelled')) } }
  })
  const cancelled = assert.rejects(sdk.getList('-1', '', 1), /cancelled/)
  assert.equal((await sdk.getList('-1', '', 2)).list.length, 0)
  await cancelled
  assert.equal(cancelCount, 1)
})

test('QQ recommendation errors reject instead of silently reporting an empty successful list', async() => {
  for (const body of [{ code: 1 }, { code: 0, playlist: { code: 1, data: {} } }, { code: 0, playlist: { code: 0 } }]) {
    await assert.rejects(playlist('tx', () => response(body)).getList('-1', '', 1), /getRecommendList failed/)
  }
})

test('Kugou GCID and chain downloads all pages in order, including the final partial page', async() => {
  const calls = []
  const sdk = playlist('kg', url => {
    const params = new URL(url).searchParams
    const page = Number(params.get('page'))
    calls.push(page)
    assert.equal(params.get('global_collection_id'), 'collection42')
    assert.equal(params.get('chain'), 'chain42')
    assert.equal(params.get('pagesize'), '50')
    assert.equal(params.get('signature'), 'test-signature')
    const start = (page - 1) * 50
    return response({ error_code: 0, data: {
      info: [{ count: 121, name: 'Complete playlist', pic: 'cover-{size}', intro: 'Description', list_create_username: 'Author' }],
      list: { info: Array.from({ length: Math.min(50, 121 - start) }, (_, i) => ({ hash: 'hash-' + (start + i) })) },
    } })
  })
  sdk.getMusicInfos = async songs => songs.map(song => song.hash)
  const result = await sdk.getListDetail('https://m3ws.kugou.com/share/index.php?global_collection_id=collection42&chain=chain42', 1)
  assert.deepEqual(calls, [1, 2, 3])
  assert.deepEqual(plain(result.list), Array.from({ length: 121 }, (_, i) => 'hash-' + i))
  assert.equal(result.total, 121)
  assert.equal(result.info.img, 'cover-240')
  assert.equal(result.info.name, 'Complete playlist')
})

test('Kugou direct links, redirect links and chain transfer retain the chain identity', async() => {
  for (const kind of ['direct', 'redirect', 'transfer']) {
    const link = 'https://m3ws.kugou.com/share/index.php?global_collection_id=collection42&chain=chain42'
    const sdk = playlist('kg', () => ({ promise: Promise.resolve({ statusCode: 302, headers: { location: link } }) }))
    sdk.createHttp = async() => ({ global_collection_id: 'collection42' })
    sdk.getListDetailByGcidChain = async(id, chain) => ({ id, chain })
    const result = kind === 'transfer' ? await sdk.getUserListDetail3('chain42', 1)
      : await sdk.getUserListDetail(kind === 'direct' ? link : 'https://example.test/share', 1)
    assert.deepEqual(result, { id: 'collection42', chain: 'chain42' })
  }
})

test('Kugou chain failures keep the older GCID fallback for direct, redirect and transfer links', async() => {
  for (const kind of ['direct', 'redirect', 'transfer']) {
    const link = 'https://m3ws.kugou.com/share/index.php?global_collection_id=collection42&chain=chain42'
    const sdk = playlist('kg', () => ({ promise: Promise.resolve({ statusCode: 302, headers: { location: link } }) }))
    sdk.createHttp = async() => ({ global_collection_id: 'collection42' })
    sdk.getListDetailByGcidChain = async() => { throw Error('unavailable') }
    sdk.getUserListDetail2 = async id => id
    const result = kind === 'transfer' ? await sdk.getUserListDetail3('chain42', 1)
      : await sdk.getUserListDetail(kind === 'direct' ? link : 'https://example.test/share', 1)
    assert.equal(result, 'collection42')
  }
})

test('Kugou GCID-only links and encoded IDs in redirect destinations retain their legacy route', async() => {
  const sdk = playlist('kg', () => ({ promise: Promise.resolve({ statusCode: 302, headers: { location: 'https://example.test/gcid_encoded42' } }) }))
  sdk.getUserListDetail2 = async id => id
  sdk.decodeGcid = async id => { assert.equal(id, 'gcid_encoded42'); return 'decoded42' }
  assert.equal(await sdk.getUserListDetail('https://example.test/?global_collection_id=plain42', 1), 'plain42')
  assert.equal(await sdk.getUserListDetail('https://example.test/short', 1), 'decoded42')
})

test('Kugou incomplete playlist response rejects rather than returning a truncated success', async() => {
  const sdk = playlist('kg', () => response({ error_code: 0, data: { info: [{ count: 121 }] } }))
  await assert.rejects(sdk.getListDetailByGcidChain('collection42', 'chain42'), /get list error/)
})

test('OS window styling distinguishes Windows 11 from the Windows 10 kernel version', () => {
  for (const [platform, release, expected] of [['win32', '10.0.26200', '11'], ['win32', '10.0.19045', '10'],
    ['win32', '6.1.7601', '6'], ['linux', '6.8.0', '6'], ['darwin', '25.0.0', '25']]) {
    const api = load('src/common/utils/index.ts', {
      'electron-log/node': { hooks: [] }, 'node:os': { release: () => release },
      '../sensitive': { installConsoleRedaction() {} },
      './common': {},
    }, { process: { platform, env: {} } })
    assert.equal(api.getOSVersion(), expected)
  }
})

test('renderer bootstrap applies opaque and OS classes while preserving the initial theme', () => {
  const script = fs.readFileSync('src/renderer/index.html', 'utf8').match(/<script>([\s\S]+?)<\/script>/)[1]
  for (const [os, version] of [['windows', '11'], ['windows', '10'], ['linux', '6'], ['mac', '25']]) {
    const classes = new Set(), styles = []
    const document = { documentElement: { setAttribute() {}, classList: { add: (...values) => values.forEach(value => classes.add(value)) } },
      createElement: () => ({}), body: { appendChild: style => styles.push(style) } }
    const theme = { colors: { '--color-primary': '#247b67' } }
    const params = new URLSearchParams({ os, osver: version, dt: 'true', dark: 'true', theme: JSON.stringify(theme) })
    const window = { location: { search: '?' + params } }
    const context = vm.createContext({ window, document, navigator: { language: 'zh-CN' }, URLSearchParams })
    vm.runInContext(script, context)
    vm.runInContext(script, context)
    assert(classes.has(os) && classes.has(`${os}-${version}`) && classes.has('disableTransparent'))
    assert.equal(window.dt, true)
    assert.equal(window.shouldUseDarkColors, true)
    assert.equal(styles[0].innerText, ':root {--color-primary:#247b67;}')
  }
})
