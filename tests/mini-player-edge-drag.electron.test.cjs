const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, seedTrack } = require('./helpers/motion-fixture.cjs')
const { nativeHitTest, resizeWindow } = require('./helpers/native-window-drag.cjs')

test('holding the mini title and dragging upwards against either side never grows the window', { skip: process.platform !== 'win32', timeout: 120000 }, async t => {
  const fixture = await launch({ hidden: true, rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  const edition = process.env.LX_TEST_PROJECT ? 'win7' : 'standard'
  const output = path.resolve('output/mini-player-edge-growth-20261026')
  const label = process.env.LX_EDGE_LABEL ?? 'after'
  const errors = [], evidence = []
  const update = values => page.evaluate(values => window.lxData.updateSetting(values), values)
  let mini, native
  const moveAlongEdge = (edge, count = 60) => native.evaluate(async(window, { edge, count }) => {
    const original = window.getBounds()
    const expected = { width: global.lx.appSetting['miniPlayer.width'], height: global.lx.appSetting['miniPlayer.height'] }
    const saved = () => ({ width: global.lx.appSetting['miniPlayer.width'], height: global.lx.appSetting['miniPlayer.height'] })
    const samples = [], pauses = []
    for (let i = 1; i <= count; i++) {
      const proposed = { ...window.getBounds(), x: edge === 'left' ? -20 : global.envParams.workAreaSize.width, y: original.y - i * 3 }
      let prevented = false
      window.emit('will-move', { preventDefault() { prevented = true } }, proposed)
      await new Promise(resolve => setTimeout(resolve, 8))
      // Exercise the notification order from a busy native move loop. The
      // dimensions are real Windows bounds, including fractional-DPI rounding.
      window.emit('resize')
      samples.push({ prevented, ...window.getBounds() })
      if (i % 15 === 0) {
        await new Promise(resolve => setTimeout(resolve, 600))
        pauses.push(saved())
      }
    }
    // Finishing a move must not establish a new manually resized dimension.
    window.emit('resized')
    await new Promise(resolve => setTimeout(resolve, 600))
    return { edge, original, expected, actual: window.getBounds(), saved: saved(), samples, pauses }
  }, { edge, count })
  const assertStable = result => {
    assert(result.samples.every(sample => sample.prevented), 'screen-edge movement is clamped')
    const maxWidth = Math.max(...result.samples.map(sample => sample.width))
    const maxHeight = Math.max(...result.samples.map(sample => sample.height))
    // At 150% scaling Electron 22 can expose an enclosing DIP rectangle up to
    // two units larger. That bounded rounding must never enter saved sizes.
    assert(maxWidth <= result.original.width + 2, JSON.stringify({ edge: result.edge, original: result.original, maxWidth }))
    assert(maxHeight <= result.original.height + 2, JSON.stringify({ edge: result.edge, original: result.original, maxHeight }))
    for (const size of [...result.pauses, result.saved]) assert.deepEqual(size, result.expected)
  }
  try {
    await fs.mkdir(output, { recursive: true })
    await app.evaluate(({ screen, BrowserWindow }) => {
      screen.getCursorScreenPoint = () => {
        const mini = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('mini=true'))
        const bounds = mini?.getBounds()
        // A held native title drag keeps the pointer over the player. Edge
        // hiding itself is exercised separately after the gesture is released.
        return bounds ? { x: bounds.x + 80, y: bounds.y + 20 } : { x: -10000, y: -10000 }
      }
    })
    await seedTrack(page)
    for (const edge of ['left', 'right']) {
      await t.test(edge + ' edge with deferred native notifications, pauses and a genuine resize', async() => {
        try {
          await update({
            'miniPlayer.enable': true, 'miniPlayer.isLock': false, 'miniPlayer.isLockScreen': true,
            'miniPlayer.width': 450, 'miniPlayer.height': 240, 'miniPlayer.x': 100, 'miniPlayer.y': 500,
            'miniPlayer.autoHideControls': false, 'miniPlayer.backgroundOpacity': 100,
          })
          const matches = p => p.url().includes('mini=true')
          mini = app.windows().find(matches) ?? await app.waitForEvent('window', { predicate: matches })
          mini.on('pageerror', error => errors.push(error.message))
          await mini.locator('.mini-track-info h1').waitFor()
          native = await app.browserWindow(mini)
          assert.equal(await nativeHitTest(app, mini, '.mini-track-info h1'), 2, 'the song title remains a native caption')
          const first = await moveAlongEdge(edge)
          evidence.push(first)
          await fs.writeFile(path.join(output, `${edition}-${label}.json`), JSON.stringify(evidence, null, 2) + '\n')
          assertStable(first)

          const beforeResize = await native.evaluate(window => window.getBounds())
          const resized = await resizeWindow(app, mini, { ...beforeResize, width: 530, height: 310 })
          await page.waitForFunction(size => window.lxData.appSetting['miniPlayer.width'] === size.width && window.lxData.appSetting['miniPlayer.height'] === size.height, resized)
          const second = await moveAlongEdge(edge, 15)
          evidence.push(second)
          assertStable(second)
          assert.deepEqual(second.expected, { width: resized.width, height: resized.height })

          await update({ 'miniPlayer.isLock': true })
          await mini.waitForFunction(() => document.querySelector('#container').classList.contains('lock'))
          const locked = await native.evaluate(window => {
            const before = window.getBounds()
            let prevented = false
            window.emit('will-move', { preventDefault() { prevented = true } }, { ...before, y: before.y - 30 })
            return { before, after: window.getBounds(), prevented }
          })
          assert.equal(locked.prevented, true)
          assert.deepEqual(locked.after, locked.before)
        } finally {
          await native?.dispose()
          native = null
          await update({ 'miniPlayer.enable': false })
          if (mini && !mini.isClosed()) await mini.waitForEvent('close')
          mini = null
        }
      })
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(fixture.errors, [])
    await fs.writeFile(path.join(output, `${edition}-${label}.json`), JSON.stringify(evidence, null, 2) + '\n')
  } finally {
    await native?.dispose()
    await app.evaluate(({ app }) => { app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
