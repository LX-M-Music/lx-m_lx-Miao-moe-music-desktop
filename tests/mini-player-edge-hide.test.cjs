const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const path = require('node:path')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

function fixture(t, { fractional = false, area = { x: 0, y: 0, width: 1920, height: 1080 } } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 10000 })
  const previous = { lx: global.lx, envParams: global.envParams, nodeEnv: process.env.NODE_ENV }
  process.env.NODE_ENV = 'development'
  let point = { x: -10000, y: -10000 }
  let reads = 0
  const windows = [], writes = [], events = []
  const screen = Object.assign(new EventEmitter(), {
    getDisplayMatching: () => ({ workArea: area }),
    getPrimaryDisplay: () => ({ workArea: area }),
    getCursorScreenPoint: () => { reads++; return point },
  })
  global.envParams = { workAreaSize: { width: 1920, height: 1080 } }
  global.lx = {
    appSetting: {
      'miniPlayer.x': area.x + 140, 'miniPlayer.y': area.y + 140,
      'miniPlayer.width': 450, 'miniPlayer.height': 240,
      'miniPlayer.isLock': false, 'miniPlayer.isLockScreen': true,
      'miniPlayer.autoHideControls': false, 'miniPlayer.backgroundOpacity': 100,
      'common.isShowAnimation': true, 'ui.smoothAnimation': true, 'ui.lowPowerMode': false,
    },
    theme: { shouldUseDarkColors: false, theme: {} },
    event_app: { update_config(config) { writes.push({ ...config }); Object.assign(global.lx.appSetting, config) } },
  }
  class BrowserWindow extends EventEmitter {
    constructor({ x, y, width, height, minWidth, minHeight }) {
      super()
      this.bounds = { x, y, width, height }
      this.minimum = [minWidth, minHeight]
      this.destroyed = false
      this.ignore = false
      windows.push(this)
    }
    getBounds() { return { ...this.bounds } }
    getContentBounds() { return this.getBounds() }
    getMinimumSize() { return [...this.minimum] }
    setMinimumSize(width, height) { this.minimum = [width, height] }
    setShape(rectangles) { this.shape = rectangles.map(rectangle => ({ ...rectangle })) }
    setBounds(bounds) {
      this.bounds = { ...bounds }
      if (fractional) { this.bounds.width++; this.bounds.height++ }
      const notify = () => { if (!this.destroyed) { this.emit('move'); this.emit('resize'); this.emit('resized'); this.emit('moved') } }
      if (fractional) setTimeout(notify, 1)
      else notify()
    }
    isDestroyed() { return this.destroyed }
    setIgnoreMouseEvents(ignore) { this.ignore = ignore }
    show() {}
    blur() { this.emit('blur') }
    loadURL() { return Promise.resolve() }
    close() { this.emit('close'); this.destroyed = true; this.emit('closed') }
  }
  const main = loader({
    'node:path': path,
    electron: { BrowserWindow, screen },
    '@main/utils/windowLoadError': { observeWindowLoadErrors() {} },
    '@main/utils/ipcPolicy': { registerIpcWindow() {} },
    '@common/utils': { getPlatform: () => 'windows', isWin: true, isLinux: false },
    '@common/mainIpc': { mainSend(window, name, params) { events.push({ window, name, params }) } },
    '@common/utils/electron': { encodePath: value => value },
  })('src/main/modules/winMiniPlayer/main.ts')
  const open = () => { main.createWindow(); windows.at(-1).emit('ready-to-show'); return windows.at(-1) }
  const window = open()
  t.after(() => {
    main.closeWindow()
    global.lx = previous.lx
    global.envParams = previous.envParams
    if (previous.nodeEnv == null) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous.nodeEnv
  })
  const tick = (time = 1400) => {
    // Advance Date between polls, just as the native message loop does.
    for (let remaining = time; remaining > 0; remaining -= 100) t.mock.timers.tick(Math.min(100, remaining))
  }
  const saved = () => ({ x: global.lx.appSetting['miniPlayer.x'], y: global.lx.appSetting['miniPlayer.y'], width: global.lx.appSetting['miniPlayer.width'], height: global.lx.appSetting['miniPlayer.height'] })
  const move = (x, y, size = { width: 450, height: 240 }) => { main.setBounds({ x, y, ...size }); tick(20) }
  const hidden = () => events.filter(event => event.name === 'winMiniPlayer_edge_hidden').at(-1)?.params ?? null
  const motion = () => events.filter(event => event.name === 'winMiniPlayer_edge_motion').at(-1)?.params ?? null
  const stripBounds = () => {
    const [region] = window.shape
    const bounds = window.getBounds()
    return { ...region, x: bounds.x + region.x, y: bounds.y + region.y }
  }
  return { main, window, open, screen, area, tick, saved, move, hidden, motion, stripBounds, writes, events, reads: () => reads, cursor: next => { point = next } }
}

for (const [edge, x, y] of [
  ['left', 0, 300], ['right', 1470, 300], ['top', 700, 0],
  ['left', 0, 0], ['right', 1470, 0],
]) {
  test(`docking at ${x},${y} hides towards ${edge} and restores the expanded bounds on hover`, t => {
    const f = fixture(t)
    f.move(x, y)
    f.tick()
    assert.equal(f.hidden(), edge)
    const strip = f.stripBounds()
    assert.equal(edge === 'top' ? strip.height : strip.width, 6)
    assert.deepEqual(f.main.getBounds(), { x, y, width: 450, height: 240 })
    assert.deepEqual(f.saved(), { x, y, width: 450, height: 240 }, 'the strip is never persisted as the player size or position')
    assert.equal(f.window.ignore, true)
    f.cursor({ x: x + 100, y: y + 100 })
    f.tick(100)
    assert.equal(f.hidden(), edge, 'hovering the former content area cannot reveal a clipped window')
    f.cursor({ x: strip.x + 2, y: strip.y + 2 })
    f.tick(400)
    assert.equal(f.hidden(), null)
    assert.deepEqual(f.window.getBounds(), { x, y, width: 450, height: 240 })
    assert.deepEqual(f.window.getMinimumSize(), [280, 180])
    assert.deepEqual(f.window.shape, [], 'expanding removes the native clipping region')
    assert.equal(f.window.ignore, false)
  })
}

test('bottom-only docking and ordinary placement stay expanded', t => {
  const f = fixture(t)
  for (const [x, y] of [[700, 840], [700, 300]]) {
    f.move(x, y)
    f.tick(2000)
    assert.equal(f.hidden(), null)
    assert.equal(f.window.getBounds().width, 450)
  }
})

test('a pointer inside prevents hiding, and reentry cancels a pending hide', t => {
  const f = fixture(t)
  f.cursor({ x: 40, y: 330 })
  f.move(0, 300)
  f.tick(2000)
  assert.equal(f.hidden(), null)
  f.cursor({ x: 1000, y: 600 })
  f.tick(400)
  f.cursor({ x: 40, y: 330 })
  f.tick(100)
  f.cursor({ x: 1000, y: 600 })
  f.tick(400)
  assert.equal(f.hidden(), null)
  f.tick(700)
  assert.equal(f.hidden(), 'left')
})

test('native title dragging and a paused resize stay expanded until the gesture finishes', t => {
  const f = fixture(t)
  f.move(0, 300)
  f.window.emit('will-move', { preventDefault() { assert.fail('unlocked drag is allowed') } }, f.window.getBounds())
  f.tick(3000)
  assert.equal(f.hidden(), null)
  f.window.emit('moved')
  f.window.emit('will-resize', { preventDefault() { assert.fail('unlocked resize is allowed') } })
  f.window.emit('moved')
  f.tick(3000)
  assert.equal(f.hidden(), null, 'a move notification during resizing cannot end the resize protection')
  f.window.bounds = { x: 0, y: 300, width: 530, height: 310 }
  f.window.emit('resize')
  f.window.emit('resized')
  f.tick()
  assert.equal(f.hidden(), 'left')
  assert.deepEqual(f.main.getBounds(), { x: 0, y: 300, width: 530, height: 310 })
  f.window.emit('focus')
  assert.deepEqual(f.window.getBounds(), { x: 0, y: 300, width: 530, height: 310 })
})

test('locked, transparent mini players still reveal from the strip and preserve click-through', t => {
  const f = fixture(t)
  global.lx.appSetting['miniPlayer.isLock'] = true
  global.lx.appSetting['miniPlayer.backgroundOpacity'] = 0
  f.main.updateMouseLock()
  f.move(0, 300)
  f.tick()
  assert.equal(f.hidden(), 'left')
  f.cursor({ x: 2, y: 330 })
  f.tick(400)
  assert.equal(f.hidden(), null)
  assert.equal(f.window.ignore, true)
  f.cursor({ x: 425, y: 318 })
  f.tick(100)
  assert.equal(f.window.ignore, false, 'the unlock button remains usable after expanding')
})

test('reset and close/reopen preserve the full player and dispose polling and display listeners', t => {
  const f = fixture(t)
  f.move(1470, 0)
  f.tick()
  assert.equal(f.hidden(), 'right')
  f.move(700, 300)
  f.tick()
  assert.equal(f.hidden(), null)
  assert.deepEqual(f.window.getBounds(), { x: 700, y: 300, width: 450, height: 240 })
  f.move(1470, 0)
  f.tick()
  f.main.closeWindow()
  assert.deepEqual(f.saved(), { x: 1470, y: 0, width: 450, height: 240 })
  const reads = f.reads(), writes = f.writes.length
  f.tick(2000)
  assert.equal(f.reads(), reads)
  assert.equal(f.writes.length, writes)
  assert.equal(f.screen.listenerCount('display-metrics-changed'), 0)
  assert.equal(f.screen.listenerCount('display-removed'), 0)
  const next = f.open()
  assert.deepEqual(next.getBounds(), { x: 1470, y: 0, width: 450, height: 240 })
})

test('negative monitor coordinates and taskbar offsets use that monitor work area', t => {
  const f = fixture(t, { area: { x: -1600, y: -860, width: 1600, height: 860 } })
  f.move(-450, -860)
  f.tick()
  assert.equal(f.hidden(), 'right')
  assert.deepEqual(f.stripBounds(), { x: -6, y: -860, width: 6, height: 240 })
  assert.deepEqual(f.saved(), { x: -450, y: -860, width: 450, height: 240 })
  f.screen.emit('display-removed')
  assert.deepEqual(f.window.getBounds(), { x: -450, y: -860, width: 450, height: 240 })
})

test('display changes recover a hidden window into the new available area', t => {
  const f = fixture(t)
  f.move(1470, 0)
  f.tick()
  Object.assign(f.area, { x: 80, y: 40, width: 1280, height: 720 })
  f.screen.emit('display-metrics-changed')
  assert.equal(f.hidden(), null)
  assert.deepEqual(f.window.getBounds(), { x: 910, y: 40, width: 450, height: 240 })
})

test('repeated hide/reveal cycles never learn compact or delayed fractional-DPI sizes', t => {
  const f = fixture(t, { fractional: true })
  f.move(1470, 0)
  for (let i = 0; i < 30; i++) {
    f.cursor({ x: -10000, y: -10000 })
    f.tick()
    assert.equal(f.hidden(), 'right')
    const strip = f.stripBounds()
    f.tick(2)
    assert.deepEqual(f.saved(), { x: 1470, y: 0, width: 450, height: 240 })
    f.cursor({ x: strip.x + 2, y: strip.y + 2 })
    f.tick(400)
    f.tick(2)
    assert.equal(f.hidden(), null)
    assert.deepEqual(f.window.getBounds(), { x: 1470, y: 0, width: 451, height: 241 })
    assert.deepEqual(f.main.getBounds(), { x: 1470, y: 0, width: 450, height: 240 })
  }
  f.tick(800)
  assert.deepEqual(f.saved(), { x: 1470, y: 0, width: 450, height: 240 })
})

test('hiding and showing retain the full native bounds until their 240 ms animation settles', t => {
  const f = fixture(t)
  f.move(0, 300)
  f.tick(700)
  assert.deepEqual(f.motion(), { edge: 'left', phase: 'hiding', duration: 240 })
  assert.equal(f.hidden(), null, 'native clipping waits for the outgoing animation')
  assert.deepEqual(f.window.shape, [])
  assert.equal(f.window.ignore, true, 'transitions cannot intercept clicks through transparent pixels')
  f.tick(120)
  assert.equal(f.hidden(), null)
  f.tick(140)
  assert.equal(f.hidden(), 'left')
  const strip = f.stripBounds()
  f.cursor({ x: strip.x + 2, y: strip.y + 2 })
  f.tick(100)
  assert.deepEqual(f.motion(), { edge: 'left', phase: 'showing', duration: 240 })
  assert.deepEqual(f.window.shape, [], 'the native clip is removed before the incoming animation')
  assert.equal(f.window.ignore, true)
  assert.deepEqual(f.main.getBounds(), { x: 0, y: 300, width: 450, height: 240 })
  f.tick(240)
  assert.equal(f.hidden(), null)
  assert.equal(f.window.ignore, false)
})

test('pointer changes reverse either transition and obsolete timers cannot finish the old direction', t => {
  const f = fixture(t)
  f.move(0, 300)
  f.tick(700)
  f.cursor({ x: 100, y: 330 })
  f.tick(100)
  assert.equal(f.motion().phase, 'showing')
  f.tick(300)
  assert.equal(f.hidden(), null)
  assert.deepEqual(f.window.shape, [])
  f.cursor({ x: -10000, y: -10000 })
  f.tick()
  assert.equal(f.hidden(), 'left')
  f.cursor({ x: 2, y: 330 })
  f.tick(100)
  assert.equal(f.motion().phase, 'showing')
  f.cursor({ x: -10000, y: -10000 })
  f.tick(100)
  assert.equal(f.motion().phase, 'hiding')
  f.tick(300)
  assert.equal(f.hidden(), 'left')
  assert.equal(f.window.ignore, true)
  assert.deepEqual(f.main.getBounds(), { x: 0, y: 300, width: 450, height: 240 })
})

test('starting a native gesture during animation immediately restores the full player', t => {
  const f = fixture(t)
  f.move(0, 300)
  f.tick(700)
  f.window.emit('will-move', { preventDefault() { assert.fail('an interrupted animation must allow dragging') } }, f.window.getBounds())
  assert.equal(f.hidden(), null)
  assert.equal(f.motion().duration, 0)
  assert.deepEqual(f.window.shape, [])
  f.tick(1200)
  assert.equal(f.hidden(), null)
  assert.deepEqual(f.window.getBounds(), { x: 0, y: 300, width: 450, height: 240 })
})

for (const [key, value] of [['common.isShowAnimation', false], ['ui.smoothAnimation', false], ['ui.lowPowerMode', true]]) {
  test(`${key}=${value} retains edge hiding without animation`, t => {
    const f = fixture(t)
    global.lx.appSetting[key] = value
    f.move(0, 300)
    f.tick(800)
    assert.equal(f.hidden(), 'left')
    assert.equal(f.motion().duration, 0)
    f.cursor({ x: 2, y: 330 })
    f.tick(100)
    assert.equal(f.hidden(), null)
    assert.equal(f.motion().duration, 0)
    assert.equal(f.window.ignore, false)
  })
}

test('closing during animation cancels completion and saves only the expanded rectangle', t => {
  const f = fixture(t)
  f.move(0, 300)
  f.tick(700)
  f.main.closeWindow()
  const events = f.events.length, writes = f.writes.length
  f.tick(2000)
  assert.equal(f.events.length, events)
  assert.equal(f.writes.length, writes)
  assert.deepEqual(f.saved(), { x: 0, y: 300, width: 450, height: 240 })
  const next = f.open()
  assert.deepEqual(next.getBounds(), f.saved())
})
