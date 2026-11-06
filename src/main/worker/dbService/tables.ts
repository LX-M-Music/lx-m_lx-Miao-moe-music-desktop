// export const sql = `
//   CREATE TABLE "db_info" (
//     "id" INTEGER NOT NULL UNIQUE,
//     "field_name" TEXT,
//     "field_value" TEXT,
//     PRIMARY KEY("id" AUTOINCREMENT)
//   );

//   CREATE TABLE "my_list" (
//     "id" TEXT NOT NULL,
//     "name" TEXT NOT NULL,
//     "source" TEXT,
//     "sourceListId" TEXT,
//     "position" INTEGER NOT NULL,
//     "locationUpdateTime" INTEGER,
//     PRIMARY KEY("id")
//   );

//   CREATE TABLE "my_list_music_info" (
//     "id" TEXT NOT NULL,
//     "listId" TEXT NOT NULL,
//     "name" TEXT NOT NULL,
//     "singer" TEXT NOT NULL,
//     "source" TEXT NOT NULL,
//     "interval" TEXT,
//     "meta" TEXT NOT NULL,
//     UNIQUE("id","listId")
//   );
//   CREATE INDEX "index_my_list_music_info" ON "my_list_music_info" (
//     "id",
//     "listId"
//   );

//   CREATE TABLE "my_list_music_info_order" (
//     "listId" TEXT NOT NULL,
//     "musicInfoId" TEXT NOT NULL,
//     "order" INTEGER NOT NULL
//   );
//   CREATE INDEX "index_my_list_music_info_order" ON "my_list_music_info_order" (
//     "listId",
//     "musicInfoId"
//   );

//   CREATE TABLE "music_info_other_source" (
//     "source_id" TEXT NOT NULL,
//     "id" TEXT NOT NULL,
//     "source" TEXT NOT NULL,
//     "name" TEXT NOT NULL,
//     "singer" TEXT NOT NULL,
//     "meta" TEXT NOT NULL,
//     "order" INTEGER NOT NULL,
//     UNIQUE("source_id","id")
//   );
//   CREATE INDEX "index_music_info_other_source" ON "music_info_other_source" (
//     "source_id",
//     "id"
//   );

//   -- TODO  "meta" TEXT NOT NULL,
//   CREATE TABLE "lyric" (
//     "id" TEXT NOT NULL,
//     "source" TEXT NOT NULL,
//     "type" TEXT NOT NULL,
//     "text" TEXT NOT NULL
//   );

//   CREATE TABLE "music_url" (
//     "id" TEXT NOT NULL,
//     "url" TEXT NOT NULL
//   );

//   CREATE TABLE "download_list" (
//     "id" TEXT NOT NULL,
//     "isComplate" INTEGER NOT NULL,
//     "status" TEXT NOT NULL,
//     "statusText" TEXT NOT NULL,
//     "progress_downloaded" INTEGER NOT NULL,
//     "progress_total" INTEGER NOT NULL,
//     "url" TEXT,
//     "quality" TEXT NOT NULL,
//     "ext" TEXT NOT NULL,
//     "fileName" TEXT NOT NULL,
//     "filePath" TEXT NOT NULL,
//     "musicInfo" TEXT NOT NULL,
//     "position" INTEGER NOT NULL,
//     PRIMARY KEY("id")
//   );
// `

// export const tables = [
//   'table_db_info',
//   'table_my_list',
//   'table_my_list_music_info',
//   'index_index_my_list_music_info',
//   'table_my_list_music_info_order',
//   'index_index_my_list_music_info_order',
//   'table_music_info_other_source',
//   'index_index_music_info_other_source',
//   'table_lyric',
//   'table_music_url',
//   'table_download_list',
// ]

import { libraryTables } from './libraryTables'

type Tables = 'db_info'
| 'my_list'
| 'my_list_music_info'
| 'index_my_list_music_info'
| 'my_list_music_info_order'
| 'index_my_list_music_info_order'
| 'music_info_other_source'
| 'index_music_info_other_source'
| 'lyric'
| 'music_url'
| 'index_music_url_id'
| 'index_music_url_expire_time'
| 'download_list'
| 'dislike_list'
| 'list_trash'
| 'index_list_trash_expires_at'
| 'index_list_trash_deleted_at'
| 'index_lyric_id_source_type'
| 'index_lyric_source'
| 'index_my_list_music_info_list'
| 'index_my_list_music_info_order_sort'
| 'index_my_list_position'

const tables = new Map<string, string>()


tables.set('db_info', `
  CREATE TABLE "db_info" (
    "id" INTEGER NOT NULL UNIQUE,
    "field_name" TEXT,
    "field_value" TEXT,
    PRIMARY KEY("id" AUTOINCREMENT)
  );
`)
tables.set('my_list', `
  CREATE TABLE "my_list" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT,
    "sourceListId" TEXT,
    "position" INTEGER NOT NULL,
    "locationUpdateTime" INTEGER,
    "smart_rule" TEXT,
    PRIMARY KEY("id")
  );
`)
tables.set('my_list_music_info', `
  CREATE TABLE "my_list_music_info" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "singer" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "interval" TEXT,
    "meta" TEXT NOT NULL,
    UNIQUE("id","listId")
  );
`)
tables.set('index_my_list_music_info', `
  CREATE INDEX "index_my_list_music_info" ON "my_list_music_info" (
    "id",
    "listId"
  );
`)
tables.set('my_list_music_info_order', `
  CREATE TABLE "my_list_music_info_order" (
    "listId" TEXT NOT NULL,
    "musicInfoId" TEXT NOT NULL,
    "order" INTEGER NOT NULL
  );
`)
tables.set('index_my_list_music_info_order', `
  CREATE INDEX "index_my_list_music_info_order" ON "my_list_music_info_order" (
    "listId",
    "musicInfoId"
  );
`)
tables.set('music_info_other_source', `
  CREATE TABLE "music_info_other_source" (
    "source_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "singer" TEXT NOT NULL,
    "meta" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    UNIQUE("source_id","id")
  );
`)
tables.set('index_music_info_other_source', `
  CREATE INDEX "index_music_info_other_source" ON "music_info_other_source" (
    "source_id",
    "id"
  );
`)
tables.set('lyric', `
  -- TODO  "meta" TEXT NOT NULL,
  CREATE TABLE "lyric" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL
  );
`)
tables.set('music_url', `
  CREATE TABLE "music_url" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "expire_time" INTEGER NOT NULL DEFAULT 0
  );
`)
tables.set('index_music_url_id', `
  CREATE UNIQUE INDEX "index_music_url_id" ON "music_url" (
    "id"
  );
`)
tables.set('index_music_url_expire_time', `
  CREATE INDEX "index_music_url_expire_time" ON "music_url" (
    "expire_time"
  );
`)
tables.set('download_list', `
  CREATE TABLE "download_list" (
    "id" TEXT NOT NULL,
    "isComplate" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "statusText" TEXT NOT NULL,
    "progress_downloaded" INTEGER NOT NULL,
    "progress_total" INTEGER NOT NULL,
    "url" TEXT,
    "quality" TEXT NOT NULL,
    "ext" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "musicInfo" TEXT NOT NULL,
    "taskOptions" TEXT NOT NULL DEFAULT '{}',
    "position" INTEGER NOT NULL,
    PRIMARY KEY("id")
  );
`)
tables.set('dislike_list', `
  CREATE TABLE "dislike_list" (
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "meta" TEXT
  );
`)

tables.set('list_trash', `
  CREATE TABLE "list_trash" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deleted_at" INTEGER NOT NULL,
    "expires_at" INTEGER NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '{}',
    "payload" TEXT NOT NULL
  );
`)
tables.set('index_list_trash_expires_at', `
  CREATE INDEX "index_list_trash_expires_at" ON "list_trash" ("expires_at");
`)

export default tables

export const QUERY_INDEXES = {
  index_lyric_id_source_type: '"lyric" ("id", "source", "type")',
  index_lyric_source: '"lyric" ("source")',
  index_my_list_music_info_list: '"my_list_music_info" ("listId", "id")',
  index_my_list_music_info_order_sort: '"my_list_music_info_order" ("listId", "order")',
  index_my_list_position: '"my_list" ("position")',
  index_list_trash_deleted_at: '"list_trash" ("deleted_at" DESC)',
} as const
for (const [name, columns] of Object.entries(QUERY_INDEXES)) tables.set(name as Tables, `CREATE INDEX "${name}" ON ${columns};`)

for (const [name, sql] of libraryTables) tables.set(name, sql)
export const DB_VERSION = '8'
