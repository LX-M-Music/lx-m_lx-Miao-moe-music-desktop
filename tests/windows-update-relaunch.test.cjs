const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { after, before, test } = require('node:test')
const { csc, compileProbe, sha256, safeRemove } = require('./helpers/windows-update-fixture.cjs')
const { UPDATE_RELAUNCH_SCRIPT } = require('./helpers/load-typescript.cjs')()('src/main/modules/winMain/updateRelaunchScript.ts')
const windows = process.platform === 'win32' && fs.existsSync(csc)
let probes
before(() => {
  if (!windows) return
  probes = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-update-probes-'))
  for (const mode of ['old', 'confirm', 'fail', 'noack', 'badack']) compileProbe(probes, mode)
})
after(async() => { if (probes) await safeRemove(probes, 'lx-update-probes-') })

async function waitFile(file, predicate = () => true) {
  for (let i = 0; i < 600; i++) {
    try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); if (predicate(value)) return value } catch {}
    await delay(25)
  }
  throw Error('Timed out waiting for ' + file)
}

function fixture(t, kind = 'portable', mode = 'confirm') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lx-update-app-中文 & user's "))
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-m-update-'))
  const stage = path.join(tempRoot, 'app')
  fs.mkdirSync(stage)
  const basename = '我改过名的播放器.exe'
  const executable = path.join(root, basename)
  fs.copyFileSync(path.join(probes, 'old.exe'), executable)
  const bytes = fs.readFileSync(path.join(probes, mode + '.exe'))
  fs.writeFileSync(path.join(stage, 'update.exe'), bytes)
  fs.mkdirSync(path.join(root, 'portable/userData'), { recursive: true })
  fs.writeFileSync(path.join(root, 'portable/userData/music.db'), 'user music database')
  fs.writeFileSync(path.join(root, 'notes.txt'), 'my extra file')
  fs.mkdirSync(path.join(root, 'resources'))
  fs.writeFileSync(path.join(root, 'resources/obsolete.dll'), 'obsolete program')
  fs.writeFileSync(path.join(root, 'resources/changed.dll'), 'locally edited program')
  const oldProcess = spawn(process.execPath, ['-e', 'process.stdin.resume()'], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] })
  let helper
  let helperOutput = ''
  t.after(async() => {
    if (oldProcess.exitCode === null) oldProcess.kill()
    if (helper?.exitCode === null) helper.kill()
    for (const file of fs.readdirSync(root).filter(name => /^started-.*\.json$/.test(name))) {
      const marker = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
      assert.equal(path.dirname(marker.executable), root)
      try { process.kill(marker.pid) } catch {}
    }
    await delay(200)
    await safeRemove(root, 'lx-update-app-')
    await safeRemove(tempRoot, 'lx-m-update-')
  })
  const plan = {
    schema: 1, nonce: crypto.randomUUID(), oldPid: oldProcess.pid, version: '9.0.0', kind, root, executable, stage,
    files: [{ path: basename, source: 'update.exe', size: bytes.length, sha256: sha256(bytes) }],
    obsolete: kind === 'portable' ? [
      { path: 'resources/obsolete.dll', sha256: sha256(Buffer.from('obsolete program')) },
      { path: 'resources/changed.dll', sha256: sha256(Buffer.from('original program')) },
    ] : [],
    confirmationTimeoutMs: 1000,
  }
  const planFile = path.join(tempRoot, 'relaunch.json')
  return {
    root, tempRoot, stage, executable, planFile, plan, oldProcess, bytes,
    start() {
      fs.writeFileSync(planFile, JSON.stringify(plan))
      const script = path.join(tempRoot, 'relaunch.ps1')
      fs.writeFileSync(script, UPDATE_RELAUNCH_SCRIPT)
      helper = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-PlanFile', planFile,
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORTABLE_EXECUTABLE_FILE: 'stale outer launcher.exe' } })
      helper.stdout.on('data', bytes => { helperOutput += bytes })
      helper.stderr.on('data', bytes => { helperOutput += bytes })
      return helper
    },
    ready: () => waitFile(planFile + '.ready'),
    async result() { try { return await waitFile(planFile + '.result') } catch (error) { throw Error(error.message + '\nHelper: ' + helper.exitCode + ' ' + helperOutput) } },
    async exitOld() { oldProcess.kill(); for (let i = 0; oldProcess.exitCode === null && oldProcess.signalCode === null && i < 100; i++) await delay(10) },
  }
}

for (const kind of ['portable', 'single-file']) test('native helper waits, replaces and restarts the original renamed ' + kind + ' application', { skip: !windows, timeout: 30000 }, async(t) => {
  const f = fixture(t, kind)
  const original = fs.readFileSync(f.executable)
  f.start()
  await f.ready()
  await delay(150)
  assert.deepEqual(fs.readFileSync(f.executable), original)
  assert(!fs.existsSync(path.join(f.root, 'started-confirm.json')))
  await f.exitOld()
  assert.equal((await f.result()).status, 'complete')
  const marker = await waitFile(path.join(f.root, 'started-confirm.json'))
  assert.equal(marker.executable, f.executable)
  assert.equal(fs.realpathSync.native(marker.cwd), fs.realpathSync.native(f.root))
  assert.equal(marker.portable, null, 'inherited portable launcher variables must be cleared')
  assert.deepEqual(fs.readFileSync(f.executable), f.bytes)
  assert.equal(fs.readFileSync(path.join(f.root, 'portable/userData/music.db'), 'utf8'), 'user music database')
  assert.equal(fs.readFileSync(path.join(f.root, 'notes.txt'), 'utf8'), 'my extra file')
  assert.equal(fs.existsSync(path.join(f.root, 'resources/obsolete.dll')), kind === 'single-file')
  assert.equal(fs.readFileSync(path.join(f.root, 'resources/changed.dll'), 'utf8'), 'locally edited program')
  for (let i = 0; fs.existsSync(f.stage) && i < 100; i++) await delay(25)
  assert(!fs.existsSync(f.stage), JSON.stringify(await f.result()))
  assert(!fs.existsSync(path.join(f.root, '.lx-m-update-backup-' + f.plan.nonce)))
})

test('failed new process rolls back all program files and relaunches the previous application', { skip: !windows, timeout: 30000 }, async(t) => {
  const f = fixture(t, 'portable', 'fail')
  const original = fs.readFileSync(f.executable)
  f.start(); await f.ready(); await f.exitOld()
  const result = await f.result()
  assert.equal(result.status, 'error')
  assert.match(result.message, /exited before startup confirmation/)
  assert.deepEqual(fs.readFileSync(f.executable), original)
  assert.equal(fs.readFileSync(path.join(f.root, 'resources/obsolete.dll'), 'utf8'), 'obsolete program')
  assert.equal((await waitFile(path.join(f.root, 'started-old.json'))).executable, f.executable)
})

test('a cancelled restart launch cannot change program files when the old app later exits', { skip: !windows, timeout: 30000 }, async(t) => {
  const f = fixture(t)
  const original = fs.readFileSync(f.executable)
  f.start(); await f.ready()
  fs.writeFileSync(f.planFile + '.cancel-' + f.plan.nonce, '')
  const result = await f.result()
  assert.equal(result.status, 'error')
  assert.match(result.message, /cancelled/)
  await f.exitOld()
  assert.deepEqual(fs.readFileSync(f.executable), original)
  assert(!fs.existsSync(path.join(f.root, 'started-confirm.json')))
})

for (const mode of ['noack', 'badack']) test('a running new process with ' + mode + ' keeps its backup without unsafe rollback', { skip: !windows, timeout: 30000 }, async(t) => {
  const f = fixture(t, 'single-file', mode)
  f.start(); await f.ready(); await f.exitOld()
  assert.equal((await f.result()).status, 'pending')
  assert.deepEqual(fs.readFileSync(f.executable), f.bytes)
  assert(fs.existsSync(path.join(f.root, '.lx-m-update-backup-' + f.plan.nonce)))
  assert(fs.existsSync(f.stage))
})

test('unsafe targets, tampered staging and junctions fail before the current application exits', { skip: !windows, timeout: 30000 }, async(t) => {
  for (const mutation of [
    f => { f.plan.files[0].path = '../music.db' },
    f => { f.plan.files.push({ path: 'portable/userData/music.db', source: 'update.exe', size: f.bytes.length, sha256: sha256(f.bytes) }) },
    f => { fs.appendFileSync(path.join(f.stage, 'update.exe'), 'tampered') },
    f => { fs.symlinkSync(f.root, path.join(f.stage, 'linked'), 'junction'); f.plan.files[0].source = 'linked/notes.txt' },
  ]) {
    const f = fixture(t)
    const original = fs.readFileSync(f.executable)
    mutation(f); f.start()
    assert.equal((await f.result()).status, 'error')
    assert(!fs.existsSync(f.planFile + '.ready'))
    assert.deepEqual(fs.readFileSync(f.executable), original)
    assert.equal(f.oldProcess.exitCode, null)
    assert.equal(f.oldProcess.signalCode, null)
  }
})

test('startup confirmation matches the edition, version and original file across Windows short and long paths', { skip: !windows }, async(t) => {
  const f = fixture(t, 'single-file')
  fs.writeFileSync(f.planFile, JSON.stringify(f.plan))
  let version = '9.0.0'
  let edition = 'single-file'
  const { confirmWindowsUpdate } = require('./helpers/load-typescript.cjs')({
    electron: { app: { getVersion: () => version } },
    '@common/utils/undiciCompat': {},
    './updateRuntime': {
      getUpdateRuntime: () => ({ edition, arch: 'x64', win7: false }),
      getUpdateExecutable: () => fs.realpathSync.native(f.executable),
    },
  })('src/main/modules/winMain/updateRelaunch.ts')
  const previous = process.env.LX_M_UPDATE_CONFIRM
  t.after(() => { if (previous === undefined) delete process.env.LX_M_UPDATE_CONFIRM; else process.env.LX_M_UPDATE_CONFIRM = previous })
  for (const wrong of ['version', 'edition']) {
    version = wrong === 'version' ? '8.0.0' : '9.0.0'
    edition = wrong === 'edition' ? 'portable' : 'single-file'
    process.env.LX_M_UPDATE_CONFIRM = f.planFile
    confirmWindowsUpdate()
    assert(!fs.existsSync(f.planFile + '.ack'))
    assert.equal(process.env.LX_M_UPDATE_CONFIRM, undefined)
  }
  version = '9.0.0'; edition = 'single-file'
  process.env.LX_M_UPDATE_CONFIRM = f.planFile
  confirmWindowsUpdate()
  assert.deepEqual(JSON.parse(fs.readFileSync(f.planFile + '.ack', 'utf8')), { nonce: f.plan.nonce, version })
})
