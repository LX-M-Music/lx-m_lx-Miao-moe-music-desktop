const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { setTimeout: delay } = require('node:timers/promises')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')
const { createDAV, playlists, task, song } = require('./helpers/webdav-fixture.cjs')

const toggle = async(page, id) => page.locator('label[for="setting_sync_webdav_' + id + '"]').click()
const settingsPage = async page => {
  await route(page, '/setting?name=SettingSync')
  await page.locator('#sync_webdav').waitFor()
  await settled(page)
}

test('WebDAV UI persists config, syncs all categories, refreshes restored downloads and runs automatic sync outside settings', { timeout: 100000 }, async t => {
  const dav = await createDAV()
  t.after(() => dav.close())
  let fixture = await launch({ initializeMotion: false, rendererPath: path.resolve('dist/index.html') })
  t.after(async() => { if (fixture) await fixture.app.close() })
  const { app, page, errors, output } = fixture
  await app.evaluate(async(_, data) => {
    global.lx.event_app.update_config({ 'common.langId': 'zh-cn', 'cookie.wy': 'fixture-secret-cookie', 'download.enable': true })
    await global.lx.event_list.list_data_overwrite(data.playlists)
    await global.lx.worker.dbService.downloadListReplace(data.downloads)
  }, { playlists: playlists('ui-local'), downloads: [task('ui-history', true), task('ui-task')] })
  await settingsPage(page)
  await page.locator('#setting_sync_webdav_url').fill(dav.config.url)
  await page.locator('#setting_sync_webdav_username').fill(dav.config.username)
  await page.locator('#setting_sync_webdav_password').fill(dav.config.password)
  assert.equal(await page.locator('#setting_sync_webdav_password').getAttribute('type'), 'password')
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '连接成功' }).waitFor()
  assert.equal(dav.files.size, 0)
  assert.equal(await app.evaluate(() => global.lx.appSetting['sync.webdav.password']), dav.config.password)

  for (const id of ['enable', 'downloadHistory', 'downloadTasks', 'settings', 'dislike']) await toggle(page, id)
  await page.getByRole('button', { name: '立即同步', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '上传 5 项' }).waitFor()
  const cloud = JSON.parse(dav.files.get(dav.file)).data
  assert.equal(JSON.parse(dav.files.get(dav.playlistFile)).data.defaultList[0].id, 'wy_ui-local')
  assert.equal(cloud.downloadTasks[0].status, 'pause')
  assert(!dav.files.get(dav.file).includes('fixture-secret-cookie') && !dav.files.get(dav.playlistFile).includes('fixture-secret-cookie'))

  // Open the downloads view before restoring so this checks the live renderer cache too.
  await route(page, '/download')
  await page.getByText(/^Song ui-task/).first().waitFor()
  await settingsPage(page)
  const remotePlaylists = playlists('ui-remote')
  remotePlaylists.userList.push({ id: 'custom-webdav-list', name: 'WebDAV 测试歌单', locationUpdateTime: null, list: [song('custom-song')] })
  dav.seed({ playlists: remotePlaylists, downloadHistory: [task('remote-history', true)], downloadTasks: [task('remote-task')], settings: { 'player.volume': 0.25 }, dislike: 'Remote rule' })
  await page.getByRole('button', { name: '从云端下载', exact: true }).click()
  await page.getByText('将用云端数据覆盖本机的以下项目：', { exact: false }).waitFor()
  await page.getByRole('button', { name: '从云端下载', exact: true }).last().click()
  await page.getByRole('status').filter({ hasText: '下载 5 项' }).waitFor()
  assert.equal(await app.evaluate(() => global.lx.appSetting['player.volume']), 0.25)
  assert.equal(await app.evaluate(() => global.lx.appSetting['sync.webdav.password']), dav.config.password)
  assert.equal(await page.evaluate(() => window.lxData.userLists.find(list => list.id === 'custom-webdav-list')?.name), 'WebDAV 测试歌单')
  const tasks = await app.evaluate(async() => global.lx.worker.dbService.getDownloadList())
  assert.equal(tasks.find(item => item.id === 'task_remote-task').status, 'pause')
  assert(tasks.every(item => !item.metadata.filePath && !item.metadata.url))
  await route(page, '/download')
  await page.getByText(/^Song remote-task/).first().waitFor()
  assert.equal(await page.getByText(/^Song ui-task/).count(), 0)

  await settingsPage(page)
  await toggle(page, 'downloadTasks')
  await toggle(page, 'auto')
  await page.locator('#setting_sync_webdav_interval').fill('0')
  await page.locator('#setting_sync_webdav_interval').press('Tab')
  assert(Number(await page.locator('#setting_sync_webdav_interval').inputValue()) >= 1)
  await page.locator('#sync_webdav').locator('..').screenshot({ path: path.resolve('logs/webdav-settings.png') })
  await route(page, '/search')
  await app.evaluate(async(_, lists) => { await global.lx.event_list.list_data_overwrite(lists) }, playlists('automatic-edit'))
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    if (JSON.parse(dav.files.get(dav.playlistFile)).data.defaultList[0].id === 'wy_automatic-edit') break
    await delay(200)
  }
  const automatic = JSON.parse(dav.files.get(dav.file)).data
  assert.equal(JSON.parse(dav.files.get(dav.playlistFile)).data.defaultList[0].id, 'wy_automatic-edit')
  assert.equal(automatic.downloadTasks[0].id, 'task_remote-task')

  await settingsPage(page)
  await toggle(page, 'auto')
  assert.deepEqual(errors, [])
  assert.deepEqual(dav.errors, [])
  await app.close()
  fixture = null
  fixture = await launch({ initializeMotion: false, rendererPath: path.resolve('dist/index.html'), profilePath: output })
  await settingsPage(fixture.page)
  assert.equal(await fixture.page.locator('#setting_sync_webdav_url').inputValue(), dav.config.url)
  assert.equal(await fixture.page.locator('#setting_sync_webdav_password').inputValue(), dav.config.password)
  assert.equal(await fixture.page.locator('#setting_sync_webdav_downloadTasks').isChecked(), false)
  assert.equal(await fixture.page.locator('#setting_sync_webdav_downloadHistory').isChecked(), true)
  const restoredHistory = await fixture.app.evaluate(async() => (await global.lx.worker.dbService.getDownloadList()).find(task => task.id === 'task_remote-history'))
  assert.equal(restoredHistory.progress, 100)
  assert.equal(restoredHistory.status, 'completed')
  assert.deepEqual(fixture.errors, [])
})
