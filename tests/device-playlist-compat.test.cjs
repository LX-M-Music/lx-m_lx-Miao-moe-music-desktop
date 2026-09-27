const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { setImmediate: tick } = require('node:timers/promises')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

const privateIds = ['wy', 'tx', 'kg', 'kw', 'mg'].map(source => `userlist_${source}_sync_remote`)
const song = id => ({ id, name: id, singer: 'Singer', source: 'wy', meta: { songId: id } })
const list = (id, tracks = []) => ({ id, name: id, locationUpdateTime: null, list: tracks })

function fixture(t) {
  const previous = global.lx
  const state = {
    defaultList: [song('trial')], loveList: [song('favorite')],
    userList: [list('public-a', [song('a')]), list(privateIds[0], [song('secret')]), list('public-b', [song('b')]), ...privateIds.slice(1).map(id => list(id))],
  }
  const events = new EventEmitter()
  const calls = []
  const reads = []
  const capture = name => async(...args) => { calls.push({ name, args }); return undefined }
  for (const name of ['list_create', 'list_remove', 'list_update', 'list_update_position', 'list_music_add', 'list_music_move', 'list_music_remove', 'list_music_update', 'list_music_update_position', 'list_music_overwrite', 'list_music_clear']) events[name] = capture(name)
  events.list_data_overwrite = async(data, isRemote) => {
    calls.push({ name: 'list_data_overwrite', args: [data, isRemote] })
    Object.assign(state, structuredClone(data))
  }
  global.lx = {
    worker: { dbService: {
      getListMusics: async id => { reads.push(id); return id === 'default' ? state.defaultList : id === 'love' ? state.loveList : state.userList.find(item => item.id === id)?.list ?? [] },
      getAllUserList: async() => state.userList.map(({ list: tracks, ...info }) => info),
    } },
    event_list: events,
  }
  t.after(() => { global.lx = previous })
  const load = loader({ '@common/constants': { LIST_IDS: { DEFAULT: 'default', LOVE: 'love', TEMP: 'temp' } } })
  return { state, events, calls, reads, sync: load('src/main/modules/sync/listEvent.ts') }
}

test('all five Cookie playlist IDs remain local while original-format public playlists round trip', async t => {
  const { state, calls, reads, sync } = fixture(t)
  const shared = await sync.getLocalListData()
  assert.equal(reads.some(id => privateIds.includes(id)), false, 'public snapshots must not fetch private music')
  assert.deepEqual(shared.userList.map(item => item.id), ['public-a', 'public-b'])
  assert.deepEqual(shared.defaultList.map(item => item.id), ['trial'])
  assert.deepEqual(shared.loveList.map(item => item.id), ['favorite'])
  assert.deepEqual(Object.keys(shared), ['defaultList', 'loveList', 'userList'])

  const incoming = { defaultList: [song('other-trial')], loveList: [], userList: [list('public-c', [song('c')]), list(privateIds[0], [song('remote-secret')])] }
  await sync.setLocalListData(incoming)
  assert.deepEqual(state.userList.map(item => item.id), ['public-c', ...privateIds])
  assert.equal(state.userList.find(item => item.id === privateIds[0]).list[0].id, 'secret')
  assert.equal(calls.at(-1).args[1], true)
  assert.deepEqual((await sync.getLocalListData()).userList.map(item => item.id), ['public-c'])
})

test('incremental actions omit private lists and use public list positions', async t => {
  const { state, events, sync } = fixture(t)
  const sent = []
  const stop = sync.registerListActionEvent(action => { sent.push(action) })
  events.emit('list_create', 1, [{ id: privateIds[0], name: 'Cookie' }], false)
  events.emit('list_music_add', privateIds[0], [song('secret')], 'bottom', false)
  events.emit('list_music_overwrite', privateIds[0], [song('secret')], false)
  events.emit('list_music_update', [{ id: privateIds[0], musicInfo: song('secret') }], false)
  await tick()
  assert.equal(sent.length, 0)

  events.emit('list_data_overwrite', structuredClone(state), false)
  await tick()
  assert.deepEqual(sent.at(-1).data.userList.map(item => item.id), ['public-a', 'public-b'])
  sent.length = 0
  events.emit('list_create', 2, [{ id: 'public-b', name: 'B' }], false)
  events.emit('list_update_position', 2, ['public-b'], false)
  await tick()
  assert.deepEqual(sent.map(item => item.data.position), [1, 1])

  sent.length = 0
  events.emit('list_music_move', privateIds[0], 'public-a', [song('copied')], 'bottom', false)
  events.emit('list_music_move', 'public-a', privateIds[0], [song('removed')], 'bottom', false)
  await tick()
  assert.deepEqual(sent.map(item => item.action), ['list_music_add', 'list_music_remove'])
  assert.equal(JSON.stringify(sent).includes(privateIds[0]), false)
  stop()
})

test('incoming original/mobile actions skip private IDs and map public positions around them', async t => {
  const { state, calls, sync } = fixture(t)
  assert.equal(await sync.handleRemoteListAction({ action: 'list_remove', data: [privateIds[0]] }), null)
  assert.equal(calls.length, 0)
  const created = await sync.handleRemoteListAction({ action: 'list_create', data: { position: 1, listInfos: [{ id: 'public-c', name: 'C', locationUpdateTime: null }] } })
  assert.equal(created.data.position, 1, 'the broadcast retains the public wire position')
  assert.deepEqual(calls.at(-1).args.slice(0, 2).map((value, index) => index === 0 ? value : value.map(item => item.id)), [2, ['public-c']])

  state.userList = [list(privateIds[0]), list('public-a'), list(privateIds[1]), list('public-b')]
  await sync.handleRemoteListAction({ action: 'list_update_position', data: { position: 0, ids: ['public-b'] } })
  assert.equal(calls.at(-1).args[0], 1)
  assert.deepEqual(calls.at(-1).args[1], ['public-b'])

  const mixed = await sync.handleRemoteListAction({ action: 'list_music_update', data: [{ id: privateIds[0], musicInfo: song('secret') }, { id: 'public-a', musicInfo: song('a') }] })
  assert.deepEqual(mixed.data.map(item => item.id), ['public-a'])
  assert.deepEqual(calls.at(-1).args[0].map(item => item.id), ['public-a'])
})

test('public create reaches the other device before its immediately following music update', async t => {
  const { state, events, sync } = fixture(t)
  const sent = []
  const originalRead = global.lx.worker.dbService.getAllUserList
  let release
  global.lx.worker.dbService.getAllUserList = () => new Promise(resolve => { release = async() => resolve(await originalRead()) })
  const stop = sync.registerListActionEvent(action => { sent.push(action.action) })
  events.emit('list_create', 2, [{ id: 'public-b', name: 'B' }], false)
  events.emit('list_music_add', 'public-b', [song('new')], 'bottom', false)
  await tick()
  assert.deepEqual(sent, [])
  await release()
  await tick()
  assert.deepEqual(sent, ['list_create', 'list_music_add'])
  stop()
  assert(state.userList.some(item => item.id === 'public-b'))
})

test('first device sync removes private playlists left on an older peer', async() => {
  const local = { defaultList: [], loveList: [], userList: [] }
  const remote = { defaultList: [], loveList: [], userList: [list(privateIds[0], [song('old-leak')])] }
  const writes = []
  const listManage = {
    getCurrentListInfoKey: async() => 'shared-key',
    updateDeviceSnapshotKey: async() => {},
    createSnapshot: async() => 'shared-key',
  }
  const load = loader({
    '@main/modules/winMain': { removeSelectModeListener() {}, sendCloseSelectMode() {}, sendSelectMode(_name, _module, choose) { choose('overwrite_remote_local_full') } },
    '../../../user': { getUserSpace: () => ({ listManage }), getUserConfig: () => ({ 'list.addMusicLocationType': 'bottom' }) },
    '@main/modules/sync/listEvent': { buildUserListInfoFull: value => value, getLocalListData: async() => local, setLocalListData: async value => writes.push({ local: value }) },
    '@common/constants_sync': { SYNC_CLOSE_CODE: { failed: 4000 } },
  })
  const socket = {
    feature: { list: { skipSnapshot: true } }, userInfo: { name: 'owner' }, keyInfo: { clientId: 'peer' }, moduleReadys: { list: false },
    onClose: () => () => {}, broadcast() {},
    remoteQueueList: {
      list_sync_get_list_data: async() => remote,
      list_sync_set_list_data: async value => { writes.push({ remote: value }) },
      list_sync_finished: async() => {},
    },
  }
  await load('src/main/modules/sync/server/modules/list/sync/sync.ts').sync(socket)
  assert.deepEqual(writes, [{ remote: { defaultList: [], loveList: [], userList: [] } }])
  assert.equal(socket.moduleReadys.list, true)

  writes.length = 0
  local.userList.push(list('public-local'))
  remote.userList.push(list('public-remote'))
  socket.moduleReadys.list = false
  await load('src/main/modules/sync/server/modules/list/sync/sync.ts').sync(socket)
  assert.deepEqual(writes.map(item => Object.keys(item)[0]), ['local', 'remote'])
  assert.deepEqual(writes[0].local.userList.map(item => item.id), ['public-remote'])
  assert.deepEqual(writes[1].remote.userList.map(item => item.id), ['public-remote'])
})
