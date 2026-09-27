const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs/promises')
const Database = require('better-sqlite3')
const loader = require('./load-typescript.cjs')
const { song, task } = require('./webdav-fixture.cjs')

async function run(mode) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-restore-transaction-'))
  const db = new Database(':memory:')
  let failAt = null, permanent = false
  let failCleanup = false
  const overrides = {
    crypto: require('node:crypto'),
    '@common/utils': { log: { error() {} } },
    '@common/utils/nodejs': { readLxConfigFile() {} },
    'electron-log/node': { error() {} },
    './db': { getDB: () => db }, '../../db': { getDB: () => db },
    'node:fs/promises': { ...fs, rm: async(filename, options) => {
      if (failCleanup && filename.endsWith('backup-restore-journal.json')) throw Error('injected cleanup error')
      return fs.rm(filename, options)
    }, rename: async(from, to) => {
      if (failAt && to.endsWith(failAt)) { if (!permanent) failAt = null; throw Object.assign(Error('injected disk error'), { code: 'ENOSPC' }) }
      return fs.rename(from, to)
    } },
  }
  const load = loader(overrides)
  db.exec([...load('src/main/worker/dbService/tables.ts').default.values()].join('\n'))
  const list = load('src/main/worker/dbService/modules/list/index.ts')
  const download = load('src/main/worker/dbService/modules/download/index.ts')
  const lyric = load('src/main/worker/dbService/modules/lyric/index.ts')
  const dislike = load('src/main/worker/dbService/modules/dislike_list/index.ts')
  Object.assign(overrides, { './modules/list': list, './modules/download': download, './modules/lyric': lyric, './modules/dislike_list': dislike })
  const backup = load('src/main/worker/dbService/backup.ts')
  const initial = { defaultList: [song('before')], loveList: [], tempList: [], userList: [] }
  list.listDataOverwrite(initial)
  download.downloadListReplace([task('before')])
  lyric.editedLyricAdd('wy_a', { lyric: 'before', tlyric: 'old translation' })
  await fs.writeFile(path.join(root, 'config_v2.json'), 'old config')
  await fs.writeFile(path.join(root, 'sound_effect.json'), 'old presets')
  const data = {
    playlists: [{ id: 'default', name: 'Default', list: [song('after')], locationUpdateTime: null }],
    downloads: [task('after')], lyrics: [{ id: 'wy_a', lyric: { lyric: 'after', rlyric: 'new romanization' } }],
  }
  const files = [{ name: 'config_v2.json', data: 'new config' }, { name: 'sound_effect.json', data: 'new presets' }]
  try {
    if (mode.startsWith('webdav-')) {
      const privateList = { id: 'userlist_wy_sync_cookie', name: 'Private Cookie', locationUpdateTime: null, list: [song('private')] }
      if (mode === 'webdav-private') list.listDataOverwrite({ ...initial, userList: [privateList] })
      await dislike.dislikeInfoOverwrite('before rule')
      const sections = ['playlists', 'downloadTasks', 'dislike', 'settings']
      const captured = backup.webdavRead(sections)
      if (mode === 'webdav-private') assert.deepEqual(captured.data.playlists.userList.map(item => item.id), [privateList.id])
      const incoming = { playlists: { ...initial, defaultList: [song('after')] }, downloadTasks: [task('after')], dislike: 'after rule' }
      if (mode === 'webdav-file-failure') failAt = 'sound_effect.json'
      if (mode === 'webdav-db-failure') db.exec("CREATE TRIGGER fail_dislike BEFORE INSERT ON dislike_list BEGIN SELECT RAISE(ABORT, 'injected database error'); END")
      if (mode === 'webdav-revision') load('src/main/worker/dbService/syncRevision.ts').bumpSyncRevision(['playlists'])
      const restore = backup.webdavRestore(root, incoming, files, sections, captured.revision)
      const success = mode === 'webdav-success' || mode === 'webdav-private'
      if (success) await restore
      else await assert.rejects(restore, mode === 'webdav-revision' ? /local_changed/ : /injected/)
      assert.equal(list.getListMusics('default')[0].id, success ? 'wy_after' : 'wy_before')
      if (mode === 'webdav-private') {
        assert.deepEqual(list.getAllUserList().map(item => item.id), [privateList.id])
        assert.equal(list.getListMusics(privateList.id)[0].id, 'wy_private')
      }
      assert.deepEqual(download.getDownloadList().map(task => task.id), [success ? 'task_after' : 'task_before'])
      assert.equal(dislike.getDislikeListInfo().rules, success ? 'after rule' : 'before rule')
      assert.equal(await fs.readFile(path.join(root, 'config_v2.json'), 'utf8'), success ? 'new config' : 'old config')
      assert.equal(await fs.readFile(path.join(root, 'sound_effect.json'), 'utf8'), success ? 'new presets' : 'old presets')
    } else if (mode === 'success') {
      await backup.backupRestore(root, data, files)
      assert.equal(list.getListMusics('default')[0].id, 'wy_after')
      assert.equal(await fs.readFile(path.join(root, 'config_v2.json'), 'utf8'), 'new config')
      assert.deepEqual(lyric.getEditedLyric('wy_a'), { lyric: 'after', rlyric: 'new romanization' })
      assert.deepEqual(download.getDownloadList().map(task => task.id), ['task_before', 'task_after'])
    } else if (['file-failure', 'db-failure', 'begin-failure', 'rollback-cleanup'].includes(mode)) {
      if (mode === 'rollback-cleanup') failCleanup = true
      if (mode === 'begin-failure') {
        const exec = db.exec.bind(db)
        db.exec = sql => { if (sql === 'BEGIN IMMEDIATE') throw Error('injected begin error'); return exec(sql) }
      } else if (mode === 'db-failure') db.exec("CREATE TRIGGER fail_lyrics BEFORE INSERT ON lyric BEGIN SELECT RAISE(ABORT, 'injected database error'); END")
      else failAt = 'sound_effect.json'
      await assert.rejects(backup.backupRestore(root, data, files), /injected/)
      assert.equal(list.getListMusics('default')[0].id, 'wy_before')
      assert.equal(await fs.readFile(path.join(root, 'config_v2.json'), 'utf8'), 'old config')
      assert.equal(await fs.readFile(path.join(root, 'sound_effect.json'), 'utf8'), 'old presets')
      assert.deepEqual(download.getDownloadList().map(task => task.id), ['task_before'])
      assert.deepEqual(lyric.getEditedLyric('wy_a'), { lyric: 'before', tlyric: 'old translation' })
      if (mode === 'rollback-cleanup') {
        failCleanup = false
        await fs.writeFile(path.join(root, 'config_v2.json'), 'later settings')
        await backup.recoverBackup(root)
        assert.equal(await fs.readFile(path.join(root, 'config_v2.json'), 'utf8'), 'later settings')
      }
    } else if (mode === 'crash-before-commit' || mode === 'crash-after-commit') {
      const committed = mode === 'crash-after-commit'
      await fs.writeFile(path.join(root, 'config_v2.json'), 'interrupted config')
      await fs.writeFile(path.join(root, 'backup-restore-journal.json'), JSON.stringify({ id: 'crashed', files: [{ name: 'config_v2.json', before: 'old config' }] }))
      if (committed) db.prepare('INSERT INTO db_info (field_name, field_value) VALUES (?, ?)').run('manual_backup_commit', 'crashed')
      await backup.recoverBackup(root)
      assert.equal(await fs.readFile(path.join(root, 'config_v2.json'), 'utf8'), committed ? 'interrupted config' : 'old config')
    } else if (mode === 'rollback-retry') {
      await fs.writeFile(path.join(root, 'config_v2.json'), 'interrupted config')
      await fs.writeFile(path.join(root, 'backup-restore-journal.json'), JSON.stringify({ id: 'crashed', files: [{ name: 'config_v2.json', before: 'old config' }] }))
      failAt = 'config_v2.json'; permanent = true
      await assert.rejects(backup.recoverBackup(root), /backup:rollback_failed/)
      assert.equal(await fs.readFile(path.join(root, 'config_v2.json'), 'utf8'), 'interrupted config')
      await fs.access(path.join(root, 'backup-restore-journal.json'))
      failAt = null; await backup.recoverBackup(root)
      assert.equal(await fs.readFile(path.join(root, 'config_v2.json'), 'utf8'), 'old config')
    } else throw Error('Unknown test')
    await assert.rejects(fs.access(path.join(root, 'backup-restore-journal.json')), { code: 'ENOENT' })
    assert.equal(db.inTransaction, false)
    console.log('PASS ' + mode)
  } finally {
    db.close()
    assert(path.resolve(root).startsWith(path.join(os.tmpdir(), 'lx-restore-transaction-')))
    await fs.rm(root, { recursive: true, force: true })
  }
}
run(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1 })
