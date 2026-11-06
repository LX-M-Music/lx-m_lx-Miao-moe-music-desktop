import type Database from 'better-sqlite3'
import tables, { DB_VERSION, QUERY_INDEXES } from './tables'
import { libraryTables } from './libraryTables'

// const migrateV1 = (db: Database.Database) => {
//   const sql = `
//     DROP TABLE "main"."download_list";

//     CREATE TABLE "download_list" (
//       "id" TEXT NOT NULL,
//       "isComplate" INTEGER NOT NULL,
//       "status" TEXT NOT NULL,
//       "statusText" TEXT NOT NULL,
//       "progress_downloaded" INTEGER NOT NULL,
//       "progress_total" INTEGER NOT NULL,
//       "url" TEXT,
//       "quality" TEXT NOT NULL,
//       "ext" TEXT NOT NULL,
//       "fileName" TEXT NOT NULL,
//       "filePath" TEXT NOT NULL,
//       "musicInfo" TEXT NOT NULL,
//       "position" INTEGER NOT NULL,
//       PRIMARY KEY("id")
//     );
//   `
//   db.exec(sql)
//   db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: '2' })
// }

const migrateV1 = (db: Database.Database) => {
  // 修复 v2.4.0 的默认数据库版本号不对的问题
  const existsTable = db.prepare('SELECT name FROM "main".sqlite_master WHERE type=\'table\' AND name=\'dislike_list\';').get()
  if (!existsTable) {
    const sql = tables.get('dislike_list')!
    db.exec(sql)
  }
}

const ensureMusicUrlIndexes = (db: Database.Database) => {
  for (const name of ['index_music_url_id', 'index_music_url_expire_time'] as const) {
    const existsIndex = db.prepare('SELECT name FROM "main".sqlite_master WHERE type=\'index\' AND name=?;').get(name)
    if (!existsIndex) db.exec(tables.get(name)!)
  }
}

const migrateV2 = (db: Database.Database) => {
  const existsTable = db.prepare('SELECT name FROM "main".sqlite_master WHERE type=\'table\' AND name=\'music_url\';').get()
  if (!existsTable) {
    db.exec(tables.get('music_url')!)
  } else {
    const columns = db.prepare('PRAGMA main.table_info(\'music_url\')').all() as Array<{ name: string }>
    if (!columns.some(column => column.name == 'expire_time')) {
      db.exec('ALTER TABLE "main"."music_url" ADD COLUMN "expire_time" INTEGER NOT NULL DEFAULT 0;')
    }
  }
  db.exec('DELETE FROM "main"."music_url";')
  ensureMusicUrlIndexes(db)
}

const ensureQueryIndexes = (db: Database.Database) => {
  const exists = db.prepare('SELECT 1 FROM sqlite_master WHERE type=\'index\' AND name=?')
  for (const name of Object.keys(QUERY_INDEXES) as Array<keyof typeof QUERY_INDEXES>) {
    if (!exists.get(name)) db.exec(tables.get(name)!)
  }
}

// v8 adds smart playlist rules to user playlists. Rebuild the table from the
// canonical schema so verifyDB compares equal to a freshly created database.
const migrateSmartRule = (db: Database.Database) => {
  const columns = db.prepare('PRAGMA main.table_info(my_list)').all() as Array<{ name: string }>
  if (columns.some(column => column.name === 'smart_rule')) return
  db.exec('DROP INDEX IF EXISTS "main"."index_my_list_position"')
  db.exec('ALTER TABLE "main"."my_list" RENAME TO "my_list_v7"')
  db.exec(tables.get('my_list')!)
  db.exec('INSERT INTO "main"."my_list" ("id", "name", "source", "sourceListId", "position", "locationUpdateTime") SELECT "id", "name", "source", "sourceListId", "position", "locationUpdateTime" FROM "main"."my_list_v7"')
  db.exec('DROP TABLE "main"."my_list_v7"')
}

export default (db: Database.Database) => {
  // PRAGMA user_version = x
  // console.log(db.prepare('PRAGMA user_version').get().user_version)
  // https://github.com/WiseLibs/better-sqlite3/issues/668#issuecomment-1145285728
  const versionInfo = db.prepare<[string]>('SELECT "field_value" FROM "main"."db_info" WHERE "field_name" = ?').get('version') as { field_value: string } | undefined
  const version = versionInfo?.field_value
  if (version == DB_VERSION) {
    ensureMusicUrlIndexes(db)
    ensureQueryIndexes(db)
    return
  }
  if (!['1', '2', '3', '4', '5', '6', '7'].includes(version ?? '')) return

  db.transaction(() => {
    if (version == '1') migrateV1(db)
    if (version == '1' || version == '2') migrateV2(db)
    if (Number(version) < 4) {
      for (const name of ['list_trash', 'index_list_trash_expires_at'] as const) db.exec(tables.get(name)!)
    }
    if (Number(version) < 5) {
      const columns = db.prepare('PRAGMA main.table_info(download_list)').all() as Array<{ name: string }>
      // Keep the canonical CREATE statement used by verifyDB, including column
      // order and quoting. ALTER ADD COLUMN alone produces a different schema.
      const fields = '"id", "isComplate", "status", "statusText", "progress_downloaded", "progress_total", "url", "quality", "ext", "fileName", "filePath", "musicInfo", "position"'
      db.exec('ALTER TABLE "download_list" RENAME TO "download_list_v4"')
      db.exec(tables.get('download_list')!)
      db.exec(`INSERT INTO "download_list" (${fields}, "taskOptions") SELECT ${fields}, ${columns.some(column => column.name === 'taskOptions') ? '"taskOptions"' : "'{}'"} FROM "download_list_v4"`)
      db.exec('DROP TABLE "download_list_v4"')
    }
    const trashColumns = db.prepare('PRAGMA main.table_info(list_trash)').all() as Array<{ name: string }>
    if (!trashColumns.some(column => column.name === 'summary')) {
      db.exec('ALTER TABLE list_trash RENAME TO list_trash_v5')
      db.exec(tables.get('list_trash')!)
      db.exec('INSERT INTO list_trash (id, deleted_at, expires_at, payload) SELECT id, deleted_at, expires_at, payload FROM list_trash_v5')
      db.exec('DROP TABLE list_trash_v5')
      db.exec(tables.get('index_list_trash_expires_at')!)
    }
    const updateSummary = db.prepare('UPDATE list_trash SET summary=? WHERE id=?')
    while (true) {
      const rows = db.prepare("SELECT id,payload FROM list_trash WHERE summary='{}' LIMIT 50").all() as Array<{ id: string, payload: string }>
      if (!rows.length) break
      for (const row of rows) {
        try {
          const data = JSON.parse(row.payload)
          updateSummary.run(JSON.stringify({ kind: data.kind, listId: data.list.id, listName: data.list.name, songName: data.songs[0]?.musicInfo.name ?? '', count: data.songs.length }), row.id)
        } catch { updateSummary.run(JSON.stringify({ kind: 'songs', listId: '', listName: '损坏的快照', songName: '', count: 0 }), row.id) }
      }
    }
    if (Number(version) < 8) migrateSmartRule(db)
    ensureQueryIndexes(db)
    for (const [name, sql] of libraryTables) if (!db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(name)) db.exec(sql)
    // Older imports have no trustworthy addition date. Zero means unknown.
    db.exec('INSERT OR IGNORE INTO library_track (id,added_at) SELECT DISTINCT id,0 FROM my_list_music_info')
    db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
  })()
}
