const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')
const flush = () => new Promise(setImmediate)
const makeTask = () => ({ id: 'download', isComplate: true, status: 'completed', metadata: { filePath: 'C:/old/song.mp3', fileName: 'song.mp3' } })

test('file lookup waits for filesystem results and tries current download folders', async() => {
  const checked = []
  const files = new Set([path.join('C:/downloads', 'song.mp3')])
  const helper = loader({
    '@renderer/store/download/action': {},
    '@renderer/store/download/utils': { buildSavePath: () => 'C:/downloads/group' },
    '@renderer/store/setting': { appSetting: { 'download.savePath': 'C:/downloads' } },
    '@common/utils/nodejs': { joinPath: path.join, getFileStats: async filename => { checked.push(filename); return files.has(filename) ? { isFile: () => true } : null } },
  })('src/renderer/utils/downloadFiles.ts')
  assert.equal(await helper.findDownloadFile(makeTask()), path.join('C:/downloads', 'song.mp3'))
  assert.deepEqual(checked, ['C:/old/song.mp3', path.join('C:/downloads/group', 'song.mp3'), path.join('C:/downloads', 'song.mp3')])
  files.clear()
  assert.equal(await helper.findDownloadFile(makeTask()), '')
})

function uiFixture(t, confirm = true, canceled = false) {
  const previous = global.window
  t.after(() => { global.window = previous })
  global.window = { i18n: { t: key => key } }
  const task = makeTask(); const opened = []; const located = []; const notices = []
  let resolveLookup
  const dialog = async value => { notices.push(value) }
  dialog.error = dialog
  dialog.confirm = async value => { notices.push(value); return confirm }
  const actions = loader({
    '@common/utils/vueRouter': { useRouter: () => ({}) },
    '@renderer/utils/musicSdk': {},
    '@common/utils/electron': {},
    '@renderer/utils/index': {},
    '@renderer/plugins/Dialog': { dialog },
    '@renderer/utils/downloadFiles': { findDownloadFile: () => new Promise(resolve => { resolveLookup = resolve }) },
    '@renderer/store/download/action': { relocateDownloadTask: async(id, filename) => { located.push([id, filename]); return true } },
    '@renderer/utils/ipc': { openDirInExplorer: async filename => opened.push(filename), showSelectDialog: async() => ({ canceled, filePaths: ['C:/moved/song.mp3'] }) },
  })('src/renderer/views/Download/useTaskActions.js').default({ list: { value: [task] } })
  return { actions, opened, located, notices, resolve: value => resolveLookup(value) }
}

test('opening a missing completed download waits for the check and offers relocation', async t => {
  const f = uiFixture(t)
  const action = f.actions.handleOpenFile(0)
  await flush()
  assert.deepEqual(f.opened, [])
  f.resolve('')
  await action
  assert.equal(f.notices[0].confirmButtonText, 'download__relocate')
  assert.deepEqual(f.located, [['download', 'C:/moved/song.mp3']])
  assert.deepEqual(f.opened, ['C:/moved/song.mp3'])
})

for (const canceled of [false, true]) {
  test(`canceling the ${canceled ? 'file picker' : 'relocation prompt'} does not open a nonexistent path`, async t => {
    const f = uiFixture(t, canceled, canceled)
    const action = f.actions.handleOpenFile(0)
    f.resolve('')
    await action
    assert.deepEqual(f.opened, [])
    assert.deepEqual(f.located, [])
  })
}

test('an existing download opens its verified path without prompting', async t => {
  const f = uiFixture(t)
  const action = f.actions.handleOpenFile(0)
  f.resolve('C:/downloads/song.mp3')
  await action
  assert.deepEqual(f.opened, ['C:/downloads/song.mp3'])
  assert.deepEqual(f.notices, [])
})

test('relocation persists the new path, preserves it on write failure and rejects invalid files', async t => {
  const previous = global.window
  t.after(() => { global.window = previous })
  global.window = { i18n: { t: key => key }, app_event: { downloadListUpdate() {} } }
  const task = makeTask(); const saved = []
  let failWrite = false
  const actions = loader({
    '@renderer/utils/ipc': { downloadTasksUpdate: async tasks => { if (failWrite) throw Error('Disk full'); saved.push(...structuredClone(tasks)) } },
    './state': { downloadList: [task] },
    '@common/utils/vueTools': { markRaw: value => value, toRaw: value => value },
    '@renderer/core/music/online': {},
    '../setting': { appSetting: {} },
    '..': {},
    '@renderer/worker/utils': {},
    '@renderer/utils': {},
    '@common/constants': { DOWNLOAD_STATUS: {} },
    '../index': {},
    './utils': {},
    '@renderer/plugins/Toast': () => {},
    '@common/utils/nodejs': { getFileStats: async filename => filename.includes('missing') ? null : { size: filename.includes('empty') ? 0 : 20, isFile: () => true } },
  })('src/renderer/store/download/action.ts')
  assert.equal(await actions.relocateDownloadTask(task.id, 'C:/moved/song.mp3'), true)
  assert.equal(saved[0].metadata.filePath, 'C:/moved/song.mp3')
  assert.equal(task.metadata.filePath, 'C:/moved/song.mp3')
  failWrite = true
  await assert.rejects(actions.relocateDownloadTask(task.id, 'C:/another/song.mp3'), /Disk full/)
  assert.equal(task.metadata.filePath, 'C:/moved/song.mp3')
  for (const filename of ['C:/missing.mp3', 'C:/empty.mp3', 'C:/document.txt']) {
    assert.equal(await actions.relocateDownloadTask(task.id, filename), false)
  }
  assert.equal(await actions.relocateDownloadTask('deleted-task', 'C:/moved/song.mp3'), false)
})
