import { reactive } from '@common/utils/vueTools'
import { rendererInvoke } from '@common/rendererIpc'
import { PLAYER_EVENT_NAME } from '@common/ipcNames'
import type { SmartPlaylistRule } from '@common/smartPlaylist'

/**
 * 渲染进程内的智能歌单规则缓存。规则本体只保存在本地数据库（my_list.smart_rule），
 * 不参与列表同步；这里只用于侧栏标记、编辑弹窗和打开歌单时自动刷新。
 */
export const smartPlaylistRules = reactive<Record<string, SmartPlaylistRule>>({})

export const isSmartPlaylist = (listId: string): boolean => Object.hasOwn(smartPlaylistRules, listId)

export const getSmartPlaylistRule = (listId: string): SmartPlaylistRule | null => smartPlaylistRules[listId] ?? null

const cloneRule = (rule: SmartPlaylistRule): SmartPlaylistRule => JSON.parse(JSON.stringify(rule)) as SmartPlaylistRule

export const loadSmartPlaylists = async(): Promise<Record<string, SmartPlaylistRule>> => {
  const rules = await rendererInvoke<Record<string, SmartPlaylistRule>>(PLAYER_EVENT_NAME.list_smart_get)
  for (const id of Object.keys(smartPlaylistRules)) Reflect.deleteProperty(smartPlaylistRules, id)
  Object.assign(smartPlaylistRules, rules)
  return rules
}

export const saveSmartPlaylistRule = async(listId: string, rule: SmartPlaylistRule): Promise<SmartPlaylistRule> => {
  const saved = await rendererInvoke<{ listId: string, rule: SmartPlaylistRule }, SmartPlaylistRule>(PLAYER_EVENT_NAME.list_smart_save, {
    listId,
    rule: cloneRule(rule),
  })
  smartPlaylistRules[listId] = saved
  return saved
}

export const previewSmartPlaylist = async(rule: SmartPlaylistRule, listId?: string): Promise<number> => {
  const params: { rule: SmartPlaylistRule, listId?: string } = { rule: cloneRule(rule) }
  if (listId) params.listId = listId
  const result = await rendererInvoke<{ rule: SmartPlaylistRule, listId?: string }, { count: number }>(PLAYER_EVENT_NAME.list_smart_evaluate, params)
  return result.count
}

export const refreshSmartPlaylist = async(listId: string): Promise<{ count: number }> => {
  return rendererInvoke<{ listId: string }, { count: number }>(PLAYER_EVENT_NAME.list_smart_refresh, { listId })
}

export const removeSmartPlaylistState = (listIds: string[]) => {
  for (const listId of listIds) Reflect.deleteProperty(smartPlaylistRules, listId)
}

export const pruneSmartPlaylistState = (listIds: string[]) => {
  const keep = new Set(listIds)
  for (const id of Object.keys(smartPlaylistRules)) {
    if (!keep.has(id)) Reflect.deleteProperty(smartPlaylistRules, id)
  }
}
