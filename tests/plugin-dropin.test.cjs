const assert = require('node:assert/strict')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

test('drop-in plugins import only when missing or newer, and unchanged files are skipped', () => {
  const { shouldImportDropInPackage, isDropInRecordCurrent } = loader()('src/main/modules/optionalPlugins/dropIn.ts')

  assert.equal(shouldImportDropInPackage(null, '1.0.0'), true, 'a new plugin is installed')
  assert.equal(shouldImportDropInPackage(null, '1.0.0'), true, 'a broken installation is repaired')
  assert.equal(shouldImportDropInPackage('1.0.0', '1.0.0'), false, 'the same version is not reinstalled')
  assert.equal(shouldImportDropInPackage('1.0.0', '1.0.1'), true, 'a newer package updates the plugin')
  assert.equal(shouldImportDropInPackage('1.2.0', '1.1.9'), false, 'an older package never downgrades')
  assert.equal(shouldImportDropInPackage('2.0.0', '2.0.0-beta.1'), false)

  const file = { size: 120, mtimeMs: 1700000000000 }
  assert.equal(isDropInRecordCurrent({ ...file, sha256: 'a' }, file), true)
  assert.equal(isDropInRecordCurrent({ ...file, mtimeMs: file.mtimeMs + 1, sha256: 'a' }, file), false)
  assert.equal(isDropInRecordCurrent({ ...file, size: 121, sha256: 'a' }, file), false)
  assert.equal(isDropInRecordCurrent(undefined, file), false)
})
