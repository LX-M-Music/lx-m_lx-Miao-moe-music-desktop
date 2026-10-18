import { musicMatchScore } from './musicToggleCandidates'

export const searchVersions = ['all', 'standard', 'live', 'instrumental', 'cover', 'remix', 'acoustic', 'other'] as const
export type SearchVersion = typeof searchVersions[number]
interface Song {
  id: string
  source: string
  name?: string | null
  singer?: string | null
  interval?: string | null
  meta?: { albumName?: string }
}
const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '')
const artistKey = (value?: string | null) => (value ?? '').split(/[、&,，;；/|]/).map(normalized).filter(Boolean).sort().join('|')
const seconds = (value?: string | null) => value && /^\d+(?::\d{1,2}){1,2}$/.test(value) ? value.split(':').reduce((total, part) => total * 60 + Number(part), 0) : 0

export const getSearchVersion = (name?: string | null): SearchVersion => {
  const text = (name ?? '').normalize('NFKC')
  const markers = [...text.matchAll(/[([]([^\])]+)[\])]/g)].map(match => match[1]).join(' ') + ' ' +
    (text.match(/(?:\s[-–—]\s*|\s+)(live|concert|instrumental|karaoke|cover|remix|acoustic|unplugged|伴奏|现场|翻唱|混音|不插电)(?:\s+version)?$/i)?.[1] ?? '')
  if (/\b(instrumental|karaoke|backing track|off vocal)\b|伴奏|纯音乐|去人声/i.test(markers)) return 'instrumental'
  if (/\b(live|concert)\b|现场|演唱会/i.test(markers)) return 'live'
  if (/\b(cover|tribute)\b|翻唱/i.test(markers)) return 'cover'
  if (/\bremix\b|混音/i.test(markers)) return 'remix'
  if (/\b(acoustic|unplugged)\b|不插电/i.test(markers)) return 'acoustic'
  if (/\b(demo|piano|sped up|slowed|reverb)\b|加速|降速|钢琴/i.test(markers)) return 'other'
  return 'standard'
}

export const filterSearchSongs = <T extends Song>(songs: T[], version: SearchVersion = 'all', merge = false, canPlay: (song: T) => boolean = () => true, sourceLabel: (source: string) => string = source => source) => {
  const selected = songs.filter(song => version === 'all' || getSearchVersion(song.name) === version)
  const groups = new Map<string, T[][]>()
  const list: T[] = []
  const sourceLabels: Record<string, string> = {}
  for (const song of selected) {
    const key = JSON.stringify([normalized(song.name ?? ''), artistKey(song.singer), getSearchVersion(song.name)])
    const candidates = groups.get(key) ?? []
    const duration = seconds(song.interval)
    const group = merge && duration > 0 && artistKey(song.singer) ? candidates.find(items => {
      const first = items[0]
      return !items.some(item => item.source === song.source) && items.every(item => seconds(item.interval) > 0 && Math.abs(duration - seconds(item.interval)) <= 2) &&
        musicMatchScore(first, song) >= 130
    }) : undefined
    if (group) {
      if (canPlay(song) && !canPlay(group[0])) {
        const previous = group[0]
        list[list.indexOf(previous)] = song
        Reflect.deleteProperty(sourceLabels, previous.id)
        group.unshift(song)
      } else group.push(song)
      sourceLabels[group[0].id] = group.map(item => sourceLabel(item.source)).join(' / ')
    } else {
      list.push(song)
      candidates.push([song])
      groups.set(key, candidates)
      if (sourceLabel(song.source) !== song.source) sourceLabels[song.id] = sourceLabel(song.source)
    }
  }
  return { list, sourceLabels, mergedCount: selected.length - list.length }
}
