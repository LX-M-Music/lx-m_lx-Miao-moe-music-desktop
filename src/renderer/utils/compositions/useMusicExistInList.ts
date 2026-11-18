import { onBeforeUnmount, ref, watch } from '@common/utils/vueTools'
import { LIST_IDS } from '@common/constants'
import { getMusicExistListIds } from '@renderer/store/list/action'
import { listChangeRevision } from '@renderer/store/list/listManage'
import { playMusicInfo } from '@renderer/store/player/state'

const RECHECK_DELAY = 250

// Downloads are played from LX.Download.ListItem whose id is the task key
// (`musicId_quality_ext`), but playlists store the plain music id.
const getMusicInfoId = (musicInfo: LX.Player.PlayMusicInfo['musicInfo'] | null | undefined) => {
  if (!musicInfo) return null
  return 'progress' in musicInfo ? musicInfo.metadata.musicInfo.id : musicInfo.id
}

// The default and temporary lists are not saved playlists: songs land in the
// default list just by playing them, and the temporary list is the queue.
const isSavedListId = (listId: string) => listId !== LIST_IDS.DEFAULT && listId !== LIST_IDS.TEMP

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
    const musicInfoId = getMusicInfoId(playMusicInfo.musicInfo)
    const id = ++requestId
    if (!musicInfoId) {
      isExistInList.value = false
      return
    }
    try {
      const listIds = await getMusicExistListIds(musicInfoId)
      if (id === requestId) isExistInList.value = listIds.some(isSavedListId)
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

  watch(() => getMusicInfoId(playMusicInfo.musicInfo), () => { void check() }, { immediate: true })
  watch(listChangeRevision, scheduleCheck)

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
    timer = null
    requestId++
  })

  return isExistInList
}
