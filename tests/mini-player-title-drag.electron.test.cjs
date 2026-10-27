const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, seedTrack } = require('./helpers/motion-fixture.cjs')
const { dragWindow, nativeHitTest } = require('./helpers/native-window-drag.cjs')

test('playback-only mini player keeps native dragging, clickable controls and saved bounds', { skip: process.platform !== 'win32', timeout: 120000 }, async t => {
  const fixture = await launch({ hidden: true, rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  const errors = []
  let window
  try {
    await app.evaluate(({ screen }) => {
      global.__miniPointer = { x: -10000, y: -10000 }
      screen.getCursorScreenPoint = () => global.__miniPointer
    })
    await seedTrack(page)
    await page.evaluate(() => window.lxData.updateSetting({ 'miniPlayer.enable': true, 'miniPlayer.isLock': false, 'miniPlayer.width': 450, 'miniPlayer.height': 240, 'miniPlayer.x': 140, 'miniPlayer.y': 140 }))
    const mini = app.windows().find(p => p.url().includes('mini=true')) ?? await app.waitForEvent('window', { predicate: p => p.url().includes('mini=true') })
    mini.setDefaultTimeout(6000)
    mini.on('pageerror', error => errors.push(error.message))
    await mini.locator('[data-mini-player]').waitFor()
    window = await app.browserWindow(mini)
    for (const mode of [
      { name: 'visible controls', autoHide: false, background: 100 },
      { name: 'automatically hidden controls', autoHide: true, background: 100 },
      { name: 'transparent player', autoHide: true, background: 0 },
    ]) {
      await t.test(mode.name, async() => {
        await page.evaluate(mode => window.lxData.updateSetting({ 'miniPlayer.autoHideControls': mode.autoHide, 'miniPlayer.backgroundOpacity': mode.background }), mode)
        await mini.mouse.move(90, 20)
        await mini.waitForFunction(() => getComputedStyle(document.querySelector('.mini-header')).opacity === '1')
        assert.equal(await mini.locator('[data-mini-lyrics], .font-lrc').count(), 0)
        assert.equal(await nativeHitTest(app, mini, '.mini-brand'), 2)
        assert.equal(await nativeHitTest(app, mini, '.mini-track-info h1'), 2)
        assert.equal(await nativeHitTest(app, mini, '.mini-window-buttons button'), 1)
        assert.equal(await nativeHitTest(app, mini, '.mini-progress input'), 1)
        const movement = await dragWindow(app, mini, '.mini-brand', { dx: 40, dy: 20 })
        assert.deepEqual([movement.x, movement.y], [40, 20])
        assert.deepEqual([movement.width, movement.height], [movement.expectedWidth, movement.expectedHeight])
        const moved = await window.evaluate(window => window.getBounds())
        await page.waitForFunction(bounds => window.lxData.appSetting['miniPlayer.x'] === bounds.x && window.lxData.appSetting['miniPlayer.y'] === bounds.y, moved)
        await mini.locator('.mini-header button[aria-controls="mini-options"]').click()
        assert.equal(await nativeHitTest(app, mini, '#mini-options label'), 1)
        await mini.locator('#mini-options .mini-options-title button').click()
        await mini.locator('#mini-options').waitFor({ state: 'hidden' })
        if (mode.autoHide) {
          await mini.mouse.move(-20, -20)
          await mini.waitForFunction(() => getComputedStyle(document.querySelector('.mini-header')).opacity === '0')
          assert.notEqual(await nativeHitTest(app, mini, '.mini-brand'), 2)
        }
      })
    }
    await page.evaluate(() => window.lxData.updateSetting({ 'miniPlayer.isLock': true }))
    await mini.waitForFunction(() => document.querySelector('#container').classList.contains('lock'))
    assert.notEqual(await nativeHitTest(app, mini, '.mini-brand'), 2)
    assert.deepEqual(errors, [])
    assert.deepEqual(fixture.errors, [])
  } finally { await window?.dispose(); await app.close() }
})
