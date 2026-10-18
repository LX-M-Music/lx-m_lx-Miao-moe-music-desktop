import path from 'node:path'
import { canEditLocalMusic, openLocalMusic } from '@root/optional-plugins/audio-tag-editor/actions'
import { sameFilePath } from '@root/optional-plugins/audio-tag-editor/downloadFile'
import { editor } from '@root/optional-plugins/audio-tag-editor/session'
import { allMusicList } from '@renderer/store/list/state'
import { getListMusics, getMusicExistListIds, updateListMusics } from '@renderer/store/list/action'
import type { Ref } from '@common/utils/vueTools'

interface SavedTags {
  filePath: string
  size: number
  tags: Record<string, string>
}

export default ({ list }: { list: Ref<LX.Music.MusicInfo[]> }) => {
  let selectedMusic: LX.Music.MusicInfoLocal | undefined
  const handleEditMusicTags = async(index: number) => {
    const song = list.value[index]
    if (!canEditLocalMusic(song) || song.source !== 'local') return
    if (await openLocalMusic(song, true)) {
      selectedMusic = song
      editor.visible = true
    }
  }
  const handleTagsSaved = async(snapshot: SavedTags) => {
    const songs = new Map<string, LX.Music.MusicInfoLocal>()
    // Include cached aliases of the same file without changing IDs or positions.
    const collect = (song?: LX.Music.MusicInfo) => {
      if (song?.source === 'local' && sameFilePath(song.meta.filePath, snapshot.filePath)) songs.set(song.id, song)
    }
    collect(selectedMusic)
    for (const song of list.value) collect(song)
    for (const cached of allMusicList.values()) for (const song of cached) collect(song)
    if (!songs.size) return
    const { tags } = snapshot
    const year = /^\d{4}/.exec(tags.year)?.[0]
    const updates: LX.List.ListActionMusicUpdate = []
    for (const song of songs.values()) {
      // The update API takes playlist IDs, including lists outside the renderer cache.
      for (const id of await getMusicExistListIds(song.id)) {
        const current = (await getListMusics(id)).find(item => item.id === song.id)
        if (current?.source !== 'local' || !sameFilePath(current.meta.filePath, snapshot.filePath)) continue
        updates.push({
          id,
          musicInfo: {
            ...current,
            name: tags.title.trim() || path.basename(snapshot.filePath, path.extname(snapshot.filePath)),
            singer: tags.artist.trim(),
            meta: { ...current.meta, albumName: tags.album.trim(), year: year ? Number(year) : undefined, fileSize: snapshot.size },
          },
        })
      }
    }
    if (updates.length) await updateListMusics(updates)
  }
  return { handleEditMusicTags, handleTagsSaved }
}
