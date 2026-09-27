const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

test('setting explanations appear on black help icons when hovered', { timeout: 150000 }, async() => {
  const { app, page, errors } = await launch({ rendererPath: path.resolve('dist/index.html'), args: ['--disable-backgrounding-occluded-windows'] })
  page.setDefaultTimeout(8000)
  const cases = [
    ['SettingBasic', '#basic_font', 'setting__font_hint'],
    ['SettingAdvanced', '#advanced', 'setting__advanced_desc'],
    ['SettingCookie', '#cookie', 'setting__cookie_desc'],
    ['SettingDownload', '#download_name', 'setting__download_name_fields'],
    ['SettingPlay', '#play_volume_normalization', 'setting__play_volume_normalization_tip'],
    ['SettingDesktopLyric', '#desktop_lyric_background_opacity', 'setting__desktop_lyric_background_opacity_tip'],
    ['SettingOpenAPI', '#open_api', 'setting__open_api_tip'],
    ['SettingUpdate', '#update', 'setting__update_start_tip'],
    ['SettingBackup', '#backup_all', 'setting__backup_scope'],
    ['SettingPluginStore', '#plugin_store', 'setting__plugins_intro'],
    ['SettingSync', '#sync_webdav_items', 'setting__sync_webdav_download_tip'],
    ['SettingOther', '#other_resource_cache', 'setting__other_resource_cache_tip'],
  ]
  try {
    for (const [name, heading, key] of cases) {
      await route(page, '/setting?name=' + name)
      await settled(page)
      const icon = page.locator(`${heading} .help-icon`).first()
      await icon.waitFor({ state: 'visible' })
      assert.equal(await icon.evaluate(element => element.ownerDocument.defaultView.getComputedStyle(element).color), 'rgb(0, 0, 0)', name)
      const explanation = await page.evaluate(key => window.i18n.t(key), key)
      await icon.hover()
      await page.getByText(explanation, { exact: false }).waitFor({ state: 'visible' })
      await page.mouse.move(0, 0)
      if (name === 'SettingSync') {
        assert.equal(await page.locator('#sync .help-btn').evaluate(element => element.ownerDocument.defaultView.getComputedStyle(element).color), 'rgb(0, 0, 0)')
      }
      if (name === 'SettingPluginStore') {
        const pluginCard = page.locator('[data-plugin-id="audio-tag-editor"]')
        await pluginCard.waitFor({ state: 'visible' })
        const descriptions = Object.values(require('../src/optional-plugins/audio-tag-editor/store.json').description)
        const cardText = await pluginCard.innerText()
        assert.ok(descriptions.some(description => cardText.includes(description)))
        const pluginExplanation = await page.evaluate(() => window.i18n.t('setting__plugins_tag_editor_hint'))
        await pluginCard.getByText(pluginExplanation, { exact: true }).waitFor({ state: 'visible' })
        assert.equal(await pluginCard.locator('.help-icon').count(), 0)
      }
    }
    await route(page, '/setting?name=SettingOther')
    await settled(page)
    await page.locator('#other_dislike_list + div button').click()
    const modalIcon = page.locator('h2 .help-icon:visible').last()
    await modalIcon.waitFor()
    assert.equal(await modalIcon.evaluate(element => element.ownerDocument.defaultView.getComputedStyle(element).color), 'rgb(0, 0, 0)')
    const rulesExplanation = await page.evaluate(() => window.i18n.t('setting__dislike_list_tips'))
    await modalIcon.hover()
    await page.getByText(rulesExplanation, { exact: false }).waitFor({ state: 'visible' })
    assert.deepEqual(errors, [])
  } finally {
    await app.close()
  }
})
