/**
 * 歌曲封面获取工具
 *
 * 歌曲信息自带封面时直接使用；否则按歌曲来源调用对应平台的封面接口
 * （官方内置接口 musicSdk[source].getPic 优先，自定义音源 userApi.apis[source].getPic 兜底），
 * 结果按「source__id」缓存，请求并发受限避免触发平台限流。
 */
import musicSdk from '@renderer/utils/musicSdk'
import { userApi } from '@renderer/store'
import { toOldMusicInfo } from '@renderer/utils'
import { reactive } from '@common/utils/vueTools'
import { artworkCacheGeneration, onArtworkCacheCleared, readArtworkCache, writeArtworkCache } from './artworkStorage'
import { awaitRequest, getRequestSignal, shareRequest, throwIfRequestCancelled, withRequestScope } from './requestContext'

const coverCache = new Map()
const pending = new Map()
const localPending = new Map()
const queue = []
let activeCount = 0
const MAX_CONCURRENT = 5

// 全局封面显示缓存（跨组件持久化）
const coverDisplayCache = reactive(new Map())
let memoryLimit = Infinity
const trimMemory = () => {
  for (const cache of [coverCache, coverDisplayCache]) {
    while (cache.size > memoryLimit) cache.delete(cache.keys().next().value)
  }
}
export const setCoverUrlMemoryLimit = entries => {
  memoryLimit = Math.max(1, Math.floor(entries))
  trimMemory()
}
onArtworkCacheCleared(() => {
  coverCache.clear()
  coverDisplayCache.clear()
  pending.clear()
})

/**
 * 获取已缓存的封面 URL（同步，可能为空字符串）
 * @param item 歌曲信息
 * @returns 缓存的封面 URL，未缓存时返回空字符串
 */
export const getCachedCoverUrl = (item) => {
  const info = item?.metadata?.musicInfo ?? item
  if (!info) return ''
  // 本地文件可能已移除标签，先异步核对文件，避免瞬间显示旧的在线封面。
  if (info.source === 'local') return ''
  if (info.img || info.meta?.picUrl) return info.img || info.meta?.picUrl
  const key = `${info.source}__${info.id}`
  if (coverDisplayCache.has(key)) return coverDisplayCache.get(key)
  // 尝试从底层缓存获取
  if (coverCache.has(key)) {
    const url = coverCache.get(key)
    if (url) { coverDisplayCache.set(key, url); trimMemory() }
    return url
  }
  return ''
}

/**
 * 预热封面显示缓存（触发异步获取，结果存入 coverDisplayCache）
 * @param item 歌曲信息
 */
export const prefetchCover = (item) => {
  if (item.source !== 'local' && (item.img || item.meta?.picUrl)) return
  const key = `${item.source}__${item.id}`
  if (coverDisplayCache.has(key) || coverCache.has(key) || pending.has(key)) return
  getMusicCoverUrl(item).catch(() => {})
}

/**
 * 获取用于错误判断的 key
 */
export const getCoverKey = (item) => `${item.source}__${item.id}`

const runTask = () => {
  while (activeCount < MAX_CONCURRENT && queue.length) {
    const task = queue.shift()
    task.signal?.removeEventListener('abort', task.cancel)
    if (task.signal?.aborted) { task.cancel(); continue }
    activeCount++
    withRequestScope(task.signal, task.run).then(task.resolve, task.reject).finally(() => {
      activeCount--
      runTask()
    })
  }
}

const enqueueCover = run => new Promise((resolve, reject) => {
  const signal = getRequestSignal()
  const task = {
    run,
    resolve,
    reject,
    signal,
    cancel: () => {
      const index = queue.indexOf(task)
      if (index !== -1) queue.splice(index, 1)
      reject(signal.reason)
    },
  }
  if (signal?.aborted) { task.cancel(); return }
  signal?.addEventListener('abort', task.cancel, { once: true })
  queue.push(task)
  runTask()
})

// 兼容三种返回形式：Promise<string>、{ promise }（httpFetch/userApi 请求对象）、普通字符串
const unwrap = (api) => {
  if (!api) return Promise.resolve('')
  if (api.promise) return awaitRequest(api)
  if (api.then) return api
  return Promise.resolve(api)
}

// 逐个尝试候选接口；最终失败保留原始错误，供封面区域显示。
const tryGetPic = async(candidates) => {
  let lastError
  for (const candidate of candidates) {
    throwIfRequestCancelled()
    if (!candidate) continue
    try {
      const result = await unwrap(candidate())
      if (typeof result === 'string' && result) return result
    } catch (error) {
      lastError = error
    }
  }
  throwIfRequestCancelled()
  if (lastError) throw lastError
  return ''
}

/**
 * 获取歌曲封面 URL（异步）
 * @param musicInfo 歌曲信息
 * @returns 封面 URL，无封面时返回空字符串，读取失败时保留错误
 */
export const getMusicCoverUrl = (musicInfo, { signal = getRequestSignal() } = {}) => withRequestScope(signal, async() => {
  if (!musicInfo?.id) return Promise.resolve('')
  // 展开下载项
  const info = musicInfo.metadata ? musicInfo.metadata.musicInfo : musicInfo
  if (info.source === 'local') return getLocalCoverUrl(info)
  return getSourceCoverUrl(info)
})

const getLocalCoverUrl = (info) => {
  const key = info.meta.filePath
  // 与在线请求共用并发限制，避免列表一次解析大量本地音频文件。
  return shareRequest(localPending, key, async() => {
    const { pic, allowOnline } = await enqueueCover(async() => {
      const pic = await window.lx.worker.main.getMusicFilePic(key)
      if (pic) return { pic }
      throwIfRequestCancelled()
      return { allowOnline: await window.lx.worker.main.hasMusicFileTags(key) }
    })
    throwIfRequestCancelled()
    return pic || (allowOnline ? getSourceCoverUrl(info) : '')
  })
}

const getSourceCoverUrl = (info) => {
  // 歌曲信息自带的封面（新格式 meta.picUrl，旧字段 img）
  const direct = info.meta?.picUrl || info.img
  if (direct) return Promise.resolve(direct)
  const key = `${info.source}__${info.id}`
  if (coverCache.has(key)) return Promise.resolve(coverCache.get(key))

  const generation = artworkCacheGeneration()
  return shareRequest(pending, key, async() => {
    // Disk hits do not wait behind the five network/API requests in the queue.
    const cached = await readArtworkCache(`source:${key}`)
    throwIfRequestCancelled()
    if (typeof cached === 'string' && cached) return cached
    return enqueueCover(async() => {
      let url = ''
      // 各平台 getPic 与自定义音源接口均期望旧格式字段（songmid/albumId/hash 等位于顶层）
      const oldInfo = toOldMusicInfo(info)
      if (oldInfo) {
        const sdk = musicSdk[info.source]
        const userApiGetPic = userApi.apis?.[info.source]?.getPic
        // 官方内置接口优先，自定义音源（userApi）仅作失败兜底，兼容所有音源
        const candidates = [
          sdk?.getPic ? () => sdk.getPic(oldInfo) : null,
          userApiGetPic ? () => userApiGetPic(oldInfo) : null,
        ]
        url = await tryGetPic(candidates)
      }
      throwIfRequestCancelled()
      if (url) await writeArtworkCache(`source:${key}`, url, generation)
      return url
    })
  }).then(url => {
    if (url && generation === artworkCacheGeneration()) {
      coverCache.set(key, url)
      coverDisplayCache.set(key, url)
      trimMemory()
    }
    return url
  })
}
