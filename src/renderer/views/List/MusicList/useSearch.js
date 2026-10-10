import { computed, ref, watch, nextTick, onBeforeUnmount } from '@common/utils/vueTools'
import { HOTKEY_COMMON } from '@common/hotKey'
import { appSetting } from '@renderer/store/setting'
import { createPlaylistSearchIndex, searchPlaylistMusic } from './search'

export default ({ list, listRef, props, setSelectedIndex }) => {
  const searchRef = ref(null)
  const searchQuery = ref('')
  const searchField = ref('all')
  const isSearching = computed(() => appSetting['list.isShowSearchBar'] && !!searchQuery.value.trim())
  const searchIndex = computed(() => createPlaylistSearchIndex(list.value))
  const visibleList = computed(() => isSearching.value ? searchPlaylistMusic(searchIndex.value, searchQuery.value, searchField.value) : list.value)
  const songIndexes = computed(() => new Map(list.value.map((song, index) => [song.id, index])))
  const getSourceIndex = song => songIndexes.value.get(song?.id) ?? -1
  const focusSearch = () => {
    if (appSetting['list.isShowSearchBar']) searchRef.value?.focus()
  }
  const clearSearch = () => { searchQuery.value = '' }

  watch(() => props.listId, clearSearch)
  watch(() => appSetting['list.isShowSearchBar'], (show) => {
    if (!show) clearSearch()
  })
  watch([searchQuery, searchField], () => {
    setSelectedIndex(-1)
    if (isSearching.value) nextTick(() => listRef.value?.scrollTo(0))
  })

  window.key_event.on(HOTKEY_COMMON.focusListSearchInput.action, focusSearch)

  onBeforeUnmount(() => {
    window.key_event.off(HOTKEY_COMMON.focusListSearchInput.action, focusSearch)
  })

  return {
    searchRef,
    searchQuery,
    searchField,
    isSearching,
    visibleList,
    getSourceIndex,
    focusSearch,
    clearSearch,
  }
}
