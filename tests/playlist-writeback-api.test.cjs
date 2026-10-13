const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { test } = require('node:test')
const createLoader = require('./helpers/load-typescript.cjs')
const md5 = text => createHash('md5').update(text).digest('hex')
const response = body => ({ statusCode: 200, body })
const cookies = {
  wy: 'MUSIC_U=test-session; __csrf=test-csrf',
  tx: 'uin=7; qqmusic_key=test-session',
  kg: 'KuGoo=KugooID=7&t=test-session; kg_mid=test-device',
  mg: 'mg_auth_uid=7; mg_auth_pacmtoken=test-session',
}

function fixture(respond, cookieOverrides = {}) {
  const appSetting = Object.fromEntries(Object.entries({ ...cookies, ...cookieOverrides }).map(([source, cookie]) => ['cookie.' + source, cookie]))
  const imports = { '@renderer/store/setting': { appSetting } }
  const load = createLoader(imports)
  const manager = load('src/renderer/utils/cookieManager.ts')
  const requests = []
  Object.assign(imports, {
    '@renderer/utils/cookieManager': manager,
    '../cookieManager': manager,
    '@renderer/utils': { deduplicationList: items => items, toNewMusicInfo: item => item },
    '@renderer/utils/musicSdk': {},
    '@renderer/utils/musicSdk/wy/utils/crypto': { eapi: (url, params) => ({ url, params }) },
    '@renderer/utils/musicSdk/mg/musicInfo': { filterMusicInfoListV5: items => items },
    '@renderer/utils/musicSdk/utils': { toMD5: md5 },
    '../ipc': { updateSetting: async settings => { Object.assign(appSetting, settings) } },
    '@renderer/utils/request': {
      httpFetch(url, options) {
        requests.push({ url, options })
        return { promise: Promise.resolve().then(() => respond(url, options)) }
      },
    },
  })
  const { openRemotePlaylist } = load('src/renderer/utils/playlistWriteback/api.ts')
  return { requests, appSetting, open: source => openRemotePlaylist({ source, remoteId: '123', snapshot: { name: 'My list', tracks: [] } }) }
}

const wyRead = (options, overrides = {}) => {
  if (options.form.url.endsWith('/account/get')) return response({ code: 200, account: { id: 7 } })
  return response({ code: 200, playlist: { name: 'My list', creator: { userId: 7 }, specialType: 0, trackCount: 2, trackIds: [{ id: 11 }, { id: 12 }], ...overrides } })
}
const isWyRead = url => url.endsWith('/account/get') || url.endsWith('/playlist/detail')

test('NetEase client cookies can enable writeback when the web and Linux APIs report no account', async() => {
  const { open, requests } = fixture((url, options) => {
    if (url.endsWith('/api/linux/forward')) return response({ code: 200, account: null, profile: null })
    if (url.includes('/weapi/')) return response({ code: 301 })
    assert.equal(new URL(url).origin, 'https://interfacepc.music.163.com')
    assert.equal(options.form.params.header.MUSIC_U, 'test-session')
    return wyRead(options)
  })
  const session = await open('wy')
  assert.equal(session.ownerId, '7')
  assert.equal((await session.read()).tracks.length, 2)
  assert(requests.every(({ url }) => url.endsWith('/account/get') || url.endsWith('/playlist/detail')))
})

test('NetEase writes use playlist IDs, encrypted payloads and full track identifiers', async() => {
  const { open, requests } = fixture((url, options) => isWyRead(url) ? wyRead(options) : response({ code: 200 }))
  const session = await open('wy')
  await session.add([{ key: '13' }])
  await session.remove([{ key: '11' }])
  await session.rename('Renamed')
  await session.order(['12', '13'])
  const writes = requests.filter(({ url }) => !isWyRead(url))
  assert.deepEqual(writes.map(({ options }) => options.form.params.op), ['add', 'del', undefined, 'update'])
  assert.equal(writes[0].options.form.params.pid, '123')
  assert.deepEqual(JSON.parse(writes[0].options.form.params.trackIds), ['13'])
  assert.equal(writes[2].options.form.params.name, 'Renamed')
  for (const { url, options } of requests) {
    assert.equal(new URL(url).origin, 'https://interfacepc.music.163.com')
    assert.equal(new URL(url).pathname, options.form.url.replace('/api/', '/eapi/'))
    assert.equal(options.form.params.header.MUSIC_U, 'test-session')
    assert.equal(options.form.params.header.__csrf, 'test-csrf')
    assert(options.headers.Cookie.includes('MUSIC_U=test-session'))
  }
  assert.deepEqual(session.capabilities, { rename: true, order: true })
})

test('ownership, special playlists and incomplete snapshots fail before writes', async() => {
  for (const [overrides, code] of [
    [{ creator: { userId: 8 } }, 'owner'],
    [{ specialType: 5 }, 'unsupported'],
    [{ trackCount: 3 }, 'incomplete'],
  ]) {
    const { open, requests } = fixture((_url, options) => wyRead(options, overrides))
    await assert.rejects(open('wy'), error => error.code === code)
    assert(requests.every(({ url }) => isWyRead(url)))
  }
})

test('all identifiers are validated before the first batch; expired sessions stop subsequent batches', async() => {
  let writes = 0
  const { open, requests, appSetting } = fixture((url, options) => {
    if (isWyRead(url)) return wyRead(options)
    writes++
    appSetting['cookie.wy'] = 'MUSIC_U=another-account'
    return response({ code: 200 })
  })
  const session = await open('wy')
  const tracks = Array.from({ length: 105 }, (_, index) => ({ key: String(index + 1) }))
  await assert.rejects(session.add([...tracks, { key: 'invalid' }]), error => error.code === 'identity')
  assert.equal(writes, 0)
  await assert.rejects(session.add(tracks), error => error.code === 'login')
  assert.equal(writes, 1)
  assert.equal(JSON.parse(requests.at(-1).options.form.params.trackIds).length, 100)
})

test('NetEase server-side login expiry stops writes and does not become an empty account', async() => {
  for (const body of [{ code: 301 }, { code: 200, account: null, profile: null }]) {
    const { open, requests } = fixture(() => response(body))
    await assert.rejects(open('wy'), error => error.code === 'login')
    assert.equal(requests.length, 1)
  }
  const { open, requests } = fixture((url, options) => isWyRead(url) ? wyRead(options) : response({ code: 301 }))
  const session = await open('wy')
  await assert.rejects(session.add(Array.from({ length: 105 }, (_, index) => ({ key: String(index + 1) }))), error => error.code === 'login')
  assert.equal(requests.filter(({ url }) => !isWyRead(url)).length, 1)
})

test('changing the NetEase cookie during account verification prevents any subsequent request', async() => {
  const { open, appSetting, requests } = fixture((_url, options) => {
    appSetting['cookie.wy'] = 'MUSIC_U=another-account'
    return wyRead(options)
  })
  await assert.rejects(open('wy'), error => error.code === 'login')
  assert.equal(requests.length, 1)
})

test('QQ resolves the playlist directory and uses numeric song IDs rather than mids for writes', async() => {
  const { open, requests } = fixture((url, options) => {
    if (url.includes('fcg_user_created_diss')) return response({ code: 0, data: { disslist: [{ tid: 123, diss_name: 'My list' }] } })
    const { req } = JSON.parse(options.body)
    return response({ code: 0, req: { code: 0, data: req.method === 'CgiGetDiss'
      ? { dirinfo: { dirid: 9, title: 'My list' }, songlist: [{ id: 11, mid: 'mid11', type: 0 }], total_song_num: 1, hasmore: 0 }
      : { retCode: 0 } } })
  })
  const session = await open('tx')
  await session.add([{ key: 'mid12', songId: '12', songType: 1 }])
  await session.remove((await session.read()).tracks)
  const writes = requests.filter(({ options }) => options.body && JSON.parse(options.body).req.module === 'music.musicasset.PlaylistDetailWrite')
  assert.deepEqual(writes.map(({ options }) => JSON.parse(options.body).req), [
    { module: 'music.musicasset.PlaylistDetailWrite', method: 'AddSonglist', param: { dirId: 9, tid: 123, bFmtUtf8: true, v_songInfo: [{ songId: 12, songType: 1 }] } },
    { module: 'music.musicasset.PlaylistDetailWrite', method: 'DelSonglist', param: { dirId: 9, tid: 123, bFmtUtf8: true, v_songInfo: [{ songId: 11, songType: 0 }] } },
  ])
  await assert.rejects(session.rename('Name'), error => error.code === 'unsupported')
})

test('Kugou signs writes, adds hashes and deletes playlist-scoped file IDs', async() => {
  const hash = 'a'.repeat(32)
  const { open, requests } = fixture((url, options) => {
    const parsed = new URL(url)
    const signature = parsed.searchParams.get('signature')
    parsed.searchParams.delete('signature')
    const params = [...parsed.searchParams].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('')
    assert.equal(signature, md5('OIlwieks28dk2k092lksi2UIkp' + params + options.body + 'OIlwieks28dk2k092lksi2UIkp'))
    assert.equal(options.headers['x-router'], 'cloudlist.service.kugou.com')
    const data = parsed.pathname.endsWith('/get_all_list') ? { list_count: 1, info: [{ listid: 123, name: 'My list', type: 0, is_def: 0 }] }
      : parsed.pathname.endsWith('/get_list_all_file') ? { count: 1, info: [{ hash, fileid: 91, name: 'Track' }] } : {}
    return response({ status: 1, error_code: 0, data })
  })
  const session = await open('kg')
  const remote = await session.read()
  await session.add([{ key: hash, hash, name: 'Singer - Track', songId: '999999' }])
  await session.remove(remote.tracks)
  const add = requests.find(({ url }) => url.includes('/v6/add_song'))
  assert.equal(JSON.parse(add.options.body).data[0].mixsongid, 0)
  assert.equal(JSON.parse(add.options.body).data[0].hash, hash)
  assert.equal(new URL(add.url).searchParams.get('last_area'), 'gztx')
  const remove = requests.find(({ url }) => url.includes('/delete_songs'))
  assert.deepEqual(JSON.parse(remove.options.body).data, [{ fileid: 91 }])
})

test('Migu preserves long content IDs, resolves older imports and persists token rotation', async() => {
  let calls = 0
  const contentId = '600919000001716438'
  const { open, requests, appSetting } = fixture((url, options) => {
    if (++calls > 1) assert.equal(options.headers.Cookie, 'pacmtoken=rotated-session')
    if (url.includes('/home-page/')) return { ...response({ code: '000000', data: { myCreatedMusicLists: { createdMusicLists: [{ musicListId: '123', title: 'My list' }] } } }), headers: { 'set-cookie': ['pacmtoken=rotated-session; Path=/; HttpOnly'] } }
    if (url.includes('/playlist/song/')) return response({ code: '000000', data: { totalCount: 1, songList: [{ songId: '11', copyrightId: 'copy11', contentId }] } })
    if (url.includes('/resourceinfo.do')) return response({ code: '000000', resource: [{ songId: '12', copyrightId: 'copy12', contentId: '600919000001716439' }] })
    return response({ code: '000000' })
  })
  const session = await open('mg')
  const remote = await session.read()
  await session.add([{ key: '12', copyrightId: 'copy12' }])
  await session.remove(remote.tracks)
  await session.rename('Renamed')
  const writes = requests.filter(({ options }) => options.method === 'post').map(({ options }) => JSON.parse(options.body))
  assert.deepEqual(writes, [
    { id: '123', contentIds: ['600919000001716439'] },
    { id: '123', channel: '23', songflag: '2', contentId },
    { id: '123', title: 'Renamed', channel: '23', songflag: '0' },
  ])
  assert(appSetting['cookie.mg'].includes('mg_auth_pacmtoken=rotated-session'))
})

test('Migu refuses rounded numeric content IDs and unknown copyright matches before posting', async() => {
  const { open, requests } = fixture(url => {
    if (url.includes('/home-page/')) return response({ code: '000000', data: { myCreatedMusicLists: { createdMusicLists: [{ musicListId: '123', title: 'My list' }] } } })
    return response({ code: '000000', resource: [{ songId: 'other-song', copyrightId: 'copy', contentId: '600919000001716438' }] })
  })
  const session = await open('mg')
  await assert.rejects(session.add([{ key: '11', contentId: Number('600919000001716438') }]), error => error.code === 'identity')
  await assert.rejects(session.add([{ key: '11', copyrightId: 'copy' }]), error => error.code === 'identity')
  assert(requests.every(({ options }) => options.method !== 'post'))
})

test('missing credentials cannot start requests', async() => {
  const { open, requests } = fixture(() => { throw Error('must not request') }, { wy: '', tx: '', kg: '', mg: '' })
  for (const source of Object.keys(cookies)) await assert.rejects(open(source), error => error.code === 'login')
  assert.equal(requests.length, 0)
})
