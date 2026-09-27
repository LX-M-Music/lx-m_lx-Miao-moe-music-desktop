const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { packSource } = require('../src/common/pluginSource')
const { test } = require('node:test')
const { launch, showDetail, settled } = require('./helpers/motion-fixture.cjs')
const { catalogRoot, mockGitHub, openStore, install, label } = require('./helpers/plugin-fixture.cjs')

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
async function plugin(id, version) {
  const files = {
    'src/index.js': Buffer.from(`import './style.css'; const {h, ref} = window.__lxPluginHost.vue;
const id = ${JSON.stringify(id)}, version = ${JSON.stringify(version)}, enabled = ref(false);
export default {
  activate(context) {
    (window.__catalogPluginEvents ??= []).push({ id, version, action: 'activate', apiVersion: context.apiVersion });
    return () => window.__catalogPluginEvents.push({ id, version, action: 'deactivate' });
  },
  components: { Settings: { setup: () => () => h('div', { 'data-dynamic-settings': id }, version) } },
  slots: { playDetailControls: { setup: () => () => h('button', { 'data-dynamic-control': id, onClick: () => enabled.value = !enabled.value }, 'D') } },
  playDetail: { enabled, component: { setup: () => () => h('div', { 'data-dynamic-player': id }, 'Remote lyrics ' + version) } }
};`),
    'src/lyric.js': Buffer.from(`const {h} = window.__lxPluginHost.vue;
export default { components: {}, slots: { desktopLyricOverlay: { setup: () => () => h('div', { 'data-dynamic-desktop': ${JSON.stringify(id)}, style: 'position:absolute;inset:0;color:red;pointer-events:none' }, ${JSON.stringify(version)}) } } };`),
    'src/style.css': Buffer.from('[data-dynamic-settings] { padding: 12px; }'),
  }
  const display = { name: { 'zh-cn': '线上新插件', 'en-us': 'A new remote plugin' }, description: { 'zh-cn': '从目录动态发现的插件', 'en-us': 'Discovered from the catalog' }, icon: '#icon-lyric' }
  const manifest = { id, version, apiVersion: 2, ...display, entry: 'src/index.js', lyricEntry: 'src/lyric.js' }
  const bytes = await packSource(manifest, new Map(Object.entries(files)))
  return { bytes: bytes.toString('base64'), entry: { id, version, apiVersion: 2, ...display, path: `${id}/${version}/${hash(bytes)}.zip`, bytes: bytes.length, sha256: hash(bytes) } }
}
const publish = (app, catalog, packages = []) => app.evaluate((_electron, { catalog, packages }) => {
  global.__pluginOffline = false
  global.__pluginCatalogOverride = catalog
  for (const item of packages) global.__pluginPackageOverrides[item.entry.path] = item.bytes
}, { catalog, packages })
const refresh = async page => {
  const button = page.getByRole('button', { name: await label(page, 'setting__plugins_refresh'), exact: true })
  await button.click()
  await button.waitFor()
}

test('a running host discovers unknown plugins, mounts their UI and updates them without a host build', { timeout: 90000 }, async t => {
  const originalCatalog = JSON.parse(await fs.readFile(path.join(catalogRoot, 'catalog.json'), 'utf8'))
  const id = 'new-plugin-' + randomUUID().slice(0, 8)
  const first = await plugin(id, '1.0.0')
  const next = await plugin(id, '1.1.0')
  const hostBefore = hash(await fs.readFile('dist/main.js'))
  let fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = fixture.output
  let { app, page } = fixture
  const pid = app.process().pid
  try {
    page.setDefaultTimeout(10000)
    await mockGitHub(app)
    await openStore(page)
    assert.equal(await page.locator(`[data-plugin-id="${id}"]`).count(), 0)
    await t.test('refresh discovers a new ID and localized metadata from the catalog', async() => {
      await publish(app, { ...originalCatalog, plugins: [...originalCatalog.plugins, first.entry] }, [first])
      await refresh(page)
      const card = page.locator(`[data-plugin-id="${id}"]`)
      assert.equal(await card.locator('h3').innerText(), '线上新插件')
      assert.equal(await page.getByRole('tab', { name: '线上新插件', exact: true }).count(), 0)
      await install(page, id)
      await card.getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
      assert.equal(await page.locator(`[data-dynamic-settings="${id}"]`).innerText(), '1.0.0')
    })
    await t.test('installed plugin settings stay inside their searchable store card', async() => {
      const card = page.locator(`[data-plugin-id="${id}"]`)
      assert.equal(await card.locator(`[data-dynamic-settings="${id}"]`).innerText(), '1.0.0')
      assert.equal(await page.getByRole('tab', { name: '线上新插件', exact: true }).count(), 0)
      const search = page.getByRole('textbox', { name: await label(page, 'setting__filter_placeholder'), exact: true })
      await search.fill('从目录动态发现')
      assert.equal(await card.locator(`[data-dynamic-settings="${id}"]`).isVisible(), true)
      await search.fill('')
      await card.getByRole('button', { name: await label(page, 'setting__plugins_close_settings'), exact: true }).click()
      assert.equal(await card.locator(`[data-dynamic-settings="${id}"]`).count(), 0)
      await card.getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
    })
    await t.test('new plugins can contribute player controls, lyrics and desktop overlays', async() => {
      await showDetail(page, true)
      await settled(page)
      await page.locator(`[data-dynamic-control="${id}"]`).click()
      assert.equal(await page.locator(`[data-dynamic-player="${id}"]`).innerText(), 'Remote lyrics 1.0.0')
      await page.locator(`[data-dynamic-control="${id}"]`).click()
      await page.locator('[data-player-detail] .lyric').waitFor()
      await showDetail(page, false)
      await settled(page)
      await page.evaluate(() => window.lxData.updateSetting({ 'desktopLyric.enable': true, 'desktopLyric.pauseHide': false }))
      const desktop = app.windows().find(page => page.url().includes('lyric.html')) ?? await app.waitForEvent('window', { predicate: page => page.url().includes('lyric.html') })
      await desktop.locator(`[data-dynamic-desktop="${id}"]`).waitFor()
    })
    await t.test('a plugin update replaces code and settings in the same application process', async() => {
      await publish(app, { ...originalCatalog, plugins: [...originalCatalog.plugins, next.entry] }, [next])
      await refresh(page)
      await page.locator(`[data-plugin-id="${id}"]`).getByRole('button', { name: await label(page, 'setting__plugins_update'), exact: true }).click()
      await page.waitForFunction(id => document.querySelector(`[data-dynamic-settings="${id}"]`)?.textContent === '1.1.0', id)
      const desktop = app.windows().find(page => page.url().includes('lyric.html'))
      await desktop.waitForFunction(id => document.querySelector(`[data-dynamic-desktop="${id}"]`)?.textContent === '1.1.0', id)
      const events = await page.evaluate(() => window.__catalogPluginEvents)
      assert.deepEqual(events.map(event => [event.version, event.action]), [['1.0.0', 'activate'], ['1.0.0', 'deactivate'], ['1.1.0', 'activate']])
      assert.equal(events[0].apiVersion, 3)
      assert.equal(app.process().pid, pid)
      assert.equal(hash(await fs.readFile('dist/main.js')), hostBefore)
      assert.equal(await page.locator(`style[data-plugin="${id}"]`).count(), 1)
    })
    await t.test('incompatible future APIs keep the working installation and older catalogs do not offer downgrades', async() => {
      const incompatible = { ...next.entry, version: '2.0.0', apiVersion: 99, path: `${id}/2.0.0/${next.entry.sha256}.zip` }
      await publish(app, { ...originalCatalog, plugins: [...originalCatalog.plugins, incompatible] })
      await refresh(page)
      const card = page.locator(`[data-plugin-id="${id}"]`)
      assert.equal(await card.getByRole('button', { name: await label(page, 'setting__plugins_update'), exact: true }).isDisabled(), true)
      assert.equal(await page.locator(`[data-dynamic-settings="${id}"]`).innerText(), '1.1.0')
      await publish(app, { ...originalCatalog, plugins: [...originalCatalog.plugins, first.entry] })
      await refresh(page)
      assert.equal(await card.getByRole('button', { name: await label(page, 'setting__plugins_update'), exact: true }).count(), 0)
      await publish(app, { ...originalCatalog, plugins: [...originalCatalog.plugins, next.entry] })
      await refresh(page)
    })
    assert.deepEqual(fixture.errors, [])
    await page.evaluate(() => window.lxData.updateSetting({ 'desktopLyric.enable': false }))
    await app.close()
    fixture = null
    fixture = await launch({ rendererPath: path.resolve('dist/index.html'), profilePath })
    ;({ app, page } = fixture)
    page.setDefaultTimeout(10000)
    await mockGitHub(app, true)
    await openStore(page)
    await t.test('an offline restart restores new plugin metadata and code from disk', async() => {
      const card = page.locator(`[data-plugin-id="${id}"]`)
      assert.equal(await card.locator('h3').innerText(), '线上新插件')
      assert.equal(await page.getByRole('tab', { name: '线上新插件', exact: true }).count(), 0)
      await card.getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
      assert.equal(await page.locator(`[data-dynamic-settings="${id}"]`).innerText(), '1.1.0')
      assert.equal(hash(await fs.readFile('dist/main.js')), hostBefore)
    })
    await t.test('a delisted plugin stays manageable and unloads all contributions', async() => {
      await publish(app, originalCatalog)
      await refresh(page)
      const card = page.locator(`[data-plugin-id="${id}"]`)
      assert.equal(await card.locator('h3').innerText(), '线上新插件')
      await card.getByText(await label(page, 'setting__plugins_removed'), { exact: true }).waitFor()
      await card.getByRole('button', { name: await label(page, 'setting__plugins_uninstall'), exact: true }).click()
      await card.waitFor({ state: 'detached' })
      assert.equal(await page.getByRole('tab', { name: '线上新插件', exact: true }).count(), 0)
      assert.equal(await page.locator(`[data-dynamic-settings="${id}"]`).count(), 0)
      assert.equal(await page.locator(`style[data-plugin="${id}"]`).count(), 0)
      await showDetail(page, true)
      await settled(page)
      assert.equal(await page.locator(`[data-dynamic-control="${id}"]`).count(), 0)
    })
    assert.deepEqual(fixture.errors, [])
  } catch (error) {
    console.error('Dynamic plugin profile:', profilePath)
    console.error('Cards:', await page.locator('[data-plugin-id]').allTextContents().catch(() => []))
    throw error
  } finally { if (fixture) await fixture.app.close() }
})
