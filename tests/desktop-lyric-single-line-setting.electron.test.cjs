const assert = require('node:assert/strict')
const { test } = require('node:test')
const { launch, route } = require('./helpers/motion-fixture.cjs')

test('single-line lyric mode is available in the desktop lyric settings', { timeout: 120000 }, async() => {
  const fixture = await launch({})
  const { app, page } = fixture
  try {
    page.setDefaultTimeout(8000)
    const update = values => page.evaluate(values => window.lxData.updateSetting(values), values)
    await update({
      'common.langId': 'zh-cn',
      'desktopLyric.enable': true,
      'desktopLyric.isSingleLine': false,
      'desktopLyric.isLock': false,
    })
    const matches = p => p.url().includes('lyric.html') && !new URL(p.url()).searchParams.has('mini')
    const desktop = app.windows().find(matches) ?? await app.waitForEvent('window', { predicate: matches })
    desktop.setDefaultTimeout(8000)
    await desktop.waitForFunction(() => !!document.querySelector('#main'))
    assert.equal(await desktop.locator('[data-desktop-lyric-single-line]').count(), 0)

    await route(page, '/setting?name=SettingDesktopLyric')
    await page.locator('[data-setting-tab="SettingDesktopLyric"]').click()
    const toggle = page.locator('label[for="setting_desktop_lyric_single_line"]')
    await toggle.waitFor()
    assert.equal((await toggle.textContent()).trim(), '单行歌词')
    assert.equal(await page.locator('#setting_desktop_lyric_single_line').isChecked(), false)

    await toggle.click()
    await page.waitForFunction(() => window.lxData.appSetting['desktopLyric.isSingleLine'] === true)
    await desktop.waitForFunction(() => !!document.querySelector('[data-desktop-lyric-single-line]'))

    await toggle.click()
    await page.waitForFunction(() => window.lxData.appSetting['desktopLyric.isSingleLine'] === false)
    await desktop.waitForFunction(() => !document.querySelector('[data-desktop-lyric-single-line]'))

    assert.deepEqual(fixture.errors, [])
  } finally {
    await app.close()
  }
})
