import { setListUpdateTime } from '@renderer/utils/data'
import { setFetchingListStatus, overwriteListMusics, setUpdateTime } from './action'
import { getListDetailAll } from '@renderer/store/songList/action'
import { getListDetailAll as getBoardListAll } from '@renderer/store/leaderboard/action'
import { dateFormat } from '@common/utils/common'
import { refreshBoundPlaylist, WritebackError } from '@renderer/utils/playlistWriteback'
import { dialog } from '@renderer/plugins/Dialog'
import { beginSync, finishSync } from '@renderer/store/syncStatus'
import { queuePlaylistSync } from '@renderer/utils/syncQueue'
import { formatError } from '@common/utils/errorMessage'

export const showSyncError = (error: unknown) => {
  void dialog.error({ message: formatError(error, window.i18n.t(`list_writeback__error_${error instanceof WritebackError ? error.code : 'failed'}`), 'PLAYLIST_SYNC_FAILED') })
}

const fetchList = async(id: string, source: LX.OnlineSource, sourceListId: string) => {
  setFetchingListStatus(id, true)

  let promise
  if (/^board__/.test(sourceListId)) {
    const id = sourceListId.replace(/^board__/, '')
    promise = id ? getBoardListAll(id, true) : Promise.reject(new Error('id not defined: ' + sourceListId))
  } else {
    promise = getListDetailAll(sourceListId, source, true)
  }
  return promise.finally(() => {
    setFetchingListStatus(id, false)
  })
}

const active = new Map<string, Promise<void>>()
export default async(targetListInfo: LX.List.UserListInfo) => {
  // console.log(targetListInfo)
  if (!targetListInfo.source || !targetListInfo.sourceListId) return
  if (active.has(targetListInfo.id)) return active.get(targetListInfo.id)
  const key = 'playlist:' + targetListInfo.id
  beginSync(key, `${targetListInfo.name} · ${targetListInfo.source}`)
  const task = queuePlaylistSync(targetListInfo.source, async() => {
    await refreshBoundPlaylist(targetListInfo.id, async() => fetchList(targetListInfo.id, targetListInfo.source!, targetListInfo.sourceListId!), async list => {
      await overwriteListMusics({ listId: targetListInfo.id, musicInfos: list }, true)
    })
    const now = Date.now()
    await setListUpdateTime(targetListInfo.id, now)
    setUpdateTime(targetListInfo.id, dateFormat(now))
  }).then(() => { finishSync(key) }, error => { finishSync(key, error); throw error }).finally(() => active.delete(targetListInfo.id))
  active.set(targetListInfo.id, task)
  return task
}
