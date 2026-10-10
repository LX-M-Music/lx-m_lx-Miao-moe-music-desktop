const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route } = require('./helpers/motion-fixture.cjs')

const close = async app => {
  let timer
  try {
    await Promise.race([app.close(), new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('Electron close timed out')), 15000) })])
  } catch (error) { app.process().kill(); throw error } finally { clearTimeout(timer) }
}
const openSettings = async page => {
  await route(page, '/setting?name=SettingUpdate')
  await page.locator('[data-update-mirror]').waitFor()
}
const mirrorControl = page => page.locator('[data-update-mirror]').getByRole('checkbox')
const waitSetting = async(page, value) => {
  await page.waitForFunction(value => window.lxData.appSetting['common.useUpdateMirror'] === value, value)
  assert.equal(await mirrorControl(page).getAttribute('aria-checked'), String(value))
}
const showUpdate = async page => {
  await page.evaluate(() => {
    const ipc = require('electron').ipcRenderer
    if (!window.__mirrorUpdateRequests) {
      window.__mirrorUpdateRequests = []
      const send = ipc.send.bind(ipc)
      ipc.send = (channel, ...args) => {
        // Keep the renderer flow intact, while preventing real update installation.
        if (channel === 'winMain_update_download_update') window.__mirrorUpdateRequests.push(args[0])
        else send(channel, ...args)
      }
    }
    const state = window.lxData.versionInfo
    state.newVersion = {
      version: '9.0.0',
      desc: '## v9.0.0\n\n- 镜像源下载',
      history: [],
      downloadUrl: 'https://github.com/owner/repo/releases/download/v9.0.0/Setup.exe',
      fileName: 'LX-M-v9.0.0-x64-Setup.exe',
      size: 1000000,
      digest: 'sha256:' + 'a'.repeat(64),
      edition: 'installed',
    }
    Object.assign(state, { isLatest: false, isUnknown: false, reCheck: false, status: 'idle', showModal: true })
  })
  await page.getByRole('button', { name: '自动更新', exact: true }).waitFor()
}

test('mirror download preference is on by default, searchable, persisted and reflected in update actions', { timeout: 90000 }, async t => {
  let fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = fixture.output
  let { app, page } = fixture
  const errors = [...fixture.errors]
  const screenshots = path.resolve('output/playwright/update-mirror')
  await fs.mkdir(screenshots, { recursive: true })
  try {
    page.setDefaultTimeout(10000)
    await openSettings(page)
    await t.test('a fresh profile enables mirrors and settings search finds the checkbox', async() => {
      await waitSetting(page, true)
      assert.equal(await mirrorControl(page).getAttribute('aria-label'), '镜像源下载')
      assert.equal(await app.evaluate(() => global.lx.appSetting['common.useUpdateMirror']), true)
      const search = page.getByPlaceholder(await page.evaluate(() => window.i18n.t('setting__filter_placeholder')), { exact: true })
      await search.fill('镜像源下载')
      await mirrorControl(page).waitFor()
      await search.fill('')
      await page.screenshot({ path: path.join(screenshots, 'default-mirrors.png') })
    })
    await t.test('keyboard toggling saves the GitHub choice in the main process', async() => {
      await mirrorControl(page).press('Space')
      await waitSetting(page, false)
      assert.equal(await app.evaluate(() => global.lx.appSetting['common.useUpdateMirror']), false)
      await page.screenshot({ path: path.join(screenshots, 'github-selected.png') })
    })
    await t.test('GitHub downloads start directly and the modal explains the chosen source', async() => {
      await showUpdate(page)
      await page.getByText(/点击“自动更新”后直接从 GitHub 下载更新/).waitFor()
      await page.getByRole('button', { name: '自动更新', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '正在下载更新' }).waitFor()
      assert.equal(await page.evaluate(() => window.lxData.versionInfo.status), 'downloading')
      assert.equal(await page.evaluate(() => window.__mirrorUpdateRequests.at(-1).installAfterDownload), true)
      assert.equal(await page.getByRole('status').filter({ hasText: '正在测速更新节点' }).count(), 0)
      await page.screenshot({ path: path.join(screenshots, 'github-download.png') })
      await page.getByRole('button', { name: '暂不更新', exact: true }).click()
      await page.getByRole('button', { name: '自动更新', exact: true }).waitFor({ state: 'hidden' })
    })
    errors.push(...fixture.errors)
    await close(app)
    fixture = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') })
    ;({ app, page } = fixture)
    page.setDefaultTimeout(10000)
    await openSettings(page)
    await t.test('the unchecked choice survives restarting the application', async() => {
      await waitSetting(page, false)
      assert.equal(await app.evaluate(() => global.lx.appSetting['common.useUpdateMirror']), false)
    })
    await t.test('reenabling mirrors starts node testing and explains mirror downloads', async() => {
      await mirrorControl(page).press('Space')
      await waitSetting(page, true)
      await showUpdate(page)
      await page.getByText(/点击“自动更新”后先测速并从镜像源下载更新/).waitFor()
      await page.getByRole('button', { name: '自动更新', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '正在测速更新节点' }).waitFor()
      assert.equal(await page.evaluate(() => window.lxData.versionInfo.status), 'testing')
      await page.getByRole('button', { name: '暂不更新', exact: true }).click()
      await page.getByRole('button', { name: '自动更新', exact: true }).waitFor({ state: 'hidden' })
    })
    assert.deepEqual([...errors, ...fixture.errors], [])
  } finally { await close(app) }
})
