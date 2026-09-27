const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { test } = require('node:test')
for (const scenario of ['success', 'file-failure', 'db-failure', 'begin-failure', 'crash-before-commit', 'crash-after-commit', 'rollback-retry', 'rollback-cleanup', 'webdav-success', 'webdav-private', 'webdav-file-failure', 'webdav-db-failure', 'webdav-revision']) {
  test('D04/F03: SQLite and file transaction ' + scenario, () => {
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/backup-transaction-fixture.cjs'), scenario], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8', timeout: 15000,
    })
    assert.equal(result.status, 0, result.stdout + result.stderr + (result.error?.message ?? ''))
    assert(result.stdout.includes('PASS ' + scenario))
  })
}
