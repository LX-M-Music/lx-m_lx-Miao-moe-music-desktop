import { showLoadError } from '@common/loadErrorNotice'
import { getPlayInfo } from '@renderer/utils/ipc'
import music from '@renderer/utils/musicSdk'
import { log } from '@common/utils'
import { getListMusics, getUserLists, registerAction } from '@renderer/store/list/action'


import useInitUserApi from './useInitUserApi'
import { play, playList, restorePlaybackQueue } from '@renderer/core/player'
import { onBeforeUnmount } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'
import { playMusicInfo, playbackReady } from '@renderer/store/player/state'
import { initDislikeInfo, registerRemoteDislikeAction } from '@renderer/core/dislikeList'
import { syncCookieListsOnStartup } from '@renderer/utils/cookieSync'
import { getListPrevSelectId } from '@renderer/utils/data'
import { initPlaylistWriteback, startPlaylistWriteback, disposePlaylistWriteback, notifyPlaylistChanged } from '@renderer/utils/playlistWriteback'
import { initMusicFreeSources } from '@renderer/store/musicFree'

const initPrevPlayInfo = async() => {
  const info = await getPlayInfo()
  window.lx.restorePlayInfo = null
  if (!info) return
  if (!restorePlaybackQueue(info)) {
    if (!info.listId || info.index < 0) return
    const list = await getListMusics(info.listId)
    if (!list[info.index]) return
    window.lx.restorePlayInfo = info
    playList(info.listId, info.index)
  }

  if (appSetting['player.startupAutoPlay']) {
    const musicInfo = playMusicInfo.musicInfo
    if (!musicInfo) return
    setTimeout(() => {
      if (musicInfo.id == playMusicInfo.musicInfo?.id) play()
    })
  }
}

export default () => {
  const initUserApi = useInitUserApi()

  let unregister: null | (() => void) = null
  let unregisterDislikeEvent: null | (() => void) = null

  onBeforeUnmount(() => {
    disposePlaylistWriteback()
    window.removeEventListener('online', resumeWriteback)
    if (unregister) unregister()
    if (unregisterDislikeEvent) unregisterDislikeEvent()
  })

  const resumeWriteback = () => { void startPlaylistWriteback().catch(err => { log.error(err); showLoadError(err, 'LOCAL_DATA_LOAD_FAILED') }) }

  return async() => {
    unregister = registerAction((ids, reset) => {
      window.app_event.myListUpdate(ids)
      notifyPlaylistChanged(ids, reset)
    })
    // Local playlists can render while custom APIs are still initializing.
    const initLocalLists = async() => {
      window.lxData.userLists = await getUserLists()
      await initPlaylistWriteback()
      const previousId = await getListPrevSelectId()
      await getListMusics(previousId)
    }
    await Promise.all([
      initUserApi().catch(err => { log.error(err); showLoadError(err, 'LOCAL_DATA_LOAD_FAILED') }), // 自定义API
      initLocalLists(),
      initMusicFreeSources().catch(err => { log.error(err); showLoadError(err, 'MUSICFREE_LOAD_FAILED') }),
    ]).catch(err => {
      log.error(err); showLoadError(err, 'LOCAL_DATA_LOAD_FAILED')
    })
    void music.init() // 初始化音乐sdk
    resumeWriteback()
    window.addEventListener('online', resumeWriteback)
    unregisterDislikeEvent = registerRemoteDislikeAction()
    await initDislikeInfo() // 获取不喜欢列表
    await initPrevPlayInfo().catch(err => {
      log.error(err); showLoadError(err, 'LOCAL_DATA_LOAD_FAILED')
    }).finally(() => {
      playbackReady.value = true
    }) // 初始化上次的歌曲播放信息

    // 启动时同步一次基于 Cookie 的平台歌单（静默、不阻塞启动）
    void syncCookieListsOnStartup()
  }
}
