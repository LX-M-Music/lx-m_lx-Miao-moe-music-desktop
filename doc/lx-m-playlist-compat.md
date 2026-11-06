# LX-M ↔ LX-X 歌单兼容性调研报告

- 采样时间：2026-11-06 14:43–15:03（Asia/Shanghai）
- LX-M：`...\lx-Miao-moe-music-desktop-master`，git HEAD `1d5ba153`（dev），`package.json.version = 2.10.3`
- LX-X：`...\lx-lxwalnut-release-v26.09.28`，tag `v26.09.28`，commit `bbcd0a5a7af8d7c34d011e9106da6b5a0da61a6d`，882 个文件（不含 `.git`）
- 方法：静态代码核对（文件 + 行号 + 片段），不运行 Electron 测试、不执行数据库迁移
- **重要前提**：LX-M 工作区在采样期间正被并发修改（智能歌单相关文件为未提交改动，14:50–15:02 多次写入）。本报告行号对应「附录 A」所列 SHA256 前 16 位的采样版本；若本地哈希不同，说明文件已继续变化，请按新版本复核。

## 0. 结论速览

| # | 兼容面 | 方向 | 结论 |
|---|--------|------|------|
| 1 | 单列表备份 `.lxmc`（`playListPart_v2`） | LX-M ⇄ LX-X | **完全兼容** |
| 2 | WebDAV 歌单文件 `playlists.json`（v2） | LX-M ⇄ LX-X | **完全兼容**（LX-M 会过滤私有歌单） |
| 3 | LX Sync 局域网列表同步（actions / ListData） | LX-M ⇄ LX-X | **完全兼容**（移动端标识 `lx_music_mobile` 被识别） |
| 4 | 歌曲对象（MusicInfo / meta / interval / 顺序） | 双向 | **基本兼容**，少量有损字段 |
| 5 | 全量备份 `allData_v3` | LX-X → LX-M | **原样导入不兼容**（缺 `version/createdAt`、section 键不匹配）；需转换 |
| 6 | 全量备份 `allData_v3` | LX-M → LX-X | **仅设置可导入**（`playlists/downloads/plugins` 键名不匹配）；需转换 |
| 7 | Cookie 同步歌单 `userlist_<source>_sync_<remoteId>` | LX-M → LX-X | **不兼容（有意不共享）**：私有歌单被排除在所有共享通道外 |
| 8 | 智能歌单规则（LX-M v1 / legacy） | LX-M → LX-X | **不兼容**：LX-X 无规则模型、无字段、无求值器 |
| 9 | 源枚举 `git` / `musicfree_*` | 双向 | **不兼容**：LX-X 有 Gitcode(`git`)，LX-M 无；LX-M 有 `musicfree_*`，LX-X 无 |
| 10 | m3u / m3u8 导入导出 | 双向 | **双方均未实现**（LX-M 支持 txt/csv 导出，LX-X 无） |

## 1. 调研对象与采样快照

### 1.1 任务 A：LX-X 源码拉取结果

| 项目 | 结果 | 核实方式 |
|------|------|----------|
| 目标目录 | `...\lx-lxwalnut-release-v26.09.28`（新建，未触碰旧目录） | `Test-Path` = True |
| 拉取方式 | `git clone --depth 1 --branch v26.09.28` | 命令输出 `Cloning into ...`，`git describe` 成功 |
| tag / commit / 时间 | `v26.09.28` / `bbcd0a5a...` / 2026-09-23 16:03:19 +0800（浅克隆 grafted） | `git log -1 --format='%H \| %d \| %ci \| %s'` |
| package.json | `name = lx-lxwalnut-music-mobile`，**`version = 26.09.20`** | `ConvertFrom-Json` |
| 文件数 | 882（不含 `.git`） | `Get-ChildItem -Recurse -File` 计数 |

> tag 为 `v26.09.28`，但源码里的 `package.json.version` 仍是 `26.09.20`（tag 与包版本字段不同步）；后文统一以 tag `v26.09.28` 指代本次源码。

### 1.2 LX-M 工作区状态（含并发未提交改动）

```
$ git -C <LX-M> rev-parse HEAD
1d5ba153a7efaac7284a6f196bf344fea1d684d5
$ git -C <LX-M> status --short
 M src/common/ipcNames.ts
 M src/lang/en-us.json
 M src/lang/zh-cn.json
 M src/lang/zh-tw.json
 M src/main/modules/commonRenderers/list/rendererEvent.ts
 M src/main/utils/ipcPolicy.ts
 M src/main/worker/dbService/migrate.ts
 M src/main/worker/dbService/modules/list/index.ts
 M src/main/worker/dbService/modules/list/recycleBin.ts
 M src/main/worker/dbService/tables.ts
 M src/renderer/core/useApp/useDataInit.ts
 M src/renderer/store/list/listManage/action.ts
 M src/renderer/views/List/MusicList/index.vue
 M src/renderer/views/List/MyList/index.vue
 M tests/helpers/library-database-fixture.cjs
 M tests/list-trash.electron.test.cjs
?? .planning/  ?? doc/lx-m-playlist-compat.md  ?? output/
?? src/common/smartPlaylist.ts
?? src/main/worker/dbService/modules/list/smartPlaylist.ts
?? src/renderer/store/list/smartPlaylist.ts
?? src/renderer/views/List/MyList/components/SmartPlaylistModal.vue
?? tests/smart-playlist.electron.test.cjs
?? tests/smart-playlist.test.cjs
```

这些改动就是「智能歌单 v1」的落地实现（第 8 节），采样时**尚未提交**；其余被引用文件自 2026-09 起未变（mtime 见附录 A）。

## 2. LX-M 歌单存储

### 2.1 存储介质

- SQLite（`better-sqlite3`），数据库文件固定 `lx.data.db`，WAL（`src/main/worker/dbService/db.ts:38-47`）：

```ts
const databasePath = path.join(lxDataPath, 'lx.data.db')
opened = new Database(databasePath, { fileMustExist: dbFileExists, nativeBinding })
activeDB.pragma('journal_mode = WAL')
```

- 当前 schema 版本 `DB_VERSION = '8'`（`tables.ts:280`）。v8 为本次并发改动引入（`my_list` 增加 `smart_rule`）；基线为 v7（`doc/library-and-cache-fixes.md:7` E01）。

### 2.2 表结构（`src/main/worker/dbService/tables.ts`）

```ts
// tables.ts:140-151
tables.set('my_list', `
  CREATE TABLE "my_list" (
    "id" TEXT NOT NULL, "name" TEXT NOT NULL, "source" TEXT,
    "sourceListId" TEXT, "position" INTEGER NOT NULL,
    "locationUpdateTime" INTEGER, "smart_rule" TEXT,
    PRIMARY KEY("id")
  );
`)
// tables.ts:152-162
tables.set('my_list_music_info', `
  CREATE TABLE "my_list_music_info" (
    "id" TEXT NOT NULL, "listId" TEXT NOT NULL, "name" TEXT NOT NULL,
    "singer" TEXT NOT NULL, "source" TEXT NOT NULL, "interval" TEXT,
    "meta" TEXT NOT NULL, UNIQUE("id","listId")
  );
`)
```

| 表 | 关键列 | 约束/索引 |
|----|--------|-----------|
| `my_list`（140-151） | id, name, source, sourceListId, position, locationUpdateTime, smart_rule | `id` 主键；`position` 非空；`smart_rule` 可空（WIP） |
| `my_list_music_info`（152-162） | id, listId, name, singer, source, interval, meta | `UNIQUE(id,listId)`；`meta` 为 JSON 文本 |
| `my_list_music_info_order`（170-176） | listId, musicInfoId, order | 无主键；`(listId,musicInfoId)` 索引 |
| `list_trash`（254-261） | id, deleted_at, expires_at, summary, payload | 主键 id；`expires_at` 索引 |

查询索引（`tables.ts:269-276`）：`("listId","id")`、`("listId","order")`、`my_list ("position")`、`list_trash ("deleted_at" DESC)`。

### 2.3 读写路径（`modules/list/`）

- 列表查询只取 6 列（**不含 `smart_rule`**，`statements.ts:10-14`）：

```sql
SELECT "id", "name", "source", "sourceListId", "position", "locationUpdateTime"
FROM "main"."my_list" ORDER BY "position" ASC
```

- 歌曲查询按 order 表排序（`statements.ts:64-71`）：

```sql
SELECT mInfo."id","name","singer","source","interval","meta"
FROM my_list_music_info mInfo
LEFT JOIN my_list_music_info_order O ON mInfo.id=O.musicInfoId AND O.listId=@listId
WHERE mInfo.listId=@listId ORDER BY O."order" ASC
```

- 写入：`toDBMusicInfo` 把 `meta` 序列化并分配 order（`modules/list/index.ts:32-41`）：

```ts
const toDBMusicInfo = (musicInfos, listId, offset = 0) => musicInfos.map((info, index) => ({
  ...info, listId, meta: JSON.stringify(info.meta), order: offset + index,
}))
```

- 读缓存 `BoundedMap<string, LX.Music.MusicInfo[]>(12, 50000, ...)`（`index.ts:30`）；写入均包在 `db.transaction`（`dbHelper.ts:48-60、102-111、126-143` 等）。
- 列表位置：`position` 由 `createUserLists` / `updateUserListsPosition` / `listDataOverwrite` 维护为连续整数（`index.ts:60-83、146-168、375-405`）。

### 2.4 回收站与智能歌单字段

- 删除列表/歌曲时写快照（原位置锚点 `previousId/nextId` + 歌曲），恢复时插回原位（`recycleBin.ts:7-19、105-111`）。
- 并发新增：`my_list.smart_rule TEXT`（`tables.ts:148`）；回收站快照带 `smartRule` 并在恢复列表时写回（`recycleBin.ts:17-18,84,164`）；整库覆盖时保留仍存在列表的规则（`index.ts:381-395`）。细节见第 8 节。

## 3. LX-X 歌单存储

### 3.1 存储介质：AsyncStorage（无 SQLite 业务表）

- 依赖 `"@react-native-async-storage/async-storage": "^2.1.1"`（`package.json:48`）；Android 启用 Room 版：

```properties
# android/gradle.properties:51-56
AsyncStorage_useNextStorage=true
AsyncStorage_next_roomVersion=2.4.3
```

- 具体落盘库文件名由第三方库管理；**本仓库源码未出现自写数据库路径，无法核实**。

### 3.2 键与序列化

- 键前缀（`src/config/constant.ts:43-56`）：`userList = '@user_list'`、`list = '@list__'`。
- 用户列表整体一个 key：`@user_list` → `JSON.stringify(UserListInfo[])`（`src/utils/data.ts:291-308`）。
- 每列表歌曲单独 key：`@list__<listId>` → `JSON.stringify(MusicInfo[])`（`data.ts:315-333`）。
- 大值分片：单 key JSON 超 **500,000 字符**时切成 `@___PART_A___<key><i>`，主 key 存分片 key 数组的 JSON（`src/plugins/storage.ts:4-25`）；读取时 `multiGet` 拼接再 `JSON.parse`（`storage.ts:37-44`）。

### 3.3 数据结构与顺序语义

- `UserListInfo = { id, name, source?, sourceListId?, locationUpdateTime: number|null }`（`src/types/list.d.ts:3-11`）。
- `ListDataFull = { defaultList, loveList, userList: UserListInfoFull[], tempList }`（`src/types/list.d.ts:137-142`）。
- **无 `position` 字段**：列表顺序 = `@user_list` 数组下标（`src/utils/listManage.ts:135-159` 用 `splice(position,0,...)`）。
- **无 order 表**：歌曲顺序 = `@list__<id>` 数组下标；`listMusicAdd` 用 `Set` 按 id 去重后 `unshift/push`（`listManage.ts:221-246`）。
- **无回收站、无列表历史快照、无每列表标签/文件夹字段**：`src` 搜索 `trash|recycle|list_history` 无命中（android Java 中的 `recycle` 是 View 回收）。
- 全量写：`list_data_overwrite` 重写用户列表数组并逐列表写歌曲（`src/event/listEvent.ts:77-96`、`listManage.ts:98-133`）。

### 3.4 列表 ID

- 新建普通列表默认 `userlist_${Date.now()}`（`src/core/list.ts:161-186`）。
- 收藏在线歌单 `${source}_${toMD5(source__id)}`（`src/screens/SonglistDetail/listAction.ts:10,39-63`）。
- 内置 ID `default` / `love` / `temp`（`src/config/constant.ts:10-16`）。

## 4. 歌单 JSON 结构对比与字段映射

### 4.1 列表对象（userList 项）

| 语义 | LX-M | LX-X | 判定 |
|------|------|------|------|
| 列表 ID | `my_list.id TEXT`（`tables.ts:142`） | `UserListInfo.id`（`types/list.d.ts:4`） | ✅ |
| 名称 | `my_list.name` | `.name` | ✅ |
| 来源 | `kw/kg/tx/wy/mg/musicfree_*`（`common/types/common.d.ts:48`） | `kw/kg/tx/wy/mg/git`（`types/common.d.ts:4`） | ⚠️ 源集合不同 |
| 远端歌单 ID | `sourceListId` | `.sourceListId?` | ✅ |
| 位置 | `position INTEGER NOT NULL` | **无字段**，数组下标 | ⚠️ 需 position ⇄ index |
| 更新时间 | `locationUpdateTime INTEGER` | `.locationUpdateTime: number \| null` | ✅ |
| 智能规则 | `smart_rule TEXT`（WIP） | 无 | ❌ |
| 歌曲 | `my_list_music_info` + `_order` 表 | `@list__<id>` 数组 | ⚠️ 结构不同、语义可映射 |

### 4.2 歌曲对象（MusicInfo）

共有：`id`、`name`、`singer`、`source`、`interval`（`"mm:ss"`/null）、`meta`（对象）。

`meta` 共有：`songId`、`albumName`、`picUrl?`、`toggleMusicInfo?`、`qualitys`/`_qualitys`/`albumId?`、`kg.hash`、`tx.strMediaMid`/`tx.id`/`tx.albumMid`、`mg.copyrightId`/`mg.lrcUrl`/`mg.mrcUrl`/`mg.trcUrl`、本地 `filePath`/`ext`。

| 差异项 | LX-M | LX-X | 影响 |
|--------|------|------|------|
| 顶层 `alias/artists/releaseDate` | 类型中**没有**（`common/types/music.d.ts:44-51`） | 有（`types/music.d.ts:60-70`） | LX-X → LX-M 落库时**丢失**（只写 6 列，`statements.ts:80-82`） |
| `meta.fee/originCoverType/noCopyrightRcmd/_full/mv` | 无 | 有（`types/music.d.ts:39-53`） | 都在 `meta` JSON 内，LX-M 原样存，**不丢** |
| `meta.musicfree`、`meta.webdav/year/fileSize` | 有（`music.d.ts:29,35-41`） | 无 | LX-X 可存但不识别 |
| `kg.albumAudioId`、`tx.songType`、`mg.contentId` | 有 | 无 | 可忽略 |
| 品质枚举 | `128k,320k,flac,flac24bit,192k,ape,wav,hires,atmos,atmos_plus,master`（`common/types/common.d.ts:50`） | `128k,320k,flac,hires,atmos,atmos_plus,master`（`types/common.d.ts:6`） | LX-X 的 `fixNewMusicInfoQuality` 把 flac24bit→hires（`src/utils/index.ts:186-198`）；`192k/ape/wav` 不在 LX-X 枚举 |
| 源枚举 | 无 `git`，有 `musicfree_*` | 有 `git`，无 `musicfree_*` | 见 4.4 |

### 4.3 字段映射表（LX-M 存储 → LX-X 存储）

| LX-M 位置 | LX-X 位置 | 转换规则 |
|-----------|-----------|----------|
| `my_list.id` | `userList[i].id` | 原样 |
| `my_list.name` | `userList[i].name` | 原样 |
| `my_list.source/sourceListId/locationUpdateTime` | 同名字段 | 原样（`source` 见 4.4） |
| `my_list.position` | `userList` 数组下标 | 按 `ORDER BY position ASC` 写入数组 |
| `my_list_music_info.*` + `_order.order` | `@list__<id>` 数组 | 按 `order ASC` 写入 `MusicInfo[]` |
| `my_list_music_info.meta`（TEXT） | 数组项 `meta`（对象） | `JSON.parse` / `JSON.stringify` |
| `my_list_music_info.interval` | 数组项 `interval` | 原样（同为 `"mm:ss"`） |
| `my_list.smart_rule` | **无对应** | 无法映射（第 8 节） |
| （无） | `tempList`（`@list__temp`） | LX-M 也有 `temp` 列表，但共享格式不含 temp |

### 4.4 差异清单与转换注意

1. **源枚举不一致**：LX-X 的 `git`（Gitcode）源见 `src/utils/musicSdk/index.js:6,33-34,46`，歌曲产出 `source:'git'`（`src/utils/musicSdk/git/musicSearch.js:35,77,105,122`）；LX-M 白名单不含 `git`（`src/common/backup.ts:77`、`src/main/modules/webdav/data.ts:40`）。结果：LX-X 歌单若含 `git` 歌曲，**LX-M 的备份导入/WebDAV 歌单同步会被校验拒绝**；LX Sync 不校验源但 LX-M 无 Gitcode SDK，不能播放。反向：LX-M 的 `musicfree_*` 在 LX-X 结构上可存但无 SDK。
2. **品质枚举**：LX-M `flac24bit` 由 LX-X `fixNewMusicInfoQuality` 自动转 `hires`；`192k/ape/wav` 不在 LX-X 类型内，导出前建议归一化。
3. **顶层字段有损**：LX-X 的 `alias/artists/releaseDate` 在 LX-M 落库时丢失（LX-M 只持久化 `id/name/singer/source/interval/meta`）；不影响播放，影响少量展示/检索。
4. **本地歌曲路径**：两边 `meta.filePath` 都是绝对路径，跨设备无意义；导入后需重新关联（LX-M 有曲库文件管理，LX-X 无同等能力）。
5. **ID 生成规则一致**：`<source>_<songmid>`，酷狗为 `<songmid>_<hash>`（LX-M `src/common/utils/tools.ts:10,36-41`；LX-X `src/utils/index.ts:36,99-103`）；收藏歌单 ID 同为 `${source}_${md5(source__id)}`（LX-M `src/renderer/views/songList/Detail/action.ts:10,31`；LX-X `src/screens/SonglistDetail/listAction.ts:10,57`）。

## 5. 备份 / 恢复格式对比

### 5.1 LX-M 备份（`src/common/backup.ts` + `src/main/modules/backup.ts`）

- 容器：`.lxmc` = **gzip(JSON)**；`saveLxConfigFile` 自动补 `.lxmc`（`src/common/utils/nodejs.ts:150-158`），读取支持 `.json` 明文与 gzip（`nodejs.ts:182-205`）。
- 全量导出：`{ type:'allData_v3', version:3, createdAt:Date.now(), data }`（`src/main/modules/backup.ts:100`）。
- section 白名单：`playlists / settings / downloads / lyrics / plugins / library`（`backup.ts:12`）。
- `playlists` 是数组，每项含 `id/name/source/sourceListId/locationUpdateTime/list`，并包含 `default/love/temp`（`dbService/backup.ts:53-61`）。
- 导入校验：

```ts
// backup.ts:207-210
case 'allData_v3':
  if (raw.version !== 3 || !finite(raw.createdAt)) fail('version')
  return validateBackupData(raw.data)
// backup.ts:169：data 的键必须全部属于 BACKUP_SECTIONS，否则 fail('sections')
```

- 支持旧类型：`allData`、`allData_v2`、`playList`、`playList_v2`、`playListPart_v2`、`defautlList`、`setting(_v2)`（`backup.ts:207-224`）。

### 5.2 LX-X 备份（`...\Backup\actions.ts`）

- 容器相同：`.lxmc` = gzip(JSON)（`src/utils/tools.ts:187-194`）。
- 全量导出**没有** `version` / `createdAt`：

```ts
// actions.ts:273-287
const data = JSON.parse(JSON.stringify({ type: 'allData_v3', data: await getAllDataForSync() }))
await handleSaveFile(path + '/lx_backup.lxmc', data)
```

- `data` 结构（`src/core/sync/syncHelpers.ts:24-47`）：`{ lists, playHistory, downloadTasks, settings, userApis }`；`lists` 是**对象**（`ListDataFull`），不是数组。
- 导入：`case 'allData_v3': return importBackupData(configData.data)`（`actions.ts:237-238`）；`importBackupData` 只读 `data.lists/playHistory/downloadTasks/settings/userApis`（`actions.ts:168-190`），**不校验 version/createdAt**。
- 单列表：`type:'playListPart_v2'`，`data` 为 `UserListInfoFull`（`MyList/listAction.ts:29-51,66-81`）。

### 5.3 互导矩阵

| 方向 | 文件类型 | 结果 | 证据/原因 |
|------|----------|------|-----------|
| LX-X → LX-M | 单列表 `playListPart_v2` | ✅ 成功 | LX-M `useShare.ts:46-59`；`backup.ts:217` |
| LX-M → LX-X | 单列表 `playListPart_v2` | ✅ 成功 | LX-X `MyList/listAction.ts:37-50`、`Backup/actions.ts:246-252` |
| LX-X → LX-M | 全量 `allData_v3` | ❌ **失败** | 缺 `version/createdAt` → `fail('version')`（`backup.ts:209`） |
| LX-X → LX-M（补 version/createdAt） | 全量 `allData_v3` | ❌ 仍失败 | `data` 键 `lists/playHistory/downloadTasks/settings/userApis` 不在 section 白名单 → `fail('sections')` |
| LX-M → LX-X | 全量 `allData_v3` | ⚠️ **只导入设置** | LX-X 只读 `data.lists/downloadTasks/userApis`；LX-M 用 `playlists/downloads/plugins` → 歌单/下载/自定义源被静默跳过，`settings` 生效（`actions.ts:168-190`） |

> LX-X 对 `allData_v3` 不校验版本，所以 LX-M 的备份文件会被「接受」但只导入设置，并提示“部分设置需要重启后生效”（`actions.ts:189`）——是**静默部分导入**，比直接报错更危险。

### 5.4 单列表互导细节（可视为完全兼容）

- LX-M 导出 `{ type:'playListPart_v2', data:{ ...listInfo, list } }`（`useShare.ts:22-25`）。
- LX-X 导入只要求 `type` 与 `data.list`（`MyList/listAction.ts:43-49`、`Backup/actions.ts:246-252`）。
- 冲突策略：两边都对同 ID 列表提供「覆盖」或「改名追加」（LX-M `useShare.ts:61-92`；LX-X `actions.ts:116-140`）。
- 差异：LX-M 导出对象来自 `getAllUserList`，**不含 `smart_rule`** → 智能歌单导出后变成静态歌单；LX-X 导出同样无规则字段。

## 6. 同步协议对比

### 6.1 WebDAV：手机版 `playlists.json`（双向兼容，重点）

```ts
// LX-X src/core/sync/webdavSync.ts:24-30,56-60,86-100
interface ListsSyncFile { version?: string; lastModified: number; data: LX.List.ListDataFull;
  playHistory?: ...[]; downloadTasks?: ...[] }
// 文件路径：`${setting['sync.webdav.path'] || '/LX_Music/'}/playlists.json`
const dataObject = { version: '2', lastModified: timestamp, data: listsData, playHistory, downloadTasks }
// LX-M src/main/modules/webdav/mobilePlaylists.ts:14-33
parseMobilePlaylists: 要求 version 为 undefined/'2'、lastModified 安全整数、data.tempList/userList 为数组
buildMobilePlaylists: { ...previous, version:'2', lastModified: max(now, prev+1),
  data: { ...previous.data, ...sharedPlaylistData(playlists), tempList: previous.data.tempList ?? [] } }
```

- LX-M 用独立配置 `sync.webdav.playlistsDirectory`，固定文件名 `playlists.json`（`src/main/modules/webdav/index.ts:57-59`），先读后写（`index.ts:82-84,127-133`）。
- 私有歌单过滤：`userlist_(wy|tx|kg|kw|mg)_sync_*` 不写入共享文件（`src/common/privatePlaylists.ts:3-10`、`index.ts:78,128-131`）。
- `...previous` 使 `playHistory/downloadTasks` 等顶层字段原样保留；`tempList` 保留旧值。
- 结论：**双向兼容**；前提是 `data.userList` 每项为对象、`data.tempList` 为数组（LX-X 的 `getAllDataForSync` 始终包含 tempList，`syncHelpers.ts:32`）。

### 6.2 LX Sync 局域网同步（兼容）

- 数据模型一致：`ListData = Omit<ListDataFull,'tempList'>`（LX-X `src/types/list_sync.d.ts:32`；LX-M `src/common/types/list_sync.d.ts:23`）。
- 动作名/payload 一致：`list_data_overwrite/list_create/list_remove/list_update/list_update_position/list_music_*`（LX-X `src/plugins/sync/listEvent.ts:18-31,163-217`；LX-M `src/main/modules/sync/listEvent.ts:39-78,185-233`）。
- 身份识别：LX-X 客户端认证消息带 `lx_music_mobile`（`src/plugins/sync/client/auth.ts:53`）；LX-M 服务端识别该标识（`src/main/modules/sync/server/server/auth.ts:59`）。
- LX-M 对私有 Cookie 歌单做过滤/位置换算（`src/main/modules/sync/listEvent.ts:16-37,39-78`），LX-X 无此概念但不受影响。
- 结论：**兼容**（协议层一致；未做真机联调，属静态核对）。

### 6.3 Cookie 同步歌单（LX-M 专有）

- ID 规则 `userlist_${source}_sync_${remoteId}`，名称 `${SOURCE_NAME[source]} - ${playlist.name}`（`src/renderer/utils/cookieSync.ts:16-30`）。
- 该前缀被定义为「私有歌单」，在 WebDAV 与 LX Sync 中都被排除（`privatePlaylists.ts:3-10`；`webdav/index.ts:78,128-131`；`sync/listEvent.ts:25,43-76`）。
- **LX-X 没有等价功能**：启动初始化只把网易云数据放进 store 缓存，不创建本地歌单（`src/core/init/dataInit.ts:51-84`）；全仓库无 `_sync_` 形式的列表 ID 生成。
- 结论：**不兼容（设计上不共享）**，注释已明确「其他 LX 客户端使用同一线路格式但无法获得这些歌单」（`privatePlaylists.ts:1-2`）。

### 6.4 自定义源（不是歌单）

- LX-X：WebDAV 目录内 `user_apis.json`，`{ version:'2', lastModified, data:{ list, scripts } }`（`webdavSync.ts:68-84,281-291`）。
- LX-M：全量备份的 `plugins` section（`backup.ts:15-19,146-165`），与 LX-X 不通用。结论：与歌单兼容性无关，但自定义源不能跨端迁移。

## 7. 歌单导入 / 导出支持

| 能力 | LX-M | LX-X | 证据 |
|------|------|------|------|
| 单列表 `.lxmc` 导出 | ✅ `playListPart_v2` | ✅ `playListPart_v2` | LX-M `useShare.ts:15-27`；LX-X `MyList/listAction.ts:66-81` |
| 单列表 `.lxmc` 导入 | ✅ `.json`/`.lxmc` | ✅ `.lxmc`（JSON 明文亦可读） | LX-M `useShare.ts:28-103`；LX-X `MyList/listAction.ts:29-64`、`tools.ts:195-205` |
| 全量 `.lxmc` 导出 | ✅ `allData_v3`（带 version/createdAt） | ✅ `allData_v3`（无 version/createdAt） | 第 5 节 |
| 全量 `.lxmc` 导入 | ✅ 多版本 | ✅ 多版本 | 第 5 节 |
| 文本导出 | ✅ 设置 → 备份 → 导出文本 | ❌ 未找到 | LX-M `SettingBackup.vue:24`、`src/renderer/worker/main/list.ts:286-298` |
| CSV 导出 | ✅ 设置 → 备份 → 导出 CSV | ❌ 未找到 | LX-M `SettingBackup.vue:25,124-127`、`list.ts:307-327` |
| m3u / m3u8 | ❌ 未找到 | ❌ 未找到 | 两边 `m3u` 均无命中；LX-M 优化清单 E18 也在提“缺少 M3U8”（`ai跑的建议优化.txt:33`） |
| 平台歌单收藏 | ✅ `${source}_${md5}` | ✅ 同规则 | 4.4 第 5 条 |
| 平台歌单自动更新 | ✅ `sourceListId` 刷新 | ✅ `syncSourceList` | LX-M `src/renderer/store/list/syncSourceList.ts:16-40`；LX-X `src/core/syncSourceList.ts:24-38` |

## 8. 智能歌单 / 动态歌单

### 8.1 LX-X 现状：**没有该功能**

- `src` 全量搜索 `smart|智能歌单|dynamic playlist` 仅命中网络接口名（`smartbox_new.fcg`）与搜索 SDK。
- 列表数据只有 `id/name/source/sourceListId/locationUpdateTime`，歌曲是静态数组（第 3 节）。
- `playListPart_v2` 的 `data` 类型是 `UserListInfoFull`（`src/types/list.d.ts:130-135`），`playlists.json` 的 `userList` 项同型；额外字段即使写入也不会被持久化。

### 8.2 LX-M 现状：两套模型并存（v1 为未提交 WIP）

**（a）legacy 模型（已提交，仅 schema + 校验）**：`src/common/library.ts:1-2,21-22` 定义 `SmartRule { kind:'recent'|'unplayed'|'downloaded', days, sourceList }` 并校验；但 `src` 内 `getSmartPlaylist*`/`unplayed`/`recent` 只命中该文件，`git log -S 'unplayed'` 也只命中该 schema → **未找到任何求值/刷新/UI 实现**。文档却声称已支持三类规则（`doc/library-and-cache-fixes.md:20` E14），**文档与当前源码不一致**（可能在其它分支/构建，本报告不臆测）。

**（b）v1 模型（未提交 WIP，采样时正在实现）**：纯逻辑 `src/common/smartPlaylist.ts`（`SMART_PLAYLIST_VERSION = 1`）；存储 `my_list.smart_rule TEXT`；求值 `src/main/worker/dbService/modules/list/smartPlaylist.ts`；渲染层缓存/触发器 `src/renderer/store/list/smartPlaylist.ts`；编辑弹窗 `SmartPlaylistModal.vue`；IPC `list_smart_get/save/evaluate/refresh`（`src/common/ipcNames.ts:41-44`；`src/main/modules/commonRenderers/list/rendererEvent.ts:61-78`；`src/main/utils/ipcPolicy.ts:111-114`）。

### 8.3 v1 规则 schema（逐项）

| 维度 | 规格 | 证据（`src/common/smartPlaylist.ts`） |
|------|------|------|
| 顶层 | `{version:1, name, groups, sort, order, limit}` | 59-67 |
| 分组 | `groups[]` 最多 20 组，组间固定 **AND** | 52-56、243、402-406 |
| 组内 | `{any:boolean, rules[]}` 最多 20 条；`any=true` 为 OR，否则 AND | 52-56、247-250、402-406 |
| 字段 | `name` `singer` `album` `source` `interval` `playCount` `lastPlayed` `inPlaylist` `isLoved` | 14-23、89-99 |
| 操作符 | `is` `isNot` `contains` `notContains` `startsWith` `gt` `lt` `inTheRange` `inTheLast` `notInTheLast` `inPlaylist` `notInPlaylist` | 26-38、101-114 |
| 字段×操作符白名单 | 文本字段 5 个文本操作符；`interval/playCount`：`gt/lt/inTheRange`；`lastPlayed`：`inTheLast/notInTheLast`；`inPlaylist`：`inPlaylist/notInPlaylist`；`isLoved`：`is/isNot` | 128-142 |
| 值类型 | 文本 string（≤500）；数值非负 number；`inTheRange` 为 `[min,max]`；`lastPlayed` 天数 1–36500；`inPlaylist` 非空歌单 ID；`isLoved` boolean（也接受 `"true"/"false"`） | 146-152、191-219 |
| 排序 | `sort ∈ name/singer/album/interval/playCount/lastPlayed/random`；`order ∈ asc/desc`；`random` 忽略 order | 40-41、116-126、408-424 |
| 限制 | `limit` 0–100000，0=不限 | 65-66、189、425 |
| 求值语义 | 空分组忽略；**无有效条件 → 返回空数组**；文本 `toLowerCase` + `localeCompare('zh-CN',{sensitivity:'base',numeric:true})`；`interval` 解析 `mm:ss`/`h:mm:ss`/秒 | 280-300、300-311、360-363、389-406 |
| 上下文 | `playStats: Map<songId,{count,lastPlayed}>`、`listMembership: Map<songId,Set<listId>>`、`now` | 69-78、322-355 |
| `isLoved` | 归属集合含 `LIST_IDS.LOVE`（`'love'`） | 352-355 |

### 8.4 存储与刷新策略（LX-M WIP）

```ts
// worker smartPlaylist.ts:27-59：SELECT id,smart_rule FROM my_list ...；saveSmartPlaylistRule 校验后 UPDATE my_list.smart_rule
// worker smartPlaylist.ts:61-98：候选池 = 所有歌单歌曲去重（ORDER BY rowid DESC）；
//   listMembership 排除目标歌单自身（避免规则引用自己循环）
// worker smartPlaylist.ts:94：SELECT song_id AS id, COUNT(*) AS count, MAX(played_at) AS lastPlayed
//   FROM listening_history GROUP BY song_id
// rendererEvent.ts:72-78：刷新 = getSmartPlaylistSongs → list_music_overwrite（走正常事件，同步/缓存/WebDAV 观察者可见）
```

| 问题 | 实测（截至采样） |
|------|------------------|
| 定时刷新 | **未找到**定时器/调度器 |
| 触发式自动刷新 | ✅ 打开歌单时 `refreshSmartPlaylist(id)`（`src/renderer/views/List/MusicList/index.vue:203`）；保存规则后刷新（`SmartPlaylistModal.vue:402`）；启动时加载规则（`src/renderer/core/useApp/useDataInit.ts:65`） |
| 渲染层缓存 | `src/renderer/store/list/smartPlaylist.ts:9-52`（规则缓存 + load/save/preview/refresh） |
| 同步边界 | 该文件注释明确「规则本体只保存在本地数据库（my_list.smart_rule），不参与列表同步」（`src/renderer/store/list/smartPlaylist.ts:6-8`） |
| 求值时机 | 每次请求即时求值（预览/刷新），无缓存 |
| 结果存储 | 物化为 `my_list_music_info` 普通行（导出/同步得到静态歌曲列表） |
| 整库覆盖保护 | 备份恢复/LX Sync/WebDAV 覆盖时保留本地规则（`index.ts:381-395`、worker `smartPlaylist.ts:115-126`） |
| 回收站 | 规则随列表快照归档/恢复（`recycleBin.ts:17-18,84,164`） |
| 迁移 | DB v8 重建 `my_list` 增加 `smart_rule`（`migrate.ts:67-77`） |

### 8.5 与 LX-X 对齐评估

| 维度 | LX-M v1 | LX-X | 结论 |
|------|---------|------|------|
| 规则模型 | 有（groups/字段/操作符/排序/limit/version） | 无 | ❌ 无法映射 |
| 存储位置 | `my_list.smart_rule` | 无此字段 | ❌ 无法保存 |
| 共享线路是否携带 | 否：`playListPart_v2` 导出对象不含 `smart_rule`；`playlists.json` 由 `LX.Sync.List.ListData` 构建也不含；LX Sync 同理 | 即使写入也会被丢弃 | ❌ 无法传输 |
| 规则求值 | 有（即时求值） | 无 | ❌ 无法执行 |
| 刷新 | 打开歌单/保存规则时刷新 | 无 | ❌ |
| 数据源（若未来实现） | `listening_history` + `my_list_music_info` | `playHistory`（`types/player.d.ts:82-90` 含 `playedAt`）+ 各列表数组 | 可推导，但目前无实现 |
| 字段语义 | `interval` 秒、`lastPlayed` 天数、`inPlaylist` 歌单 ID、`isLoved`=`love` | 同名数据均存在 | 语义可对齐 |

**对齐结论：不兼容。** 规则本身无法跨端；只有「把智能歌单物化成静态歌单后再导出」这条路径可行（当前实现天然如此，因为求值结果写在 `my_list_music_info`）。

### 8.6 差异处理建议（若后续要求跨端）

1. **不要把规则写进现有共享格式**：`playListPart_v2` / `playlists.json` / LX Sync 的 `userList` 项都没有规则字段，LX-X 会静默丢弃。相关 LX-M 文件：`src/common/backup.ts`、`src/main/modules/webdav/mobilePlaylists.ts`、`src/main/modules/sync/listEvent.ts`、`src/common/types/list.d.ts`。
2. **若必须共享规则**：新增可选 `smartRule` 扩展字段 + 版本协商，只对声明支持的客户端写入；LX-X 侧需新增持久化字段与求值器（当前无）。
3. **优先做「导出即物化」**：智能歌单导出为静态列表（现状即如此），LX-X 可直接导入；导出文件可附带只读 `smartRule`（LX-X 忽略）供 LX-M 回导恢复。
4. **补齐 LX-M 自身规则可迁移性**（当前采样版本有缺口）：`my_list.smart_rule` 未出现在 `queryAllUserList` 的 SELECT（`statements.ts:10-14`），`backupRead()`（`dbService/backup.ts:53-61`）也因此不会导出规则 → **LX-M 自己的全量备份换机后规则丢失**；单列表导出（`useShare.ts:22-25`）同样不含规则。建议在 `dbService/backup.ts` 与 `src/common/backup.ts` 增加可选 `smartRule` 的导出/校验/恢复。
5. **跨端语义注意**：`inPlaylist` 若引用 `userlist_<source>_sync_*`，在 LX-X 上必然匹配不到；`isLoved` 用 `'love'` 两边一致，可安全迁移；`playCount/lastPlayed` 需 LX-X 侧建立统计（目前只有原始 `playHistory`）；排序比较器应复用 `localeCompare('zh-CN',{sensitivity:'base',numeric:true})`（`smartPlaylist.ts:360-363`），`random` 天然不一致。

## 9. 结论分级与修复点

### 9.1 完全兼容（无需代码改动）

| 对象 | 依据 |
|------|------|
| 单列表 `.lxmc`（`playListPart_v2`）双向 | 5.4 节；两侧 type/data 形状一致 |
| WebDAV 手机版 `playlists.json` 双向 | 6.1 节；LX-M 已按 LX-X 文件格式解析/写回 |
| LX Sync 列表同步（actions/ListData） | 6.2 节；模型、动作名、移动端标识一致 |
| 歌曲对象基础字段 / `meta` / `interval` | 4.2 节；同一上游血统，JSON 兼容 |
| 列表 ID 规则（default/love/temp、`userlist_<ts>`、收藏歌单 `<source>_<md5>`） | 3.4、4.4 节 |

### 9.2 需转换即可兼容

| 对象 | 方向 | 原因 | 建议修复点（LX-M 侧） |
|------|------|------|------------------------|
| 全量备份 `allData_v3` | LX-X → LX-M | 缺 `version/createdAt`；`data` 键为 `lists/playHistory/downloadTasks/userApis` | `src/common/backup.ts`：`normalizeBackup` 增加「LX-X 全量」分支，容忍缺失 version/createdAt，把 `lists{defaultList,loveList,userList,tempList}` 映射为 `playlists[]`；`git` 源过滤或标记不可播 |
| 全量备份 `allData_v3` | LX-M → LX-X | LX-X 只认 `data.lists/downloadTasks/userApis`；LX-M 发 `playlists/downloads/plugins`；`library/lyrics` 无对应 | `src/main/modules/backup.ts`：新增「导出为移动版 allData_v3」分支，产出 `{type:'allData_v3',version:3,createdAt,data:{lists,playHistory,downloadTasks,settings,userApis}}` |
| 品质枚举差异 | 双向 | LX-M 有 `flac24bit/192k/ape/wav`；LX-X 只有 7 种 | 导出前归一化（`src/common/utils/tools.ts` 或导出路径），或依赖 LX-X 的 `fixNewMusicInfoQuality`（仅覆盖 flac24bit→hires） |
| 源集合差异（`git` / `musicfree_*`） | 双向 | LX-M 无 Gitcode，LX-X 无 MusicFree | 若要「只存不播」：把 `git` 加入 `src/common/backup.ts:77` 与 `src/main/modules/webdav/data.ts:40` 源白名单；否则导入时过滤并提示 |
| 顶层 `alias/artists/releaseDate` | LX-X → LX-M | LX-M 不持久化这三个字段 | 若需保留：`tables.ts` + `statements.ts` 增列/JSON 子字段（成本较高，可先接受有损） |
| Cookie 私有歌单 | LX-M → LX-X | 有意排除（`privatePlaylists.ts`） | 如需共享：显式开关 + 改名/换 ID 后再写入（涉及 `privatePlaylists.ts`、`webdav/mobilePlaylists.ts`、`sync/listEvent.ts`） |
| 本地歌曲路径 | 双向 | 绝对路径跨设备无效 | 导入后走 LX-M 曲库「重新关联」（现有功能） |

### 9.3 不兼容

| 对象 | 原因 | 建议 |
|------|------|------|
| 智能歌单规则（LX-M v1）跨 LX-X | LX-X 无规则 schema/字段/求值；共享格式都不携带规则，导入即丢 | 保持 LX-M 本地化；跨端只共享物化后的静态歌单；必须共享则双方新增可选字段（8.6） |
| LX-M legacy `SmartRule`（recent/unplayed/downloaded） | 同上；且 LX-M 当前源码未找到求值实现（8.2a） | 先补齐 LX-M 内部实现与 UI，再谈跨端 |
| LX-X `git`（Gitcode）源歌曲 → LX-M 备份/WebDAV | LX-M 校验白名单拒绝（`backup.ts:77`、`webdav/data.ts:40`） | 导入前过滤/转换，或增加白名单+「不可播放」标记 |
| LX-X 回收站/历史快照/标签等扩展概念 | LX-X 完全没有这些概念（src 无实现） | 只作为 LX-M 本地能力，不进入共享格式 |
| m3u/m3u8 | 双方均未实现 | 需要时在 LX-M `src/renderer/worker/main/list.ts` 旁新增（属新功能，不是兼容缺陷） |

### 9.4 修复点索引（按文件）

| 文件 | 需要改什么 | 优先级 |
|------|-----------|--------|
| `src/common/backup.ts` | 支持 LX-X 全量 `allData_v3`（缺 version、`lists` 结构）；`playlists` 校验允许可选 `smartRule`；`git` 源策略 | 高 |
| `src/main/modules/backup.ts` | 增加「导出为移动版 allData_v3」 | 中 |
| `src/main/worker/dbService/modules/list/statements.ts` | 若要让规则进入 LX-M 备份：查询列出 `smart_rule` | 高（否则规则不可迁移） |
| `src/main/worker/dbService/backup.ts` | `backupRead`/`applyDatabase` 读写 `smartRule` | 高 |
| `src/common/types/list.d.ts` | `UserListInfo` 可选 `smartRule?`（仅当决定跨端共享） | 低 |
| `src/main/modules/webdav/mobilePlaylists.ts` / `src/main/modules/sync/listEvent.ts` | 若共享规则：解析/构建/动作过滤时带上或剥离该字段并做版本协商 | 低 |
| `src/renderer/store/list/smartPlaylist.ts` | 跨端时决定规则缓存是否随同步刷新（当前注释明确不同步） | 低 |

## 10. 未核实项与限制

1. **LX-X 的 AsyncStorage 物理文件**：只核实到库依赖与 Android 配置（`package.json:48`、`android/gradle.properties:53-56`）；源码无自写数据库路径常量，**无法核实**具体库文件名/目录。
2. **LX-X 的 `git` 源是否实际出现在用户歌单**：只核实到 SDK 与类型存在（`types/common.d.ts:4`、`musicSdk/git/*`），未核实线上数据分布；兼容结论按「若出现则不兼容」描述。
3. **LX-M legacy 智能规则的求值实现**：源码未找到（8.2a）；文档声称存在三类规则，但当前检出代码只有 schema/校验。**未找到实现，无法核实其行为**。
4. **LX-M v1 智能歌单的最终形态**：采样期间仍在被并发修改（14:50–15:00 多次写入），本报告按采样哈希描述；若继续变化，行号与结论可能需更新。
5. **刷新策略**：未找到定时刷新；已核实打开歌单、保存规则会触发刷新（8.4）。
6. **运行时验证**：按要求未运行 Electron/移动端测试，未做真机/双端联调；结论基于静态代码。
7. **LX-X 播放历史的上限/清理策略**：未核实（不影响兼容结论）；**m3u**：双方全仓库无命中，判定为「未实现」而非隐藏功能。

## 附录 A：证据文件采样哈希（SHA256 前 16 位）

> 采样时间 2026-11-06 14:43–15:01（+08:00）；LX-M HEAD `1d5ba153a7efaac7284a6f196bf344fea1d684d5`。WIP 文件 mtime 均为 2026-11-06 14:5x–15:00，其余为 2026-07~10。

### A.1 LX-M（两列并排，每格 `文件 → 哈希`）

| 文件 → SHA256-16 | 文件 → SHA256-16 |
|---|---|
| `dbService/tables.ts` → `b2de42b9d83e817b` | `dbService/modules/list/index.ts` → `fe6f3da04ca978c6` |
| `dbService/db.ts` → `3a550215c28d706a` | `dbService/modules/list/recycleBin.ts` → `287fc47bb60c1181` |
| `dbService/migrate.ts` → `32a4d80196226290` | `dbService/modules/list/smartPlaylist.ts` → `acb723608c32d2a0` |
| `dbService/backup.ts` → `3baf9d581eab34e9` | `dbService/modules/list/statements.ts` → `ca157bc6cecd8b72` |
| `dbService/modules/list/dbHelper.ts` → `c222e1c600cba76c` | `modules/backup.ts` → `a84d1f05c4ba095f` |
| `modules/commonRenderers/list/rendererEvent.ts` → `633b4469ae2f2257` | `modules/webdav/index.ts` → `1d83b1514b3586da` |
| `modules/webdav/data.ts` → `9089497a45d2d437` | `modules/webdav/mobilePlaylists.ts` → `76c364e188fee7d2` |
| `modules/sync/listEvent.ts` → `a38d3237fb0503d7` | `modules/sync/server/modules/list/sync/sync.ts` → `217b7ce9fc1167a6` |
| `common/backup.ts` → `5287deddd7aa8c01` | `common/privatePlaylists.ts` → `b4d2e729bb5a1080` |
| `common/smartPlaylist.ts` → `a817fbe9fcc19d67` | `common/library.ts` → `461fbdd7e3cf670c` |
| `common/constants.ts` → `50769c4be276dfab` | `common/utils/nodejs.ts` → `e9c5422af97c9eba` |
| `common/types/list.d.ts` → `d59a6f4a571d7319` | `common/types/music.d.ts` → `bc26712d6807afc5` |
| `common/types/common.d.ts` → `ef29bed7245cdb64` | `renderer/utils/cookieSync.ts` → `95e3cfdadcb1ac4d` |
| `renderer/views/List/MyList/useShare.ts` → `576d5c1553145fb9` | `renderer/worker/main/list.ts` → `cac400fa91d42388` |
| `common/ipcNames.ts` → `a295468ade6d5dd5` | `main/utils/ipcPolicy.ts` → `3dc441cc123742a1` |
| `renderer/store/list/smartPlaylist.ts` → `afa502ed65a70d42` | `renderer/core/useApp/useDataInit.ts` → `56a7a19db732d083` |
| `renderer/views/List/MusicList/index.vue` → `4a7f1517c4fb3e3b` | `renderer/views/List/MyList/components/SmartPlaylistModal.vue` → `dedf60eafb035983` |

其他引用文件未取哈希，行号引用来自采样时读取：`src/renderer/views/Setting/components/SettingBackup.vue`、`src/renderer/core/useApp/listAutoUpdate.ts`、`src/main/modules/sync/server/server/auth.ts`、`src/renderer/views/songList/Detail/action.ts`、`src/common/utils/tools.ts`。

### A.2 LX-X（tag `v26.09.28`，commit `bbcd0a5a`）

| 文件 → SHA256-16 | 文件 → SHA256-16 |
|---|---|
| `package.json` → `4b1e411797389631` | `src/types/list_sync.d.ts` → `48e8a323d98f0f59` |
| `android/gradle.properties` → `be3f645f6036cecf` | `src/types/player.d.ts` → `892f9697bd880d5c` |
| `src/config/constant.ts` → `814db55a02b05a7d` | `src/plugins/sync/listEvent.ts` → `c61e7c576b1ea65d` |
| `src/utils/data.ts` → `04545f85d8b2110e` | `src/plugins/sync/client/auth.ts` → `b8b4f08b0a02639f` |
| `src/utils/listManage.ts` → `48cfdb23ad4a95ab` | `src/core/sync/webdavSync.ts` → `e5f338c76f9602af` |
| `src/plugins/storage.ts` → `0fe72f870f0aebf0` | `src/core/sync/syncHelpers.ts` → `ca30a75d5051097e` |
| `src/event/listEvent.ts` → `e1ed6a778600e015` | `src/core/list.ts` → `736c60e59a044c63` |
| `src/types/list.d.ts` → `7ec47a63ed38a1e5` | `src/core/syncSourceList.ts` → `0b7281b4f9ef699f` |
| `src/types/music.d.ts` → `ee2cbc76fce77efb` | `src/core/init/dataInit.ts` → `74560e7e43395e19` |
| `src/types/common.d.ts` → `d88c87319e731df5` | `...\Backup\actions.ts` → `10ccd7dcf90ec566` |
| `src/types/config_files.d.ts` → `56c2a6d3a486c780` | `...\Mylist\MyList\listAction.ts` → `41d7bfe730323bfa` |
| `src/screens/SonglistDetail/listAction.ts` → `cf7f320b9638ff8b` | `src/utils/tools.ts` → `44a80acf16570de3` |
| `src/utils/index.ts` → `9544115bccdfb051` | — |

## 附录 B：本次实际执行的验证命令（摘要）

```powershell
# 拉取 LX-X v26.09.28（浅克隆，未触碰旧目录）
git clone --depth 1 --branch v26.09.28 https://github.com/WalnutBai/lx-lxwalnut-music-mobile.git `
  'D:\...\lx-lxwalnut-release-v26.09.28'
git -C <dir> log -1 --format='%H | %d | %ci | %s'   # bbcd0a5a... | tag: v26.09.28
git -C <dir> describe --tags                         # v26.09.28
(Get-Content <dir>\package.json -Raw | ConvertFrom-Json).version  # 26.09.20
(Get-ChildItem <dir> -Recurse -File -Force | Where-Object { $_.FullName -notlike '*\.git\*' }).Count  # 882

# LX-M 版本/状态
git -C <LX-M> rev-parse HEAD                         # 1d5ba153...
(Get-Content <LX-M>\package.json -Raw | ConvertFrom-Json).version  # 2.10.3
git -C <LX-M> status --short                         # 见 1.2

# 结构与序列化
Select-String -Path <LX-X>\src\types\list.d.ts -Pattern 'UserListInfo|ListDataFull'
Select-String -Path <LX-X>\src\config\constant.ts -Pattern 'storageDataPrefix|userList|list:'
Select-String -Path <LX-X>\src\utils\data.ts -Pattern 'saveUserList|saveListMusics|getUserLists'
Select-String -Path <LX-M>\src\main\worker\dbService\tables.ts -Pattern 'my_list|smart_rule|DB_VERSION'

# 备份/同步
Select-String -Path <LX-X>\src\core\sync\webdavSync.ts -Pattern 'ListsSyncFile|playlists.json|lastModified'
Select-String -Path <LX-M>\src\main\modules\webdav\mobilePlaylists.ts -Pattern 'parseMobilePlaylists|buildMobilePlaylists'
Select-String -Path <LX-M>\src\common\backup.ts -Pattern "allData_v3|BACKUP_SECTIONS|fail\('version'\)"
Select-String -Path <LX-X>\...\Backup\actions.ts -Pattern 'importBackupData|allData_v3|exportAllList'

# 智能歌单 / 导入导出 / 回收站
Get-ChildItem <LX-M>\src -Recurse -File -Include *.ts,*.vue |
  Select-String -Pattern 'smart_rule|SmartPlaylistRule|getSmartPlaylist'
Get-ChildItem <LX-X>\src -Recurse -File -Include *.ts,*.tsx,*.js |
  Select-String -Pattern 'smart|rules|m3u|trash|recycle'

# 采样哈希
Get-FileHash <file> -Algorithm SHA256                 # 见附录 A
```

*报告结束。所有结论可按「文件 + 行号 + 附录 A 哈希」回溯；无法核实项已在第 10 节单列。*
