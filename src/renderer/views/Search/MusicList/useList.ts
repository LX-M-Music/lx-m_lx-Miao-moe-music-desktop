import { LIST_IDS } from '@common/constants'
import { ref, computed, onBeforeUnmount } from '@common/utils/vueTools'
import { playList } from '@renderer/core/player/action'
import { setTempList } from '@renderer/store/list/action'
import { addHistoryWord } from '@renderer/store/search/action'
// import { useI18n } from '@renderer/plugins/i18n'
// import { } from '@renderer/store/search/state'
import { search as searchMusic, resetListInfo, listInfos, type ListInfo } from '@renderer/store/search/music'
import { assertApiSupport } from '@renderer/store/utils'
import { filterSearchSongs } from '@renderer/utils/searchMusicFilter'
import { sourceNames } from '@renderer/store'

export type SearchSource = LX.OnlineSource | 'all'

export default () => {
  const listRef = ref<any>(null)
  let searchRevision = 0
  let activeSource: SearchSource | undefined
  onBeforeUnmount(() => { searchRevision++; if (activeSource) resetListInfo(activeSource) })

  const listInfo = ref<ListInfo>({
    page: 1,
    maxPage: 0,
    limit: 30,
    total: 0,
    list: [],
    key: null,
    noItemLabel: '',
  })
  const mergeSongs = ref(false)
  const filtered = computed(() => filterSearchSongs(listInfo.value.list, 'all', mergeSongs.value, song => assertApiSupport(song.source), source => sourceNames.value[source as LX.OnlineSource] ?? source))
  const displayList = computed(() => filtered.value.list)
  const sourceLabels = computed(() => filtered.value.sourceLabels)

  const search = (text: string, source: SearchSource, page: number) => {
    if (activeSource && activeSource !== source) resetListInfo(activeSource)
    activeSource = source
    const revision = ++searchRevision
    listInfo.value = listInfos[source]!
    if (text.length) void addHistoryWord(text)
    void searchMusic(text, page, source).then((list: LX.Music.MusicInfo[]) => {
      if (revision !== searchRevision) return
      if (list.length) {
        setTimeout(() => {
          if (revision === searchRevision && listRef.value) listRef.value.scrollToTop()
        })
      }
    }).catch(() => {}) // The store already displays the failure and enables retry.
  }

  const handlePlayList = async(index: number) => {
    const searchList = [...displayList.value]
    const targetSong = searchList[index]
    if (!targetSong) return

    if (!assertApiSupport(targetSong.source)) return

    await setTempList(`search__${listInfo.value.key ?? ''}`, searchList)
    playList(LIST_IDS.TEMP, index)
  }

  return {
    listRef,
    listInfo,
    mergeSongs,
    displayList,
    sourceLabels,
    search,
    handlePlayList,
  }
}
