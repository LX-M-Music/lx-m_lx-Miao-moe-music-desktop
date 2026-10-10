export type PlaylistSearchField = 'name' | 'singer' | 'album' | 'all'

const normalize = (value: string | undefined) => (value ?? '').normalize('NFKC').toLowerCase().trim()

export const createPlaylistSearchIndex = (list: LX.Music.MusicInfo[]) => list.map(song => ({
  song,
  fields: [song.name, song.singer, song.meta?.albumName].map(normalize),
}))

export const searchPlaylistMusic = (index: ReturnType<typeof createPlaylistSearchIndex>, query: string, field: PlaylistSearchField) => {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  const fieldIndex = { name: 0, singer: 1, album: 2, all: -1 }[field]
  return index.filter(entry => terms.every(term => fieldIndex === -1
    ? entry.fields.some(value => value.includes(term))
    : entry.fields[fieldIndex].includes(term),
  )).map(entry => entry.song)
}
