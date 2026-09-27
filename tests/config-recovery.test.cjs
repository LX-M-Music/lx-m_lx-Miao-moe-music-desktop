const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

function fixture(t, contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-config-recovery-'))
  const previous = global.lxDataPath
  const previousLx = global.lx
  global.lxDataPath = root
  global.lx = { appSetting: { 'common.showErrorDialog': true } }
  const alerts = []
  const module = loader({
    electron: { dialog: { showMessageBoxSync: value => alerts.push(value) }, shell: { showItemInFolder() {} } },
    'node:path': path,
    'node:fs': fs,
    '@common/utils': { log: { error() {} } },
  })('src/main/utils/store.ts')
  const filename = path.join(root, 'settings.json')
  fs.writeFileSync(filename, contents)
  t.after(() => {
    global.lxDataPath = previous
    global.lx = previousLx
    assert(path.resolve(root).startsWith(path.join(os.tmpdir(), 'lx-config-recovery-')))
    fs.rmSync(root, { recursive: true, force: true })
  })
  return { ...module, filename, alerts }
}

for (const contents of ['null', '[]', '42', 'true', '"text"', '{invalid']) {
  test(`invalid configuration ${contents} is backed up and replaced by a usable cached store`, async t => {
    const f = fixture(t, contents)
    const store = f.default('settings')
    assert.equal(fs.readFileSync(f.filename + '.bak', 'utf8'), contents)
    assert.equal(store.has('volume'), false)
    await store.set('volume', 0.5)
    assert.equal(f.default('settings'), store)
    assert.deepEqual(JSON.parse(fs.readFileSync(f.filename, 'utf8')), { volume: 0.5 })
    assert.equal(f.alerts.length, 1)
  })
}

test('invalid configuration still recovers without an error dialog when disabled', t => {
  const f = fixture(t, 'null')
  global.lx.appSetting['common.showErrorDialog'] = false
  f.default('settings')
  assert.equal(fs.readFileSync(f.filename + '.bak', 'utf8'), 'null')
  assert.equal(f.alerts.length, 0)
})

test('strict loading does not change an invalid config and valid objects do not trigger recovery', t => {
  const f = fixture(t, 'null')
  assert.throws(() => f.default('settings', false), /parse data error/)
  assert.equal(fs.readFileSync(f.filename, 'utf8'), 'null')
  assert.equal(fs.existsSync(f.filename + '.bak'), false)
  fs.writeFileSync(f.filename, '{"theme":"light"}')
  const store = f.default('settings')
  assert.equal(store.get('theme'), 'light')
  assert.throws(() => store.override(null), /must be an object/)
  assert.throws(() => store.override([]), /must be an object/)
  assert.equal(store.get('theme'), 'light')
  assert.equal(f.alerts.length, 0)
})
