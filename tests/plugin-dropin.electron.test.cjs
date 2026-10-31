const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { packPlugin } = require('../src/common/pluginPackage')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')
const { label } = require('./helpers/plugin-fixture.cjs')

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const makePackage = (id, version) => {
  const data = Buffer.from(`module.exports.default = { components: {} } // ${version}`)
  const manifest = {
    id,
    version,
    apiVersion: 3,
    name: { 'zh-cn': '投放测试插件', 'en-us': 'Drop-in test plugin' },
    description: { 'zh-cn': '用于验证 Plugins 目录自动加载。' },
    entry: 'renderer.js',
    styles: [],
    files: [{ path: 'renderer.js', bytes: data.length, sha256: hash(data) }],
  }
  return packPlugin(manifest, [{ path: 'renderer.js', data }])
}
const waitFor = async(fn, timeout, label) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await fn().catch(() => null)
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

test('plugins dropped into the Plugins folder load on startup and keep their installed state', { timeout: 240000 }, async t => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-dropin-'))
  t.after(async() => { await fs.rm(profile, { recursive: true, force: true }) })
  const pluginDir = path.join(profile, 'Plugins')
  const registryPath = path.join(profile, 'portable/userData/LxDatas/plugins/installed.json')
  const statePath = path.join(profile, 'portable/userData/LxDatas/plugins/drop-in.json')
  const readRegistry = async() => JSON.parse(await fs.readFile(registryPath, 'utf8'))
  const readState = async() => JSON.parse(await fs.readFile(statePath, 'utf8'))
  const launchWith = (directory = pluginDir) => launch({ rendererPath: path.resolve('dist/index.html'), profilePath: profile, env: { LX_PLUGIN_DROPIN_DIR: directory } })
  const output = path.resolve('output/playwright/plugin-dropin')
  await fs.mkdir(output, { recursive: true })

  await fs.mkdir(pluginDir, { recursive: true })
  await fs.writeFile(path.join(pluginDir, 'dropin-check.lxplugin'), makePackage('dropin-check', '1.0.0'))
  let fixture = await launchWith()
  let { app, page } = fixture
  try {
    const installed = await waitFor(async() => (await readRegistry())['dropin-check'], 30000, 'the first drop-in import')
    assert.equal(installed.version, '1.0.0')
    const firstDirectory = installed.directory
    const firstState = await waitFor(async() => {
      const state = await readState()
      return state.files?.['dropin-check.lxplugin']?.status === 'installed' ? state : null
    }, 10000, 'the drop-in state file')
    assert.equal(firstState.files['dropin-check.lxplugin'].version, '1.0.0')
    assert.equal(firstState.files['dropin-check.lxplugin'].sha256, hash(await fs.readFile(path.join(pluginDir, 'dropin-check.lxplugin'))))

    await t.test('the imported plugin appears in the store as installed', async() => {
      await page.evaluate(() => window.lxData.updateSetting({ 'common.langId': 'zh-cn' }))
      await route(page, '/setting?name=SettingPluginStore')
      await settled(page)
      const card = page.locator('[data-plugin-id="dropin-check"]')
      await card.waitFor({ timeout: 20000 })
      const text = await card.textContent()
      assert.match(text, /1\.0\.0/)
      assert.equal(await card.locator('[data-plugin-status]').textContent(), await label(page, 'setting__plugins_installed'))
    })

    await t.test('the store button scans the folder again without restarting', async() => {
      await fs.writeFile(path.join(pluginDir, 'dropin-live.lxplugin'), makePackage('dropin-live', '1.0.0'))
      const checkButton = page.getByRole('button', { name: await label(page, 'setting__plugins_dropin_check'), exact: true })
      await checkButton.click()
      const liveCard = page.locator('[data-plugin-id="dropin-live"]')
      await liveCard.waitFor({ timeout: 20000 })
      assert.match(await liveCard.textContent(), /1\.0\.0/)
      await page.getByRole('status').filter({ hasText: '已从 Plugins 目录加载 1 个插件' }).waitFor()
      await checkButton.click()
      await page.getByRole('status').filter({ hasText: 'Plugins 目录没有需要加载的新插件' }).waitFor()
      await page.locator('[data-plugin-store-revision] > div').first().screenshot({ path: path.join(output, 'store-header.png') })
    })

    await t.test('restarting with an unchanged file does not reinstall it', async() => {
      const previousScan = firstState.lastScanAt
      await app.close()
      fixture = await launchWith()
      ;({ app, page } = fixture)
      await waitFor(async() => (await readState()).lastScanAt > previousScan, 20000, 'the second startup scan')
      const registry = await readRegistry()
      assert.equal(registry['dropin-check'].version, '1.0.0')
      assert.equal(registry['dropin-check'].directory, firstDirectory)
    })

    await t.test('a newer package upgrades the installed plugin', async() => {
      await app.close()
      await fs.writeFile(path.join(pluginDir, 'dropin-check.lxplugin'), makePackage('dropin-check', '2.0.0'))
      fixture = await launchWith()
      ;({ app, page } = fixture)
      const upgraded = await waitFor(async() => {
        const record = (await readRegistry())['dropin-check']
        return record?.version === '2.0.0' ? record : null
      }, 30000, 'the upgraded plugin')
      assert.notEqual(upgraded.directory, firstDirectory)
    })

    await t.test('a broken package is reported in the state file and does not block startup', async() => {
      const scanBeforeBroken = (await readState()).lastScanAt
      await app.close()
      await fs.writeFile(path.join(pluginDir, 'broken.lxplugin'), 'not a plugin package')
      fixture = await launchWith()
      ;({ app, page } = fixture)
      const state = await waitFor(async() => {
        const current = await readState()
        return current.lastScanAt > scanBeforeBroken ? current : null
      }, 20000, 'the scan containing the broken package')
      assert.equal(state.files['broken.lxplugin'].status, 'error')
      assert.equal((await readRegistry())['dropin-check'].version, '2.0.0')
      assert.deepEqual(fixture.errors, [])
    })

    await t.test('the folder is created when it does not exist', async() => {
      await app.close()
      const autoDirectory = path.join(profile, 'AutoPlugins')
      const scanBefore = (await readState()).lastScanAt
      fixture = await launchWith(autoDirectory)
      ;({ app, page } = fixture)
      await waitFor(async() => (await fs.stat(autoDirectory)).isDirectory(), 20000, 'the created drop-in folder')
      await waitFor(async() => (await readState()).lastScanAt > scanBefore, 20000, 'the scan of the new folder')
    })

    await t.test('unpackaged runs use the isolated app data folder', async() => {
      await app.close()
      const scanBefore = (await readState()).lastScanAt
      fixture = await launch({ rendererPath: path.resolve('dist/index.html'), profilePath: profile })
      ;({ app, page } = fixture)
      const dataDirectory = path.join(profile, 'portable/userData/Plugins')
      await waitFor(async() => (await fs.stat(dataDirectory)).isDirectory(), 20000, 'the data drop-in folder')
      await waitFor(async() => (await readState()).lastScanAt > scanBefore, 20000, 'the scan of the data folder')
    })
  } finally {
    await app.close()
  }
})
