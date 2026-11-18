const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const zlib = require('node:zlib')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')
const { song } = require('./helpers/webdav-fixture.cjs')

const settingsPage = async page => { await route(page, '/setting?name=SettingBackup'); await page.locator('#backup_all').waitFor(); await settled(page) }
const selectSave = (app, filename) => app.evaluate(({ dialog }, filename) => {
  dialog.showSaveDialog = async() => ({ canceled: false, filePath: filename })
}, filename)
const readExport = async filename => {
  for (let i = 0; i < 100; i++) {
    try {
      const bytes = await fs.readFile(filename)
      return JSON.parse(zlib.gunzipSync(bytes).toString())
    } catch { await new Promise(resolve => setTimeout(resolve, 100)) }
  }
  throw new Error('compat export was not written: ' + filename)
}

test('compat export buttons write original LX 2.12.6 gzip backups', { timeout: 120000 }, async t => {
  const f = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profile = f.output
  const label = key => f.page.evaluate(key => window.i18n.t(key), key)
  const notice = () => f.page.locator('[data-backup-notice]')
  try {
    f.page.setDefaultTimeout(8000)
    await f.app.evaluate(async(_, input) => {
      await global.lx.event_app.update_config({
        'common.langId': 'zh-cn',
        'player.volume': 0.37,
        'cookie.wy': 'cookie-value',
        'sync.webdav.url': 'https://dav.example/private',
        'sync.webdav.username': 'alice',
        'sync.webdav.password': 'secret',
      })
      await global.lx.event_list.list_data_overwrite({
        defaultList: [input.defaultSong],
        loveList: [],
        tempList: [input.tempSong],
        userList: [{ id: 'saved-list', name: '备份歌单', locationUpdateTime: null, list: [input.savedSong] }],
      })
    }, { defaultSong: song('default'), tempSong: song('temp'), savedSong: song('saved') })
    await settingsPage(f.page)
    const compatHint = await label('setting__backup_compat_hint')
    const compatHintIcon = f.page.locator('#backup_all').locator('xpath=..').locator('.setting-actions .help-icon')
    await compatHintIcon.waitFor({ state: 'visible' })
    assert.equal(await compatHintIcon.count(), 1)
    assert.equal(await compatHintIcon.evaluate(element => element.tagName.toLowerCase()), 'svg')
    assert.equal(await compatHintIcon.getAttribute('aria-label'), compatHint)
    assert.equal((await compatHintIcon.getAttribute('aria-label')).includes('MusicFree'), true)

    const files = {}
    for (const [key, name] of [
      ['setting__backup_compat_export_list', 'list-compat.lxmc'],
      ['setting__backup_compat_export_setting', 'setting-compat.lxmc'],
      ['setting__backup_compat_export_all', 'all-compat.lxmc'],
    ]) {
      const filename = path.join(profile, name)
      await selectSave(f.app, filename)
      await f.page.getByRole('button', { name: await label(key), exact: true }).click()
      files[name] = await readExport(filename)
      await notice().filter({ hasText: await label('setting__backup_exported') }).waitFor()
    }

    const listExport = files['list-compat.lxmc']
    assert.equal(listExport.type, 'playList_v2')
    assert.deepEqual(listExport.data.map(list => list.id), ['default', 'love', 'saved-list'])
    assert.deepEqual(listExport.data.find(list => list.id === 'default').list.map(music => music.id), ['wy_default'])
    assert.deepEqual(listExport.data.find(list => list.id === 'saved-list').list.map(music => music.id), ['wy_saved'])

    const settingExport = files['setting-compat.lxmc']
    assert.equal(settingExport.type, 'setting_v2')
    assert.equal(settingExport.data['player.volume'], 0.37)
    for (const key of ['cookie.wy', 'sync.webdav.url', 'sync.webdav.username', 'sync.webdav.password']) {
      assert.equal(Object.hasOwn(settingExport.data, key), false, key + ' must not be exported')
    }

    const allExport = files['all-compat.lxmc']
    assert.equal(allExport.type, 'allData_v2')
    assert.deepEqual(Object.keys(allExport).sort(), ['playList', 'setting', 'type'])
    assert.deepEqual(allExport.playList.map(list => list.id), ['default', 'love', 'saved-list'])
    assert.equal(allExport.setting['player.volume'], 0.37)
    assert.equal(Object.hasOwn(allExport.setting, 'cookie.wy'), false)
    assert.equal(allExport.data, undefined)
    assert.equal(allExport.version, undefined)
    assert.deepEqual(f.errors, [])
  } finally { await f.app.close() }
})
