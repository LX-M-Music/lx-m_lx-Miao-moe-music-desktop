const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, label, install } = require('./helpers/plugin-fixture.cjs')

test('plugin settings follow installation without placeholder links', { timeout: 60000 }, async t => {
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  page.setDefaultTimeout(10000)
  try {
    await mockGitHub(app)
    const title = await label(page, 'setting__plugins_visualizer_title')
    const tab = page.getByRole('tab', { name: title, exact: true })
    await t.test('an uninstalled visualizer leaves no settings entry or placeholder', async() => {
      await route(page, '/setting?name=SettingDesktopLyric')
      await settled(page)
      await page.locator('#desktop_lyric').waitFor()
      assert.equal(await tab.count(), 0)
      assert.equal(await page.getByText('前往插件商店安装或设置音频可视化', { exact: true }).count(), 0)
      assert.equal(await page.locator('[data-plugin-settings]').count(), 0)
    })
    await t.test('installation adds desktop visualization settings without a player target', async() => {
      await openStore(page)
      await install(page, 'audio-visualizer')
      await page.evaluate(() => {
        window.lxData.updateSetting({ 'player.audioVisualization': false, 'desktopLyric.audioVisualization': false })
      })
      await page.locator('[data-plugin-id="audio-visualizer"]').getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
      await settled(page)
      const settings = page.locator('[data-plugin-settings="audio-visualizer"]')
      await settings.waitFor()
      assert.equal(await page.locator('#plugin_store').count(), 1)
      assert.equal(await settings.locator('[data-visualizer-option]').count(), 3)
      assert.equal(await settings.locator('[data-visualizer-surface="main"]').count(), 0)
      await settings.getByRole('checkbox').click()
      await page.waitForFunction(() => window.lxData.appSetting['desktopLyric.audioVisualization'] === true)
      assert.equal(await page.evaluate(() => window.lxData.appSetting['player.audioVisualization']), false)
      assert.equal(await settings.locator('[data-visualizer-option]').count(), 3)
    })
    await t.test('removing the active plugin removes its options and opens a valid settings panel', async() => {
      await page.evaluate(() => require('electron').ipcRenderer.invoke('optional_plugins:uninstall', 'audio-visualizer'))
      await page.locator('[data-plugin-settings="audio-visualizer"]').waitFor({ state: 'detached' })
      await settled(page)
      await page.locator('#plugin_store').waitFor()
      assert.equal(await page.locator('[data-plugin-settings="audio-visualizer"]').count(), 0)
      await page.locator('[data-plugin-id="audio-visualizer"]').getByRole('button', { name: await label(page, 'setting__plugins_install'), exact: true }).waitFor()
    })
    await t.test('reinstalling restores the entry and saved options', async() => {
      await install(page, 'audio-visualizer')
      const settings = page.locator('[data-plugin-settings="audio-visualizer"]')
      if (!await settings.isVisible()) await page.locator('[data-plugin-id="audio-visualizer"]').getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
      await settled(page)
      await settings.waitFor()
      assert.equal(await settings.getByRole('checkbox').getAttribute('aria-checked'), 'true')
      assert.equal(await settings.locator('[data-visualizer-surface="main"]').count(), 0)
    })
    assert.deepEqual(fixture.errors, [])
  } catch (error) {
    console.error('Plugin settings profile:', fixture.output)
    throw error
  } finally {
    await app.close()
  }
})
