const assert = require('node:assert/strict')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

function fixture(t, direction) {
  const previous = { window: global.window, document: global.document }
  const mounted = [], unmounted = [], watchers = [], moves = [], resizable = []
  const surface = () => {
    const listeners = new Map()
    return {
      addEventListener(name, fn) {
        if (!listeners.has(name)) listeners.set(name, new Set())
        listeners.get(name).add(fn)
      },
      removeEventListener(name, fn) { listeners.get(name)?.delete(fn) },
      emit(name, event) { for (const fn of [...listeners.get(name) ?? []]) fn(event) },
      count() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0) },
    }
  }
  global.window = { ...surface(), screenX: 240, screenY: 200, innerWidth: 640, innerHeight: 240 }
  global.document = { ...surface(), createDocumentFragment: () => ({ appendChild() {} }) }
  const setting = { 'desktopLyric.isLock': false }
  const load = loader({
    '@common/utils/vueTools': {
      ref: value => ({ value }), onMounted: cb => mounted.push(cb), onBeforeUnmount: cb => unmounted.push(cb),
      watch: (get, cb) => watchers.push(cb), nextTick: cb => cb(),
    },
    '@common/utils': { isWin: true },
    '@common/utils/renderer': { scrollTo: () => () => {}, scrollXRTo: () => () => {} },
    '@lyric/store/state': { setting, isPlay: { value: false } },
    '@lyric/store/lyric': { lyric: { lines: [], line: 0 } },
    '@lyric/utils/ipc': { setWindowBounds: value => moves.push(value), setWindowResizeable: value => resizable.push(value) },
  })
  const api = direction
    ? load(`src/renderer-lyric/components/layout/Lyric${direction}/useLyric.js`).default({ value: false })
    : load('src/renderer-lyric/components/layout/useDrag.js').default()
  const target = {
    captured: new Set(), closest: () => null,
    setPointerCapture(id) { this.captured.add(id) },
    hasPointerCapture(id) { return this.captured.has(id) },
    releasePointerCapture(id) { this.captured.delete(id) },
  }
  if (direction) {
    api.dom_lyric.value = { scrollTop: 100, scrollLeft: -100, querySelectorAll: () => [] }
    api.dom_lyric_text.value = { textContent: '', appendChild() {} }
  }
  for (const cb of mounted) cb()
  const event = options => ({
    button: 0, buttons: 1, isPrimary: true, pointerId: 1, pointerType: 'mouse',
    screenX: 340, screenY: 260, clientX: 100, clientY: 60,
    target, currentTarget: target, preventDefault() {}, ...options,
  })
  let closed = false
  const close = () => {
    if (closed) return
    for (const cb of unmounted) cb()
    closed = true
  }
  t.after(() => { close(); global.window = previous.window; global.document = previous.document })
  return {
    api, moves, resizable, target, event, close,
    down: options => api.handleLyricPointerDown(event(options)),
    move: options => document.emit('pointermove', event(options)),
    end: (name = 'pointerup', options) => document.emit(name, event(options)),
    lock: () => { setting['desktopLyric.isLock'] = true; for (const cb of watchers) cb(true) },
  }
}

for (const direction of [undefined, 'Horizontal', 'Vertical']) {
  test(`${direction ?? 'toolbar'} drag counts queued movement once and ignores window-relative feedback`, t => {
    const f = fixture(t, direction)
    f.down()
    // All three events arrive before the main process moves the window.
    for (const [x, y] of [[350, 265], [370, 280], [380, 285]]) f.move({ screenX: x, screenY: y })
    assert.deepEqual(f.moves.map(({ x, y, absolute }) => [x, y, absolute]), [[250, 205, true], [270, 220, true], [280, 225, true]])
    assert.deepEqual([f.moves.at(-1).x - window.screenX, f.moves.at(-1).y - window.screenY], [40, 25])
    const count = f.moves.length
    // The window catches up: client coordinates change under a stationary mouse.
    for (const clientX of [90, 70, 60]) f.move({ screenX: 380, screenY: 285, clientX, clientY: 35 })
    assert.equal(f.moves.length, count, 'a stationary cursor cannot move the window again')
    window.innerWidth = 641
    f.move({ screenX: 330, screenY: 240, clientX: 50, clientY: 15 })
    assert.deepEqual(f.moves.at(-1), { x: 230, y: 180, w: 640, h: 240, absolute: true })
    f.end()
    assert.deepEqual(f.resizable, [false, true])
    assert.equal(f.target.captured.size, 0)
  })
}

for (const reason of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur', 'released mouse', 'lock', 'unmount']) {
  test(`${reason} ends dragging without a stuck pointer or disabled resize`, t => {
    const f = fixture(t)
    f.down()
    f.move({ screenX: 350 })
    if (reason === 'blur') window.emit('blur')
    else if (reason === 'released mouse') f.move({ buttons: 0, screenX: 400 })
    else if (reason === 'lock') f.lock()
    else if (reason === 'unmount') f.close()
    else f.end(reason)
    f.move({ screenX: 700, screenY: 700 })
    assert.equal(f.moves.length, 1)
    assert.deepEqual(f.resizable, [false, true])
    assert.equal(f.target.captured.size, 0)
    if (reason === 'unmount') assert.equal(document.count() + window.count(), 0)
  })
}

test('toolbar buttons, secondary clicks and other pointers cannot start or hijack a drag', t => {
  const f = fixture(t)
  for (const options of [{ target: {} }, { button: 2 }, { isPrimary: false }]) {
    f.down(options)
    f.move({ screenX: 400 })
  }
  assert.deepEqual(f.moves, [])
  assert.deepEqual(f.resizable, [])
  f.down()
  f.move({ pointerId: 2, screenX: 900 })
  f.end('pointerup', { pointerId: 2 })
  f.move({ screenX: 350 })
  assert.equal(f.moves[0].x, 250)
  f.end()
  window.screenX = -640
  window.screenY = -200
  f.down({ screenX: -500, screenY: -100 })
  f.move({ screenX: -499.5, screenY: -101.5 })
  assert.deepEqual(f.moves.at(-1), { x: -639.5, y: -201.5, w: 640, h: 240, absolute: true })
})

for (const direction of ['Horizontal', 'Vertical']) {
  test(`${direction} lyric text still scrolls its content without moving the window`, t => {
    const f = fixture(t, direction)
    const text = { closest: () => ({}) }
    f.down({ target: text })
    assert.equal(f.api.isMsDown.value, true)
    f.move({ clientX: 135, clientY: 25, screenX: 375, screenY: 225 })
    assert.equal(f.api.dom_lyric.value[direction === 'Horizontal' ? 'scrollTop' : 'scrollLeft'], direction === 'Horizontal' ? 135 : -135)
    assert.deepEqual(f.moves, [])
    assert.deepEqual(f.resizable, [])
    f.end()
    assert.equal(f.api.isMsDown.value, false)
  })
}

test('touch dragging follows the same screen coordinates and releases on cancellation', t => {
  const f = fixture(t)
  f.down({ pointerType: 'touch', pointerId: 7 })
  f.move({ pointerType: 'touch', pointerId: 7, buttons: 0, screenX: 370, screenY: 280 })
  f.end('pointercancel', { pointerType: 'touch', pointerId: 7 })
  f.move({ pointerType: 'touch', pointerId: 7, screenX: 500 })
  assert.deepEqual(f.moves, [{ x: 270, y: 220, w: 640, h: 240, absolute: true }])
  assert.deepEqual(f.resizable, [false, true])
})

test('main process ignores queued movement after locking or closing desktop lyrics', t => {
  const previous = global.lx
  t.after(() => { global.lx = previous })
  global.lx = { appSetting: { 'desktopLyric.isLock': false } }
  const handlers = new Map(), moved = []
  let bounds = { x: 240, y: 200, width: 640, height: 240 }
  const names = loader()('src/common/ipcNames.ts').WIN_LYRIC_RENDERER_EVENT_NAME
  loader({
    '@main/modules/commonRenderers/common': { registerRendererEvents() {} },
    '@common/mainIpc': { mainOn: (name, handler) => handlers.set(name, handler), mainHandle() {} },
    '@common/ipcNames': { WIN_LYRIC_RENDERER_EVENT_NAME: names },
    './utils': { getLyricWindowBounds: (bounds, delta) => ({ ...bounds, x: bounds.x + delta.x, y: bounds.y + delta.y }) },
    '@main/modules/winMain': {},
    './main': { getBounds: () => bounds, setBounds: value => moved.push(value) },
    electron: {}, './mouseCheckTools': {},
  })('src/main/modules/winLyric/rendererEvent.ts').default()
  const move = () => handlers.get(names.set_win_bounds)({ params: { x: 40, y: 25, w: 640, h: 240 } })
  move()
  global.lx.appSetting['desktopLyric.isLock'] = true
  move()
  global.lx.appSetting['desktopLyric.isLock'] = false
  bounds = null
  move()
  assert.deepEqual(moved, [{ x: 280, y: 225, width: 640, height: 240 }])
})

test('absolute targets do not compound native rounding and retain screen limits and relative resizing', t => {
  const previous = { lx: global.lx, envParams: global.envParams }
  t.after(() => { global.lx = previous.lx; global.envParams = previous.envParams })
  global.lx = { appSetting: { 'desktopLyric.isLockScreen': true } }
  global.envParams = { workAreaSize: { width: 1920, height: 1080 } }
  const { getLyricWindowBounds } = loader()('src/main/modules/winLyric/utils.ts')
  let native = { x: 240, y: 200, width: 640, height: 240 }
  // At 150% scaling older Electron floors odd vertical coordinates by one DIP.
  for (const [x, y] of [[250, 205], [270, 220], [280, 225]]) {
    const target = getLyricWindowBounds(native, { x, y, w: 640, h: 240, absolute: true })
    assert.deepEqual([target.x, target.y], [x, y])
    native = { ...target, y: Math.floor(y * 1.5) / 1.5 }
  }
  assert(Math.abs(native.y - 225) < 1, 'rounding is limited to the current target')
  assert.deepEqual(getLyricWindowBounds(native, { x: 3000, y: -100, w: 640, h: 240, absolute: true }), { x: 1280, y: 0, width: 640, height: 240 })
  global.lx.appSetting['desktopLyric.isLockScreen'] = false
  const outside = getLyricWindowBounds(native, { x: -640, y: -200, w: 640, h: 240, absolute: true })
  assert.deepEqual(outside, { x: -640, y: -200, width: 640, height: 240 })
  assert.deepEqual(getLyricWindowBounds(outside, { x: -10, y: -20, w: 650, h: 260 }), { x: -650, y: -220, width: 650, height: 260 })
})

test('desktop lyric IPC accepts absolute positions and validates the optional flag', () => {
  const { EventEmitter } = require('node:events')
  const policy = loader({
    path: require('node:path'), os: require('node:os'), crypto: require('node:crypto'),
    'electron-log/node': { hooks: [], error() {} },
  })('src/main/utils/ipcPolicy.ts')
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, mainFrame: { url: 'file:///app/lyric.html' } })
  const event = { sender, senderFrame: sender.mainFrame }
  policy.registerIpcWindow(sender, 'lyric', sender.mainFrame.url)
  const delta = { x: 40, y: 25, w: 640, h: 240 }
  for (const payload of [delta, { ...delta, absolute: true }, { ...delta, absolute: false }]) policy.assertIpcRequest(event, 'winLyric_set_win_bounds', payload)
  assert.throws(() => policy.assertIpcRequest(event, 'winLyric_set_win_bounds', { ...delta, absolute: 'true' }), { code: 'IPC_ARGUMENT_INVALID' })
})
