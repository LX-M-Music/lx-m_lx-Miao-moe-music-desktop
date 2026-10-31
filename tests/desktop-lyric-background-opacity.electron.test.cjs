const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route } = require('./helpers/motion-fixture.cjs')

test('desktop lyric background opacity is adjustable and stays visible while locked', { timeout: 120000 }, async t => {
  const fixture = await launch({})
  const { app, page } = fixture
  const output = path.resolve('output/playwright/desktop-lyric-background-opacity')
  await fs.mkdir(output, { recursive: true })
  const update = values => page.evaluate(values => window.lxData.updateSetting(values), values)
  const background = () => desktop.evaluate(() => getComputedStyle(document.querySelector('#main')).backgroundColor)
  let desktop
  try {
    page.setDefaultTimeout(8000)
    await update({
      'common.langId': 'zh-cn',
      'desktopLyric.enable': true,
      'desktopLyric.isLock': true,
      'desktopLyric.width': 450,
      'desktopLyric.height': 300,
      'desktopLyric.backgroundOpacity': 20,
    })
    const matches = p => p.url().includes('lyric.html') && !new URL(p.url()).searchParams.has('mini')
    desktop = app.windows().find(matches) ?? await app.waitForEvent('window', { predicate: matches })
    desktop.setDefaultTimeout(8000)
    await desktop.waitForFunction(() => !!document.querySelector('#main'))

    await t.test('the locked lyric window paints the stored background alpha', async() => {
      await desktop.waitForFunction(() => getComputedStyle(document.querySelector('#main')).backgroundColor === 'rgba(0, 0, 0, 0.2)')
      await update({ 'desktopLyric.backgroundOpacity': 60 })
      await desktop.waitForFunction(() => getComputedStyle(document.querySelector('#main')).backgroundColor === 'rgba(0, 0, 0, 0.6)')
      await desktop.screenshot({ path: path.join(output, 'locked-background.png') })
      await update({ 'desktopLyric.backgroundOpacity': 0 })
      await desktop.waitForFunction(() => getComputedStyle(document.querySelector('#main')).backgroundColor === 'rgba(0, 0, 0, 0)')
      await update({ 'desktopLyric.backgroundOpacity': 20 })
      await desktop.waitForFunction(() => getComputedStyle(document.querySelector('#main')).backgroundColor === 'rgba(0, 0, 0, 0.2)')
    })

    await t.test('the settings slider supports wheel, click and reset', async() => {
      await route(page, '/setting?name=SettingDesktopLyric')
      await page.locator('[data-setting-tab="SettingDesktopLyric"]').click()
      const slider = page.locator('#setting_desktop_lyric_background_opacity')
      await slider.waitFor()
      assert.equal(await slider.getAttribute('role'), 'slider')
      assert.equal(await slider.getAttribute('aria-valuemin'), '0')
      assert.equal(await slider.getAttribute('aria-valuemax'), '100')
      assert.equal(await slider.getAttribute('aria-valuenow'), '20')
      assert.match(await page.locator('#desktop_lyric_background_opacity').textContent(), /20%/)

      await slider.hover()
      await page.mouse.wheel(0, -120)
      await page.waitForFunction(() => window.lxData.appSetting['desktopLyric.backgroundOpacity'] === 25)
      assert.equal(await slider.getAttribute('aria-valuenow'), '25')
      await desktop.waitForFunction(() => getComputedStyle(document.querySelector('#main')).backgroundColor === 'rgba(0, 0, 0, 0.25)')
      await page.locator('#desktop_lyric_background_opacity').locator('xpath=ancestor::dd').screenshot({ path: path.join(output, 'settings.png') })

      const box = await slider.boundingBox()
      await slider.click({ position: { x: box.width * 0.4, y: box.height / 2 } })
      await page.waitForFunction(() => window.lxData.appSetting['desktopLyric.backgroundOpacity'] !== 25)
      const clicked = Number(await slider.getAttribute('aria-valuenow'))
      assert(Math.abs(clicked - 40) <= 1, `clicked opacity ${clicked}`)
      await desktop.waitForFunction(value => getComputedStyle(document.querySelector('#main')).backgroundColor === `rgba(0, 0, 0, ${value / 100})`, clicked)

      await page.getByRole('button', { name: '恢复默认背景', exact: true }).click()
      await page.waitForFunction(() => window.lxData.appSetting['desktopLyric.backgroundOpacity'] === 20)
      assert.equal(await slider.getAttribute('aria-valuenow'), '20')
      await desktop.waitForFunction(() => getComputedStyle(document.querySelector('#main')).backgroundColor === 'rgba(0, 0, 0, 0.2)')
    })

    await t.test('unlocking the window keeps the configured background', async() => {
      await update({ 'desktopLyric.isLock': false })
      await desktop.waitForFunction(() => getComputedStyle(document.querySelector('#main')).backgroundColor === 'rgba(0, 0, 0, 0.2)')
    })

    assert.deepEqual(fixture.errors, [])
  } finally {
    await app.close()
  }
})
