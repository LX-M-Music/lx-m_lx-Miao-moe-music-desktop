const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')
const geometry = loader()('src/common/miniPlayer.ts')

function fixture(t, { locked = true, linux = false, hoverHide = false, autoHide = false, showPlayer = true, background = 92 } = {}) {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const previous = global.lx
  global.lx = { appSetting: { 'desktopLyric.isLock': locked, 'desktopLyric.isHoverHide': hoverHide, 'desktopLyric.autoHideControls': autoHide, 'desktopLyric.showPlayer': showPlayer, 'desktopLyric.style.backgroundOpacity': background } }
  const window = new EventEmitter()
  const bounds = { x: 240, y: 120, width: 450, height: 300 }
  let point = { x: 300, y: 200 }
  let reads = 0
  let destroyed = false
  const calls = []
  const pointers = []
  window.getContentBounds = () => bounds
  window.isDestroyed = () => destroyed
  window.setIgnoreMouseEvents = (ignore, options) => {
    assert(!destroyed)
    calls.push({ ignore, options })
  }
  const { createLockControls } = loader({
    electron: { screen: { getCursorScreenPoint() { reads++; return point } } },
    '@common/utils': { isLinux: linux },
    '@common/miniPlayer': geometry,
  })('src/main/modules/winLyric/lockControls.ts')
  const controls = createLockControls(window, point => pointers.push(point))
  const close = () => { destroyed = true; window.emit('closed') }
  t.after(() => { close(); global.lx = previous })
  const corner = () => {
    const { top, right, width, height } = geometry.MINI_PLAYER_UNLOCK_BUTTON
    return { x: bounds.x + bounds.width - right - width / 2, y: bounds.y + top + height / 2 }
  }
  const move = next => { point = next; t.mock.timers.tick(100) }
  return { controls, calls, pointers, bounds, corner, move, close, reads: () => reads }
}

for (const hoverHide of [false, true]) {
  test(`locked lyrics stay click-through except at the unlock button (hover-hide ${hoverHide})`, t => {
    const f = fixture(t, { hoverHide })
    f.controls.update()
    assert.deepEqual(f.calls.at(-1), { ignore: true, options: { forward: true } })
    f.move(f.corner())
    assert.equal(f.calls.at(-1).ignore, false)
    f.move({ x: 300, y: 200 })
    assert.equal(f.calls.at(-1).ignore, true)
    const count = f.calls.length
    t.mock.timers.tick(1000)
    assert.equal(f.calls.length, count, 'stationary pointers do not repeatedly change native input')
  })
}

test('unlocking restores all input and stops polling', t => {
  const f = fixture(t)
  f.controls.update()
  global.lx.appSetting['desktopLyric.isLock'] = false
  f.controls.update()
  assert.equal(f.calls.at(-1).ignore, false)
  const reads = f.reads()
  t.mock.timers.tick(1000)
  assert.equal(f.reads(), reads)
})

test('a newly opened locked window is recoverable with the pointer already at the button', t => {
  const f = fixture(t)
  f.move(f.corner())
  f.controls.update()
  assert.equal(f.calls.at(-1).ignore, false)
})

test('moving or resizing the window uses its current content coordinates, including minimum lyric size', t => {
  const f = fixture(t)
  f.controls.update()
  Object.assign(f.bounds, { x: -500, y: 310, width: 38, height: 38 })
  f.move(f.corner())
  assert.equal(f.calls.at(-1).ignore, false)
  const { top, right, width, height } = geometry.MINI_PLAYER_UNLOCK_BUTTON
  assert(width + right <= f.bounds.width && height + top <= f.bounds.height)
  const left = f.bounds.x + f.bounds.width - right - width
  const y = f.bounds.y + top
  for (const point of [{ x: left - 1, y }, { x: left + width, y }, { x: left, y: y - 1 }, { x: left, y: y + height }]) {
    f.move(point)
    assert.equal(f.calls.at(-1).ignore, true, JSON.stringify(point))
    f.move({ x: left, y })
    assert.equal(f.calls.at(-1).ignore, false)
  }
})

test('updating an active lock does not duplicate polling, and closing disposes it', t => {
  const f = fixture(t)
  f.controls.update()
  f.controls.update()
  const before = f.reads()
  t.mock.timers.tick(100)
  assert.equal(f.reads(), before + 1)
  f.close()
  const reads = f.reads()
  t.mock.timers.tick(1000)
  assert.equal(f.reads(), reads)
})

test('opaque unlocked windows with visible controls do not need recovery polling', t => {
  const f = fixture(t, { locked: false })
  f.controls.update()
  t.mock.timers.tick(1000)
  assert.equal(f.reads(), 0)
  assert.equal(f.calls.at(-1).ignore, false)
})

test('transparent backgrounds track window entry and exit even when all player controls are visible', t => {
  const f = fixture(t, { locked: false })
  f.controls.update()
  assert.equal(f.reads(), 0)
  global.lx.appSetting['desktopLyric.style.backgroundOpacity'] = 0
  f.controls.update()
  assert.deepEqual(f.pointers.at(-1), { x: 60, y: 80 }, 'transparency reveals the outline for a pointer already inside')
  f.move({ x: f.bounds.x + f.bounds.width - 1, y: f.bounds.y + f.bounds.height - 1 })
  assert.deepEqual(f.pointers.at(-1), { x: 449, y: 299 }, 'the entire window participates in hover')
  assert.equal(f.calls.at(-1).ignore, false, 'transparency does not enable click-through')
  f.move({ x: f.bounds.x + f.bounds.width, y: f.bounds.y + f.bounds.height - 1 })
  assert.equal(f.pointers.at(-1), null, 'the right boundary is outside the window')
  global.lx.appSetting['desktopLyric.style.backgroundOpacity'] = 92
  f.controls.update()
  const reads = f.reads()
  t.mock.timers.tick(1000)
  assert.equal(f.reads(), reads, 'restoring an opaque background stops the extra tracking')
})

test('recovery does not depend on forwarded mouse events on Linux', t => {
  const f = fixture(t, { linux: true })
  f.controls.update()
  assert.deepEqual(f.calls.at(-1), { ignore: true, options: { forward: false } })
  f.move(f.corner())
  assert.equal(f.calls.at(-1).ignore, false)
})

for (const [autoHide, showPlayer] of [[true, true], [false, false], [true, false]]) {
  test(`hidden controls receive system pointer positions without DOM events (auto-hide ${autoHide}, player ${showPlayer})`, t => {
    const f = fixture(t, { locked: false, autoHide, showPlayer })
    global.lx.appSetting['desktopLyric.style.backgroundOpacity'] = 0
    f.controls.update()
    f.move({ x: f.bounds.x + 80, y: f.bounds.y + 20 })
    assert.deepEqual(f.pointers.at(-1), { x: 80, y: 20 })
    assert.equal(f.calls.at(-1).ignore, false, 'revealing controls does not enable click-through')
    const count = f.pointers.length
    t.mock.timers.tick(1000)
    assert.equal(f.pointers.length, count, 'a stationary pointer does not spam the renderer')
    f.move({ x: -10000, y: -10000 })
    assert.equal(f.pointers.at(-1), null, 'leaving the window clears the hover state')
  })
}

test('pointer recovery follows moved and resized windows in logical screen coordinates', t => {
  const f = fixture(t, { locked: false, showPlayer: false })
  f.controls.update()
  Object.assign(f.bounds, { x: -600, y: 310, width: 600, height: 430 })
  f.move({ x: -520, y: 330 })
  assert.deepEqual(f.pointers.at(-1), { x: 80, y: 20 })
  const count = f.pointers.length
  f.bounds.width = 450
  t.mock.timers.tick(100)
  assert.equal(f.pointers.length, count + 1, 'layout changes refresh the hit area even without pointer movement')
  f.move({ x: f.bounds.x + f.bounds.width, y: 330 })
  assert.equal(f.pointers.at(-1), null)
})

test('changing the display switches starts and stops recovery, including a pointer already over the header', t => {
  const f = fixture(t, { locked: false })
  f.controls.update()
  f.move({ x: f.bounds.x + 80, y: f.bounds.y + 20 })
  assert.equal(f.reads(), 0)
  global.lx.appSetting['desktopLyric.showPlayer'] = false
  f.controls.update()
  assert.deepEqual(f.pointers.at(-1), { x: 80, y: 20 })
  global.lx.appSetting['desktopLyric.showPlayer'] = true
  f.controls.update()
  assert.equal(f.pointers.at(-1), null)
  const reads = f.reads()
  t.mock.timers.tick(1000)
  assert.equal(f.reads(), reads)
})

test('closing an unlocked lyric-only window stops its recovery timer', t => {
  const f = fixture(t, { locked: false, showPlayer: false })
  f.controls.update()
  f.close()
  const reads = f.reads()
  t.mock.timers.tick(1000)
  assert.equal(f.reads(), reads)
})
