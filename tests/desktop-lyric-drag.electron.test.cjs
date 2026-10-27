const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { test } = require('node:test')
const { launch, seedTrack, captureHidden } = require('./helpers/motion-fixture.cjs')
const { nativeHitTest, nativeIgnoresMouse, resizeWindow } = require('./helpers/native-window-drag.cjs')

test('original desktop lyrics drag smoothly through the real window IPC', { skip: process.platform !== 'win32', timeout: 120000 }, async t => {
  const fixture = await launch({ hidden: true, rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  const edition = process.env.LX_TEST_PROJECT ? 'win7' : 'standard'
  const output = path.resolve('output/desktop-lyric-drag-20261025', edition)
  const errors = [], evidence = []
  let desktop, window
  const update = values => page.evaluate(values => window.lxData.updateSetting(values), values)
  const bounds = () => window.evaluate(window => window.getBounds())
  const expectBounds = async expected => {
    let actual
    for (let i = 0; i < 50; i++) {
      actual = await bounds()
      // Electron rounds native pixel sizes at fractional Windows display scales.
      if (Math.abs(actual.x - expected.x) <= 1 && Math.abs(actual.y - expected.y) <= 1 &&
          Math.abs(actual.width - expected.width) <= 1 && Math.abs(actual.height - expected.height) <= 1) return actual
      await delay(50)
    }
    assert.deepEqual(actual, expected)
  }
  const prepareSurface = () => desktop.evaluate(() => {
    const text = document.querySelector('.line-content')
    text.parentElement.parentElement.dataset.dragFixture = 'lyric'
    document.querySelector('.control-bar button').parentElement.dataset.dragFixture = 'toolbar'
  })
  const down = async(selector, position) => {
    const rect = await desktop.locator(selector).first().boundingBox()
    assert(rect)
    await desktop.evaluate(() => {
      window.__lyricDragStart = null
      document.addEventListener('pointerdown', event => {
        window.__lyricDragStart = {
          id: event.pointerId, x: event.screenX, y: event.screenY,
          clientX: event.clientX, clientY: event.clientY,
          isLyric: !!event.target.closest('.font-lrc, .extended'),
        }
      }, { capture: true, once: true })
    })
    await desktop.mouse.move(rect.x + position.x, rect.y + position.y)
    await desktop.mouse.down()
    await desktop.waitForFunction(() => window.__lyricDragStart !== null)
  }
  const move = steps => desktop.evaluate(steps => {
    const start = window.__lyricDragStart
    // Deliver a burst before queued native moves can change client coordinates.
    for (const { x, y, clientX = start.clientX, clientY = start.clientY } of steps) {
      document.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, pointerId: start.id, pointerType: 'mouse', isPrimary: true, buttons: 1,
        screenX: start.x + x, screenY: start.y + y, clientX, clientY,
      }))
    }
  }, steps)
  try {
    await fs.mkdir(output, { recursive: true })
    await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = () => ({ x: -10000, y: -10000 }) })
    await seedTrack(page)
    await page.evaluate(() => {
      window.lxData.musicInfo.lrc = Array.from({ length: 16 }, (_, i) => `[00:${String(i * 3).padStart(2, '0')}.00]桌面歌词拖动测试第${i + 1}行`).join('\n')
      window.app_event.lyricUpdated()
    })
    await update({
      'miniPlayer.enable': false, 'desktopLyric.enable': true,
      'desktopLyric.isLock': false, 'desktopLyric.isLockScreen': true,
      'desktopLyric.pauseHide': false, 'desktopLyric.isHoverHide': false,
      'desktopLyric.x': 240, 'desktopLyric.y': 200,
      'desktopLyric.width': 640, 'desktopLyric.height': 240,
      'desktopLyric.style.fontSize': 24, 'desktopLyric.style.isZoomActiveLrc': false,
    })
    const matches = p => p.url().includes('lyric.html') && !p.url().includes('mini=true')
    desktop = app.windows().find(matches) ?? await app.waitForEvent('window', { predicate: matches })
    desktop.setDefaultTimeout(7000)
    desktop.on('pageerror', error => errors.push(error.message))
    await desktop.locator('.font-lrc').first().waitFor()
    window = await app.browserWindow(desktop)
    await window.evaluate(window => window.webContents.setBackgroundThrottling(false))

    for (const direction of ['horizontal', 'vertical']) {
      await t.test(direction + ' blank space follows queued screen movement without feedback', async t => {
        t.after(() => desktop.mouse.up().catch(() => {}))
        await update({ 'desktopLyric.direction': direction })
        await desktop.waitForFunction(direction => getComputedStyle(document.querySelector('.line-content')).writingMode === (direction === 'vertical' ? 'vertical-rl' : 'horizontal-tb'), direction)
        await prepareSurface()
        const original = await bounds()
        await down('[data-drag-fixture="lyric"]', { x: original.width - 20, y: original.height - 20 })
        await desktop.waitForFunction(() => document.querySelector('[data-drag-fixture="lyric"]').hasPointerCapture(window.__lyricDragStart.id))
        await move([{ x: 10, y: 5 }, { x: 30, y: 20 }, { x: 40, y: 25 }])
        const expected = { ...original, x: original.x + 40, y: original.y + 25 }
        const moved = await expectBounds(expected)
        // The same screen position with a changed client position must stay still.
        await move([{ x: 40, y: 25, clientX: 10, clientY: 10 }])
        await desktop.mouse.up()
        const released = await expectBounds(expected)
        assert.equal(await window.evaluate(window => window.isResizable()), true)
        await page.waitForFunction(actual => window.lxData.appSetting['desktopLyric.x'] === actual.x && window.lxData.appSetting['desktopLyric.y'] === actual.y, released)
        evidence.push({ direction, original, expected, moved, actual: released })
      })
      await t.test(direction + ' text scrolls while the native window stays fixed', async t => {
        t.after(() => desktop.mouse.up().catch(() => {}))
        const text = desktop.locator('.font-lrc').first()
        const original = await bounds()
        await text.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' }))
        const before = await desktop.locator('[data-drag-fixture="lyric"]').evaluate(el => ({ top: el.scrollTop, left: el.scrollLeft }))
        const rect = await text.boundingBox()
        await down('.font-lrc', { x: Math.min(20, rect.width / 2), y: rect.height / 2 })
        const start = await desktop.evaluate(() => window.__lyricDragStart)
        assert.equal(start.isLyric, true, 'the lyric text receives input below the floating toolbar')
        const delta = direction === 'vertical' ? -35 : 35
        await move([{ x: delta, y: -35, clientX: start.clientX + delta, clientY: start.clientY - 35 }])
        await desktop.mouse.up()
        const after = await desktop.locator('[data-drag-fixture="lyric"]').evaluate(el => ({ top: el.scrollTop, left: el.scrollLeft }))
        if (direction === 'vertical') assert(Math.abs(after.left - before.left) >= 30, JSON.stringify({ before, after }))
        else assert(Math.abs(after.top - before.top) >= 30, JSON.stringify({ before, after }))
        await expectBounds(original)
      })
    }

    await t.test('toolbar dragging, lost focus, native resizing and locked input remain usable', async t => {
      t.after(() => desktop.mouse.up().catch(() => {}))
      const original = await bounds()
      await down('[data-drag-fixture="toolbar"]', { x: original.width - 20, y: 20 })
      await move([{ x: -10, y: -5 }, { x: -30, y: -15 }])
      const expected = { ...original, x: original.x - 30, y: original.y - 15 }
      await expectBounds(expected)
      await desktop.evaluate(() => window.dispatchEvent(new Event('blur')))
      await move([{ x: 200, y: 200 }])
      await desktop.mouse.up()
      await expectBounds(expected)
      assert.equal(await window.evaluate(window => window.isResizable()), true)
      const resized = { ...expected, width: expected.width + 40, height: expected.height + 30 }
      await resizeWindow(app, desktop, resized)
      await expectBounds(resized)
      assert.notEqual(await nativeHitTest(app, desktop, '[data-drag-fixture="lyric"]', { x: resized.width - 2, y: resized.height - 2 }), 1)
      await update({ 'desktopLyric.isLock': true })
      await desktop.waitForFunction(() => document.querySelector('#container').classList.contains('lock'))
      assert.equal(await nativeIgnoresMouse(app, desktop), true)
      await desktop.evaluate(() => require('electron').ipcRenderer.send('winLyric_set_win_bounds', { x: 500, y: 500, w: 680, h: 270 }))
      await desktop.evaluate(() => require('electron').ipcRenderer.invoke('winLyric_get_config'))
      await expectBounds(resized)
      await update({ 'desktopLyric.isLock': false, 'desktopLyric.direction': 'horizontal' })
      await desktop.waitForFunction(() => !document.querySelector('#container').classList.contains('lock'))
      await captureHidden(app, desktop, path.join(output, 'desktop-lyrics-drag.png'))
    })
    assert.deepEqual(errors, [])
    assert.deepEqual(fixture.errors, [])
    await fs.writeFile(path.join(output, 'drag-evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
  } finally {
    await desktop?.mouse.up().catch(() => {})
    await window?.dispose()
    await app.evaluate(({ app }) => { app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
