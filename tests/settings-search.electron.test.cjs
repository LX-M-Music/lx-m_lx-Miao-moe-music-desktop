const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

test('settings search keeps matching controls visible and usable', { timeout: 90000 }, async t => {
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html'), args: ['--disable-backgrounding-occluded-windows'] })
  const { app, page, output } = fixture
  page.setDefaultTimeout(8000)
  const label = key => page.evaluate(key => window.i18n.t(key), key)
  const selectTab = async key => {
    await page.getByRole('tab', { name: await label(key), exact: true }).click()
    await settled(page)
  }
  const visibleSections = () => page.locator('#view dl > dd').evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().height > 0).length)
  try {
    await page.evaluate(() => window.lxData.updateSetting({ 'common.langId': 'zh-cn', 'ui.ambientBackground': false }))
    await route(page, '/setting?name=SettingBasic')
    await settled(page)
    const search = page.getByRole('textbox', { name: await label('setting__filter_placeholder'), exact: true })
    const tabs = page.locator('#view [role="tab"]')
    const originalTabs = await tabs.allTextContents()
    const originalTheme = await page.evaluate(() => window.lxData.appSetting['theme.id'])
    const themeArea = page.locator('[data-setting-search~="theme"]')

    await t.test('searching 暗 reveals themes and the system light/dark theme entry', async() => {
      await search.fill('暗')
      await page.locator('#basic_theme').waitFor()
      // Advanced includes the playback background's darkening help text.
      assert.deepEqual((await tabs.allTextContents()).map(text => text.trim()), [await label('setting__basic'), await label('setting__advanced'), await label('setting__other')])
      const autoTheme = themeArea.getByLabel(await label('theme_auto_tip'), { exact: true })
      await autoTheme.waitFor()
      assert.equal(await themeArea.getByLabel(await label('theme_black'), { exact: true }).isVisible(), true)
      assert.equal(await page.locator('label[for="setting_start_in_fullscreen"]').isVisible(), false)
      assert.equal(await visibleSections(), 1)
      await page.screenshot({ path: path.join(output, 'settings-search-dark.png') })
      await autoTheme.click({ button: 'right' })
      await page.getByRole('heading', { name: await label('theme_selector_modal__dark_title'), exact: true }).waitFor()
      await page.locator('#view header').getByRole('button', { name: await label('close'), exact: true }).click()
      await page.getByRole('heading', { name: await label('theme_selector_modal__dark_title'), exact: true }).waitFor({ state: 'hidden' })
    })

    await t.test('switching matching categories and returning does not hide asynchronously loaded themes', async() => {
      await selectTab('setting__other')
      await page.locator('#other_tray_theme').waitFor()
      assert.equal(await page.getByText(await label('setting__other_tray_theme_auto'), { exact: true }).isVisible(), true)
      assert.equal(await visibleSections(), 1)
      await selectTab('setting__basic')
      await themeArea.getByLabel(await label('theme_black'), { exact: true }).waitFor()
      await search.fill('暗色主题')
      await themeArea.getByLabel(await label('theme_auto_tip'), { exact: true }).waitFor()
      assert.equal(await visibleSections(), 1)
    })

    await t.test('collapsed theme names are searchable and clearing restores the original collapsed state', async() => {
      await search.fill(await label('theme_black'))
      await themeArea.getByLabel(await label('theme_black'), { exact: true }).waitFor()
      await search.press('Escape')
      assert.equal(await search.inputValue(), '')
      assert.deepEqual(await tabs.allTextContents(), originalTabs)
      await themeArea.getByLabel(await label('theme_more_btn_show'), { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => window.lxData.appSetting['theme.id']), originalTheme)
    })

    await t.test('specific headings only reveal the matching setting group', async() => {
      await search.fill(await label('setting__basic_font_size'))
      await page.locator('#basic_font_size').waitFor()
      assert.equal(await page.locator('#basic_font').isVisible(), false)
      assert.equal(await page.locator('#basic_theme').isVisible(), false)
      assert.equal(await visibleSections(), 1)
    })

    await t.test('help text keeps its associated checkbox visible', async() => {
      await search.fill((await label('setting__other_transparent_window_tip')).slice(0, 10))
      await selectTab('setting__other')
      await page.locator('label[for="setting_transparent_window"]').waitFor()
      assert(await visibleSections() > 0)
    })

    await t.test('hidden option text reveals its enabling control and expanded options remain searchable', async() => {
      await search.fill(await label('setting__advanced_background_gentle'))
      await selectTab('setting__advanced')
      const toggle = page.locator('label[for="setting_advanced_background_enabled"]')
      await toggle.waitFor()
      assert.equal(await page.locator('#setting_advanced_background_quality').isVisible(), false)
      await toggle.click()
      const quality = page.locator('#setting_advanced_background_quality')
      await quality.waitFor()
      assert.equal(await quality.isVisible(), true)
      await quality.selectOption('full')
      await toggle.click()
      await quality.waitFor({ state: 'hidden' })
      await toggle.click()
      await quality.waitFor()
      assert.equal(await quality.inputValue(), 'full')
      await toggle.click()
    })

    await t.test('case and surrounding spaces, no results, and clearing all update the content', async() => {
      await search.fill('  cOoKiE  ')
      await selectTab('setting__cookie')
      await page.locator('#cookie').waitFor()
      assert(await visibleSections() > 0)
      await search.fill('不存在的设置-xyz-987654')
      await page.getByText(await label('setting__filter_empty'), { exact: true }).first().waitFor()
      assert.equal(await tabs.count(), 0)
      assert.equal(await visibleSections(), 0)
      await search.fill('暗')
      await page.locator('#basic_theme').waitFor()
      await themeArea.getByLabel(await label('theme_auto_tip'), { exact: true }).waitFor()
      await search.press('Escape')
      assert.deepEqual(await tabs.allTextContents(), originalTabs)
    })

    await t.test('the same hidden-theme search works after changing language', async() => {
      await page.evaluate(() => window.lxData.updateSetting({ 'common.langId': 'en-us' }))
      const englishSearch = page.getByRole('textbox', { name: await label('setting__filter_placeholder'), exact: true })
      await englishSearch.fill('dark')
      await themeArea.getByLabel(await label('theme_auto_tip'), { exact: true }).waitFor()
      assert(await visibleSections() > 0)
      await englishSearch.press('Escape')
    })
    assert.deepEqual(fixture.errors, [])
    console.log('Settings search screenshot:', path.join(output, 'settings-search-dark.png'))
  } finally {
    await app.close()
  }
})
