const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')
const load = require('./helpers/load-typescript.cjs')()
const candidates = load('src/renderer/utils/musicToggleCandidates.ts')
const { original, match, unrelated, results, song } = require('./fixtures/music-toggle.cjs')
const { musicMatchScore, rankMusicToggleCandidates } = candidates

test('the captured Japanese song selects Kugou instead of unrelated Kuwo results or the original source', () => {
  const actual = rankMusicToggleCandidates(original, results, true)
  assert.deepEqual(actual.map(item => item.source), ['kg'])
  assert.deepEqual(actual[0].list.map(song => song.id), [match.id])
})

test('turning off the filter retains other results but still ranks matches first and removes duplicates', () => {
  const actual = rankMusicToggleCandidates(original, [results[0], { source: 'kg', list: [unrelated, match, match] }, results[2]], false)
  assert.equal(actual[0].source, 'kg')
  assert.deepEqual(actual[0].list.map(song => song.id), [match.id, unrelated.id])
  assert(!actual.flatMap(item => item.list).some(song => song.id === original.id))
  assert.equal(actual.length, 3)
})

test('same singer, same duration or a shared feature artist cannot make a different song match', () => {
  assert.equal(musicMatchScore(original, unrelated), 0)
  assert.equal(musicMatchScore(original, { ...match, name: 'Another song' }), 0)
  assert.equal(musicMatchScore(original, { ...match, singer: 'Cover artist' }), 0)
  assert.equal(musicMatchScore(original, { ...match, interval: '03:06' }), 0)
  assert.equal(musicMatchScore(original, { ...match, name: original.name + ' (Live)' }), 0)
})

test('normalization allows punctuation, fullwidth characters and featured singers without losing version labels', () => {
  const target = song('one', 'wy', 'Ａ Song!', 'Artist A、Artist B', '03:20')
  assert(musicMatchScore(target, song('two', 'kg', 'a song (feat. Artist B)', 'Artist A', '03:24')) > 0)
  assert(musicMatchScore(target, song('three', 'tx', 'A SONG', 'Artist B & Artist A', '03:20')) > 0)
  assert.equal(musicMatchScore(target, song('four', 'kg', 'A song (Instrumental)', 'Artist A', '03:20')), 0)
})

test('missing metadata does not throw or make unrelated unknown songs match', () => {
  assert.equal(musicMatchScore({ id: 'one' }, { id: 'two' }), 0)
  assert.equal(musicMatchScore({ id: 'one', name: 'Same title' }, { id: 'two', name: 'Same title' }), 0)
  assert(musicMatchScore(original, { ...match, interval: null }) > 0)
  assert.equal(musicMatchScore(original, { ...unrelated, singer: null, interval: '00:00' }), 0)
})

const script = fs.readFileSync('src/renderer/views/List/MusicList/components/MusicToggleModal.vue', 'utf8').split('<script>')[1].split('</script>')[0]
const compiled = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
const sources = ['kw', 'kg', 'tx', 'wy', 'mg']
const searchResults = async source => results.find(result => result.source === source) ?? { source, list: [] }
function modalFixture(searchSource = searchResults, current = original) {
  const module = { exports: {} }, played = [], emitted = [], queue = [original]
  const state = { musicInfo: current }
  const imports = {
    '@common/utils/errorMessage': load('src/common/utils/errorMessage.ts'),
    '@common/constants': { LIST_IDS: { PLAY_LATER: 'play_later' } },
    '@common/utils/electron': { openUrl: async() => {} },
    '@renderer/core/player': { playNext: () => { throw Error('preview must not use next-track selection') }, playQueueById: index => played.push(queue[index].id) },
    '@renderer/store': { getSourceI18nPrefix: () => '' },
    '@renderer/store/player/action': { addTempPlayList: items => { queue.push(...items.map(item => item.musicInfo)); const index = queue.length - items.length; if (!state.musicInfo) played.push(queue[index].id); return index } },
    '@renderer/store/player/state': { playMusicInfo: state },
    '@renderer/store/setting': { appSetting: { 'common.showErrorDialog': false } },
    '@renderer/utils': { toNewMusicInfo: song => song, toOldMusicInfo: song => song },
    '@renderer/utils/musicSdk': Object.fromEntries(sources.map(source => [source, { musicSearch: { search: (...args) => searchSource(source, ...args) } }])),
    '@renderer/utils/musicToggleCandidates': candidates,
    vue: { markRaw: value => value },
  }
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => { assert(name in imports, name); return imports[name] }, window: { i18n: { t: key => key } } })
  const options = module.exports.default
  const modal = { ...options.data(), musicInfo: original, preferredSource: '', show: true, $nextTick: async() => {}, $emit: (...args) => emitted.push(args), $t: key => key }
  for (const [key, method] of Object.entries(options.methods)) modal[key] = method.bind(modal)
  for (const [key, get] of Object.entries(options.computed)) Object.defineProperty(modal, key, { get: get.bind(modal) })
  return { modal, played, emitted, options }
}
const flush = async() => new Promise(resolve => setImmediate(resolve))

test('loading defaults to the song platform and retains all tabs while previewing the clicked candidate directly', async() => {
  const { modal, played } = modalFixture()
  await modal.loadList()
  assert.equal(modal.source, 'wy')
  assert.deepEqual(Array.from(modal.tabs, tab => tab.id), sources)
  assert.equal(modal.list.length, 0)
  assert.equal(modal.noItemLabel, 'music_toggle_no_match')
  modal.source = 'kg'
  modal.handlePlay(match)
  assert.deepEqual(played, [match.id])
  assert.equal(modal.toggleMusicInfo.id, match.id)
})

test('the first preview starts exactly once when playback was idle', async() => {
  const { modal, played } = modalFixture(searchResults, null)
  await modal.loadList()
  modal.source = 'kg'
  modal.handlePlay(match)
  assert.deepEqual(played, [match.id])
})

test('confirmation rejects a selection from a different tab or a closed dialog', async() => {
  const { modal, emitted } = modalFixture()
  await modal.loadList()
  modal.source = 'kg'
  modal.handlePlay(match)
  modal.source = 'kw'
  modal.handleConfirm()
  assert.equal(emitted.length, 0)
  modal.source = 'kg'
  modal.show = false
  modal.handleConfirm()
  assert.equal(emitted.length, 0)
})

test('the playlist platform is rendered before the other four requests and later results preserve manual selection', async() => {
  const pending = new Map(), calls = []
  const { modal } = modalFixture(source => {
    calls.push(source)
    return new Promise(resolve => pending.set(source, list => resolve({ source, list })))
  })
  modal.preferredSource = 'kg'
  modal.$nextTick = async() => {
    assert.deepEqual(modal.list.map(item => item.id), [match.id])
    assert.equal(modal.loading, false)
    assert.deepEqual(calls, ['kg'])
  }
  const loading = modal.loadList()
  assert.equal(modal.source, 'kg')
  assert.equal(modal.loading, true)
  assert.deepEqual(calls, ['kg'])
  assert.equal(modal.tabs.length, 5)
  pending.get('kg')([match])
  await flush()
  assert.deepEqual(calls, ['kg', 'kw', 'tx', 'wy', 'mg'])
  assert.equal(modal.loading, false, 'Other pending platforms must not keep the preferred platform loading')
  modal.source = 'mg'
  assert.equal(modal.loading, true)
  for (const source of sources.filter(source => source !== 'kg')) pending.get(source)([])
  await loading
  assert.equal(modal.source, 'mg')
  assert.equal(modal.loading, false)
  assert.equal(modal.noItemLabel, 'music_toggle_no_match')
})

test('empty, filtered and failed searches always retain five tabs and retry only the failed platform', async() => {
  let fail = true
  const calls = []
  const { modal, options } = modalFixture(async source => {
    calls.push(source)
    if (source === 'wy' && fail) throw Error('provider unavailable')
    return { source, list: source === 'kg' ? [unrelated] : [] }
  })
  await modal.loadList()
  assert.equal(modal.source, 'wy')
  assert.equal(modal.isError, true)
  assert.equal(calls.length, 5, 'A failed preferred request must still start the other platforms')
  for (const source of sources) {
    modal.source = source
    assert.equal(modal.list.length, 0)
    assert.equal(modal.noItemLabel, 'music_toggle_no_match')
    assert.deepEqual(Array.from(modal.tabs, tab => tab.id), sources)
  }
  modal.onlyMatches = false
  options.watch.onlyMatches.call(modal)
  assert.equal(modal.source, 'mg')
  assert.equal(modal.noItemLabel, 'music_toggle_no_match')
  assert.equal(modal.tabs.length, 5)
  modal.source = 'wy'
  fail = false
  modal.retrySource()
  await flush()
  assert.deepEqual(calls, ['wy', 'kw', 'kg', 'tx', 'mg', 'wy'])
  assert.equal(modal.isError, false)
  assert.equal(modal.noItemLabel, 'music_toggle_no_match')
})

test('supported playlist platforms take precedence and unbound or unsupported playlists fall back to the song source', () => {
  const { modal } = modalFixture()
  for (const source of sources) {
    modal.preferredSource = source
    assert.equal(modal.defaultSource, source)
  }
  modal.preferredSource = 'unknown'
  assert.equal(modal.defaultSource, 'wy')
  modal.musicInfo = { ...original, source: 'local' }
  assert.equal(modal.defaultSource, 'kw')
})

test('late results cannot reopen a closed search, start its remaining requests or replace a newer song search', async() => {
  const pending = []
  const { modal } = modalFixture(source => new Promise(resolve => { pending.push({ source, finish: list => resolve({ source, list }) }) }))
  const closed = modal.loadList()
  modal.handleClose()
  pending[0].finish([original])
  await closed
  assert.equal(modal.rankedLists.length, 0)
  assert.equal(modal.loading, false)
  assert.equal(pending.length, 1)

  const previous = modal.loadList()
  modal.musicInfo = unrelated
  const latest = modal.loadList()
  pending[2].finish([{ ...unrelated, id: 'kg_alternative' }])
  await flush()
  for (const request of pending.slice(3)) request.finish([])
  await latest
  pending[1].finish([original])
  await previous
  assert.equal(modal.source, 'kg')
  assert.equal(modal.list[0].id, 'kg_alternative')
  assert.equal(pending.length, 7)
})

function replacementFixture(initial, fail = false) {
  const cache = new Map([['list', initial]])
  const calls = []
  const load = require('./helpers/load-typescript.cjs')({
    '../recycleBin': { deleteWithUndo: task => task() },
    '@common/utils/vueTools': { toRaw: require('vue').toRaw },
    '@common/rendererIpc': {
      rendererInvoke: async(channel, data) => {
        calls.push(channel)
        assert.equal(channel, 'overwrite')
        // Electron must be able to clone the payload before the database sees it.
        const copied = structuredClone(data)
        if (fail) throw Error('disk failure')
        cache.set(data.listId, copied.musicInfos)
      },
    },
    '@common/ipcNames': { PLAYER_EVENT_NAME: { list_music_overwrite: 'overwrite' } },
    './state': { allMusicList: cache, userLists: [] },
    './action': {},
  })
  const { replaceListMusic } = load('src/renderer/store/list/listManage/rendererListManage.ts')
  return { cache, calls, replace: (target, allowDuplicate) => replaceListMusic('list', original.id, target, allowDuplicate) }
}

test('replacement unwraps a selected reactive song and commits once at the current original position', async() => {
  const { cache, calls, replace } = replacementFixture([unrelated, original])
  assert.equal(await replace(require('vue').reactive({ ...match })), 'replaced')
  assert.deepEqual(cache.get('list').map(song => song.id), [unrelated.id, match.id])
  assert.deepEqual(calls, ['overwrite'])
})

test('a failed replacement preserves the original song and its position', async() => {
  const initial = [unrelated, original]
  const { cache, replace } = replacementFixture(initial, true)
  await assert.rejects(replace(match), /disk failure/)
  assert.deepEqual(cache.get('list'), initial)
})

test('duplicates require confirmation and preserve the original relative position when merged', async() => {
  const { cache, calls, replace } = replacementFixture([match, unrelated, original])
  assert.equal(await replace(match), 'duplicate')
  assert.deepEqual(calls, [])
  assert.equal(await replace(match, true), 'replaced')
  assert.deepEqual(cache.get('list').map(song => song.id), [unrelated.id, match.id])
})

test('removing the original while the dialog is open cannot insert a replacement into the list', async() => {
  const { calls, replace } = replacementFixture([unrelated])
  assert.equal(await replace(match), 'missing')
  assert.deepEqual(calls, [])
})
