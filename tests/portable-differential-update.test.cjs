const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')
const { test } = require('node:test')
const { createPortableDelta, writeInventory, portableArtifactHook } = require('../build-config/portable-update.cjs')
const load = require('./helpers/load-typescript.cjs')
const { parsePortableManifest, isSafeUpdatePath } = load()('src/common/updateManifest.ts')
const runtime = { edition: 'portable', arch: 'x64', win7: false }
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const pe = () => {
  const bytes = Buffer.alloc(256)
  bytes.write('MZ')
  bytes.writeUInt32LE(128, 60)
  bytes.writeUInt32LE(0x4550, 128)
  bytes.writeUInt16LE(0x8664, 132)
  return bytes
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-delta-test-'))
  t.after(async() => { assert.equal(path.dirname(root), os.tmpdir()); await fs.rm(root, { recursive: true, force: true }) })
  const old = path.join(root, '应用 & 用户的 music')
  const next = path.join(root, 'next')
  const artifacts = path.join(root, 'artifacts')
  for (const directory of [old, next]) {
    await fs.mkdir(path.join(directory, 'resources'), { recursive: true })
    await fs.writeFile(path.join(directory, 'LX-M Music.exe'), pe())
    await fs.writeFile(path.join(directory, 'resources/app.asar'), Buffer.concat([crypto.randomBytes(1024 * 1024), Buffer.alloc(1024 * 1024, 55)]))
    await fs.writeFile(path.join(directory, 'icudtl.dat'), Buffer.alloc(1024 * 1024, 31))
  }
  // Most bytes are identical; one ASAR chunk changes and one file is removed.
  await fs.copyFile(path.join(old, 'resources/app.asar'), path.join(next, 'resources/app.asar'))
  const handle = await fs.open(path.join(next, 'resources/app.asar'), 'r+')
  await handle.write(Buffer.from('new code'), 0, 8, 1024 * 1024 + 24)
  await handle.close()
  await fs.writeFile(path.join(old, 'resources/old.dll'), 'obsolete runtime')
  await writeInventory(old)
  await fs.mkdir(path.join(old, 'portable/userData'), { recursive: true })
  await fs.writeFile(path.join(old, 'portable/userData/music.db'), 'user database')
  await fs.writeFile(path.join(old, 'notes.txt'), 'extra user file')
  await writeInventory(next)
  const [manifestPath, payloadPath] = await createPortableDelta(next, artifacts, { version: '9.0.0', arch: 'x64' })
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const payloadBytes = await fs.readFile(payloadPath)
  const payload = { downloadUrl: 'https://example.test/update.bin', fileName: path.basename(payloadPath), size: payloadBytes.length, digest: 'sha256:' + digest(payloadBytes) }
  const manifestAsset = { downloadUrl: 'https://example.test/update.json', fileName: path.basename(manifestPath), size: (await fs.stat(manifestPath)).size, digest: 'sha256:' + digest(await fs.readFile(manifestPath)) }
  return { root, old, next, artifacts, manifest, payload, payloadBytes, manifestAsset }
}

test('portable packaging publishes a matching manifest/payload and the updater fetches only changed chunks', async(t) => {
  const f = await fixture(t)
  const ranges = []
  const progress = []
  const api = load({ '@common/utils/undiciCompat': { async requestWithCompatibility(_, options) {
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range)
    ranges.push([+start, +end])
    return { statusCode: 206, headers: { 'content-range': `bytes ${start}-${end}/${f.payload.size}` }, body: Readable.from([f.payloadBytes.subarray(+start, +end + 1)]) }
  } } })('src/main/modules/winMain/updatePortable.ts')
  const controller = new AbortController()
  const stage = await api.prepareDifferentialUpdate({
    manifest: f.manifest, payload: f.payload, runtime, version: '9.0.0', executable: path.join(f.old, 'LX-M Music.exe'),
    directory: path.join(f.root, 'stage'), sources: [{ name: 'fast.test', url: f.payload.downloadUrl }], dispatcher: {}, signal: controller.signal,
    onProgress: info => progress.push(info),
  })
  assert(ranges.length > 0)
  assert(ranges.reduce((n, [start, end]) => n + end - start + 1, 0) < f.payload.size / 4, 'most program bytes should be reused rather than downloaded')
  assert(progress.at(-1).reusedBytes > 2 * 1024 * 1024)
  for (const file of stage.files) assert.equal(digest(await fs.readFile(path.join(stage.directory, file.source))), digest(await fs.readFile(path.join(f.next, file.source))))
  assert(stage.obsolete.some(file => file.path === 'resources/old.dll'))
  assert.equal(await fs.readFile(path.join(f.old, 'portable/userData/music.db'), 'utf8'), 'user database')
  assert.equal(await fs.readFile(path.join(f.old, 'notes.txt'), 'utf8'), 'extra user file')
  await api.validateStagedPortable(stage, runtime, '9.0.0')
  const extra = await portableArtifactHook([{ appOutDir: f.next, arch: 1, packager: { appInfo: { version: '9.0.0' } } }], false)({ outDir: path.join(f.root, 'hook-artifacts') })
  assert.equal(extra.length, 2)
  assert(extra.some(file => file.endsWith('-win_x64-green-update.json')))
})

test('wrong runtime metadata, unsafe names, overlapping ranges, duplicate Windows paths and inconsistent hashes are rejected', async(t) => {
  const f = await fixture(t)
  for (const mutate of [
    value => { value.arch = 'arm64' }, value => { value.win7 = true }, value => { value.edition = 'installed' }, value => { value.version = '8.0.0' },
    value => { value.files[0].path = '../portable/music.db' }, value => { value.files[0].path = 'portable/music.db' },
    value => { value.files.push({ ...value.files[0], path: value.files[0].path.toUpperCase() }) },
    value => { value.files[0].chunks[0].offset++ }, value => { value.payload.sha256 = 'b'.repeat(64) },
  ]) {
    const value = structuredClone(f.manifest)
    mutate(value)
    assert.throws(() => parsePortableManifest(value, runtime, '9.0.0', f.payload))
  }
  for (const name of ['../file', 'resources/../../portable', '/file', 'C:/file', 'resources/file:stream', 'resources/NUL.txt', 'resources/file.', 'resources/file\\other']) assert.equal(isSafeUpdatePath(name), false)
})

test('corrupt ranges retry another node and ignored Range responses are closed for full-archive fallback', async(t) => {
  const f = await fixture(t)
  let closed
  const calls = []
  const api = load({ '@common/utils/undiciCompat': { async requestWithCompatibility(url, options) {
    calls.push(url)
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range)
    const bytes = f.payloadBytes.subarray(+start, +end + 1)
    return { statusCode: 206, headers: { 'content-range': `bytes ${start}-${end}/${f.payload.size}` }, body: Readable.from([url.includes('bad.test') ? Buffer.alloc(bytes.length) : bytes]) }
  } } })('src/main/modules/winMain/updatePortable.ts')
  const options = {
    manifest: f.manifest, payload: f.payload, runtime, version: '9.0.0', executable: path.join(f.old, 'LX-M Music.exe'),
    directory: path.join(f.root, 'retry-stage'), sources: [{ name: 'bad.test', url: 'https://bad.test/update.bin' }, { name: 'good.test', url: 'https://good.test/update.bin' }], dispatcher: {}, signal: new AbortController().signal, onProgress() {},
  }
  await api.prepareDifferentialUpdate(options)
  assert(calls.some(url => url.includes('bad.test')) && calls.some(url => url.includes('good.test')))
  const ignored = load({ '@common/utils/undiciCompat': { async requestWithCompatibility() {
    closed = Readable.from([f.payloadBytes])
    return { statusCode: 200, headers: {}, body: closed }
  } } })('src/main/modules/winMain/updatePortable.ts')
  await assert.rejects(ignored.prepareDifferentialUpdate({ ...options, directory: path.join(f.root, 'ignored-stage') }), /精确差分/)
  assert(closed.destroyed)
})

test('cancelled differential requests never change current program files or become a prepared update', async(t) => {
  const f = await fixture(t)
  const before = digest(await fs.readFile(path.join(f.old, 'resources/app.asar')))
  const controller = new AbortController()
  const api = load({ '@common/utils/undiciCompat': { requestWithCompatibility(_, options) {
    return new Promise((_, reject) => { options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); controller.abort() })
  } } })('src/main/modules/winMain/updatePortable.ts')
  await assert.rejects(api.prepareDifferentialUpdate({
    manifest: f.manifest, payload: f.payload, runtime, version: '9.0.0', executable: path.join(f.old, 'LX-M Music.exe'),
    directory: path.join(f.root, 'cancel-stage'), sources: [{ name: 'direct', url: f.payload.downloadUrl }], dispatcher: {}, signal: controller.signal, onProgress() {},
  }), { name: 'AbortError' })
  assert.equal(digest(await fs.readFile(path.join(f.old, 'resources/app.asar'))), before)
})
