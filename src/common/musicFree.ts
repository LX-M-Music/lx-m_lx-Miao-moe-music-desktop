export const MUSIC_FREE_IPC = {
  list: 'musicfree:list',
  import: 'musicfree:import',
  remove: 'musicfree:remove',
  configure: 'musicfree:configure',
  call: 'musicfree:call',
  cancel: 'musicfree:cancel',
  network: 'musicfree:network',
  cancelNetwork: 'musicfree:cancel_network',
  command: 'musicfree:command',
  reply: 'musicfree:reply',
} as const

export type MusicFreeSource = `musicfree_${string}`
export const isMusicFreeSource = (source: unknown): source is MusicFreeSource => typeof source === 'string' && /^musicfree_[a-f\d]{24}$/.test(source)
export const isMusicFreeMediaUrl = (url: unknown): url is string => typeof url === 'string' && /^http:\/\/127\.0\.0\.1:\d+\/musicfree\/[a-f\d]{48}$/.test(url)
export const MUSIC_FREE_QUALITIES = ['flac', '320k', '192k', '128k'] as const
export const MUSIC_FREE_METHODS = ['search', 'getMediaSource', 'getLyric', 'getMusicInfo', 'importMusicSheet', 'importMusicItem'] as const

export interface MusicFreePlugin {
  id: MusicFreeSource
  name: string
  version: string
  author: string
  methods: string[]
  primaryKey: string[]
  supportedSearchType: string[]
  userVariables: Array<{ key: string, title: string }>
  variables: Record<string, string>
  enabled: boolean
  sourceUrl?: string
  error?: string
}

export interface MusicFreeRecord extends MusicFreePlugin {
  script: string
}

export interface MusicFreeImportResult {
  plugins: MusicFreePlugin[]
  imported: string[]
  errors: string[]
}
