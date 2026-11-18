const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')
const log = { error() {} }
const load = overrides => loader({ 'electron-log/node': log, '@common/utils': { log }, ...overrides })
const schema = load()('src/common/backup.ts')
const io = load()('src/common/utils/nodejs.ts')

const song = (id, extra = {}) => ({
  id, name: 'Song ' + id, singer: 'Singer', source: 'wy', interval: '03:10',
  meta: { songId: id, albumName: 'Album', qualitys: [], _qualitys: {} },
  ...extra,
})
const musicfreeSong = {
  id: 'mf_one', name: 'MusicFree Song', singer: 'MF Singer', source: 'musicfree_0123456789abcdef01234567', interval: '02:00',
  meta: { songId: 'mf_one', albumName: 'MF Album', qualitys: [], _qualitys: {}, musicfree: { id: 'mf_one' } },
}
const source = () => ({
  playlists: [
    { id: 'default', name: 'Default', list: [song('a'), song('a'), song('b'), { id: '', name: 'No id' }, { id: 'no_name', name: '' }], locationUpdateTime: null },
    { id: 'love', name: 'Favorites', list: [], locationUpdateTime: null },
    { id: 'temp', name: 'Temporary', list: [song('temp_song')], locationUpdateTime: null },
    {
      id: 'saved-list', name: 'Saved', source: 'wy', sourceListId: 'list_1', locationUpdateTime: 1234,
      list: [song('c', { singer: null }), musicfreeSong, {
        id: 'flac_song', name: 'FLAC Song', singer: 'Singer', source: 'wy', interval: '04:00',
        meta: { songId: 'flac_song', albumName: 'Album', qualitys: [{ type: 'flac32bit', size: '10M' }], _qualitys: { flac32bit: { size: '10M' } } },
      }, {
        id: 'local_song', name: 'Local Song', singer: '', source: 'local', interval: '01:00',
        meta: { songId: '/music/a.mp3', albumName: '', filePath: '/music/a.mp3', ext: 'mp3' },
      }],
    },
  ],
  settings: {
    version: '2.3.0',
    'player.volume': 0.5,
    'common.langId': 'zh-cn',
    'sync.webdav.enable': true,
    'sync.webdav.url': 'https://dav.example/private',
    'sync.webdav.username': 'alice',
    'sync.webdav.password': 'secret',
    'cookie.wy': 'cookie-value',
    'future.unknown': 42,
  },
})
const fixture = async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-backup-compat-'))
  t.after(async() => { assert(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'lx-backup-compat-'))); await fs.rm(directory, { recursive: true, force: true }) })
  return directory
}

test('compat playlists use playList_v2, skip the temporary list and normalize songs like the original client', () => {
  const input = source()
  const result = schema.buildCompatExport('compat_playlists', input)
  assert.equal(result.type, 'playList_v2')
  assert.deepEqual(result.data.map(list => list.id), ['default', 'love', 'saved-list'])
  assert.deepEqual(Object.keys(result), ['type', 'data'])

  const defaultList = result.data.find(list => list.id === 'default')
  assert.deepEqual(defaultList.list.map(music => music.id), ['a', 'b'])
  assert.equal(defaultList.locationUpdateTime, null)
  assert.equal(Object.hasOwn(defaultList, 'source'), false)
  assert.equal(Object.hasOwn(defaultList, 'sourceListId'), false)

  const saved = result.data.find(list => list.id === 'saved-list')
  assert.equal(saved.source, 'wy')
  assert.equal(saved.sourceListId, 'list_1')
  assert.equal(saved.locationUpdateTime, 1234)
  assert.equal(saved.list.find(music => music.id === 'c').singer, '')
  assert.equal(saved.list.some(music => music.id === 'mf_one'), false)
  assert.deepEqual(saved.list.map(music => music.id), ['c', 'flac_song', 'local_song'])
  assert.equal(saved.list.find(music => music.id === 'local_song').source, 'local')
  // fixNewMusicInfoQuality normalizes the exported copy only.
  assert.equal(saved.list.find(music => music.id === 'flac_song').meta.qualitys[0].type, 'flac24bit')
  assert.equal(saved.list.find(music => music.id === 'flac_song').meta._qualitys.flac24bit.size, '10M')
  assert.equal(Object.hasOwn(saved.list.find(music => music.id === 'flac_song').meta._qualitys, 'flac32bit'), false)

  // The cached database objects must stay untouched.
  const original = input.playlists.find(list => list.id === 'saved-list').list
  assert.equal(original.find(music => music.id === 'c').singer, null)
  assert.equal(original.find(music => music.id === 'flac_song').meta.qualitys[0].type, 'flac32bit')
  assert.equal(original.find(music => music.id === 'flac_song').meta._qualitys.flac32bit.size, '10M')
})

const compatSongs = (...songs) => schema.buildCompatExport('compat_playlists', {
  playlists: [{ id: 'saved-list', name: 'Saved', list: songs, locationUpdateTime: null }],
  settings: {},
}).data[0].list

test('compat playlists tolerate a non-local song without quality containers', () => {
  const input = {
    id: 'missing_qualitys', name: 'Missing Qualitys', singer: 'Singer', source: 'wy', interval: '03:00',
    meta: { songId: 'missing_qualitys', albumName: 'Album' },
  }
  const exported = compatSongs(input)
  assert.deepEqual(exported[0].meta.qualitys, [])
  assert.deepEqual(exported[0].meta._qualitys, {})
  assert.equal(Object.hasOwn(input.meta, 'qualitys'), false)
  assert.equal(Object.hasOwn(input.meta, '_qualitys'), false)
})

test('compat playlists normalize a non-array qualitys instead of crashing', () => {
  const input = {
    id: 'bad_qualitys', name: 'Bad Qualitys', singer: 'Singer', source: 'wy', interval: '03:00',
    meta: { songId: 'bad_qualitys', albumName: 'Album', qualitys: { type: 'flac32bit' }, _qualitys: { flac32bit: { size: '10M' } } },
  }
  const exported = compatSongs(input)
  assert.deepEqual(exported[0].meta.qualitys, [])
  assert.equal(exported[0].meta._qualitys.flac24bit.size, '10M')
  assert.equal(Object.hasOwn(exported[0].meta._qualitys, 'flac32bit'), false)
  assert.equal(Array.isArray(input.meta.qualitys), false)
  assert.equal(input.meta._qualitys.flac32bit.size, '10M')
})

test('compat playlists leave local songs untouched', () => {
  const input = {
    id: 'local_1', name: 'Local', singer: '', source: 'local', interval: '01:00',
    meta: { songId: '/a.mp3', albumName: '', filePath: '/a.mp3', ext: 'mp3' },
  }
  const exported = compatSongs(input)
  assert.deepEqual(exported[0].meta, input.meta)
  assert.equal(Object.hasOwn(exported[0].meta, 'qualitys'), false)
  assert.equal(Object.hasOwn(exported[0].meta, '_qualitys'), false)
  assert.equal(input.meta.filePath, '/a.mp3')
})

test('compat playlists keep an empty playlist after extension source songs are filtered', () => {
  const result = schema.buildCompatExport('compat_playlists', {
    playlists: [{ id: 'mf-only', name: 'MF Only', source: 'wy', sourceListId: 'list_mf', locationUpdateTime: 99, list: [musicfreeSong] }],
    settings: {},
  })
  assert.deepEqual(result.data.map(list => list.id), ['mf-only'])
  const list = result.data[0]
  assert.equal(list.name, 'MF Only')
  assert.equal(list.locationUpdateTime, 99)
  assert.deepEqual(list.list, [])
})

test('compat playlists do not validate settings data', () => {
  const invalid = {
    playlists: [{ id: 'default', name: 'Default', list: [], locationUpdateTime: null }],
    settings: { 'player.volume': 'loud' },
  }
  assert.equal(schema.buildCompatExport('compat_playlists', invalid).type, 'playList_v2')
  assert.throws(() => schema.buildCompatExport('compat_settings', invalid), /backup:invalid/)
  assert.throws(() => schema.buildCompatExport('compat_all', invalid), /backup:invalid/)
})

test('compat settings use setting_v2, keep primitive known keys and strip credentials and unknown keys', () => {
  const result = schema.buildCompatExport('compat_settings', source())
  assert.equal(result.type, 'setting_v2')
  assert.equal(result.data['player.volume'], 0.5)
  assert.equal(result.data['sync.webdav.enable'], true)
  assert.equal(result.data.version, '2.3.0')
  for (const key of ['cookie.wy', 'sync.webdav.url', 'sync.webdav.username', 'sync.webdav.password', 'future.unknown']) {
    assert.equal(Object.hasOwn(result.data, key), false, key + ' must not be exported')
  }
  assert(result.data.constructor === Object)
  for (const value of Object.values(result.data)) assert.equal(value === null || ['string', 'boolean', 'number'].includes(typeof value), true)
  assert.deepEqual(Object.keys(result).sort(), ['data', 'type'])
})

test('compat all data use allData_v2 with setting and playList only', () => {
  const result = schema.buildCompatExport('compat_all', source())
  assert.equal(result.type, 'allData_v2')
  assert.deepEqual(Object.keys(result).sort(), ['playList', 'setting', 'type'])
  assert.equal(Object.hasOwn(result, 'data'), false)
  assert.equal(Object.hasOwn(result, 'version'), false)
  assert(Array.isArray(result.playList))
  assert.deepEqual(result.playList.map(list => list.id), ['default', 'love', 'saved-list'])
  assert.deepEqual(result.playList.find(list => list.id === 'saved-list').list.map(music => music.id), ['c', 'flac_song', 'local_song'])
  assert.equal(result.setting['player.volume'], 0.5)
  assert.equal(Object.hasOwn(result.setting, 'cookie.wy'), false)
})

test('compat files round-trip through the same gzip writer and reader as the original client', async t => {
  const root = await fixture(t)
  const input = source()
  const expected = {
    compat_playlists: { type: 'playList_v2', data: schema.buildCompatExport('compat_playlists', input).data },
    compat_settings: { type: 'setting_v2', data: schema.buildCompatExport('compat_settings', input).data },
    compat_all: schema.buildCompatExport('compat_all', input),
  }
  for (const [kind, value] of Object.entries(expected)) {
    const filename = path.join(root, kind)
    const target = await io.saveLxConfigFile(filename, value)
    assert.equal(target, filename + '.lxmc')
    const bytes = await fs.readFile(target)
    // The original readLxConfigFile relies on gzip, not on JSON text files.
    assert.equal(bytes[0], 0x1f)
    assert.equal(bytes[1], 0x8b)
    const parsed = await io.readLxConfigFile(target)
    assert.deepEqual(parsed, value)
    // The same structure must also pass this fork's v2 import path.
    const normalized = schema.normalizeBackup(parsed)
    if (kind === 'compat_settings') {
      assert.equal(normalized.settings['player.volume'], 0.5)
      assert.equal(Object.hasOwn(normalized.settings, 'cookie.wy'), false)
    } else {
      assert.deepEqual(normalized.playlists.map(list => list.id), ['default', 'love', 'saved-list'])
      assert.deepEqual(normalized.playlists.find(list => list.id === 'default').list.map(music => music.id), ['a', 'b'])
    }
  }
})
