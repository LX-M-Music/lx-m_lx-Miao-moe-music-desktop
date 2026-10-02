import { reactive, shallowReactive, ref } from '@common/utils/vueTools'

export interface PlayerMusicInfo {
  id: string | null
  pic: string | null
  lrc: string | null
  tlrc: string | null
  rlrc: string | null
  lxlrc: string | null
  rawlrc: string | null
  // url: string | null
  name: string
  singer: string
  album: string
}

/**
 * 播放列表（播放队列）的列表 id
 * 播放器切换到播放队列后，`playInfo.playerListId` 会指向这个 id，
 * 所有播放逻辑（下一首/上一首/随机等）都会遵循 `playQueueList` 这个队列
 */
export const PLAY_QUEUE_LIST_ID = '@play_queue'

/**
 * 播放列表（播放队列）
 * 每次开始播放（playList/playListById）时，会用目标列表的快照填充该队列，
 * 之后播放器的一切播放切换逻辑都遵循该队列，不再依赖原列表的变动
 */
export const playQueueList = window.lxData.playQueueList = shallowReactive<LX.Player.PlayMusicInfo[]>([])
// Increment once per completed queue edit, including replacement with the same length.
export const playQueueRevision = ref(0)
export const playbackReady = ref(false)
export const playQueueSource = ref<string | null>(null)

export const musicInfo = window.lxData.musicInfo = reactive<PlayerMusicInfo>({
  id: null,
  pic: null,
  lrc: null,
  tlrc: null,
  rlrc: null,
  lxlrc: null,
  rawlrc: null,
  // url: null,
  name: '',
  singer: '',
  album: '',
})

export const isPlay = ref(false)

/** 已加载的播放封面，与歌曲列表共享图片缓存；原始地址仍保留在 musicInfo.pic。 */
export const playerCover = ref('')

export const status = window.lxData.status = ref('')

export const statusText = ref('')

export const isShowPlayerDetail = ref(false)

// Includes the exit animation, so shared visuals live until the page has faded out.
export const isPlayerDetailDisplayed = ref(false)

export const isShowPlayComment = ref(false)

export const isShowLrcSelectContent = ref(false)

export const playMusicInfo = shallowReactive<{
  /**
   * 当前播放歌曲的列表 id
   */
  musicInfo: LX.Player.PlayMusicInfo['musicInfo'] | null
  /**
   * 当前播放歌曲的列表 id
   */
  listId: LX.Player.PlayMusicInfo['listId'] | null
  /**
   * 是否属于 “稍后播放”
   */
  isTempPlay: boolean
}>({
  listId: null,
  musicInfo: null,
  isTempPlay: false,
})
export const playInfo = shallowReactive<LX.Player.PlayInfo>({
  playIndex: -1,
  playerListId: null,
  playerPlayIndex: -1,
})


export const playedList = window.lxData.playedList = shallowReactive<LX.Player.PlayMusicInfo[]>([])

export const tempPlayList = shallowReactive<LX.Player.PlayMusicInfo[]>([])

window.lxData.playInfo = playInfo
window.lxData.playMusicInfo = playMusicInfo
