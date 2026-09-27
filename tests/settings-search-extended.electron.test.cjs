const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, install } = require('./helpers/plugin-fixture.cjs')

test('settings search handles all categories, input methods, dependencies and keyboard navigation', { timeout: 180000 }, async t => {
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html'), args: ['--disable-backgrounding-occluded-windows'] })
  const { app, page, output } = fixture
  page.setDefaultTimeout(8000)
  const label = key => page.evaluate(key => window.i18n.t(key), key)
  const tabs = page.locator('#view [data-setting-tab]')
  const tab = id => page.locator(`#view [data-setting-tab="${id}"]`)
  const content = page.locator('[data-setting-content]')
  const search = page.locator('#view input[autocomplete="off"][aria-label]')
  const visible = selector => page.locator(selector).waitFor({ state: 'visible' })
  const find = async(query, id) => {
    await search.fill(query)
    await tab(id).click()
    await settled(page)
  }
  try {
    await mockGitHub(app)
    await page.evaluate(() => window.lxData.updateSetting({ 'common.langId': 'zh-cn', 'ui.ambientBackground': false }))
    await route(page, '/setting?name=SettingBasic')
    await settled(page)

    await t.test('previously omitted settings are indexed and show the exact controls', async() => {
      await find(await label('setting__odc_clear_search_input'), 'SettingSearch')
      await visible('label[for="setting_odc_isAutoClearSearchInput"]')
      assert.equal(await page.locator('label[for="setting_odc_isAutoClearSearchList"]').isVisible(), false)
      await find(await label('setting_download_save_group_list_name'), 'SettingDownload')
      await visible('label[for="setting_download_save_group_list_name"]')
      assert.equal(await page.locator('#download_path').isVisible(), false)
      await find(await label('desktop_lyric__lrc_active_zoom_on'), 'SettingDesktopLyric')
      await visible('label[for="setting_desktop_lyric_zoom"]')
    })

    await t.test('multiple words, reordered words, full-width characters and language names', async() => {
      for (const query of ['背景 按钮', '按钮 背景']) {
        await find(query, 'SettingAdvanced')
        await visible('label[for="setting_advanced_background_enabled"]')
        assert.equal(await page.locator('#advanced_play').isVisible(), false)
      }
      await find('　ＷｅｂＤＡＶ　', 'SettingSync')
      await visible('#sync_webdav')
      assert.equal(await page.locator('#sync_mode').isVisible(), false)
      await find('English', 'SettingBasic')
      await visible('#basic_lang')
      assert.equal(await page.locator('#basic_theme').isVisible(), false)
    })

    await t.test('Chinese input composition keeps the last committed results until confirmation', async() => {
      await find('暗', 'SettingBasic')
      await search.dispatchEvent('compositionstart')
      await search.evaluate(element => {
        element.value = 'dongtai'
        element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }))
      })
      await settled(page)
      assert.equal(await search.inputValue(), 'dongtai')
      assert.equal(await page.locator('#basic_theme').isVisible(), true)
      await search.evaluate(element => {
        element.value = '动态背景'
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '动态背景' }))
      })
      await visible('label[for="setting_advanced_background_enabled"]')
      assert.equal(await tab('SettingAdvanced').getAttribute('aria-selected'), 'true')
    })

    await t.test('dependent switches stay visible, without automatically changing settings', async() => {
      await find('弹出层随机动画', 'SettingBasic')
      await visible('label[for="setting_show_animate"]')
      await visible('label[for="setting_animate"]')
      assert.equal(await page.locator('label[for="setting_start_in_fullscreen"]').isVisible(), false)
      await find('动画速度', 'SettingAdvanced')
      await visible('[data-setting-search="setting__advanced_ui_anim_speed"]')
      await visible('label[for="setting_advanced_ui_smooth_anim"]')
      await find('同步服务地址', 'SettingSync')
      await visible('label[for="setting_sync_enable"]')
      await visible('label[for="setting_sync_mode_client"]')
      assert.equal(await page.evaluate(() => window.lxData.appSetting['sync.enable']), false)
      assert.equal(await page.evaluate(() => window.lxData.appSetting['sync.mode']), 'server')
      await page.locator('label[for="setting_sync_mode_client"]').click()
      await page.getByPlaceholder(await label('setting__sync_client_host_tip'), { exact: true }).waitFor()
      assert.equal(await page.locator('label[for="setting_sync_enable"]').isVisible(), true)
      await page.locator('label[for="setting_sync_mode_server"]').click()
    })

    await t.test('matching headings do not show unrelated cache sections; placeholders and platforms work', async() => {
      await find('已调整过偏移时间', 'SettingOther')
      await visible('#other_lyric_edited')
      assert.equal(await page.locator('#other_dislike_list').isVisible(), false)
      assert.equal(await page.locator('#other_listdata').isVisible(), false)
      await find('网络 主机', 'SettingNetwork')
      await visible('label[for="setting_network_proxy_enable"]')
      const host = page.getByPlaceholder(await label('setting__network_proxy_host'), { exact: true })
      assert.equal(await host.isVisible(), false)
      await page.evaluate(() => { window.lxData.appSetting['network.proxy.enable'] = true })
      await host.waitFor()
      await page.evaluate(() => { window.lxData.appSetting['network.proxy.enable'] = false })
      await visible('label[for="setting_network_proxy_enable"]')
      await find('Cookie 酷狗', 'SettingCookie')
      await visible('#cookie_kg')
      assert.equal(await page.locator('#cookie_wy').isVisible(), false)
      await search.fill('菜单栏的状态菜单')
      assert.equal(await tab('SettingPlay').count(), 0)
    })

    await t.test('plugin names and descriptions match cards in every language', async() => {
      await search.press('Escape')
      await openStore(page)
      await page.locator('[data-plugin-id="audio-tag-editor"]').waitFor()
      await route(page, '/setting?name=SettingBasic')
      await find('Audio Tag Editor', 'SettingPluginStore')
      await visible('[data-plugin-id="audio-tag-editor"]')
      assert.equal(await page.locator('[data-plugin-id="folia-lyrics"]').isVisible(), false)
      assert.equal(await page.locator('[data-plugin-id="sound-effects"]').isVisible(), false)
      await find('Folia 逐字', 'SettingPluginStore')
      await visible('[data-plugin-id="folia-lyrics"]')
      assert.equal(await page.locator('[data-plugin-id="audio-tag-editor"]').isVisible(), false)
      await page.screenshot({ path: path.join(output, 'settings-search-plugin.png') })
    })

    await t.test('keyboard focus, result tabs and clear restore the original category and scroll', async() => {
      await search.press('Escape')
      await route(page, '/setting?name=SettingBasic')
      await settled(page)
      await content.evaluate(element => { element.scrollTop = element.scrollHeight })
      const scrollTop = await content.evaluate(element => element.scrollTop)
      assert(scrollTop > 0)
      await tab('SettingBasic').focus()
      await page.keyboard.press('Control+f')
      assert.equal(await search.evaluate(element => element === document.activeElement), true)
      await search.fill('暗')
      await visible('#basic_theme')
      await search.press('Control+f')
      assert.deepEqual(await search.evaluate(element => [element.selectionStart, element.selectionEnd]), [0, 1])
      await search.press('ArrowDown')
      assert.equal(await tab('SettingBasic').evaluate(element => element === document.activeElement), true)
      await page.keyboard.press('End')
      await visible('#other_tray_theme')
      assert.equal(await tab('SettingOther').evaluate(element => element === document.activeElement), true)
      await search.fill('随机动画')
      await visible('label[for="setting_animate"]')
      await search.press('Enter')
      assert.equal(await page.evaluate(() => document.activeElement.closest('label')?.htmlFor), 'setting_show_animate')
      await page.getByRole('button', { name: await label('setting__filter_clear'), exact: true }).click()
      await visible('#basic_theme')
      assert.equal(await search.inputValue(), '')
      assert.equal(await tab('SettingBasic').getAttribute('aria-selected'), 'true')
      assert.equal(await content.evaluate(element => element.scrollTop), scrollTop)
      await search.fill(' 　\n ')
      assert.equal(await tabs.count(), 18)
      await search.press('Escape')
    })

    await t.test('editing a setting or assigning a hotkey does not trigger search navigation', async() => {
      await find('同步服务地址', 'SettingSync')
      await page.locator('label[for="setting_sync_mode_client"]').click()
      const host = page.getByPlaceholder(await label('setting__sync_client_host_tip'), { exact: true })
      await host.waitFor({ state: 'visible' })
      await host.focus()
      await host.press('Control+f')
      assert.equal(await host.evaluate(element => element === document.activeElement), true)
      await host.press('Alt+ArrowRight')
      assert.equal(await tab('SettingSync').getAttribute('aria-selected'), 'true')
      await search.focus()
      await page.evaluate(() => { window.lx.isEditingHotKey = true })
      try {
        await search.press('Alt+ArrowLeft')
        assert.equal(await tab('SettingSync').getAttribute('aria-selected'), 'true')
      } finally { await page.evaluate(() => { window.lx.isEditingHotKey = false }) }
    })

    await t.test('each category remains reachable, and representative queries never leave only a title', async() => {
      await search.press('Escape')
      const groups = await tabs.evaluateAll(elements => elements.map(element => ({ id: element.dataset.settingTab, title: element.textContent.trim() })))
      for (const group of groups) {
        await find(group.title, group.id)
        assert(await content.locator('dd').evaluateAll(elements => elements.some(element => element.getBoundingClientRect().height > 0)), group.id)
      }
      const samples = [
        ['音源', 'SettingBasic'], ['播放音质', 'SettingPlay'], ['歌词', 'SettingPlayDetail'],
        ['透明度', 'SettingDesktopLyric'], ['搜索', 'SettingSearch'], ['列表', 'SettingList'],
        ['下载目录', 'SettingDownload'], ['快捷键', 'SettingHotKey'], ['Web DAV', 'SettingSync'],
        ['端口', 'SettingOpenAPI'], ['代理', 'SettingNetwork'], ['网易云音乐', 'SettingCookie'],
        ['无缝', 'SettingAdvanced'], ['备份', 'SettingBackup'], ['托盘', 'SettingOther'],
        ['更新', 'SettingUpdate'], ['开源地址', 'SettingAbout'],
      ]
      for (const [query, id] of samples) {
        await find(query, id)
        assert(await content.locator('dd').evaluateAll(elements => elements.some(element => element.getBoundingClientRect().height > 0)), `${id}: ${query}`)
      }
    })

    await t.test('language changes, no matches, and clearing recover without stale filtering', async() => {
      await find('夜间模式', 'SettingBasic')
      await visible('#basic_theme')
      await page.evaluate(() => window.lxData.updateSetting({ 'common.langId': 'en-us' }))
      await find('动态背景', 'SettingAdvanced')
      await visible('label[for="setting_advanced_background_enabled"]')
      await page.evaluate(() => window.lxData.updateSetting({ 'common.langId': 'zh-tw' }))
      await find('background', 'SettingAdvanced')
      await visible('label[for="setting_advanced_background_enabled"]')
      await search.fill('xyz不存在的设置987654')
      await content.getByText(await label('setting__filter_empty'), { exact: true }).waitFor()
      assert.equal(await tabs.count(), 0)
      await search.press('Escape')
      assert.equal(await tabs.count(), 18)
      await page.evaluate(() => window.lxData.updateSetting({ 'common.langId': 'zh-cn' }))
      await find('按钮 背景', 'SettingAdvanced')
      await page.screenshot({ path: path.join(output, 'settings-search-background.png') })
    })
    assert.deepEqual(fixture.errors, [])
    console.log('Settings search screenshots:', output)
  } finally { await app.close() }
})

test('a plugin opened from search keeps its complete interactive settings visible', { timeout: 60000 }, async() => {
  const { app, page, errors } = await launch({ rendererPath: path.resolve('dist/index.html'), args: ['--disable-backgrounding-occluded-windows'] })
  page.setDefaultTimeout(8000)
  const label = key => page.evaluate(key => window.i18n.t(key), key)
  try {
    await mockGitHub(app)
    await openStore(page)
    const search = page.getByRole('textbox', { name: await label('setting__filter_placeholder'), exact: true })
    await install(page, 'audio-visualizer')
    await search.fill('Audio Visualizer')
    const card = page.locator('[data-plugin-id="audio-visualizer"]')
    await card.getByRole('button', { name: await label('setting__plugins_settings'), exact: true }).click()
    const editor = card.locator('[data-plugin-settings="audio-visualizer"]')
    await editor.waitFor()
    await editor.getByRole('checkbox').click()
    await page.waitForFunction(() => window.lxData.appSetting['player.audioVisualization'])
    assert.equal(await editor.locator('[data-visualizer-option]').count(), 3)
    assert.equal(await editor.locator('button').first().isVisible(), true)
    assert.equal(await page.locator('[data-plugin-id="folia-lyrics"]').isVisible(), false)
    assert.equal(await card.locator('[data-plugin-settings-panel]').count(), 1)
    assert.equal(await editor.locator('button').first().isVisible(), true)
    assert.equal(await page.locator('[data-setting-tab^="SettingPlugin_"]').count(), 0)
    assert.equal(await page.locator('[data-setting-tab="SettingPlugin_audio-tag-editor"]').count(), 0)
    assert.equal(await page.locator('[data-setting-tab="SettingPlugin_sound-effects"]').count(), 0)
    assert.deepEqual(errors, [])
  } finally { await app.close() }
})
