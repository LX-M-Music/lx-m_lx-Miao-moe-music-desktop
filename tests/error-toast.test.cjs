const assert = require('node:assert/strict')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

test('error toasts respect the setting without hiding ordinary notices', t => {
  const previousWindow = global.window
  const previousDocument = global.document
  t.after(() => { global.window = previousWindow; global.document = previousDocument })
  global.window = { lxData: { appSetting: { 'common.showErrorDialog': false } } }
  global.document = { createElement: () => ({}), body: { appendChild() {} } }
  let mounts = 0
  const showToast = loader({
    './Toast.vue': {},
    vue: { createApp: () => ({ mount: () => { mounts++; return { $el: {}, visible: false } }, unmount() {} }) },
  })('src/renderer/plugins/Toast/index.js').default

  showToast('hidden error', { error: true })
  assert.equal(mounts, 0)
  showToast('ordinary notice').cancel()
  assert.equal(mounts, 1)
  global.window.lxData.appSetting['common.showErrorDialog'] = true
  showToast('visible error', { error: true }).cancel()
  assert.equal(mounts, 2)
})
