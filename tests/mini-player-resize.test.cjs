const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const path = require('node:path')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 })
  const previous = { lx: global.lx, envParams: global.envParams, nodeEnv: process.env.NODE_ENV }
  process.env.NODE_ENV = 'development'
  const windows = []
  const writes = []
  global.envParams = { workAreaSize: { width: 1920, height: 1080 } }
  global.lx = {
    appSetting: {
      'miniPlayer.x': 240, 'miniPlayer.y': 240,
      'miniPlayer.width': 450, 'miniPlayer.height': 300,
      'miniPlayer.isLock': false,
      'miniPlayer.isLockScreen': true,
    },
    theme: { shouldUseDarkColors: false, theme: {} },
    event_app: {
      update_config(config) { writes.push({ ...config }); Object.assign(global.lx.appSetting, config) },
      desktop_lyric_window_created() {},
    },
  }
  class BrowserWindow extends EventEmitter {
    constructor({ x, y, width, height }) {
      super()
      this.bounds = { x, y, width, height }
      this.restores = []
      windows.push(this)
    }
    getBounds() { return { ...this.bounds } }
    setBounds(bounds) { this.bounds = { ...this.bounds, ...bounds }; this.restores.push({ ...this.bounds }) }
    setPosition(x, y) { this.setBounds({ x, y }) }
    loadURL() { return Promise.resolve() }
    close() { this.emit('close'); this.emit('closed') }
  }
  const main = loader({
    'node:path': path,
    electron: { BrowserWindow, screen: Object.assign(new EventEmitter(), {
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    }) },
    '@main/utils/windowLoadError': { observeWindowLoadErrors() {} },
    '@main/utils/ipcPolicy': { registerIpcWindow() {} },
    '@common/utils': { getPlatform: () => 'windows', isWin: true, isLinux: false },
    '@common/mainIpc': { mainSend() {} },
    '@common/ipcNames': loader()('src/common/ipcNames.ts'),
    '@common/utils/electron': { encodePath: value => value },
    '@common/miniPlayer': loader()('src/common/miniPlayer.ts'),
  })('src/main/modules/winMiniPlayer/main.ts')
  main.createWindow()
  t.after(() => {
    main.closeWindow()
    global.lx = previous.lx
    global.envParams = previous.envParams
    if (previous.nodeEnv == null) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous.nodeEnv
  })
  const saved = () => {
    const setting = global.lx.appSetting
    return { x: setting['miniPlayer.x'], y: setting['miniPlayer.y'], width: setting['miniPlayer.width'], height: setting['miniPlayer.height'] }
  }
  const resize = (bounds, edge = 'top-left') => {
    const window = windows.at(-1)
    let prevented = false
    window.emit('will-resize', { preventDefault() { prevented = true } }, bounds, { edge })
    if (prevented) return false
    window.bounds = { ...bounds }
    // Resizing a top/left edge also moves the window. Windows may deliver this
    // before resize, including the final position update when releasing it.
    window.emit('move')
    window.emit('resize')
    return true
  }
  return { main, windows, window: windows[0], writes, saved, resize }
}

for (const edge of ['top', 'left', 'right', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right']) {
  test(`${edge} resizing keeps the new bounds when move arrives before resize`, t => {
    const f = fixture(t)
    const original = f.window.getBounds()
    const bounds = {
      x: original.x - (edge.includes('left') ? 40 : 0),
      y: original.y - (edge.includes('top') ? 30 : 0),
      width: original.width + (edge.includes('left') || edge.includes('right') ? 40 : 0),
      height: original.height + (edge.includes('top') || edge.includes('bottom') ? 30 : 0),
    }
    assert(f.resize(bounds, edge))
    f.window.emit('resized')
    assert.deepEqual(f.window.getBounds(), bounds)
    assert.deepEqual(f.saved(), bounds, 'releasing the border immediately saves its final bounds')
    t.mock.timers.tick(1200)
    assert.deepEqual(f.window.getBounds(), bounds)
    assert.deepEqual(f.saved(), bounds)
    assert.deepEqual(f.window.restores, [])
  })
}

test('pausing during a resize does not expire the gesture or restore stale dimensions', t => {
  const f = fixture(t)
  assert(f.resize({ x: 200, y: 200, width: 490, height: 340 }))
  t.mock.timers.tick(2000)
  const final = { x: 180, y: 180, width: 510, height: 360 }
  f.window.bounds = final
  f.window.emit('move')
  f.window.emit('resize')
  f.window.emit('resized')
  assert.deepEqual(f.window.getBounds(), final)
  assert.deepEqual(f.saved(), final)
})

test('closing immediately after resizing preserves the new size and clears old saves', t => {
  const f = fixture(t)
  const bounds = { x: 200, y: 200, width: 490, height: 340 }
  assert(f.resize(bounds))
  f.main.closeWindow()
  assert.deepEqual(f.saved(), bounds)
  f.main.createWindow()
  assert.deepEqual(f.windows.at(-1).getBounds(), bounds)
  const writes = f.writes.length
  t.mock.timers.tick(2000)
  assert.equal(f.writes.length, writes, 'a closed window must not save over its replacement')
})

test('locking blocks native resizing', t => {
  const f = fixture(t)
  const bounds = f.window.getBounds()
  global.lx.appSetting['miniPlayer.isLock'] = true
  assert.equal(f.resize({ ...bounds, width: 600 }), false)
  assert.deepEqual(f.window.getBounds(), bounds)
})

function simulateFractionalScale(window, deferred = false) {
  const setBounds = window.setBounds.bind(window)
  // Fractional scaling can report a larger enclosing DIP rectangle after moving.
  // setPosition also goes through this conversion, retaining the previous size.
  window.setBounds = requested => {
    const next = { ...window.getBounds(), ...requested }
    setBounds({ ...next, width: next.width + 1, height: next.height + 1 })
    const notify = () => {
      window.emit('resize')
      window.emit('move')
    }
    if (deferred) setTimeout(notify, 1)
    else notify()
  }
}

for (const edge of ['left', 'right', 'top', 'bottom']) {
  test(`repeated ${edge} edge corrections do not accumulate display rounding or save it as a resize`, t => {
    const f = fixture(t)
    simulateFractionalScale(f.window)
    const original = f.saved()
    for (let i = 0; i < 40; i++) {
      const target = { ...f.window.getBounds(), x: 100 + i, y: 100 + i }
      if (edge === 'left') target.x = -20
      if (edge === 'right') target.x = 1920
      if (edge === 'top') target.y = -20
      if (edge === 'bottom') target.y = 1080
      let prevented = false
      f.window.emit('will-move', { preventDefault() { prevented = true } }, target)
      assert(prevented)
      assert.equal(f.window.bounds.width, original.width + 1)
      assert.equal(f.window.bounds.height, original.height + 1)
      // Include pauses long enough to save while the user is still dragging.
      t.mock.timers.tick(600)
      assert.equal(f.saved().width, original.width)
      assert.equal(f.saved().height, original.height)
    }
    f.main.closeWindow()
    f.main.createWindow()
    assert.equal(f.windows.at(-1).bounds.width, original.width)
    assert.equal(f.windows.at(-1).bounds.height, original.height)
  })
}

test('a deliberate resize after edge dragging establishes the size for subsequent movement', t => {
  const f = fixture(t)
  simulateFractionalScale(f.window)
  f.window.emit('will-move', { preventDefault() {} }, { ...f.window.getBounds(), x: -20 })
  const resized = { x: 0, y: 100, width: 600, height: 400 }
  assert(f.resize(resized))
  f.window.emit('resized')
  assert.deepEqual(f.saved(), resized)
  for (let i = 0; i < 10; i++) {
    f.window.emit('will-move', { preventDefault() {} }, { ...f.window.getBounds(), x: -20, y: 100 + i })
    t.mock.timers.tick(600)
    assert.equal(f.saved().width, 600)
    assert.equal(f.saved().height, 400)
    assert(f.window.bounds.width <= 601 && f.window.bounds.height <= 401)
  }
})

for (const edge of ['left', 'right']) {
  test(`dragging up along the ${edge} edge does not learn delayed native resize notifications`, t => {
    const f = fixture(t)
    simulateFractionalScale(f.window, true)
    const original = f.saved()
    for (let i = 0; i < 60; i++) {
      f.window.emit('will-move', { preventDefault() {} }, {
        ...f.window.getBounds(), x: edge === 'left' ? -20 : 1920, y: 500 - i * 3,
      })
      t.mock.timers.tick(10)
      if (i % 10 === 0) t.mock.timers.tick(600)
    }
    t.mock.timers.tick(600)
    assert.deepEqual([f.saved().width, f.saved().height], [original.width, original.height])
    assert.deepEqual([f.window.bounds.width, f.window.bounds.height], [original.width + 1, original.height + 1])
  })
}

test('a native move can report resize and resized without changing the saved dimensions', t => {
  const f = fixture(t)
  const original = f.saved()
  let prevented = false
  f.window.emit('will-move', { preventDefault() { prevented = true } }, { ...f.window.bounds, x: 200, y: 200 })
  assert.equal(prevented, false)
  f.window.bounds = { x: 200, y: 200, width: original.width + 1, height: original.height + 1 }
  f.window.emit('resize')
  f.window.emit('move')
  f.window.emit('resized')
  t.mock.timers.tick(600)
  assert.deepEqual(f.saved(), { ...original, x: 200, y: 200 })
})

test('explicit programmatic sizing stays authoritative despite delayed display rounding', t => {
  const f = fixture(t)
  simulateFractionalScale(f.window, true)
  f.main.setBounds({ x: 0, y: 300, width: 600, height: 400 })
  t.mock.timers.tick(1)
  t.mock.timers.tick(600)
  assert.deepEqual([f.saved().width, f.saved().height], [600, 400])
  f.window.emit('will-move', { preventDefault() {} }, { ...f.window.bounds, x: -20, y: 290 })
  t.mock.timers.tick(1)
  t.mock.timers.tick(600)
  assert.deepEqual([f.saved().width, f.saved().height], [600, 400])
  assert.deepEqual([f.window.bounds.width, f.window.bounds.height], [601, 401])
})
