import { randomUUID } from 'crypto'
import { LIST_IDS } from '@common/constants'
import { LIST_TRASH_RETENTION_MS } from '@common/listTrash'
import { getDB } from '../../db'
import { insertUserLists, overwriteMusicInfo, queryAllUserList, queryMusicInfoByListId } from './dbHelper'

interface Position {
  position: number
  previousId?: string
  nextId?: string
}
interface Snapshot {
  kind: LX.List.TrashEntry['kind']
  list: LX.List.MyListInfo
  location: Position
  songs: Array<Position & { musicInfo: LX.Music.MusicInfo }>
  // 智能歌单的规则随列表一起归档，撤销删除时恢复。
  smartRule?: string | null
}
interface Row {
  id: string
  deleted_at: number
  expires_at: number
  payload: string
  summary?: string
}

export const pruneListTrash = () => {
  getDB().prepare('DELETE FROM list_trash WHERE expires_at <= ?').run(Date.now())
}

const summary = (row: Row, data: Snapshot): LX.List.TrashEntry => ({
  id: row.id,
  kind: data.kind,
  listId: data.list.id,
  listName: data.list.name,
  songName: data.songs[0]?.musicInfo.name ?? '',
  count: data.songs.length,
  deletedAt: row.deleted_at,
  expiresAt: row.expires_at,
})

export const getListTrash = (): LX.List.TrashEntry[] => {
  pruneListTrash()
  const rows = getDB().prepare('SELECT id,deleted_at,expires_at,summary FROM list_trash ORDER BY deleted_at DESC, rowid DESC').all() as Row[]
  return rows.map(row => ({ ...JSON.parse(row.summary!), id: row.id, deletedAt: row.deleted_at, expiresAt: row.expires_at }))
}

export const deleteListTrash = (ids: string[]) => {
  const db = getDB()
  const remove = db.prepare('DELETE FROM list_trash WHERE id = ?')
  db.transaction(() => { for (const id of ids) remove.run(id) })()
}

const getSongs = (listId: string): LX.Music.MusicInfo[] => queryMusicInfoByListId(listId).map(({ listId, order, meta, ...song }) => ({ ...song, meta: JSON.parse(meta) })) as LX.Music.MusicInfo[]

// Keep neighbouring IDs as well as indexes so subsequent edits do not displace restored items.
const positions = (items: Array<{ id: string }>, selected: Set<string>): Position[] => {
  let nextId: string | undefined
  const result: Position[] = []
  for (let index = items.length - 1; index >= 0; index--) {
    result[index] = { position: index, previousId: items[index - 1]?.id, nextId }
    if (!selected.has(items[index].id)) nextId = items[index].id
  }
  return result
}

export const archiveListDeletion = (kind: Snapshot['kind'], listIds: string[], songIds: string[] | undefined, remove: () => void): LX.List.TrashEntry[] => {
  const db = getDB()
  return db.transaction(() => {
    pruneListTrash()
    const lists = queryAllUserList()
    const listPositions = positions(lists, kind === 'list' ? new Set(listIds) : new Set())
    const insert = db.prepare('INSERT INTO list_trash (id, deleted_at, expires_at, payload, summary) VALUES (@id, @deleted_at, @expires_at, @payload, @summary)')
    const entries: LX.List.TrashEntry[] = []
    for (const listId of new Set(listIds)) {
      if (listId === LIST_IDS.TEMP) continue
      const listIndex = lists.findIndex(list => list.id === listId)
      const list = lists[listIndex] ?? (listId === LIST_IDS.DEFAULT ? { id: LIST_IDS.DEFAULT, name: 'list__name_default' } : listId === LIST_IDS.LOVE ? { id: LIST_IDS.LOVE, name: 'list__name_love' } : undefined)
      if (!list || (kind === 'list' && listIndex < 0)) continue
      const songs = getSongs(listId)
      const selected = new Set(songIds ?? songs.map(song => song.id))
      const songPositions = positions(songs, selected)
      const smartRule = (db.prepare('SELECT "smart_rule" FROM "main"."my_list" WHERE "id" = ?').get(listId) as { smart_rule: string | null } | undefined)?.smart_rule ?? null
      const data: Snapshot = {
        kind,
        list: list as LX.List.MyListInfo,
        location: listPositions[listIndex] ?? { position: 0 },
        songs: songs.flatMap((musicInfo, index) => selected.has(musicInfo.id) ? [{ musicInfo, ...songPositions[index] }] : []),
        smartRule,
      }
      if (kind === 'songs' && !data.songs.length) continue
      const now = Date.now()
      const row: Row = { id: randomUUID(), deleted_at: now, expires_at: now + LIST_TRASH_RETENTION_MS, payload: JSON.stringify(data) }
      row.summary = JSON.stringify(summary(row, data))
      insert.run(row)
      entries.push(summary(row, data))
    }
    // Both the snapshot and the removal must commit, or neither may change the database.
    remove()
    return entries
  })()
}

const insertAtOriginalPosition = <T extends { id: string }>(items: T[], item: T, location: Position) => {
  const previous = items.findIndex(value => value.id === location.previousId)
  const next = items.findIndex(value => value.id === location.nextId)
  const position = previous >= 0 ? previous + 1 : next >= 0 ? next : Math.min(location.position, items.length)
  items.splice(position, 0, item)
  return position
}

// A later deletion may no longer contain an earlier deleted neighbour. Reconnect its
// anchors when that neighbour returns, so restoring entries in either order is stable.
const reconnectArchivedNeighbours = (id: string, restored: Snapshot, createdList: boolean, inserted: Snapshot['songs']) => {
  if (!createdList && !inserted.length) return
  const db = getDB()
  const rows = db.prepare('SELECT * FROM list_trash WHERE id != ?').all(id) as Row[]
  const update = db.prepare('UPDATE list_trash SET payload = ? WHERE id = ?')
  for (const row of rows) {
    const data = JSON.parse(row.payload) as Snapshot
    let changed = false
    if (createdList && data.list.id === restored.location.previousId) {
      data.location.nextId = restored.list.id
      changed = true
    }
    if (createdList && data.list.id === restored.location.nextId) {
      data.location.previousId = restored.list.id
      changed = true
    }
    if (data.list.id === restored.list.id) {
      const byId = new Map(data.songs.map(song => [song.musicInfo.id, song]))
      for (const song of inserted) {
        const previous = song.previousId ? byId.get(song.previousId) : undefined
        const next = song.nextId ? byId.get(song.nextId) : undefined
        if (previous) { previous.nextId = song.musicInfo.id; changed = true }
        if (next) { next.previousId = song.musicInfo.id; changed = true }
      }
    }
    if (changed) update.run(JSON.stringify(data), row.id)
  }
}

export const restoreListTrashData = (ids: string[]): LX.List.TrashRestoreResult => {
  const db = getDB()
  return db.transaction(() => {
    pruneListTrash()
    const result: LX.List.TrashRestoreResult = { restoredIds: [], createdLists: [], musicLists: [] }
    const query = db.prepare('SELECT * FROM list_trash WHERE id = ?')
    const remove = db.prepare('DELETE FROM list_trash WHERE id = ?')
    const changed = new Map<string, LX.Music.MusicInfo[]>()
    for (const id of new Set(ids)) {
      const row = query.get(id) as Row | undefined
      if (!row) continue
      const data = JSON.parse(row.payload) as Snapshot
      const listId = data.list.id
      let createdList = false
      if (listId !== LIST_IDS.DEFAULT && listId !== LIST_IDS.LOVE) {
        const lists = queryAllUserList()
        if (!lists.some(list => list.id === listId)) {
          const listInfo: LX.List.UserListInfo = { ...data.list, locationUpdateTime: Date.now() }
          const position = insertAtOriginalPosition(lists, { ...listInfo, position: 0 }, data.location)
          insertUserLists(lists.map((list, position) => ({ ...list, position })), true)
          if (data.smartRule) db.prepare('UPDATE "main"."my_list" SET "smart_rule" = ? WHERE "id" = ?').run(data.smartRule, listId)
          result.createdLists.push({ position, listInfo })
          createdList = true
        }
      }
      const songs = getSongs(listId)
      const existingIds = new Set(songs.map(song => song.id))
      const inserted: Snapshot['songs'] = []
      for (const song of data.songs) {
        // A song added or edited since deletion takes precedence over the archived copy.
        if (existingIds.has(song.musicInfo.id)) continue
        insertAtOriginalPosition(songs, song.musicInfo, song)
        existingIds.add(song.musicInfo.id)
        inserted.push(song)
      }
      overwriteMusicInfo(listId, songs.map((song, order) => ({ ...song, listId, order, meta: JSON.stringify(song.meta) })))
      changed.set(listId, songs)
      reconnectArchivedNeighbours(id, data, createdList, inserted)
      remove.run(id)
      result.restoredIds.push(id)
    }
    result.musicLists = Array.from(changed, ([listId, musicInfos]) => ({ listId, musicInfos }))
    return result
  })()
}
