const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

const rendererPath = path.resolve('dist/index.html')
const invoke = (page, channel, params) => page.evaluate(({ channel, params }) => require('electron').ipcRenderer.invoke(channel, params), { channel, params })
const readSongs = (page, id) => invoke(page, 'player_list_music_get', id)
const first = { id: 'wy_history_add_first', name: '历史添加歌曲一', singer: '测试歌手', source: 'wy', interval: '03:00', meta: { songId: 'history_add_first', albumName: '测试专辑', qualitys: [], _qualitys: {} } }
const second = { ...first, id: 'wy_history_add_second', name: '历史添加歌曲二', meta: { ...first.meta, songId: 'history_add_second' } }
const emptyLists = { defaultList: [], loveList: [], tempList: [], userList: [] }
const seedHistory = async fixture => {
  await invoke(fixture.page, 'player_list_data_overwire', emptyLists)
  await fixture.app.evaluate(async(_electron, tracks) => {
    const time = Date.now() - 10000
    await global.lx.worker.dbService.recordListening(tracks[0], time)
    await global.lx.worker.dbService.recordListening(tracks[0], time + 1000)
    await global.lx.worker.dbService.recordListening(tracks[1], time + 2000)
  }, [first, second])
}
const openAdd = async(page, { multiple = false } = {}) => {
  await route(page, '/list?id=history')
  await settled(page)
  const rows = page.locator('[data-listening-history] [data-history-id]')
  await rows.first().waitFor()
  if (multiple) {
    await rows.first().click({ modifiers: ['Control'] })
    await rows.nth(1).click({ modifiers: ['Control'] })
    await rows.nth(2).click({ modifiers: ['Control'] })
  }
  await rows.first().click({ button: 'right' })
  await page.getByRole('tab', { name: '添加到...', exact: true }).click()
  const destination = page.getByRole('button', { name: multiple ? '把这些歌曲添加到「试听列表」' : '把该歌曲添加到「试听列表」', exact: true })
  await destination.waitFor()
  return destination
}

test('listening history adds single and selected songs to every playlist destination and persists them', { timeout: 120000 }, async t => {
  let fixture = await launch({ rendererPath })
  const profilePath = fixture.output
  let createdId
  try {
    fixture.page.setDefaultTimeout(8000)
    await fixture.page.evaluate(() => {
      const ipc = require('electron').ipcRenderer
      const original = ipc.invoke.bind(ipc)
      window.__historyAddFailures = []
      ipc.invoke = async(channel, ...args) => {
        try { return await original(channel, ...args) } catch (cause) {
          if (channel === 'player_list_music_add') window.__historyAddFailures.push(cause.message)
          throw cause
        }
      }
    })
    await seedHistory(fixture)
    const addTo = async(name, { multiple = false } = {}) => {
      await openAdd(fixture.page, { multiple })
      await fixture.page.getByRole('button', { name: `${multiple ? '把这些歌曲' : '把该歌曲'}添加到「${name}」`, exact: true }).click()
      await fixture.page.getByRole('button', { name: `${multiple ? '把这些歌曲' : '把该歌曲'}添加到「${name}」`, exact: true }).waitFor({ state: 'hidden' })
    }
    const assertVisible = async(id, expected) => {
      const persisted = await readSongs(fixture.page, id)
      const failures = await fixture.page.evaluate(() => window.__historyAddFailures ?? [])
      assert.deepEqual(persisted.map(song => song.id).sort(), expected.map(song => song.id).sort(), `SQLite songs in ${id}; add failures: ${JSON.stringify(failures)}`)
      for (const song of expected) assert.deepEqual(persisted.find(item => item.id === song.id), song)
      await route(fixture.page, `/list?id=${id}`)
      for (const song of expected) await fixture.page.locator(`#my-list [data-song-id="${song.id}"]`).waitFor()
    }

    await addTo('试听列表')
    await assertVisible('default', [second])
    await addTo('我的收藏')
    await assertVisible('love', [second])
    const trialButton = await openAdd(fixture.page)
    const addDialog = fixture.page.locator('main').filter({ has: trialButton })
    await addDialog.getByRole('button', { name: '新建列表', exact: true }).click()
    const input = fixture.page.getByPlaceholder('新列表...')
    await input.fill('历史添加新歌单')
    await input.press('Enter')
    const button = fixture.page.getByRole('button', { name: '把该歌曲添加到「历史添加新歌单」', exact: true })
    await button.waitFor()
    const lists = await invoke(fixture.page, 'player_list_get')
    createdId = lists.find(list => list.name === '历史添加新歌单').id
    await button.click()
    await button.waitFor({ state: 'hidden' })
    await assertVisible(createdId, [second])
    for (const [id, name] of [['default', '试听列表'], ['love', '我的收藏'], [createdId, '历史添加新歌单']]) {
      await addTo(name, { multiple: true })
      await assertVisible(id, [first, second])
    }
    assert.deepEqual(fixture.errors, [])
    await fixture.app.close()
    fixture = await launch({ rendererPath, profilePath })
    await t.test('all three playlists retain their songs after restarting Electron', async() => {
      for (const id of ['default', 'love', createdId]) await assertVisible(id, [first, second])
    })
    assert.deepEqual(fixture.errors, [])
    console.log('Listening history add profile: ' + profilePath)
  } finally { await fixture.app.close() }
})

test('single and multiple add dialogs wait for writes and retain songs after a failed write', { timeout: 60000 }, async t => {
  const fixture = await launch({ rendererPath })
  try {
    fixture.page.setDefaultTimeout(8000)
    await seedHistory(fixture)
    await fixture.page.evaluate(() => { window.lxData.appSetting['common.showErrorDialog'] = true })
    for (const multiple of [false, true]) {
      await t.test(multiple ? 'multiple songs remain selected until a retry succeeds' : 'a single song can be retried after failure', async() => {
        await invoke(fixture.page, 'player_list_data_overwire', emptyLists)
        const destination = await openAdd(fixture.page, { multiple })
        await fixture.page.evaluate(() => {
          const ipc = require('electron').ipcRenderer
          window.__historyOriginalInvoke = ipc.invoke.bind(ipc)
          window.__historyWriteCalls = 0
          window.__historyPendingWrite = null
          ipc.invoke = (channel, ...args) => {
            if (channel !== 'player_list_music_add') return window.__historyOriginalInvoke(channel, ...args)
            window.__historyWriteCalls++
            return new Promise((_resolve, reject) => { window.__historyPendingWrite = { reject } })
          }
        })
        await destination.click()
        await fixture.page.waitForFunction(() => window.__historyPendingWrite != null)
        assert.equal(await destination.isVisible(), true, 'the add dialog must remain visible while the write is pending')
        assert.equal(await destination.isDisabled(), true, 'pending writes disable duplicate submissions')
        await destination.evaluate(element => element.click())
        assert.equal(await fixture.page.evaluate(() => window.__historyWriteCalls), 1)
        assert.deepEqual(await readSongs(fixture.page, 'default'), [])
        await fixture.page.evaluate(() => { window.__historyPendingWrite.reject(new Error('测试写入失败')) })
        const errorMessage = fixture.page.locator('main').filter({ hasText: 'LIST_MUSIC_ADD_FAILED' })
        await errorMessage.waitFor()
        assert.match(await errorMessage.innerText(), /测试写入失败/)
        assert.equal(await destination.isVisible(), true, 'failure must not close the add dialog')
        assert.equal(await destination.isEnabled(), true, 'failure must allow retry')
        if (multiple) assert.equal(await fixture.page.locator('[data-listening-history] [data-history-id].active').count(), 3)
        assert.deepEqual(await readSongs(fixture.page, 'default'), [])
        await fixture.page.getByRole('button', { name: '是的', exact: true }).last().click()
        await errorMessage.waitFor({ state: 'hidden' })
        await fixture.page.evaluate(() => { require('electron').ipcRenderer.invoke = window.__historyOriginalInvoke })
        await destination.click()
        await destination.waitFor({ state: 'hidden' })
        assert.deepEqual((await readSongs(fixture.page, 'default')).map(song => song.id).sort(), (multiple ? [first.id, second.id] : [second.id]).sort())
        assert.equal(await fixture.page.locator('[data-listening-history] [data-history-id].active').count(), 0)
      })
    }
    assert.deepEqual(fixture.errors, [])
  } finally { await fixture.app.close() }
})
