const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, label, install, uninstall } = require('./helpers/plugin-fixture.cjs')

const mirrors = ['https://gh-proxy.com/', 'https://ghfast.top/', 'https://ghproxy.net/']
const official = 'https://raw.githubusercontent.com/Miao-moe/lx-m_lx-Miao-moe-music-desktop/master/plugins/store/'

test('plugin store mirror option routes catalog and packages through mirrors with a direct fallback', { timeout: 180000 }, async t => {
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  let { app, page } = fixture
  const output = path.resolve('output/playwright/plugin-mirror')
  await fs.mkdir(output, { recursive: true })
  const requests = () => app.evaluate(() => global.__pluginRequests.slice())
  const mirrorRequests = () => app.evaluate(() => global.__pluginMirrorRequests.slice())
  const resetRequests = () => app.evaluate(() => { global.__pluginRequests = []; global.__pluginMirrorRequests = [] })
  const revision = () => page.locator('[data-plugin-store-revision]').evaluate(element => Number(element.dataset.pluginStoreRevision))
  const waitRevision = async before => page.waitForFunction(before => Number(document.querySelector('[data-plugin-store-revision]').dataset.pluginStoreRevision) > before, before)
  const waitMirrorEnabled = async name => page.waitForFunction(name => {
    const element = [...document.querySelectorAll('[role="checkbox"]')].find(element => element.getAttribute('aria-label') === name)
    return element?.getAttribute('aria-disabled') === 'false'
  }, name)
  const waitRefreshEnabled = async name => page.waitForFunction(name => {
    const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === name)
    return button && !button.disabled
  }, name)
  try {
    page.setDefaultTimeout(12000)
    await mockGitHub(app)
    await page.evaluate(() => window.lxData.updateSetting({ 'common.langId': 'zh-cn' }))
    await openStore(page)
    const mirrorLabel = await label(page, 'setting__plugins_mirror')
    const mirrorCheckbox = page.getByRole('checkbox', { name: mirrorLabel, exact: true })
    const refreshButton = page.getByRole('button', { name: await label(page, 'setting__plugins_refresh'), exact: true })
    await page.waitForFunction(() => Number(document.querySelector('[data-plugin-store-revision]')?.dataset.pluginStoreRevision) >= 1)
    await waitMirrorEnabled(mirrorLabel)

    assert.equal(await mirrorCheckbox.getAttribute('aria-checked'), 'false')
    assert.deepEqual(await mirrorRequests(), [])
    assert((await requests()).every(url => url.startsWith(official)), 'the default store still uses the official source')

    await t.test('enabling the option refreshes the catalog through a mirror', async() => {
      await resetRequests()
      const before = await revision()
      await mirrorCheckbox.click()
      await page.waitForFunction(() => window.lxData.appSetting['plugin.useMirror'] === true)
      await waitRevision(before)
      const catalogRequests = (await mirrorRequests()).filter(url => url.endsWith('/catalog.json'))
      assert(catalogRequests.length > 0)
      assert(catalogRequests.every(url => mirrors.some(prefix => url.startsWith(prefix))))
      assert.equal(catalogRequests[0].startsWith(mirrors[0]), true, 'the first approved mirror is tried first')
      assert.equal((await requests()).some(url => url.startsWith(official) && url.endsWith('/catalog.json')), false)
      await page.locator('[data-plugin-store-revision] > div').first().screenshot({ path: path.join(output, 'header.png') })
    })

    await t.test('installing a plugin downloads the package through the mirror', async() => {
      await resetRequests()
      await install(page, 'audio-visualizer')
      const packages = (await requests()).filter(url => url.endsWith('.lxplugin'))
      assert(packages.length > 0)
      assert(packages.every(url => url.startsWith(mirrors[0])), `package source: ${packages}`)
      assert.equal((await requests()).some(url => url.startsWith(official)), false)
    })

    await t.test('an unavailable mirror falls back to the official source', async() => {
      await app.evaluate(() => { global.__pluginMirrorOffline = true })
      const offRevision = await revision()
      await mirrorCheckbox.click()
      await page.waitForFunction(() => window.lxData.appSetting['plugin.useMirror'] === false)
      await waitRevision(offRevision)
      await resetRequests()
      const onRevision = await revision()
      await waitMirrorEnabled(mirrorLabel)
      await mirrorCheckbox.click()
      await page.waitForFunction(() => window.lxData.appSetting['plugin.useMirror'] === true)
      await waitRevision(onRevision)
      assert((await mirrorRequests()).length >= mirrors.length, 'every mirror was attempted')
      assert.equal((await requests()).some(url => url.startsWith(official) && url.endsWith('/catalog.json')), true)
      assert.equal(await page.getByRole('status').filter({ hasText: await label(page, 'setting__plugins_catalog_error') }).count(), 0)
      await page.locator('[data-plugin-id="audio-visualizer"]').waitFor()

      await uninstall(page, 'audio-visualizer')
      await resetRequests()
      await install(page, 'audio-visualizer')
      assert.equal((await requests()).some(url => url.startsWith(official) && url.endsWith('.lxplugin')), true)
      assert.deepEqual(await mirrorRequests(), [], 'the failed mirror is skipped for the rest of the session')
    })

    await t.test('disabling the option returns to the official source', async() => {
      const offRevision = await revision()
      await waitMirrorEnabled(mirrorLabel)
      await mirrorCheckbox.click()
      await page.waitForFunction(() => window.lxData.appSetting['plugin.useMirror'] === false)
      await waitRevision(offRevision)
      await resetRequests()
      const refreshRevision = await revision()
      await waitRefreshEnabled(await label(page, 'setting__plugins_refresh'))
      await refreshButton.click()
      await waitRevision(refreshRevision)
      assert.equal((await mirrorRequests()).length, 0)
      assert((await requests()).some(url => url.startsWith(official) && url.endsWith('/catalog.json')))
    })

    assert.deepEqual(fixture.errors, [])
  } finally {
    await app.close()
  }
})
