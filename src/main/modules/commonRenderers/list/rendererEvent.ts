import { mainHandle } from '@common/mainIpc'
import { PLAYER_EVENT_NAME } from '@common/ipcNames'
import type { SmartPlaylistRule } from '@common/smartPlaylist'

// 列表操作事件（公共，只注册一次）
export default () => {
  mainHandle<LX.List.UserListInfo[]>(PLAYER_EVENT_NAME.list_get, async() => {
    return global.lx.worker.dbService.getAllUserList()
  })
  mainHandle<LX.List.ListActionDataOverwrite>(PLAYER_EVENT_NAME.list_data_overwire, async({ params: listData }) => {
    await global.lx.event_list.list_data_overwrite(listData, false)
  })
  mainHandle<LX.List.ListActionAdd>(PLAYER_EVENT_NAME.list_add, async({ params: { position, listInfos } }) => {
    await global.lx.event_list.list_create(position, listInfos, false)
  })
  mainHandle<LX.List.ListActionRemove, LX.List.TrashEntry[]>(PLAYER_EVENT_NAME.list_remove, async({ params: ids }) => {
    return global.lx.event_list.list_remove(ids, false)
  })
  mainHandle<LX.List.ListActionUpdate>(PLAYER_EVENT_NAME.list_update, async({ params: listInfos }) => {
    await global.lx.event_list.list_update(listInfos, false)
  })
  mainHandle<LX.List.ListActionUpdatePosition>(PLAYER_EVENT_NAME.list_update_position, async({ params: { position, ids } }) => {
    await global.lx.event_list.list_update_position(position, ids, false)
  })
  mainHandle<string, LX.Music.MusicInfo[]>(PLAYER_EVENT_NAME.list_music_get, async({ params: listId }) => {
    return global.lx.worker.dbService.getListMusics(listId)
  })
  mainHandle<LX.List.ListActionMusicAdd>(PLAYER_EVENT_NAME.list_music_add, async({ params: { id, musicInfos, addMusicLocationType } }) => {
    await global.lx.event_list.list_music_add(id, musicInfos, addMusicLocationType, false)
  })
  mainHandle<LX.List.ListActionMusicMove>(PLAYER_EVENT_NAME.list_music_move, async({ params: { fromId, toId, musicInfos, addMusicLocationType } }) => {
    await global.lx.event_list.list_music_move(fromId, toId, musicInfos, addMusicLocationType, false)
  })
  mainHandle<LX.List.ListActionMusicRemove, LX.List.TrashEntry[]>(PLAYER_EVENT_NAME.list_music_remove, async({ params: { listId, ids } }) => {
    return global.lx.event_list.list_music_remove(listId, ids, false)
  })
  mainHandle<LX.List.ListActionMusicUpdate>(PLAYER_EVENT_NAME.list_music_update, async({ params: musicInfos }) => {
    await global.lx.event_list.list_music_update(musicInfos, false)
  })
  mainHandle<LX.List.ListActionMusicUpdatePosition>(PLAYER_EVENT_NAME.list_music_update_position, async({ params: { listId, position, ids } }) => {
    await global.lx.event_list.list_music_update_position(listId, position, ids, false)
  })
  mainHandle<LX.List.ListActionMusicOverwrite>(PLAYER_EVENT_NAME.list_music_overwrite, async({ params: { listId, musicInfos } }) => {
    await global.lx.event_list.list_music_overwrite(listId, musicInfos, false)
  })
  mainHandle<LX.List.ListActionMusicClear, LX.List.TrashEntry[]>(PLAYER_EVENT_NAME.list_music_clear, async({ params: listId }) => {
    return global.lx.event_list.list_music_clear(listId, false)
  })
  mainHandle<LX.List.TrashEntry[]>(PLAYER_EVENT_NAME.list_trash_get, async() => global.lx.worker.dbService.getListTrash())
  mainHandle<string[], string[]>(PLAYER_EVENT_NAME.list_trash_restore, async({ params: ids }) => global.lx.event_list.list_trash_restore(ids))
  mainHandle<string[]>(PLAYER_EVENT_NAME.list_trash_delete, async({ params: ids }) => {
    await global.lx.worker.dbService.deleteListTrash(ids)
    global.lx.event_list.list_trash_changed()
  })
  mainHandle<LX.List.ListActionCheckMusicExistList, boolean>(PLAYER_EVENT_NAME.list_music_check_exist, async({ params: { listId, musicInfoId } }) => {
    return global.lx.worker.dbService.checkListExistMusic(listId, musicInfoId)
  })
  mainHandle<string, string[]>(PLAYER_EVENT_NAME.list_music_get_list_ids, async({ params: musicInfoId }) => {
    return global.lx.worker.dbService.getMusicExistListIds(musicInfoId)
  })
  // Smart playlist rules are validated/normalized again in the worker; the IPC
  // policy only guarantees the transport shape.
  mainHandle<Record<string, SmartPlaylistRule>>(PLAYER_EVENT_NAME.list_smart_get, async() => {
    return global.lx.worker.dbService.getSmartPlaylistRules()
  })
  mainHandle<{ listId: string, rule: SmartPlaylistRule }, SmartPlaylistRule>(PLAYER_EVENT_NAME.list_smart_save, async({ params }) => {
    return global.lx.worker.dbService.saveSmartPlaylistRule(params.listId, params.rule)
  })
  // The editor only shows a match count; returning the songs themselves would
  // serialize the whole library across IPC on every keystroke.
  mainHandle<{ rule: SmartPlaylistRule, listId?: string }, { count: number }>(PLAYER_EVENT_NAME.list_smart_evaluate, async({ params }) => {
    const songs = await global.lx.worker.dbService.getSmartPlaylistPreview(params.rule, params.listId)
    return { count: songs.length }
  })
  mainHandle<{ listId: string }, { count: number }>(PLAYER_EVENT_NAME.list_smart_refresh, async({ params }) => {
    const songs = await global.lx.worker.dbService.getSmartPlaylistSongs(params.listId)
    // Reuse the normal overwrite event so worker cache, renderer caches and sync
    // observers all see the refreshed playlist through the existing channel.
    await global.lx.event_list.list_music_overwrite(params.listId, songs, false)
    return { count: songs.length }
  })
}
