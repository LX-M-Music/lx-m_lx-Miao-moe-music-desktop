const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')()
const { createPlaylistSearchIndex, searchPlaylistMusic } = load('src/renderer/views/List/MusicList/search.ts')

const song = (id, name, singer, albumName) => Object.freeze({ id, name, singer, meta: Object.freeze({ albumName }) })
const songs = Object.freeze([
  song('first', '晨光', '林间', '清晨'),
  song('title', 'Echo', 'Alice', '北岸'),
  song('artist', '海风', 'Echo', '远行'),
  song('album', '夜行', 'Bob', 'Echo'),
  song('title-two', 'echo live', 'Alice', '合辑'),
  song('literal', '[a+b] & 晚风', '测试歌手', undefined),
])
const index = createPlaylistSearchIndex(songs)
const ids = (query, field = 'all') => searchPlaylistMusic(index, query, field).map(song => song.id)

test('playlist scopes search only their requested metadata and all combines the three fields', () => {
  assert.deepEqual(ids('Echo', 'name'), ['title', 'title-two'])
  assert.deepEqual(ids('Echo', 'singer'), ['artist'])
  assert.deepEqual(ids('Echo', 'album'), ['album'])
  assert.deepEqual(ids('Echo'), ['title', 'artist', 'album', 'title-two'])
})

test('playlist queries ignore case and normalize full-width text and surrounding whitespace', () => {
  assert.deepEqual(ids('  ＥＣＨＯ　'), ['title', 'artist', 'album', 'title-two'])
  assert.deepEqual(ids('ｅｃｈｏ   ＬＩＶＥ', 'name'), ['title-two'])
  assert.deepEqual(ids(' 晚风\n'), ['literal'])
})

test('every word must match, and all can match words in different metadata fields', () => {
  assert.deepEqual(ids('echo alice'), ['title', 'title-two'])
  assert.deepEqual(ids('echo alice', 'name'), [])
  assert.deepEqual(ids('echo 北岸'), ['title'])
  assert.deepEqual(ids('echo bob'), ['album'])
  assert.deepEqual(ids('echo nowhere'), [])
})

test('punctuation is searched literally and missing album metadata stays searchable by other fields', () => {
  assert.deepEqual(ids('[a+b]'), ['literal'])
  assert.deepEqual(ids('.*'), [])
  assert.deepEqual(ids('测试歌手'), ['literal'])
  assert.deepEqual(ids('测试歌手', 'album'), [])
  const missing = { id: 'missing', name: 'Unknown', singer: 'Artist' }
  assert.deepEqual(searchPlaylistMusic(createPlaylistSearchIndex([missing]), 'artist', 'all'), [missing])
})

test('empty queries return the whole list, and filtering preserves source order and song identity', () => {
  assert.deepEqual(ids(' \n\t'), songs.map(song => song.id))
  const result = searchPlaylistMusic(index, 'echo', 'all')
  assert.equal(result[0], songs[1])
  assert.equal(result[1], songs[2])
  assert.equal(result[2], songs[3])
  assert.equal(result[3], songs[4])
  assert.equal(songs[0].id, 'first')
})

test('a cached index searches a large playlist without losing late matches or changing the playlist', () => {
  const large = Array.from({ length: 10000 }, (_, n) => song(`large-${n}`, `Song ${n}`, `Artist ${n % 10}`, n === 9999 ? '最后一张专辑' : 'Album'))
  const cached = createPlaylistSearchIndex(large)
  assert.equal(searchPlaylistMusic(cached, '最后一张专辑', 'album')[0], large[9999])
  assert.equal(searchPlaylistMusic(cached, 'artist 9', 'singer').length, 1000)
  assert.equal(searchPlaylistMusic(cached, 'Song 9999', 'name')[0], large[9999])
  assert.equal(large.length, 10000)
  assert.equal(large[0].id, 'large-0')
})
