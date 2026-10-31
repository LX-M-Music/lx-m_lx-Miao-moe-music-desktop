const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route } = require('./helpers/motion-fixture.cjs')

test('mini player background opacity uses a slider with wheel support', { timeout: 90000 }, async t => {
  const fixture = await launch({})
  const { app, page } = fixture
  const output = path.resolve('output/playwright/mini-player-opacity-slider')
  await fs.mkdir(output, { recursive: true })
  const slider = page.locator('#setting_mini_player_background_opacity')
  const opacity = () => page.evaluate(() => window.lxData.appSetting['miniPlayer.backgroundOpacity'])
  try {
    page.setDefaultTimeout(7500)
    await page.evaluate(() => window.lxData.updateSetting({ 'common.langId': 'zh-cn', 'miniPlayer.backgroundOpacity': 50 }))
    await route(page, '/setting?name=SettingDesktopLyric')
    await page.locator('[data-setting-tab="SettingDesktopLyric"]').click()
    await slider.waitFor()

    await t.test('the slider replaces the number input and reflects the saved opacity', async() => {
      assert.equal(await slider.getAttribute('role'), 'slider')
      assert.equal(await slider.getAttribute('aria-valuemin'), '0')
      assert.equal(await slider.getAttribute('aria-valuemax'), '100')
      assert.equal(await slider.getAttribute('aria-valuenow'), '50')
      assert.equal(await page.locator('#setting_mini_player_background_opacity input').count(), 0)
    })

    await t.test('the mouse wheel moves five percent per notch without scrolling the page', async() => {
      await page.evaluate(() => {
        window.__wheelPrevented = []
        window.__wheelListener = event => window.__wheelPrevented.push(event.defaultPrevented)
        window.addEventListener('wheel', window.__wheelListener)
      })
      const content = page.locator('[data-setting-content]')
      await slider.hover()
      const scrollTop = await content.evaluate(el => el.scrollTop)
      await page.mouse.wheel(0, 120)
      await page.waitForFunction(() => window.lxData.appSetting['miniPlayer.backgroundOpacity'] === 45)
      assert.equal(await slider.getAttribute('aria-valuenow'), '45')
      await page.mouse.wheel(0, -120)
      await page.waitForFunction(() => window.lxData.appSetting['miniPlayer.backgroundOpacity'] === 50)
      assert.equal(await slider.getAttribute('aria-valuenow'), '50')
      assert.equal(await content.evaluate(el => el.scrollTop), scrollTop)
      assert.deepEqual(await page.evaluate(() => window.__wheelPrevented), [true, true])
      await page.locator('#mini_player_background_opacity').locator('xpath=ancestor::dd').screenshot({ path: path.join(output, 'settings.png') })
    })

    await t.test('clicking the track sets the opacity and the reset button restores full opacity', async() => {
      const box = await slider.boundingBox()
      await slider.click({ position: { x: box.width * 0.37, y: box.height / 2 } })
      await page.waitForFunction(() => window.lxData.appSetting['miniPlayer.backgroundOpacity'] !== 50)
      const clicked = Number(await slider.getAttribute('aria-valuenow'))
      assert(Math.abs(clicked - 37) <= 1, `clicked opacity ${clicked}`)
      assert.equal(await opacity(), clicked)
      await page.getByRole('button', { name: '恢复不透明背景', exact: true }).click()
      await page.waitForFunction(() => window.lxData.appSetting['miniPlayer.backgroundOpacity'] === 100)
      assert.equal(await slider.getAttribute('aria-valuenow'), '100')
      assert.equal(await page.locator('#setting_mini_player_transparent').isChecked(), false)
    })

    assert.deepEqual(fixture.errors, [])
  } finally {
    await app.close()
  }
})
