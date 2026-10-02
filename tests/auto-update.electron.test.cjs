const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const { test } = require('node:test')
const { launch } = require('./helpers/motion-fixture.cjs')
const load = require('./helpers/load-typescript.cjs')

const project = path.resolve(__dirname, '..')
const runtimeProject = process.env.LX_TEST_PROJECT ? path.resolve(process.env.LX_TEST_PROJECT) : project
const legacyRuntime = require(path.join(runtimeProject, 'node_modules/electron/package.json')).version.startsWith('22.')
const cache = path.join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache', 'nsis')
const nsis = process.env.LX_TEST_MAKENSIS || (fs.existsSync(cache) && fs.readdirSync(cache)
  .map(dir => path.join(cache, dir, 'Bin', 'makensis.exe')).find(file => fs.existsSync(file)))

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lx-update-nsis-测试 & user's "))
  const exe = path.join(root, `LX-M Music-v9.0.0-${legacyRuntime ? 'win7_' : ''}x64-Setup.exe`)
  const result = path.join(root, 'nsis-result.txt')
  const installDirectory = path.join(root, "音乐 & user's app")
  const cleanup = []
  fs.mkdirSync(installDirectory)
  const compile = childProcess.spawnSync(nsis, [
    '/V2', '/DOUTPUT_FILE=' + exe, '/DPROBE_RESULT=' + result, path.join(__dirname, 'fixtures/update-installer.nsi'),
  ], { windowsHide: true, encoding: 'utf8', timeout: 30000 })
  assert.equal(compile.status, 0, compile.error?.message || compile.stdout + compile.stderr)
  t.after(async() => {
    for (const dispose of cleanup.reverse()) await dispose()
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert(path.basename(root).startsWith('lx-update-nsis-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 })
  })
  const readResult = async() => {
    for (let i = 0; !fs.existsSync(result) && i < 200; i++) await delay(25)
    assert(fs.existsSync(result), 'NSIS must finish silently with both update/relaunch flags')
    // File creation precedes its last write by a few milliseconds.
    for (let i = 0; i < 100; i++) {
      const lines = fs.readFileSync(result).toString('utf16le').split('\r\n')
      if (lines[2] == 'silent=1;updated=1;force-run=1') return lines
      await delay(10)
    }
    throw Error('NSIS probe did not finish writing')
  }
  return { root, exe, result, installDirectory, readResult, cleanup }
}

test('real NSIS receives the exact directory and silent/relaunch flags through CreateProcess', {
  skip: process.platform != 'win32' || !nsis,
  timeout: 30000,
}, async(t) => {
  const f = fixture(t)
  const api = load({ 'node:child_process': childProcess, 'node:fs': fs, 'node:path': path })(path.join(project, 'src/main/modules/winMain/updateInstaller.ts'))
  await api.launchWindowsInstaller(f.exe, f.installDirectory, path.join(f.installDirectory, 'resources'))
  const lines = await f.readResult()
  assert.equal(lines[0], f.installDirectory)
  assert(lines[1].startsWith('"' + f.exe + '" '))
  // NSIS consumes /D before exposing $CMDLINE; $INSTDIR above is its parsed value.
  assert(lines[1].includes('--updated /S --force-run'))
})

test('update choices require a click, show progress, cancel downloads and silently install without a second prompt', {
  skip: process.platform != 'win32' || !nsis,
  timeout: 60000,
}, async(t) => {
  const f = fixture(t)
  const bytes = fs.readFileSync(f.exe)
  fs.writeFileSync(path.join(f.installDirectory, 'Uninstall LX-M Music.exe'), 'installed-edition test marker')
  const responses = []
  const slice = Math.floor(bytes.length / 3)
  const certificate = await require('selfsigned').generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }] })
  const server = https.createServer({ key: certificate.private, cert: certificate.cert }, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length })
    res.write(bytes.subarray(0, slice))
    const timer = setTimeout(() => { if (!res.destroyed) res.write(bytes.subarray(slice, slice * 2)) }, 650)
    res.on('close', () => { clearTimeout(timer) })
    responses.push(res)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const fixtureApp = await launch({ profilePath: path.join(f.root, 'profile'), rendererPath: path.join(project, 'dist/index.html') })
  const { app, page, errors } = fixtureApp
  // Trust only this fixture's certificate/port; production still verifies TLS.
  await app.evaluate((_, { cert, port }) => {
    const tls = process.mainModule.require('node:tls'); const connect = tls.connect
    tls.connect = function(options, ...args) {
      if (options.host === '127.0.0.1' && Number(options.port) === port) options = { ...options, ca: cert }
      return connect.call(this, options, ...args)
    }
  }, { cert: certificate.cert, port: server.address().port })
  let closed = false
  let downloadedFiles = []
  app.on('close', () => { closed = true })
  f.cleanup.push(async() => {
    if (!closed) await app.close().catch(() => {})
    server.closeAllConnections()
    await new Promise(resolve => { server.close(resolve) })
    for (const file of downloadedFiles) {
      const directory = path.dirname(file)
      assert.equal(path.dirname(directory), os.tmpdir())
      assert(path.basename(directory).startsWith('lx-m-update-'))
      try { fs.unlinkSync(file) } catch {}
      try { fs.rmdirSync(directory) } catch {}
    }
  })
  await app.evaluate(({ app }, exe) => {
    const getPath = app.getPath.bind(app)
    app.getPath = name => name == 'exe' ? exe : getPath(name)
    Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
    const fs = process.mainModule.require('original-fs')
    const mkdtemp = fs.mkdtempSync
    global.__updateTestDirectories = []
    fs.mkdtempSync = (...args) => {
      const directory = mkdtemp(...args)
      if (process.mainModule.require('path').basename(directory).startsWith('lx-m-update-')) global.__updateTestDirectories.push(directory)
      return directory
    }
  }, path.join(f.installDirectory, 'LX-M Music.exe'))
  await page.evaluate(info => {
    window.__updateTestOpenedUrls = []
    require('electron').shell.openExternal = async url => { window.__updateTestOpenedUrls.push(url) }
    const state = window.lxData.versionInfo
    Object.assign(state.newVersion, info)
    Object.assign(state, { isLatest: false, isUnknown: false, reCheck: false, status: 'idle', showModal: true })
    window.lxData.appSetting['common.tryAutoUpdate'] = true
    window.lxData.appSetting['common.showErrorDialog'] = true
  }, {
    version: '9.0.0',
    desc: '## v9.0.0\n\n### 修复\n\n- 更新测试',
    history: [],
    fileName: path.basename(f.exe),
    downloadUrl: `https://127.0.0.1:${server.address().port}/Setup.exe`,
    size: bytes.length,
    digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex'),
  })
  const auto = () => page.getByRole('button', { name: '自动更新', exact: true })
  const later = () => page.getByRole('button', { name: '暂不更新', exact: true })
  const manual = () => page.getByRole('button', { name: '手动更新', exact: true })
  const show = async() => {
    await page.evaluate(() => { window.lxData.versionInfo.showModal = true })
    await auto().waitFor()
  }
  const checkProgress = async() => {
    await page.waitForFunction(() => {
      const value = Number(document.querySelector('[data-update-progress] [role="progressbar"]')?.getAttribute('aria-valuenow'))
      return value > 0 && value < 100
    })
    assert(await auto().isDisabled())
    assert(await later().isEnabled())
    assert(await manual().isEnabled())
    assert.equal(closed, false)
    assert.equal(fs.existsSync(f.result), false)
  }
  await auto().waitFor()
  await delay(3200) // Includes the startup version check with the old automatic-download preference enabled.
  assert.equal(responses.length, 0)
  assert.equal(await page.getByRole('progressbar', { name: '更新进度' }).count(), 0)
  await later().click()
  await auto().waitFor({ state: 'hidden' })
  assert.equal(responses.length, 0)
  await show()
  await manual().click()
  await auto().waitFor({ state: 'hidden' })
  assert.equal(responses.length, 0)
  assert.deepEqual(await page.evaluate(() => window.__updateTestOpenedUrls), ['https://github.com/Miao-moe/lx-m_lx-Miao-moe-music-desktop/releases'])

  await show()
  await auto().click()
  await checkProgress()
  // A refused or pending cancellation must not look like a successful stop.
  await page.evaluate(() => {
    const ipc = require('electron').ipcRenderer
    const invoke = ipc.invoke.bind(ipc)
    ipc.invoke = (channel, ...args) => {
      if (channel !== 'winMain_update_cancel_update') return invoke(channel, ...args)
      ipc.invoke = invoke
      return new Promise(resolve => { window.__updateCancelReply = resolve })
    }
  })
  await later().click()
  await page.waitForFunction(() => typeof window.__updateCancelReply === 'function')
  assert(await auto().isVisible())
  assert(await later().isDisabled())
  assert(await manual().isDisabled())
  assert.equal(await page.evaluate(() => window.lxData.versionInfo.status), 'downloading')
  await page.evaluate(() => { window.__updateCancelReply(false) })
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === '暂不更新')?.disabled)
  assert(await auto().isVisible())
  assert.equal(responses[0].destroyed, false)
  await fs.promises.mkdir(path.join(project, 'logs/update-progress'), { recursive: true })
  await page.screenshot({ path: path.join(project, 'logs/update-progress/download.png') })
  await later().click()
  await auto().waitFor({ state: 'hidden' })
  for (let i = 0; !responses[0].destroyed && i < 100; i++) await delay(10)
  assert(responses[0].destroyed)
  await show()
  await auto().click()
  await checkProgress()
  await manual().click()
  await auto().waitFor({ state: 'hidden' })
  for (let i = 0; !responses[1].destroyed && i < 100; i++) await delay(10)
  assert(responses[1].destroyed)
  assert.equal(fs.existsSync(f.result), false)
  assert.equal((await page.evaluate(() => window.__updateTestOpenedUrls)).length, 2)

  // Hold status delivery so the user can cancel while the main process has
  // already entered verification, then deliver the stale events after the ACK.
  await show()
  await auto().click()
  await checkProgress()
  const window = await app.browserWindow(page)
  await window.evaluate(window => {
    const fs = process.mainModule.require('original-fs')
    const originalLstat = fs.promises.lstat
    const originalSend = window.webContents.send.bind(window.webContents)
    const held = []
    let reached
    global.__updateVerificationReady = new Promise(resolve => { reached = resolve })
    const gate = new Promise(resolve => { global.__updateVerificationRelease = resolve })
    fs.promises.lstat = async(...args) => {
      const stat = await originalLstat(...args)
      if (String(args[0]).includes('lx-m-update-') && String(args[0]).endsWith('.exe')) {
        reached()
        await gate
      }
      return stat
    }
    window.webContents.send = (channel, ...args) => {
      if (channel === 'winMain_update_downloaded' || (channel === 'winMain_update_progress' && args[0]?.phase !== 'downloading')) {
        held.push([channel, ...args])
      } else originalSend(channel, ...args)
    }
    global.__updateRestoreDelivery = () => {
      fs.promises.lstat = originalLstat
      window.webContents.send = originalSend
      for (const args of held.splice(0)) originalSend(...args)
    }
  })
  await window.dispose()
  try {
    responses.at(-1).end(bytes.subarray(slice * 2))
    await app.evaluate(() => global.__updateVerificationReady)
    assert.equal(await page.evaluate(() => window.lxData.versionInfo.status), 'downloading')
    await later().click()
    assert(await auto().isVisible())
    assert(await later().isDisabled())
    await app.evaluate(() => { global.__updateVerificationRelease() })
    await auto().waitFor({ state: 'hidden' })
  } finally {
    await app.evaluate(() => {
      global.__updateVerificationRelease()
      global.__updateRestoreDelivery()
    })
  }
  await page.evaluate(() => new Promise(resolve => { window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)) }))
  assert.equal(await page.evaluate(() => window.lxData.versionInfo.status), 'idle')
  assert.equal(fs.existsSync(f.result), false)
  assert.equal(closed, false)

  await show()
  await page.evaluate(() => { window.lxData.versionInfo.status = 'downloaded' })
  await auto().click()
  await page.getByRole('alert').filter({ hasText: '更新安装包不存在' }).waitFor()
  assert.equal(closed, false, 'failed preparation must leave the application running')
  await auto().click()
  await checkProgress()
  downloadedFiles = await app.evaluate(() => global.__updateTestDirectories.map(dir => {
    const fs = process.mainModule.require('original-fs')
    const path = process.mainModule.require('path')
    return fs.existsSync(dir) ? fs.readdirSync(dir).map(name => path.join(dir, name)) : []
  }).flat())
  assert.equal(downloadedFiles.length, 1)
  const closing = app.waitForEvent('close')
  responses.at(-1).end(bytes.subarray(slice * 2))
  await closing
  const lines = await f.readResult()
  assert.equal(lines[0], f.installDirectory)
  assert(fs.existsSync(downloadedFiles[0]), 'quitting must not delete the running installer')
  assert.deepEqual(errors, [])
})
