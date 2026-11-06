const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/store/list/listManage/rendererListManage.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
function fixture(read) {
  const cache = new Map()
  const listeners = new Map()
  const exports = {}
  const actions = {
    setMusicList: (id, songs) => { cache.set(id, songs); return songs },
    listMusicOverwrite: (id, songs) => { cache.set(id, songs); return [id] },
    listMusicAdd: (id, songs) => { if (cache.has(id)) cache.get(id).push(...songs); return [id] },
  }
  const modules = {
    '@common/utils/vueTools': { toRaw: value => value, ref: value => ({ value }) },
    '@common/rendererIpc': { rendererInvoke: (_channel, id) => read(id), rendererOn: (name, fn) => listeners.set(name, fn), rendererOff: () => {} },
    '@common/ipcNames': { PLAYER_EVENT_NAME: new Proxy({}, { get: (_target, key) => key }) },
    './action': actions,
    './state': { allMusicList: cache, userLists: [] },
    '../localMutationLock': { withLocalListLocks: async(_ids, task) => task() },
    '../recycleBin': { deleteWithUndo: task => task() },
  }
  vm.runInNewContext(compiled, { exports, require: name => { assert.ok(name in modules, name); return modules[name] } })
  exports.registerListAction({ 'list.addMusicLocationType': 'bottom' })
  return { ...exports, emit: (name, params) => listeners.get(name)({ params }) }
}

test('simultaneous playlist loads share one read, including an empty playlist', async() => {
  const read = deferred()
  let calls = 0
  const list = fixture(() => { calls++; return read.promise })
  const first = list.getListMusics('a')
  const second = list.getListMusics('a')
  read.resolve([])
  assert.equal(await first, await second)
  assert.equal(await list.getListMusics('a'), await first)
  assert.equal(calls, 1)
})

test('a failed local read can be retried', async() => {
  let calls = 0
  const list = fixture(async() => { if (++calls === 1) throw new Error('temporary read error'); return [{ id: 'song' }] })
  await assert.rejects(list.getListMusics('a'), /temporary read error/)
  assert.equal((await list.getListMusics('a'))[0].id, 'song')
  assert.equal(calls, 2)
})

test('an overwrite arriving during a read wins over the old response', async() => {
  const read = deferred()
  const list = fixture(() => read.promise)
  const pending = list.getListMusics('a')
  const updated = [{ id: 'new' }]
  list.emit('list_music_overwrite', { listId: 'a', musicInfos: updated })
  read.resolve([{ id: 'old' }])
  assert.equal(await pending, updated)
  assert.equal(await list.getListMusics('a'), updated)
})

test('an edit before a list is cached re-reads current local data', async() => {
  const read = deferred()
  let calls = 0
  const current = [{ id: 'existing' }, { id: 'added' }]
  const list = fixture(() => ++calls === 1 ? read.promise : Promise.resolve(current))
  const pending = list.getListMusics('a')
  list.emit('list_music_add', { id: 'a', musicInfos: [current[1]], addMusicLocationType: 'bottom' })
  read.resolve([current[0]])
  assert.equal(await pending, current)
  assert.equal(calls, 2)
})
