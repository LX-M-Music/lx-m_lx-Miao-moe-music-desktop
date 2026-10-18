const assert = require('node:assert/strict')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')
const { sameFilePath } = require('../src/optional-plugins/audio-tag-editor/downloadFile')

const localSong = (id, filePath = 'C:\\Music\\song.mp3') => ({ id, source: 'local', name: 'Before', singer: 'Before artist', interval: '03:00', meta: { filePath, ext: 'mp3', albumName: 'Before album', songId: id } })
const fixture = (lists, cachedIds, open = true) => {
  const editor = { visible: false }, updates = []
  const list = { value: lists.get('current') }
  const load = loader({
    '@root/optional-plugins/audio-tag-editor/actions': { canEditLocalMusic: song => song?.source === 'local', openLocalMusic: async() => open },
    '@root/optional-plugins/audio-tag-editor/downloadFile': { sameFilePath },
    '@root/optional-plugins/audio-tag-editor/session': { editor },
    '@renderer/store/list/state': { allMusicList: new Map(cachedIds.map(id => [id, lists.get(id)])) },
    '@renderer/store/list/action': {
      getMusicExistListIds: async id => [...lists].filter(([, songs]) => songs.some(song => song.id === id)).map(([id]) => id),
      getListMusics: async id => lists.get(id),
      updateListMusics: async batch => { updates.push(...batch) },
    },
  })
  return { ...load('src/renderer/views/List/MusicList/useMusicTagEditor.ts').default({ list }), editor, list, updates }
}
const saved = { filePath: 'C:\\Music\\song.mp3', size: 8192, tags: { title: 'Updated', artist: 'New artist', album: 'New album', year: '2026' } }

test('local tag save updates actual playlist memberships, including uncached lists, while preserving song identity and per-list metadata', async() => {
  const song = localSong('song'), alias = localSong('alias')
  const lists = new Map([
    ['current', [song]],
    ['uncached', [{ ...song, meta: { ...song.meta, custom: 'preserved' } }]],
    ['cached-alias', [alias]],
    ['different-file', [localSong('song', 'C:\\Other\\song.mp3')]],
  ])
  const { handleEditMusicTags, handleTagsSaved, editor, updates } = fixture(lists, ['current', 'cached-alias'])
  await handleEditMusicTags(0)
  assert.equal(editor.visible, true)
  await handleTagsSaved(saved)
  assert.deepEqual(updates.map(update => update.id).sort(), ['cached-alias', 'current', 'uncached'])
  assert.equal(updates.find(update => update.id === 'uncached').musicInfo.meta.custom, 'preserved')
  for (const update of updates) {
    assert(lists.has(update.id), 'update.id must be a playlist ID')
    assert.equal(update.musicInfo.name, 'Updated')
    assert.equal(update.musicInfo.singer, 'New artist')
    assert.equal(update.musicInfo.meta.albumName, 'New album')
    assert.equal(update.musicInfo.meta.filePath, saved.filePath)
    assert.equal(update.musicInfo.interval, '03:00')
    assert.equal(update.musicInfo.meta.year, 2026)
    assert.equal(update.musicInfo.meta.fileSize, 8192)
  }
  assert.deepEqual(updates.map(update => update.musicInfo.id).sort(), ['alias', 'song', 'song'])
})

test('canceling the editor leaves it closed, and removing a song before save never reinserts it', async() => {
  const lists = new Map([['current', [localSong('song')]]])
  const canceled = fixture(lists, ['current'], false)
  await canceled.handleEditMusicTags(0)
  assert.equal(canceled.editor.visible, false)
  const active = fixture(lists, ['current'])
  await active.handleEditMusicTags(0)
  lists.get('current').splice(0, 1)
  await active.handleTagsSaved(saved)
  assert.deepEqual(active.updates, [])
})
