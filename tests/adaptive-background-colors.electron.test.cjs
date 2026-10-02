const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled, seedTrack, seedLyrics, showDetail } = require('./helpers/motion-fixture.cjs')
const { compositeBackgrounds, contrastRatio, mixColor, parseColor } = require('./helpers/load-typescript.cjs')()('src/renderer/utils/kawarpBackground/contrast.ts')
const themes = require('../src/common/theme/index.json')
const options = { rendererPath: path.resolve('dist/index.html'), disableHardwareAcceleration: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-backgrounding-occluded-windows'] }
const background = '[data-ambient-background="shared"]'
const flag = '#root[data-ambient-controls]'
const settingKey = 'ui.ambientBackgroundAutoContrast'
const update = (page, values) => page.evaluate(values => window.lxData.updateSetting(values), values)
const colorState = page => page.locator('#root').evaluate(root => {
  const styles = getComputedStyle(root)
  return Object.fromEntries(['color-primary', 'color-button-font', 'color-font', 'color-font-label', 'color-hover', 'color-selected', 'color-content-background', 'ambient-reading-surface', 'adaptive-selection-text', 'adaptive-selection-background'].map(key => [key, styles.getPropertyValue('--' + key).trim()]))
})
const theme = async(page, id) => {
  const value = themes.find(value => value.id === id)
  await page.evaluate(colors => window.setTheme(colors), { ...value.config.themeColors, ...value.config.extInfo })
  await page.waitForFunction(id => document.querySelector('#root').dataset.ambientControls === (id === 'black' ? 'dark' : 'light'), id)
}
const cover = async(page, value) => {
  const previous = await page.locator(background + ' > div > div').first().getAttribute('style')
  await page.evaluate(value => {
    const image = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${value}"/></svg>`
    window.lxData.musicInfo.pic = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(image)
  }, value)
  await page.waitForFunction(({ background, previous }) => document.querySelector(background + ' > div > div').getAttribute('style') !== previous, { background, previous })
  await page.waitForFunction(background => document.querySelector(background).dataset.ambientState === 'static', background)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.locator(background + ' > div').evaluate(element => element.style.opacity), '1')
}

// Inspect actual DOM colors (including hover/selection surfaces and inherited opacity),
// against samples from the shared WebGL output and the original theme surface.
const audit = async(page, selector, minimumContrast = 4.5) => {
  const result = await page.evaluate(({ selector, background }) => {
    const root = document.querySelector(background)
    const canvas = root.querySelector('canvas')
    const sampler = document.createElement('canvas')
    sampler.width = 24
    sampler.height = 16
    const context = sampler.getContext('2d')
    context.drawImage(canvas, 0, 0, 24, 16)
    const pixels = Array.from(context.getImageData(0, 0, 24, 16).data)
    const frame = root.getBoundingClientRect()
    const elements = Array.from(document.querySelectorAll(selector)).filter(element => {
      const rect = element.getBoundingClientRect()
      return rect.width && rect.height && !element.closest('[disabled], [aria-disabled="true"], [inert], [aria-hidden="true"]') && getComputedStyle(element).visibility !== 'hidden'
    }).map(element => {
      const foreground = element.querySelector('svg') ?? element
      const stack = []
      let opacity = 1
      for (let current = foreground; current && current.id !== 'container' && current.id !== 'root'; current = current.parentElement) {
        const style = getComputedStyle(current)
        stack.unshift(style.backgroundColor)
        opacity *= Number(style.opacity)
      }
      const rect = element.getBoundingClientRect()
      const area = [
        Math.max(0, Math.min(23, Math.floor((rect.left - frame.left) / frame.width * 24))),
        Math.max(0, Math.min(23, Math.floor((rect.right - frame.left) / frame.width * 24))),
        Math.max(0, Math.min(15, Math.floor((rect.top - frame.top) / frame.height * 16))),
        Math.max(0, Math.min(15, Math.floor((rect.bottom - frame.top) / frame.height * 16))),
      ]
      return { label: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 32) || element.tagName, color: getComputedStyle(foreground).color, stack, opacity, area }
    }).filter(element => element.opacity > 0.1)
    return { elements, pixels, opacity: Number(getComputedStyle(root).opacity) * Number(root.firstElementChild.style.opacity), base: getComputedStyle(root).getPropertyValue('--ambient-surface-color').trim() || getComputedStyle(document.documentElement).getPropertyValue('--color-surface') }
  }, { selector, background })
  const pixels = result.pixels.reduce((pixels, value, index) => { if (index % 4 === 0) pixels.push(result.pixels.slice(index, index + 3)); return pixels }, [])
  const failures = []
  for (const element of result.elements) {
    // Check the actual area under this control, not an unrelated corner of the
    // window: different regions intentionally have different foreground colors.
    const [left, right, top, bottom] = element.area
    const samples = []
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) samples.push(pixels[y * 24 + x])
    const backgrounds = compositeBackgrounds(samples, parseColor(result.base), result.opacity)
    const foreground = parseColor(element.color)
    const ratios = backgrounds.map(background => {
      for (const layer of element.stack) {
        const color = parseColor(layer)
        background = mixColor(background, color.slice(0, 3), color[3])
      }
      return contrastRatio(mixColor(background, foreground.slice(0, 3), foreground[3] * element.opacity), background)
    })
    if (Math.min(...ratios) < minimumContrast) failures.push({ ...element, ratio: Math.min(...ratios) })
  }
  assert.deepEqual(failures, [], `visible text retains at least ${minimumContrast}:1 contrast`)
  return result.elements.length
}

test('adaptive background colors cover app controls and selections, restore themes and persist', { timeout: 180000 }, async t => {
  let fixture = await launch(options)
  let { app, page } = fixture
  const { output } = fixture
  page.setDefaultTimeout(10000)
  const label = key => page.evaluate(key => window.i18n.t(key), key)
  const advanced = async() => {
    await showDetail(page, false)
    await route(page, '/setting?name=SettingAdvanced')
    await settled(page)
    await page.getByRole('tab', { name: await label('setting__advanced'), exact: true }).click()
    await page.locator('label[for="setting_advanced_background_auto_contrast"]').waitFor()
  }
  try {
    await update(page, { 'common.langId': 'zh-cn', 'common.isShowAnimation': false, 'ui.ambientBackgroundQuality': 'static', 'list.actionButtonsVisible': true, 'list.loadingMode': 'immediate', 'download.enable': true })
    await page.evaluate(() => {
      window.__adaptiveSamples = 0
      const read = CanvasRenderingContext2D.prototype.getImageData
      CanvasRenderingContext2D.prototype.getImageData = function(...args) {
        if (this.canvas.width === 24 && this.canvas.height === 16) window.__adaptiveSamples++
        return read.apply(this, args)
      }
      window.__originalBackground = document.querySelector('[data-ambient-background] canvas')
    })
    await seedTrack(page)
    await advanced()
    const original = await colorState(page)
    await t.test('the opt-in checkbox overrides colors without replacing the shared background', async() => {
      assert.equal(await page.locator('#setting_advanced_background_auto_contrast').isChecked(), false)
      assert.equal(await page.locator(flag).count(), 0)
      assert.equal(await page.evaluate(() => window.__adaptiveSamples), 0)
      await page.locator('label[for="setting_advanced_background_auto_contrast"]').click()
      await page.locator(flag).waitFor()
      assert.notDeepEqual(await colorState(page), original)
      assert.equal(await page.locator(background + ' canvas').count(), 1)
      assert.equal(await page.locator(background + ' canvas').evaluate(canvas => canvas === window.__originalBackground), true)
      await page.locator('label[for="setting_advanced_background_auto_contrast"] [role="checkbox"]').hover()
      assert.equal(await page.locator('label[for="setting_advanced_background_auto_contrast"] svg').evaluate(svg => getComputedStyle(svg).zIndex), '1')
      assert(await audit(page, '#view [role="checkbox"], #view select, #left [role="tab"], #player button, #toolbar button') > 12)
      const panels = await page.evaluate(() => ['#left', '#toolbar', '#view > [data-motion-outlet]', '#player'].map(selector => {
        const style = getComputedStyle(document.querySelector(selector))
        return { surface: style.backgroundColor, body: style.getPropertyValue('--color-font'), label: style.getPropertyValue('--color-font-label') }
      }))
      for (const panel of panels) {
        const alpha = parseColor(panel.surface)[3]
        assert(alpha > 0 && alpha <= 0.2, 'reading surfaces stay subtle rather than hiding artwork')
        assert(panel.body.trim() && panel.label.trim(), 'plain text and labels inherit adaptive colors')
      }
      assert(await audit(page, '#view h3, #view .setting-label > span, #view .setting-value, #view label[for="setting_advanced_background_quality"]') > 3)
      assert(await page.locator('#view input').first().evaluate(input => getComputedStyle(input, '::placeholder').opacity === '1'))
      await page.screenshot({ path: path.join(output, 'adaptive-settings.png') })
    })
    await t.test('turning it off restores every overridden color exactly', async() => {
      await update(page, { [settingKey]: false })
      await page.locator(flag).waitFor({ state: 'detached' })
      assert.deepEqual(await colorState(page), original)
      assert.equal(await page.locator('[data-ambient-zone]').count(), 0)
      assert.equal(await page.locator('#root').evaluate(root => root.style.getPropertyValue('--ambient-reading-surface')), '')
      const before = await page.evaluate(() => window.__adaptiveSamples)
      await cover(page, '#2346ee')
      assert.equal(await page.evaluate(() => window.__adaptiveSamples), before)
      await update(page, { [settingKey]: true })
      await page.locator(flag).waitFor()
    })
    await route(page, '/list?id=love')
    await settled(page)
    await page.evaluate(() => {
      const component = window.__motionComponents().find(c => c.type.name === 'MusicList' && 'list' in c.setupState)
      component.setupState.assertApiSupport = source => source === 'wy'
      component.setupState.list = Array.from({ length: 12 }, (_, i) => ({
        id: 'adaptive-' + i, source: 'wy', name: ['晚风与海', 'Color Your Night', '沿途的光', 'Blue Hour'][i % 4], singer: 'LX-M Music', interval: '03:40',
        meta: { picUrl: window.lxData.musicInfo.pic, albumName: 'Evening Tide', songId: String(i), qualitys: [], _qualitys: {} },
      }))
    })
    await page.locator('#view [data-music-cell="name"]').first().waitFor()
    await page.locator('#view .list-item').nth(1).click()
    await t.test('light/dark themes and extreme cover colors keep list, sidebar, toolbar, footer and selected rows readable', async() => {
      for (const id of ['green', 'black']) {
        await theme(page, id)
        for (const color of ['#030508', '#fcfafa', '#ed3040', '#204ee8']) {
          await cover(page, color)
          assert(await audit(page, '#view .list-item button, #view .list-item.active .select, #left [role="tab"], #player button, #toolbar button') > 20)
          assert(await audit(page, '#view [data-music-cell="name"] > span, #view [data-music-cell="singer"] > span, #view [data-music-cell="album"] > span, #view [data-music-cell="time"] > span, #view [data-music-cell="index"] .num') > 20)
          assert(await page.locator('#view .label-source').first().evaluate(element => getComputedStyle(element).opacity === '1'))
        }
        await page.screenshot({ path: path.join(output, `adaptive-list-${id}.png`) })
      }
    })
    await t.test('queue, context menu and add-to-list modal inherit the same palette', async() => {
      await seedTrack(page)
      await page.locator('#player').getByRole('button', { name: await label('player__play_list'), exact: true }).click()
      await page.getByRole('button', { name: await label('player__play_list_clear'), exact: true }).waitFor()
      assert(await audit(page, '#root > div button') > 3)
      await page.screenshot({ path: path.join(output, 'adaptive-queue.png') })
      await page.locator('#player').getByRole('button', { name: await label('player__play_list'), exact: true }).click()
      await page.locator('#view .list-item').first().click({ button: 'right' })
      await page.locator('#root > [role="toolbar"][aria-hidden="false"]').waitFor()
      assert(await audit(page, '#root > [role="toolbar"][aria-hidden="false"] [role="tab"]') > 3)
      await page.keyboard.press('Escape')
      await page.locator('#view .list-item').first().getByRole('button', { name: await label('list__add_to'), exact: true }).click()
      await page.locator('#view header button').last().waitFor()
      assert(await audit(page, '#view header button, #view [data-motion-button]') > 0)
      assert(await page.getByRole('button', { name: await label('lists__new_list_btn'), exact: true }).evaluateAll(elements => elements.length > 0 && elements.every(element => getComputedStyle(element).opacity === '1')))
      await page.screenshot({ path: path.join(output, 'adaptive-modal.png') })
      await page.locator('#view header').getByRole('button', { name: await label('close'), exact: true }).click()
    })
    await t.test('lyrics and real text selections stay legible using the existing shared canvas', async() => {
      await seedTrack(page)
      await cover(page, '#eabe55')
      await showDetail(page, true)
      await settled(page)
      await seedLyrics(page)
      assert(await audit(page, '[data-player-detail] button, [data-player-detail] .line-content.active .font-lrc') > 5)
      // Surrounding rows are deliberately subdued; active lyrics and controls keep the full contrast requirement.
      assert(await audit(page, '[data-player-detail] .line-content:not(.active) .font-lrc', 3) > 0)
      assert(await audit(page, '[data-player-detail] [data-detail-part="info"] p, [data-player-detail] [data-detail-part="controls"] span') > 3)
      assert(await page.locator('[data-detail-part="info"]').evaluate(element => getComputedStyle(element).backgroundImage.includes('gradient')))
      const colors = await page.locator('[data-player-detail] .font-lrc').first().evaluate(element => {
        const selection = getSelection()
        const range = document.createRange()
        range.selectNodeContents(element)
        selection.removeAllRanges()
        selection.addRange(range)
        const style = getComputedStyle(element, '::selection')
        return [style.webkitTextFillColor, style.backgroundColor]
      })
      assert(contrastRatio(...colors.map(color => parseColor(color).slice(0, 3))) >= 4.5)
      await page.screenshot({ path: path.join(output, 'adaptive-lyrics.png') })
      await page.evaluate(() => getSelection().removeAllRanges())
      assert.equal(await page.locator(background + ' canvas').evaluate(canvas => canvas === window.__originalBackground), true)
      await showDetail(page, false)
      await settled(page)
    })
    await t.test('downloads, settings search and input selections use adaptive foregrounds', async() => {
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('winMain_download_list_get')
        ipcMain.handle('winMain_download_list_get', () => [{
          id: 'adaptive-download', isComplate: true, status: 'completed', progress: 100, statusText: '已完成',
          metadata: { filePath: '', fileName: '预览.mp3', quality: '128k', listId: 'default', musicInfo: { id: 'adaptive-download', name: '下载歌曲预览', singer: 'LX-M Music', source: 'local', interval: '03:40', meta: { albumName: '', picUrl: '' } } },
        }])
      })
      await route(page, '/download')
      await settled(page)
      await page.locator('.list-item').first().waitFor()
      assert(await audit(page, '#view .list-item button, #view [role="tab"], #view .select') > 5)
      await page.screenshot({ path: path.join(output, 'adaptive-downloads.png') })
      await advanced()
      const search = page.getByRole('textbox', { name: await label('setting__filter_placeholder'), exact: true })
      await search.fill('按钮颜色')
      await page.locator('label[for="setting_advanced_background_auto_contrast"]').waitFor()
      await search.selectText()
      const selection = await search.evaluate(input => {
        const style = getComputedStyle(input, '::selection')
        return [style.color, style.backgroundColor]
      })
      assert(contrastRatio(...selection.map(color => parseColor(color).slice(0, 3))) >= 4.5)
      assert(await audit(page, '#view input, #view [role="checkbox"], #view select') > 2)
      await search.fill('')
    })
    await t.test('search, song-list and leaderboard navigation retain readable active tabs and buttons', async() => {
      for (const url of ['/search', '/songList/list', '/leaderboard']) {
        await route(page, url)
        await settled(page)
        assert(await audit(page, '#view [role="tab"], #view button, #toolbar button, #left [role="tab"]') > 5)
      }
      await advanced()
    })
    await t.test('playing samples the existing frames at a bounded rate, updates during cover fades and stops after pause', async() => {
      await theme(page, 'green')
      await seedTrack(page)
      await page.evaluate(() => {
        window.lxData.musicInfo.lrc = '[00:00.00]Adaptive background check\n[00:01.00]Artwork flow'
        window.app_event.lyricUpdated()
      })
      await update(page, { 'common.isShowAnimation': true, 'ui.ambientBackgroundQuality': 'gentle' })
      const bytes = Buffer.alloc(44 + 8000 * 10 * 2)
      bytes.write('RIFF', 0)
      bytes.writeUInt32LE(bytes.length - 8, 4)
      bytes.write('WAVEfmt ', 8)
      bytes.writeUInt32LE(16, 16)
      bytes.writeUInt16LE(1, 20)
      bytes.writeUInt16LE(1, 22)
      bytes.writeUInt32LE(8000, 24)
      bytes.writeUInt32LE(16000, 28)
      bytes.writeUInt16LE(2, 32)
      bytes.writeUInt16LE(16, 34)
      bytes.write('data', 36)
      bytes.writeUInt32LE(bytes.length - 44, 40)
      await page.evaluate(async src => {
        const player = window.__lxPluginHost.player
        player.setResource(src)
        player.setLoopPlay(true)
        player.getAudioElement().muted = true
        await player.getAudioElement().play()
      }, 'data:audio/wav;base64,' + bytes.toString('base64'))
      await page.waitForFunction(background => document.querySelector(background).dataset.ambientState === 'playing', background)
      const before = await page.evaluate(() => window.__adaptiveSamples)
      await page.waitForTimeout(1100)
      const count = await page.evaluate(() => window.__adaptiveSamples)
      assert(count - before >= 2 && count - before <= 6, `sampled ${count - before} times in 1.1 seconds`)
      const colors = await colorState(page)
      await page.evaluate(() => { window.lxData.musicInfo.pic = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#ed2840"/></svg>') })
      await page.waitForFunction(previous => getComputedStyle(document.querySelector('#root')).getPropertyValue('--color-button-font').trim() !== previous, colors['color-button-font'])
      await page.waitForTimeout(1400)
      assert(await audit(page, '#view [role="checkbox"], #player button, #toolbar button') > 8)
      await page.evaluate(() => window.__lxPluginHost.player.setPause())
      await page.waitForFunction(background => document.querySelector(background).dataset.ambientState === 'static', background)
      await update(page, { 'common.isShowAnimation': false, 'ui.ambientBackgroundQuality': 'static' })
    })
    await t.test('static, hidden, fallback and background-off states do not retain stale colors or a polling loop', async() => {
      // Changing quality schedules one final paint even while already static.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const before = await page.evaluate(() => window.__adaptiveSamples)
      await page.waitForTimeout(500)
      assert.equal(await page.evaluate(() => window.__adaptiveSamples), before)
      const win = await app.browserWindow(page)
      await win.evaluate(win => win.minimize())
      await page.waitForFunction(background => document.querySelector(background).dataset.ambientState === 'hidden', background)
      const hiddenSamples = await page.evaluate(() => window.__adaptiveSamples)
      await page.waitForTimeout(350)
      assert.equal(await page.evaluate(() => window.__adaptiveSamples), hiddenSamples)
      await win.evaluate(win => { win.restore(); win.showInactive() })
      await win.dispose()
      await page.waitForFunction(background => document.querySelector(background).dataset.ambientState === 'static', background)
      await page.locator(background + ' canvas').evaluate(canvas => canvas.getContext('webgl').getExtension('WEBGL_lose_context').loseContext())
      await page.waitForFunction(background => document.querySelector(background).dataset.ambientRenderer === 'fallback', background)
      const old = await colorState(page)
      await cover(page, '#eea020')
      assert.notDeepEqual(await colorState(page), old)
      await update(page, { 'ui.ambientBackground': false })
      await page.locator(background).waitFor({ state: 'detached' })
      assert.equal(await page.locator(flag).count(), 0)
      assert.equal(await page.locator('#root').evaluate(root => root.style.getPropertyValue('--color-button-font')), '')
      await update(page, { 'ui.ambientBackground': true })
      await page.locator(flag).waitFor()
      await theme(page, 'green')
      await page.evaluate(() => { window.lxData.musicInfo.pic = '' })
      await page.waitForFunction(background => document.querySelector(background + ' > div').style.opacity === '0', background)
      await page.locator(flag).waitFor()
    })
    await t.test('disabling after a theme change restores the new theme, and enabling is saved across restart', async() => {
      await theme(page, 'black')
      await update(page, { [settingKey]: false })
      await page.locator(flag).waitFor({ state: 'detached' })
      assert.equal(await page.locator('#root').evaluate(root => getComputedStyle(root).getPropertyValue('--color-button-font')), await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-button-font')))
      await update(page, { [settingKey]: true })
      await page.locator(flag).waitFor()
      assert.deepEqual(fixture.errors, [])
      await app.close()
      fixture = await launch({ ...options, profilePath: output })
      ;({ app, page } = fixture)
      await page.locator(flag).waitFor()
      assert.equal(await page.evaluate(key => window.lxData.appSetting[key], settingKey), true)
      await advanced()
      assert.equal(await page.locator('#setting_advanced_background_auto_contrast').isChecked(), true)
    })
    assert.deepEqual(fixture.errors, [])
    await fs.writeFile(path.join(output, 'adaptive-colors.json'), JSON.stringify(await colorState(page), null, 2))
    console.log('Adaptive color previews:', output)
  } finally { await app.close() }
})
