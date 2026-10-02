const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled, seedTrack, seedLyrics, showDetail } = require('./helpers/motion-fixture.cjs')
const { contrastRatio, parseColor } = require('./helpers/load-typescript.cjs')()('src/renderer/utils/kawarpBackground/contrast.ts')
const themes = require('../src/common/theme/index.json')

const options = { rendererPath: path.resolve('dist/index.html'), disableHardwareAcceleration: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-backgrounding-occluded-windows'] }
const key = 'ui.ambientBackgroundPlayDetailMask'
const checkbox = '#setting_advanced_background_play_detail_mask'
const background = '[data-ambient-background="shared"]'
const update = async(page, values) => {
  await page.evaluate(values => window.lxData.updateSetting(values), values)
  await page.waitForFunction(values => Object.entries(values).every(([key, value]) => window.lxData.appSetting[key] === value), values)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
const theme = async(page, id) => {
  const value = themes.find(value => value.id === id)
  await page.evaluate(colors => window.setTheme(colors), { ...value.config.themeColors, ...value.config.extInfo })
}
const ready = async page => {
  await settled(page)
  await page.waitForFunction(() => {
    const background = document.querySelector('[data-ambient-background]')
    return background?.dataset.ambientState === 'static' && (background.firstElementChild.style.opacity === '0' || background.dataset.ambientRenderer === 'fallback' || background.querySelector('[data-ambient-snapshot]')?.complete) && [background, document.querySelector('#container')].every(element =>
      element.getAnimations().every(animation => animation.playState !== 'running'))
  })
}
const settings = async page => {
  await showDetail(page, false)
  await settled(page)
  await route(page, '/setting?name=SettingAdvanced')
  const title = await page.evaluate(() => window.i18n.t('setting__advanced'))
  await page.getByRole('tab', { name: title, exact: true }).click()
  await page.locator(checkbox).waitFor({ state: 'attached' })
}
const cover = async(page, color) => {
  const previous = await page.locator(background + ' > div > div').first().getAttribute('style')
  const changed = await page.evaluate(color => {
    const image = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${color}"/></svg>`
    const pic = 'data:image/svg+xml,' + encodeURIComponent(image)
    const changed = window.lxData.musicInfo.pic !== pic
    window.lxData.musicInfo.pic = pic
    return changed
  }, color)
  if (changed) await page.waitForFunction(previous => document.querySelector('[data-ambient-background]').firstElementChild.firstElementChild.getAttribute('style') !== previous, previous)
  await page.waitForFunction(() => {
    const background = document.querySelector('[data-ambient-background]')
    return background.querySelector('[data-ambient-snapshot]')?.complete && background.firstElementChild.style.opacity === '1'
  })
  await ready(page)
}
const palette = page => page.locator('#root').evaluate(root => ({
  mode: root.dataset.ambientControls ?? '',
  colors: ['--color-font', '--color-button-font', '--color-primary'].map(key => getComputedStyle(root).getPropertyValue(key)),
}))
const appearance = async page => {
  // Read compositor output, including CSS opacity and surfaces, rather than
  // checking only the raw WebGL pixels or the setting's implementation tokens.
  const screenshot = await page.screenshot()
  return page.evaluate(async data => {
    const image = new Image()
    image.src = 'data:image/png;base64,' + data
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const background = document.querySelector('[data-ambient-background]')
    const rect = background.getBoundingClientRect()
    const pixel = Array.from(context.getImageData(Math.floor((rect.left + rect.width * 0.5) * devicePixelRatio), Math.floor((rect.top + rect.height * 0.06) * devicePixelRatio), 1, 1).data).slice(0, 3)
    let artworkPixel
    const retained = background.querySelector('[data-ambient-snapshot]')
    if (retained) {
      canvas.width = Math.round(rect.width * devicePixelRatio)
      canvas.height = Math.round(rect.height * devicePixelRatio)
      context.drawImage(retained, 0, 0, canvas.width, canvas.height)
      artworkPixel = Array.from(context.getImageData(Math.floor(canvas.width * 0.5), Math.floor(canvas.height * 0.06), 1, 1).data).slice(0, 3)
    }
    const detail = document.querySelector('[data-player-detail]')
    const foreground = Array.from(detail.querySelectorAll('button svg, .line-content.active .font-lrc')).filter(element => element.getBoundingClientRect().width).map(element => ({
      color: getComputedStyle(element).color,
      label: element.closest('button')?.getAttribute('aria-label') || element.textContent,
    }))
    return { pixel, artworkPixel, foreground, mode: detail.dataset.ambientControls, opacity: Number(getComputedStyle(background).opacity) }
  }, screenshot.toString('base64'))
}
const readable = result => {
  assert(result.foreground.length > 8, 'inspect the rendered playback controls and current lyric')
  const failures = result.foreground.map(element => ({ ...element, contrast: contrastRatio(parseColor(element.color).slice(0, 3), result.pixel) })).filter(element => element.contrast < 3)
  assert.deepEqual(failures, [], 'visible playback controls retain contrast against the displayed artwork')
}

test('playback background overlay is configurable, readable and saved', { timeout: 120000 }, async t => {
  let fixture = await launch(options)
  let { app, page } = fixture
  const { output } = fixture
  const results = []
  page.setDefaultTimeout(10000)
  try {
    await update(page, { 'common.langId': 'zh-cn', 'common.isShowAnimation': false, 'ui.ambientBackground': true, 'ui.ambientBackgroundQuality': 'static' })
    await seedTrack(page)
    await page.evaluate(() => { window.__maskCanvas = document.querySelector('[data-ambient-background] canvas') })
    await settings(page)
    await t.test('default enabled switch appears immediately below dynamic background and can be searched', async() => {
      assert.equal(await page.locator(checkbox).isChecked(), true)
      const order = await page.locator('#advanced_background').evaluate(title => Array.from(title.parentElement.querySelectorAll('input[type="checkbox"]')).map(input => input.id))
      assert.deepEqual(order.slice(0, 2), ['setting_advanced_background_enabled', checkbox.slice(1)])
      const search = page.getByRole('textbox', { name: await page.evaluate(() => window.i18n.t('setting__filter_placeholder')), exact: true })
      await search.fill('黑色遮罩')
      await page.locator('label[for="setting_advanced_background_play_detail_mask"]').waitFor()
      await page.screenshot({ path: path.join(output, 'mask-setting-search.png') })
      await search.fill('')
      await page.locator('label[for="setting_advanced_background_play_detail_mask"]').click()
      await page.waitForFunction(key => !window.lxData.appSetting[key], key)
      assert.equal(await page.locator(checkbox).isChecked(), false)
      assert.equal(await page.evaluate(key => window.lxData.appSetting[key], key), false)
      await page.screenshot({ path: path.join(output, 'mask-setting.png') })
    })

    for (const id of ['green', 'black']) {
      await theme(page, id)
      for (const following of [false, true]) {
        await t.test(`${id} theme with button color following ${following ? 'on' : 'off'} displays the cover without a dark veil`, async() => {
          await update(page, { 'ui.ambientBackgroundAutoContrast': following, [key]: true })
          await cover(page, '#e8e1d8')
          const library = await palette(page)
          await showDetail(page, true)
          await ready(page)
          await seedLyrics(page)
          const masked = await appearance(page)
          assert.equal(masked.mode, 'dark')
          readable(masked)
          await update(page, { [key]: false })
          await ready(page)
          const unmasked = await appearance(page)
          results.push({ id, following, masked, unmasked })
          await page.screenshot({ path: path.join(output, `mask-off-${id}-${following}.png`) })
          assert.equal(unmasked.opacity, 1)
          assert.equal(unmasked.mode, 'light')
          assert(unmasked.pixel.every((channel, index) => Math.abs(channel - unmasked.artworkPixel[index]) <= 4), `unmasked artwork survives compositor resampling: ${unmasked.pixel}; artwork: ${unmasked.artworkPixel}`)
          assert(unmasked.pixel[0] > masked.pixel[0] + 100, 'turning off the veil changes the rendered background')
          readable(unmasked)
          const retainedLibrary = await palette(page)
          assert.equal(retainedLibrary.mode, library.mode, 'changing playback darkening retains the library contrast mode')
          retainedLibrary.colors.forEach((color, index) => assert(parseColor(color).slice(0, 3).every((channel, component) => Math.abs(channel - parseColor(library.colors[index])[component]) <= 8), 'library colors remain stable across shading changes'))
          await update(page, { [key]: true })
          await ready(page)
          const restored = await appearance(page)
          assert(restored.pixel.every((channel, index) => Math.abs(channel - masked.pixel[index]) < 3), 're-enabling restores the existing masked appearance')
          assert.equal(await page.locator(background + ' canvas').evaluate(canvas => canvas === window.__maskCanvas), true)
          await showDetail(page, false)
          await ready(page)
          assert.equal(await page.locator(background).evaluate(element => getComputedStyle(element).opacity), '0.3')
        })
      }
    }

    await t.test('missing artwork uses the current theme and fallback rendering honors the switch', async() => {
      await update(page, { [key]: false, 'ui.ambientBackgroundAutoContrast': false })
      for (const id of ['green', 'black']) {
        await theme(page, id)
        await page.evaluate(() => { window.lxData.musicInfo.pic = '' })
        await page.waitForFunction(() => document.querySelector('[data-ambient-background]').firstElementChild.style.opacity === '0')
        await showDetail(page, true)
        await ready(page)
        assert.equal(await page.locator('[data-player-detail]').getAttribute('data-ambient-controls'), id === 'black' ? 'dark' : 'light')
        await showDetail(page, false)
        await ready(page)
      }
      await cover(page, '#e8e1d8')
      await page.locator(background + ' canvas').evaluate(canvas => canvas.getContext('webgl').getExtension('WEBGL_lose_context').loseContext())
      await page.waitForFunction(() => document.querySelector('[data-ambient-background]').dataset.ambientRenderer === 'fallback')
      await showDetail(page, true)
      await ready(page)
      const fallback = await appearance(page)
      readable(fallback)
      assert(fallback.pixel.every((channel, index) => Math.abs(channel - [232, 225, 216][index]) < 8))
      await update(page, { [key]: true })
      await ready(page)
      assert((await appearance(page)).pixel[0] < fallback.pixel[0] - 100)
      await showDetail(page, false)
      await ready(page)
    })

    await t.test('disabled choice persists across restart and remains independent of dynamic background enablement', async() => {
      await settings(page)
      await page.locator('label[for="setting_advanced_background_play_detail_mask"]').click()
      await page.waitForFunction(key => !window.lxData.appSetting[key], key)
      assert.equal(await page.locator(checkbox).isChecked(), false)
      await page.locator('label[for="setting_advanced_background_enabled"]').click()
      await page.locator('label[for="setting_advanced_background_play_detail_mask"]').waitFor({ state: 'hidden' })
      await page.locator('label[for="setting_advanced_background_enabled"]').click()
      await page.locator('label[for="setting_advanced_background_play_detail_mask"]').waitFor()
      assert.equal(await page.locator(checkbox).isChecked(), false)
      assert.deepEqual(fixture.errors, [])
      await app.close()
      fixture = await launch({ ...options, profilePath: output })
      ;({ app, page } = fixture)
      await settings(page)
      assert.equal(await page.locator(checkbox).isChecked(), false)
      assert.equal(await page.evaluate(key => window.lxData.appSetting[key], key), false)
    })
    assert.deepEqual(fixture.errors, [])
    await fs.writeFile(path.join(output, 'mask-rendered-colors.json'), JSON.stringify(results, null, 2))
    console.log('Playback overlay previews:', output)
  } finally { await app.close() }
})
