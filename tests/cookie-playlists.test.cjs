const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const cookies = {
  wy: 'MUSIC_U=test-session',
  tx: 'uin=7; qqmusic_key=test-session',
  kg: 'KuGoo=KugooID=7&t=test-session; kg_mid=test-device',
  kw: 'userid=7; kw_token=test-csrf',
  mg: 'migu_music_sid=test-session; USER_ID=7',
}

function load(file, imports) {
  const filename = path.join(root, file)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  const execute = vm.runInThisContext('(function(require, module, exports, console) {' + code + '\n})', { filename })
  execute(name => {
    if (name === '@common/utils/errorMessage' || name === '@common/loadErrorNotice' || name === '@common/cookieLogin') return require('./helpers/load-typescript.cjs')()('src/common/' + name.slice(8) + '.ts')
    assert(Object.hasOwn(imports, name), 'Unexpected dependency: ' + name)
    return imports[name]
  }, module, module.exports, { warn() {} })
  return module.exports
}

function fixture({ sources = Object.keys(cookies), cookieOverrides = {}, respond, sdk = {} } = {}) {
  const appSetting = Object.fromEntries(sources.map(source => ['cookie.' + source, cookieOverrides[source] ?? cookies[source]]))
  const manager = load('src/renderer/utils/cookieManager.ts', { '@renderer/store/setting': { appSetting } })
  const requests = []
  const writes = []
  const actions = Object.fromEntries(['createUserList', 'overwriteListMusics', 'updateUserList'].map(name => [name, async(data) => { writes.push({ name, data }) }]))
  const api = load('src/renderer/utils/cookiePlaylistApi.ts', {
    '@renderer/utils/cookieManager': manager,
    '@renderer/utils': { deduplicationList: items => items, toNewMusicInfo: item => item },
    '@renderer/utils/musicSdk': sdk,
    '@renderer/utils/musicSdk/wy/utils/crypto': { eapi: (url, params) => ({ url, params }) },
    '@renderer/utils/musicSdk/mg/musicInfo': { filterMusicInfoListV5: items => items },
    '@renderer/utils/musicSdk/utils': { toMD5: value => crypto.createHash('md5').update(value).digest('hex') },
    '@renderer/utils/request': {
      httpFetch(url, options) {
        requests.push({ url, options })
        return { promise: Promise.resolve().then(() => respond(url, options)) }
      },
    },
  })
  const sync = load('src/renderer/utils/cookieSync.ts', {
    '@renderer/store/setting': { appSetting },
    '@renderer/store/syncStatus': { beginSync() {}, progressSync() {}, finishSync() {} },
    './syncQueue': require('./helpers/load-typescript.cjs')()('src/renderer/utils/syncQueue.ts'),
    './platformSyncSelection': require('./helpers/load-typescript.cjs')()('src/renderer/utils/platformSyncSelection.ts'),
    '@renderer/store/list/action': actions,
    '@renderer/store/list/listManage/state': { userLists: [] },
    './cookieManager': manager,
    './cookiePlaylistApi': api,
    './playlistWriteback': { refreshBoundPlaylist: async(_id, read, apply) => apply(await read()) },
  })
  return { sync, api, manager, requests, writes, appSetting }
}

const response = body => ({ statusCode: 200, body })
function playlistResponse(url, options, empty = false) {
  if (url.includes('music.163.com')) {
    if (options.form.url.endsWith('/account/get')) return response({ code: 200, account: { id: 7 } })
    return response({ code: 200, playlist: empty ? [] : [
      { id: 11, name: 'My playlist', creator: { userId: 7 } },
      { id: 12, name: 'Another user', creator: { userId: 8 } },
    ] })
  }
  if (url.includes('c.y.qq.com')) return response({ code: 0, data: { disslist: empty ? [] : [{ tid: 21, diss_name: 'My playlist' }] } })
  if (url.includes('kugou.com')) return response({ status: 1, error_code: 0, data: { list_count: empty ? 0 : 1, info: empty ? [] : [{ listid: 31, type: 0, is_def: 0, name: 'My playlist' }] } })
  if (url.includes('kuwo.cn')) return response({ result: 'ok', plist: empty ? [] : [{ id: 41, uid: 7, type: 'GENERAL', title: 'My playlist' }] })
  if (url.includes('migu.cn')) return response({ code: '000000', data: { myCreatedMusicLists: { createdMusicLists: empty ? [] : [{ musicListId: 51, title: 'My playlist' }] } } })
  throw Error('Unexpected endpoint')
}

test('personal playlist checks parse all five platforms without changing local playlists', async() => {
  const { sync, writes } = fixture({ respond: playlistResponse })
  for (const source of Object.keys(cookies)) {
    assert.deepEqual(await sync.checkCookiePlaylists(source), { source, status: 'success', listCount: 1 })
  }
  assert.deepEqual(writes, [])
})

test('unconfigured platforms are reported without network requests', async() => {
  const { sync, requests, writes } = fixture({ sources: [] })
  for (const source of Object.keys(cookies)) {
    assert.deepEqual(await sync.checkCookiePlaylists(source), { source, status: 'missing_cookie', listCount: 0 })
  }
  assert.deepEqual(requests, [])
  assert.deepEqual(writes, [])
})

test('QQ account product directories are excluded without losing its liked or created playlists', async() => {
  const { sync, writes } = fixture({ sources: ['tx'], respond: () => response({ code: 0, data: { disslist: [
    { tid: 0, dirid: 205, diss_name: 'Digital albums' },
    { tid: 21, dirid: 201, diss_name: 'Liked songs' },
    { tid: 0, dirid: 206, diss_name: 'Purchased songs' },
    { tid: 22, dirid: 1, diss_name: 'Created playlist' },
  ] } }) })
  assert.deepEqual(await sync.checkCookiePlaylists('tx'), { source: 'tx', status: 'success', listCount: 2 })
  assert.deepEqual(writes, [])
})

test('anonymous tracking and CSRF cookies are not treated as playlist login credentials', async() => {
  const { manager } = fixture()
  assert.equal(manager.isCookieValid('wy', '__csrf=tracking-only'), false)
  assert.equal(manager.isCookieValid('kg', 'kg_mid=device-only; kg_user_v=tracking-only'), false)
  assert.equal(manager.isCookieValid('kw', 'kw_token=csrf-only; Hm_lvt_123=tracking-only'), false)
})

test('an expired NetEase login is distinguished from an empty playlist collection', async() => {
  const { sync } = fixture({ respond: () => response({ code: 200, account: null, profile: null }) })
  assert.equal((await sync.checkCookiePlaylists('wy')).status, 'login_expired')
})

test('NetEase personal playlist checks authenticate client cookies and recognize explicit expiry', async() => {
  const { sync, requests } = fixture({ sources: ['wy'], respond: (url, options) => {
    if (url.endsWith('/api/linux/forward')) return response({ code: 200, account: null, profile: null })
    assert.equal(new URL(url).origin, 'https://interfacepc.music.163.com')
    assert.equal(options.form.params.header.MUSIC_U, 'test-session')
    return playlistResponse(url, options)
  } })
  assert.equal((await sync.checkCookiePlaylists('wy')).status, 'success')
  assert.equal(requests.length, 2)
  const expired = fixture({ sources: ['wy'], respond: () => response({ code: 301 }) })
  assert.equal((await expired.sync.checkCookiePlaylists('wy')).status, 'login_expired')
})

test('HTTP errors, malformed responses and network failures are never reported as empty success', async() => {
  for (const respond of [
    () => ({ statusCode: 503, body: {} }),
    () => response({ status: 1, error_code: 0, data: {} }),
    () => { throw Error('network timeout') },
  ]) {
    const { sync, writes } = fixture({ respond })
    for (const source of Object.keys(cookies)) assert.equal((await sync.checkCookiePlaylists(source)).status, 'failed')
    assert.deepEqual(writes, [])
  }
})

test('empty personal collections succeed on all platforms, including the sync summary', async() => {
  const { sync, writes } = fixture({ respond: (url, options) => playlistResponse(url, options, true) })
  for (const source of Object.keys(cookies)) assert.deepEqual(await sync.checkCookiePlaylists(source), { source, status: 'success', listCount: 0 })
  const summary = await sync.syncAllPlaylists()
  assert.equal(summary.synced, true)
  assert.equal(summary.error, false)
  assert.equal(summary.details.length, 5)
  assert(summary.details.every(detail => detail.status === 'success' && detail.listCount === 0))
  assert.deepEqual(writes, [])
})

test('Kugou pagination continues when the first page contains only excluded lists', async() => {
  const { sync, requests } = fixture({ respond: (url, options) => {
    const { page } = JSON.parse(options.body)
    return response({ status: 1, error_code: 0, data: {
      list_count: 2,
      info: page === 1
        ? [{ listid: 31, type: 1, is_def: 0, name: 'Subscribed' }]
        : [{ listid: 32, type: 0, is_def: 0, name: 'Created' }],
    } })
  } })
  assert.equal((await sync.checkCookiePlaylists('kg')).listCount, 1)
  assert.equal(requests.length, 2)
})

test('Kugou web cookies authenticate playlist and paged song reads with their original app ID', async() => {
  for (const appid of [1010, 1014]) {
    const cookie = 'KuGoo=' + encodeURIComponent('KugooID=7&t=test-session&a_id=' + appid) + '; mid=web-device; dfid=web-dfid'
    const { sync, api, requests, writes } = fixture({ sources: ['kg'], cookieOverrides: { kg: cookie }, sdk: { kg: { songList: { getMusicInfos: async songs => songs } } }, respond: (url, options) => {
      const parsed = new URL(url)
      assert.equal(parsed.searchParams.get('appid'), String(appid))
      assert.equal(parsed.searchParams.get('clientver'), '20000')
      assert.equal(parsed.searchParams.get('plat'), '4')
      assert.equal(parsed.searchParams.get('srcappid'), '2919')
      assert.equal(parsed.searchParams.get('mid'), 'web-device')
      assert.equal(parsed.searchParams.get('dfid'), 'web-dfid')
      assert.equal(parsed.searchParams.get('uuid'), 'web-device')
      assert.match(parsed.searchParams.get('clienttime'), /^\d{13}$/)
      const entries = [...parsed.searchParams].filter(([key]) => key !== 'signature').sort(([left], [right]) => left.localeCompare(right))
      const salt = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt'
      const signature = crypto.createHash('md5').update(salt + entries.map(([key, value]) => key + '=' + value).join('') + options.body + salt).digest('hex')
      assert.equal(parsed.searchParams.get('signature'), signature)
      if (parsed.pathname === '/v7/get_all_list') return response({ status: 1, error_code: 0, data: { list_count: 3, info: [
        { listid: 1, type: 0, is_def: 1, name: 'Default collection' },
        { listid: 2, type: 0, is_def: 2, name: 'Default liked songs' },
        { listid: 3, type: 0, name: 'Created playlist' },
      ] } })
      assert.equal(parsed.pathname, '/v4/get_list_all_file')
      const body = JSON.parse(options.body)
      assert.equal(body.listid, '3')
      return response({ status: 1, error_code: 0, data: { count: 2, info: [{ id: 'song-' + body.page, FileHash: String(body.page).repeat(32) }] } })
    } })
    assert.deepEqual(await sync.checkCookiePlaylists('kg'), { source: 'kg', status: 'success', listCount: 1 })
    const songs = await api.getRemoteSongs('kg', cookie, { id: '3', name: 'Created playlist' })
    assert.deepEqual(songs.map(song => song.id), ['song-1', 'song-2'])
    assert.deepEqual(requests.map(request => JSON.parse(request.options.body).page), [1, 1, 2])
    assert.deepEqual(writes, [])
  }
})

test('Kugou legacy cookies retain the Android authentication protocol', async() => {
  const { sync, requests } = fixture({ sources: ['kg'], respond: playlistResponse })
  assert.equal((await sync.checkCookiePlaylists('kg')).status, 'success')
  const params = new URL(requests[0].url).searchParams
  assert.equal(params.get('appid'), '1005')
  assert.equal(params.get('clientver'), '20489')
  assert.equal(params.get('plat'), '1')
  assert.equal(params.get('uuid'), '-')
  assert.equal(params.has('srcappid'), false)
  assert.match(params.get('clienttime'), /^\d{10}$/)
  assert.match(requests[0].options.headers['user-agent'], /^Android/)
})

test('invalid song responses cannot overwrite local lists or make an all-failed sync succeed', async() => {
  const { sync, writes } = fixture({ sources: ['kg'], respond: (url, options) => url.includes('/v4/')
    ? response({ status: 1, error_code: 0, data: {} })
    : playlistResponse(url, options),
  })
  const summary = await sync.syncAllPlaylists()
  assert.equal(summary.synced, false)
  assert.equal(summary.error, true)
  assert.equal(summary.details[0].status, 'failed')
  assert.deepEqual(writes, [])
})

test('Migu storage tokens authenticate the catalog and every page of private playlist songs', async() => {
  const { sync, requests, writes } = fixture({ sources: ['mg'], cookieOverrides: { mg: 'mg_auth_pacmtoken=test-platform-token' }, respond: (url, options) => {
    const parsed = new URL(url)
    assert.equal(parsed.origin, 'https://app.c.nf.migu.cn')
    assert.match(options.headers.Cookie, /(?:^|;\s*)pacmtoken=test-platform-token(?:;|$)/)
    assert.notEqual(options.method, 'post')
    if (parsed.pathname.endsWith('/home-page/v2.0')) return response({ code: '000000', data: { myCreatedMusicLists: { createdMusicLists: [{ musicListId: '51', title: 'Private' }, { musicListId: '52', title: 'Empty' }] } } })
    assert.equal(parsed.pathname, '/MIGUM3.0/resource/playlist/song/v2.0')
    if (parsed.searchParams.get('playlistId') === '52') return response({ code: '000000', data: { totalCount: 0, songList: [] } })
    const start = (Number(parsed.searchParams.get('pageNo')) - 1) * 50
    return response({ code: '000000', data: { totalCount: '103', songList: Array.from({ length: Math.min(50, 103 - start) }, (_, index) => ({ id: 'mg_' + (start + index), contentId: '90071992547409930' })) } })
  } })
  const result = await sync.syncCookiePlaylists('mg')
  assert.equal(result.synced, true)
  assert.equal(result.error, false)
  assert.equal(result.listCount, 2)
  assert.equal(result.count, 103)
  const created = writes.filter(write => write.name === 'createUserList')
  assert.equal(created.length, 2)
  assert.equal(created.find(write => write.data.id === 'userlist_mg_sync_51').data.list.length, 103)
  assert.equal(created.find(write => write.data.id === 'userlist_mg_sync_51').data.list[0].contentId, '90071992547409930')
  assert.deepEqual(requests.filter(request => new URL(request.url).searchParams.get('playlistId') === '51').map(request => new URL(request.url).searchParams.get('pageNo')), ['1', '2', '3'])
})

test('Migu keeps native pacmtoken credentials and recognizes the actual unauthenticated response', async() => {
  const { sync, requests } = fixture({ sources: ['mg'], cookieOverrides: { mg: 'pacmtoken=native-token' }, respond: () => response({ code: '290001', info: 'No login' }) })
  const expired = await sync.checkCookiePlaylists('mg')
  assert.equal(expired.status, 'login_expired')
  assert.match(expired.message, /login expired/)
  assert(!expired.message.includes('[redacted]'))
  assert.equal(requests[0].options.headers.Cookie, 'pacmtoken=native-token')
  const failed = fixture({ sources: ['mg'], respond: () => response({ code: '999999', data: { myCreatedMusicLists: { createdMusicLists: [] } } }) })
  assert.equal((await failed.sync.checkCookiePlaylists('mg')).status, 'failed')
})

test('Migu expiry or incomplete later pages never save the already-fetched first page', async() => {
  for (const later of [
    { code: '290001' },
    { code: '000000', data: { totalCount: 103, songList: [] } },
    { code: '000000', data: { totalCount: 104, songList: [{ id: 'changed' }] } },
    { code: '000000', data: { totalCount: null, songList: [] } },
    { code: '000000', data: { totalCount: false, songList: [] } },
  ]) {
    const { sync, writes } = fixture({ sources: ['mg'], respond: (url, options) => {
      if (url.includes('/home-page/')) return playlistResponse(url, options)
      if (new URL(url).searchParams.get('pageNo') === '1') return response({ code: '000000', data: { totalCount: 103, songList: Array.from({ length: 50 }, (_, index) => ({ id: 'mg_' + index })) } })
      return response(later)
    } })
    const result = await sync.syncCookiePlaylists('mg')
    assert.equal(result.synced, false)
    assert.equal(result.error, true)
    assert.deepEqual(writes, [])
  }
})
