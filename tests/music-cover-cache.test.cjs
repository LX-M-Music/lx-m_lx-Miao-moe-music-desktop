const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/utils/musicCover.js'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const playerCompiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/core/music/utils.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const song = { id: 'song', source: 'wy', meta: {} }
const requestContext = require('./helpers/load-typescript.cjs')()('src/renderer/utils/requestContext.js')
const url = 'https://example.com/artwork.jpg'

test('B13: an unused queued cover never starts an API request', async() => {
  const calls = [], releases = []
  const covers = fixture(storage(), info => { calls.push(info.id); return new Promise(resolve => releases.push(() => resolve(url))) })
  const first = Array.from({ length: 5 }, (_, i) => covers.getMusicCoverUrl({ ...song, id: String(i) }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 5)
  const controller = new AbortController()
  const queued = covers.getMusicCoverUrl({ ...song, id: 'unused' }, { signal: controller.signal })
  const rejected = assert.rejects(queued, { name: 'AbortError' })
  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  await rejected
  releases.forEach(resolve => resolve())
  await Promise.all(first)
  assert(!calls.includes('unused'))
})
function storage() {
  const saved = new Map()
  const listeners = []
  let generation = 0
  return {
    saved,
    artworkCacheGeneration: () => generation,
    onArtworkCacheCleared: listener => listeners.push(listener),
    readArtworkCache: async key => saved.get(key),
    writeArtworkCache: async(key, value, version) => { if (generation === version) saved.set(key, value) },
    clear: () => { generation++; saved.clear(); listeners.forEach(listener => listener()) },
  }
}
function fixture(disk, getPic, worker) {
  const exports = {}
  const modules = {
    './requestContext': requestContext,
    '@renderer/utils/musicSdk': { default: { wy: { getPic }, local: { getPic } } },
    '@renderer/store': { userApi: { apis: {} } },
    '@renderer/utils': { toOldMusicInfo: value => value },
    '@common/utils/vueTools': { reactive: value => value },
    './artworkStorage': disk,
  }
  vm.runInNewContext(compiled, { exports, window: { lx: { worker: { main: worker } } }, require: name => { assert.ok(name in modules, name); return modules[name] } })
  return exports
}
function playerFixture(cover, getPic) {
  const exports = {}
  const modules = {
    '@renderer/utils/requestContext': requestContext,
    '@renderer/utils/musicSdk/requestCache': require('./helpers/load-typescript.cjs')()('src/renderer/utils/musicSdk/requestCache.js'),
    '@renderer/store': { qualityList: [] },
    '@renderer/store/utils': {},
    '@renderer/utils/musicSdk': { default: { wy: { getPic } } },
    '@renderer/utils/musicCover': cover,
    '@renderer/utils/ipc': {},
    '@renderer/store/setting': { appSetting: {} },
    '@renderer/utils': { toOldMusicInfo: value => value },
    '@renderer/utils/message': { requestMsg: {} },
    '@renderer/utils/musicSdk/api-source': { apis: {} },
  }
  vm.runInNewContext(playerCompiled, { exports, require: name => { assert.ok(name in modules, name); return modules[name] } })
  return exports
}

test('low-power URL eviction reloads artwork metadata from disk and normal mode restores retention', async() => {
  const disk = storage()
  let requests = 0
  const covers = fixture(disk, () => { requests++; return url })
  covers.setCoverUrlMemoryLimit(2)
  const songs = Array.from({ length: 5 }, (_, i) => ({ ...song, id: `bounded-${i}` }))
  for (const info of songs) await covers.getMusicCoverUrl(info)
  assert.equal(covers.getCachedCoverUrl(songs[0]), '')
  assert.equal(covers.getCachedCoverUrl(songs[4]), url)
  assert.equal(requests, 5)
  assert.equal(await covers.getMusicCoverUrl(songs[0]), url)
  assert.equal(requests, 5, 'eviction preserves the persistent URL cache')
  covers.setCoverUrlMemoryLimit(Infinity)
  for (const info of songs) await covers.getMusicCoverUrl(info)
  assert(songs.every(info => covers.getCachedCoverUrl(info) === url))
})

test('resolved source URLs persist and bypass the API in a new renderer', async() => {
  const disk = storage()
  let calls = 0
  const first = fixture(disk, async() => { calls++; return url })
  const results = await Promise.all([first.getMusicCoverUrl(song), first.getMusicCoverUrl(song)])
  assert.deepEqual(results, [url, url])
  assert.equal(calls, 1)
  assert.equal(disk.saved.get('source:wy__song'), url)
  assert.equal(first.getCachedCoverUrl(song), url)
  const restarted = fixture(disk, () => { calls++; throw new Error('offline') })
  assert.equal(await restarted.getMusicCoverUrl(song), url)
  assert.equal(restarted.getCachedCoverUrl(song), url)
  assert.equal(calls, 1)
})

test('failed lookups do not poison the persistent cache', async() => {
  const disk = storage()
  const offline = fixture(disk, () => { throw new Error('offline') })
  await assert.rejects(offline.getMusicCoverUrl(song), /offline/)
  assert.equal(disk.saved.size, 0)
  const restarted = fixture(disk, async() => url)
  assert.equal(await restarted.getMusicCoverUrl(song), url)
})

test('cover lookups preserve upstream and local file error codes for the visible error surface', async() => {
  const online = fixture(storage(), async() => { throw Object.assign(Error('fixture DNS failed'), { code: 'ENOTFOUND' }) })
  await assert.rejects(online.getMusicCoverUrl(song), { code: 'ENOTFOUND', message: 'fixture DNS failed' })
  const local = fixture(storage(), async() => '', {
    getMusicFilePic: async() => { throw Object.assign(Error('fixture file unreadable'), { code: 'EACCES' }) },
  })
  await assert.rejects(local.getMusicCoverUrl({ ...song, source: 'local', meta: { filePath: 'fixture.mp3' } }), { code: 'EACCES', message: 'fixture file unreadable' })
})

test('clearing artwork during an API request does not repopulate old caches', async() => {
  const disk = storage()
  let fulfill
  const cover = fixture(disk, () => new Promise(resolve => { fulfill = resolve }))
  const pending = cover.getMusicCoverUrl(song)
  await new Promise(setImmediate)
  disk.clear()
  fulfill(url)
  assert.equal(await pending, url)
  assert.equal(disk.saved.size, 0)
  assert.equal(cover.getCachedCoverUrl(song), '')
})

test('a download wrapper shares its underlying song cover cache', async() => {
  const disk = storage()
  let calls = 0
  const cover = fixture(disk, async() => { calls++; return url })
  assert.equal(await cover.getMusicCoverUrl({ id: 'download-id', metadata: { musicInfo: song } }), url)
  assert.equal(await cover.getMusicCoverUrl(song), url)
  assert.equal(cover.getCachedCoverUrl({ id: 'download-id', metadata: { musicInfo: song } }), url)
  assert.equal(calls, 1)
})

test('list and player source lookups share both in-flight and completed requests', async() => {
  let calls = 0
  let fulfill
  const getPic = () => { calls++; return new Promise(resolve => { fulfill = resolve }) }
  const cover = fixture(storage(), getPic)
  const player = playerFixture(cover, getPic)
  const options = { musicInfo: song, isRefresh: false, allowToggleSource: false, onToggleSource: () => {} }
  const row = cover.getMusicCoverUrl(song)
  const playback = player.handleGetOnlinePicUrl(options)
  await new Promise(setImmediate)
  assert.equal(calls, 1)
  fulfill(url)
  assert.equal(await row, url)
  assert.equal((await playback).url, url)
  assert.equal((await player.handleGetOnlinePicUrl({ ...options, musicInfo: { ...song, meta: {} } })).url, url)
  assert.equal(calls, 1)
})

test('an explicit player refresh can bypass the shared address cache', async() => {
  let calls = 0
  const getPic = async() => `${url}?version=${++calls}`
  const cover = fixture(storage(), getPic)
  const player = playerFixture(cover, getPic)
  await cover.getMusicCoverUrl(song)
  const result = await player.handleGetOnlinePicUrl({ musicInfo: song, isRefresh: true, allowToggleSource: false, onToggleSource: () => {} })
  assert.equal(result.url, url + '?version=2')
  assert.equal(calls, 2)
})

test('a failed list lookup can recover when playback retries in the same renderer', async() => {
  let calls = 0
  const getPic = async() => {
    if (++calls === 1) throw new Error('temporary failure')
    return url
  }
  const cover = fixture(storage(), getPic)
  const player = playerFixture(cover, getPic)
  await assert.rejects(cover.getMusicCoverUrl(song), /temporary failure/)
  const result = await player.handleGetOnlinePicUrl({ musicInfo: song, isRefresh: false, allowToggleSource: false, onToggleSource: () => {} })
  assert.equal(result.url, url)
  assert.equal(calls, 2)
})


test('untagged list covers ignore stored online URLs and prefer the local file', async() => {
  const disk = storage()
  let pic = ''
  let calls = 0
  const cover = fixture(disk, async() => { calls++; return url }, {
    getMusicFilePic: async() => pic,
    hasMusicFileTags: async() => false,
  })
  const localSong = { id: 'song.mp3', source: 'local', meta: { filePath: 'song.mp3', picUrl: url } }
  disk.saved.set('source:local__song.mp3', url)
  assert.equal(cover.getCachedCoverUrl(localSong), '')
  assert.equal(await cover.getMusicCoverUrl(localSong), '')
  pic = 'data:image/png;base64,bG9jYWw='
  assert.equal(await cover.getMusicCoverUrl(localSong), pic)
  assert.equal(calls, 0)
})

test('removing file tags stops reusing online cover caches without reimporting', async() => {
  const disk = storage()
  let hasTags = true
  let calls = 0
  const cover = fixture(disk, async() => { calls++; return url }, {
    getMusicFilePic: async() => '',
    hasMusicFileTags: async() => hasTags,
  })
  const localSong = { id: 'song.mp3', source: 'local', meta: { filePath: 'song.mp3' } }
  assert.equal(await cover.getMusicCoverUrl(localSong), url)
  assert.equal(disk.saved.get('source:local__song.mp3'), url)
  hasTags = false
  assert.equal(cover.getCachedCoverUrl(localSong), '')
  assert.equal(await cover.getMusicCoverUrl(localSong), '')
  assert.equal(calls, 1)
})
