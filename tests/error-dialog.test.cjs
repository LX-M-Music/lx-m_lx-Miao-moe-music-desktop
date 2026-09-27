const assert = require('node:assert/strict')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

test('error dialogs respect the saved setting while ordinary dialogs remain available', async t => {
  const previousWindow = global.window
  const previousDocument = global.document
  t.after(() => { global.window = previousWindow; global.document = previousDocument })
  let instance
  let mounts = 0
  global.window = { lxData: { appSetting: { 'common.showErrorDialog': false } } }
  global.document = {
    createElement: () => ({}),
    getElementById: () => ({ appendChild() {} }),
  }
  const { dialog } = loader({
    './Dialog.vue': {},
    vue: { createApp: () => ({ mount: () => { mounts++; return (instance = { $el: {} }) }, unmount() {} }) },
  })('src/renderer/plugins/Dialog/index.js')

  assert.equal(await dialog.error('hidden failure'), false)
  assert.equal(mounts, 0)

  global.window.lxData.appSetting['common.showErrorDialog'] = true
  const errorResult = dialog.error('visible failure')
  assert.equal(instance.message, 'visible failure')
  instance.handleComfirm()
  assert.equal(await errorResult, true)

  global.window.lxData.appSetting['common.showErrorDialog'] = false
  const ordinaryResult = dialog('ordinary notice')
  assert.equal(instance.message, 'ordinary notice')
  instance.handleComfirm()
  assert.equal(await ordinaryResult, true)
})
