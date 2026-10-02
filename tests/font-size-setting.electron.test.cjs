const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled, seedTrack, seedLyrics, showDetail } = require('./helpers/motion-fixture.cjs')

test('font size choices apply immediately across window states and survive restart', { timeout: 120000 }, async t => {
  let fixture = await launch()
  let { app, page } = fixture
  const { output } = fixture
  let window = await app.browserWindow(page)
  const selectSize = async size => {
    await page.locator(`label[for="setting_basic_font_size_${size}"]`).click()
    await page.waitForFunction(size => window.lxData.appSetting['common.fontSize'] === size &&
      parseFloat(getComputedStyle(document.documentElement).fontSize) === size, size)
    return page.locator('label[for="setting_basic_font_size_16"]').evaluate(element => parseFloat(getComputedStyle(element).fontSize))
  }
  const allSizes = async() => {
    const before = await window.evaluate(window => window.getBounds())
    const rendered = []
    for (const size of [14, 15, 16, 17, 18, 19]) rendered.push(await selectSize(size))
    for (let index = 1; index < rendered.length; index++) assert(rendered[index] > rendered[index - 1], 'each font option visibly increases the label size')
    assert.deepEqual(await window.evaluate(window => window.getBounds()), before, 'font settings do not resize the native window')
  }
  try {
    page.setDefaultTimeout(8000)
    await page.evaluate(() => window.lxData.updateSetting({ 'common.langId': 'zh-cn', 'theme.id': '0' }))
    await route(page, '/setting?name=SettingBasic')
    await settled(page)

    await t.test('all six options immediately change the normal window', allSizes)
    await t.test('the large options stay distinct in a minimum-size window', async() => {
      await page.setViewportSize({ width: 828, height: 540 })
      await allSizes()
      const section = page.locator('#basic_font_size').locator('..')
      await selectSize(14)
      await section.screenshot({ path: path.join(output, 'font-size-small.png') })
      await selectSize(19)
      await section.screenshot({ path: path.join(output, 'font-size-large.png') })
    })
    await t.test('maximized windows use the selected font', async() => {
      const name = await page.evaluate(() => window.i18n.t('window_maximize'))
      await page.locator('#left, #toolbar').getByRole('button', { name, exact: true }).click()
      await page.locator('html.maximized').waitFor()
      await page.setViewportSize({ width: 1366, height: 768 })
      await allSizes()
    })
    await t.test('fullscreen controls remain usable and preserve font when restoring', async() => {
      await page.keyboard.press('F11')
      await page.locator('html.fullscreen').waitFor()
      await allSizes()
      await page.keyboard.press('F11')
      await page.locator('html.maximized:not(.fullscreen)').waitFor()
      const name = await page.evaluate(() => window.i18n.t('window_restore'))
      await page.locator('#left, #toolbar').getByRole('button', { name, exact: true }).click()
      await page.locator('html:not(.maximized):not(.fullscreen)').waitFor()
      await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '19px')
    })
    await t.test('the largest font keeps small-window shell, rows and playback detail usable', async() => {
      await page.setViewportSize({ width: 828, height: 540 })
      await seedTrack(page)
      await route(page, '/search')
      await settled(page)
      const shell = await page.evaluate(() => {
        const bounds = selector => {
          const { x, y, right, bottom } = document.querySelector(selector).getBoundingClientRect()
          return { x, y, right, bottom }
        }
        return { root: bounds('#root'), parts: ['#left', '#toolbar', '#view', '#player', '#toolbar input', '#toolbar button:last-child'].map(bounds) }
      })
      for (const part of shell.parts) {
        assert(part.x >= shell.root.x - 1 && part.y >= shell.root.y - 1, JSON.stringify(part))
        assert(part.right <= shell.root.right + 1 && part.bottom <= shell.root.bottom + 1, JSON.stringify(part))
      }
      await route(page, '/list?id=love')
      await settled(page)
      await page.evaluate(() => {
        const component = window.__motionComponents().find(c => c.type.name === 'MusicList' && 'list' in c.setupState)
        component.setupState.list = Array.from({ length: 50 }, (_, index) => ({
          id: `font-size-song-${index}`, name: `Font size song ${index}`, singer: 'Fixture singer', source: 'local', interval: '03:00',
          meta: { albumName: 'Album', filePath: '', ext: 'mp3', picUrl: '' },
        }))
      })
      await page.locator('#view .list-item').first().waitFor()
      const rows = await page.locator('#view .list-item').evaluateAll(elements => elements.slice(0, 3).map(element => {
        const { y, height } = element.getBoundingClientRect()
        return { y, height }
      }))
      assert(rows.length >= 2)
      assert(rows[0].height >= 44)
      assert(Math.abs(rows[1].y - rows[0].y - rows[0].height) <= 1, 'font changes keep virtualized rows aligned')
      await showDetail(page, true)
      await settled(page)
      await seedLyrics(page)
      await page.waitForFunction(() => [...document.querySelectorAll('[data-detail-part]')].every(element => !element.getAnimations().length))
      const detail = await page.locator('[data-player-detail]').boundingBox()
      for (const name of ['chrome', 'info', 'lyrics', 'controls']) {
        const part = await page.locator(`[data-player-detail] [data-detail-part="${name}"]`).boundingBox()
        assert(part && part.width > 0 && part.height > 0, name)
        assert(part.x >= detail.x - 1 && part.y >= detail.y - 1, name)
        assert(part.x + part.width <= detail.x + detail.width + 1 && part.y + part.height <= detail.y + detail.height + 1, name)
      }
      await page.screenshot({ path: path.join(output, 'font-size-large-small-window.png') })
      await showDetail(page, false)
      await settled(page)
    })
    await t.test('reload and restart retain the chosen size', async() => {
      await route(page, '/setting?name=SettingBasic')
      await settled(page)
      await selectSize(18)
      await page.reload()
      await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '18px')
      assert.equal(await page.evaluate(() => window.lxData.appSetting['common.fontSize']), 18)
      assert.deepEqual(fixture.errors, [])
      await window.dispose()
      await app.close()
      fixture = await launch({ profilePath: output })
      ;({ app, page } = fixture)
      window = await app.browserWindow(page)
      await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '18px')
      assert.equal(await page.evaluate(() => window.lxData.appSetting['common.fontSize']), 18)
    })
    assert.deepEqual(fixture.errors, [])
    t.diagnostic(`Font screenshots: ${output}`)
  } finally {
    await window.dispose()
    await app.close()
  }
})
