import { MUSIC_FREE_QUALITIES } from '@common/musicFree'

export const musicFreeQuality = quality => ({ '128k': 'low', '192k': 'standard', '320k': 'high', flac: 'super' }[quality] ?? 'super')
export const musicFreeSong = (plugin, item) => {
  if (!item || typeof item !== 'object' || typeof item.title !== 'string' || !item.title.trim()) return null
  const keys = plugin.primaryKey.map(key => item[key])
  if (keys.some(key => key == null || !['string', 'number', 'boolean'].includes(typeof key))) return null
  const songmid = encodeURIComponent(JSON.stringify(keys))
  if (songmid.length > 4096) return null
  const duration = Number(item.duration)
  return {
    source: plugin.id,
    songmid,
    name: item.title,
    singer: typeof item.artist === 'string' ? item.artist : '',
    albumName: typeof item.album === 'string' ? item.album : '',
    img: typeof item.artwork === 'string' ? item.artwork : '',
    interval: Number.isFinite(duration) && duration >= 0 ? `${Math.floor(duration / 60).toString().padStart(2, '0')}:${Math.floor(duration % 60).toString().padStart(2, '0')}` : null,
    types: [...MUSIC_FREE_QUALITIES].reverse().map(type => ({ type, size: null })),
    _types: Object.fromEntries(MUSIC_FREE_QUALITIES.map(type => [type, { size: null }])),
    typeUrl: {},
    // Never flatten this: MusicFree plugins may use arbitrary extra keys to
    // resolve a track. Keep them intact across LX's old/new song conversions.
    musicfree: { ...item, platform: plugin.name },
  }
}

export const createMusicFreeSource = (plugin, call) => {
  const pageSizes = new Map()
  const raw = song => {
    const item = song.musicfree ?? song.meta?.musicfree
    if (!item) throw new Error('MUSICFREE_SONG_INVALID: MusicFree 歌曲信息缺失，请重新搜索')
    return item
  }
  const source = {
    id: plugin.id,
    name: plugin.name,
    getMusicUrl(song, type) {
      const request = call(plugin.id, 'getMediaSource', [raw(song), musicFreeQuality(type)])
      return {
        ...request,
        promise: request.promise.then(value => {
          if (!value?.url) throw new Error('MusicFree 未返回播放地址')
          return { type, url: value.url }
        }),
      }
    },
    getLyric(song) {
      const request = call(plugin.id, 'getLyric', [raw(song)])
      return { ...request, promise: request.promise.then(value => ({ lyric: value?.rawLrc ?? value?.lyric ?? '', tlyric: value?.translation ?? value?.tlyric ?? null })) }
    },
    async getPic(song) {
      const item = raw(song)
      if (item.artwork) return item.artwork
      if (!plugin.methods.includes('getMusicInfo')) return ''
      const value = await call(plugin.id, 'getMusicInfo', [item]).promise
      return typeof value?.artwork === 'string' ? value.artwork : ''
    },
    getMusicDetailPageUrl(song) { return raw(song).sourceUrl ?? '' },
  }
  if (plugin.methods.includes('search') && plugin.supportedSearchType.includes('music')) {
    source.musicSearch = {
      async search(keyword, page = 1, limit = 30) {
        const result = await call(plugin.id, 'search', [keyword, page, 'music']).promise
        if (!result || !Array.isArray(result.data)) throw new Error('MUSICFREE_SEARCH_INVALID: MusicFree 搜索结果格式无效')
        const list = result.data.map(item => musicFreeSong(plugin, item)).filter(Boolean)
        if (page === 1) {
          if (pageSizes.size >= 40) pageSizes.clear()
          pageSizes.set(keyword, result.data.length || limit)
        }
        const pageSize = pageSizes.get(keyword) ?? (result.data.length || limit)
        const hasMore = result.isEnd === false && result.data.length > 0
        return { list, source: plugin.id, limit: pageSize, allPage: page + (hasMore ? 1 : 0), total: hasMore ? (page + 1) * pageSize : (page - 1) * pageSize + result.data.length }
      },
    }
  }
  return { id: plugin.id, name: plugin.name, source }
}
