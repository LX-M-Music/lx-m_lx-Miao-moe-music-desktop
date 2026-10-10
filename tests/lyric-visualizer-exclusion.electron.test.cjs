const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { test } = require('node:test')
const { launch, settled, seedTrack, showDetail } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, label, install, startSilentAudio } = require('./helpers/plugin-fixture.cjs')

const output = path.resolve('output/playwright/lyric-visualizer-exclusion', process.env.LX_LYRIC_EXCLUSION_RUN ?? 'verified')
const excluded = '[data-plugin-visualizer="main"], [data-visualizer-dialog], [data-player-detail] [data-visualizer-picker]'
const frameFor = async(page, surface) => {
  const frame = await (await page.locator(`[data-folia-stage="${surface}"] iframe`).elementHandle()).contentFrame()
  await frame.waitForFunction(() => document.documentElement.dataset.mode === 'monet' && document.querySelector('#root')?.textContent.trim())
  return frame
}
const cleanPlayer = async page => {
  assert.equal(await page.locator(excluded).count(), 0, 'the lyric page never mounts an audio visualization or style picker')
  assert.equal(await page.locator('[data-player-detail]').getByRole('button', { name: await label(page, 'audio_visualization'), exact: true }).count(), 0)
  assert.equal(await page.evaluate(() => window.lxData.appSetting['player.audioVisualization']), true, 'legacy enabled preferences cannot restore the removed overlay')
}

test('lyrics exclude audio visualization with legacy settings, playback, fullscreen and Folia', { timeout: 90000 }, async t => {
  const { app, page, errors } = await launch({ rendererPath: path.resolve('dist/index.html'), disableHardwareAcceleration: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const nativeWindow = await app.browserWindow(page)
  page.setDefaultTimeout(10000)
  await fs.mkdir(output, { recursive: true })
  try {
    await mockGitHub(app)
    // Older installed plugins still export MainVisualizer and Toggle. The host
    // must exclude those components even before the user updates the plugin.
    const catalog = structuredClone(require('../plugins/store/catalog.json'))
    const directory = path.resolve('plugins/store/audio-visualizer/1.2.1')
    const files = await fs.readdir(directory)
    const legacy = catalog.plugins.find(plugin => plugin.id === 'audio-visualizer')
    for (const [extension, key] of [['.zip', null], ['.lxplugin', 'lxplugin']]) {
      const name = files.find(name => name.endsWith(extension))
      const bytes = await fs.readFile(path.join(directory, name))
      const item = { path: `audio-visualizer/1.2.1/${name}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
      if (key) legacy.packages = { [key]: item }
      else Object.assign(legacy, item)
    }
    legacy.version = '1.2.1'
    await app.evaluate((_electron, catalog) => { global.__pluginCatalogOverride = catalog }, catalog)
    await openStore(page)
    await install(page, 'audio-visualizer')
    await seedTrack(page)
    await page.evaluate(() => {
      Object.assign(window.lxData.musicInfo, { lrc: '[00:00.000]歌词页面只有歌词动效\n[00:10.000]不叠加音频可视化', lxlrc: '', tlrc: '', rlrc: '' })
      window.app_event.lyricUpdated()
      window.lxData.updateSetting({ 'player.audioVisualization': true, 'common.isShowAnimation': false, 'ui.ambientBackground': true, 'ui.ambientBackgroundOnlyPlayDetail': true })
      window.__lxPluginHost.player.getAudioElement().muted = true
    })
    await startSilentAudio(page)
    const dataRoot = await app.evaluate(() => global.lxDataPath)
    for (const style of ['spectrum', 'wave', 'radial']) {
      await t.test(`ordinary lyrics ignore the saved ${style} style`, async() => {
        await showDetail(page, false)
        await fs.writeFile(path.join(dataRoot, 'plugins/preferences/audio-visualizer.json'), JSON.stringify({ version: 1, main: style, desktop: 'spectrum' }))
        for (const enabled of [false, true]) await page.evaluate(enabled => require('electron').ipcRenderer.invoke('optional_plugins:set_enabled', 'audio-visualizer', enabled), enabled)
        await showDetail(page, true)
        await settled(page)
        await page.waitForTimeout(100)
        await page.screenshot({ path: path.join(output, `native-${style}.png`) })
        await cleanPlayer(page)
        await nativeWindow.evaluate(window => window.setFullScreen(true))
        await page.locator('html.fullscreen').waitFor()
        await cleanPlayer(page)
        await nativeWindow.evaluate(window => window.setFullScreen(false))
        await page.locator('html:not(.fullscreen)').waitFor()
        await page.evaluate(() => window.__lxPluginHost.player.setPause())
        await cleanPlayer(page)
        await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().play())
        await showDetail(page, false)
        await showDetail(page, true)
        await cleanPlayer(page)
      })
    }
    await showDetail(page, false)
    await settled(page)
    await openStore(page)
    await install(page, 'folia-lyrics')
    await page.locator('[data-plugin-id="folia-lyrics"]').getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
    await page.locator('[data-folia-mode]').selectOption('monet')
    let frame = await frameFor(page, 'preview')
    await t.test('Monet preview has no static or live frequency rail', async() => {
      await page.waitForTimeout(1100)
      await page.locator('[data-folia-stage="preview"]').screenshot({ path: path.join(output, 'monet-preview.png') })
      assert.equal(await frame.locator('#root canvas').count(), 0, 'Monet must not mount its dedicated audio rail')
    })
    await showDetail(page, true)
    await settled(page)
    frame = await frameFor(page, 'player')
    for (const [name, lowPower] of [['playing', false], ['low-power', true], ['paused', false]]) {
      await t.test(`Monet ${name} and fullscreen contain no audio visualization`, async() => {
        await page.evaluate(lowPower => window.lxData.updateSetting({ 'ui.lowPowerMode': lowPower }), lowPower)
        if (name === 'paused') await page.evaluate(() => window.__lxPluginHost.player.setPause())
        await page.waitForTimeout(200)
        await cleanPlayer(page)
        assert.equal(await frame.locator('#root canvas').count(), 0)
        await nativeWindow.evaluate(window => window.setFullScreen(true))
        await page.locator('html.fullscreen').waitFor()
        await cleanPlayer(page)
        assert.equal(await frame.locator('#root canvas').count(), 0)
        await page.screenshot({ path: path.join(output, `monet-${name}-fullscreen.png`) })
        await nativeWindow.evaluate(window => window.setFullScreen(false))
        await page.locator('html:not(.fullscreen)').waitFor()
      })
    }
    await t.test('switching between Folia and ordinary lyrics keeps the overlay excluded', async() => {
      for (let index = 0; index < 4; index++) {
        await page.locator('[data-folia-toggle]').evaluate(button => button.click())
        await page.waitForFunction(enabled => document.querySelector('[data-folia-toggle]').getAttribute('aria-pressed') === String(enabled), index % 2 === 1)
        await cleanPlayer(page)
      }
    })
    assert.deepEqual(errors, [])
    console.log('Lyric visualizer exclusion screenshots:', output)
  } finally {
    await nativeWindow.evaluate(window => window.setFullScreen(false)).catch(() => {})
    await nativeWindow.dispose()
    await showDetail(page, false).catch(() => {})
    await settled(page).catch(() => {})
    let timer
    try {
      await Promise.race([app.close(), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Electron close timed out')), 15000) })])
    } catch (error) { app.process().kill(); throw error } finally { clearTimeout(timer) }
  }
})
