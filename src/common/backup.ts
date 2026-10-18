import defaultSetting from './defaultSetting'
import { credentialKeys } from './sensitive'
import { LIST_IDS, QUALITYS } from './constants'
import { toNewMusicInfo, fixNewMusicInfoQuality } from './utils/tools'
import migrateSetting from './utils/migrateSetting'
import { validateLibraryPreferences, type LibraryPreferences } from './library'
import { isMusicFreeSource } from './musicFree'

export const BACKUP_IPC = { export: 'backup_export', preview: 'backup_preview', restore: 'backup_restore', discard: 'backup_discard' } as const
export const MAX_BACKUP_FILE = 64 * 1024 * 1024
export const MAX_BACKUP_EXPANDED = 256 * 1024 * 1024
export const BACKUP_SECTIONS = ['playlists', 'settings', 'downloads', 'lyrics', 'plugins', 'library'] as const
export type BackupSection = typeof BACKUP_SECTIONS[number]
export type BackupList = LX.List.UserListInfoFull
export interface BackupPlugins {
  enabled: Record<string, boolean>
  preferences: Record<string, Record<string, unknown>>
  soundEffect: Record<string, unknown>
}
export interface BackupData {
  library?: BackupLibrary
  playlists?: BackupList[]
  settings?: Partial<LX.AppSetting>
  downloads?: LX.Download.ListItem[]
  lyrics?: Array<{ id: string, lyric: LX.Music.LyricInfo }>
  plugins?: BackupPlugins
}
export interface BackupLibrary {
  preferences: LibraryPreferences
  versions: Array<{ listId: string, time: number, reason: string, songs: LX.Music.MusicInfo[] }>
  listening: Array<{ time: number, song: LX.Music.MusicInfo }>
  tracks: Array<{ id: string, added_at: number, last_played: number, missing: number }>
}
export interface BackupPreview { token: string, filename: string, createdAt?: number, counts: Partial<Record<BackupSection, number>>, playlists: Array<{ id: string, name: string, count: number }> }
export class BackupError extends Error {
  constructor(public readonly code: string, detail = '') { super(`backup:${code}${detail ? ':' + detail : ''}`) }
}
function fail(location: string): never { throw new BackupError('invalid', location) }
const record = (v: any): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: any, max = 8192): v is string => typeof v === 'string' && v.length <= max
const finite = (v: any) => typeof v === 'number' && Number.isFinite(v)
export const preferenceFile = (name: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.json$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name)

// Bound nesting and reject prototype keys before any migration or object merge.
export const validateJsonTree = (value: unknown) => {
  let nodes = 0
  const visit = (v: any, depth: number) => {
    if (++nodes > 4_000_000 || depth > 32) fail('structure')
    if (v == null || typeof v === 'boolean' || finite(v)) return
    if (typeof v === 'string') { if (v.length > 8 * 1024 * 1024) fail('text'); return }
    if (typeof v !== 'object') fail('value')
    for (const key of Object.keys(v)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('key')
      visit(v[key], depth + 1)
    }
  }
  visit(value, 0)
}
export const validateBackupSettings = (value: any): Partial<LX.AppSetting> => {
  if (!record(value)) fail('settings')
  const result: Partial<LX.AppSetting> = {}
  for (const [key, val] of Object.entries(value)) {
    if (credentialKeys.has(key)) continue
    if (val === undefined) continue // legacy migrations omit unavailable fields
    if (!Object.hasOwn(defaultSetting, key)) {
      if (val !== null && !['string', 'boolean', 'number'].includes(typeof val)) fail('settings.' + key)
      continue // newer primitive settings do not invalidate older clients
    }
    const initial = defaultSetting[key as keyof LX.AppSetting]
    if (initial === null ? val !== null && (key === 'common.langId' ? !['zh-cn', 'zh-tw', 'en-us'].includes(val as string) : !finite(val)) : typeof val !== typeof initial || (typeof val === 'number' && !finite(val))) fail('settings.' + key)
    if (typeof val === 'string' && val.length > 1024 * 1024) fail('settings.' + key)
    Object.assign(result, { [key]: val })
  }
  return result
}
const music = (value: any): LX.Music.MusicInfo => {
  if (!record(value) || !text(value.id) || !value.id || !text(value.name) || !text(value.singer) || !(['local', 'kw', 'kg', 'tx', 'wy', 'mg'].includes(value.source) || isMusicFreeSource(value.source))) fail('song')
  if (value.interval != null && !text(value.interval, 80)) fail('song.interval')
  const meta = value.meta
  if (!record(meta) || !(text(meta.songId) || finite(meta.songId)) || !text(meta.albumName)) fail('song.meta')
  if (isMusicFreeSource(value.source) && !record(meta.musicfree)) fail('song.musicfree')
  if (meta.picUrl != null && !text(meta.picUrl, 1024 * 1024)) fail('song.cover')
  if (value.source === 'local') {
    if (!text(meta.filePath) || !text(meta.ext, 32)) fail('song.path')
  } else {
    if (!Array.isArray(meta.qualitys) || meta.qualitys.length > 30 || !record(meta._qualitys)) fail('song.quality')
    for (const quality of meta.qualitys) {
      if (!record(quality) || ![...QUALITYS, 'flac32bit'].includes(quality.type) || (quality.size != null && !text(quality.size))) fail('song.quality')
    }
    for (const quality of Object.values(meta._qualitys)) if (!record(quality)) fail('song.quality')
    fixNewMusicInfoQuality(value as LX.Music.MusicInfo)
  }
  return value as LX.Music.MusicInfo
}
const playlists = (value: any, legacy: boolean): BackupList[] => {
  if (!Array.isArray(value) || value.length > 5000) fail('playlists')
  let total = 0
  const ids = new Set<string>()
  return value.map(item => {
    if (!record(item) || !(text(item.id) || finite(item.id)) || !String(item.id) || !text(item.name) || !Array.isArray(item.list)) fail('playlist')
    const id = String(item.id)
    if (id === LIST_IDS.DOWNLOAD || ids.has(id)) fail('playlist.id')
    ids.add(id)
    if ((total += item.list.length) > 500_000) fail('playlist.size')
    if (item.source != null && !['kw', 'kg', 'tx', 'wy', 'mg'].includes(item.source)) fail('playlist.source')
    if (item.sourceListId != null && !(text(item.sourceListId) || finite(item.sourceListId))) fail('playlist.sourceListId')
    if (item.locationUpdateTime != null && !finite(item.locationUpdateTime)) fail('playlist.time')
    const songs = new Map<string, LX.Music.MusicInfo>()
    for (const entry of item.list) {
      let info
      try { info = music(legacy ? toNewMusicInfo(entry) : entry) } catch { fail('playlist.song') }
      if (!songs.has(info.id)) songs.set(info.id, info)
    }
    return { id, name: item.name, source: item.source, sourceListId: item.sourceListId == null ? undefined : String(item.sourceListId), locationUpdateTime: item.locationUpdateTime ?? null, list: [...songs.values()] }
  })
}
const downloads = (value: any): LX.Download.ListItem[] => {
  if (!Array.isArray(value) || value.length > 100_000) fail('downloads')
  const ids = new Set()
  return value.map(task => {
    if (!record(task) || !text(task.id) || !task.id || ids.has(task.id) || typeof task.isComplate !== 'boolean' || !['run', 'waiting', 'pause', 'error', 'completed'].includes(task.status)) fail('download')
    ids.add(task.id)
    for (const key of ['downloaded', 'total', 'progress', 'writeQueue']) if (!finite(task[key]) || task[key] < 0) fail('download.' + key)
    if (!text(task.statusText) || !text(task.speed) || (task.priority != null && !finite(task.priority)) || (task.audioDownloaded != null && typeof task.audioDownloaded !== 'boolean')) fail('download.state')
    const meta = task.metadata
    if (!record(meta) || !QUALITYS.includes(meta.quality) || !['mp3', 'flac', 'wav', 'ape', 'm4a', 'ogg'].includes(meta.ext) || !text(meta.fileName) || !text(meta.filePath) || (meta.url != null && !text(meta.url))) fail('download.meta')
    if (music(meta.musicInfo).source === 'local') fail('download.source')
    if (meta.fileAllocated != null && typeof meta.fileAllocated !== 'boolean') fail('download.fileAllocated')
    if (meta.listId != null && !text(meta.listId)) fail('download.listId')
    if (task.failure != null && (!record(task.failure) || !text(task.failure.kind, 80) || (task.failure.code != null && !text(task.failure.code)) || (task.failure.message != null && !text(task.failure.message)))) fail('download.failure')
    // Restore records only. Do not auto-start network work or trust expiring URLs.
    const validated = task as LX.Download.ListItem
    return { ...validated, status: validated.isComplate ? 'completed' : 'pause', statusText: '', speed: '', writeQueue: 0, metadata: { ...validated.metadata, url: null } }
  })
}
const lyrics = (value: any): NonNullable<BackupData['lyrics']> => {
  if (!Array.isArray(value) || value.length > 100_000) fail('lyrics')
  const ids = new Set()
  for (const item of value) {
    if (!record(item) || !text(item.id) || !item.id || ids.has(item.id) || !record(item.lyric) || !text(item.lyric.lyric, 4 * 1024 * 1024)) fail('lyric')
    ids.add(item.id)
    for (const [key, val] of Object.entries(item.lyric)) if (!['lyric', 'tlyric', 'rlyric', 'lxlyric'].includes(key) || (val !== null && !text(val, 4 * 1024 * 1024))) fail('lyric.text')
  }
  return value
}
const plugins = (value: any): BackupPlugins => {
  if (!record(value) || !record(value.enabled) || !record(value.preferences) || !record(value.soundEffect)) fail('plugins')
  if (Object.keys(value.enabled).length > 500 || Object.keys(value.preferences).length > 500 || JSON.stringify(value).length > 4 * 1024 * 1024) fail('plugins.size')
  for (const [id, enabled] of Object.entries(value.enabled)) if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(id) || typeof enabled !== 'boolean') fail('plugins.enabled')
  const names = new Set<string>()
  for (const [name, preference] of Object.entries(value.preferences)) {
    if (!preferenceFile(name) || !record(preference) || JSON.stringify(preference).length > 1024 * 1024 || names.has(name.toLowerCase())) fail('plugins.preferences')
    names.add(name.toLowerCase())
  }
  for (const [key, presets] of Object.entries(value.soundEffect)) {
    if (!['eqPreset', 'convolutionPreset'].includes(key) || !Array.isArray(presets) || presets.length > 1000) fail('plugins.presets')
    for (const preset of presets) {
      if (!record(preset) || !text(preset.id) || !text(preset.name)) fail('plugins.preset')
      if (key === 'eqPreset') {
        for (const hz of [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]) if (!finite(preset['hz' + hz])) fail('plugins.preset.eq')
      } else if (!text(preset.source) || !finite(preset.mainGain) || !finite(preset.sendGain)) fail('plugins.preset.convolution')
      for (const val of Object.values(preset)) if (!text(val) && !finite(val)) fail('plugins.preset.value')
    }
  }
  return value as BackupPlugins
}
export const validateBackupData = (value: any): BackupData => {
  validateJsonTree(value)
  if (!record(value) || !Object.keys(value).length || Object.keys(value).some(key => !BACKUP_SECTIONS.includes(key as BackupSection))) fail('sections')
  const result: BackupData = {}
  if (value.playlists !== undefined) result.playlists = playlists(value.playlists, false)
  if (value.settings !== undefined) result.settings = validateBackupSettings(value.settings)
  if (value.downloads !== undefined) result.downloads = downloads(value.downloads)
  if (value.lyrics !== undefined) result.lyrics = lyrics(value.lyrics)
  if (value.plugins !== undefined) result.plugins = plugins(value.plugins)
  if (value.library !== undefined) {
    const library = value.library
    if (!record(library) || !Array.isArray(library.versions) || library.versions.length > 500 || !Array.isArray(library.listening) || library.listening.length > 50000 || !Array.isArray(library.tracks) || library.tracks.length > 500000) fail('library')
    const preferences = validateLibraryPreferences(library.preferences)
    for (const entry of library.versions) {
      if (!record(entry) || !text(entry.listId) || !finite(entry.time) || !text(entry.reason, 100) || !Array.isArray(entry.songs) || entry.songs.length > 500000) fail('library.versions')
      entry.songs = entry.songs.map(music)
    }
    for (const entry of library.listening) { if (!record(entry) || !finite(entry.time)) fail('library.listening'); entry.song = music(entry.song) }
    const ids = new Set<string>()
    for (const entry of library.tracks) {
      if (!record(entry) || !text(entry.id) || ids.has(entry.id) || !finite(entry.added_at) || !finite(entry.last_played) || ![0, 1].includes(entry.missing)) fail('library.tracks')
      ids.add(entry.id)
    }
    result.library = { preferences, versions: library.versions, listening: library.listening, tracks: library.tracks }
  }
  return result
}
const legacySettings = (value: any) => {
  if (!record(value)) fail('settings')
  for (const name of ['player', 'desktopLyric', 'playDetail', 'download', 'list', 'tray', 'theme']) {
    if (value[name] != null && !record(value[name])) fail('settings.' + name)
  }
  const migrated = migrateSetting(value)
  return validateBackupSettings(Object.fromEntries(Object.entries(migrated).filter(([key]) => Object.hasOwn(defaultSetting, key))))
}
export const normalizeBackup = (raw: any): BackupData => {
  validateJsonTree(raw)
  if (!record(raw)) fail('root')
  const legacy = !String(raw.type).endsWith('_v2') && raw.type !== 'allData_v3'
  const result: BackupData = {}
  switch (raw.type) {
    case 'allData_v3':
      if (raw.version !== 3 || !finite(raw.createdAt)) fail('version')
      return validateBackupData(raw.data)
    case 'allData': case 'allData_v2':
      if (!record(raw.setting)) fail('settings')
      result.playlists = playlists(raw.defaultList ? [{ ...raw.defaultList, id: LIST_IDS.DEFAULT, name: raw.defaultList.name ?? 'Default' }] : raw.playList, legacy)
      result.settings = legacy ? legacySettings(raw.setting) : validateBackupSettings(raw.setting)
      break
    case 'playList': case 'playList_v2': result.playlists = playlists(raw.data, legacy); break
    case 'playListPart_v2': result.playlists = playlists([raw.data], false); break
    case 'defautlList': result.playlists = playlists([{ ...raw.data, id: LIST_IDS.DEFAULT, name: raw.data?.name ?? 'Default' }], true); break
    case 'setting': case 'setting_v2':
      if (!record(raw.data)) fail('settings')
      result.settings = legacy ? legacySettings(raw.data) : validateBackupSettings(raw.data)
      break
    default: throw new BackupError('type')
  }
  return result
}
