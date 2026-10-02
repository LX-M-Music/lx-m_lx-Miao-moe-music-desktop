const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')
const { getWindowsUpdatePriority } = load()('src/common/utils/update.ts')

test('package selection isolates installed, folder and single-file editions across every Windows architecture/runtime', async() => {
  const names = []
  for (const win7 of [false, true]) for (const arch of ['x64', 'x86', 'arm64', 'x86_64']) {
    for (const suffix of ['Setup.exe', 'portable.exe']) names.push(`LX-M.Music-v9.0.0-${win7 ? 'win7_' : ''}${arch}-${suffix}`)
    for (const suffix of ['green.7z', 'green.zip', 'green-update.json', 'green-update.bin']) names.push(`LX-M.Music-v9.0.0-${win7 ? 'win7' : 'win'}_${arch}-${suffix}`)
  }
  const assets = names.map(name => ({ name, browser_download_url: 'https://example.test/' + name, digest: 'sha256:' + 'a'.repeat(64), size: 1 }))
  for (const edition of ['installed', 'portable', 'single-file']) for (const arch of ['x64', 'ia32', 'arm64']) for (const win7 of [false, true]) {
    const runtime = { edition, arch, win7 }
    const api = load({
      './ipc': { getUpdateRuntime: async() => runtime },
      './request': { httpGet: (_, __, reply) => reply(null, { statusCode: 200 }, { tag_name: 'v9.0.0', assets: [...assets].reverse() }) },
    })('src/renderer/utils/update.js')
    const info = await api.getVersionInfo()
    const suffix = arch === 'ia32' ? 'x86' : arch
    const expected = edition === 'portable'
      ? `LX-M.Music-v9.0.0-${win7 ? 'win7' : 'win'}_${suffix}-green.zip`
      : `LX-M.Music-v9.0.0-${win7 ? 'win7_' : ''}${suffix}-${edition === 'installed' ? 'Setup' : 'portable'}.exe`
    assert.equal(info.fileName, expected, JSON.stringify(runtime))
    assert.equal(info.edition, edition)
    if (edition === 'portable') {
      assert.equal(getWindowsUpdatePriority(info.differential.manifest.fileName, runtime, 'manifest'), 2)
      assert.equal(getWindowsUpdatePriority(info.differential.payload.fileName, runtime, 'payload'), 2)
    } else assert.equal(info.differential, undefined)
    for (const other of names.filter(name => name.includes(win7 ? '-win7_' : '-win_') && name.endsWith('-green.7z'))) {
      if (edition !== 'portable') assert.equal(getWindowsUpdatePriority(other, runtime), 0)
    }
  }
})

test('unknown architecture labels and ambiguous bundles fail closed, while x86_64 is only a lower-priority installed/single-file fallback', () => {
  for (const edition of ['installed', 'portable', 'single-file']) {
    const runtime = { edition, arch: 'x64', win7: false }
    for (const name of ['LX-M-Setup.exe', 'LX-M-portable.exe', 'LX-M-green.7z', 'LX-M-x64-arm64-Setup.exe', '../LX-M-x64-Setup.exe']) assert.equal(getWindowsUpdatePriority(name, runtime), 0, name)
    assert.equal(getWindowsUpdatePriority('LX-M-x86_64-Setup.exe', runtime), edition === 'installed' ? 1 : 0)
    assert.equal(getWindowsUpdatePriority('LX-M-x86_64-portable.exe', runtime), edition === 'single-file' ? 1 : 0)
    assert.equal(getWindowsUpdatePriority('LX-M-win_x86_64-green.7z', runtime), 0)
  }
  assert.equal(getWindowsUpdatePriority('LX-M-x64-Setup.exe', { edition: 'development', arch: 'x64', win7: false }), 0)
})

test('an unavailable matching edition never falls through to another edition or the normal/Win7 lane', async() => {
  const api = load({
    './ipc': { getUpdateRuntime: async() => ({ edition: 'portable', arch: 'x64', win7: true }) },
    './request': { httpGet: (_, __, reply) => reply(null, { statusCode: 200 }, { tag_name: 'v9.0.0', assets: [{ name: 'LX-M-x64-Setup.exe' }, { name: 'LX-M-win_x64-green.7z' }] }) },
  })('src/renderer/utils/update.js')
  assert.equal((await api.getVersionInfo()).downloadUrl, '')
})

test('runtime detection prefers explicit package markers and single-file launcher metadata over a local data folder', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-edition-test-'))
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }) })
  fs.mkdirSync(path.join(root, 'resources'))
  fs.mkdirSync(path.join(root, 'portable'))
  const code = ts.transpileModule(fs.readFileSync('src/main/modules/winMain/updateRuntime.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const runtime = (env = {}, packaged = true, electron = '43.7.3', arch = 'x64') => {
    const module = { exports: {} }
    vm.runInNewContext(code, {
      exports: module.exports,
      process: { arch, versions: { electron }, env },
      require: name => name === 'electron' ? { app: { isPackaged: packaged, getPath: () => path.join(root, 'LX-M Music.exe') } }
        : name === '@common/constants' ? { APP_NAME: 'LX-M Music' } : require(name),
    })
    return module.exports.getUpdateRuntime()
  }
  assert.equal(runtime().edition, 'portable')
  fs.writeFileSync(path.join(root, 'Uninstall LX-M Music.exe'), 'marker')
  assert.equal(runtime().edition, 'installed')
  assert.equal(runtime({ PORTABLE_EXECUTABLE_FILE: path.join(root, '单文件.exe') }).edition, 'single-file')
  fs.writeFileSync(path.join(root, 'resources/lx-update-runtime.json'), JSON.stringify({ schema: 1, appId: 'com.lx-m.music.desktop', edition: 'portable' }))
  assert.equal(runtime().edition, 'portable')
  assert.equal(runtime({}, false).edition, 'development')
  assert.equal(runtime({}, true, '22.3.27', 'ia32').win7, true)
  assert.equal(runtime({}, true, '22.3.27', 'ia32').arch, 'ia32')
  fs.writeFileSync(path.join(root, 'resources/lx-update-runtime.json'), JSON.stringify({ schema: 1, appId: 'com.lx-m.music.desktop', edition: 'single-file' }))
  assert.equal(runtime().edition, 'development', 'a missing outer launcher path must not target a temporary executable')
})
