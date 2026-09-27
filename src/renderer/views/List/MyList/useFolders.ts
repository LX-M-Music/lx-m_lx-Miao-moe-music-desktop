import { computed, reactive, watch, type Ref } from '@common/utils/vueTools'
import { COOKIE_SOURCES, SOURCE_NAME, type CookieSource } from '@renderer/utils/cookieManager'
import { userLists } from '@renderer/store/list/state'
import { libraryPreferences } from '@renderer/utils/library'
import { isPrivatePlaylistId } from '@common/privatePlaylists'

const STORAGE_KEY = 'my-list-platform-folders'

export const getListFolder = (list?: LX.List.UserListInfo): CookieSource | undefined => {
  return list && isPrivatePlaylistId(list.id) ? COOKIE_SOURCES.find(source => list.id.startsWith(`userlist_${source}_sync_`)) : undefined
}

export default ({ listId }: { listId: Ref<string> }) => {
  const expandedFolders = reactive<Record<string, boolean>>({})
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    for (const [key, value] of Object.entries(saved)) expandedFolders[key] = value === true
  } catch {}

  const listGroups = computed(() => {
    const groups: Array<{
      id: string
      source?: CookieSource
      name?: string
      lists: Array<{ item: LX.List.UserListInfo, index: number, name: string }>
    }> = [
      { id: 'local', lists: [] },
      ...COOKIE_SOURCES.map(source => ({ id: source, source, name: SOURCE_NAME[source], lists: [] })),
    ]
    userLists.forEach((item, index) => {
      const source = getListFolder(item)
      const organization = libraryPreferences.value.lists[item.id]
      const group = groups.find(group => group.id === (source ?? 'local'))!
      const prefix = source ? `${SOURCE_NAME[source]} - ` : ''
      const title = prefix && item.name.startsWith(prefix) ? item.name.slice(prefix.length) : item.name
      const name = title + (organization?.tags.length ? ` · ${organization.tags.join(' / ')}` : '')
      group.lists.push({ item, index, name })
    })
    return groups
  })

  watch(() => listGroups.value.find(group => group.lists.some(list => list.item.id === listId.value))?.id, source => {
    if (source) expandedFolders[source] = true
  }, { immediate: true })

  watch(expandedFolders, state => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch {}
  })

  const toggleFolder = (source: string) => {
    expandedFolders[source] = !expandedFolders[source]
  }

  return { listGroups, expandedFolders, toggleFolder }
}
