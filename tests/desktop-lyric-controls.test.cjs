const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const vue = require('vue')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')
const load = () => loader({ 'electron-log/node': {}, path: require('node:path'), os: require('node:os'), crypto: require('node:crypto') })

test('native single-line mode defaults off and persists independently of retired mini lyric preferences', () => {
  const defaults = load()('src/common/defaultSetting.ts').default
  const migrate = load()('src/common/utils/migrateSetting.ts').default
  const { buildLyricConfig } = load()('src/main/modules/winLyric/utils.ts')
  assert.equal(defaults['desktopLyric.isSingleLine'], false)
  const saved = { version: defaults.version, 'desktopLyric.isSingleLine': true, 'desktopLyric.singleLine': true }
  const migrated = migrate(saved)
  assert.equal(migrated['desktopLyric.isSingleLine'], true)
  assert(!Object.hasOwn(migrated, 'desktopLyric.singleLine'))
  assert.equal(buildLyricConfig(migrated)['desktopLyric.isSingleLine'], true)
  assert(!Object.hasOwn(defaults, 'miniPlayer.isSingleLine'))
})

test('toolbar availability follows incoming lyrics and unavailable translations cannot change preferences', () => {
  const { lyric, lyrics } = loader({ '@common/utils/vueTools': vue })('src/renderer-lyric/store/lyric.ts')
  const setting = vue.shallowReactive({ 'player.isShowLyricTranslation': false, 'player.isShowLyricRoma': false, 'desktopLyric.isSingleLine': false })
  const writes = []
  const script = fs.readFileSync('src/renderer-lyric/components/layout/ControlBar.vue', 'utf8').split('<script>')[1].split('</script>')[0]
  const compiled = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const module = { exports: {} }
  const imports = {
    '@common/utils/vueTools': vue, '@lyric/store/state': { setting }, '@lyric/store/lyric': { lyric, lyrics },
    '@lyric/store/action': { updateSetting: values => { writes.push(values); Object.assign(setting, values) } },
    './useDrag': () => ({ handleLyricPointerDown() {} }),
  }
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => { assert(name in imports, name); return imports[name] } })
  const controls = module.exports.default.setup()
  for (const key of ['player.isShowLyricTranslation', 'player.isShowLyricRoma']) controls.toggleExtendedLyric(key)
  assert.equal(writes.length, 0)
  lyric.lines = [{ time: 0, text: 'line', extendedLyrics: [] }]
  lyrics.tlyric = '[00:00]translation'
  assert.equal(controls.hasTranslation.value, true)
  assert.equal(controls.hasRomanization.value, false)
  controls.toggleExtendedLyric('player.isShowLyricTranslation')
  assert.equal(setting['player.isShowLyricTranslation'], true)
  lyrics.rlyric = '[00:00]romanization'
  assert.equal(controls.hasRomanization.value, true)
  controls.toggleExtendedLyric('player.isShowLyricRoma')
  assert.equal(setting['player.isShowLyricRoma'], true)
  lyrics.tlyric = lyrics.rlyric = ''
  assert.equal(controls.hasTranslation.value, false)
  assert.equal(controls.hasRomanization.value, false)
  controls.toggleExtendedLyric('player.isShowLyricTranslation')
  assert.equal(writes.length, 2, 'switching to unsupported lyrics preserves the saved preference')
  controls.handleSingleLine()
  assert.equal(setting['desktopLyric.isSingleLine'], true)
  lyric.lines = []
  lyrics.tlyric = '[00:00]stale data'
  assert.equal(controls.hasTranslation.value, false, 'stopped lyrics do not enable stale translation data')
})

test('only the desktop lyric renderer can change the two shared extended-lyric toggles', () => {
  const policy = load()('src/main/utils/ipcPolicy.ts')
  for (const role of ['lyric', 'mini']) {
    const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, mainFrame: { url: 'file:///app/lyric.html' } })
    policy.registerIpcWindow(sender, role, sender.mainFrame.url)
    const event = { sender, senderFrame: sender.mainFrame }
    const channel = role === 'lyric' ? 'winLyric_set_config' : 'winMiniPlayer_set_config'
    for (const key of ['player.isShowLyricTranslation', 'player.isShowLyricRoma']) {
      if (role === 'lyric') policy.assertIpcRequest(event, channel, { [key]: true })
      else assert.throws(() => policy.assertIpcRequest(event, channel, { [key]: true }), { code: 'IPC_ARGUMENT_INVALID' })
      assert.throws(() => policy.assertIpcRequest(event, channel, { [key]: 'yes' }), { code: 'IPC_ARGUMENT_INVALID' })
    }
    for (const key of ['player.volume', 'player.isPlayLxlrc', 'player.isSwapLyricTranslationAndRoma', 'cookie.wy']) {
      assert.throws(() => policy.assertIpcRequest(event, channel, { [key]: true }), { code: 'IPC_ARGUMENT_INVALID' })
    }
  }
})
