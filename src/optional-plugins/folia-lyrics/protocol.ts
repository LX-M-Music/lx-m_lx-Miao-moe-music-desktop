export const FOLIA_CHANNEL = 'lx-m:folia-lyrics'
export const FOLIA_INTERACTIVE_TARGETS = 'button, a, input, select, textarea, label, [role="button"], [role="slider"], [contenteditable="true"]'
export const FOLIA_MODES = ['classic', 'fume', 'partita', 'tilt', 'cadenza', 'cappella', 'claddagh', 'diorama', 'monet', 'pendolo', 'sonnet', 'tempera', 'still'] as const
export type FoliaMode = typeof FOLIA_MODES[number]
export interface FoliaWord { text: string, startTime: number, endTime: number }
export interface FoliaLine {
  id: string
  fullText: string
  startTime: number
  endTime: number
  words: FoliaWord[]
  translation?: string
}
export interface FoliaSong {
  id: string
  title: string
  artist: string
  album: string
  coverUrl: string
  duration: number
  lines: FoliaLine[]
}
export interface FoliaConfig {
  mode: FoliaMode
  language: string
  fontFamily: string
  fontFamilies?: string[]
  fontScale: number
  reducedMotion: boolean
  bottomInset: number
}
export interface FoliaFrame {
  time: number
  playing: boolean
  rate: number
  power: number
  bands: number[]
  spectrum: Uint8Array
}
