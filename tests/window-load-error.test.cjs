const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { test } = require('node:test')
const createLoader = require('./helpers/load-typescript.cjs')

test('a failed main document exposes Chromium code and reason with reload; cancelled and subframe loads stay quiet', async() => {
  const previous = global.lx
  global.lx = { appSetting: { 'common.showErrorDialog': true } }
  try {
  const webContents = new EventEmitter(), dialogs = []
  let reloads = 0, finish
  webContents.reload = () => { reloads++ }
  const window = { webContents, isDestroyed: () => false }
  const { observeWindowLoadErrors } = createLoader({ electron: { dialog: { showMessageBox: (_window, options) => {
    dialogs.push(options)
    return new Promise(resolve => { finish = resolve })
  } } } })('src/main/utils/windowLoadError.ts')
  observeWindowLoadErrors(window)
  webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', '', true)
  webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', '', false)
  assert.equal(dialogs.length, 0)
  webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', '', true)
  webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', '', true)
  assert.equal(dialogs.length, 1)
  assert.match(dialogs[0].message, /CHROMIUM_-6/)
  assert.match(dialogs[0].message, /ERR_FILE_NOT_FOUND/)
  finish({ response: 0 })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reloads, 1)
  webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', '', true)
  finish({ response: 1 })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reloads, 1)
  } finally { global.lx = previous }
})

test('main document failures do not open a dialog when error dialogs are disabled', () => {
  const previous = global.lx
  global.lx = { appSetting: { 'common.showErrorDialog': false } }
  try {
    const webContents = new EventEmitter()
    const window = { webContents, isDestroyed: () => false }
    let dialogs = 0
    const { observeWindowLoadErrors } = createLoader({ electron: { dialog: { showMessageBox: () => { dialogs++; return Promise.resolve({ response: 1 }) } } } })('src/main/utils/windowLoadError.ts')
    observeWindowLoadErrors(window)
    webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', '', true)
    assert.equal(dialogs, 0)
  } finally { global.lx = previous }
})
