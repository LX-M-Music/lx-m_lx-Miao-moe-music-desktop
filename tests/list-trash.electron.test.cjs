const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

const retention = 30 * 86400000
const song = id => ({ id, name: `歌曲 ${id}`, singer: '回收站测试', source: 'local', interval: '03:00', meta: { albumName: '保留完整信息', filePath: '', ext: 'mp3', picUrl: '' } })
const songs = ['a', 'b', 'c', 'd', 'e'].map(song)
const lists = ['one', 'two', 'three'].map(id => ({ id, name: `歌单 ${id}`, locationUpdateTime: null, list: songs }))
const invoke = (page, name, params) => page.evaluate(({ name, params }) => require('electron').ipcRenderer.invoke('player_' + name, params), { name, params })
const label = (page, key) => page.evaluate(key => window.i18n.t(key), key)
const readSongs = async(page, listId = 'two') => invoke(page, 'list_music_get', listId)
const ids = values => values.map(value => value.id)
const db = (app, sql, params = [], read = false) => app.evaluate(({ app }, { sql, params, read }) => {
  const require = process.mainModule.require('node:module').createRequire(app.getAppPath() + '/package.json')
  const Database = require('better-sqlite3')
  const connection = new Database(require('node:path').join(global.lxDataPath, 'lx.data.db'), { fileMustExist: true })
  try { return read ? connection.prepare(sql).all(...params) : connection.prepare(sql).run(...params) } finally { connection.close() }
}, { sql, params, read })

test('playlist recycle bin persists, restores safely, expires and supports undo in the real app', { timeout: 180000 }, async t => {
  let fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = fixture.output
  const reset = async() => {
    const entries = await invoke(fixture.page, 'list_trash_get')
    await invoke(fixture.page, 'list_trash_delete', ids(entries))
    await invoke(fixture.page, 'list_data_overwire', { defaultList: songs, loveList: songs, tempList: [], userList: lists })
  }
  try {
    fixture.page.setDefaultTimeout(7000)
    await reset()
    await t.test('an existing version 3 database migrates without losing playlists or URL cache', async() => {
      await db(fixture.app, 'INSERT INTO music_url (id, url, expire_time) VALUES (?, ?, ?)', ['migration-song', 'https://example.invalid/song', Date.now() + retention])
      await db(fixture.app, 'DROP TABLE list_trash')
      await db(fixture.app, "UPDATE db_info SET field_value = '3' WHERE field_name = 'version'")
      await fixture.app.close()
      fixture = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') })
      fixture.page.setDefaultTimeout(7000)
      assert.deepEqual(ids(await readSongs(fixture.page)), ids(songs))
      assert.equal((await db(fixture.app, "SELECT field_value FROM db_info WHERE field_name = 'version'", [], true))[0].field_value, '8')
      assert.equal((await db(fixture.app, 'SELECT id FROM music_url WHERE id = ?', ['migration-song'], true)).length, 1)
      assert.deepEqual(await invoke(fixture.page, 'list_trash_get'), [])
    })

    await t.test('single and batch song restoration preserves order, metadata and subsequent additions', async() => {
      const deleted = await invoke(fixture.page, 'list_music_remove', { listId: 'two', ids: ['b', 'd'] })
      assert.equal(deleted[0].count, 2)
      assert.equal(deleted[0].expiresAt - deleted[0].deletedAt, retention)
      await invoke(fixture.page, 'list_music_add', { id: 'two', musicInfos: [song('new')], addMusicLocationType: 'top' })
      await invoke(fixture.page, 'list_trash_restore', ids(deleted))
      const restored = await readSongs(fixture.page)
      assert.deepEqual(ids(restored), ['new', 'a', 'b', 'c', 'd', 'e'])
      assert.deepEqual(restored.find(value => value.id === 'b'), song('b'))
      const [entry] = await invoke(fixture.page, 'list_music_remove', { listId: 'two', ids: ['b'] })
      const newer = { ...song('b'), name: '重新添加后修改的标题' }
      await invoke(fixture.page, 'list_music_add', { id: 'two', musicInfos: [newer], addMusicLocationType: 'bottom' })
      await invoke(fixture.page, 'list_trash_restore', [entry.id])
      assert.equal((await readSongs(fixture.page)).filter(value => value.id === 'b').length, 1)
      assert.equal((await readSongs(fixture.page)).find(value => value.id === 'b').name, newer.name)
    })

    await t.test('whole playlists restore their positions and metadata, including empty playlists', async() => {
      await reset()
      await invoke(fixture.page, 'list_update', [{ id: 'two', name: '在线歌单', source: 'wy', sourceListId: '123', locationUpdateTime: null }])
      const deleted = await invoke(fixture.page, 'list_remove', ['two'])
      assert.equal(deleted[0].kind, 'list')
      assert.deepEqual(await readSongs(fixture.page), [], 'deleted playlists must not survive in the worker cache')
      await invoke(fixture.page, 'list_trash_restore', ids(deleted))
      const restoredLists = await invoke(fixture.page, 'list_get')
      assert.deepEqual(ids(restoredLists), ['one', 'two', 'three'])
      assert.equal(restoredLists[1].sourceListId, '123')
      assert.equal(restoredLists[1].source, 'wy')
      assert.deepEqual(await readSongs(fixture.page), songs)
      await invoke(fixture.page, 'list_add', { position: 1, listInfos: [{ id: 'empty', name: '空歌单', locationUpdateTime: null }] })
      const empty = await invoke(fixture.page, 'list_remove', ['empty'])
      assert.equal(empty[0].count, 0)
      await invoke(fixture.page, 'list_trash_restore', ids(empty))
      assert.deepEqual(ids(await invoke(fixture.page, 'list_get')), ['one', 'empty', 'two', 'three'])
    })

    await t.test('restoring songs recreates a deleted parent and later playlist restore merges safely', async() => {
      await reset()
      const removedSong = await invoke(fixture.page, 'list_music_remove', { listId: 'two', ids: ['b'] })
      const removedList = await invoke(fixture.page, 'list_remove', ['two'])
      await invoke(fixture.page, 'list_trash_restore', ids(removedSong))
      assert.equal((await invoke(fixture.page, 'list_get')).find(value => value.id === 'two').name, '歌单 two')
      assert.deepEqual(ids(await readSongs(fixture.page)), ['b'])
      await invoke(fixture.page, 'list_trash_restore', ids(removedList))
      assert.deepEqual(ids(await readSongs(fixture.page)), ['a', 'b', 'c', 'd', 'e'])
    })

    await t.test('clear broadcasts correctly and favorites are recoverable', async() => {
      await reset()
      await route(fixture.page, '/list?id=love')
      await settled(fixture.page)
      const cleared = await invoke(fixture.page, 'list_music_clear', ['default', 'love'])
      assert.equal(cleared.length, 2)
      await fixture.page.waitForFunction(() => window.__motionComponents().find(c => c.type.name === 'MusicList').setupState.list.length === 0)
      await invoke(fixture.page, 'list_trash_restore', ids(cleared))
      await fixture.page.waitForFunction(() => window.__motionComponents().find(c => c.type.name === 'MusicList').setupState.list.length === 5)
      assert.deepEqual(await readSongs(fixture.page, 'love'), songs)
    })

    await t.test('separate playlist and song deletions can be restored in either order', async() => {
      for (const reverse of [false, true]) {
        await reset()
        const first = await invoke(fixture.page, 'list_music_remove', { listId: 'two', ids: ['b'] })
        const second = await invoke(fixture.page, 'list_music_remove', { listId: 'two', ids: ['c'] })
        for (const entry of reverse ? [second, first] : [first, second]) await invoke(fixture.page, 'list_trash_restore', ids(entry))
        assert.deepEqual(await readSongs(fixture.page), songs)
        const middle = await invoke(fixture.page, 'list_remove', ['two'])
        const others = await invoke(fixture.page, 'list_remove', ['one', 'three'])
        for (const entry of reverse ? [others, middle] : [middle, others]) await invoke(fixture.page, 'list_trash_restore', ids(entry))
        assert.deepEqual(ids(await invoke(fixture.page, 'list_get')), ['one', 'two', 'three'])
      }
    })

    await t.test('failed deletion rolls back both playlist removal and archive insertion', async() => {
      await reset()
      await db(fixture.app, "CREATE TRIGGER fail_trash_delete BEFORE DELETE ON my_list_music_info WHEN OLD.listId = 'two' BEGIN SELECT RAISE(ABORT, 'injected deletion failure'); END")
      try {
        await assert.rejects(invoke(fixture.page, 'list_remove', ['two']), /injected deletion failure/)
        assert.deepEqual(await readSongs(fixture.page), songs)
        assert.deepEqual(ids(await invoke(fixture.page, 'list_get')), ['one', 'two', 'three'])
        assert.deepEqual(await invoke(fixture.page, 'list_trash_get'), [])
      } finally { await db(fixture.app, 'DROP TRIGGER fail_trash_delete') }
    })

    await t.test('failed restore keeps the archive and rolls back a recreated parent', async() => {
      const deleted = await invoke(fixture.page, 'list_remove', ['two'])
      await db(fixture.app, "CREATE TRIGGER fail_trash_restore BEFORE INSERT ON my_list_music_info WHEN NEW.listId = 'two' BEGIN SELECT RAISE(ABORT, 'injected restore failure'); END")
      try {
        await assert.rejects(invoke(fixture.page, 'list_trash_restore', ids(deleted)), /injected restore failure/)
        assert.ok(!(await invoke(fixture.page, 'list_get')).some(value => value.id === 'two'))
        assert.deepEqual(ids(await invoke(fixture.page, 'list_trash_get')), ids(deleted))
      } finally { await db(fixture.app, 'DROP TRIGGER fail_trash_restore') }
      const repeated = await Promise.all([invoke(fixture.page, 'list_trash_restore', ids(deleted)), invoke(fixture.page, 'list_trash_restore', ids(deleted))])
      assert.equal(repeated.flat().length, 1, 'concurrent retries restore only once')
      assert.deepEqual(await readSongs(fixture.page), songs)
    })

    await t.test('moves, remote sync, temporary queues and no-op removals create no trash', async() => {
      await reset()
      await invoke(fixture.page, 'list_music_move', { fromId: 'one', toId: 'two', musicInfos: [song('a')], addMusicLocationType: 'bottom' })
      await fixture.app.evaluate(async() => global.lx.event_list.list_music_remove('two', ['e'], true))
      await invoke(fixture.page, 'list_music_remove', { listId: 'two', ids: ['missing'] })
      await invoke(fixture.page, 'list_music_overwrite', { listId: 'temp', musicInfos: songs })
      await invoke(fixture.page, 'list_music_clear', ['temp'])
      assert.deepEqual(await invoke(fixture.page, 'list_trash_get'), [])
    })

    await t.test('right-click deletion offers a working keyboard-accessible undo action', async() => {
      await reset()
      await route(fixture.page, '/list?id=two')
      await settled(fixture.page)
      const title = fixture.page.locator('#view .list-item .select.name').filter({ hasText: /^歌曲 b$/ })
      await title.click({ button: 'right' })
      await fixture.page.locator('[role="toolbar"][aria-hidden="false"]').getByRole('tab', { name: await label(fixture.page, 'list__remove'), exact: true }).click()
      const undo = fixture.page.getByRole('button', { name: await label(fixture.page, 'list_trash__undo'), exact: true })
      await undo.waitFor()
      assert.deepEqual(ids(await readSongs(fixture.page)), ['a', 'c', 'd', 'e'])
      await undo.focus()
      await undo.press('Enter')
      await title.waitFor()
      assert.deepEqual(await readSongs(fixture.page), songs)
      assert.deepEqual(await invoke(fixture.page, 'list_trash_get'), [])
    })

    await t.test('restart retains live trash and purges expired entries before restore', async() => {
      await reset()
      const live = await invoke(fixture.page, 'list_remove', ['two'])
      const expired = await invoke(fixture.page, 'list_music_remove', { listId: 'one', ids: ['a'] })
      await db(fixture.app, 'UPDATE list_trash SET expires_at = ? WHERE id = ?', [Date.now() - 1, expired[0].id])
      assert.deepEqual(fixture.errors, [])
      await fixture.app.close()
      fixture = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') })
      fixture.page.setDefaultTimeout(7000)
      assert.deepEqual(ids(await invoke(fixture.page, 'list_trash_get')), ids(live))
      assert.deepEqual(await invoke(fixture.page, 'list_trash_restore', ids(expired)), [])
      assert.ok(!(await readSongs(fixture.page, 'one')).some(value => value.id === 'a'))
      await invoke(fixture.page, 'list_trash_restore', ids(live))
      assert.deepEqual(await readSongs(fixture.page), songs)
    })

    await t.test('whole-playlist deletion and undo work from the context menu', async() => {
      await reset()
      await route(fixture.page, '/list?id=two')
      await settled(fixture.page)
      await fixture.page.locator('#my-list .user-list[data-id="two"]').click({ button: 'right' })
      await fixture.page.locator('[role="toolbar"][aria-hidden="false"]').getByRole('tab', { name: await label(fixture.page, 'lists__remove'), exact: true }).click()
      await fixture.page.getByRole('button', { name: await label(fixture.page, 'lists__remove_tip_button'), exact: true }).click()
      const undo = fixture.page.getByRole('button', { name: await label(fixture.page, 'list_trash__undo'), exact: true })
      await undo.waitFor()
      assert.ok(!(await invoke(fixture.page, 'list_get')).some(value => value.id === 'two'))
      await undo.click()
      await fixture.page.locator('#my-list .user-list[data-id="two"]').waitFor()
      assert.deepEqual(await readSongs(fixture.page), songs)
    })

    await t.test('recycle-bin UI restores, confirms permanent deletion and fits small windows', async() => {
      await reset()
      const audioPath = path.join(profilePath, 'preserved-local.mp3')
      await fs.writeFile(audioPath, 'unchanged audio file fixture')
      await invoke(fixture.page, 'list_music_add', { id: 'two', musicInfos: [{ ...song('local-file'), meta: { ...song('local-file').meta, filePath: audioPath } }], addMusicLocationType: 'bottom' })
      const removed = await invoke(fixture.page, 'list_music_remove', { listId: 'two', ids: ['local-file'] })
      await invoke(fixture.page, 'list_remove', ['three'])
      await route(fixture.page, '/list?id=two')
      await fixture.page.evaluate(() => {
        const ipc = require('electron').ipcRenderer
        const original = ipc.invoke.bind(ipc)
        let fail = true
        ipc.invoke = async(channel, ...args) => {
          if (channel === 'player_list_trash_get' && fail) { fail = false; throw new Error('injected read failure') }
          return original(channel, ...args)
        }
      })
      await fixture.page.getByRole('button', { name: await label(fixture.page, 'list_trash__title'), exact: true }).click()
      const modal = fixture.page.locator('[data-list-trash]')
      await modal.waitFor()
      await modal.getByRole('button', { name: await label(fixture.page, 'list_trash__retry'), exact: true }).click()
      await modal.locator('[data-trash-id]').first().waitFor()
      await settled(fixture.page)
      const window = await fixture.app.browserWindow(fixture.page)
      await window.evaluate(window => window.setSize(828, 600))
      await window.dispose()
      await settled(fixture.page)
      const bounds = await modal.boundingBox()
      const viewport = await fixture.page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width)
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height)
      await fixture.page.screenshot({ path: path.join(profilePath, 'recycle-bin.png') })
      const localRow = modal.locator(`[data-trash-id="${removed[0].id}"]`)
      await localRow.getByRole('button', { name: await label(fixture.page, 'list_trash__restore'), exact: true }).click()
      await localRow.waitFor({ state: 'detached' })
      assert.ok((await readSongs(fixture.page)).some(value => value.id === 'local-file'))
      await modal.getByRole('button', { name: await label(fixture.page, 'list_trash__empty'), exact: true }).click()
      await fixture.page.getByRole('button', { name: await label(fixture.page, 'list_trash__delete'), exact: true }).last().click()
      await fixture.page.getByText(await label(fixture.page, 'list_trash__none'), { exact: true }).waitFor()
      assert.equal(await fs.readFile(audioPath, 'utf8'), 'unchanged audio file fixture')
      assert.deepEqual(await invoke(fixture.page, 'list_trash_get'), [])
    })
    assert.deepEqual(fixture.errors, [])
    t.diagnostic(`Recycle bin screenshot: ${path.join(profilePath, 'recycle-bin.png')}`)
  } finally { await fixture.app.close() }
})
