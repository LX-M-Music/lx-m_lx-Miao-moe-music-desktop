import { onBeforeUnmount, ref, watch } from '@common/utils/vueTools'
import { LIST_IDS } from '@common/constants'
import { getMusicExistListIds } from '@renderer/store/list/action'
import { listChangeRevision } from '@renderer/store/list/listManage'
import { playMusicInfo } from '@renderer/store/player/state'

const RECHECK_DELAY = 250

/**
 * Whether the current song already exists in a saved playlist.
 * Cookie-synced playlists are stored as regular user lists, so they are included.
 * The temporary play list is ignored: songs are usually put there just by playing them.
 */
export default () => {
  const isExistInList = ref(false)
  let requestId = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const check = async() => {
    const musicInfoId = playMusicInfo.musicInfo?.id
    const id = ++requestId
    if (!musicInfoId) {
      isExistInList.value = false
      return
    }
    try {
      const listIds = await getMusicExistListIds(musicInfoId)
      if (id === requestId) isExistInList.value = listIds.some(listId => listId !== LIST_IDS.DEFAULT)
    } catch (error) {
      if (id === requestId) isExistInList.value = false
      console.warn('Failed to check whether the current song is in a playlist:', error)
    }
  }

  const scheduleCheck = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void check()
    }, RECHECK_DELAY)
  }

  watch(() => playMusicInfo.musicInfo?.id, () => { void check() }, { immediate: true })
  watch(listChangeRevision, scheduleCheck)

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
    timer = null
    requestId++
  })

  return isExistInList
}
