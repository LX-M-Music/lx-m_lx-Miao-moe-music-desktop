const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')()
const smart = load('src/common/smartPlaylist.ts')

const NOW = Date.parse('2026-11-06T00:00:00Z')
const DAY = 86400000

const song = (id, name, extra = {}) => ({
  id,
  name,
  singer: extra.singer ?? 'Singer',
  source: extra.source ?? 'local',
  interval: extra.interval === undefined ? '03:00' : extra.interval,
  meta: { songId: id, albumName: extra.album ?? 'Album', filePath: '', ext: 'mp3' },
})
const context = ({ stats = {}, membership = {}, now = NOW } = {}) => ({
  playStats: new Map(Object.entries(stats)),
  listMembership: new Map(Object.entries(membership).map(([id, lists]) => [id, new Set(lists)])),
  now,
})
const rule = (groups, extra = {}) => ({ version: 1, name: 'test', groups, sort: 'name', order: 'asc', limit: 0, ...extra })
const group = (rules, any = false) => ({ any, rules })
const r = (field, operator, value) => ({ field, operator, value })
const evaluate = (input, songs, ctx = context()) => smart.evaluateSmartPlaylist(input, songs, ctx)
const ids = songs => songs.map(value => value.id)

test('parseMusicInterval parses mm:ss, hh:mm:ss, plain seconds and rejects unknown values', () => {
  assert.equal(smart.parseMusicInterval('03:55'), 235)
  assert.equal(smart.parseMusicInterval('1:02:03'), 3723)
  assert.equal(smart.parseMusicInterval('0:30'), 30)
  assert.equal(smart.parseMusicInterval('00:00'), 0)
  assert.equal(smart.parseMusicInterval('235'), 235)
  assert.equal(smart.parseMusicInterval(235), 235)
  assert.equal(smart.parseMusicInterval(null), 0)
  assert.equal(smart.parseMusicInterval(undefined), 0)
  assert.equal(smart.parseMusicInterval('not-a-duration'), 0)
  assert.equal(smart.parseMusicInterval('1:99'), 0)
})

test('normalizeSmartPlaylist fills defaults and rejects unsupported versions', () => {
  const normalized = smart.normalizeSmartPlaylist({ groups: [] })
  assert.equal(normalized.version, 1)
  assert.equal(normalized.name, '')
  assert.deepEqual(normalized.groups, [])
  assert.equal(normalized.sort, 'name')
  assert.equal(normalized.order, 'asc')
  assert.equal(normalized.limit, 0)
  assert.throws(() => smart.normalizeSmartPlaylist({ version: 2, groups: [] }), { code: 'SMART_PLAYLIST_RULE_INVALID' })
  assert.throws(() => smart.normalizeSmartPlaylist(null), { code: 'SMART_PLAYLIST_RULE_INVALID' })
  assert.throws(() => smart.normalizeSmartPlaylist([]), { code: 'SMART_PLAYLIST_RULE_INVALID' })
})

test('normalizeSmartPlaylist rejects unknown fields, operators and invalid operator/field pairs', () => {
  const invalid = [
    rule([group([r('nope', 'is', 'x')])]),
    rule([group([r('name', 'gt', 1)])]),
    rule([group([r('interval', 'contains', 'x')])]),
    rule([group([r('lastPlayed', 'gt', 1)])]),
    rule([group([r('inPlaylist', 'is', 'one')])]),
    rule([group([r('isLoved', 'contains', true)])]),
    rule([group([{ operator: 'is', value: 'x' }])]),
    rule([group([{ field: 'name', value: 'x' }])]),
    rule([group([{ field: 'name', operator: 'is' }])]),
    rule('nope'),
  ]
  for (const input of invalid) assert.throws(() => smart.normalizeSmartPlaylist(input), { code: 'SMART_PLAYLIST_RULE_INVALID' })
})

test('normalizeSmartPlaylist validates numeric, range, range-order, limit, sort and order values', () => {
  smart.normalizeSmartPlaylist(rule([group([r('playCount', 'gt', 3)])]))
  smart.normalizeSmartPlaylist(rule([group([r('interval', 'inTheRange', [30, 240])])]))
  smart.normalizeSmartPlaylist(rule([group([r('lastPlayed', 'inTheLast', 7)])]))
  smart.normalizeSmartPlaylist(rule([group([r('isLoved', 'is', true)])]))
  smart.normalizeSmartPlaylist(rule([group([r('inPlaylist', 'inPlaylist', 'one')])]))
  const invalid = [
    rule([group([r('playCount', 'gt', 'many')])]),
    rule([group([r('playCount', 'gt', -1)])]),
    rule([group([r('interval', 'inTheRange', [30])])]),
    rule([group([r('interval', 'inTheRange', [240, 30])])]),
    rule([group([r('interval', 'inTheRange', [30, 'x'])])]),
    rule([group([r('lastPlayed', 'inTheLast', 1.5)])]),
    rule([group([r('lastPlayed', 'inTheLast', 0)])]),
    rule([group([r('inPlaylist', 'inPlaylist', '')])]),
    rule([group([r('isLoved', 'is', 'maybe')])]),
    rule([], { sort: 'nope' }),
    rule([], { order: 'up' }),
    rule([], { limit: -1 }),
    rule([], { limit: 1.5 }),
    rule([], { name: 123 }),
    rule([{ any: 'yes', rules: [] }]),
    rule([{ rules: 'nope' }]),
  ]
  for (const input of invalid) assert.throws(() => smart.normalizeSmartPlaylist(input), { code: 'SMART_PLAYLIST_RULE_INVALID' })
})

test('normalizeSmartPlaylist accepts numeric strings from half-typed form values', () => {
  const normalized = smart.normalizeSmartPlaylist(rule([group([r('playCount', 'gt', '3'), r('lastPlayed', 'inTheLast', '7')])]))
  assert.equal(normalized.groups[0].rules[0].value, 3)
  assert.equal(normalized.groups[0].rules[1].value, 7)
})

test('name operators match case-insensitively and support is/isNot/contains/notContains/startsWith', () => {
  const songs = [song('a', 'Sunshine'), song('b', 'Moonlight'), song('c', 'sunset')]
  assert.deepEqual(ids(evaluate(rule([group([r('name', 'is', 'sunshine')])]), songs)), ['a'])
  assert.deepEqual(ids(evaluate(rule([group([r('name', 'isNot', 'sunshine')])]), songs)), ['b', 'c'])
  assert.deepEqual(ids(evaluate(rule([group([r('name', 'contains', 'SUN')])]), songs)), ['c', 'a'])
  assert.deepEqual(ids(evaluate(rule([group([r('name', 'notContains', 'sun')])]), songs)), ['b'])
  assert.deepEqual(ids(evaluate(rule([group([r('name', 'startsWith', 'moon')])]), songs)), ['b'])
})

test('singer, album and source rules use the matching song fields', () => {
  const songs = [
    song('a', 'A', { singer: 'Alice', album: 'First', source: 'wy' }),
    song('b', 'B', { singer: 'Bob', album: 'Second', source: 'local' }),
    song('c', 'C', { singer: 'Alice feat. Bob', album: 'Second', source: 'tx' }),
  ]
  assert.deepEqual(ids(evaluate(rule([group([r('singer', 'contains', 'alice')])]), songs)), ['a', 'c'])
  assert.deepEqual(ids(evaluate(rule([group([r('singer', 'is', 'Alice')])]), songs)), ['a'])
  assert.deepEqual(ids(evaluate(rule([group([r('album', 'is', 'Second')])]), songs)), ['b', 'c'])
  assert.deepEqual(ids(evaluate(rule([group([r('source', 'is', 'local')])]), songs)), ['b'])
  assert.deepEqual(ids(evaluate(rule([group([r('source', 'isNot', 'local')])]), songs)), ['a', 'c'])
})

test('songs with a missing album or interval are handled without throwing', () => {
  const songs = [
    { ...song('a', 'A'), interval: null, meta: { songId: 'a' } },
    song('b', 'B', { interval: '00:30' }),
  ]
  assert.deepEqual(ids(evaluate(rule([group([r('album', 'is', '')])]), songs)), ['a'])
  assert.deepEqual(ids(evaluate(rule([group([r('interval', 'lt', 60)])]), songs)), ['b'])
  assert.deepEqual(ids(evaluate(rule([group([r('interval', 'gt', 0)])]), songs)), ['b'])
})

test('interval rules support gt, lt and an inclusive inTheRange', () => {
  const songs = [song('a', 'A', { interval: '01:00' }), song('b', 'B', { interval: '02:00' }), song('c', 'C', { interval: '03:00' })]
  assert.deepEqual(ids(evaluate(rule([group([r('interval', 'gt', 120)])]), songs)), ['c'])
  assert.deepEqual(ids(evaluate(rule([group([r('interval', 'lt', 120)])]), songs)), ['a'])
  assert.deepEqual(ids(evaluate(rule([group([r('interval', 'inTheRange', [60, 120])])]), songs)), ['a', 'b'])
})

test('playCount rules read aggregated listening history statistics', () => {
  const songs = [song('a', 'A'), song('b', 'B'), song('c', 'C')]
  const ctx = context({ stats: { a: { count: 5, lastPlayed: NOW }, b: { count: 1, lastPlayed: NOW - DAY } } })
  assert.deepEqual(ids(evaluate(rule([group([r('playCount', 'gt', 2)])]), songs, ctx)), ['a'])
  assert.deepEqual(ids(evaluate(rule([group([r('playCount', 'lt', 2)])]), songs, ctx)), ['b', 'c'])
  assert.deepEqual(ids(evaluate(rule([group([r('playCount', 'inTheRange', [1, 5])])]), songs, ctx)), ['a', 'b'])
})

test('lastPlayed rules use inTheLast/notInTheLast day windows, treating never-played songs as old', () => {
  const songs = [song('recent', 'Recent'), song('old', 'Old'), song('never', 'Never')]
  const ctx = context({
    stats: { recent: { count: 1, lastPlayed: NOW - 3 * DAY }, old: { count: 1, lastPlayed: NOW - 30 * DAY } },
  })
  assert.deepEqual(ids(evaluate(rule([group([r('lastPlayed', 'inTheLast', 7)])]), songs, ctx)), ['recent'])
  assert.deepEqual(ids(evaluate(rule([group([r('lastPlayed', 'notInTheLast', 7)])]), songs, ctx)), ['never', 'old'])
  assert.deepEqual(ids(evaluate(rule([group([r('lastPlayed', 'inTheLast', 1)])]), songs, ctx)), [])
  assert.deepEqual(ids(evaluate(rule([group([r('lastPlayed', 'notInTheLast', 365)])]), songs, ctx)), ['never'])
})

test('inPlaylist and notInPlaylist rules use list membership, including the love list', () => {
  const songs = [song('a', 'A'), song('b', 'B'), song('c', 'C')]
  const ctx = context({ membership: { a: ['one', 'love'], b: ['two'], c: [] } })
  assert.deepEqual(ids(evaluate(rule([group([r('inPlaylist', 'inPlaylist', 'one')])]), songs, ctx)), ['a'])
  assert.deepEqual(ids(evaluate(rule([group([r('inPlaylist', 'notInPlaylist', 'one')])]), songs, ctx)), ['b', 'c'])
  assert.deepEqual(ids(evaluate(rule([group([r('isLoved', 'is', true)])]), songs, ctx)), ['a'])
  assert.deepEqual(ids(evaluate(rule([group([r('isLoved', 'isNot', true)])]), songs, ctx)), ['b', 'c'])
})

test('groups are ANDed while any=true is OR and any=false is AND inside a group', () => {
  const songs = [
    song('a', 'Alpha', { singer: 'Alice', interval: '01:00' }),
    song('b', 'Beta', { singer: 'Alice', interval: '05:00' }),
    song('c', 'Gamma', { singer: 'Bob', interval: '05:00' }),
    song('d', 'Delta', { singer: 'Bob', interval: '01:00' }),
  ]
  const andGroup = group([r('singer', 'is', 'Alice'), r('interval', 'gt', 120)])
  const orGroup = group([r('name', 'contains', 'alpha'), r('name', 'contains', 'gamma')], true)
  assert.deepEqual(ids(evaluate(rule([andGroup]), songs)), ['b'])
  assert.deepEqual(ids(evaluate(rule([orGroup]), songs)), ['a', 'c'])
  assert.deepEqual(ids(evaluate(rule([andGroup, orGroup]), songs)), [])
  assert.deepEqual(ids(evaluate(rule([orGroup, group([r('singer', 'is', 'Bob')])]), songs)), ['c'])
})

test('empty groups are ignored; a rule with no effective conditions matches nothing', () => {
  const songs = [song('a', 'A'), song('b', 'B')]
  assert.deepEqual(ids(evaluate(rule([]), songs)), [])
  assert.deepEqual(ids(evaluate(rule([group([])]), songs)), [])
  assert.deepEqual(ids(evaluate(rule([group([], true)]), songs)), [])
  assert.deepEqual(ids(evaluate(rule([group([]), group([r('name', 'is', 'A')])]), songs)), ['a'])
})

const ALL = () => group([r('name', 'contains', '')])

test('sort supports name/singer/album/interval/playCount/lastPlayed and both orders', () => {
  const songs = [
    song('a', 'Beta', { singer: 'Zed', album: 'Second', interval: '02:00' }),
    song('b', 'Alpha', { singer: 'Amy', album: 'Third', interval: '03:00' }),
    song('c', 'Gamma', { singer: 'Bob', album: 'First', interval: '01:00' }),
  ]
  const ctx = context({ stats: { a: { count: 2, lastPlayed: NOW - DAY }, b: { count: 5, lastPlayed: NOW - 2 * DAY }, c: { count: 1, lastPlayed: NOW } } })
  assert.deepEqual(ids(evaluate(rule([ALL()], { sort: 'name', order: 'asc' }), songs)), ['b', 'a', 'c'])
  assert.deepEqual(ids(evaluate(rule([ALL()], { sort: 'name', order: 'desc' }), songs)), ['c', 'a', 'b'])
  assert.deepEqual(ids(evaluate(rule([ALL()], { sort: 'singer', order: 'asc' }), songs)), ['b', 'c', 'a'])
  assert.deepEqual(ids(evaluate(rule([ALL()], { sort: 'album', order: 'asc' }), songs)), ['c', 'a', 'b'])
  assert.deepEqual(ids(evaluate(rule([ALL()], { sort: 'interval', order: 'asc' }), songs)), ['c', 'a', 'b'])
  assert.deepEqual(ids(evaluate(rule([ALL()], { sort: 'playCount', order: 'desc' }), songs, ctx)), ['b', 'a', 'c'])
  assert.deepEqual(ids(evaluate(rule([ALL()], { sort: 'lastPlayed', order: 'desc' }), songs, ctx)), ['c', 'a', 'b'])
  assert.deepEqual(ids(evaluate(rule([ALL()], { sort: 'lastPlayed', order: 'asc' }), songs, ctx)), ['b', 'a', 'c'])
})

test('random sort keeps every song and still applies the limit', () => {
  const songs = Array.from({ length: 20 }, (_, index) => song('s' + index, 'Song ' + index))
  const random = evaluate(rule([ALL()], { sort: 'random' }), songs)
  assert.equal(random.length, 20)
  assert.deepEqual([...ids(random)].sort(), [...ids(songs)].sort())
  const limited = evaluate(rule([ALL()], { sort: 'random', limit: 3 }), songs)
  assert.equal(limited.length, 3)
  assert.equal(new Set(ids(limited)).size, 3)
})

test('limit is applied after sorting and 0 means unlimited', () => {
  const songs = [song('c', 'C'), song('a', 'A'), song('b', 'B')]
  assert.deepEqual(ids(evaluate(rule([ALL()], { sort: 'name', limit: 2 }), songs)), ['a', 'b'])
  assert.deepEqual(ids(evaluate(rule([ALL()], { sort: 'name', limit: 0 }), songs)), ['a', 'b', 'c'])
  assert.deepEqual(ids(evaluate(rule([ALL()], { sort: 'name', limit: 99 }), songs)), ['a', 'b', 'c'])
})

test('evaluation does not mutate the input songs or the rule object', () => {
  const songs = [song('b', 'B'), song('a', 'A')]
  const snapshot = JSON.parse(JSON.stringify(songs))
  const input = rule([group([r('name', 'contains', '')])], { sort: 'name', limit: 1 })
  const inputSnapshot = JSON.parse(JSON.stringify(input))
  evaluate(input, songs)
  assert.deepEqual(songs, snapshot)
  assert.deepEqual(input, inputSnapshot)
})

test('unknown play stats and memberships are treated as zero and empty', () => {
  const songs = [song('a', 'A'), song('b', 'B')]
  assert.deepEqual(ids(evaluate(rule([group([r('playCount', 'lt', 1)])]), songs, context())), ['a', 'b'])
  assert.deepEqual(ids(evaluate(rule([group([r('inPlaylist', 'inPlaylist', 'one')])]), songs, context())), [])
})

test('stable sorting keeps input order for equal values', () => {
  const songs = [song('b', 'Same', { singer: 'X' }), song('a', 'Same', { singer: 'X' })]
  assert.deepEqual(ids(evaluate(rule([ALL()], { sort: 'name' }), songs)), ['b', 'a'])
})
