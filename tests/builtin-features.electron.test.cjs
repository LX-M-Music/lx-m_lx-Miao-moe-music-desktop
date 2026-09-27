const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { test } = require('node:test')
const { launch, settled, seedTrack, showDetail } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, label, startSilentAudio } = require('./helpers/plugin-fixture.cjs')

const ids = ['sound-effects', 'audio-tag-editor']
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

test('built-in effects and tag editing work offline and supersede legacy packages without losing settings', { timeout: 120000 }, async t => {
  let fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = fixture.output
  let { app, page } = fixture
  const failures = []
  const capture = () => page.on('console', message => {
    if (message.type() === 'error' && /Built-in feature|Sound effect .*failed|Plugin .*failed/.test(message.text())) failures.push(message.text())
  })
  const cards = () => ids.map(id => page.locator(`[data-plugin-id="${id}"]`))
  const checkCards = async() => {
    for (const card of cards()) {
      assert.equal(await card.locator('[data-plugin-status]').innerText(), '自带')
      assert.equal(await card.getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).count(), 1)
    }
  }
  const set = values => page.evaluate(async values => {
    await require('electron').ipcRenderer.invoke('common_set_app_setting', values)
    Object.assign(window.lxData.appSetting, values)
  }, values)
  try {
    page.setDefaultTimeout(15000)
    capture()
    await mockGitHub(app, true)
    await t.test('a fresh offline profile has both built-in cards and working settings without package downloads', async() => {
      await openStore(page)
      await checkCards()
      assert.equal(await page.locator('[data-setting-tab="SettingPlugin_audio-tag-editor"]').count(), 0)
      assert.equal(await page.locator('[data-setting-tab="SettingPlugin_sound-effects"]').count(), 0)
      await cards()[0].getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
      await cards()[0].locator('[data-plugin-settings="sound-effects"]').waitFor()
      await cards()[0].getByRole('button', { name: await label(page, 'setting__plugins_close_settings'), exact: true }).click()
      await cards()[1].getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
      await cards()[1].locator('[data-audio-tag-editor]').waitFor()
      await cards()[1].getByRole('button', { name: await label(page, 'setting__plugins_close_settings'), exact: true }).click()
      await seedTrack(page)
      await page.evaluate(() => {
        window.lxData.musicInfo.lrc = '[00:00.00]Built-in audio check\n[00:01.00]Offline test signal'
        window.app_event.lyricUpdated()
      })
      await showDetail(page, true)
      await settled(page)
      const button = page.locator('[data-sound-effect-button]')
      assert.equal(await button.evaluate(element => element.previousElementSibling.querySelector('use').getAttribute('xlink:href')), '#icon-mini-player')
      await page.screenshot({ path: path.join(profilePath, 'builtin-sound-button.png') })
      await button.click()
      await page.locator('[data-plugin-sound-dialog]').waitFor()
      await page.screenshot({ path: path.join(profilePath, 'builtin-sound-panel.png') })
      await page.locator('[data-plugin-sound-dialog]').locator('..').getByRole('button', { name: await label(page, 'close'), exact: true }).click()
      await showDetail(page, false)
      const snapshot = await page.evaluate(() => require('electron').ipcRenderer.invoke('optional_plugins:list'))
      assert.deepEqual(snapshot.installed, {})
      assert.equal((await app.evaluate(() => global.__pluginRequests)).every(url => url.endsWith('/catalog.json')), true)
      await openStore(page)
      await page.screenshot({ path: path.join(profilePath, 'builtin-store-offline.png') })
    })
    await t.test('bundled EQ, reverb and pitch shifting process audio and are not duplicated by store refreshes', async() => {
      await page.evaluate(() => {
        window.__builtinAudio = { filters: [], convolvers: [], worklets: [] }
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
        for (const [method, collection] of [['createBiquadFilter', 'filters'], ['createConvolver', 'convolvers']]) {
          const original = AudioContext.prototype[method]
          AudioContext.prototype[method] = function(...args) {
            const node = original.apply(this, args)
            window.__builtinAudio[collection].push(node)
            return node
          }
        }
        const Worklet = window.AudioWorkletNode
        window.AudioWorkletNode = class extends Worklet {
          constructor(...args) { super(...args); window.__builtinAudio.worklets.push(this) }
        }
      })
      await set({ 'player.soundEffect.biquadFilter.hz1000': 6, 'player.soundEffect.convolution.fileName': 'filter-telephone.wav', 'player.soundEffect.pitchShifter.playbackRate': 1.25 })
      await startSilentAudio(page)
      await page.waitForFunction(() => window.__builtinAudio.filters.length === 10 && window.__builtinAudio.convolvers[0]?.buffer?.length > 0 && window.__builtinAudio.worklets.length === 1)
      assert.equal(await page.evaluate(() => window.__builtinAudio.filters[5].gain.value), 6)
      for (let i = 0; i < 3; i++) await page.evaluate(() => require('electron').ipcRenderer.invoke('optional_plugins:refresh'))
      assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(window.__builtinAudio).map(([key, value]) => [key, value.length]))), { filters: 10, convolvers: 1, worklets: 1 })
      assert.equal(await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().paused), false)
    })
    await t.test('old LXPlugin and ZIP packages cannot replace the built-in implementations', async() => {
      const catalog = require('../plugins/store/catalog.json')
      await app.evaluate(({ dialog }) => {
        global.__builtinImportConfirmations = 0
        dialog.showMessageBox = async() => { global.__builtinImportConfirmations++; return { response: 0 } }
      })
      for (const id of ids) {
        const entry = catalog.plugins.find(plugin => plugin.id === id)
        for (const filename of [entry.packages.lxplugin.path, entry.path]) {
          await app.evaluate(({ dialog }, filename) => {
            dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [filename] })
          }, path.resolve('plugins/store', filename))
          await page.getByRole('button', { name: await label(page, 'setting__plugins_import'), exact: true }).click()
          await page.locator('[data-plugin-transfer-status]').filter({ hasText: await label(page, 'setting__plugins_transfer_builtin') }).waitFor()
          await checkCards()
        }
      }
      assert.equal(await app.evaluate(() => global.__builtinImportConfirmations), 0)
      assert.equal(await page.evaluate(() => window.__builtinAudio.filters.length), 10)
    })

    const preset = { id: 'upgrade-test', name: '旧版个人均衡器', ...Object.fromEntries([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map(hz => [`hz${hz}`, hz === 1000 ? 6 : 0])) }
    const reverb = { id: 'upgrade-reverb', name: '旧版个人混响', source: 'filter-telephone.wav', mainGain: 8, sendGain: 2 }
    await page.evaluate(async({ preset, reverb }) => {
      const ipc = window.__lxPluginHost.ipc
      ipc.saveUserSoundEffectEQPresetList([preset])
      ipc.saveUserSoundEffectConvolutionPresetList([reverb])
      await ipc.getUserSoundEffectEQPresetList()
      await ipc.getUserSoundEffectConvolutionPresetList()
      window.__lxPluginHost.player.setStop()
    }, { preset, reverb })
    const dataRoot = await app.evaluate(() => global.lxDataPath)
    assert.deepEqual(fixture.errors, [])
    await app.close()
    fixture = null
    const root = path.join(dataRoot, 'plugins')
    const registry = {}
    for (const id of ids) {
      const directory = `${id}-${randomUUID()}`
      const data = Buffer.from('window.__legacyBuiltinLoaded = true; module.exports.default = { components: {} }')
      const manifest = Buffer.from(JSON.stringify({ id, version: '9.9.9', apiVersion: 3, entry: 'renderer.js', styles: [], files: [{ path: 'renderer.js', bytes: data.length, sha256: sha(data) }] }))
      await fs.mkdir(path.join(root, directory), { recursive: true })
      await fs.writeFile(path.join(root, directory, 'renderer.js'), data)
      await fs.writeFile(path.join(root, directory, 'manifest.json'), manifest)
      registry[id] = { directory, manifestHash: sha(manifest), source: 'local', format: 'lxplugin' }
    }
    const oldRegistry = JSON.stringify(registry)
    await fs.writeFile(path.join(root, 'installed.json'), oldRegistry)
    fixture = await launch({ rendererPath: path.resolve('dist/index.html'), profilePath })
    ;({ app, page } = fixture)
    capture()
    await mockGitHub(app, true)
    await t.test('an offline upgrade skips both legacy modules and retains settings and personal presets', async() => {
      await openStore(page)
      await checkCards()
      assert.equal(await page.evaluate(() => window.__legacyBuiltinLoaded), undefined)
      const state = await page.evaluate(async() => ({
        gain: window.lxData.appSetting['player.soundEffect.biquadFilter.hz1000'],
        reverb: window.lxData.appSetting['player.soundEffect.convolution.fileName'],
        pitch: window.lxData.appSetting['player.soundEffect.pitchShifter.playbackRate'],
        presets: await window.__lxPluginHost.ipc.getUserSoundEffectEQPresetList(),
        reverbs: await window.__lxPluginHost.ipc.getUserSoundEffectConvolutionPresetList(),
      }))
      assert.deepEqual(state, { gain: 6, reverb: 'filter-telephone.wav', pitch: 1.25, presets: [preset], reverbs: [reverb] })
      assert.equal(await fs.readFile(path.join(root, 'installed.json'), 'utf8'), oldRegistry)
      const snapshot = await page.evaluate(() => require('electron').ipcRenderer.invoke('optional_plugins:list'))
      assert.deepEqual(snapshot.installed, {})
      assert.deepEqual(snapshot.errors, {})
      await page.screenshot({ path: path.join(profilePath, 'builtin-store-upgrade.png') })
    })
    assert.deepEqual(fixture.errors, [])
    assert.deepEqual(failures, [])
    console.log('Built-in features verification:', profilePath)
  } finally { await fixture?.app.close() }
})
