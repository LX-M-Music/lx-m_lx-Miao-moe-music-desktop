const assert = require('node:assert/strict')
const { test } = require('node:test')
const createLoader = require('./helpers/load-typescript.cjs')
const { createDAV, playlists, task, song, snapshot } = require('./helpers/webdav-fixture.cjs')

const builtins = Object.fromEntries(['node:http', 'node:https', 'node:crypto', 'node:path', 'node:os'].map(name => [name, require(name)]))
const constants = {
  STORE_NAMES: { APP_SETTINGS: 'config_v2' },
  LIST_IDS: { DEFAULT: 'default', LOVE: 'love', TEMP: 'temp', DOWNLOAD: 'download' },
  QUALITYS: ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires', 'master', 'atmos', 'wav', 'ape'],
}
const defaults = createLoader(builtins)('src/common/defaultSetting.ts').default
const sections = ['playlists', 'downloadHistory', 'downloadTasks', 'settings', 'dislike']

async function fixture(t, selected = ['playlists']) {
  const dav = await createDAV()
  t.after(() => dav.close())
  const stores = new Map()
  const getStore = name => {
    if (!stores.has(name)) stores.set(name, {})
    return {
      get: key => structuredClone(stores.get(name)[key]),
      set: (key, value) => { stores.get(name)[key] = structuredClone(value) },
      override: value => { stores.set(name, structuredClone(value)) },
      snapshot: () => structuredClone(stores.get(name)),
      acceptCommitted: value => stores.set(name, structuredClone(value)),
    }
  }
  const local = { playlists: playlists('1'), downloads: [task('1', true), task('2')], dislike: 'Example', writes: [], reads: 0 }
  const settings = { ...defaults, 'sync.webdav.enable': true }
  for (const key of Object.keys(dav.config)) settings['sync.webdav.' + key] = dav.config[key]
  for (const key of sections) settings['sync.webdav.' + key] = selected.includes(key)
  getStore('config_v2').override({ setting: settings })
  const previousGlobal = global.lx
  global.lx = {
    appSetting: settings,
    worker: { dbService: {
      getDownloadList: async() => structuredClone(local.downloads),
      downloadListReplace: async list => { local.downloads = structuredClone(list); local.writes.push('downloads') },
    } },
    event_app: { config_committed: value => { Object.assign(settings, value); local.writes.push('settings') } },
    event_list: { list_data_restored() {} }, event_dislike: { dislike_data_restored() {} },
  }
  t.after(() => { global.lx = previousGlobal })
  const load = createLoader({
    ...builtins,
    '@common/defaultSetting': { default: defaults, __esModule: true },
    '@common/constants': constants,
    '@main/utils/store': { default: getStore, __esModule: true, withStoreExclusive: async fn => fn(), protectStoreRecovery() {} },
    '@main/utils': { mergeSetting: (old, update) => ({ setting: { ...old, ...update }, updatedSettingKeys: Object.keys(update), updatedSetting: update }) },
    '@main/utils/credentials': { serializePublicConfig: JSON.stringify },
    '@main/modules/sync/listEvent': {
      getLocalListData: async() => structuredClone(local.playlists),
      setLocalListData: async value => { local.playlists = structuredClone(value); local.writes.push('playlists') },
    },
    '@main/modules/sync/dislikeEvent': {
      getLocalDislikeData: async() => local.dislike,
      setLocalDislikeData: async value => { local.dislike = value; local.writes.push('dislike') },
    },
  })
  const { isCompleted, portableDownloads, hash } = load('src/main/modules/webdav/data.ts')
  const { WebDAVError } = load('src/main/modules/webdav/errors.ts')
  const revision = () => JSON.stringify([local.playlists, local.downloads, local.dislike])
  Object.assign(global.lx.worker.dbService, {
    webdavRevision: async() => revision(),
    webdavRead: async selected => {
      local.reads++
      const data = {}
      if (selected.includes('playlists')) data.playlists = structuredClone(local.playlists)
      if (selected.includes('dislike')) data.dislike = local.dislike
      if (selected.includes('downloadHistory')) data.downloadHistory = structuredClone(local.downloads.filter(isCompleted))
      if (selected.includes('downloadTasks')) data.downloadTasks = structuredClone(local.downloads.filter(task => !isCompleted(task)))
      return { data, revision: revision() }
    },
    // The real database/file transaction is covered by backup-transaction.test.cjs.
    webdavRestore: async(root, data, files, selected, expected) => {
      if (revision() !== expected) throw new WebDAVError('local_changed')
      const hashes = {}
      if (data.downloadHistory !== undefined || data.downloadTasks !== undefined) {
        if (local.downloads.some(task => ['run', 'waiting'].includes(task.status))) throw new WebDAVError('downloads_running')
        const retained = local.downloads.filter(task => isCompleted(task) ? data.downloadHistory === undefined : data.downloadTasks === undefined)
        const ids = new Set(retained.map(task => task.id))
        for (const task of [...data.downloadHistory ?? [], ...data.downloadTasks ?? []]) {
          if (ids.has(task.id)) continue
          ids.add(task.id)
          retained.push(structuredClone(task))
        }
        local.downloads = retained
        local.writes.push('downloads')
        if (data.downloadHistory !== undefined) hashes.downloadHistory = hash(portableDownloads(retained.filter(isCompleted)))
        if (data.downloadTasks !== undefined) hashes.downloadTasks = hash(portableDownloads(retained.filter(task => !isCompleted(task))))
      }
      if (data.playlists) { local.playlists = structuredClone(data.playlists); local.writes.push('playlists') }
      if (data.dislike !== undefined) { local.dislike = data.dislike.toLowerCase(); local.writes.push('dislike') }
      return { hashes, dislike: data.dislike !== undefined ? local.dislike : undefined }
    },
  })
  return { dav, local, settings, stores, load, run: load('src/main/modules/webdav/index.ts').runWebDAV }
}

test('connection test creates nested UTF-8 directories, verifies credentials and read/write, then removes its own probe', async t => {
  const f = await fixture(t, ['playlists', 'settings'])
  f.settings['sync.webdav.directory'] = '音乐/我的 同步'
  assert.equal((await f.run('test')).success, true)
  assert(f.dav.directories.has('/dav/%E9%9F%B3%E4%B9%90/%E6%88%91%E7%9A%84%20%E5%90%8C%E6%AD%A5/'))
  assert.equal(f.dav.files.size, 0)
  assert(f.dav.requests.some(req => req.method === 'PROPFIND' && req.headers.depth === '0'))
  assert.equal(f.dav.requests.filter(req => req.method === 'DELETE').length, 2)
  f.settings['sync.webdav.password'] = 'wrong'
  assert.equal((await f.run('test')).error, 'auth')
  assert.deepEqual(f.dav.errors, [])
})

test('all selected categories upload without credentials, local paths, cached URLs or download progress', async t => {
  const f = await fixture(t, sections)
  f.settings['cookie.wy'] = 'secret-cookie'
  const result = await f.run('upload')
  assert.equal(result.success, true)
  assert.deepEqual(result.uploaded, sections)
  const text = f.dav.files.get(f.dav.file)
  const remote = JSON.parse(text).data
  assert.deepEqual(Object.keys(remote), sections.filter(section => section !== 'playlists'))
  const mobile = JSON.parse(f.dav.files.get(f.dav.playlistFile))
  assert.equal(mobile.version, '2')
  assert.deepEqual(mobile.data, { ...f.local.playlists, tempList: [] })
  assert.equal(remote.downloadHistory[0].status, 'completed')
  assert.equal(remote.downloadTasks[0].status, 'pause')
  for (const secret of ['secret-cookie', 'pass word', 'expired.example', 'D:/local/', 'sync.webdav.', 'download.savePath']) assert(!text.includes(secret) && !JSON.stringify(mobile).includes(secret), secret)
  assert.equal(remote.downloadTasks[0].downloaded, 0)
  assert.equal(f.dav.requests.find(req => req.method === 'PUT').headers['if-none-match'], '*')
})

test('upload preserves every unselected cloud category and unknown future categories', async t => {
  const f = await fixture(t)
  const disabled = { downloadHistory: [task('7', true)], settings: { 'player.volume': 0.7 }, dislike: 'cloud', futureCategory: { keep: true } }
  f.dav.seed({ ...disabled, playlists: playlists('8') })
  assert.equal((await f.run('upload')).success, true)
  assert.deepEqual(JSON.parse(f.dav.files.get(f.dav.playlistFile)).data, { ...f.local.playlists, tempList: [] })
  assert.deepEqual(JSON.parse(f.dav.files.get(f.dav.file)).data, disabled)
})

test('automatic sync propagates a single-side edit and detects two-side changes before writing anything', async t => {
  const f = await fixture(t)
  assert.equal((await f.run('sync')).success, true)
  f.local.playlists.loveList.push(song('2'))
  assert.deepEqual((await f.run('sync')).uploaded, ['playlists'])
  f.dav.seed({ playlists: playlists('remote') })
  assert.deepEqual((await f.run('sync')).downloaded, ['playlists'])
  assert.equal(f.local.playlists.defaultList[0].id, 'wy_remote')
  f.local.playlists.loveList.push(song('local-edit'))
  f.dav.seed({ playlists: playlists('remote-edit') })
  const before = f.dav.files.get(f.dav.playlistFile)
  const conflict = await f.run('sync')
  assert.equal(conflict.error, 'conflict')
  assert.deepEqual(conflict.sections, ['playlists'])
  assert.equal(f.dav.files.get(f.dav.playlistFile), before)
  assert.equal(f.local.playlists.loveList[0].id, 'wy_local-edit')
  assert.equal((await f.run('download')).success, true)
  assert.equal(f.stores.get('webdav-local-backup').data.playlists.loveList[0].id, 'wy_local-edit')
  assert.equal((await f.run('sync')).success, true)
})

test('first sync pulls into an empty library but asks to resolve existing different libraries', async t => {
  const f = await fixture(t)
  f.dav.seed({ playlists: playlists('remote') })
  assert.equal((await f.run('sync')).error, 'conflict')
  f.local.playlists = playlists()
  assert.deepEqual((await f.run('sync')).downloaded, ['playlists'])
  assert.equal(f.local.playlists.defaultList[0].id, 'wy_remote')
})

test('history and task switches restore independently and leave the other category intact', async t => {
  const f = await fixture(t, ['downloadHistory'])
  const pending = structuredClone(f.local.downloads[1])
  f.dav.seed({ downloadHistory: [task('7', true)], downloadTasks: [task('8')], settings: { 'player.volume': 0.2 } })
  assert.equal((await f.run('download')).success, true)
  assert.deepEqual(f.local.downloads.find(item => item.id === pending.id), pending)
  assert.equal(f.stores.get('webdav-local-backup').data.downloadHistory[0].metadata.filePath, 'D:/local/1.mp3')
  const history = f.local.downloads.find(item => item.id === 'task_7')
  assert.equal(history.metadata.filePath, '')
  assert.equal(history.metadata.url, null)
  assert.equal(history.status, 'completed')
  assert.equal(f.settings['player.volume'], defaults['player.volume'])
  f.settings['sync.webdav.downloadHistory'] = false
  f.settings['sync.webdav.downloadTasks'] = true
  assert.equal((await f.run('download')).success, true)
  assert.deepEqual(f.local.downloads.find(item => item.id === 'task_7'), history)
  assert.equal(f.local.downloads.find(item => item.id === 'task_8').status, 'pause')
  assert(!f.local.downloads.some(item => item.id === pending.id))
})

test('restored tasks are paused and same-ID entries cannot overwrite an unselected local category', async t => {
  const f = await fixture(t, ['downloadTasks'])
  const remote = task('3')
  remote.status = 'run'
  f.dav.seed({ downloadTasks: [task('1'), remote] })
  const completed = structuredClone(f.local.downloads[0])
  assert.equal((await f.run('download')).success, true)
  assert.deepEqual(f.local.downloads[0], completed)
  assert.equal(f.local.downloads[1].status, 'pause')
  assert.equal(f.local.downloads[1].downloaded, 0)
  assert.equal(f.local.downloads[1].metadata.url, null)
  assert.equal((await f.run('sync')).success, true)
})

test('settings restore filters credentials and local preferences and applies regular settings', async t => {
  const f = await fixture(t, ['settings', 'dislike'])
  f.dav.seed({ settings: { 'player.volume': 0.25, 'sync.webdav.password': 'foreign', 'sync.enable': true, 'cookie.wy': 'foreign', 'download.savePath': 'Z:/foreign', 'network.proxy.enable': true }, dislike: '' })
  const original = { ...f.settings }
  assert.equal((await f.run('download')).success, true)
  assert.equal(f.settings['player.volume'], 0.25)
  for (const key of ['sync.webdav.password', 'sync.enable', 'cookie.wy', 'download.savePath', 'network.proxy.enable']) assert.equal(f.settings[key], original[key])
  assert.equal(f.local.dislike, '')
  assert.deepEqual((await f.run('sync')).uploaded, [])
})

test('corrupt, incomplete and unsafe remote data never partially overwrites selected data', async t => {
  const f = await fixture(t, ['playlists', 'downloadTasks', 'settings'])
  const cases = [
    '<html>login required</html>',
    JSON.stringify({ ...snapshot({}), version: 99 }),
    JSON.stringify(snapshot({ playlists: { defaultList: [] } })),
    JSON.stringify(snapshot({ playlists: playlists('7'), downloadTasks: [{ ...task('7'), metadata: { ...task('7').metadata, fileName: '../escape.mp3' } }], settings: { 'player.volume': 0.1 } })),
    JSON.stringify(snapshot({ playlists: playlists('7'), downloadTasks: [], settings: { 'player.volume': 'invalid' } })),
    JSON.stringify(snapshot({ playlists: { ...playlists('7'), userList: [{ id: 'default', name: 'bad', list: [] }] } })),
  ]
  for (const content of cases) {
    f.dav.files.set(f.dav.file, content)
    assert.equal((await f.run('download')).error, 'invalid_data')
    assert.deepEqual(f.local.writes, [])
  }
  f.dav.seed({ playlists: playlists('7') })
  assert.equal((await f.run('download')).error, 'missing_sections')
  assert.deepEqual(f.local.writes, [])
})

test('conditional PUT rejects concurrent remote edits and does not advance the baseline', async t => {
  const f = await fixture(t)
  assert.equal((await f.run('upload')).success, true)
  const baseline = structuredClone(f.stores.get('webdav').baseline)
  f.local.playlists.loveList.push(song('local'))
  f.dav.control.beforeRequest = (req) => {
    if (req.method === 'PUT') f.dav.seed({ playlists: playlists('other-device') })
  }
  assert.equal((await f.run('sync')).error, 'remote_changed')
  assert.equal(JSON.parse(f.dav.files.get(f.dav.playlistFile)).data.defaultList[0].id, 'wy_other-device')
  assert.deepEqual(f.stores.get('webdav').baseline, baseline)
})

test('local edits made during GET cancel a restore, and disabling all switches prevents network requests', async t => {
  const f = await fixture(t)
  f.dav.seed({ playlists: playlists('remote') })
  f.dav.control.beforeRequest = req => {
    if (req.method === 'GET') f.local.playlists.loveList.push(song('during-network'))
  }
  assert.equal((await f.run('download')).error, 'local_changed')
  assert.equal(f.local.playlists.loveList[0].id, 'wy_during-network')
  assert.deepEqual(f.local.writes, [])
  const requests = f.dav.requests.length
  f.settings['sync.webdav.playlists'] = false
  assert.equal((await f.run('sync')).error, 'empty_selection')
  assert.equal(f.dav.requests.length, requests)
  f.settings['sync.webdav.enable'] = false
  assert.equal((await f.run('upload')).error, 'disabled')
})

test('active downloads are never replaced and missing cloud data cannot clear local data', async t => {
  const f = await fixture(t, ['downloadTasks'])
  assert.equal((await f.run('download')).error, 'missing_remote')
  f.local.downloads[1].status = 'run'
  f.dav.seed({ downloadTasks: [] })
  assert.equal((await f.run('download')).error, 'downloads_running')
  assert.deepEqual(f.local.writes, [])
})

test('cross-origin redirects never forward credentials and servers without validators cannot overwrite a snapshot', async t => {
  const f = await fixture(t)
  f.dav.control.beforeRequest = (req, res) => { res.writeHead(302, { Location: 'http://localhost:9/stolen' }).end(); return true }
  assert.equal((await f.run('upload')).error, 'redirect')
  f.dav.control.beforeRequest = null
  f.dav.seed({ playlists: playlists('remote') })
  f.dav.control.validators = false
  assert.equal((await f.run('upload')).error, 'missing_validator')
  assert(!f.dav.requests.some(req => req.method === 'PUT'))
})

test('invalid URL credentials, traversal and unsupported schemes are rejected before sending requests', async t => {
  const f = await fixture(t)
  for (const url of ['file:///tmp/data', 'http://user:pass@example.com/dav/', 'not a URL', 'https://example.com/dav/?query=x']) {
    f.settings['sync.webdav.url'] = url
    assert.equal((await f.run('test')).error, 'invalid_config')
  }
  f.settings['sync.webdav.url'] = f.dav.config.url
  f.settings['sync.webdav.directory'] = 'music/../escape'
  assert.equal((await f.run('test')).error, 'invalid_config')
  assert.equal(f.dav.requests.length, 0)
})

test('F01/F02: each round reads one local snapshot and unchanged remote data uses conditional GET', async t => {
  const f = await fixture(t, sections)
  assert.equal((await f.run('upload')).success, true)
  const before = f.dav.requests.length
  for (let count = 0; count < 3; count++) {
    const result = await f.run('sync')
    assert.equal(result.success, true)
    assert.deepEqual(result.uploaded, [])
    assert.deepEqual(result.downloaded, [])
  }
  assert.equal(f.local.reads, 4)
  assert.equal(f.dav.requests.length - before, 6)
  assert(f.dav.requests.slice(before).every(req => req.method === 'GET' && req.headers['if-none-match']))
  f.settings['sync.webdav.password'] = 'wrong'
  assert.equal((await f.run('sync')).error, 'auth')
  assert.equal(f.dav.requests.at(-1).headers['if-none-match'], undefined, 'account changes invalidate the cached snapshot')
})

test('F06/F11: conflict includes a bounded visual diff and keeps the last successful sync time', async t => {
  const f = await fixture(t)
  const success = await f.run('upload')
  f.local.playlists.loveList.push(song('local'))
  f.dav.seed({ playlists: playlists('remote') })
  const result = await f.run('sync')
  assert.equal(result.error, 'conflict')
  assert.equal(result.lastSuccess, success.lastSuccess)
  assert(result.diff.total > 0)
  assert(result.diff.changes.some(change => change.kind === 'added' && change.after.includes('remote')))
  assert(result.diff.changes.some(change => change.kind === 'removed'))
})

test('F02: Last-Modified is used when no ETag is supplied and changed remote content is read again', async t => {
  const dav = await createDAV()
  t.after(() => dav.close())
  const client = createLoader()('src/main/modules/webdav/client.ts').createClient(dav.config)
  let content = 'first', modified = 'Mon, 21 Sep 2026 00:00:00 GMT'
  dav.control.beforeRequest = (req, res) => {
    if (req.headers['if-modified-since'] === modified) res.writeHead(304).end()
    else res.writeHead(200, { 'Last-Modified': modified }).end(content)
    return true
  }
  const first = await client.read()
  assert.equal(first.content, 'first')
  assert.equal((await client.read(first)).unchanged, true)
  content = 'second'; modified = 'Tue, 22 Sep 2026 00:00:00 GMT'
  assert.equal((await client.read(first)).content, 'second')
})

test('F01: enabling a previously unselected category validates its cached body before applying it', async t => {
  const f = await fixture(t, ['playlists', 'settings'])
  f.dav.seed({ playlists: playlists('remote'), settings: {}, downloadTasks: [{ invalid: true }] })
  assert.equal((await f.run('download')).success, true)
  const writes = f.local.writes.length
  f.settings['sync.webdav.downloadTasks'] = true
  assert.equal((await f.run('download')).error, 'invalid_data')
  assert.equal(f.local.writes.length, writes)
  assert(f.dav.requests.at(-1).headers['if-none-match'])
})

test('mobile version 2 upload preserves Walnut history, tasks, temp list, and future fields', async t => {
  const f = await fixture(t)
  const old = { version: '2', lastModified: Date.now() + 5000, data: { ...playlists('mobile'), tempList: [song('temporary')], futureListField: 'keep' }, playHistory: [{ id: 'history-1' }], downloadTasks: [{ id: 'mobile-task' }], futureTopField: { keep: true } }
  f.dav.seedMobile(old)
  f.local.playlists.userList.push({ id: 'userlist_wy_sync_private', name: 'Cookie', list: [song('private')] })
  const result = await f.run('upload')
  assert.equal(result.success, true)
  assert.deepEqual(result.uploaded, ['playlists'])
  const mobile = JSON.parse(f.dav.files.get(f.dav.playlistFile))
  assert(mobile.lastModified > old.lastModified, 'mobile clients detect the update even if the old clock was ahead')
  assert.deepEqual(mobile.data.defaultList, f.local.playlists.defaultList)
  assert.deepEqual(mobile.data.tempList, old.data.tempList)
  assert.equal(mobile.data.futureListField, 'keep')
  assert.deepEqual(mobile.playHistory, old.playHistory)
  assert.deepEqual(mobile.downloadTasks, old.downloadTasks)
  assert.deepEqual(mobile.futureTopField, old.futureTopField)
  assert(!f.dav.files.get(f.dav.playlistFile).includes('userlist_wy_sync_private'))
  assert.deepEqual((await f.run('sync')).uploaded, [])
})

test('mobile download keeps LXM Cookie lists local and scrubs leaked Cookie lists from the shared file', async t => {
  const f = await fixture(t)
  const privateList = { id: 'userlist_tx_sync_private', name: 'My Cookie List', list: [song('private')] }
  f.local.playlists.userList.push(privateList)
  const remote = playlists('from-mobile')
  remote.userList.push({ id: 'normal-list', name: 'Shared', list: [song('shared')] }, { id: 'userlist_kw_sync_leaked', name: 'Leaked', list: [song('leaked')] })
  f.dav.seedMobile({ version: '2', lastModified: Date.now(), data: { ...remote, tempList: [song('mobile-temp')] }, playHistory: [{ id: 'walnut-history' }] })
  const result = await f.run('download')
  assert.equal(result.success, true)
  assert.deepEqual(result.downloaded, ['playlists'])
  assert.deepEqual(f.local.playlists.userList.map(list => list.id), ['normal-list', privateList.id])
  assert.equal(f.local.playlists.defaultList[0].id, 'wy_from-mobile')
  assert.equal(f.local.playlists.tempList, undefined)
  const cleaned = JSON.parse(f.dav.files.get(f.dav.playlistFile))
  assert.deepEqual(cleaned.data.userList.map(list => list.id), ['normal-list'])
  assert.equal(cleaned.data.tempList[0].id, 'wy_mobile-temp')
  assert.deepEqual(cleaned.playHistory, [{ id: 'walnut-history' }])
  assert.equal((await f.run('sync')).success, true)
})

test('existing LXM-only playlist snapshot migrates to mobile file without replacing its other sections', async t => {
  const f = await fixture(t)
  f.local.playlists = playlists()
  const legacy = playlists('old-lxm')
  legacy.userList.push({ id: 'userlist_mg_sync_old', name: 'Old Cookie', list: [song('secret')] })
  f.dav.seedLegacy({ playlists: legacy, dislike: 'legacy-rule' })
  const before = f.dav.files.get(f.dav.file)
  const result = await f.run('sync')
  assert.equal(result.success, true)
  assert.deepEqual(result.downloaded, ['playlists'])
  assert.equal(f.local.playlists.defaultList[0].id, 'wy_old-lxm')
  assert.equal(f.dav.files.get(f.dav.file), before)
  assert.deepEqual(JSON.parse(f.dav.files.get(f.dav.playlistFile)).data.userList, [])
  assert.equal((await f.run('sync')).success, true)
})

test('invalid mobile playlist file is rejected before local or cloud writes', async t => {
  const f = await fixture(t)
  for (const value of [
    { version: '3', lastModified: Date.now(), data: { ...playlists('remote'), tempList: [] } },
    { version: '2', lastModified: Date.now(), data: { ...playlists('remote'), userList: [null], tempList: [] } },
    { version: '2', lastModified: Date.now(), data: { ...playlists('remote'), tempList: 'broken' } },
  ]) {
    f.dav.seedMobile(value)
    const before = f.dav.files.get(f.dav.playlistFile)
    assert.equal((await f.run('download')).error, 'invalid_data')
    assert.equal(f.dav.files.get(f.dav.playlistFile), before)
    assert.deepEqual(f.local.writes, [])
  }
})

test('custom mobile playlist directory matches a mobile fork with a changed WebDAV path', async t => {
  const f = await fixture(t)
  f.settings['sync.webdav.playlistsDirectory'] = 'Music/手机'
  assert.equal((await f.run('upload')).success, true)
  assert(f.dav.files.has('/dav/Music/%E6%89%8B%E6%9C%BA/playlists.json'))
  assert(!f.dav.files.has(f.dav.playlistFile))
})
