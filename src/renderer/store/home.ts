import { ref, shallowReactive, reactive } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'
import { getHomeFeed, saveHomeFeed } from '@renderer/utils/ipc'
import type { HomeFeedData, HomePlaylistItem, HomeBoardItem, HomeFavoriteItem, HomeSongItem } from '@renderer/utils/ipc'
import { getCookie, hasCookie, isCookieValid } from '@renderer/utils/cookieManager'
import { getRemotePlaylists } from '@renderer/utils/cookiePlaylistApi'

/**
 * 首页推荐数据层（SWR：缓存优先渲染 + 后台刷新）
 *
 * - 每个音源独立拉取「推荐歌单 / 热搜词 / 排行榜入口 / 收藏歌单」，单项失败互不影响
 * - 收藏歌单仅在对应平台 Cookie 有效时拉取（登录个性化）
 * - 所有数据持久化到主进程 data.json（get_data / save_data），重启与离线均可显示
 * - 刷新失败且已有缓存时保留缓存并标记 offline，界面提示「离线缓存」
 */

export const STALE_TTL = 3 * 60 * 60 * 1000
export const PLAYLIST_LIMIT = 12
const HOT_WORDS_LIMIT = 12
const BOARDS_LIMIT = 8
const FAVORITES_LIMIT = 10
const SONGS_LIMIT = 6

/** 支持首页推荐的音源（有 recommend 模块的） */
export const feedSources: LX.OnlineSource[] = music.sources
  .map(s => s.id as LX.OnlineSource)
  .filter(id => !!music[id]?.recommend?.getRecommendList)

export interface SourceFeedState {
  playlists: HomePlaylistItem[]
  playlistsAt: number
  playlistsOffline: boolean
  hotWords: string[]
  hotWordsAt: number
  hotWordsOffline: boolean
  boards: HomeBoardItem[]
  boardsAt: number
  boardsOffline: boolean
  favorites: HomeFavoriteItem[]
  favoritesAt: number
  favoritesOffline: boolean
  songs: HomeSongItem[]
  songsAt: number
  songsOffline: boolean
}

const emptyFeed = (): SourceFeedState => ({
  playlists: [],
  playlistsAt: 0,
  playlistsOffline: false,
  hotWords: [],
  hotWordsAt: 0,
  hotWordsOffline: false,
  boards: [],
  boardsAt: 0,
  boardsOffline: false,
  favorites: [],
  favoritesAt: 0,
  favoritesOffline: false,
  songs: [],
  songsAt: 0,
  songsOffline: false,
})

export const feeds = shallowReactive<Partial<Record<LX.OnlineSource, SourceFeedState>>>({})
export const feedLoading = reactive<Partial<Record<LX.OnlineSource, boolean>>>({})
export const feedError = reactive<Partial<Record<LX.OnlineSource, boolean>>>({})
export const currentSource = ref<LX.OnlineSource | ''>('')

let initPromise: Promise<void> | null = null

const isStale = (feed: SourceFeedState | undefined) => {
  if (!feed) return true
  // 推荐歌单为空、板块从未成功加载，或整体数据早于 TTL 时刷新
  if (!feed.playlists.length || !feed.playlistsAt || !feed.boardsAt) return true
  return Date.now() - Math.max(feed.playlistsAt, feed.boardsAt, feed.hotWordsAt) > STALE_TTL
}

export const initHomeFeed = async() => {
  if (!initPromise) {
    initPromise = (async() => {
      const data = await getHomeFeed()
      if (data?.sources) {
        for (const [source, feed] of Object.entries(data.sources)) {
          if (feed && feedSources.includes(source as LX.OnlineSource)) {
            feeds[source as LX.OnlineSource] = { ...emptyFeed(), ...feed }
          }
        }
      }
      currentSource.value = (data?.lastSource && feedSources.includes(data.lastSource))
        ? data.lastSource
        : (feedSources[0] ?? '')
    })().catch(err => {
      console.log('init home feed failed:', err)
      currentSource.value = feedSources[0] ?? ''
    })
  }
  return initPromise
}

const persist = () => {
  const sources: HomeFeedData['sources'] = {}
  for (const [source, feed] of Object.entries(feeds)) sources[source as LX.OnlineSource] = feed
  saveHomeFeed({ lastSource: currentSource.value as LX.OnlineSource, sources })
}

const fetchFeedParts = async(source: LX.OnlineSource, prev: SourceFeedState | undefined) => {
  const sdk = music[source]
  // 并行拉取四个板块，单项失败时回落到上一次缓存（无缓存则留空），不阻塞其他板块
  const [playlists, hotWords, boards, favorites] = await Promise.all([
    sdk?.recommend?.getRecommendList(1, PLAYLIST_LIMIT)
      .then((result: { list: HomePlaylistItem[] }) => result.list ?? [])
      .catch(() => null),
    sdk?.hotSearch?.getList()
      .then((result: { source: string, list: string[] }) => result.list.slice(0, HOT_WORDS_LIMIT))
      .catch(() => null),
    sdk?.leaderboard?.getBoards()
      .then((board: { list: HomeBoardItem[] }) => (board.list ?? []).slice(0, BOARDS_LIMIT))
      .catch(() => null),
    // 收藏歌单：仅在平台 Cookie 有效时拉取；未登录视为显式空列表
    hasCookie(source) && isCookieValid(source)
      ? getRemotePlaylists(source, getCookie(source))
        .then((list: HomeFavoriteItem[]) => list.slice(0, FAVORITES_LIMIT).map(({ id, name }) => ({ id, name })))
        .catch(() => null)
      : Promise.resolve([] as HomeFavoriteItem[]),
  ])
  const now = Date.now()
  // 热门歌曲：取第一个榜单（通常为热歌榜）的单曲页，依赖 boards 结果，串行拉取
  const board0 = (boards ?? prev?.boards ?? [])[0]
  const bangId = board0 ? String(board0.id ?? '').split('__')[1] : undefined
  const songs = bangId
    ? await sdk?.leaderboard?.getList(bangId, 1)
        .then((result: { list: any[] }) => (result.list ?? []).slice(0, SONGS_LIMIT).map(item => ({
          songmid: String(item.songmid ?? ''),
          name: String(item.name ?? ''),
          singer: String(item.singer ?? ''),
          img: String(item.img ?? ''),
          interval: String(item.interval ?? ''),
          source,
        } as HomeSongItem)))
        .catch(() => null)
    : null
  return {
    playlists: playlists ?? prev?.playlists ?? [],
    playlistsAt: playlists ? now : (prev?.playlistsAt ?? 0),
    playlistsOffline: !playlists && !!prev?.playlists.length,
    hotWords: hotWords ?? prev?.hotWords ?? [],
    hotWordsAt: hotWords ? now : (prev?.hotWordsAt ?? 0),
    hotWordsOffline: !hotWords && !!prev?.hotWords.length,
    boards: boards ?? prev?.boards ?? [],
    boardsAt: boards ? now : (prev?.boardsAt ?? 0),
    boardsOffline: !boards && !!prev?.boards.length,
    favorites: favorites ?? prev?.favorites ?? [],
    favoritesAt: favorites ? now : (prev?.favoritesAt ?? 0),
    favoritesOffline: !favorites && !!prev?.favorites.length,
    songs: songs ?? prev?.songs ?? [],
    songsAt: songs ? now : (prev?.songsAt ?? 0),
    songsOffline: !songs && !!prev?.songs.length,
  } satisfies SourceFeedState
}

/**
 * 获取并更新指定音源的推荐数据（缓存先行，后台刷新）
 * @param source 音源
 * @param isRefresh 手动刷新（跳过 TTL 判断）
 */
export const getAndSetHomeFeed = async(source: LX.OnlineSource, isRefresh = false) => {
  if (!feedSources.includes(source)) return
  currentSource.value = source
  const prev = feeds[source]
  if (!isRefresh && !isStale(prev)) {
    persist()
    return
  }
  if (feedLoading[source]) return
  feedLoading[source] = true
  try {
    feeds[source] = await fetchFeedParts(source, prev)
    // 推荐歌单拉空且此前无缓存时视为失败，供界面展示重试入口
    feedError[source] = feeds[source].playlists.length == 0
    persist()
  } finally {
    feedLoading[source] = false
  }
}

export const isFeedEmpty = (source: LX.OnlineSource) => {
  const feed = feeds[source]
  return !feed || (!feed.playlists.length && !feed.boards.length && !feed.hotWords.length)
}
