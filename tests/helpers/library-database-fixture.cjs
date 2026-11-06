const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const loader = require('./load-typescript.cjs')
const { song } = require('./webdav-fixture.cjs')
const db = new Database(':memory:')
const load = loader({ crypto: require('node:crypto'), './db': { getDB: () => db }, '../../db': { getDB: () => db }, '@common/utils/nodejs': {} })
const tables = load('src/main/worker/dbService/tables.ts')
const mode = process.argv[2]
try {
  if (mode === 'migration') {
    for (const [name, sql] of tables.default) {
      if (name === 'index_download_music_id' || name.startsWith('library_') || name.startsWith('listening_') || name.startsWith('index_listening_') || name.startsWith('list_history') || name.startsWith('index_list_history') || Object.hasOwn(tables.QUERY_INDEXES, name)) continue
      db.exec(name === 'list_trash' ? sql.replace('"summary" TEXT NOT NULL DEFAULT \'{}\',', '') : sql)
    }
    db.prepare('INSERT INTO db_info (field_name,field_value) VALUES (?,?)').run('version', '5')
    db.prepare('INSERT INTO list_trash (id,deleted_at,expires_at,payload) VALUES (?,?,?,?)').run('trash', 1, Date.now() + 999999, JSON.stringify({ kind: 'songs', list: { id: 'default', name: 'Default' }, songs: [{ musicInfo: song('old') }] }))
    db.prepare('INSERT INTO lyric (id,source,type,text) VALUES (?,?,?,?)').run('song', 'edited', 'lyric', 'keep')
    load('src/main/worker/dbService/migrate.ts').default(db)
    assert.equal(load('src/main/worker/dbService/verifyDB.ts').default(db), true)
    assert.equal(db.prepare('SELECT text FROM lyric').get().text, 'keep')
    assert.equal(JSON.parse(db.prepare('SELECT summary FROM list_trash').get().summary).count, 1)
    load('src/main/worker/dbService/migrate.ts').default(db)
    assert.equal(db.prepare('SELECT field_value FROM db_info').get().field_value, '8')
  } else {
    db.exec([...tables.default.values()].join('\n'))
    const library = load('src/main/worker/dbService/library.ts')
    if (mode === 'indexes') {
      for (const sql of ["SELECT * FROM lyric WHERE id='a' AND source='raw'", "SELECT * FROM lyric WHERE source='raw'", "SELECT * FROM my_list_music_info WHERE listId='a'", "SELECT * FROM my_list_music_info_order WHERE listId='a' ORDER BY `order`", 'SELECT * FROM my_list ORDER BY position', 'SELECT id FROM list_trash ORDER BY deleted_at DESC']) {
        const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map(row => row.detail).join('\n')
        assert.match(plan, /USING (COVERING )?INDEX/, sql + '\n' + plan)
        assert.doesNotMatch(plan, /TEMP B-TREE/, sql + '\n' + plan)
      }
      load('src/main/worker/dbService/statementCache.ts').cacheStatements(db, 3)
      const one = db.prepare('SELECT 1')
      assert.equal(db.prepare('SELECT 1'), one)
      db.prepare('SELECT 2'); db.prepare('SELECT 3'); db.prepare('SELECT 4')
      assert.notEqual(db.prepare('SELECT 1'), one)
      const iterate = db.prepare('SELECT 5 UNION ALL SELECT 6')
      const iterator = iterate.iterate(); iterator.next()
      assert.notEqual(db.prepare('SELECT 5 UNION ALL SELECT 6'), iterate)
      iterator.return()
    } else if (mode === 'tags') {
      const prefs = { lists: { test: { folder: 'Legacy', tags: ['study'], pinned: true } }, folders: [] }
      library.saveLibraryPreferences(prefs)
      assert.deepEqual(library.getLibraryPreferences(), prefs)
      assert.throws(() => library.saveLibraryPreferences({ lists: {}, folders: [null] }))
      const backup = library.readLibraryBackup()
      library.restoreLibraryBackup(backup)
      assert.deepEqual(library.readLibraryBackup(), backup)
    } else if (mode === 'listening') {
      const first = { ...song('one'), name: 'First', singer: 'Artist' }
      const second = { ...song('two'), name: 'Second', singer: 'Another' }
      library.recordListening(first, 1000)
      library.recordListening(first, 2000)
      library.recordListening(second, 3000)
      assert.equal(library.getListeningHistory({ from: 1500, to: 2500, search: 'Artist' }).stats.plays, 1)
      assert.equal(library.getListeningHistory().stats.plays, 3)
      assert.equal(library.getListeningHistory().stats.songs, 2)
      assert.deepEqual(library.getListeningHistory({ page: 1 }).rows, [])
      library.clearListeningHistory(); assert.equal(library.getListeningHistory().stats.plays, 0)
    } else throw Error('Unknown scenario')
  }
  console.log('PASS ' + mode)
} finally { db.close() }
