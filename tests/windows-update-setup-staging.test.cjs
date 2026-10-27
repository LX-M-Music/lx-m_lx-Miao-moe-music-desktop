const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { stageUpdateTools } = require('../build-config/portable-update.cjs')
const { safeRemove, sha256 } = require('./helpers/windows-update-fixture.cjs')
const load = require('./helpers/load-typescript.cjs')

const api = load({ '@common/utils/undiciCompat': {} })('src/main/modules/winMain/updateSetup.ts')
const runtime = { edition: 'installed', arch: 'x64', win7: false }
const marker = (edition = 'installed', version = '9.0.0') => Buffer.from(JSON.stringify({ schema: 1, appId: 'com.lx-m.music.desktop', edition, arch: 'x64', win7: false, version }))

const peSample = () => {
  const bytes = Buffer.alloc(256)
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.writeUInt32LE(0x4550, 128); bytes.writeUInt16LE(0x8664, 132)
  return bytes
}

const inventory = files => ({
  schema: 1,
  appId: 'com.lx-m.music.desktop',
  files: files.map(file => ({ path: file.path, size: file.bytes.length, sha256: sha256(file.bytes) })),
})

const writeFile = (root, file) => {
  const target = path.join(root, file.path)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, file.bytes)
}

function buildApp(root, files) {
  for (const file of files) writeFile(root, file)
}

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-setup-update-'))
  t.after(() => safeRemove(root, 'lx-setup-update-'))
  const current = path.join(root, 'current')
  const next = path.join(root, 'next')
  fs.mkdirSync(path.join(current, 'resources'), { recursive: true })
  fs.mkdirSync(path.join(next, 'resources'), { recursive: true })
  await stageUpdateTools(current)
  const sevenZip = path.join(current, 'resources/update-tools/7za.exe')
  return { root, current, next, sevenZip, archive: path.join(root, 'payload.7z') }
}

function pack(f, files) {
  fs.rmSync(f.next, { recursive: true, force: true })
  fs.mkdirSync(path.join(f.next, 'resources'), { recursive: true })
  buildApp(f.next, files)
  fs.rmSync(f.archive, { force: true })
  const result = spawnSync(f.sevenZip, ['a', '-t7z', '-mx=1', f.archive, '.'], { cwd: f.next, windowsHide: true, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
}

const appFiles = (asar, dll, markerBytes, extra = []) => [
  { path: 'LX-M Music.exe', bytes: peSample() },
  { path: 'resources/app.asar', bytes: Buffer.from(asar) },
  { path: 'resources/changed.dll', bytes: Buffer.from(dll) },
  { path: 'resources/same.dll', bytes: Buffer.from('unchanged binary') },
  ...extra,
  { path: 'resources/lx-update-runtime.json', bytes: markerBytes },
]

function installCurrent(f, files) {
  const tools = path.join(f.current, 'resources/update-tools')
  const cached = path.join(f.root, 'tools')
  fs.cpSync(tools, cached, { recursive: true })
  fs.rmSync(f.current, { recursive: true, force: true })
  fs.mkdirSync(path.join(f.current, 'resources'), { recursive: true })
  buildApp(f.current, files)
  fs.cpSync(cached, path.join(f.current, 'resources/update-tools'), { recursive: true })
}

test('installed Setup payload stages only changed files and lists obsolete program files', { skip: process.platform !== 'win32', timeout: 30000 }, async(t) => {
  const f = await fixture(t)
  const oldInventory = inventory([
    { path: 'LX-M Music.exe', bytes: Buffer.from('old exe') },
    { path: 'resources/app.asar', bytes: Buffer.from('old asar') },
    { path: 'resources/same.dll', bytes: Buffer.from('unchanged binary') },
    { path: 'resources/old.dll', bytes: Buffer.from('removed program') },
  ])
  installCurrent(f, [
    { path: 'LX-M Music.exe', bytes: Buffer.from('old exe') },
    { path: 'resources/app.asar', bytes: Buffer.from('old asar') },
    { path: 'resources/same.dll', bytes: Buffer.from('unchanged binary') },
    { path: 'resources/old.dll', bytes: Buffer.from('removed program') },
    { path: 'resources/lx-update-inventory.json', bytes: Buffer.from(JSON.stringify(oldInventory)) },
  ])
  const files = appFiles('new asar', 'new binary', marker())
  files.push({ path: 'resources/lx-update-inventory.json', bytes: Buffer.from(JSON.stringify(inventory(files))) })
  pack(f, files)
  const stage = await api.prepareSetupUpdate({
    archive: f.archive, executable: path.join(f.current, 'LX-M Music.exe'), version: '9.0.0',
    runtime, directory: path.join(f.root, 'stage/app'), resources: path.join(f.current, 'resources'),
    signal: new AbortController().signal,
  })
  assert.deepEqual(stage.files.map(file => file.path).sort(), [
    'LX-M Music.exe', 'resources/app.asar', 'resources/changed.dll', 'resources/lx-update-inventory.json', 'resources/lx-update-runtime.json',
  ])
  assert(!fs.existsSync(path.join(stage.directory, 'resources/same.dll')), 'unchanged files must not be copied into the update')
  assert.equal(fs.readFileSync(path.join(stage.directory, 'resources/app.asar'), 'utf8'), 'new asar')
  assert.deepEqual(stage.obsolete.map(file => file.path), ['resources/old.dll'])
  assert.equal(fs.readFileSync(path.join(f.current, 'resources/same.dll'), 'utf8'), 'unchanged binary')
})

test('installed Setup payload rejects another edition marker, user data paths and a missing extractor', { skip: process.platform !== 'win32', timeout: 30000 }, async(t) => {
  const f = await fixture(t)
  installCurrent(f, [{ path: 'LX-M Music.exe', bytes: Buffer.from('old exe') }])
  const options = () => ({
    archive: f.archive, executable: path.join(f.current, 'LX-M Music.exe'), version: '9.0.0',
    runtime, directory: path.join(f.root, 'stage/app'), resources: path.join(f.current, 'resources'),
    signal: new AbortController().signal,
  })
  const portableMarker = appFiles('new asar', 'new binary', marker('portable'))
  portableMarker.push({ path: 'resources/lx-update-inventory.json', bytes: Buffer.from(JSON.stringify(inventory(portableMarker))) })
  pack(f, portableMarker)
  await assert.rejects(api.prepareSetupUpdate(options()), /版本类型/)
  const userData = appFiles('new asar', 'new binary', marker())
  userData.push({ path: 'portable/userData/music.db', bytes: Buffer.from('user data') })
  userData.push({ path: 'resources/lx-update-inventory.json', bytes: Buffer.from(JSON.stringify(inventory(userData))) })
  pack(f, userData)
  await assert.rejects(api.prepareSetupUpdate(options()), /程序清单无效/)
  await assert.rejects(api.prepareSetupUpdate({ ...options(), executable: path.join(f.current, 'renamed.exe') }), /文件名已变更/)
  fs.rmSync(path.join(f.current, 'resources/update-tools'), { recursive: true, force: true })
  await assert.rejects(api.prepareSetupUpdate(options()), /ENOENT|no such file|系统找不到/)
})
