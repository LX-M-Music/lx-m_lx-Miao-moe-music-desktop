const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { EventEmitter, once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Readable, PassThrough, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { setTimeout: delay } = require('node:timers/promises')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const project = path.resolve(__dirname, '..')
const sample = Buffer.from('MZ test update payload; never executed by the unit tests')
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const fileName = 'LX-M Music-v9.0.0-x64-Setup.exe'

function loadSource(filename, overrides = {}, appProcess = process, schedule = setTimeout) {
  const code = ts.transpileModule(fs.readFileSync(path.join(project, filename), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  vm.runInThisContext('(function(require,module,exports,process,setTimeout){' + code + '\n})', { filename })(name => {
    if (Object.hasOwn(overrides, name)) return overrides[name]
    throw Error('Unexpected dependency: ' + name)
  }, module, module.exports, appProcess, schedule)
  return module.exports
}

const assetUtils = loadSource('src/common/utils/update.ts')
const greenName = 'LX-M.Music-v9.0.0-win_x64-green.7z'
const singleName = 'LX-M.Music-v9.0.0-x64-portable.exe'
const peSample = () => {
  const bytes = Buffer.alloc(256)
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.writeUInt32LE(0x4550, 128); bytes.writeUInt16LE(0x8664, 132)
  return bytes
}

async function mockArchive(_archive, directory, executable) {
  const bytes = peSample()
  await fs.promises.mkdir(path.join(directory, 'resources'), { recursive: true })
  await fs.promises.writeFile(path.join(directory, 'LX-M Music.exe'), bytes)
  const asar = Buffer.from('new app')
  await fs.promises.writeFile(path.join(directory, 'resources/app.asar'), asar)
  return {
    root: path.dirname(executable), executable, directory,
    files: [
      { path: path.basename(executable), source: 'LX-M Music.exe', size: bytes.length, sha256: sha256(bytes) },
      { path: 'resources/app.asar', source: 'resources/app.asar', size: asar.length, sha256: sha256(asar) },
    ], obsolete: [],
  }
}

function fixture(t, { request, launch, installed = true, openError = '', deadlineMs, sources, speedTest, edition = 'installed', prepareArchive, prepareDifferential, relaunch } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-update-test-'))
  const installDirectory = path.join(root, "应用 & player's music")
  fs.mkdirSync(installDirectory)
  if (installed) fs.writeFileSync(path.join(installDirectory, 'Uninstall LX-M Music.exe'), 'test marker')
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert(path.basename(root).startsWith('lx-update-test-'))
    fs.rmSync(root, { force: true, recursive: true })
  })
  const app = new EventEmitter()
  app.isPackaged = true
  app.getPath = () => path.join(installDirectory, 'LX-M Music.exe')
  const handlers = new Map()
  const invocations = new Map()
  const bus = new EventEmitter()
  const events = []
  const launches = []
  const relaunches = []
  const opened = []
  let quits = 0
  let requests = 0
  const names = Object.fromEntries(['update_error', 'update_progress', 'update_downloaded', 'update_download_update', 'update_cancel_update', 'update_get_runtime', 'quit_update'].map(n => [n, n]))
  const portableApi = require('./helpers/load-typescript.cjs')({ '@common/utils/undiciCompat': {} })('src/main/modules/winMain/updatePortable.ts')
  class Agent {
    compose() { return this }
    async close() {}
  }
  loadSource('src/main/modules/winMain/autoUpdate.ts', {
    electron: { app, shell: { async openPath(filePath) { opened.push(filePath); return openError } } },
    'node:fs': fs,
    'original-fs': fs,
    'node:path': path,
    'node:os': { tmpdir: () => root },
    'node:crypto': crypto,
    'node:stream': { Transform },
    'node:stream/promises': { pipeline },
    undici: {
      Agent,
      ProxyAgent: Agent,
    },
    '@common/utils/undiciCompat': {
      composeDispatcher: base => base,
      async requestWithCompatibility(url, options) {
        requests++
        return request ? request(url, options) : response()
      },
    },
    '@common/utils': { log: { info() {}, warn() {}, error() {} }, isLinux: false },
    '@common/mainIpc': {
      mainOn: (name, callback) => handlers.set(name, callback),
      mainHandle: (name, callback) => invocations.set(name, callback),
    },
    './index': { isExistWindow: () => true, sendEvent(name, params) { events.push({ name, params }); bus.emit(name, params) } },
    '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: names },
    '@main/utils': { getProxy: () => null },
    '@main/app': { quitApp() { quits++; app.emit('will-quit') } },
    '@common/utils/update': assetUtils,
    '@common/updateManifest': require('./helpers/load-typescript.cjs')()('src/common/updateManifest.ts'),
    '@common/utils/errorMessage': require('./helpers/load-typescript.cjs')()('src/common/utils/errorMessage.ts'),
    './updateInstaller': { async launchWindowsInstaller(...args) { launches.push(args); await launch?.(...args) } },
    './updateRuntime': { getUpdateRuntime: () => ({ edition, arch: 'x64', win7: false }), getUpdateExecutable: () => app.getPath('exe') },
    './updatePortable': {
      ...portableApi,
      prepareArchiveUpdate: prepareArchive ?? portableApi.prepareArchiveUpdate,
      prepareDifferentialUpdate: prepareDifferential ?? portableApi.prepareDifferentialUpdate,
    },
    './updateRelaunch': { async launchWindowsRelaunch(...args) { relaunches.push(args); await relaunch?.(...args) } },
    './updateSources': {
      getUpdateSources: url => sources ?? [{ url, name: 'example.test' }],
      speedTestUpdateSources: speedTest ?? (async sources => sources),
    },
  }, { platform: 'win32', arch: 'x64', resourcesPath: path.join(installDirectory, 'resources'), env: {} }, (callback, ms) => setTimeout(callback, ms === 30 * 60_000 && deadlineMs ? deadlineMs : ms)).default()
  const emit = (name, params) => handlers.get(name)({ params })
  const wait = async(name) => (await once(bus, name, { signal: AbortSignal.timeout(5000) }))[0]
  const findFile = (name = fileName) => fs.readdirSync(root).filter(name => name.startsWith('lx-m-update-'))
    .map(dir => path.join(root, dir, name)).find(file => fs.existsSync(file))
  return {
    root,
    app,
    events,
    launches,
    relaunches,
    opened,
    installDirectory,
    emit,
    wait,
    findFile,
    cancel: () => invocations.get('update_cancel_update')(),
    get quits() { return quits },
    get requests() { return requests },
    async download(info = {}, status = 'update_downloaded') {
      const pending = wait(status)
      emit('update_download_update', { version: '9.0.0', downloadUrl: 'https://example.test/update.exe', fileName, size: sample.length, digest: 'sha256:' + sha256(sample), ...info })
      return pending
    },
    async installError() {
      const pending = wait('update_error')
      emit('quit_update')
      return pending
    },
  }
}

function response(bytes = sample, headers = {}) {
  return { statusCode: 200, headers: { 'content-length': String(bytes.length), ...headers }, body: Readable.from([bytes]) }
}

test('main process refuses another edition, CPU architecture or Windows runtime before any network request', async(t) => {
  for (const edition of ['installed', 'portable', 'single-file']) {
    const f = fixture(t, { edition })
    for (const name of [fileName, greenName, singleName, 'LX-M-v9-arm64-Setup.exe', 'LX-M-v9-win7_x64-Setup.exe']) {
      if (assetUtils.getWindowsUpdatePriority(name, { edition, arch: 'x64', win7: false })) continue
      await f.download({ fileName: name }, 'update_error')
      assert.equal(f.requests, 0)
      assert.equal(f.quits, 0)
      assert.equal(f.launches.length + f.relaunches.length, 0)
    }
  }
})

test('single-file downloads the entire executable and hands the original filename to the restart helper', async(t) => {
  const f = fixture(t, { edition: 'single-file', installed: false })
  f.app.getPath = () => path.join(f.installDirectory, 'renamed music.exe')
  await f.download({ fileName: singleName, edition: 'single-file' })
  f.emit('quit_update')
  for (let i = 0; !f.quits && i < 100; i++) await delay(10)
  assert.equal(f.quits, 1)
  assert.equal(f.requests, 1)
  assert.equal(f.launches.length, 0)
  const [stage, kind, version, directory] = f.relaunches[0]
  assert.equal(kind, 'single-file')
  assert.equal(version, '9.0.0')
  assert.equal(stage.executable, f.app.getPath())
  assert.equal(stage.files[0].path, 'renamed music.exe')
  assert.deepEqual(fs.readFileSync(path.join(stage.directory, stage.files[0].source)), sample)
  assert.equal(directory, path.dirname(f.findFile(singleName)))
})

test('full green archive uses portable staging and its restart helper instead of an installer', async(t) => {
  const f = fixture(t, { edition: 'portable', prepareArchive: mockArchive })
  await f.download({ fileName: greenName, edition: 'portable' })
  f.emit('quit_update')
  for (let i = 0; !f.quits && i < 100; i++) await delay(10)
  assert.equal(f.quits, 1)
  assert.equal(f.launches.length, 0)
  assert.equal(f.relaunches[0][1], 'portable')
})

test('failed portable differential transport falls back only to the matching green archive', async(t) => {
  const urls = []
  const f = fixture(t, {
    edition: 'portable', prepareArchive: mockArchive,
    async prepareDifferential() { throw Error('Range unsupported') },
    request(url) { urls.push(url); return url.endsWith('.json') ? response(Buffer.from('{}')) : response() },
  })
  const metadata = Buffer.from('{}')
  await f.download({ fileName: greenName, edition: 'portable', downloadUrl: 'https://example.test/green.7z', differential: {
    manifest: { fileName: greenName.replace('-green.7z', '-green-update.json'), downloadUrl: 'https://example.test/update.json', size: metadata.length, digest: sha256(metadata) },
    payload: { fileName: greenName.replace('-green.7z', '-green-update.bin'), downloadUrl: 'https://example.test/update.bin', size: 64, digest: 'a'.repeat(64) },
  } })
  assert.deepEqual(urls, ['https://example.test/update.json', 'https://example.test/green.7z'])
  assert(f.events.some(event => event.params?.phase === 'preparing' && event.params?.mode === 'full'))
  assert.equal(f.quits, 0)
})

test('tampered staged executable and a failed restart preflight keep the previous application open', async(t) => {
  const f = fixture(t, { edition: 'single-file', async relaunch() { throw Error('original folder is read-only') } })
  await f.download({ fileName: singleName })
  const stagePath = path.join(path.dirname(f.findFile(singleName)), 'app/update.exe')
  fs.appendFileSync(stagePath, 'tampered')
  assert.match(await f.installError(), /发生变化/)
  assert.equal(f.relaunches.length, 0)
  assert.equal(f.quits, 0)
  fs.writeFileSync(stagePath, sample)
  assert.match(await f.installError(), /read-only/)
  assert.equal(f.quits, 0)
})

test('cancelling portable preparation never falls back to a full archive or starts a restart helper', async(t) => {
  let f
  let archiveCalls = 0
  let reached
  const ready = new Promise(resolve => { reached = resolve })
  f = fixture(t, { edition: 'portable', async prepareArchive(_a, _b, _c, _d, signal) {
    archiveCalls++; reached()
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  } })
  f.emit('update_download_update', { version: '9.0.0', fileName: greenName, downloadUrl: 'https://example.test/green.7z', size: sample.length, digest: sha256(sample), installAfterDownload: true })
  await ready
  assert.equal(await f.cancel(), true)
  await delay(30)
  assert.equal(archiveCalls, 1)
  assert.equal(f.quits, 0)
  assert.equal(f.relaunches.length, 0)
  assert(!f.events.some(event => event.name === 'update_downloaded'))
})

test('Windows chooses the matching Setup, never a portable or another architecture', async() => {
  const assets = [
    'LX-M-v9-arm64-Setup.exe', 'LX-M-v9-x64-portable.exe', 'LX-M-v9-x86-Setup.exe',
    'LX-M-v9-x86_64-Setup.exe', fileName,
  ].map(name => ({ name, browser_download_url: 'https://example.test/' + name }))
  for (const [arch, expected] of [['x64', fileName], ['ia32', 'LX-M-v9-x86-Setup.exe'], ['arm64', 'LX-M-v9-arm64-Setup.exe']]) {
    const api = loadSource('src/renderer/utils/update.js', {
      './request': { httpGet: (_url, _options, callback) => callback(null, { statusCode: 200 }, { tag_name: 'v9.0.0', body: '## unchanged Release', assets }) },
      '@common/utils/update': assetUtils,
      './ipc': { getUpdateRuntime: async() => ({ edition: 'installed', arch, win7: false }) },
    }, { platform: 'win32', arch })
    const result = await api.getVersionInfo()
    assert.equal(result.fileName, expected)
    assert.equal(result.desc, '## unchanged Release')
  }
  assert.equal(assetUtils.getWindowsSetupPriority('LX-M-v9-x86_64-Setup.exe', 'x64'), 1)
  assert.equal(assetUtils.getWindowsSetupPriority('LX-M-v9-x86_64-Setup.exe', 'ia32'), 1)
  for (const name of ['LX-M-v9-arm64-Setup.exe', 'LX-M-v9-x86-Setup.exe', 'LX-M-v9-x64-portable.exe', 'LX-M-v9-green-Setup.exe', '../Setup.exe']) {
    assert.equal(assetUtils.getWindowsSetupPriority(name, 'x64'), 0, name)
  }
})

test('validated update starts in the existing directory, quits once and survives will-quit cleanup', async(t) => {
  const f = fixture(t)
  await f.download()
  const file = f.findFile()
  f.emit('quit_update')
  f.emit('quit_update')
  for (let i = 0; !f.quits && i < 100; i++) await delay(10)
  assert.equal(f.quits, 1)
  assert.equal(f.launches.length, 1)
  assert.deepEqual(f.launches[0], [file, f.installDirectory, path.join(f.installDirectory, 'resources')])
  assert.deepEqual(f.opened, [])
  assert.deepEqual(fs.readFileSync(file), sample)
})

const mirrorSources = [
  { name: 'fast.test', url: 'https://fast.test/Setup.exe' },
  { name: 'backup.test', url: 'https://backup.test/Setup.exe' },
]

test('update tests sources before the full download and reports the selected source', async t => {
  let ready = false
  const f = fixture(t, {
    sources: mirrorSources,
    speedTest: async(sources, options) => {
      assert.equal(f.requests, 0)
      options.onProgress(0, sources.length)
      await delay(20)
      options.onProgress(sources.length, sources.length)
      ready = true
      return sources
    },
    request: async url => {
      assert(ready)
      assert.equal(url, mirrorSources[0].url)
      return response()
    },
  })
  await f.download()
  const reports = f.events.filter(event => event.name === 'update_progress').map(event => event.params)
  assert.equal(reports[0].phase, 'testing')
  assert.equal(reports[1].testedSources, 2)
  assert.equal(reports.find(report => report.phase === 'downloading').source, 'fast.test')
  assert.equal(reports.at(-1).phase, 'verifying')
})

for (const failure of ['HTTP failure', 'truncated payload', 'checksum failure']) {
  test(`a selected mirror ${failure} retries another source before automatic installation`, async t => {
    const f = fixture(t, {
      sources: mirrorSources,
      request: async url => {
        if (url === mirrorSources[1].url) return response()
        if (failure === 'HTTP failure') return { ...response(), statusCode: 503 }
        if (failure === 'truncated payload') return response(sample.subarray(0, 8), { 'content-length': String(sample.length) })
        return response(Buffer.alloc(sample.length, 42))
      },
    })
    await f.download({ installAfterDownload: true })
    for (let i = 0; !f.quits && i < 100; i++) await delay(10)
    assert.equal(f.requests, 2)
    assert.equal(f.launches.length, 1)
    assert.equal(f.events.filter(event => event.name === 'update_error').length, 0)
    assert.deepEqual(fs.readFileSync(f.launches[0][0]), sample)
  })
}

test('cancellation during source testing prevents downloading and late progress', async t => {
  let finish
  const f = fixture(t, {
    sources: mirrorSources,
    speedTest: async(sources, options) => {
      options.onProgress(0, sources.length)
      await new Promise(resolve => { finish = resolve })
      options.onProgress(sources.length, sources.length)
      return sources
    },
  })
  const testing = f.wait('update_progress')
  f.emit('update_download_update', { downloadUrl: 'https://example.test/Setup.exe', fileName, size: sample.length, digest: sha256(sample), installAfterDownload: true })
  assert.equal((await testing).phase, 'testing')
  assert.equal(await f.cancel(), true)
  finish()
  await delay(30)
  assert.equal(f.requests, 0)
  assert.equal(f.launches.length, 0)
  assert.equal(f.events.filter(event => event.name === 'update_progress').length, 1)
  assert.equal(f.events.filter(event => event.name === 'update_error').length, 0)
  assert.equal(f.findFile(), undefined)
})

test('downloads stay idle on startup and require explicit opt-in to install automatically', async(t) => {
  const f = fixture(t)
  await delay(20)
  assert.equal(f.requests, 0)
  assert.equal(f.launches.length, 0)
  await f.download()
  await delay(20)
  assert.equal(f.quits, 0)
  assert.equal(f.launches.length, 0)
  await f.download({ installAfterDownload: true })
  for (let i = 0; !f.quits && i < 100; i++) await delay(10)
  assert.equal(f.quits, 1)
  assert.equal(f.launches.length, 1)
  assert.equal(f.events.filter(event => event.name == 'update_progress').at(-1).params.phase, 'installing')
})

test('a short download reports zero, verified completion and the Release size without Content-Length', async(t) => {
  const f = fixture(t, { request: async() => response(sample, { 'content-length': undefined }) })
  await f.download()
  const reports = f.events.filter(event => event.name == 'update_progress').map(event => event.params)
  assert.equal(reports[0].progress, 0)
  assert.equal(reports[0].total, sample.length)
  assert.equal(reports.at(-1).progress, 100)
  assert.equal(reports.at(-1).transferred, sample.length)
  assert.equal(reports.at(-1).phase, 'verifying')
})

test('a slow unknown-length download reports received bytes without inventing a percentage', async(t) => {
  const body = new PassThrough()
  const f = fixture(t, { request: async() => ({ statusCode: 200, headers: {}, body }) })
  const completed = f.download({ size: 0 })
  await delay(550)
  body.write(sample.subarray(0, 10))
  await delay(30)
  const partial = f.events.filter(event => event.name == 'update_progress').at(-1).params
  assert.equal(partial.transferred, 10)
  assert.equal(partial.total, 0)
  assert.equal(partial.progress, 0)
  assert(partial.bytesPerSecond > 0)
  body.end(sample.subarray(10))
  await completed
  assert.equal(f.events.filter(event => event.name == 'update_progress').at(-1).params.total, sample.length)
})

test('cancel followed immediately by retry cannot install the cancelled download or clear the new task', async(t) => {
  const firstBody = new PassThrough()
  let first = true
  const f = fixture(t, {
    request: async() => {
      if (!first) return response()
      first = false
      return { statusCode: 200, headers: {}, body: firstBody }
    },
  })
  f.emit('update_download_update', { downloadUrl: 'https://example.test/first.exe', fileName, size: sample.length, digest: sha256(sample), installAfterDownload: true })
  await delay(10)
  f.emit('update_download_update', null)
  await f.download({ installAfterDownload: true })
  for (let i = 0; !f.quits && i < 100; i++) await delay(10)
  assert.equal(f.requests, 2)
  assert.equal(f.launches.length, 1)
  assert.equal(f.events.filter(event => event.name == 'update_downloaded').length, 1)
  assert.equal(f.events.filter(event => event.name == 'update_error').length, 0)
  assert(fs.existsSync(f.launches[0][0]))
})

test('automatic installation stops at a failed checksum and stays available for retry', async(t) => {
  const f = fixture(t)
  assert.match(await f.download({ installAfterDownload: true, digest: '0'.repeat(64) }, 'update_error'), /SHA-256/)
  assert.equal(f.launches.length, 0)
  assert.equal(f.quits, 0)
  await f.download({ installAfterDownload: true })
  for (let i = 0; !f.quits && i < 100; i++) await delay(10)
  assert.equal(f.quits, 1)
})

test('cancelling at download completion stops installer preparation and permits an immediate retry', async(t) => {
  const f = fixture(t)
  await f.download({ installAfterDownload: true })
  assert.equal(await f.cancel(), true)
  assert.equal(f.launches.length, 0)
  assert.equal(f.quits, 0)
  assert.equal(f.findFile(), undefined)
  assert.equal(f.events.filter(event => event.name == 'update_error').length, 0)
  await f.download({ installAfterDownload: true })
  for (let i = 0; !f.quits && i < 100; i++) await delay(10)
  assert.equal(f.launches.length, 1)
  assert.equal(f.quits, 1)
})

test('cancellation is rejected once the installer starts and preserves its file', async(t) => {
  let started
  let finish
  const launching = new Promise(resolve => { started = resolve })
  const launched = new Promise(resolve => { finish = resolve })
  const f = fixture(t, { launch: async() => { started(); await launched } })
  try {
    await f.download({ installAfterDownload: true })
    await launching
    assert.equal(await f.cancel(), false)
    assert(fs.existsSync(f.launches[0][0]))
    assert.equal(f.quits, 0)
  } finally { finish() }
  for (let i = 0; !f.quits && i < 100; i++) await delay(10)
  assert.equal(f.quits, 1)
  assert.equal(f.launches.length, 1)
})

test('restart without a downloaded package keeps the app open', async(t) => {
  const f = fixture(t)
  assert.match(await f.installError(), /不存在/)
  assert.equal(f.quits, 0)
  assert.equal(f.launches.length, 0)
})

test('restart while downloading is rejected, then a completed download can still install', async(t) => {
  const body = new PassThrough()
  const f = fixture(t, { request: async() => ({ statusCode: 200, headers: {}, body }) })
  const completed = f.download()
  assert.match(await f.installError(), /尚未下载完成/)
  assert.equal(f.quits, 0)
  body.end(sample)
  await completed
  f.emit('quit_update')
  for (let i = 0; !f.quits && i < 100; i++) await delay(10)
  assert.equal(f.quits, 1)
})

for (const [name, change, error] of [
  ['missing', file => fs.unlinkSync(file), /不存在/],
  ['truncated', file => fs.writeFileSync(file, sample.subarray(0, 3)), /不完整/],
  ['empty', file => fs.writeFileSync(file, ''), /不完整/],
  ['directory', file => { fs.unlinkSync(file); fs.mkdirSync(file) }, /不完整/],
  ['same-size tampering', file => fs.writeFileSync(file, Buffer.alloc(sample.length, 42)), /发生变化/],
]) {
  test(`a ${name} installer is rejected before quitting`, async(t) => {
    const f = fixture(t)
    await f.download()
    change(f.findFile())
    assert.match(await f.installError(), error)
    assert.equal(f.quits, 0)
    assert.equal(f.launches.length, 0)
    assert.deepEqual(f.opened, [])
  })
}

test('launch failure keeps the app and verified package available for retry', async(t) => {
  let rejectLaunch = true
  const f = fixture(t, { launch: async() => { if (rejectLaunch) throw new Error('permission denied') } })
  await f.download()
  const file = f.findFile()
  assert.match(await f.installError(), /permission denied/)
  assert.equal(f.quits, 0)
  assert(fs.existsSync(file))
  rejectLaunch = false
  f.emit('quit_update')
  for (let i = 0; !f.quits && i < 100; i++) await delay(10)
  assert.equal(f.quits, 1)
  assert.equal(f.launches.length, 2)
  assert(fs.existsSync(file))
})

for (const [name, bytes, info, expected] of [
  ['wrong digest', sample, { digest: 'sha256:' + '0'.repeat(64) }, /SHA-256/],
  ['short download', sample.subarray(0, 3), {}, /不完整/],
  ['empty download', Buffer.alloc(0), { size: 0 }, /不完整/],
  ['wrong architecture', sample, { fileName: 'LX-M-v9-arm64-Setup.exe' }, /系统架构/],
  ['portable binary', sample, { fileName: 'LX-M-v9-x64-portable.exe' }, /Setup/],
  ['path traversal', sample, { fileName: '../' + fileName }, /文件名无效/],
]) {
  test(`${name} never becomes ready to install`, async(t) => {
    const f = fixture(t, { request: async() => response(bytes) })
    assert.match(await f.download(info, 'update_error'), expected)
    await delay(10)
    assert(!f.events.some(event => event.name == 'update_downloaded'))
    assert.equal(f.findFile(), undefined)
    assert.equal(f.quits, 0)
  })
}

test('H11: packages without an upstream digest are rejected before downloading', async(t) => {
  const f = fixture(t)
  assert.match(await f.download({ digest: '' }, 'update_error'), /UPDATE_DIGEST_REQUIRED/)
  assert.equal(f.requests, 0)
  assert.equal(f.findFile(), undefined)
  assert.equal(f.quits, 0)
})

test('cancelling an active download never publishes a late completed update', async(t) => {
  const body = new PassThrough()
  let first = true
  const f = fixture(t, {
    request: async() => {
      if (!first) return response()
      first = false
      return { statusCode: 200, headers: {}, body }
    },
  })
  f.emit('update_download_update', { downloadUrl: 'https://example.test/update.exe', fileName, size: sample.length, digest: sha256(sample) })
  await delay(10)
  f.emit('update_download_update', null)
  await delay(30)
  assert(!f.events.some(event => event.name == 'update_downloaded'))
  assert.equal(f.findFile(), undefined)
  await f.download()
  f.app.emit('will-quit')
  assert.equal(f.findFile(), undefined)
})

test('ordinary exit cleans only this download and leaves unrelated temporary files intact', async(t) => {
  const f = fixture(t)
  const unrelated = path.join(f.root, fileName)
  fs.writeFileSync(unrelated, 'another file')
  await f.download()
  f.app.emit('will-quit')
  assert.equal(f.findFile(), undefined)
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'another file')
})

function launcherFixture(outcomes) {
  const calls = []
  const checks = []
  const api = loadSource('src/main/modules/winMain/updateInstaller.ts', {
    'node:path': path.win32,
    'node:fs': { constants: fs.constants, promises: { async access(file) { checks.push(file) } } },
    'node:child_process': {
      spawn(command, args, options) {
        const child = new EventEmitter()
        child.pid = 123
        child.unref = () => { child.unreferenced = true }
        calls.push({ command, args, options, child })
        const outcome = outcomes.shift()
        if (outcome?.sync) throw Object.assign(new Error(outcome.code), outcome)
        queueMicrotask(() => outcome ? child.emit('error', Object.assign(new Error(outcome.code), outcome)) : child.emit('spawn'))
        return child
      },
    },
  })
  return { ...api, calls, checks }
}

test('silent launch preserves raw NSIS /D semantics for paths with spaces, Chinese and shell characters', async() => {
  const f = launcherFixture([null])
  const file = "C:\\Temp\\更新 & player's package\\Setup.exe"
  const dir = "D:\\音乐 & player's app"
  await f.launchWindowsInstaller(file, dir, dir + '\\resources')
  assert.equal(f.calls.length, 1)
  const call = f.calls[0]
  assert.equal(call.command, file)
  assert.deepEqual(call.args, ['--updated', '/S', '--force-run', '/D=' + dir])
  assert.equal(call.options.argv0, '"' + file + '"')
  assert.equal(call.options.windowsVerbatimArguments, true)
  assert.equal(call.options.detached, true)
  assert.equal(call.options.windowsHide, true)
  assert.equal(call.options.stdio, 'ignore')
  assert(!call.options.shell)
  assert(call.child.unreferenced)
})

test('a permission error retries through elevate.exe with every silent flag preserved', async() => {
  const f = launcherFixture([{ code: 'EACCES' }, null])
  await f.launchWindowsInstaller('C:\\Temp Files\\Setup.exe', 'D:\\LX Music', 'D:\\LX Music\\resources')
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[1].command, 'D:\\LX Music\\resources\\elevate.exe')
  assert.deepEqual(f.calls[1].args, ['"C:\\Temp Files\\Setup.exe"', '--updated', '/S', '--force-run', '/D=D:\\LX Music'])
  assert.equal(f.checks.length, 1)
})

test('spawn errors reject even when a pid exists, without opening an interactive installer', async() => {
  for (const outcomes of [[{ code: 'ENOENT' }], [{ code: 'EINVAL', sync: true }], [{ code: 'EPERM' }, { code: 'EACCES' }]]) {
    const f = launcherFixture([...outcomes])
    await assert.rejects(f.launchWindowsInstaller('C:\\Temp\\Setup.exe', 'D:\\LX Music', 'D:\\LX Music\\resources'))
    assert.equal(f.calls.length, outcomes.length)
    assert(f.calls.every(call => !call.child.unreferenced))
  }
})

test('invalid installer or target paths are rejected without starting a process', async() => {
  for (const dir of ['relative', 'D:\\app" --other', 'D:\\app\nnext']) {
    const f = launcherFixture([])
    await assert.rejects(f.launchWindowsInstaller('C:\\Temp\\Setup.exe', dir, 'D:\\LX\\resources'), /路径无效/)
    assert.equal(f.calls.length, 0)
  }
})

test('H10: response body stalls terminate the update and remove partial files', async t => {
  const http = require('node:http'); const undici = require('undici')
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-length': sample.length }); res.write(sample.subarray(0, 4)) }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const f = fixture(t, {
    request: async(_url, options) => {
      assert.equal(options.bodyTimeout, 30000)
      return undici.request(`http://127.0.0.1:${server.address().port}`, { signal: options.signal, bodyTimeout: 50, headersTimeout: 1000 })
    },
  })
  assert.match(await f.download({}, 'update_error'), /UND_ERR_BODY_TIMEOUT/)
  assert.equal(f.findFile(), undefined)
})

test('H10: total deadline aborts a body and reports a distinct reason', async t => {
  const body = new PassThrough()
  const f = fixture(t, { deadlineMs: 50, request: async() => ({ statusCode: 200, headers: {}, body }) })
  assert.match(await f.download({}, 'update_error'), /UPDATE_TOTAL_TIMEOUT/)
  assert.equal(body.destroyed, true)
  assert.equal(f.findFile(), undefined)
})
