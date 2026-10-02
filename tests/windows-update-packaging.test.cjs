const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const { Arch } = require('electron-builder')
const { sha256, safeRemove } = require('./helpers/windows-update-fixture.cjs')
const portable = require('../build-config/portable-update.cjs')

test('actual packaging configuration writes the correct edition/architecture marker and generates green sidecars after final artifacts', { skip: process.platform !== 'win32', timeout: 30000 }, async(t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-update-packaging-'))
  t.after(() => safeRemove(root, 'lx-update-packaging-'))
  for (const [type, arch, win7, edition] of [
    ['setup', 'x64', false, 'installed'], ['green', 'arm64', false, 'portable'],
    ['portable', 'x86_64', false, 'single-file'], ['win7_green', 'x86', true, 'portable'],
  ]) {
    const outDir = path.join(root, type)
    fs.mkdirSync(outDir)
    let completion
    let buildOptions
    const contexts = []
    const builder = { Arch, build(options) {
      buildOptions = options
      completion = (async() => {
        for (const actual of [options.x64 && 'x64', options.ia32 && 'ia32', options.arm64 && 'arm64'].filter(Boolean)) {
          const appOutDir = path.join(outDir, actual)
          fs.mkdirSync(path.join(appOutDir, 'resources'), { recursive: true })
          fs.writeFileSync(path.join(appOutDir, 'LX-M Music.exe'), 'MZ unsigned application')
          fs.writeFileSync(path.join(appOutDir, 'resources/app.asar'), 'application contents')
          const context = { appOutDir, arch: Arch[actual], electronPlatformName: 'win32', packager: { appInfo: { version: '9.0.0' } } }
          contexts.push(context)
          await options.config.afterPack(context)
          // Simulate code signing after afterPack. The emitted sidecar must
          // describe these final bytes, not the earlier unsigned executable.
          fs.appendFileSync(path.join(appOutDir, 'LX-M Music.exe'), ' signed bytes')
        }
        return options.config.afterAllArtifactBuild?.({ outDir }) ?? []
      })()
      return completion
    } }
    const dispatch = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../build-config/build-pack.js'), 'utf8'), {
      process: { argv: ['node', 'build-pack.js', 'target=win', 'arch=' + arch, 'type=' + type], env: {} },
      console: { log() {} },
      require(name) {
        if (name === 'electron-builder') return builder
        if (name === '../package.json') return { version: '9.0.0', lxBuildTarget: win7 ? 'win7' : undefined }
        if (name === './win7/profile.cjs') return { electron: '22.3.27' }
        if (name === 'electron/package.json') return { version: win7 ? '22.3.27' : '43.7.3' }
        if (name === './build-before-pack') return async() => {}
        if (name === './build-after-pack') return require('../build-config/build-after-pack.js')
        if (name === './portable-update.cjs') return portable
        if (name.startsWith('node:')) return require(name)
        throw Error('Unexpected dependency: ' + name)
      },
    })
    await dispatch
    assert(completion, 'configuration must dispatch its builder')
    const artifacts = await completion
    assert.equal(buildOptions.publish, 'never')
    for (const context of contexts) {
      const marker = JSON.parse(fs.readFileSync(path.join(context.appOutDir, 'resources/lx-update-runtime.json'), 'utf8'))
      assert.deepEqual(marker, { schema: 1, appId: 'com.lx-m.music.desktop', edition, arch: Arch[context.arch], win7, version: '9.0.0' })
      assert(fs.existsSync(path.join(context.appOutDir, 'resources/update-tools/7za.exe')))
    }
    if (edition !== 'portable') assert.deepEqual(artifacts, [])
    else {
      assert.equal(artifacts.length, contexts.length * 2)
      for (const manifestPath of artifacts.filter(name => name.endsWith('.json'))) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        const context = contexts.find(item => Arch[item.arch] === manifest.arch)
        const entry = manifest.files.find(file => file.path === 'LX-M Music.exe')
        assert.equal(entry.sha256, sha256(fs.readFileSync(path.join(context.appOutDir, entry.path))))
        assert.equal(manifest.win7, win7)
        assert.equal(manifest.edition, 'portable')
        assert.equal(manifest.payload.sha256, sha256(fs.readFileSync(path.join(outDir, manifest.payload.fileName))))
      }
    }
  }
})
