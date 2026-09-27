const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')
const load = require('./helpers/load-typescript.cjs')()

const { createKeyedDebouncedWrite } = load('src/renderer/utils/keyedDebouncedWrite.ts')
const { normalizeTimeoutMinutes } = load('src/renderer/utils/timeoutInput.ts')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const waitFor = async condition => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return
    await wait(10)
  }
  assert.fail('timed out waiting for the lyric write')
}

test('lyric writes for different songs keep separate debounce timers', async() => {
  const persist = createKeyedDebouncedWrite(10)
  const written = []
  const first = persist('song-a', async() => { written.push('song-a') })
  const second = persist('song-b', async() => { written.push('song-b') })
  assert.equal(await first, true)
  assert.equal(await second, true)
  assert.deepEqual(written.sort(), ['song-a', 'song-b'])
})

test('a later save or reset only replaces the pending operation for the same song', async() => {
  const persist = createKeyedDebouncedWrite(10)
  const written = []
  const first = persist('song-a', async() => { written.push('stale save') })
  const other = persist('song-b', async() => { written.push('other song') })
  const reset = persist('song-a', async() => { written.push('reset') })
  assert.equal(await first, false)
  assert.equal(await reset, true)
  assert.equal(await other, true)
  assert.deepEqual(written.sort(), ['other song', 'reset'])
})

test('an in-flight failure is reported and does not overtake the following write', async() => {
  const persist = createKeyedDebouncedWrite(5)
  const started = []
  let rejectFirst
  const first = persist('song-a', async() => {
    started.push('first')
    await new Promise((resolve, reject) => { rejectFirst = reject })
  })
  await wait(20)
  const second = persist('song-a', async() => { started.push('second') })
  await wait(20)
  assert.deepEqual(started, ['first'])
  rejectFirst(new Error('disk full'))
  await assert.rejects(first, /disk full/)
  assert.equal(await second, true)
  assert.deepEqual(started, ['first', 'second'])
})

test('timeout minutes use the whole input and clamp an oversized integer in one pass', () => {
  assert.equal(normalizeTimeoutMinutes('1440'), 1440)
  assert.equal(normalizeTimeoutMinutes('1441'), 1440)
  assert.equal(normalizeTimeoutMinutes(' 0008 '), 8)
  for (const value of ['', '0', '-1', '12abc', '12 minutes', '1.5', '1e2', '∞']) {
    assert.equal(normalizeTimeoutMinutes(value), null, value)
  }
})

test('the timeout modal starts after one confirmation and rejects trailing characters', () => {
  const script = fs.readFileSync('src/renderer/views/Setting/components/PlayTimeoutModal.vue', 'utf8').split('<script>')[1].split('</script>')[0]
  const compiled = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const module = { exports: {} }
  const started = [], emitted = [], saved = []
  const imports = {
    '@renderer/core/player/timeoutStop': { useTimeout: () => ({ timeLabel: { value: '' } }), startTimeoutStop: seconds => { started.push(seconds) }, stopTimeoutStop: () => {} },
    '@common/utils/vueTools': { ref: value => ({ value }) },
    '@renderer/store/setting': { appSetting: { 'player.waitPlayEndStopTime': '30' }, updateSetting: async values => { saved.push(values) } },
    '@renderer/utils/timeoutInput': { normalizeTimeoutMinutes },
  }
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: name => { assert(name in imports, name); return imports[name] },
    window: { i18n: { t: key => key } },
  })
  const modal = module.exports.default.setup({}, { emit: (...args) => { emitted.push(args) } })
  modal.time.value = '1441'
  modal.handleConfirm()
  assert.deepEqual(started, [1440 * 60])
  assert.equal(saved.length, 1)
  assert.equal(saved[0]['player.waitPlayEndStopTime'], '1440')
  assert.equal(emitted.length, 1)
  modal.time.value = '12abc'
  modal.handleConfirm()
  assert.deepEqual(started, [1440 * 60])
  assert.equal(modal.validationError.value, 'play_timeout_invalid')
})

function makeLyricMenu(saveLyricEdited, removeLyricEdited = async() => {}) {
  const script = fs.readFileSync('src/renderer/components/layout/PlayDetail/components/LyricMenu.vue', 'utf8').split('<script>')[1].split('</script>')[0]
  const compiled = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const module = { exports: {} }
  const current = { musicInfo: { id: 'song-a' } }
  const dialogs = []
  const imports = {
    '@common/utils/vueTools': {
      computed: getter => ({ get value() { return getter() } }),
      onBeforeUnmount: () => {},
      ref: value => ({ value }),
      watch: () => {},
    },
    '@renderer/utils/compositions/useMenuLocation': () => ({ dom_menu: {}, menuStyles: {} }),
    '@renderer/utils/keyedDebouncedWrite': { createKeyedDebouncedWrite },
    '@renderer/utils/ipc': { saveLyricEdited, removeLyricEdited },
    '@renderer/store/setting': { appSetting: {}, setPlayDetailLyricFont: () => {}, setPlayDetailLyricAlign: () => {}, updateSetting: async() => {} },
    '@renderer/store/player/state': { playMusicInfo: current },
    '@renderer/store/player/action': { setMusicInfo: () => {} },
    '@renderer/core/lyric': { setLyricOffset: () => {} },
    '@common/utils/errorMessage': { formatError: error => error.message },
    '@renderer/plugins/Dialog': { dialog: { error: async options => { dialogs.push(options.message) } } },
  }
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: name => { assert(name in imports, name); return imports[name] },
    window: { i18n: { t: key => key } },
    console,
    setTimeout,
    clearTimeout,
  })
  const create = (id, lyric = '[00:00.00]line') => {
    const lyricInfo = { lyric, tlyric: '', rlyric: '', lxlyric: '', rawlyric: '[00:00.00]line', musicInfo: { id } }
    const emitted = []
    const menu = module.exports.default.setup({ lyricInfo, modelValue: true, xy: {} }, { emit: (...args) => emitted.push(args) })
    return { menu, emitted, lyricInfo }
  }
  return { create, current, dialogs }
}

test('rapid lyric offset changes for two songs both reach storage', async() => {
  const written = []
  const { create } = makeLyricMenu(async(song, lyrics) => { written.push([song.id, lyrics.lyric]) })
  create('song-a').menu.setOffset(10)
  create('song-b').menu.setOffset(100)
  await waitFor(() => written.length === 2)
  assert.deepEqual(written.map(([id]) => id).sort(), ['song-a', 'song-b'])
})

test('failed lyric offset write rolls back the displayed value and reports the error', async() => {
  const { create, dialogs } = makeLyricMenu(async() => { throw new Error('disk full') })
  const { menu, emitted } = create('song-a')
  menu.setOffset(10)
  assert.equal(menu.offset.value, 10)
  await waitFor(() => dialogs.length === 1)
  assert.equal(menu.offset.value, 0)
  assert.deepEqual(dialogs, ['disk full'])
  assert.equal(emitted.at(-1)[1].offset, 0)
})

test('resetting an offset replaces a pending save for that song', async() => {
  const saved = [], removed = []
  const { create } = makeLyricMenu(async(song) => { saved.push(song.id) }, async(song) => { removed.push(song.id) })
  const { menu } = create('song-a')
  menu.setOffset(10)
  menu.offsetReset()
  await waitFor(() => removed.length === 1)
  assert.deepEqual(saved, [])
  assert.deepEqual(removed, ['song-a'])
})

test('failed lyric offset reset restores the last confirmed value', async() => {
  const { create, dialogs } = makeLyricMenu(async() => {}, async() => { throw new Error('read-only database') })
  const { menu } = create('song-a', '[offset:10]\n[00:00.00]line')
  menu.offset.value = 10
  menu.offsetReset()
  await waitFor(() => dialogs.length === 1)
  assert.equal(menu.offset.value, 10)
  assert.deepEqual(dialogs, ['read-only database'])
})
