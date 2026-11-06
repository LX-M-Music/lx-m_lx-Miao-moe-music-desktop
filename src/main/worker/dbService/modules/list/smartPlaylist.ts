import { getDB } from '../../db'
import {
  evaluateSmartPlaylist,
  normalizeSmartPlaylist,
  type SmartPlaylistContext,
  type SmartPlaylistRule,
} from '@common/smartPlaylist'

interface SmartRuleRow {
  id: string
  smart_rule: string | null
}

interface MusicRow {
  id: string
  listId: string
  name: string
  singer: string
  source: string
  interval: string | null
  meta: string
}

const smartPlaylistError = (code: string, message: string) => Object.assign(new Error(message), { code })

/** 读取全部智能歌单规则。损坏的规则会被跳过，不影响其它列表。 */
export const getSmartPlaylistRules = (): Record<string, SmartPlaylistRule> => {
  const rows = getDB().prepare('SELECT "id", "smart_rule" FROM "main"."my_list" WHERE "smart_rule" IS NOT NULL').all() as SmartRuleRow[]
  const result: Record<string, SmartPlaylistRule> = {}
  for (const row of rows) {
    if (!row.smart_rule) continue
    try {
      result[row.id] = normalizeSmartPlaylist(JSON.parse(row.smart_rule))
    } catch (error) {
      console.warn(`[smartPlaylist] ignored invalid rule for list "${row.id}"`, error)
    }
  }
  return result
}

export const getSmartPlaylistRule = (listId: string): SmartPlaylistRule | null => {
  const row = getDB().prepare('SELECT "smart_rule" FROM "main"."my_list" WHERE "id" = ?').get(listId) as { smart_rule: string | null } | undefined
  if (!row?.smart_rule) return null
  try {
    return normalizeSmartPlaylist(JSON.parse(row.smart_rule))
  } catch (error) {
    console.warn(`[smartPlaylist] ignored invalid rule for list "${listId}"`, error)
    return null
  }
}

/** 保存（或覆盖）某个歌单的智能规则。歌单不存在时抛出 SMART_PLAYLIST_NOT_FOUND。 */
export const saveSmartPlaylistRule = (listId: string, rule: unknown): SmartPlaylistRule => {
  if (typeof listId !== 'string' || !listId) throw smartPlaylistError('SMART_PLAYLIST_INVALID_LIST', '无效的歌单 ID')
  const normalized = normalizeSmartPlaylist(rule)
  const result = getDB().prepare('UPDATE "main"."my_list" SET "smart_rule" = ? WHERE "id" = ?').run(JSON.stringify(normalized), listId)
  if (!result.changes) throw smartPlaylistError('SMART_PLAYLIST_NOT_FOUND', '歌单不存在')
  return normalized
}

const buildEvaluationInput = (excludeListId: string | undefined) => {
  const db = getDB()
  // 候选池 = 曲库内所有歌单歌曲的去重集合。智能歌单自身的历史内容仍然参与
  // 候选池，这样只存在于该歌单里的歌曲不会在第二次刷新时凭空消失；但歌单归属
  // （inPlaylist）会排除目标歌单自身，避免规则引用自己造成循环。
  const rows = db.prepare('SELECT "id", "listId", "name", "singer", "source", "interval", "meta" FROM "main"."my_list_music_info" ORDER BY "rowid" DESC').all() as MusicRow[]
  const songs = new Map<string, LX.Music.MusicInfo>()
  const listMembership = new Map<string, Set<string>>()
  for (const row of rows) {
    if (row.listId !== excludeListId) {
      const membership = listMembership.get(row.id)
      if (membership) membership.add(row.listId)
      else listMembership.set(row.id, new Set([row.listId]))
    }
    if (songs.has(row.id)) continue
    let meta: LX.Music.MusicInfo['meta']
    try {
      meta = JSON.parse(row.meta) as LX.Music.MusicInfo['meta']
    } catch (error) {
      console.warn(`[smartPlaylist] ignored song with invalid meta "${row.id}"`, error)
      continue
    }
    const song = {
      id: row.id,
      name: row.name,
      singer: row.singer,
      source: row.source as LX.Music.MusicInfo['source'],
      interval: row.interval,
      meta,
    }
    songs.set(row.id, song as LX.Music.MusicInfo)
  }

  const statRows = db.prepare('SELECT "song_id" AS "id", COUNT(*) AS "count", MAX("played_at") AS "lastPlayed" FROM "main"."listening_history" GROUP BY "song_id"').all() as Array<{ id: string, count: number, lastPlayed: number }>
  const playStats = new Map(statRows.map(row => [row.id, { count: row.count, lastPlayed: row.lastPlayed }]))
  const context: SmartPlaylistContext = { playStats, listMembership, now: Date.now() }
  return { songs: Array.from(songs.values()), context }
}

/** 用给定规则对当前曲库求值（编辑器预览用，不写入数据库）。 */
export const getSmartPlaylistPreview = (rule: unknown, excludeListId?: string): LX.Music.MusicInfo[] => {
  const { songs, context } = buildEvaluationInput(typeof excludeListId === 'string' && excludeListId ? excludeListId : undefined)
  return evaluateSmartPlaylist(rule, songs, context)
}

/** 用已保存的规则重新求值，返回目标歌单应有的歌曲列表；不写入数据库。 */
export const getSmartPlaylistSongs = (listId: string): LX.Music.MusicInfo[] => {
  const rule = getSmartPlaylistRule(listId)
  if (!rule) throw smartPlaylistError('SMART_PLAYLIST_NOT_FOUND', '该歌单不是智能歌单或规则已损坏')
  const { songs, context } = buildEvaluationInput(listId)
  return evaluateSmartPlaylist(rule, songs, context)
}

/** 内部使用：读取原始规则文本，用于整库覆盖时保留规则。 */
export const readSmartPlaylistRuleRows = (): Array<[string, string]> => {
  const rows = getDB().prepare('SELECT "id", "smart_rule" FROM "main"."my_list" WHERE "smart_rule" IS NOT NULL').all() as SmartRuleRow[]
  return rows.flatMap(row => row.smart_rule ? [[row.id, row.smart_rule] as [string, string]] : [])
}

/** 内部使用：整库覆盖后按列表 ID 恢复仍然存在的智能歌单规则。 */
export const applySmartPlaylistRuleRows = (rows: Array<[string, string]>, listIds: ReadonlySet<string>) => {
  if (!rows.length) return
  const update = getDB().prepare('UPDATE "main"."my_list" SET "smart_rule" = ? WHERE "id" = ?')
  for (const [id, rule] of rows) {
    if (listIds.has(id)) update.run(rule, id)
  }
}
