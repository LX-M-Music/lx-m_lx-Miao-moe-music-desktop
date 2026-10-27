const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')
const load = () => loader({ 'electron-log/node': {}, 'node:url': require('node:url'), 'node:path': require('node:path'), 'node:os': require('node:os') })
const defaults = load()('src/common/defaultSetting.ts').default
const migrate = load()('src/common/utils/migrateSetting.ts').default

test('legacy combined mini preferences migrate once into independent windows, without retired lyric modes', () => {
  const old = { version: '2.2.0', 'desktopLyric.enable': true, 'desktopLyric.showPlayer': false, 'desktopLyric.singleLine': true, 'desktopLyric.showBorder': true, 'desktopLyric.autoHideControls': true, 'desktopLyric.style.backgroundOpacity': 38, 'desktopLyric.isLock': true, 'desktopLyric.x': 180, 'desktopLyric.y': 240, 'desktopLyric.width': 510, 'desktopLyric.height': 340, 'desktopLyric.style.fontSize': 36, 'player.volume': 0.42 }
  const migrated = migrate(old)
  assert.equal(migrated.version, defaults.version)
  for (const [key, value] of Object.entries({ enable: true, showBorder: true, autoHideControls: true, backgroundOpacity: 38, isLock: true, x: 180, y: 240, width: 510, height: 340 })) assert.equal(migrated['miniPlayer.' + key], value, key)
  assert.equal(migrated['desktopLyric.enable'], false)
  assert.equal(migrated['desktopLyric.x'], null)
  assert.equal(migrated['desktopLyric.y'], null)
  assert.equal(migrated['desktopLyric.width'], 450)
  assert.equal(migrated['desktopLyric.height'], 300)
  assert.equal(migrated['desktopLyric.style.fontSize'], 36)
  assert.equal(migrated['player.volume'], 0.42)
  for (const key of ['showPlayer', 'showBorder', 'singleLine', 'autoHideControls', 'style.backgroundOpacity']) {
    assert(!Object.hasOwn(defaults, 'desktopLyric.' + key))
    assert(!Object.hasOwn(migrated, 'desktopLyric.' + key))
    assert(Object.hasOwn(old, 'desktopLyric.' + key), 'the input must remain unchanged')
  }
  const saved = { ...migrated, 'desktopLyric.enable': true, 'miniPlayer.enable': false, 'desktopLyric.x': 360 }
  assert.deepEqual(migrate(saved), saved, 'a restart preserves the independent choices')
})

test('original LX profiles keep desktop lyric preferences and existing independent mini choices win', () => {
  const original = { version: '2.1.0', 'desktopLyric.enable': true, 'desktopLyric.x': 50, 'desktopLyric.style.fontSize': 28 }
  const migrated = migrate(original)
  for (const [key, value] of Object.entries(original)) if (key !== 'version') assert.equal(migrated[key], value)
  assert(!Object.hasOwn(migrated, 'miniPlayer.enable'))
  const mixed = migrate({ version: '2.2.0', 'desktopLyric.showPlayer': true, 'desktopLyric.enable': true, 'miniPlayer.enable': false, 'miniPlayer.x': 800, 'desktopLyric.x': 80 })
  assert.equal(mixed['miniPlayer.enable'], false)
  assert.equal(mixed['miniPlayer.x'], 800)
})

test('mini and desktop renderers cannot change or call one another, and old mini lyric settings are rejected', () => {
  const policy = load()('src/main/utils/ipcPolicy.ts')
  for (const role of ['mini', 'lyric']) {
    const prefix = role === 'mini' ? 'miniPlayer' : 'desktopLyric'
    const ownChannel = role === 'mini' ? 'winMiniPlayer_' : 'winLyric_'
    const otherChannel = role === 'mini' ? 'winLyric_' : 'winMiniPlayer_'
    const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, mainFrame: { url: 'file:///app/lyric.html' + (role === 'mini' ? '?mini=true' : '') } })
    const event = { sender, senderFrame: sender.mainFrame }
    policy.registerIpcWindow(sender, role, sender.mainFrame.url)
    policy.assertIpcRequest(event, ownChannel + 'get_config')
    policy.assertIpcRequest(event, ownChannel + 'set_config', { [prefix + '.enable']: true, [prefix + '.x']: null })
    policy.assertIpcRequest(event, ownChannel + 'request_main_window_channel')
    assert.throws(() => policy.assertIpcRequest(event, otherChannel + 'get_config'), { code: 'IPC_CHANNEL_DENIED' })
    assert.throws(() => policy.assertIpcRequest(event, ownChannel + 'set_config', { [(role === 'mini' ? 'desktopLyric' : 'miniPlayer') + '.enable']: true }), { code: 'IPC_ARGUMENT_INVALID' })
    assert.throws(() => policy.assertIpcRequest(event, ownChannel + 'set_config', { 'desktopLyric.singleLine': true }), { code: 'IPC_ARGUMENT_INVALID' })
    assert.throws(() => policy.assertIpcRequest(event, ownChannel + 'set_config', { 'cookie.wy': 'private' }), { code: 'IPC_ARGUMENT_INVALID' })
  }
})
