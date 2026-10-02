const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, seedTrack } = require('./helpers/motion-fixture.cjs')
const { dragWindow, nativeHitTest } = require('./helpers/native-window-drag.cjs')

test('offscreen lyrics cannot disable the mini-player title bar', { skip: process.platform !== 'win32', timeout: 90000 }, async t => {
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const { app, page, output } = fixture
  const errors = []
  let window
  try {
    await app.evaluate(({ screen }) => {
      global.__miniPointer = { x: -10000, y: -10000 }
      screen.getCursorScreenPoint = () => global.__miniPointer
    })
    await seedTrack(page)
    await page.evaluate(() => {
      window.lxData.musicInfo.lrc = Array.from({ length: 30 }, (_, i) => `[00:${String(i).padStart(2, '0')}.00]迷你播放器标题栏拖动测试一二三四五六七八九十第${i + 1}句`).join('\n')
      window.app_event.lyricUpdated()
      window.lxData.updateSetting({
        'desktopLyric.enable': true,
        'desktopLyric.isLock': false,
        'desktopLyric.isAlwaysOnTop': false,
        'desktopLyric.direction': 'horizontal',
        'desktopLyric.width': 450,
        'desktopLyric.height': 300,
        'desktopLyric.x': 140,
        'desktopLyric.y': 140,
      })
    })
    const mini = app.windows().find(window => window.url().includes('lyric.html')) ?? await app.waitForEvent('window', { predicate: window => window.url().includes('lyric.html') })
    mini.setDefaultTimeout(7000)
    mini.on('pageerror', error => errors.push(error.message))
    await mini.locator('.font-lrc').first().waitFor()
    window = await app.browserWindow(mini)
    for (const mode of [
      { name: 'normal player', showPlayer: true, autoHide: false, background: 92 },
      { name: 'automatically hidden controls', showPlayer: true, autoHide: true, background: 92 },
      { name: 'transparent lyrics only', showPlayer: false, autoHide: true, background: 0 },
    ]) {
      await t.test(mode.name, async() => {
        await page.evaluate(mode => window.lxData.updateSetting({
          'desktopLyric.showPlayer': mode.showPlayer,
          'desktopLyric.autoHideControls': mode.autoHide,
          'desktopLyric.style.backgroundOpacity': mode.background,
        }), mode)
        await mini.waitForFunction(showPlayer => document.querySelector('[data-mini-lyrics]').classList.contains('with-player') === showPlayer, mode.showPlayer)
        await mini.mouse.move(90, 20)
        await mini.waitForFunction(() => getComputedStyle(document.querySelector('.mini-header')).opacity === '1')
        // Move a wrapped lyric beyond the clipped viewport onto the header's
        // coordinates. Its native no-drag region used to disable this caption.
        await mini.locator('[data-mini-lyrics] > div').evaluate(el => {
          const font = el.querySelector('.font-lrc').getBoundingClientRect()
          const brand = document.querySelector('.mini-brand').getBoundingClientRect()
          el.scrollTop += font.y - brand.y
        })
        await mini.waitForTimeout(350)
        assert.equal(await nativeHitTest(app, mini, '.mini-brand'), 2, 'the title remains a native caption after lyrics scroll above it')
        assert.equal(await nativeHitTest(app, mini, '.mini-brand span'), 2, 'the title text remains draggable too')
        if (mode.showPlayer) assert.equal(await nativeHitTest(app, mini, '.mini-track-info h1'), 2, 'song information remains draggable')
        assert.equal(await nativeHitTest(app, mini, '.mini-window-buttons button'), 1, 'window controls remain clickable')
        if (mode.showPlayer) assert.equal(await nativeHitTest(app, mini, '.mini-progress input'), 1, 'the progress slider remains clickable')
        const movement = await dragWindow(app, mini, '.mini-brand', { dx: 40, dy: 20 })
        assert.equal(movement.x, 40)
        assert.equal(movement.y, 20)
        assert.deepEqual([movement.width, movement.height], [movement.expectedWidth, movement.expectedHeight], 'title dragging does not resize the window')
        const moved = await window.evaluate(window => window.getBounds())
        await page.waitForFunction(bounds => window.lxData.appSetting['desktopLyric.x'] === bounds.x && window.lxData.appSetting['desktopLyric.y'] === bounds.y, moved)
        const optionsLabel = await page.evaluate(() => window.i18n.t('mini_player__options'))
        if (!mode.showPlayer) {
          const bounds = await window.evaluate(window => window.getContentBounds())
          await app.evaluate((_, bounds) => { global.__miniPointer = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } }, bounds)
        }
        await mini.getByRole('button', { name: optionsLabel, exact: true }).click()
        await mini.locator('#mini-options').waitFor()
        assert.equal(await nativeHitTest(app, mini, '#mini-options label'), 1, 'the options overlay still excludes native dragging')
        const closeLabel = await page.evaluate(() => window.i18n.t('close'))
        await mini.locator('#mini-options').getByRole('button', { name: closeLabel, exact: true }).click()
        await mini.locator('#mini-options').waitFor({ state: 'hidden' })
        await app.evaluate(() => { global.__miniPointer = { x: -10000, y: -10000 } })
        if (mode.autoHide) {
          await mini.mouse.move(-20, -20)
          await mini.waitForFunction(() => getComputedStyle(document.querySelector('.mini-header')).opacity === '0')
          assert.notEqual(await nativeHitTest(app, mini, '.mini-brand'), 2, 'a hidden header must not intercept the lyrics')
        }
        if (!mode.autoHide) await mini.screenshot({ path: path.join(output, 'mini-title-drag.png') })
      })
    }
    await page.evaluate(() => window.lxData.updateSetting({ 'desktopLyric.isLock': true }))
    await mini.waitForFunction(() => document.querySelector('#container').classList.contains('lock'))
    assert.notEqual(await nativeHitTest(app, mini, '.mini-brand'), 2, 'locking still disables title dragging')
    assert.deepEqual(errors, [])
    assert.deepEqual(fixture.errors, [])
  } finally {
    await window?.dispose()
    await app.close()
  }
})
