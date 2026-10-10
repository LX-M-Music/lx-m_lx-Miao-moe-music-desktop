const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { test } = require('node:test')
const { launch, route, settled, seedTrack, showDetail } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, label, install, startSilentAudio } = require('./helpers/plugin-fixture.cjs')
const { packSource } = require('../src/common/pluginSource')
const { version } = require('../src/optional-plugins/audio-visualizer/plugin.json')

const styles = ['spectrum', 'wave', 'radial']
const openPicker = async page => {
  await showDetail(page, false)
  await settled(page)
  await openStore(page)
  const picker = page.locator('[data-plugin-settings="audio-visualizer"]')
  if (!await picker.isVisible()) await page.locator('[data-plugin-id="audio-visualizer"]').getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
  await picker.waitFor()
  return picker
}
const choose = async(picker, style) => {
  await picker.locator('[data-visualizer-option="' + style + '"]').click()
  await picker.page().waitForFunction(style => document.querySelector('[data-plugin-settings="audio-visualizer"] [data-visualizer-option="' + style + '"] input')?.checked, style)
  await picker.page().waitForFunction(() => !document.querySelector('[data-plugin-settings="audio-visualizer"] input[type="radio"]')?.disabled)
}
const hasPixels = (page, selector) => page.waitForFunction(selector => {
  const canvas = document.querySelector(selector)
  return canvas?.width > 0 && canvas.height > 0 && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0)
}, selector)
const launchOptions = { rendererPath: path.resolve('dist/index.html') }
const closeFixture = async fixture => {
  if (!fixture || !fixture.app.process() || fixture.app.process().exitCode !== null) return
  await showDetail(fixture.page, false).catch(() => {})
  await settled(fixture.page).catch(() => {})
  let timer
  try {
    await Promise.race([fixture.app.close(), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Electron close timed out')), 15000) })])
  } catch (error) { fixture.app.process().kill(); throw error } finally { clearTimeout(timer) }
}

test('visualizer upgrades preserve desktop styles, previews and preferences while keeping player lyrics clear', { timeout: 120000 }, async() => {
  let fixture = await launch(launchOptions)
  const output = fixture.output
  try {
    let { app, page } = fixture
    page.setDefaultTimeout(12000)
    await mockGitHub(app)
    const archive = await packSource({ id: 'audio-visualizer', version: '1.1.1', apiVersion: 1, entry: 'src/index.js' }, new Map([
      ['src/index.js', Buffer.from("import { h } from 'vue'; export default { components: { Settings: () => h('div', 'Previous source version') } }")],
    ]))
    const sha256 = createHash('sha256').update(archive).digest('hex')
    const oldCatalog = { schemaVersion: 2, plugins: [{ id: 'audio-visualizer', version: '1.1.1', apiVersion: 1, path: 'audio-visualizer/1.1.1/' + sha256 + '.zip', bytes: archive.length, sha256 }] }
    await app.evaluate((_electron, { catalog, archive }) => {
      global.__pluginCatalogOverride = catalog
      global.__pluginPackageOverrides[catalog.plugins[0].path] = archive
    }, { catalog: oldCatalog, archive: archive.toString('base64') })
    await openStore(page)
    await install(page, 'audio-visualizer')
    const dataRoot = await app.evaluate(() => global.lxDataPath)
    const oldRegistry = JSON.parse(await fs.readFile(path.join(dataRoot, 'plugins/installed.json'), 'utf8'))
    await fs.mkdir(path.join(dataRoot, 'plugins/preferences'), { recursive: true })
    await fs.writeFile(path.join(dataRoot, 'plugins/preferences/audio-visualizer.json'), JSON.stringify({ version: 1, main: 'bars', desktop: 'ring' }))
    await page.evaluate(() => {
      window.__visualizerAnalysers = []
      const connect = AudioNode.prototype.connect
      AudioNode.prototype.connect = function(target, ...args) {
        if (target instanceof AudioDestinationNode) {
          const silence = this.context.createGain()
          silence.gain.value = 0
          connect.call(silence, target)
          return connect.call(this, silence, ...args)
        }
        return connect.call(this, target, ...args)
      }
      const create = AudioContext.prototype.createAnalyser
      AudioContext.prototype.createAnalyser = function() {
        const analyser = create.call(this)
        const disconnect = analyser.disconnect.bind(analyser)
        analyser.__disconnected = false
        analyser.disconnect = (...args) => { analyser.__disconnected = true; return disconnect(...args) }
        window.__visualizerAnalysers.push(analyser)
        return analyser
      }
      window.lxData.updateSetting({ 'player.audioVisualization': true, 'desktopLyric.audioVisualization': false, 'common.isShowAnimation': false })
    })
    await app.evaluate(() => { global.__pluginCatalogOverride = null })
    await page.getByRole('button', { name: await label(page, 'setting__plugins_refresh'), exact: true }).click()
    await page.locator('[data-plugin-id="audio-visualizer"]').getByRole('button', { name: await label(page, 'setting__plugins_update'), exact: true }).click()
    await page.waitForFunction(version => document.querySelector('[data-plugin-id="audio-visualizer"]')?.textContent.includes('v' + version), version)
    await assert.rejects(fs.stat(path.join(dataRoot, 'plugins', oldRegistry['audio-visualizer'].directory)), { code: 'ENOENT' })

    let picker = await openPicker(page)
    assert.equal(await picker.getByRole('radio').count(), 3)
    assert.equal(await picker.locator('[data-visualizer-surface="main"]').count(), 0)
    assert.equal(await picker.locator('[data-visualizer-option="radial"] input').isChecked(), true, 'the legacy ring style migrates to radial')
    await page.waitForTimeout(250)
    const previews = []
    for (const style of styles) previews.push(createHash('sha256').update(await picker.locator('[data-visualizer-preview="' + style + '"]').last().screenshot()).digest('hex'))
    assert.equal(new Set(previews).size, 3, 'each retained desktop style has a distinct preview')
    await page.setViewportSize({ width: 828, height: 540 })
    await picker.locator('[data-visualizer-option="spectrum"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(output, 'desktop-visualizer-settings.png') })
    for (const style of styles) {
      const card = await picker.locator('[data-visualizer-option="' + style + '"]').boundingBox()
      assert(card.x >= 0 && card.x + card.width <= 828, 'style cards fit the small settings view')
    }
    await page.setViewportSize({ width: 1114, height: 718 })
    await seedTrack(page)
    await page.evaluate(() => {
      Object.assign(window.lxData.musicInfo, { lrc: '[00:00.000]Desktop visualizer check\n[00:10.000]Player lyrics stay clear', lxlrc: '', tlrc: '', rlrc: '' })
      window.app_event.lyricUpdated()
    })
    await startSilentAudio(page)
    await choose(picker, 'radial')
    await page.evaluate(() => window.lxData.updateSetting({ 'desktopLyric.enable': true }))
    const desktop = app.windows().find(window => window.url().includes('lyric.html')) ?? await app.waitForEvent('window', { predicate: window => window.url().includes('lyric.html') })
    for (const style of styles) {
      await choose(picker, style)
      await desktop.locator('[data-plugin-visualizer="desktop"][data-visualizer-style="' + style + '"]').waitFor({ timeout: 20000 })
      await hasPixels(desktop, '[data-plugin-visualizer="desktop"] canvas')
      if (style === 'radial') {
        assert.equal(await desktop.locator('[data-plugin-visualizer="desktop"] canvas').getAttribute('data-visualizer-engine'), 'audioMotion-4.5.4')
        assert(await page.evaluate(() => window.__visualizerAnalysers.some(node => node.fftSize === 8192 && !node.__disconnected)))
      }
    }
    await choose(picker, 'wave')
    await route(page, '/search')
    await settled(page)
    await showDetail(page, true)
    await settled(page)
    assert.equal(await page.locator('[data-plugin-visualizer="main"], [data-visualizer-dialog]').count(), 0)
    assert.equal(await page.locator('[data-player-detail]').getByRole('button', { name: await label(page, 'audio_visualization'), exact: true }).count(), 0)
    await page.evaluate(() => window.lxData.updateSetting({ 'desktopLyric.audioVisualization': false, 'desktopLyric.enable': false }))
    await page.waitForFunction(() => window.__visualizerAnalysers.every(analyser => analyser.__disconnected))
    assert.equal(await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().paused), false, 'releasing visualizers keeps playback running')
    assert.equal(await page.evaluate(() => window.lxData.appSetting['player.audioVisualization']), true, 'an obsolete main preference cannot retain an analyser')

    picker = await openPicker(page)
    await hasPixels(page, '[data-plugin-settings="audio-visualizer"] [data-visualizer-preview="wave"]')
    await page.evaluate(() => require('electron').ipcRenderer.invoke('optional_plugins:uninstall', 'audio-visualizer'))
    await picker.waitFor({ state: 'detached' })
    await page.waitForFunction(() => window.__visualizerAnalysers.every(analyser => analyser.__disconnected))
    const preferencesFile = path.join(dataRoot, 'plugins/preferences/audio-visualizer.json')
    assert.deepEqual(JSON.parse(await fs.readFile(preferencesFile, 'utf8')), { version: 1, main: 'spectrum', desktop: 'wave' })
    await page.evaluate(() => window.__lxPluginHost.player.setStop())
    await openStore(page)
    await install(page, 'audio-visualizer')
    await route(page, '/search')
    assert.deepEqual(fixture.errors, [])
    await closeFixture(fixture)

    fixture = await launch({ ...launchOptions, profilePath: output })
    ;({ app, page } = fixture)
    page.setDefaultTimeout(12000)
    await mockGitHub(app, true)
    picker = await openPicker(page)
    assert.equal(await picker.locator('[data-visualizer-option="wave"] input').isChecked(), true, 'desktop style survives an offline restart')
    assert.equal(await picker.locator('[data-visualizer-surface="main"]').count(), 0)
    await page.evaluate(() => window.lxData.updateSetting({ 'common.langId': 'en-us' }))
    await picker.getByRole('radio', { name: 'Flowing waves', exact: true }).waitFor()
    assert.deepEqual(fixture.errors, [])
    console.log('Desktop visualization upgrade and lyric exclusion verified:', output)
  } catch (error) {
    console.error('Visualizer test profile:', output, 'Renderer errors:', fixture.errors)
    await fixture.page.screenshot({ path: path.join(output, 'failure-main.png') }).catch(() => {})
    const desktop = fixture.app.windows().find(window => window.url().includes('lyric.html'))
    await desktop?.screenshot({ path: path.join(output, 'failure-desktop.png') }).catch(() => {})
    console.error('Visualizer state:', await fixture.page.evaluate(() => ({
      desktopEnabled: window.lxData.appSetting['desktopLyric.enable'],
      desktopVisualization: window.lxData.appSetting['desktopLyric.audioVisualization'],
      muted: window.__lxPluginHost.player.getAudioElement().muted,
      paused: window.__lxPluginHost.player.getAudioElement().paused,
      context: window.__lxPluginHost.player.getAudioContext().state,
      analysers: window.__visualizerAnalysers?.map(node => ({ fftSize: node.fftSize, disconnected: node.__disconnected })),
    })).catch(() => null))
    throw error
  } finally {
    await closeFixture(fixture)
  }
})
