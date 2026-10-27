const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, seedTrack, showDetail, settled, captureHidden } = require('./helpers/motion-fixture.cjs')
const { resizeWindow } = require('./helpers/native-window-drag.cjs')

const texts = ['星が光る', '道を歩こう', '明日へ向かう']
const translations = ['星光闪耀', '一起走在路上', '向着明天出发']
const romanizations = ['hoshi ga hikaru', 'michi wo arukou', 'ashita e mukau']
const timed = lines => lines.map((text, i) => `[00:0${i * 3}.000]${text}`).join('\n')
const wordTimed = timed(texts.map(text => `<0,1500>${text.slice(0, 2)}<1500,1500>${text.slice(2)}`))
const wav = Buffer.alloc(44 + 8000 * 12 * 2)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)

test('desktop toolbar translation, romanization and single-line lyrics match the detail player', { skip: process.platform !== 'win32', timeout: 180000 }, async t => {
  const fixture = await launch({ hidden: true, rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  const output = path.resolve('output/desktop-lyric-controls-20261026', process.env.LX_TEST_PROJECT ? 'win7' : 'standard')
  const errors = []
  let desktop, native
  const update = values => page.evaluate(values => window.lxData.updateSetting(values), values)
  const label = key => page.evaluate(key => window.i18n.t(key), key)
  const button = action => desktop.locator(`[data-desktop-lyric-action="${action}"]`)
  const setLyrics = values => page.evaluate(values => { Object.assign(window.lxData.musicInfo, values); window.app_event.lyricUpdated() }, values)
  const openDetailMenu = async() => {
    await page.locator('[data-player-detail] .lyric').dispatchEvent('contextmenu', { pageX: 820, pageY: 300, clientX: 820, clientY: 300 })
    await page.getByRole('button', { name: await label('lyric_menu__translation'), exact: true }).waitFor()
  }
  const detailButton = async key => page.getByRole('button', { name: await label('lyric_menu__' + key), exact: true })
  const seek = async index => {
    await page.evaluate(seconds => window.app_event.setProgress(seconds), index * 3 + 0.7)
    await desktop.waitForFunction(text => document.querySelector('.line-content.active')?.textContent.includes(text), texts[index])
  }
  const assertGroup = async index => {
    await desktop.waitForFunction(expected => {
      const groups = document.querySelectorAll('.line-content')
      return groups.length === 1 && expected.every(text => groups[0].textContent.includes(text))
    }, [texts[index], translations[index], romanizations[index]])
    const group = await desktop.locator('.line-content').textContent()
    assert(group.includes(texts[index]), group)
    assert(group.includes(translations[index]), group)
    assert(group.includes(romanizations[index]), group)
    for (let i = 0; i < texts.length; i++) if (i !== index) assert(!group.includes(texts[i]), group)
    assert.equal(await desktop.locator('.line-content > .extended').count(), 2)
    assert.equal(await desktop.locator('[data-desktop-lyric-single-line]').count(), 1)
    assert.equal(await desktop.locator('[data-desktop-lyric-single-line][title]').count(), 0)
  }
  try {
    await fs.mkdir(output, { recursive: true })
    await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = () => ({ x: -10000, y: -10000 }) })
    await seedTrack(page)
    await update({
      'player.isShowLyricTranslation': false, 'player.isShowLyricRoma': false, 'player.isPlayLxlrc': true,
      'player.isSwapLyricTranslationAndRoma': false,
      'desktopLyric.isSingleLine': false, 'desktopLyric.isLock': false, 'desktopLyric.pauseHide': false,
      'desktopLyric.isHoverHide': false, 'desktopLyric.isDelayScroll': true,
      'desktopLyric.width': 680, 'desktopLyric.height': 300, 'desktopLyric.x': 180, 'desktopLyric.y': 160,
      'desktopLyric.style.fontSize': 32, 'desktopLyric.style.isZoomActiveLrc': true,
    })
    await setLyrics({ lrc: timed(texts), tlrc: '', rlrc: '', lxlrc: wordTimed })
    await page.evaluate(async source => {
      const player = window.__lxPluginHost.player
      player.getAudioElement().muted = true
      window.lx.isPlayedStop = false
      player.setResource(source)
      await player.getAudioElement().play()
      player.getAudioElement().pause()
    }, 'data:audio/wav;base64,' + wav.toString('base64'))
    await showDetail(page, true)
    await settled(page)
    await update({ 'desktopLyric.enable': true })
    const matches = p => p.url().includes('lyric.html') && !p.url().includes('mini=true')
    desktop = app.windows().find(matches) ?? await app.waitForEvent('window', { predicate: matches })
    desktop.on('pageerror', error => errors.push(error.message))
    desktop.setDefaultTimeout(8000)
    await desktop.locator('.font-lrc').first().waitFor()
    native = await app.browserWindow(desktop)
    await native.evaluate(window => window.webContents.setBackgroundThrottling(false))
    await seek(0)

    await t.test('all three icons are visible and unsupported extended lyrics are disabled like the detail menu', async() => {
      await desktop.mouse.move(350, 20)
      assert.equal(await desktop.locator('[data-desktop-lyric-action]').count(), 3)
      for (const action of ['translation', 'romanization', 'single-line']) {
        const rect = await button(action).boundingBox()
        assert(rect.width >= 32 && rect.height >= 32)
        assert.equal(await button(action).isVisible(), true)
        const icon = await button(action).locator('svg use').evaluate(use => { const rect = use.getBBox(); return { width: rect.width, height: rect.height } })
        assert(icon.width > 8 && icon.height > 6, JSON.stringify(icon))
      }
      assert.equal(await button('translation').isDisabled(), true)
      assert.equal(await button('romanization').isDisabled(), true)
      await openDetailMenu()
      assert.equal(await (await detailButton('translation')).isDisabled(), true)
      assert.equal(await (await detailButton('romanization')).isDisabled(), true)
      await button('translation').dispatchEvent('click')
      assert.equal(await page.evaluate(() => window.lxData.appSetting['player.isShowLyricTranslation']), false)
      await captureHidden(app, desktop, path.join(output, 'toolbar-unsupported.png'))
    })

    await t.test('desktop and detail toggles synchronize both ways and preserve the configured row order', async() => {
      await setLyrics({ tlrc: timed(translations), rlrc: timed(romanizations) })
      await desktop.waitForFunction(() => !document.querySelector('[data-desktop-lyric-action="translation"]').disabled && !document.querySelector('[data-desktop-lyric-action="romanization"]').disabled)
      await openDetailMenu()
      await button('translation').click()
      await page.waitForFunction(() => window.lxData.appSetting['player.isShowLyricTranslation'])
      assert.equal(await (await detailButton('translation')).getAttribute('aria-pressed'), 'true')
      await (await detailButton('romanization')).click()
      await desktop.waitForFunction(() => document.querySelector('[data-desktop-lyric-action="romanization"]').getAttribute('aria-pressed') === 'true')
      await seek(1)
      const extended = () => desktop.locator('.line-content.active > .extended .font-lrc').allTextContents()
      assert.deepEqual(await extended(), [romanizations[1], translations[1]])
      await update({ 'player.isSwapLyricTranslationAndRoma': true })
      await desktop.waitForFunction(text => document.querySelector('.line-content.active > .extended')?.textContent.includes(text), translations[1])
      assert.deepEqual(await extended(), [translations[1], romanizations[1]])
      await button('translation').click()
      await page.waitForFunction(() => !window.lxData.appSetting['player.isShowLyricTranslation'])
      assert.equal(await (await detailButton('translation')).getAttribute('aria-pressed'), 'false')
      await (await detailButton('translation')).click()
      await desktop.waitForFunction(() => document.querySelector('[data-desktop-lyric-action="translation"]').getAttribute('aria-pressed') === 'true')
      await captureHidden(app, desktop, path.join(output, 'toolbar-enabled.png'))
    })

    await t.test('single-line mode retains only the current original node, both extended rows and word progress', async() => {
      await button('single-line').click()
      await assertGroup(1)
      await desktop.evaluate(() => { window.__currentNativeLyric = document.querySelector('.line-content') })
      const progress = () => desktop.locator('.line-content > .line > .font-lrc > span').first().evaluate(el => getComputedStyle(el).backgroundSize)
      const before = await progress()
      await page.evaluate(() => window.app_event.setProgress(4.1))
      await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().play())
      await desktop.waitForFunction(before => {
        const span = document.querySelector('.line-content > .line > .font-lrc > span')
        return span && getComputedStyle(span).backgroundSize !== before
      }, before, { polling: 50 })
      const after = await progress()
      await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().pause())
      assert.notEqual(after, before, JSON.stringify({ before, after }))
      assert.equal(await desktop.evaluate(() => window.__currentNativeLyric === document.querySelector('.line-content')), true)
      await seek(2)
      await assertGroup(2)
      assert.equal(await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().paused), true)
      await captureHidden(app, desktop, path.join(output, 'single-line-horizontal.png'))
      await button('single-line').click()
      await desktop.waitForFunction(() => document.querySelectorAll('.line-content').length === 3)
      await button('single-line').click()
      await assertGroup(2)
    })

    await t.test('single-line original, translation and romanization fit short windows and vertical layout', async() => {
      await seek(2)
      const original = await native.evaluate(window => window.getBounds())
      await resizeWindow(app, desktop, { ...original, width: 450, height: 90 })
      await desktop.mouse.move(-20, -20)
      await assertGroup(2)
      const geometry = await desktop.locator('[data-desktop-lyric-single-line]').evaluate(view => {
        const outer = view.getBoundingClientRect()
        return Array.from(view.querySelectorAll('.line-content .font-lrc')).map(el => { const r = el.getBoundingClientRect(); return { top: r.top - outer.top, bottom: r.bottom - outer.top, max: outer.height } })
      })
      for (const row of geometry) assert(row.top >= -2 && row.bottom <= row.max + 2, JSON.stringify(geometry))
      await desktop.waitForFunction(() => Number(getComputedStyle(document.querySelector('.control-bar')).opacity) < 0.01)
      await captureHidden(app, desktop, path.join(output, 'single-line-short-window.png'))
      await resizeWindow(app, desktop, { ...original, width: 680, height: 300 })
      await desktop.waitForFunction(() => innerWidth >= 679 && innerHeight >= 299)
      await update({ 'desktopLyric.direction': 'vertical' })
      await desktop.waitForFunction(() => getComputedStyle(document.querySelector('.line-content')).writingMode === 'vertical-rl')
      await assertGroup(2)
      const vertical = await desktop.locator('.line-content > .line > .font-lrc').evaluate(el => {
        const rect = el.getBoundingClientRect()
        return { writingMode: getComputedStyle(el).writingMode, width: rect.width, height: rect.height }
      })
      assert.equal(vertical.writingMode, 'vertical-rl')
      assert(vertical.height > vertical.width * 2, JSON.stringify(vertical))
      await fs.writeFile(path.join(output, 'vertical-geometry.json'), JSON.stringify(vertical, null, 2) + '\n')
      await captureHidden(app, desktop, path.join(output, 'single-line-vertical.png'))
      await update({ 'desktopLyric.direction': 'horizontal' })
    })

    await t.test('a song without extended lyrics disables the buttons while preserving preferences and single-line mode', async() => {
      await setLyrics({ tlrc: '', rlrc: '' })
      await desktop.waitForFunction(() => document.querySelector('[data-desktop-lyric-action="translation"]').disabled && document.querySelector('[data-desktop-lyric-action="romanization"]').disabled)
      await openDetailMenu()
      assert.equal(await (await detailButton('translation')).isDisabled(), true)
      assert.equal(await (await detailButton('romanization')).isDisabled(), true)
      assert.equal(await button('translation').getAttribute('aria-pressed'), 'true')
      assert.equal(await button('romanization').getAttribute('aria-pressed'), 'true')
      assert.equal(await desktop.locator('.line-content > .extended').count(), 0)
      assert.equal(await desktop.locator('.line-content').count(), 1)
      await setLyrics({ tlrc: timed(translations), rlrc: timed(romanizations) })
      await assertGroup(2)
      await update({ 'miniPlayer.enable': true })
      const miniMatches = p => p.url().includes('mini=true')
      const mini = app.windows().find(miniMatches) ?? await app.waitForEvent('window', { predicate: miniMatches })
      await mini.locator('[data-mini-player]').waitFor()
      assert.equal(await mini.locator('.font-lrc, [data-desktop-lyric-action], [data-desktop-lyric-single-line]').count(), 0)
      assert.equal(await page.evaluate(() => window.lxData.appSetting['desktopLyric.isSingleLine']), true)
    })
    assert.deepEqual(errors, [])
    assert.deepEqual(fixture.errors, [])
  } finally {
    await native?.dispose()
    await app.evaluate(({ app }) => { app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
