import { apiSource, qualityList } from '@renderer/store'
import { assertApiSupport } from '@renderer/store/utils'
import musicSdk from '@renderer/utils/musicSdk'
import { getMusicCoverUrl } from '@renderer/utils/musicCover'
import {
  // getOtherSource as getOtherSourceFromStore,
  // saveOtherSource as saveOtherSourceFromStore,
  getMusicUrl as getStoreMusicUrl,
  getPlayerLyric as getStoreLyric,
} from '@renderer/utils/ipc'
import { appSetting } from '@renderer/store/setting'
import { langS2T, toNewMusicInfo, toOldMusicInfo } from '@renderer/utils'
import { requestMsg } from '@renderer/utils/message'
import { apis } from '@renderer/utils/musicSdk/api-source'
import { awaitRequest, shareRequest, throwIfRequestCancelled } from '@renderer/utils/requestContext'
import { createRequestCache } from '@renderer/utils/musicSdk/requestCache'
import { isMusicFreeSource, MUSIC_FREE_QUALITIES } from '@common/musicFree'


const otherSourceCache = createRequestCache(60000, 20)
export const clearOtherSourceMemoryCache = () => { otherSourceCache.clear() }
export const existTimeExp = /\[\d{1,2}:.*\d{1,4}\]/

export const getOtherSource = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false, excludeSources: LX.OnlineSource[] = []): Promise<LX.Music.MusicInfoOnline[]> => {
  const info = 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo
  const query = { name: info.name, singer: info.singer, source: info.source, albumName: info.meta.albumName, interval: info.interval ?? '' }
  const key = JSON.stringify([apiSource.value, info.source, info.id, query, [...excludeSources].sort()])
  const result = await otherSourceCache(key, async() => {
    const matches = await musicSdk.findMusic(query, { excludeSources, refresh: isRefresh })
    return matches.filter((item: LX.Music.MusicInfoOnline) => !excludeSources.includes(item.source)).map(toNewMusicInfo)
  }, isRefresh)
  return JSON.parse(JSON.stringify(result))
}


export const buildLyricInfo = async(lyricInfo: MakeOptional<LX.Player.LyricInfo, 'rawlrcInfo'>): Promise<LX.Player.LyricInfo> => {
  if (!appSetting['player.isS2t']) {
    // @ts-expect-error
    if (lyricInfo.rawlrcInfo) return lyricInfo
    return { ...lyricInfo, rawlrcInfo: { ...lyricInfo } }
  }

  if (appSetting['player.isS2t']) {
    const tasks = [
      lyricInfo.lyric ? langS2T(lyricInfo.lyric) : Promise.resolve(''),
      lyricInfo.tlyric ? langS2T(lyricInfo.tlyric) : Promise.resolve(''),
      lyricInfo.rlyric ? langS2T(lyricInfo.rlyric) : Promise.resolve(''),
      lyricInfo.lxlyric ? langS2T(lyricInfo.lxlyric) : Promise.resolve(''),
    ]
    if (lyricInfo.rawlrcInfo) {
      tasks.push(lyricInfo.lyric ? langS2T(lyricInfo.lyric) : Promise.resolve(''))
      tasks.push(lyricInfo.tlyric ? langS2T(lyricInfo.tlyric) : Promise.resolve(''))
      tasks.push(lyricInfo.rlyric ? langS2T(lyricInfo.rlyric) : Promise.resolve(''))
      tasks.push(lyricInfo.lxlyric ? langS2T(lyricInfo.lxlyric) : Promise.resolve(''))
    }
    return Promise.all(tasks).then(([lyric, tlyric, rlyric, lxlyric, lyric_raw, tlyric_raw, rlyric_raw, lxlyric_raw]) => {
      const rawlrcInfo = lyric_raw ? {
        lyric: lyric_raw,
        tlyric: tlyric_raw,
        rlyric: rlyric_raw,
        lxlyric: lxlyric_raw,
      } : {
        lyric,
        tlyric,
        rlyric,
        lxlyric,
      }
      return {
        lyric,
        tlyric,
        rlyric,
        lxlyric,
        rawlrcInfo,
      }
    })
  }

  // @ts-expect-error
  return lyricInfo.rawlrcInfo ? lyricInfo : { ...lyricInfo, rawlrcInfo: { ...lyricInfo } }
}

export const getCachedLyricInfo = async(musicInfo: LX.Music.MusicInfo): Promise<LX.Player.LyricInfo | null> => {
  let lrcInfo = await getStoreLyric(musicInfo)
  // lrcInfo = {} as unknown as LX.Player.LyricInfo
  if (existTimeExp.test(lrcInfo.lyric)) {
    if (lrcInfo.tlyric != null) {
      // if (musicInfo.lrc.startsWith('\ufeff[id:$00000000]')) {
      //   let str = musicInfo.lrc.replace('\ufeff[id:$00000000]\n', '')
      //   commit('setLrc', { musicInfo, lyric: str, tlyric: musicInfo.tlrc, lxlyric: musicInfo.tlrc })
      // } else if (musicInfo.lrc.startsWith('[id:$00000000]')) {
      //   let str = musicInfo.lrc.replace('[id:$00000000]\n', '')
      //   commit('setLrc', { musicInfo, lyric: str, tlyric: musicInfo.tlrc, lxlyric: musicInfo.tlrc })
      // }

      if (lrcInfo.lxlyric == null) {
        switch (musicInfo.source) { // 以下源支持lxlyric 重新获取
          case 'kg':
          case 'kw':
          case 'mg':
          case 'wy':
          case 'tx':
            break
          default:
            return lrcInfo
        }
      } else if (lrcInfo.rlyric == null) {
        // 以下源支持 rlyric 重新获取
        if (!['wy', 'kg', 'tx'].includes(musicInfo.source)) return lrcInfo
      } else return lrcInfo
    }
    if (musicInfo.source == 'local') return lrcInfo
  }
  return null
}

export const getOnlineOtherSourceMusicUrlByLocal = async(musicInfo: LX.Music.MusicInfoLocal, isRefresh: boolean): Promise<{
  url: string
  quality: LX.Quality
  isFromCache: boolean
}> => {
  if (!await window.lx.apiInitPromise[0]) throw new Error('source init failed')

  const quality = '128k'

  const cachedUrl = await getStoreMusicUrl(musicInfo, quality)
  if (cachedUrl && !isRefresh) return { url: cachedUrl, quality, isFromCache: true }

  let reqPromise
  try {
    reqPromise = awaitRequest(apis('local').getMusicUrl(toOldMusicInfo(musicInfo), null))
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }

  return reqPromise.then(({ url }: { url: string }) => {
    return { url, quality, isFromCache: false }
  })
}

export const getOnlineOtherSourceLyricByLocal = async(musicInfo: LX.Music.MusicInfoLocal, isRefresh: boolean): Promise<{
  lyricInfo: LX.Music.LyricInfo
  isFromCache: boolean
}> => {
  if (!await window.lx.apiInitPromise[0]) throw new Error('source init failed')

  const lyricInfo = await getCachedLyricInfo(musicInfo)
  if (lyricInfo && !isRefresh) return { lyricInfo, isFromCache: true }

  let reqPromise
  try {
    reqPromise = awaitRequest(apis('local').getLyric(toOldMusicInfo(musicInfo)))
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }

  return reqPromise.then((lyricInfo: LX.Music.LyricInfo) => {
    return { lyricInfo, isFromCache: false }
  })
}

export const getOnlineOtherSourcePicByLocal = async(musicInfo: LX.Music.MusicInfoLocal): Promise<{
  url: string
}> => {
  if (!await window.lx.apiInitPromise[0]) throw new Error('source init failed')

  let reqPromise
  try {
    reqPromise = awaitRequest(apis('local').getPic(toOldMusicInfo(musicInfo)))
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }

  return reqPromise.then((url: string) => {
    return { url }
  })
}

export const TRY_QUALITYS_LIST = ['master', 'atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', '320k'] as const
type TryQualityType = typeof TRY_QUALITYS_LIST[number]

/**
 * 构建从指定音质开始逐级降级的尝试列表
 * 例如设置为 flac24bit 时返回 [flac24bit, flac, 320k, 128k]（按音源/歌曲支持度过滤）
 */
export const getTryQualityList = (highQuality: LX.Quality, musicInfo: LX.Music.MusicInfoOnline, explicitQuality = false): LX.Quality[] => {
  if (isMusicFreeSource(musicInfo.source)) {
    const index = MUSIC_FREE_QUALITIES.indexOf(highQuality as typeof MUSIC_FREE_QUALITIES[number])
    return MUSIC_FREE_QUALITIES.slice(index < 0 ? 0 : index)
  }
  const list = qualityList.value[musicInfo.source]
  const tryList: LX.Quality[] = TRY_QUALITYS_LIST.includes(highQuality as TryQualityType)
    ? TRY_QUALITYS_LIST
      .slice(TRY_QUALITYS_LIST.indexOf(highQuality as TryQualityType))
      .filter(q => {
        if (list) {
          if (!list.includes(q)) return false
          if ((q === 'master' || q === 'atmos_plus' || q === 'atmos' || q === 'hires') && !musicInfo.meta._qualitys.flac24bit &&
            !(explicitQuality && q === 'master' && musicInfo.meta._qualitys.flac)) return false
          return true
        }
        return !!musicInfo.meta._qualitys[q]
      })
    : []
  if (!tryList.includes('128k')) tryList.push('128k')
  return tryList
}

export const getPlayQuality = (highQuality: LX.Quality, musicInfo: LX.Music.MusicInfoOnline): LX.Quality => {
  return getTryQualityList(highQuality, musicInfo)[0] ?? '128k'
}

// 记录每首歌曲最近一次成功取得 URL 的音质，用于解码失败后的降级重试
const lastTryQualityMap = new Map<string, LX.Quality>()
export const setLastTryQuality = (id: string, quality: LX.Quality) => {
  if (lastTryQualityMap.size > 200) lastTryQualityMap.clear()
  lastTryQualityMap.set(id, quality)
}
export const getLastTryQuality = (id: string): LX.Quality | null => lastTryQualityMap.get(id) ?? null

/**
 * 获取比 lastQuality 低一级的可尝试音质，没有可降级的音质时返回 null
 */
export const getNextTryQuality = (highQuality: LX.Quality, musicInfo: LX.Music.MusicInfoOnline, lastQuality: LX.Quality | null): LX.Quality | null => {
  const tryList = getTryQualityList(highQuality, musicInfo)
  if (!tryList.length) return null
  if (!lastQuality) return tryList[0]
  const index = tryList.indexOf(lastQuality)
  return index == -1 ? tryList[0] : (tryList[index + 1] ?? null)
}

const EXTRA_QUALITY_TIERS = ['master', 'atmos_plus', 'atmos', 'hires'] as const

const pendingMusicUrls = new Map()
const requestOnlineMusicUrl = async(musicInfo: LX.Music.MusicInfoOnline, quality: LX.Quality, isRefresh: boolean) => {
  const key = JSON.stringify([apiSource.value, musicInfo.source, musicInfo.id, quality, isRefresh])
  return shareRequest(pendingMusicUrls, key, async() => awaitRequest(musicSdk[musicInfo.source].getMusicUrl(toOldMusicInfo(musicInfo), quality)))
}

// Relay URLs and MusicFree signed URLs are session-bound. Resolve them again
// instead of persisting a dead loopback URL across application restarts.
const getCachedOnlineUrl = async(musicInfo: LX.Music.MusicInfoOnline, quality: LX.Quality) => isMusicFreeSource(musicInfo.source) ? null : getStoreMusicUrl(musicInfo, quality)

export const getMaxQuality = (musicInfo: LX.Music.MusicInfoOnline, sourceQualityList: readonly string[]): LX.Quality => {
  if (musicInfo.meta._qualitys.flac24bit) {
    for (const q of EXTRA_QUALITY_TIERS) {
      if (sourceQualityList.includes(q)) return q as LX.Quality
    }
    return 'flac24bit'
  }
  if (musicInfo.meta._qualitys.flac) return 'flac'
  if (musicInfo.meta._qualitys.ape) return 'ape'
  if (musicInfo.meta._qualitys.wav) return 'wav'
  if (musicInfo.meta._qualitys['320k']) return '320k'
  if (musicInfo.meta._qualitys['192k']) return '192k'
  return '128k'
}

export const getOnlineOtherSourceMusicUrl = async({ musicInfos, quality, onToggleSource, isRefresh, retryedSource = [], origin }: {
  musicInfos: LX.Music.MusicInfoOnline[]
  quality?: LX.Quality
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  retryedSource?: LX.OnlineSource[]
  origin?: LX.Music.MusicInfo
}): Promise<{
  url: string
  musicInfo: LX.Music.MusicInfoOnline
  quality: LX.Quality
  isFromCache: boolean
}> => {
  let musicInfo: LX.Music.MusicInfoOnline | null = null
  let lastErr: any = null
  // eslint-disable-next-line no-cond-assign
  while (musicInfo = (musicInfos.shift()!)) {
    if (retryedSource.includes(musicInfo.source)) continue
    retryedSource.push(musicInfo.source)
    if (!assertApiSupport(musicInfo.source)) continue

    console.log('try toggle to: ', musicInfo.source, musicInfo.name, musicInfo.singer, musicInfo.interval)
    onToggleSource(musicInfo)

    // 该源的候选音质从高到低逐个尝试，全部失败再换下一个源
    const tryQualitys = getTryQualityList(quality ?? appSetting['player.playQuality'], musicInfo, quality != null)
    for (const itemQuality of tryQualitys) {
      throwIfRequestCancelled()
      const cachedUrl = await getCachedOnlineUrl(musicInfo, itemQuality)
      if (cachedUrl && !isRefresh) return { url: cachedUrl, musicInfo, quality: itemQuality, isFromCache: true }

      let reqPromise
      try {
        reqPromise = requestOnlineMusicUrl(musicInfo, itemQuality, isRefresh)
      } catch (err: any) {
        reqPromise = Promise.reject(err)
      }
      try {
        const { url, type } = await reqPromise as { url: string, type: LX.Quality }
        return { musicInfo, url, quality: type, isFromCache: false }
      } catch (err: any) {
        throwIfRequestCancelled()
        lastErr = err
        console.log(err)
        if (err.message == requestMsg.tooManyRequests) throw err
      }
    }
  }
  throwIfRequestCancelled()
  if (origin) {
    const next = await getOtherSource(origin, isRefresh, retryedSource)
    if (next.length) return getOnlineOtherSourceMusicUrl({ musicInfos: next, quality, onToggleSource, isRefresh, retryedSource, origin })
  }
  throw lastErr ?? new Error(window.i18n.t('toggle_source_failed'))
}

/**
 * 获取在线音乐URL
 */
export const handleGetOnlineMusicUrl = async({ musicInfo, quality, onToggleSource, isRefresh, allowToggleSource }: {
  musicInfo: LX.Music.MusicInfoOnline
  quality?: LX.Quality
  isRefresh: boolean
  allowToggleSource: boolean
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<{
  url: string
  musicInfo: LX.Music.MusicInfoOnline
  quality: LX.Quality
  isFromCache: boolean
}> => {
  if (!isMusicFreeSource(musicInfo.source) && !await window.lx.apiInitPromise[0]) throw new Error('source init failed')

  // 从目标音质开始逐级降级尝试，全部失败后才进入换源流程
  const tryQualitys = getTryQualityList(quality ?? appSetting['player.playQuality'], musicInfo, quality != null)
  let lastErr: any = new Error('get music url failed')
  for (const targetQuality of tryQualitys) {
    throwIfRequestCancelled()
    const cachedUrl = await getCachedOnlineUrl(musicInfo, targetQuality)
    if (cachedUrl && !isRefresh) return { url: cachedUrl, musicInfo, quality: targetQuality, isFromCache: true }

    let reqPromise
    try {
      reqPromise = requestOnlineMusicUrl(musicInfo, targetQuality, isRefresh)
    } catch (err: any) {
      reqPromise = Promise.reject(err)
    }
    try {
      const { url, type } = await reqPromise as { url: string, type: LX.Quality }
      return { musicInfo, url, quality: type, isFromCache: false }
    } catch (err: any) {
      throwIfRequestCancelled()
      lastErr = err
      console.log(err)
      if (err.message == requestMsg.tooManyRequests) throw err
    }
  }

  if (!allowToggleSource) throw lastErr
  onToggleSource()
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  return getOtherSource(musicInfo, isRefresh).then(otherSource => {
    console.log('find otherSource', otherSource)
    if (otherSource.length) {
      return getOnlineOtherSourceMusicUrl({
        origin: musicInfo,
        musicInfos: [...otherSource],
        onToggleSource,
        quality,
        isRefresh,
        retryedSource: [musicInfo.source],
      })
    }
    throw lastErr
  })
}


const getSharedOnlinePicUrl = async(musicInfo: LX.Music.MusicInfoOnline, isRefresh: boolean): Promise<string> => {
  if (isRefresh) return musicSdk[musicInfo.source].getPic(toOldMusicInfo(musicInfo))
  const url: string = await getMusicCoverUrl(musicInfo)
  if (!url) throw new Error('No artwork URL')
  return url
}

export const getOnlineOtherSourcePicUrl = async({ musicInfos, onToggleSource, isRefresh, retryedSource = [], origin }: {
  musicInfos: LX.Music.MusicInfoOnline[]
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  retryedSource?: LX.OnlineSource[]
  origin?: LX.Music.MusicInfo
}): Promise<{
  url: string
  musicInfo: LX.Music.MusicInfoOnline
  isFromCache: boolean
}> => {
  let musicInfo: LX.Music.MusicInfoOnline | null = null
  // eslint-disable-next-line no-cond-assign
  while (musicInfo = (musicInfos.shift()!)) {
    if (retryedSource.includes(musicInfo.source)) continue
    retryedSource.push(musicInfo.source)
    // if (!assertApiSupport(musicInfo.source)) continue
    console.log('try toggle to: ', musicInfo.source, musicInfo.name, musicInfo.singer, musicInfo.interval)
    onToggleSource(musicInfo)
    break
  }
  if (!musicInfo) {
    throwIfRequestCancelled()
    const next = origin ? await getOtherSource(origin, isRefresh, retryedSource) : []
    if (next.length) return getOnlineOtherSourcePicUrl({ musicInfos: next, onToggleSource, isRefresh, retryedSource, origin })
    throw new Error(window.i18n.t('toggle_source_failed'))
  }

  if (musicInfo.meta.picUrl && !isRefresh) return { musicInfo, url: musicInfo.meta.picUrl, isFromCache: true }

  let reqPromise
  try {
    reqPromise = getSharedOnlinePicUrl(musicInfo, isRefresh)
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }
  // retryedSource.includes(musicInfo.source)
  return reqPromise.then((url: string) => {
    return { musicInfo, url, isFromCache: false }
    // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch((err: any) => {
    console.log(err)
    return getOnlineOtherSourcePicUrl({ musicInfos, onToggleSource, isRefresh, retryedSource, origin })
  })
}

/**
 * 获取在线歌曲封面
 */
export const handleGetOnlinePicUrl = async({ musicInfo, isRefresh, onToggleSource, allowToggleSource }: {
  musicInfo: LX.Music.MusicInfoOnline
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  allowToggleSource: boolean
}): Promise<{
  url: string
  musicInfo: LX.Music.MusicInfoOnline
  isFromCache: boolean
}> => {
  // console.log(musicInfo.source)
  let reqPromise
  try {
    reqPromise = getSharedOnlinePicUrl(musicInfo, isRefresh)
  } catch (err) {
    reqPromise = Promise.reject(err)
  }
  return reqPromise.then((url: string) => {
    return { musicInfo, url, isFromCache: false }
  }).catch(async(err: any) => {
    console.log(err)
    if (!allowToggleSource) throw err
    onToggleSource()
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    return getOtherSource(musicInfo, isRefresh).then(otherSource => {
      console.log('find otherSource', otherSource)
      if (otherSource.length) {
        return getOnlineOtherSourcePicUrl({
          origin: musicInfo,
          musicInfos: [...otherSource],
          onToggleSource,
          isRefresh,
          retryedSource: [musicInfo.source],
        })
      }
      throw err
    })
  })
}


export const getOnlineOtherSourceLyricInfo = async({ musicInfos, onToggleSource, isRefresh, retryedSource = [], origin }: {
  musicInfos: LX.Music.MusicInfoOnline[]
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  retryedSource?: LX.OnlineSource[]
  origin?: LX.Music.MusicInfo
}): Promise<{
  lyricInfo: LX.Music.LyricInfo | LX.Player.LyricInfo
  musicInfo: LX.Music.MusicInfoOnline
  isFromCache: boolean
}> => {
  let musicInfo: LX.Music.MusicInfoOnline | null = null
  // eslint-disable-next-line no-cond-assign
  while (musicInfo = (musicInfos.shift()!)) {
    if (retryedSource.includes(musicInfo.source)) continue
    retryedSource.push(musicInfo.source)
    // if (!assertApiSupport(musicInfo.source)) continue
    console.log('try toggle to: ', musicInfo.source, musicInfo.name, musicInfo.singer, musicInfo.interval)
    onToggleSource(musicInfo)
    break
  }
  if (!musicInfo) {
    throwIfRequestCancelled()
    const next = origin ? await getOtherSource(origin, isRefresh, retryedSource) : []
    if (next.length) return getOnlineOtherSourceLyricInfo({ musicInfos: next, onToggleSource, isRefresh, retryedSource, origin })
    throw new Error(window.i18n.t('toggle_source_failed'))
  }

  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(musicInfo)
    if (lyricInfo) return { musicInfo, lyricInfo, isFromCache: true }
  }

  let reqPromise
  try {
    // TODO: remove any type
    reqPromise = awaitRequest(musicSdk[musicInfo.source].getLyric(toOldMusicInfo(musicInfo)))
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }
  // retryedSource.includes(musicInfo.source)
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  return reqPromise.then((lyricInfo: LX.Music.LyricInfo) => {
    return existTimeExp.test(lyricInfo.lyric) ? {
      lyricInfo,
      musicInfo,
      isFromCache: false,
    } : Promise.reject(new Error('failed'))
    // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch((err: any) => {
    console.log(err)
    return getOnlineOtherSourceLyricInfo({ musicInfos, onToggleSource, isRefresh, retryedSource, origin })
  })
}

/**
 * 获取在线歌词信息
 */
export const handleGetOnlineLyricInfo = async({ musicInfo, onToggleSource, isRefresh, allowToggleSource }: {
  musicInfo: LX.Music.MusicInfoOnline
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  allowToggleSource: boolean
}): Promise<{
  musicInfo: LX.Music.MusicInfoOnline
  lyricInfo: LX.Music.LyricInfo | LX.Player.LyricInfo
  isFromCache: boolean
}> => {
  // console.log(musicInfo.source)
  let reqPromise
  try {
    // TODO: remove any type
    reqPromise = awaitRequest(musicSdk[musicInfo.source].getLyric(toOldMusicInfo(musicInfo)))
  } catch (err) {
    reqPromise = Promise.reject(err)
  }
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  return reqPromise.then((lyricInfo: LX.Music.LyricInfo) => {
    return existTimeExp.test(lyricInfo.lyric) ? {
      musicInfo,
      lyricInfo,
      isFromCache: false,
    } : Promise.reject(new Error('failed'))
  }).catch(async(err: any) => {
    console.log(err)
    if (!allowToggleSource) throw err

    onToggleSource()
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    return getOtherSource(musicInfo, isRefresh).then(otherSource => {
      console.log('find otherSource', otherSource)
      if (otherSource.length) {
        return getOnlineOtherSourceLyricInfo({
          origin: musicInfo,
          musicInfos: [...otherSource],
          onToggleSource,
          isRefresh,
          retryedSource: [musicInfo.source],
        })
      }
      throw err
    })
  })
}
