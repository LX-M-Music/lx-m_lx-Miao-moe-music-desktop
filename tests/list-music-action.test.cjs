const assert = require('node:assert/strict')
const { test } = require('node:test')
const vue = require('vue')
const loader = require('./helpers/load-typescript.cjs')

const song = { id: 'wy_history_action', name: 'History song', singer: 'Fixture artist', source: 'wy', interval: '03:00', meta: { songId: 'history_action', albumName: 'Fixture album', qualitys: [{ type: '128k', size: '3 MB' }], _qualitys: { '128k': { type: '128k', size: '3 MB' } } } }
const fixture = () => {
  const writes = []
  const capture = method => async data => { writes.push({ method, data: structuredClone(data) }) }
  const actions = loader({
    '@common/utils/vueTools': vue,
    '@renderer/store/setting': { appSetting: { 'list.addMusicLocationType': 'bottom' } },
    './state': { userLists: [] },
    '@renderer/store/list/listManage': { addListMusics: capture('add'), moveListMusics: capture('move'), createUserList: capture('create') },
  })('src/renderer/store/list/action.ts')
  return { writes, actions }
}

test('adding a raw array of reactive history songs produces a cloneable IPC payload', async() => {
  const { writes, actions } = fixture()
  const history = vue.ref({ rows: [{ song }] })
  const selected = [history.value.rows[0].song]
  assert.throws(() => structuredClone(vue.toRaw(selected)), { name: 'DataCloneError' })
  await actions.addListMusics('default', selected, 'top')
  assert.deepEqual(writes, [{ method: 'add', data: { id: 'default', musicInfos: [song], addMusicLocationType: 'top' } }])
})

test('moving selected reactive songs preserves their metadata in the IPC payload', async() => {
  const { writes, actions } = fixture()
  const selected = vue.ref([song])
  await actions.moveListMusics('default', 'love', selected.value)
  assert.deepEqual(writes, [{ method: 'move', data: { fromId: 'default', toId: 'love', musicInfos: [song], addMusicLocationType: 'bottom' } }])
})

test('creating a playlist with reactive songs writes cloneable song data after creation', async() => {
  const { writes, actions } = fixture()
  const selected = vue.ref([song])
  await actions.createUserList({ id: 'history-new-list', name: 'History playlist', list: selected.value })
  assert.equal(writes[0].method, 'create')
  assert.equal(writes[0].data.listInfos[0].id, 'history-new-list')
  assert.deepEqual(writes[1], { method: 'add', data: { id: 'history-new-list', musicInfos: [song], addMusicLocationType: 'bottom' } })
})
