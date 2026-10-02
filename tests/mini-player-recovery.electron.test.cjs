const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch } = require('./helpers/motion-fixture.cjs')
const { nativeHitTest, nativeIgnoresMouse } = require('./helpers/native-window-drag.cjs')

test('transparent hidden lyrics controls recover using the system pointer without DOM hover events', { timeout: 45000 }, async t => {
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  const errors = []
  let mini
  const label = key => page.evaluate(key => window.i18n.t(key), key)
  const update = values => page.evaluate(values => window.lxData.updateSetting(values), values)
  const getMini = async() => {
    const window = app.windows().find(window => window.url().includes('lyric.html')) ?? await app.waitForEvent('window', { predicate: window => window.url().includes('lyric.html') })
    window.setDefaultTimeout(4000)
    window.on('pageerror', error => errors.push(error.message))
    await window.locator('[data-mini-player]').waitFor({ state: 'attached' })
    await window.locator('#main').waitFor()
    return window
  }
  const pointAt = async(selector) => {
    const point = typeof selector === 'string' ? await mini.locator(selector).evaluate(el => {
      const rect = el.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    }) : selector
    const window = await app.browserWindow(mini)
    try {
      const bounds = await window.evaluate(window => window.getContentBounds())
      await app.evaluate((_, { point, bounds }) => {
        global.__miniRecoveryPoint = point ? { x: bounds.x + point.x, y: bounds.y + point.y } : { x: -10000, y: -10000 }
      }, { point, bounds })
    } finally { await window.dispose() }
  }
  const options = async() => {
    await pointAt('.mini-header')
    await mini.getByRole('button', { name: await label('mini_player__options'), exact: true }).click()
    await mini.locator('#mini-options').waitFor()
  }
  const closeOptions = async() => {
    await mini.locator('#mini-options').getByRole('button', { name: await label('close'), exact: true }).click()
    await mini.locator('#mini-options').waitFor({ state: 'hidden' })
  }
  const hide = async() => {
    await pointAt(null)
    await mini.mouse.move(-20, -20)
    await mini.waitForFunction(() => getComputedStyle(document.querySelector('.mini-header')).opacity === '0')
  }
  const revealWithoutHover = async() => {
    await mini.evaluate(() => {
      window.__recoveryMoves = 0
      window.__countRecoveryMove ??= () => { window.__recoveryMoves++ }
      document.removeEventListener('mousemove', window.__countRecoveryMove)
      document.addEventListener('mousemove', window.__countRecoveryMove)
    })
    await pointAt('.mini-header')
    await mini.waitForFunction(() => getComputedStyle(document.querySelector('.mini-header')).opacity === '1' && getComputedStyle(document.querySelector('#container')).opacity === '1')
    assert.equal(await mini.evaluate(() => window.__recoveryMoves), 0, 'recovery must not depend on a renderer mouse event reaching a transparent pixel')
    if (process.platform === 'win32') assert.equal(await nativeHitTest(app, mini, '.mini-window-buttons button'), 1, 'the revealed controls accept clicks instead of dragging')
  }
  try {
    // Exercise the real main-process polling loop without moving the user's mouse.
    await app.evaluate(({ screen }) => {
      global.__miniRecoveryPoint = { x: -10000, y: -10000 }
      global.__miniRecoveryOriginalPointer = screen.getCursorScreenPoint
      screen.getCursorScreenPoint = () => global.__miniRecoveryPoint
    })
    await update({ 'desktopLyric.enable': true })
    mini = await getMini()

    await t.test('lyrics-only options appear across the window and hide outside even with menu focus', async() => {
      await options()
      for (const key of ['mini_player__transparent', 'mini_player__hide_controls', 'mini_player__lyrics_only']) await mini.getByLabel(await label(key), { exact: true }).check()
      await closeOptions()
      await hide()
      assert.equal(await mini.locator('[data-mini-track]').count(), 0)
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('#background')).opacity === '0')
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('[data-mini-recovery]')).visibility === 'hidden')
      assert.equal(await mini.locator('[data-mini-recovery]').evaluate(el => getComputedStyle(el).opacity), '0')
      assert.equal(await mini.locator('[data-mini-recovery]').evaluate(el => !!el.closest('#container')), false)
      assert.equal(await mini.locator('#container').evaluate(el => getComputedStyle(el, '::after').opacity), '0')
      const lyricsBefore = await mini.locator('[data-mini-lyrics]').boundingBox()
      await pointAt('[data-mini-lyrics]')
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('[data-mini-recovery]')).opacity === '0.85' && getComputedStyle(document.querySelector('#container'), '::after').opacity === '1')
      assert.equal(await mini.locator('.mini-header').evaluate(el => getComputedStyle(el).opacity), '0', 'the options button can appear without covering lyrics with the header')
      assert.deepEqual(await mini.locator('[data-mini-lyrics]').boundingBox(), lyricsBefore, 'hover does not move or resize lyrics')
      await mini.screenshot({ path: path.join(fixture.output, 'mini-transparent-hover.png'), omitBackground: true })
      for (const position of [{ x: 1, y: 1 }, { x: 449, y: 299 }]) {
        await pointAt(position)
        await mini.waitForFunction(() => document.querySelector('[data-mini-recovery]').classList.contains('native-window-hover'))
      }
      await pointAt('[data-mini-recovery]')
      await mini.locator('[data-mini-recovery]').waitFor({ state: 'visible' })
      if (process.platform === 'win32') assert.equal(await nativeHitTest(app, mini, '[data-mini-recovery]'), 1, 'the visible recovery button is clickable, not a drag region')
      await mini.locator('[data-mini-recovery]').click()
      await mini.locator('#mini-options').waitFor()
      assert.equal(await mini.getByRole('button', { name: await label('mini_player__options'), exact: true }).count(), 1)
      await mini.getByLabel(await label('mini_player__transparent'), { exact: true }).focus()
      await pointAt(null)
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('[data-mini-recovery]')).opacity === '0' && getComputedStyle(document.querySelector('#container'), '::after').opacity === '0')
      assert.equal(await mini.locator('[data-mini-recovery]').evaluate(el => getComputedStyle(el).pointerEvents), 'none', 'menu focus cannot pin the floating button after the pointer leaves')
      await closeOptions()
      await hide()
      await mini.screenshot({ path: path.join(fixture.output, 'mini-transparent-outside.png'), omitBackground: true })
      await options()
      for (const key of ['mini_player__lyrics_only', 'mini_player__hide_controls', 'mini_player__transparent']) await mini.getByLabel(await label(key), { exact: true }).uncheck()
      await closeOptions()
      await mini.locator('[data-mini-track]').waitFor()
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('#background')).opacity !== '0')
    })

    await t.test('transparent full players show only a subtle non-interactive outline on system hover', async() => {
      await update({ 'desktopLyric.showPlayer': true, 'desktopLyric.autoHideControls': false, 'desktopLyric.style.backgroundOpacity': 0 })
      await pointAt(null)
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('#container'), '::after').opacity === '0')
      await pointAt('[data-mini-lyrics]')
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('#container'), '::after').opacity === '1')
      const outline = await mini.locator('#container').evaluate(el => {
        const style = getComputedStyle(el, '::after')
        return { shadow: style.boxShadow, pointerEvents: style.pointerEvents, radius: style.borderRadius }
      })
      assert.match(outline.shadow, /rgba\(255, 255, 255, 0\.16\).*1px/)
      assert.equal(outline.pointerEvents, 'none', 'the outline cannot intercept controls or native dragging')
      assert.equal(outline.radius, '14px')
      await update({ 'desktopLyric.style.backgroundOpacity': 92 })
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('#container'), '::after').opacity === '0')
      await update({ 'desktopLyric.style.backgroundOpacity': 0 })
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('#container'), '::after').opacity === '1')
      await mini.emulateMedia({ reducedMotion: 'reduce' })
      assert.equal(await mini.locator('#container').evaluate(el => getComputedStyle(el, '::after').transitionDuration), '0s')
      await mini.emulateMedia({ reducedMotion: 'no-preference' })
      await update({ 'desktopLyric.style.backgroundOpacity': 92 })
    })

    await t.test('both lyric directions remain recoverable after reopening, including pause-hide and hover-hide', async() => {
      for (const direction of ['horizontal', 'vertical']) {
        await update({ 'desktopLyric.showPlayer': false, 'desktopLyric.autoHideControls': true, 'desktopLyric.style.backgroundOpacity': 0, 'desktopLyric.direction': direction, 'desktopLyric.pauseHide': true, 'desktopLyric.isHoverHide': true })
        await hide()
        await mini.waitForFunction(() => getComputedStyle(document.querySelector('[data-mini-lyrics]')).opacity === '0.7')
        assert.equal(await mini.locator('#container').evaluate(el => getComputedStyle(el).opacity), '1', 'pause fading must not also fade the container')
        await pointAt('[data-mini-lyrics]')
        await mini.waitForTimeout(250)
        assert.equal(await mini.locator('#container').evaluate(el => getComputedStyle(el).opacity), '1', 'hover-hide only applies while locked')
        assert.equal(await mini.locator('.mini-header').evaluate(el => getComputedStyle(el).opacity), '0', 'hovering the lyric body must not cover the lyrics with a toolbar')
        await revealWithoutHover()
        // Keep the system pointer over the header while a fresh renderer starts.
        const closed = mini.waitForEvent('close')
        await update({ 'desktopLyric.enable': false })
        await closed
        await update({ 'desktopLyric.enable': true })
        mini = await getMini()
        await mini.waitForFunction(() => getComputedStyle(document.querySelector('.mini-header')).opacity === '1')
        await hide()
        await revealWithoutHover()
        await options()
        await mini.getByLabel(await label('mini_player__lyrics_only'), { exact: true }).uncheck()
        await closeOptions()
        await mini.locator('[data-mini-track]').waitFor()
      }
    })

    await t.test('leaving a locked transparent window restores the lyrics even without a DOM mouseleave', async() => {
      for (const direction of ['horizontal', 'vertical']) {
        await update({ 'desktopLyric.showPlayer': false, 'desktopLyric.autoHideControls': true, 'desktopLyric.style.backgroundOpacity': 0, 'desktopLyric.isLock': true, 'desktopLyric.isHoverHide': true, 'desktopLyric.direction': direction })
        await mini.mouse.move(-20, -20)
        await pointAt('[data-mini-lyrics]')
        await mini.waitForFunction(() => getComputedStyle(document.querySelector('#container')).opacity === '0.04')
        await pointAt(null)
        await mini.waitForFunction(() => getComputedStyle(document.querySelector('#container')).opacity === '1')
        assert.equal(await mini.locator('[data-mini-lyrics]').evaluate(el => getComputedStyle(el).opacity), '0.7')
        assert.equal(await mini.locator('[data-mini-unlock]').evaluate(el => getComputedStyle(el).opacity), '0.85', 'the locked recovery button remains discoverable outside')
      }
    })

    await t.test('a locked window keeps a visible unlock button and accepts its click without DOM hover events', async() => {
      await update({ 'desktopLyric.showPlayer': false, 'desktopLyric.autoHideControls': true, 'desktopLyric.style.backgroundOpacity': 0, 'desktopLyric.isLock': true })
      await pointAt(null)
      await mini.mouse.move(-20, -20)
      await mini.locator('[data-mini-unlock]').waitFor({ state: 'attached' })
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('[data-mini-unlock]')).opacity === '0.85')
      await pointAt('[data-mini-unlock]')
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('[data-mini-unlock]')).opacity === '1')
      if (process.platform === 'win32') assert.equal(await nativeIgnoresMouse(app, mini), false)
      await mini.locator('[data-mini-unlock]').click()
      await mini.waitForFunction(() => !document.querySelector('#container').classList.contains('lock'))
      await revealWithoutHover()
      await options()
      for (const key of ['mini_player__lyrics_only', 'mini_player__hide_controls', 'mini_player__transparent']) await mini.getByLabel(await label(key), { exact: true }).uncheck()
      await closeOptions()
      await mini.locator('[data-mini-track]').waitFor()
    })
    assert.deepEqual(errors, [])
    assert.deepEqual(fixture.errors, [])
    console.log('Mini-player hover screenshots:', fixture.output)
  } finally {
    await app.evaluate(({ screen }) => {
      screen.getCursorScreenPoint = global.__miniRecoveryOriginalPointer
      delete global.__miniRecoveryOriginalPointer
      delete global.__miniRecoveryPoint
    }).catch(() => {})
    await app.close()
  }
})
