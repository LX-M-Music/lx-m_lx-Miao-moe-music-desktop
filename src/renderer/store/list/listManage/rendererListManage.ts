import { ref, toRaw } from '@common/utils/vueTools'
import { rendererInvoke, rendererOff, rendererOn } from '@common/rendererIpc'
import { PLAYER_EVENT_NAME } from '@common/ipcNames'
import {
  userListCreate,
  listDataOverwrite,
  userListsRemove,
  userListsUpdate,
  userListsUpdatePosition,
  listMusicAdd,
  listMusicMove,
  listMusicRemove,
  listMusicOverwrite,
  listMusicUpdateInfo,
  listMusicUpdatePosition,
  setMusicList,
  setUserLists,
  listMusicClear,
} from './action'
import { allMusicList, userLists } from './state'
import { withLocalListLocks } from '../localMutationLock'
import { deleteWithUndo } from '../recycleBin'

const pendingLists = new Map<string, Promise<LX.Music.MusicInfo[]>>()
let listRevision = 0
// Reactive marker for code outside the list views that depends on playlist contents.
export const listChangeRevision = ref(0)

/**
 * 获取用户列表
 * @returns 所有用户列表
 */
export const getUserLists = async() => {
  const lists = await rendererInvoke<LX.List.UserListInfo[]>(PLAYER_EVENT_NAME.list_get)
  return setUserLists(lists)
}

/**
 * 添加用户列表
 * @param data
 */
export const createUserList = async(data: LX.List.ListActionAdd) => {
  data.listInfos = data.listInfos.map(info => toRaw(info))
  await rendererInvoke<LX.List.ListActionAdd>(PLAYER_EVENT_NAME.list_add, data)
}

/**
 * 移除用户列表及列表内歌曲
 * @param data
 */
export const removeUserList = async(data: LX.List.ListActionRemove) => {
  return deleteWithUndo(async() => withLocalListLocks(data, async() => rendererInvoke<LX.List.ListActionRemove, LX.List.TrashEntry[]>(PLAYER_EVENT_NAME.list_remove, data)))
}

/**
 * 更新用户列表
 * @param data
 */
export const updateUserList = async(data: LX.List.ListActionUpdate, fromRefresh = false) => {
  data = data.map(info => toRaw(info))
  const commit = async() => rendererInvoke<LX.List.ListActionUpdate>(PLAYER_EVENT_NAME.list_update, data)
  if (fromRefresh) await commit()
  else await withLocalListLocks(data.map(list => list.id), commit)
}

/**
 * 批量移动用户列表位置
 * @param data
 */
export const updateUserListPosition = async(data: LX.List.ListActionUpdatePosition) => {
  await rendererInvoke<LX.List.ListActionUpdatePosition>(PLAYER_EVENT_NAME.list_update_position, data)
}

/**
 * 获取列表内的歌曲
 * @param listId
 */
export const getListMusics = async(listId: string | null): Promise<LX.Music.MusicInfo[]> => {
  if (!listId) return []
  if (allMusicList.has(listId)) return allMusicList.get(listId)!
  let pending = pendingLists.get(listId)
  if (!pending) {
    pending = (async() => {
      while (true) {
        const revision = listRevision
        const list = await rendererInvoke<string, LX.Music.MusicInfo[]>(PLAYER_EVENT_NAME.list_music_get, listId)
        // A mutation broadcast may have populated/updated the cache during this read.
        const cached = allMusicList.get(listId)
        if (cached) return cached
        if (revision !== listRevision) continue
        return setMusicList(listId, list)
      }
    })()
    pendingLists.set(listId, pending)
  }
  try {
    return await pending
  } finally {
    if (pendingLists.get(listId) === pending) pendingLists.delete(listId)
  }
}

/**
 * 批量添加歌曲到列表
 * @param data
 */
export const addListMusics = async(data: LX.List.ListActionMusicAdd, fromRefresh = false) => {
  const commit = async() => rendererInvoke<LX.List.ListActionMusicAdd>(PLAYER_EVENT_NAME.list_music_add, data)
  if (fromRefresh) await commit()
  else await withLocalListLocks([data.id], commit)
}

/**
 * 跨列表批量移动歌曲
 * @param data
 */
export const moveListMusics = async(data: LX.List.ListActionMusicMove) => {
  await withLocalListLocks([data.fromId, data.toId], async() => rendererInvoke<LX.List.ListActionMusicMove>(PLAYER_EVENT_NAME.list_music_move, data))
}

/**
 * 批量删除列表内歌曲
 * @param data
 */
export const removeListMusics = async(data: LX.List.ListActionMusicRemove) => {
  return deleteWithUndo(async() => withLocalListLocks([data.listId], async() => rendererInvoke<LX.List.ListActionMusicRemove, LX.List.TrashEntry[]>(PLAYER_EVENT_NAME.list_music_remove, data)))
}

/**
 * 批量更新列表内歌曲
 * @param data
 */
export const updateListMusics = async(data: LX.List.ListActionMusicUpdate) => {
  await withLocalListLocks([...allMusicList.keys()], async() => rendererInvoke<LX.List.ListActionMusicUpdate>(PLAYER_EVENT_NAME.list_music_update, data))
}

/**
 * 批量移动列表内歌曲的位置
 * @param data
 */
export const updateListMusicsPosition = async(data: LX.List.ListActionMusicUpdatePosition) => {
  await withLocalListLocks([data.listId], async() => rendererInvoke<LX.List.ListActionMusicUpdatePosition>(PLAYER_EVENT_NAME.list_music_update_position, data))
}

/**
 * 覆盖列表内的歌曲
 * @param data
 */
export const overwriteListMusics = async(data: LX.List.ListActionMusicOverwrite, fromRefresh = false) => {
  const commit = async() => rendererInvoke<LX.List.ListActionMusicOverwrite>(PLAYER_EVENT_NAME.list_music_overwrite, data)
  if (fromRefresh) await commit()
  else await withLocalListLocks([data.listId], commit)
}

// Replace at the current position with one SQLite transaction, keeping the original on failure.
export const replaceListMusic = async(listId: string, oldId: string, musicInfo: LX.Music.MusicInfo, allowDuplicate = false): Promise<'replaced' | 'missing' | 'duplicate'> => {
  return withLocalListLocks([listId], async() => {
    const current = await getListMusics(listId)
    const index = current.findIndex(song => song.id === oldId)
    if (index < 0) return 'missing'
    if (!allowDuplicate && current.some(song => song.id === musicInfo.id)) return 'duplicate'
    const position = current.slice(0, index).filter(song => song.id !== musicInfo.id).length
    const musicInfos = current.filter(song => song.id !== oldId && song.id !== musicInfo.id).map(song => toRaw(song))
    musicInfos.splice(position, 0, toRaw(musicInfo))
    await rendererInvoke<LX.List.ListActionMusicOverwrite>(PLAYER_EVENT_NAME.list_music_overwrite, { listId, musicInfos })
    return 'replaced'
  })
}

/**
 * 清空列表内的歌曲
 * @param ids
 */
export const clearListMusics = async(ids: LX.List.ListActionMusicClear) => {
  return deleteWithUndo(async() => withLocalListLocks(ids, async() => rendererInvoke<LX.List.ListActionMusicClear, LX.List.TrashEntry[]>(PLAYER_EVENT_NAME.list_music_clear, ids)))
}

/**
 * 覆盖全部列表数据
 * @param data
 */
export const overwriteListFull = async(data: LX.List.ListActionDataOverwrite) => {
  data.defaultList = toRaw(data.defaultList)
  data.loveList = toRaw(data.loveList)
  if (data.tempList) {
    data.tempList = toRaw(data.tempList)
  }
  data.userList = data.userList.map(info => {
    return {
      ...info,
      list: toRaw(info.list),
    }
  })

  await withLocalListLocks([...allMusicList.keys(), ...userLists.map(list => list.id), ...data.userList.map(list => list.id)], async() => {
    await rendererInvoke<LX.List.ListActionDataOverwrite>(PLAYER_EVENT_NAME.list_data_overwire, data)
  })
}

/**
 * 检查音乐是否存在列表中
 * @param listId
 * @param musicInfoId
 */
export const checkListExistMusic = async(listId: string, musicInfoId: string): Promise<boolean> => {
  return rendererInvoke<LX.List.ListActionCheckMusicExistList, boolean>(PLAYER_EVENT_NAME.list_music_check_exist, { listId, musicInfoId })
}

/**
 * 获取所有存在该音乐的列表id
 * @param musicInfoId
 */
export const getMusicExistListIds = async(musicInfoId: string): Promise<string[]> => {
  return rendererInvoke<string, string[]>(PLAYER_EVENT_NAME.list_music_get_list_ids, musicInfoId)
}


const noop = () => {}


export const registerListAction = (appSetting: LX.AppSetting, onListChanged: (listIds: string[], reset?: boolean) => void = noop) => {
  const list_data_overwrite = ({ params: datas }: LX.IpcRendererEventParams<LX.List.ListActionDataOverwrite>) => {
    listRevision++
    listChangeRevision.value++
    const previousIds = userLists.map(list => list.id)
    const updatedListIds = listDataOverwrite(datas)
    onListChanged([...new Set([...previousIds, ...datas.userList.map(list => list.id), ...updatedListIds])], true)
  }
  const list_create = ({ params: { position, listInfos } }: LX.IpcRendererEventParams<LX.List.ListActionAdd>) => {
    for (const list of listInfos) {
      userListCreate({ ...list, position })
    }
  }
  const list_remove = ({ params: ids }: LX.IpcRendererEventParams<LX.List.ListActionRemove>) => {
    listRevision++
    listChangeRevision.value++
    userListsRemove(ids)
    onListChanged(ids, true)
  }
  const list_update = ({ params: listInfos }: LX.IpcRendererEventParams<LX.List.ListActionUpdate>) => {
    userListsUpdate(listInfos)
    onListChanged(listInfos.map(list => list.id))
  }
  const list_update_position = ({ params: { position, ids } }: LX.IpcRendererEventParams<LX.List.ListActionUpdatePosition>) => {
    userListsUpdatePosition(position, ids)
  }
  const list_music_add = ({ params: { id, musicInfos, addMusicLocationType } }: LX.IpcRendererEventParams<LX.List.ListActionMusicAdd>) => {
    listRevision++
    listChangeRevision.value++
    addMusicLocationType ??= appSetting['list.addMusicLocationType']
    const updatedListIds = listMusicAdd(id, musicInfos, addMusicLocationType)
    if (updatedListIds.length) onListChanged(updatedListIds)
  }
  const list_music_move = ({ params: { fromId, toId, musicInfos, addMusicLocationType } }: LX.IpcRendererEventParams<LX.List.ListActionMusicMove>) => {
    listRevision++
    listChangeRevision.value++
    addMusicLocationType ??= appSetting['list.addMusicLocationType']
    const updatedListIds = listMusicMove(fromId, toId, musicInfos, addMusicLocationType)
    if (updatedListIds.length) onListChanged(updatedListIds)
  }
  const list_music_remove = ({ params: { listId, ids } }: LX.IpcRendererEventParams<LX.List.ListActionMusicRemove>) => {
    listRevision++
    listChangeRevision.value++
    // console.log(listId, ids)
    const updatedListIds = listMusicRemove(listId, ids)
    if (updatedListIds.length) onListChanged(updatedListIds)
  }
  const list_music_update = ({ params: musicInfos }: LX.IpcRendererEventParams<LX.List.ListActionMusicUpdate>) => {
    listRevision++
    listChangeRevision.value++
    const updatedListIds = listMusicUpdateInfo(musicInfos)
    if (updatedListIds.length) onListChanged(updatedListIds)
  }
  const list_music_update_position = ({ params: { listId, position, ids } }: LX.IpcRendererEventParams<LX.List.ListActionMusicUpdatePosition>) => {
    listRevision++
    listChangeRevision.value++
    void listMusicUpdatePosition(listId, position, ids).then(updatedListIds => {
      if (updatedListIds.length) onListChanged(updatedListIds)
    })
  }
  const list_music_overwrite = ({ params: { listId, musicInfos } }: LX.IpcRendererEventParams<LX.List.ListActionMusicOverwrite>) => {
    listRevision++
    listChangeRevision.value++
    const updatedListIds = listMusicOverwrite(listId, musicInfos)
    if (updatedListIds.length) onListChanged(updatedListIds)
  }
  const list_music_clear = ({ params: ids }: LX.IpcRendererEventParams<LX.List.ListActionMusicClear>) => {
    listRevision++
    listChangeRevision.value++
    const updatedListIds = listMusicClear(ids)
    if (updatedListIds.length) onListChanged(updatedListIds)
  }

  rendererOn(PLAYER_EVENT_NAME.list_data_overwire, list_data_overwrite)
  rendererOn(PLAYER_EVENT_NAME.list_add, list_create)
  rendererOn(PLAYER_EVENT_NAME.list_remove, list_remove)
  rendererOn(PLAYER_EVENT_NAME.list_update, list_update)
  rendererOn(PLAYER_EVENT_NAME.list_update_position, list_update_position)
  rendererOn(PLAYER_EVENT_NAME.list_music_add, list_music_add)
  rendererOn(PLAYER_EVENT_NAME.list_music_move, list_music_move)
  rendererOn(PLAYER_EVENT_NAME.list_music_remove, list_music_remove)
  rendererOn(PLAYER_EVENT_NAME.list_music_update, list_music_update)
  rendererOn(PLAYER_EVENT_NAME.list_music_update_position, list_music_update_position)
  rendererOn(PLAYER_EVENT_NAME.list_music_overwrite, list_music_overwrite)
  rendererOn(PLAYER_EVENT_NAME.list_music_clear, list_music_clear)

  return () => {
    rendererOff(PLAYER_EVENT_NAME.list_data_overwire, list_data_overwrite)
    rendererOff(PLAYER_EVENT_NAME.list_add, list_create)
    rendererOff(PLAYER_EVENT_NAME.list_remove, list_remove)
    rendererOff(PLAYER_EVENT_NAME.list_update, list_update)
    rendererOff(PLAYER_EVENT_NAME.list_update_position, list_update_position)
    rendererOff(PLAYER_EVENT_NAME.list_music_add, list_music_add)
    rendererOff(PLAYER_EVENT_NAME.list_music_move, list_music_move)
    rendererOff(PLAYER_EVENT_NAME.list_music_remove, list_music_remove)
    rendererOff(PLAYER_EVENT_NAME.list_music_update, list_music_update)
    rendererOff(PLAYER_EVENT_NAME.list_music_update_position, list_music_update_position)
    rendererOff(PLAYER_EVENT_NAME.list_music_overwrite, list_music_overwrite)
    rendererOff(PLAYER_EVENT_NAME.list_music_clear, list_music_clear)
  }
}
