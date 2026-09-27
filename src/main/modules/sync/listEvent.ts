import { LIST_IDS } from '@common/constants'
import { isPrivatePlaylistId, localPlaylistPosition, publicPlaylistPosition, retainPrivatePlaylists, sharedPlaylistData } from '@common/privatePlaylists'

// 构建列表信息对象，用于统一字段位置顺序
export const buildUserListInfoFull = ({ id, name, source, sourceListId, list, locationUpdateTime }: LX.List.UserListInfoFull) => {
  return {
    id,
    name,
    source,
    sourceListId,
    locationUpdateTime,
    list,
  }
}

const readLocalListData = async(includePrivate: boolean): Promise<LX.Sync.List.ListData> => {
  const lists: LX.Sync.List.ListData = {
    defaultList: await global.lx.worker.dbService.getListMusics(LIST_IDS.DEFAULT),
    loveList: await global.lx.worker.dbService.getListMusics(LIST_IDS.LOVE),
    userList: [],
  }

  const userListInfos = await global.lx.worker.dbService.getAllUserList()
  for await (const list of userListInfos) {
    if (!includePrivate && isPrivatePlaylistId(list.id)) continue
    lists.userList.push(await global.lx.worker.dbService.getListMusics(list.id)
      .then(musics => buildUserListInfoFull({ ...list, list: musics })))
  }

  return lists
}

export const getLocalListData = async(): Promise<LX.Sync.List.ListData> => readLocalListData(false)

export const setLocalListData = async(listData: LX.Sync.List.ListData) => {
  await global.lx.event_list.list_data_overwrite(retainPrivatePlaylists(listData, await readLocalListData(true)), true)
}

export const sharedListAction = (action: LX.Sync.List.ActionList): LX.Sync.List.ActionList | null => {
  switch (action.action) {
    case 'list_data_overwrite': return { action: 'list_data_overwrite', data: sharedPlaylistData(action.data) }
    case 'list_create': {
      const listInfos = action.data.listInfos.filter(list => !isPrivatePlaylistId(list.id))
      return listInfos.length ? { action: 'list_create', data: { position: action.data.position, listInfos } } : null
    }
    case 'list_remove': {
      const ids = action.data.filter(id => !isPrivatePlaylistId(id))
      return ids.length ? { action: 'list_remove', data: ids } : null
    }
    case 'list_music_clear': {
      const ids = action.data.filter(id => !isPrivatePlaylistId(id))
      return ids.length ? { action: 'list_music_clear', data: ids } : null
    }
    case 'list_update': {
      const lists = action.data.filter(list => !isPrivatePlaylistId(list.id))
      return lists.length ? { action: 'list_update', data: lists } : null
    }
    case 'list_update_position': {
      const ids = action.data.ids.filter(id => !isPrivatePlaylistId(id))
      return ids.length ? { action: 'list_update_position', data: { position: action.data.position, ids } } : null
    }
    case 'list_music_update': {
      const musicInfos = action.data.filter(item => !isPrivatePlaylistId(item.id))
      return musicInfos.length ? { action: 'list_music_update', data: musicInfos } : null
    }
    case 'list_music_move': {
      if (isPrivatePlaylistId(action.data.fromId)) {
        return isPrivatePlaylistId(action.data.toId) ? null : { action: 'list_music_add', data: { id: action.data.toId, musicInfos: action.data.musicInfos, addMusicLocationType: action.data.addMusicLocationType } }
      }
      return isPrivatePlaylistId(action.data.toId) ? { action: 'list_music_remove', data: { listId: action.data.fromId, ids: action.data.musicInfos.map(music => music.id) } } : action
    }
    case 'list_music_add': return isPrivatePlaylistId(action.data.id) ? null : action
    case 'list_music_overwrite':
    case 'list_music_remove':
    case 'list_music_update_position': return isPrivatePlaylistId(action.data.listId) ? null : action
    default: throw new Error('unknown list sync action')
  }
}

const prepareSharedAction = async(action: LX.Sync.List.ActionList): Promise<LX.Sync.List.ActionList | null> => {
  const shared = sharedListAction(action)
  if (!shared) return null
  if (shared.action === 'list_create') {
    const lists = await global.lx.worker.dbService.getAllUserList()
    const ids = shared.data.listInfos.map(list => list.id)
    const position = Math.min(...ids.map(id => publicPlaylistPosition(lists, id)))
    return { action: 'list_create', data: { ...shared.data, position } }
  } else if (shared.action === 'list_update_position') {
    const lists = await global.lx.worker.dbService.getAllUserList()
    const position = Math.min(...shared.data.ids.map(id => publicPlaylistPosition(lists, id)))
    return { action: 'list_update_position', data: { ...shared.data, position } }
  }
  return shared
}


export const registerListActionEvent = (sendListAction: (action: LX.Sync.List.ActionList) => (void | Promise<void>)) => {
  let pending: Promise<void> = Promise.resolve()
  const send = async(action: LX.Sync.List.ActionList) => {
    const prepared = prepareSharedAction(action)
    const task = pending.then(async() => {
      const shared = await prepared
      if (shared) await sendListAction(shared)
    })
    pending = task.catch(() => {})
    return task
  }
  const list_data_overwrite = async(listData: MakeOptional<LX.List.ListDataFull, 'tempList'>, isRemote: boolean = false) => {
    if (isRemote) return
    await send({ action: 'list_data_overwrite', data: listData })
  }
  const list_create = async(position: number, listInfos: LX.List.UserListInfo[], isRemote: boolean = false) => {
    if (isRemote) return
    await send({ action: 'list_create', data: { position, listInfos } })
  }
  const list_remove = async(ids: string[], isRemote: boolean = false) => {
    if (isRemote) return
    await send({ action: 'list_remove', data: ids })
  }
  const list_update = async(lists: LX.List.UserListInfo[], isRemote: boolean = false) => {
    if (isRemote) return
    await send({ action: 'list_update', data: lists })
  }
  const list_update_position = async(position: number, ids: string[], isRemote: boolean = false) => {
    if (isRemote) return
    await send({ action: 'list_update_position', data: { position, ids } })
  }
  const list_music_overwrite = async(listId: string, musicInfos: LX.Music.MusicInfo[], isRemote: boolean = false) => {
    if (isRemote || listId == LIST_IDS.TEMP) return
    await send({ action: 'list_music_overwrite', data: { listId, musicInfos } })
  }
  const list_music_add = async(id: string, musicInfos: LX.Music.MusicInfo[], addMusicLocationType: LX.AddMusicLocationType, isRemote: boolean = false) => {
    if (isRemote) return
    await send({ action: 'list_music_add', data: { id, musicInfos, addMusicLocationType } })
  }
  const list_music_move = async(fromId: string, toId: string, musicInfos: LX.Music.MusicInfo[], addMusicLocationType: LX.AddMusicLocationType, isRemote: boolean = false) => {
    if (isRemote) return
    await send({ action: 'list_music_move', data: { fromId, toId, musicInfos, addMusicLocationType } })
  }
  const list_music_remove = async(listId: string, ids: string[], isRemote: boolean = false) => {
    if (isRemote || listId == LIST_IDS.TEMP) return
    await send({ action: 'list_music_remove', data: { listId, ids } })
  }
  const list_music_update = async(musicInfos: LX.List.ListActionMusicUpdate, isRemote: boolean = false) => {
    musicInfos = musicInfos.filter(item => item.id != LIST_IDS.TEMP)
    if (isRemote || !musicInfos.length) return
    await send({ action: 'list_music_update', data: musicInfos })
  }
  const list_music_clear = async(ids: string[], isRemote: boolean = false) => {
    if (isRemote) return
    await send({ action: 'list_music_clear', data: ids })
  }
  const list_music_update_position = async(listId: string, position: number, ids: string[], isRemote: boolean = false) => {
    if (isRemote || listId == LIST_IDS.TEMP) return
    await send({ action: 'list_music_update_position', data: { listId, position, ids } })
  }
  global.lx.event_list.on('list_data_overwrite', list_data_overwrite)
  global.lx.event_list.on('list_create', list_create)
  global.lx.event_list.on('list_remove', list_remove)
  global.lx.event_list.on('list_update', list_update)
  global.lx.event_list.on('list_update_position', list_update_position)
  global.lx.event_list.on('list_music_overwrite', list_music_overwrite)
  global.lx.event_list.on('list_music_add', list_music_add)
  global.lx.event_list.on('list_music_move', list_music_move)
  global.lx.event_list.on('list_music_remove', list_music_remove)
  global.lx.event_list.on('list_music_update', list_music_update)
  global.lx.event_list.on('list_music_clear', list_music_clear)
  global.lx.event_list.on('list_music_update_position', list_music_update_position)
  return () => {
    global.lx.event_list.off('list_data_overwrite', list_data_overwrite)
    global.lx.event_list.off('list_create', list_create)
    global.lx.event_list.off('list_remove', list_remove)
    global.lx.event_list.off('list_update', list_update)
    global.lx.event_list.off('list_update_position', list_update_position)
    global.lx.event_list.off('list_music_overwrite', list_music_overwrite)
    global.lx.event_list.off('list_music_add', list_music_add)
    global.lx.event_list.off('list_music_move', list_music_move)
    global.lx.event_list.off('list_music_remove', list_music_remove)
    global.lx.event_list.off('list_music_update', list_music_update)
    global.lx.event_list.off('list_music_clear', list_music_clear)
    global.lx.event_list.off('list_music_update_position', list_music_update_position)
  }
}

export const handleRemoteListAction = async(incoming: LX.Sync.List.ActionList): Promise<LX.Sync.List.ActionList | null> => {
  const shared = sharedListAction(incoming)
  if (!shared) return null
  switch (shared.action) {
    case 'list_data_overwrite':
      await setLocalListData(shared.data)
      break
    case 'list_create': {
      const position = localPlaylistPosition(await global.lx.worker.dbService.getAllUserList(), shared.data.position)
      await global.lx.event_list.list_create(position, shared.data.listInfos, true)
      break
    }
    case 'list_remove':
      await global.lx.event_list.list_remove(shared.data, true)
      break
    case 'list_update':
      await global.lx.event_list.list_update(shared.data, true)
      break
    case 'list_update_position': {
      const position = localPlaylistPosition(await global.lx.worker.dbService.getAllUserList(), shared.data.position, shared.data.ids)
      await global.lx.event_list.list_update_position(position, shared.data.ids, true)
      break
    }
    case 'list_music_add':
      await global.lx.event_list.list_music_add(shared.data.id, shared.data.musicInfos, shared.data.addMusicLocationType, true)
      break
    case 'list_music_move':
      await global.lx.event_list.list_music_move(shared.data.fromId, shared.data.toId, shared.data.musicInfos, shared.data.addMusicLocationType, true)
      break
    case 'list_music_remove':
      await global.lx.event_list.list_music_remove(shared.data.listId, shared.data.ids, true)
      break
    case 'list_music_update':
      await global.lx.event_list.list_music_update(shared.data, true)
      break
    case 'list_music_update_position':
      await global.lx.event_list.list_music_update_position(shared.data.listId, shared.data.position, shared.data.ids, true)
      break
    case 'list_music_overwrite':
      await global.lx.event_list.list_music_overwrite(shared.data.listId, shared.data.musicInfos, true)
      break
    case 'list_music_clear':
      await global.lx.event_list.list_music_clear(shared.data, true)
      break
    default:
      throw new Error('unknown list sync action')
  }
  return shared
}
