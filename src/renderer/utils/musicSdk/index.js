import kw from './kw/index'
import kg from './kg/index'
import tx from './tx/index'
import wy from './wy/index'
import mg from './mg/index'
import bd from './bd/index'
import xm from './xm'
import { supportQuality } from './api-source'
import { versionChars } from './versionChars'
import { loadLocalSourcePlugins, loadRemoteSourcePlugins } from './plugins/loader'
import { getRequestSignal, withRequestScope, withRequestDeadline } from '../requestContext'
import { isMusicFreeSource } from '@common/musicFree'
import { onSourcesChanged, sourceRevision, sourcesChanged } from './plugins/sourceEvents'


/**
 * 内置音源列表（主仓库仅保留通用/主流平台，保持「干净的播放器」定位）。
 * 扩展音源（如需平台专有接口/签名的音源）通过插件注入，见 plugins/loader.js。
 */
const builtinSources = [
  { name: '酷我音乐', id: 'kw' },
  { name: '酷狗音乐', id: 'kg' },
  { name: 'QQ音乐', id: 'tx' },
  { name: '网易音乐', id: 'wy' },
  { name: '咪咕音乐', id: 'mg' },
  { name: '虾米音乐', id: 'xm' },
]

/** 运行时注入的扩展音源列表（{ name, id }） */
const extSources = []

/**
 * 动态生成音源列表 = 内置音源 + 注入的扩展音源
 */
const buildSourceList = () => {
  return [...builtinSources, ...extSources]
}

const sourcesMap = {
  kw,
  kg,
  tx,
  wy,
  mg,
  bd,
  xm,
}

/**
 * 注册扩展音源到 sourcesMap（供内部 search/find 使用）与 extSources（音源列表）。
 * 注意：不在此处写默认导出对象——顶层注册后由 `...sourcesMap` 展开自然包含；
 * 远程（异步）注册需额外同步到导出对象，见 init()。
 */
const registerExtSources = (plugins) => {
  const registered = []
  for (const { id, name, source } of plugins) {
    if (!id || sourcesMap[id]) continue
    sourcesMap[id] = source
    extSources.push({ id, name })
    registered.push({ id, source })
  }
  return registered
}

// 顶层同步注册本地插件：保证 music.sources 在各 store 顶层遍历时即包含扩展音源
registerExtSources(loadLocalSourcePlugins())

const musicSdk = {
  get sources() {
    // eslint-disable-next-line no-unused-expressions -- Track dynamic sources in Vue computed consumers.
    sourceRevision.value
    return buildSourceList()
  },
  onSourcesChanged,
  replaceMusicFreeSources(plugins) {
    for (let index = extSources.length - 1; index >= 0; index--) {
      const { id } = extSources[index]
      if (!isMusicFreeSource(id)) continue
      delete sourcesMap[id]
      delete musicSdk[id]
      extSources.splice(index, 1)
    }
    for (const { id, source } of registerExtSources(plugins)) musicSdk[id] = source
    sourcesChanged()
  },
  ...sourcesMap,
  async init() {
    // 异步注册远程插件（用于热更/新增音源，失败被静默忽略，不影响其余音源）
    try {
      const registered = registerExtSources(await loadRemoteSourcePlugins())
      // 远程音源在本对象创建后注入，需手动同步到导出对象以支持 `musicSdk[source]`
      for (const { id, source } of registered) musicSdk[id] = source
      if (registered.length) sourcesChanged()
    } catch (err) {
      console.warn('[musicSdk] load remote source plugins failed:', err)
    }

    const tasks = []
    for (let source of buildSourceList()) {
      let sm = sourcesMap[source.id]
      sm && sm.init && tasks.push(sm.init())
    }
    return Promise.all(tasks)
  },
  supportQuality,

  async searchMusic({ name, singer, source: s, limit = 25, onResult, excludeSources = [], refresh = false }) {
    const trimStr = str => typeof str == 'string' ? str.trim() : str
    const musicName = trimStr(name)
    const tasks = []
    const excludeSource = ['xm']
    for (const source of buildSourceList()) {
      if (!sourcesMap[source.id] || !sourcesMap[source.id].musicSearch || source.id == s || excludeSource.includes(source.id) || excludeSources.includes(source.id)) continue
      tasks.push(sourcesMap[source.id].musicSearch.search(`${musicName} ${singer || ''}`.trim(), 1, limit, { refresh }).then(result => {
        onResult?.(result)
        return result
      }).catch(_ => null))
    }
    return (await Promise.all(tasks)).filter(s => s)
  },

  async findMusic(info, options = {}) {
    return withRequestDeadline(15000, async() => {
      const signal = getRequestSignal()
      const controller = new AbortController()
      const abort = () => controller.abort(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      try {
        return await new Promise((resolve, reject) => {
          const onResult = result => {
            const matches = this.matchMusic(info, [result])
            if (matches.length) resolve(matches)
          }
          withRequestScope(controller.signal, async() => this.searchMusic({ ...info, ...options, onResult })).then(lists => resolve(this.matchMusic(info, lists)), reject)
        })
      } finally {
        controller.abort()
        signal.removeEventListener('abort', abort)
      }
    })
  },

  matchMusic({ name, singer, albumName, interval }, lists) {
    // console.log(lists)
    // console.log({ name, singer, albumName, interval, source: s })

    const singersRxp = /、|&|;|；|\/|,|，|\|/
    const sortSingle = singer => singersRxp.test(singer)
      ? singer.split(singersRxp).sort((a, b) => a.localeCompare(b)).join('、')
      : (singer || '')
    const sortMusic = (arr, callback) => {
      const tempResult = []
      for (let i = arr.length - 1; i > -1; i--) {
        const item = arr[i]
        if (callback(item)) {
          delete item.fSinger
          delete item.fMusicName
          delete item.fAlbumName
          delete item.fInterval
          tempResult.push(item)
          arr.splice(i, 1)
        }
      }
      tempResult.reverse()
      return tempResult
    }
    const getIntv = (interval) => {
      if (!interval) return 0
      // if (musicInfo._interval) return musicInfo._interval
      let intvArr = interval.split(':')
      let intv = 0
      let unit = 1
      while (intvArr.length) {
        intv += parseInt(intvArr.pop()) * unit
        unit *= 60
      }
      return intv
    }
    const trimStr = str => typeof str == 'string' ? str.trim() : (str || '')
    const filterStr = str => typeof str == 'string' ? str.replace(/\s|'|\.|,|，|&|"|、|\(|\)|（|）|`|~|-|<|>|\||\/|\]|\[|!|！/g, '') : String(str || '')
    const fMusicName = filterStr(name).toLowerCase()
    const fSinger = filterStr(sortSingle(singer)).toLowerCase()
    const fAlbumName = filterStr(albumName).toLowerCase()
    const fInterval = getIntv(interval)
    const isEqualsInterval = (intv) => Math.abs((fInterval || intv) - (intv || fInterval)) <= 5
    const isEqualsVersionMusicNameChar = (name) => {
      for (const char of versionChars) {
        const version = filterStr(char)
        if (name.includes(version) != fMusicName.includes(version)) return false
      }
      return true
    }
    const isIncludesName = (name) => (fMusicName.includes(name) || name.includes(fMusicName)) && isEqualsVersionMusicNameChar(name)
    const isIncludesSinger = (singer) => fSinger ? (fSinger.includes(singer) || singer.includes(fSinger)) : true
    const isEqualsAlbum = (album) => fAlbumName ? fAlbumName == album : true

    const result = lists.map(source => {
      const list = source.list.map(item => ({ ...item }))
      for (const item of list) {
        item.name = trimStr(item.name)
        item.singer = trimStr(item.singer)
        item.fSinger = filterStr(sortSingle(item.singer).toLowerCase())
        item.fMusicName = filterStr(String(item.name ?? '').toLowerCase())
        item.fAlbumName = filterStr(String(item.albumName ?? '').toLowerCase())
        item.fInterval = getIntv(item.interval)
        // console.log(fMusicName, item.fMusicName, item.source)
        if (!isEqualsInterval(item.fInterval)) {
          item.name = null
          continue
        }
        if (item.fMusicName == fMusicName && isIncludesSinger(item.fSinger)) return item
      }
      for (const item of list) {
        if (item.name == null) continue
        if (item.fSinger == fSinger && isIncludesName(item.fMusicName)) return item
      }
      for (const item of list) {
        if (item.name == null) continue
        if (isEqualsAlbum(item.fAlbumName) && isIncludesSinger(item.fSinger) && isIncludesName(item.fMusicName)) return item
      }
      return null
    }).filter(s => s)
    const newResult = []
    if (result.length) {
      newResult.push(...sortMusic(result, item => item.fSinger == fSinger && item.fMusicName == fMusicName && item.interval == interval))
      newResult.push(...sortMusic(result, item => item.fMusicName == fMusicName && item.fSinger == fSinger && item.fAlbumName == fAlbumName))
      newResult.push(...sortMusic(result, item => item.fSinger == fSinger && item.fMusicName == fMusicName))
      newResult.push(...sortMusic(result, item => item.fMusicName == fMusicName && item.interval == interval))
      newResult.push(...sortMusic(result, item => item.fSinger == fSinger && item.interval == interval))
      newResult.push(...sortMusic(result, item => item.interval == interval))
      newResult.push(...sortMusic(result, item => item.fMusicName == fMusicName))
      newResult.push(...sortMusic(result, item => item.fSinger == fSinger))
      newResult.push(...sortMusic(result, item => item.fAlbumName == fAlbumName))
      for (const item of result) {
        delete item.fSinger
        delete item.fMusicName
        delete item.fAlbumName
        delete item.fInterval
      }
      newResult.push(...result)
    }
    // console.log(newResult)
    return newResult
  },
}

export default /** @type {typeof musicSdk & Record<import('@common/musicFree').MusicFreeSource, any>} */ (musicSdk)
