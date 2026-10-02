const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route } = require('./helpers/motion-fixture.cjs')

test('update UI shows cancellable speed testing, indeterminate progress and the selected download node', { timeout: 45000 }, async(t) => {
  const { app, page, errors } = await launch()
  t.after(async() => { await app.close().catch(() => {}) })
  await page.waitForTimeout(3200) // Let the unrelated startup version check settle before injected states.
  await page.evaluate(() => {
    const ipc = require('electron').ipcRenderer
    const send = ipc.send.bind(ipc)
    window.__updateRequests = []
    // Intercept only this test's download action, so no release installer runs.
    ipc.send = (channel, ...args) => {
      if (channel === 'winMain_update_download_update') window.__updateRequests.push(args[0])
      else send(channel, ...args)
    }
    const state = window.lxData.versionInfo
    Object.assign(state.newVersion, {
      version: '9.0.0', desc: '## v9.0.0\n\n- 更新节点测速', history: [],
      downloadUrl: 'https://github.com/Miao-moe/lx-m_lx-Miao-moe-music-desktop/releases/download/v9.0.0/LX-M.Music-v9.0.0-x64-Setup.exe',
      fileName: 'LX-M.Music-v9.0.0-x64-Setup.exe', size: 1000000, digest: 'sha256:' + 'a'.repeat(64),
    })
    Object.assign(state, { isLatest: false, isUnknown: false, reCheck: false, status: 'idle', showModal: true })
  })
  const auto = page.getByRole('button', { name: '自动更新', exact: true })
  const later = page.getByRole('button', { name: '暂不更新', exact: true })
  const progress = page.getByRole('progressbar', { name: '更新进度' })
  const publish = async(info) => {
    const window = await app.browserWindow(page)
    await window.evaluate((window, info) => { window.webContents.send('winMain_update_progress', info) }, info)
    await window.dispose()
  }
  await auto.click()
  await page.getByRole('status').filter({ hasText: '正在测速更新节点' }).waitFor()
  assert(await auto.isDisabled())
  assert(await later.isEnabled())
  assert.equal(await progress.getAttribute('aria-valuenow'), null)
  assert.equal(await page.evaluate(() => window.__updateRequests[0].installAfterDownload), true)
  await publish({ phase: 'testing', progress: 0, transferred: 0, total: 0, bytesPerSecond: 0, testedSources: 12, totalSources: 155 })
  await page.getByText('已测试 12 / 155 个节点', { exact: true }).waitFor()
  const style = await page.locator('[data-update-progress]').evaluate(el => ({
    padding: parseFloat(getComputedStyle(el).paddingTop),
    trackWidth: el.children[1].clientWidth,
    fillWidth: el.children[1].children[0].clientWidth,
  }))
  assert(style.padding > 0, 'progress panel class must resolve to CSS rather than the animation name')
  assert(style.fillWidth > 0 && style.fillWidth < style.trackWidth / 2, 'testing must show an indeterminate segment, not a completed bar')
  const screenshots = path.resolve('logs/update-progress')
  await fs.mkdir(screenshots, { recursive: true })
  await page.screenshot({ path: path.join(screenshots, 'testing.png') })
  await later.click()
  await auto.waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => window.lxData.versionInfo.status), 'idle')
  await publish({ phase: 'testing', progress: 0, transferred: 0, total: 0, bytesPerSecond: 0, testedSources: 13, totalSources: 155 })
  assert.equal(await page.evaluate(() => window.lxData.versionInfo.status), 'idle', 'cancelled testing must ignore late progress')

  await page.evaluate(() => { window.lxData.versionInfo.showModal = true })
  await auto.click()
  await publish({ phase: 'downloading', progress: 37, transferred: 370000, total: 1000000, bytesPerSecond: 200000, source: 'fast.example.test' })
  await page.waitForFunction(() => document.querySelector('[data-update-progress] [role="progressbar"]')?.getAttribute('aria-valuenow') === '37')
  await page.locator('[data-update-progress]').getByText(/fast\.example\.test/).waitFor()
  assert(await auto.isDisabled())
  await later.click()
  await auto.waitFor({ state: 'hidden' })

  await page.evaluate(() => {
    window.lxData.versionInfo.newVersion.edition = 'portable'
    window.lxData.versionInfo.newVersion.differential = {
      manifest: { fileName: 'LX-M.Music-v9.0.0-win_x64-green-update.json', downloadUrl: 'https://example.test/update.json', size: 1024, digest: 'sha256:' + 'b'.repeat(64) },
      payload: { fileName: 'LX-M.Music-v9.0.0-win_x64-green-update.bin', downloadUrl: 'https://example.test/update.bin', size: 1000000, digest: 'sha256:' + 'c'.repeat(64) },
    }
    window.lxData.versionInfo.showModal = true
  })
  await page.getByText('当前版本类型：便携版', { exact: true }).waitFor()
  await auto.click()
  await publish({ phase: 'preparing', mode: 'differential', progress: 0, transferred: 0, total: 0, bytesPerSecond: 0, reusedBytes: 2000000 })
  await page.getByRole('status').filter({ hasText: '正在比对并复用本地文件' }).waitFor()
  assert(await auto.isDisabled())
  assert(await later.isEnabled())
  assert.equal(await progress.getAttribute('aria-valuenow'), null)
  await publish({ phase: 'downloading', mode: 'differential', progress: 37, transferred: 370000, total: 1000000, bytesPerSecond: 200000, reusedBytes: 2000000, source: 'fast.example.test' })
  await page.getByRole('status').filter({ hasText: '正在下载差分数据' }).waitFor()
  await page.locator('[data-update-progress]').getByText(/已复用/).waitFor()
  const editionRequest = await page.evaluate(() => window.__updateRequests.at(-1))
  assert.equal(editionRequest.edition, 'portable')
  assert.equal(editionRequest.differential.manifest.fileName, 'LX-M.Music-v9.0.0-win_x64-green-update.json')
  await page.screenshot({ path: path.join(screenshots, 'portable-differential.png') })
  await later.click()
  await auto.waitFor({ state: 'hidden' })

  await route(page, '/setting')
  await page.locator('[data-setting-tab="SettingUpdate"]').click()
  await page.waitForSelector('#update')
  await page.evaluate(() => { window.lxData.versionInfo.status = 'testing' })
  await publish({ phase: 'testing', progress: 0, transferred: 0, total: 0, bytesPerSecond: 0, testedSources: 20, totalSources: 155 })
  await page.getByText(/已测试 20 \/ 155 个节点/).waitFor()
  const setting = page.locator('#update + dd')
  assert.match(await setting.innerText(), /正在测速/)
  assert.doesNotMatch(await setting.innerText(), /正在下载/)
  assert.deepEqual(errors, [])
})
