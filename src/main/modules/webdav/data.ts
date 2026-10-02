import { createHash } from 'node:crypto'
import defaultSetting from '@common/defaultSetting'
import { LIST_IDS, QUALITYS } from '@common/constants'
import { WebDAVError } from './errors'

export const SECTIONS: LX.WebDAV.Section[] = ['playlists', 'downloadHistory', 'downloadTasks', 'settings', 'dislike']
export const selectedSections = (setting: LX.AppSetting) => SECTIONS.filter(section => setting[`sync.webdav.${section}`])
const isRecord = (value: unknown): value is Record<string, unknown> => value != null && typeof value == 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value == 'number' && Number.isFinite(value)

const deviceSettings = new Set([
  'version', 'common.apiSource', 'common.isAgreePact', 'common.windowSizeId',
  'common.windowWidth', 'common.windowHeight',
  'ui.lowPowerMode',
  'download.savePath', 'player.mediaDeviceId', 'player.soundEffect.convolution.fileName',
  'desktopLyric.x', 'desktopLyric.y',
])

export const portableSettings = (settings: Partial<LX.AppSetting>): Partial<LX.AppSetting> => {
  const result: Partial<LX.AppSetting> = {}
  for (const key of Object.keys(defaultSetting) as Array<keyof LX.AppSetting>) {
    if (deviceSettings.has(key) || /^(sync|cookie|network|openAPI)\./.test(key)) continue
    const value = settings[key]
    if (value === undefined) continue
    const initial = defaultSetting[key]
    if (initial == null) {
      if (key == 'common.langId' && value !== null && !['zh-cn', 'zh-tw', 'en-us'].includes(String(value))) throw new WebDAVError('invalid_data', ['settings'])
    } else if (typeof value != typeof initial || (typeof value == 'number' && !Number.isFinite(value))) {
      throw new WebDAVError('invalid_data', ['settings'])
    }
    Object.assign(result, { [key]: value })
  }
  return result
}

const validMusic = (value: unknown, onlineOnly = false): value is LX.Music.MusicInfo => {
  if (!isRecord(value) || typeof value.id != 'string' || !value.id || typeof value.name != 'string' || typeof value.singer != 'string') return false
  if (value.interval != null && typeof value.interval != 'string') return false
  if (!['kw', 'kg', 'tx', 'wy', 'mg', ...(onlineOnly ? [] : ['local'])].includes(String(value.source))) return false
  const meta = value.meta
  if (!isRecord(meta) || !['string', 'number'].includes(typeof meta.songId) || typeof meta.albumName != 'string') return false
  return value.source == 'local'
    ? typeof meta.filePath == 'string' && typeof meta.ext == 'string'
    : Array.isArray(meta.qualitys) && isRecord(meta._qualitys)
}

const validMusicList = (value: unknown): value is LX.Music.MusicInfo[] => {
  if (!Array.isArray(value) || !value.every(item => validMusic(item))) return false
  return new Set(value.map(item => item.id)).size == value.length
}

const validPlaylists = (value: unknown): value is LX.Sync.List.ListData => {
  if (!isRecord(value) || !validMusicList(value.defaultList) || !validMusicList(value.loveList) || !Array.isArray(value.userList)) return false
  const ids = new Set<string>()
  return value.userList.every(list => {
    if (!isRecord(list) || typeof list.id != 'string' || !list.id || typeof list.name != 'string' || !validMusicList(list.list)) return false
    if (Object.values(LIST_IDS).some(id => id == list.id) || ids.has(list.id)) return false
    if (list.locationUpdateTime != null && !finite(list.locationUpdateTime)) return false
    if (list.sourceListId != null && typeof list.sourceListId != 'string') return false
    if (list.source != null && !['kw', 'kg', 'tx', 'wy', 'mg'].includes(String(list.source))) return false
    ids.add(list.id)
    return true
  })
}

export const isCompleted = (task: LX.Download.ListItem) => task.isComplate || task.status == 'completed'

// Only task identity and music metadata travel between machines. URLs and partial files expire or belong to a different machine.
export const portableDownloads = (tasks: LX.Download.ListItem[]): LX.Download.ListItem[] => tasks.map(task => {
  const completed = isCompleted(task)
  return {
    id: task.id,
    isComplate: completed,
    status: completed ? 'completed' : 'pause',
    statusText: '',
    downloaded: 0,
    total: 0,
    progress: completed ? 100 : 0,
    speed: '',
    writeQueue: 0,
    metadata: {
      musicInfo: task.metadata.musicInfo,
      quality: task.metadata.quality,
      ext: task.metadata.ext,
      fileName: task.metadata.fileName,
      url: null,
      filePath: '',
    },
  }
})

const validDownloads = (value: unknown, completed: boolean): value is LX.Download.ListItem[] => {
  if (!Array.isArray(value)) return false
  const ids = new Set<string>()
  return value.every(task => {
    if (!isRecord(task) || typeof task.id != 'string' || !task.id || ids.has(task.id)) return false
    if (typeof task.isComplate != 'boolean' || !['run', 'waiting', 'pause', 'error', 'completed'].includes(String(task.status))) return false
    if ((task.isComplate || task.status == 'completed') != completed) return false
    const meta = task.metadata
    if (!isRecord(meta) || !validMusic(meta.musicInfo, true) || !QUALITYS.some(quality => quality == meta.quality)) return false
    // eslint-disable-next-line no-control-regex -- Download names must be plain filenames without control characters.
    if (!['mp3', 'flac', 'wav', 'ape'].includes(String(meta.ext)) || typeof meta.fileName != 'string' || !meta.fileName || /[/\\\x00-\x1f]/.test(meta.fileName) || meta.fileName == '.' || meta.fileName == '..') return false
    ids.add(task.id)
    return true
  })
}

export const validateData = (data: LX.WebDAV.Data, sections: LX.WebDAV.Section[]) => {
  for (const section of sections) {
    const value = data[section]
    if (value === undefined) continue
    let valid = false
    switch (section) {
      case 'playlists': valid = validPlaylists(value); break
      case 'downloadHistory': valid = validDownloads(value, true); break
      case 'downloadTasks': valid = validDownloads(value, false); break
      case 'settings':
        valid = isRecord(value)
        if (valid) portableSettings(value as Partial<LX.AppSetting>)
        break
      case 'dislike': valid = typeof value == 'string'; break
    }
    if (!valid) throw new WebDAVError('invalid_data', [section])
  }
}

export const parseSnapshot = (content: string): LX.WebDAV.Snapshot => {
  let value: unknown
  try { value = JSON.parse(content) } catch { throw new WebDAVError('invalid_data') }
  if (!isRecord(value) || value.type != 'lx-music-webdav' || value.version != 1 || !finite(value.updatedAt) || !isRecord(value.data)) throw new WebDAVError('invalid_data')
  return value as unknown as LX.WebDAV.Snapshot
}

// Object key order and transient progress must not look like edits on another device.
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}
export const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')

export const normalizeData = (data: LX.WebDAV.Data, sections: LX.WebDAV.Section[]): LX.WebDAV.Data => {
  const result: LX.WebDAV.Data = {}
  for (const section of sections) {
    if (data[section] === undefined) continue
    switch (section) {
      case 'settings': result.settings = portableSettings(data.settings!); break
      case 'downloadHistory': result.downloadHistory = portableDownloads(data.downloadHistory!); break
      case 'downloadTasks': result.downloadTasks = portableDownloads(data.downloadTasks!); break
      default: Object.assign(result, { [section]: data[section] }); break
    }
  }
  return result
}

export const isEmpty = (section: LX.WebDAV.Section, data: LX.WebDAV.Data) => {
  const value = data[section]
  if (value == null) return true
  if (section == 'playlists') {
    const lists = value as LX.Sync.List.ListData
    return !lists.defaultList.length && !lists.loveList.length && !lists.userList.length
  }
  if (section == 'settings') return hash(value) == hash(portableSettings(defaultSetting))
  if (Array.isArray(value) || typeof value == 'string') return !value.length
  return false
}
