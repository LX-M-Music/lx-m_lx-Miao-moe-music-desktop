const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch } = require('./helpers/motion-fixture.cjs')
const { nativeHitTest, nativeIgnoresMouse } = require('./helpers/native-window-drag.cjs')

test('transparent hidden lyrics controls recover using the system pointer without DOM hover events', { timeout: 45000 }, async t => {
  const output = path.resolve('output/playwright/mini-player-header-options/ordinary')
  await fs.mkdir(output, { recursive: true })
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  const errors = []
  let mini
  const label = key => page.evaluate(key => window.i18n.t(key), key)
  const settingsButton = () => mini.locator('.mini-header button[aria-controls="mini-options"]')
  const titleState = async visible => {
    await mini.waitForFunction(visible => getComputedStyle(document.querySelector('.mini-header')).opacity === (visible ? '1' : '0'), visible)
    assert.equal(await mini.locator('[data-mini-recovery]').count(), 0, 'there must be no detached settings entry')
    assert.equal(await mini.getByRole('button', { name: await label('mini_player__options'), exact: true }).count(), 1)
    const state = await settingsButton().evaluate(el => {
      let opacity = 1
      for (let node = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity)
      const button = el.getBoundingClientRect()
      const header = el.closest('.mini-header').getBoundingClientRect()
      return { opacity, inside: button.left >= header.left && button.right <= header.right && button.top >= header.top && button.bottom <= header.bottom && button.left >= 0 && button.right <= innerWidth && button.bottom <= innerHeight }
    })
    assert.equal(state.inside, true, 'the settings entry stays within the title bar')
    assert.equal(state.opacity, visible ? 1 : 0, 'settings visibility follows the title bar')
  }
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
    if (process.platform === 'win32') assert.equal(await nativeHitTest(app, mini, '.mini-header button[aria-controls="mini-options"]'), 1, 'the revealed settings entry accepts clicks instead of dragging')
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

    await t.test('lyrics-only settings stay inside the title bar and reveal only with the title bar', async() => {
      await options()
      for (const key of ['mini_player__transparent', 'mini_player__hide_controls', 'mini_player__lyrics_only']) await mini.getByLabel(await label(key), { exact: true }).check()
      await closeOptions()
      await hide()
      assert.equal(await mini.locator('[data-mini-track]').count(), 0)
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('#background')).opacity === '0')
      await titleState(false)
      assert.equal(await mini.locator('#container').evaluate(el => getComputedStyle(el, '::after').opacity), '0')
      const lyricsBefore = await mini.locator('[data-mini-lyrics]').boundingBox()
      await pointAt('[data-mini-lyrics]')
      await mini.waitForFunction(() => document.querySelector('#container').classList.contains('native-window-hover'))
      await titleState(false)
      assert.deepEqual(await mini.locator('[data-mini-lyrics]').boundingBox(), lyricsBefore, 'hover does not move or resize lyrics')
      await mini.screenshot({ path: path.join(output, 'lyrics-only-body-hover.png'), omitBackground: true })
      const size = await mini.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      for (const position of [{ x: 1, y: 1 }, { x: size.width - 1, y: size.height - 1 }, { x: size.width - 6, y: 23 }]) {
        await pointAt(position)
        await mini.waitForTimeout(150)
        await titleState(false)
      }
      await revealWithoutHover()
      await titleState(true)
      await mini.screenshot({ path: path.join(output, 'lyrics-only-header-visible.png'), omitBackground: true })
      if (process.platform === 'win32') assert.equal(await nativeHitTest(app, mini, '.mini-header button[aria-controls="mini-options"]'), 1, 'the title-bar settings button is clickable, not a drag region')
      await settingsButton().click()
      await mini.locator('#mini-options').waitFor()
      assert.equal(await mini.getByRole('button', { name: await label('mini_player__options'), exact: true }).count(), 1)
      await mini.getByLabel(await label('mini_player__transparent'), { exact: true }).focus()
      await pointAt(null)
      await titleState(true)
      await closeOptions()
      await hide()
      await titleState(false)
      await mini.screenshot({ path: path.join(output, 'lyrics-only-outside.png'), omitBackground: true })
      const window = await app.browserWindow(mini)
      const bounds = await window.evaluate(window => window.getBounds())
      try {
        for (const width of [180, 120, 38]) {
          await window.evaluate((window, width) => window.setContentSize(width, 300), width)
          await mini.waitForFunction(width => Math.abs(innerWidth - width) <= 1, width)
          await revealWithoutHover()
          await titleState(true)
          await mini.screenshot({ path: path.join(output, `lyrics-only-width-${width}.png`), omitBackground: true })
          await hide()
          await titleState(false)
        }
      } finally {
        await window.evaluate((window, bounds) => window.setBounds(bounds), bounds)
        await window.dispose()
      }
      await options()
      for (const key of ['mini_player__lyrics_only', 'mini_player__hide_controls', 'mini_player__transparent']) await mini.getByLabel(await label(key), { exact: true }).uncheck()
      await closeOptions()
      await mini.locator('[data-mini-track]').waitFor()
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('#background')).opacity !== '0')
    })

    await t.test('automatically hidden player settings follow the title bar in opaque and transparent modes', async() => {
      for (const background of [92, 0]) {
        await update({ 'desktopLyric.showPlayer': true, 'desktopLyric.autoHideControls': true, 'desktopLyric.style.backgroundOpacity': background })
        await mini.waitForFunction(background => Number(getComputedStyle(document.querySelector('#background')).opacity) === background / 100, background)
        await hide()
        await titleState(false)
        await mini.screenshot({ path: path.join(output, `player-${background}-hidden.png`), omitBackground: background === 0 })
        await pointAt('[data-mini-lyrics]')
        await titleState(true)
        if (process.platform === 'win32') assert.equal(await nativeHitTest(app, mini, '.mini-header button[aria-controls="mini-options"]'), 1)
        await mini.screenshot({ path: path.join(output, `player-${background}-visible.png`), omitBackground: background === 0 })
        await options()
        await titleState(true)
        await closeOptions()
        await hide()
        await titleState(false)
      }
      await mini.keyboard.press('Tab')
      await titleState(true)
      await settingsButton().focus()
      await mini.keyboard.press('Enter')
      await mini.locator('#mini-options').waitFor()
      await mini.keyboard.press('Escape')
      await mini.locator('#mini-options').waitFor({ state: 'hidden' })
      assert.equal(await settingsButton().evaluate(el => el === document.activeElement), true, 'Escape returns focus to the title-bar settings entry')
      await titleState(true)
      await mini.locator('[data-mini-lyrics]').click()
      await hide()
      await titleState(false)
      await update({ 'desktopLyric.autoHideControls': false, 'desktopLyric.style.backgroundOpacity': 92 })
      await titleState(true)
    })

    await t.test('optional borders stay visible across system hover and background changes without intercepting controls', async() => {
      await update({ 'desktopLyric.showPlayer': true, 'desktopLyric.autoHideControls': false, 'desktopLyric.style.backgroundOpacity': 0 })
      await pointAt(null)
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('#container'), '::after').opacity === '0')
      await pointAt('[data-mini-lyrics]')
      await mini.waitForFunction(() => document.querySelector('#container').classList.contains('native-window-hover'))
      assert.equal(await mini.locator('#container').evaluate(el => getComputedStyle(el, '::after').opacity), '0', 'hover must not reveal a disabled border')
      await options()
      await mini.getByLabel(await label('setting__desktop_lyric_show_border'), { exact: true }).check()
      await closeOptions()
      await pointAt(null)
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('#container'), '::after').opacity === '1')
      const outline = await mini.locator('#container').evaluate(el => {
        const style = getComputedStyle(el, '::after')
        return { shadow: style.boxShadow, pointerEvents: style.pointerEvents, radius: style.borderRadius }
      })
      assert.match(outline.shadow, /rgba\(255, 255, 255, 0\.16\).*1px/)
      assert.equal(outline.pointerEvents, 'none', 'the outline cannot intercept controls or native dragging')
      assert.equal(outline.radius, '14px')
      await pointAt('[data-mini-lyrics]')
      await mini.waitForFunction(() => document.querySelector('#container').classList.contains('native-window-hover'))
      assert.equal(await mini.locator('#container').evaluate(el => getComputedStyle(el, '::after').opacity), '1')
      await update({ 'desktopLyric.style.backgroundOpacity': 92 })
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('#background')).opacity === '0.92' && getComputedStyle(document.querySelector('#container'), '::after').opacity === '1')
      await update({ 'desktopLyric.style.backgroundOpacity': 0 })
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('#container'), '::after').opacity === '1')
      await mini.emulateMedia({ reducedMotion: 'reduce' })
      assert.equal(await mini.locator('#container').evaluate(el => getComputedStyle(el, '::after').transitionDuration), '0s')
      await mini.emulateMedia({ reducedMotion: 'no-preference' })
      await update({ 'desktopLyric.showBorder': false, 'desktopLyric.style.backgroundOpacity': 92 })
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('#container'), '::after').opacity === '0')
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
    console.log('Mini-player hover screenshots:', output)
  } finally {
    await app.evaluate(({ screen }) => {
      screen.getCursorScreenPoint = global.__miniRecoveryOriginalPointer
      delete global.__miniRecoveryOriginalPointer
      delete global.__miniRecoveryPoint
    }).catch(() => {})
    await app.close()
  }
})
