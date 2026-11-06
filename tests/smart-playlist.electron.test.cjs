const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

const rendererPath = process.env.LX_TEST_USE_DEV_SERVER ? undefined : path.resolve('dist/index.html')
const DAY = 86400000
const invoke = (page, name, params) => page.evaluate(({ name, params }) => require('electron').ipcRenderer.invoke('player_' + name, params), { name, params })
const db = (app, sql, params = [], read = false) => app.evaluate(({ app }, { sql, params, read }) => {
  const require = process.mainModule.require('node:module').createRequire(app.getAppPath() + '/package.json')
  const Database = require('better-sqlite3')
  const connection = new Database(require('node:path').join(global.lxDataPath, 'lx.data.db'), { fileMustExist: true })
  try { return read ? connection.prepare(sql).all(...params) : connection.prepare(sql).run(...params) } finally { connection.close() }
}, { sql, params, read })

const song = (id, name, extra = {}) => ({
  id,
  name,
  singer: extra.singer ?? '测试歌手',
  source: 'local',
  interval: extra.interval ?? '03:00',
  meta: { songId: id, albumName: extra.album ?? '测试专辑', filePath: '', ext: 'mp3' },
})
const songs = [
  song('a', 'Alpha', { singer: 'Alice', album: 'First', interval: '03:00' }),
  song('b', 'Beta', { singer: 'Bob', album: 'Second', interval: '04:30' }),
  song('c', 'Gamma', { singer: 'Carol', album: 'Third', interval: '02:15' }),
  song('d', 'Delta', { singer: 'Dave', album: 'Fourth', interval: '05:00' }),
  song('e', 'Epsilon', { singer: 'Eve', album: 'Fifth', interval: '01:30' }),
]
const ids = values => values.map(value => value.id)
const pickOption = async(page, container, comboboxIndex, label) => {
  await container.locator('[role="combobox"]').nth(comboboxIndex).click()
  const option = page.locator('ul.selection-list li').filter({ hasText: label }).first()
  await option.waitFor()
  await option.click()
}

test('smart playlists are created, refreshed, filtered, refreshed manually and deleted without touching other lists', { timeout: 240000 }, async t => {
  let fixture = await launch({ rendererPath })
  const profilePath = fixture.output
  const now = Date.now()
  const reset = async() => {
    await invoke(fixture.page, 'list_data_overwire', {
      defaultList: songs,
      loveList: [songs[2]],
      tempList: [],
      userList: [{ id: 'source-list', name: '素材歌单', locationUpdateTime: null, list: songs }],
    })
  }
  try {
    fixture.page.setDefaultTimeout(12000)
    await reset()
    await fixture.app.evaluate(async(_electron, tracks) => {
      const dbService = global.lx.worker.dbService
      await dbService.recordListening(tracks[0], tracks[0].time)
      await dbService.recordListening(tracks[0], tracks[0].time + 1000)
      await dbService.recordListening(tracks[0], tracks[0].time + 2000)
      await dbService.recordListening(tracks[1], tracks[1].time)
      await dbService.recordListening(tracks[3], tracks[3].time)
    }, [
      { ...songs[0], time: now - DAY },
      { ...songs[1], time: now - 2 * DAY },
      { ...songs[2], time: now },
      { ...songs[3], time: now - 40 * DAY },
    ])

    await t.test('a version 7 database migrates to version 8 and keeps its playlists', async() => {
      await db(fixture.app, 'ALTER TABLE my_list DROP COLUMN smart_rule')
      await db(fixture.app, "UPDATE db_info SET field_value = '7' WHERE field_name = 'version'")
      assert.equal((await db(fixture.app, "SELECT COUNT(*) AS count FROM my_list WHERE id = 'source-list'", [], true))[0].count, 1)
      const profilePath = fixture.output
      const previousApp = fixture.app
      await previousApp.close()
      const restarted = await launch({ profilePath, rendererPath })
      // The previous Electron process is fully closed before the replacement starts.
      // eslint-disable-next-line require-atomic-updates
      fixture = restarted
      fixture.page.setDefaultTimeout(12000)
      assert.equal((await db(fixture.app, "SELECT field_value FROM db_info WHERE field_name = 'version'", [], true))[0].field_value, '8')
      const columns = await db(fixture.app, 'PRAGMA table_info(my_list)', [], true)
      assert.ok(columns.some(column => column.name === 'smart_rule'))
      assert.deepEqual(ids(await invoke(fixture.page, 'list_get')), ['source-list'])
      assert.deepEqual(ids(await invoke(fixture.page, 'list_music_get', 'source-list')), ids(songs))
    })

    await t.test('the sidebar creates a smart playlist through the rule editor', async() => {
      await route(fixture.page, '/list?id=source-list')
      await settled(fixture.page)
      await fixture.page.locator('[data-smart-playlist-create]').click()
      const modal = fixture.page.locator('[data-smart-playlist-modal]')
      await modal.waitFor()
      await modal.locator('input').first().fill('最近常听')

      const first = modal.locator('[data-smart-rule="0"]')
      await pickOption(fixture.page, first, 0, '播放次数')
      await first.locator('input[type="number"]').fill('0')

      await modal.getByRole('button', { name: '+ 添加条件' }).click()
      const second = modal.locator('[data-smart-rule="1"]')
      await pickOption(fixture.page, second, 0, '最后播放')
      await second.locator('input[type="number"]').fill('7')

      await fixture.page.waitForFunction(() => document.querySelector('[data-smart-playlist-preview]')?.textContent.includes('2 首歌曲'))
      await modal.locator('[data-smart-playlist-save]').click()
      await modal.waitFor({ state: 'hidden' })

      const lists = await invoke(fixture.page, 'list_get')
      const smart = lists.find(list => list.name === '最近常听')
      assert.ok(smart, 'the smart playlist must appear in the sidebar list data')
      const stored = await db(fixture.app, 'SELECT smart_rule FROM my_list WHERE id = ?', [smart.id], true)
      assert.ok(stored[0].smart_rule, 'the rule must be persisted in my_list.smart_rule')
      const storedRule = JSON.parse(stored[0].smart_rule)
      assert.equal(storedRule.version, 1)
      assert.equal(storedRule.groups[0].rules[0].field, 'playCount')
      assert.equal(storedRule.groups[0].rules[1].field, 'lastPlayed')
      assert.deepEqual((await invoke(fixture.page, 'list_smart_get'))[smart.id].groups[0].rules[1].value, 7)
      fixture.smartListId = smart.id
    })

    await t.test('opening a smart playlist refreshes it and shows only matching songs', async() => {
      const listId = fixture.smartListId
      assert.ok(listId, 'previous subtest must have created the smart playlist')
      await route(fixture.page, '/list?id=' + listId)
      await settled(fixture.page)
      await fixture.page.waitForFunction(() => {
        const rows = Array.from(document.querySelectorAll('#view .list-item[data-song-id]'))
        return rows.length === 2 && rows.every(row => ['a', 'b'].includes(row.dataset.songId))
      })
      assert.deepEqual(ids(await invoke(fixture.page, 'list_music_get', listId)), ['a', 'b'])
      await fixture.page.locator('[data-smart-playlist-bar]').waitFor()
      assert.equal(await fixture.page.locator('[data-smart-playlist-refresh]').count(), 1)
      assert.equal(await fixture.page.locator('[data-smart-playlist-edit]').count(), 1)
    })

    await t.test('manual refresh recalculates after new listening history', async() => {
      const listId = fixture.smartListId
      await fixture.app.evaluate(async(_electron, track) => {
        await global.lx.worker.dbService.recordListening(track, Date.now())
      }, songs[2])
      await fixture.page.locator('[data-smart-playlist-refresh]').click()
      await fixture.page.waitForFunction(() => {
        const rows = Array.from(document.querySelectorAll('#view .list-item[data-song-id]'))
        return rows.length === 3 && ['a', 'b', 'c'].every(id => rows.some(row => row.dataset.songId === id))
      })
      assert.deepEqual(ids(await invoke(fixture.page, 'list_music_get', listId)), ['a', 'b', 'c'])
    })

    await t.test('a full playlist overwrite keeps rules for lists that still exist', async() => {
      const listId = fixture.smartListId
      await invoke(fixture.page, 'list_data_overwire', {
        defaultList: songs,
        loveList: [songs[2]],
        tempList: [],
        userList: [
          { id: 'source-list', name: '素材歌单', locationUpdateTime: null, list: songs },
          { id: listId, name: '最近常听', locationUpdateTime: null, list: [] },
        ],
      })
      const rules = await invoke(fixture.page, 'list_smart_get')
      assert.ok(rules[listId], 'the rule must survive a full playlist overwrite')
      assert.deepEqual(ids(await invoke(fixture.page, 'list_music_get', listId)), [])
      assert.deepEqual(ids(await invoke(fixture.page, 'list_music_get', 'source-list')), ids(songs))
    })

    await t.test('invalid IPC arguments and invalid rules are rejected', async() => {
      const listId = fixture.smartListId
      await assert.rejects(invoke(fixture.page, 'list_smart_refresh', {}), /IPC_ARGUMENT_INVALID/)
      await assert.rejects(invoke(fixture.page, 'list_smart_save', {
        listId,
        rule: { version: 1, groups: [{ any: false, rules: [{ field: 'unknown', operator: 'is', value: 'x' }] }] },
      }), /SMART_PLAYLIST_RULE_INVALID/)
      await assert.rejects(invoke(fixture.page, 'list_smart_evaluate', {
        rule: { version: 2, groups: [] },
      }), /SMART_PLAYLIST_RULE_INVALID/)
    })

    await t.test('deleting the smart playlist leaves other playlists untouched and undo restores the rule', async() => {
      const listId = fixture.smartListId
      const removed = await invoke(fixture.page, 'list_remove', [listId])
      assert.ok(!(await invoke(fixture.page, 'list_get')).some(list => list.id === listId))
      assert.deepEqual(ids(await invoke(fixture.page, 'list_music_get', 'source-list')), ids(songs))
      assert.deepEqual(ids(await invoke(fixture.page, 'list_music_get', 'default')), ids(songs))
      assert.deepEqual(ids(await invoke(fixture.page, 'list_music_get', 'love')), ['c'])
      assert.equal((await invoke(fixture.page, 'list_smart_get'))[listId], undefined)

      await invoke(fixture.page, 'list_trash_restore', removed.map(entry => entry.id))
      assert.ok((await invoke(fixture.page, 'list_get')).some(list => list.id === listId))
      assert.deepEqual(ids(await invoke(fixture.page, 'list_music_get', 'source-list')), ids(songs))
      const restoredRules = await invoke(fixture.page, 'list_smart_get')
      assert.ok(restoredRules[listId], 'undo must restore the smart playlist rule')
      assert.equal(restoredRules[listId].groups[0].rules[0].field, 'playCount')
      assert.deepEqual(fixture.errors, [])
    })

    t.diagnostic(`Smart playlist profile: ${profilePath}`)
  } finally { await fixture.app.close() }
})
