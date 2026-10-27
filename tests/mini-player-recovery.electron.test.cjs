const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch } = require('./helpers/motion-fixture.cjs')
const { nativeIgnoresMouse } = require('./helpers/native-window-drag.cjs')

test('transparent mini controls recover from the system pointer; lock remains click-through with a working unlock button', { timeout: 45000 }, async() => {
  const fixture = await launch({ hidden: true, rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  let mini
  try {
    await app.evaluate(({ screen }) => { global.__miniPointer = { x: -10000, y: -10000 }; screen.getCursorScreenPoint = () => global.__miniPointer })
    await page.evaluate(() => window.lxData.updateSetting({ 'miniPlayer.enable': true, 'miniPlayer.backgroundOpacity': 0, 'miniPlayer.autoHideControls': true }))
    mini = app.windows().find(p => p.url().includes('mini=true')) ?? await app.waitForEvent('window', { predicate: p => p.url().includes('mini=true') })
    mini.setDefaultTimeout(5000)
    await mini.locator('[data-mini-player]').waitFor()
    const pointAt = async selector => {
      const window = await app.browserWindow(mini)
      try {
        const bounds = await window.evaluate(window => window.getContentBounds())
        const point = selector ? await mini.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }) : null
        await app.evaluate((_, { bounds, point }) => { global.__miniPointer = point ? { x: bounds.x + point.x, y: bounds.y + point.y } : { x: -10000, y: -10000 } }, { bounds, point })
      } finally { await window.dispose() }
    }
    await mini.mouse.move(-20, -20)
    await mini.waitForFunction(() => getComputedStyle(document.querySelector('.mini-header')).opacity === '0')
    await mini.evaluate(() => { window.__moveCount = 0; document.addEventListener('mousemove', () => window.__moveCount++) })
    await pointAt('.mini-header')
    await mini.waitForFunction(() => getComputedStyle(document.querySelector('.mini-header')).opacity === '1')
    assert.equal(await mini.evaluate(() => window.__moveCount), 0)
    await mini.locator('.mini-header button[aria-controls="mini-options"]').click()
    await mini.locator('#mini-options').waitFor()
    assert.doesNotMatch(await mini.locator('#mini-options').innerText(), /歌词|歌詞|lyric/i)
    await mini.locator('.mini-lock-button button').click()
    await mini.waitForFunction(() => document.querySelector('#container').classList.contains('lock'))
    await pointAt('.mini-track')
    if (process.platform === 'win32') {
      await mini.waitForTimeout(160)
      assert.equal(await nativeIgnoresMouse(app, mini), true)
    }
    await pointAt('[data-mini-unlock]')
    if (process.platform === 'win32') {
      await mini.waitForTimeout(160)
      assert.equal(await nativeIgnoresMouse(app, mini), false)
    }
    await mini.locator('[data-mini-unlock]').click()
    await mini.waitForFunction(() => !document.querySelector('#container').classList.contains('lock'))
    await page.waitForFunction(() => !window.lxData.appSetting['miniPlayer.isLock'])
    assert.equal(await mini.locator('[data-mini-track]').count(), 1)
    assert.equal(await mini.locator('[data-mini-lyrics], .font-lrc').count(), 0)
    assert.deepEqual(fixture.errors, [])
  } finally { await app.close() }
})
