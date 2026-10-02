const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { test } = require('node:test')
const { createPortableDelta, writeInventory, stageUpdateTools } = require('../build-config/portable-update.cjs')
const { csc, compileProbe, sha256, safeRemove } = require('./helpers/windows-update-fixture.cjs')
const project = path.resolve(__dirname, '..')

async function waitJson(file) {
  for (let i = 0; i < 600; i++) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
    await delay(25)
  }
  throw Error('Timed out waiting for ' + file)
}

for (const scenario of ['differential', 'full-fallback', 'single-file']) test('production updater downloads, replaces and restarts a matching ' + scenario + ' package', { skip: process.platform !== 'win32' || !fs.existsSync(csc), timeout: 60000 }, async(t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-update-electron-'))
  const probes = path.join(root, 'probes')
  fs.mkdirSync(probes)
  const oldExe = compileProbe(probes, 'old')
  const newExe = compileProbe(probes, 'confirm')
  const current = path.join(root, "我原来的音乐 & user's")
  const next = path.join(root, 'next')
  const artifacts = path.join(root, 'artifacts')
  fs.mkdirSync(artifacts)
  const edition = scenario === 'single-file' ? 'single-file' : 'portable'
  const runtimeProject = process.env.LX_TEST_PROJECT ? path.resolve(process.env.LX_TEST_PROJECT) : project
  const win7 = require(path.join(runtimeProject, 'node_modules/electron/package.json')).version.startsWith('22.')
  for (const [directory, exe] of [[current, oldExe], [next, newExe]]) {
    fs.mkdirSync(path.join(directory, 'resources'), { recursive: true })
    fs.copyFileSync(exe, path.join(directory, 'LX-M Music.exe'))
    fs.writeFileSync(path.join(directory, 'resources/app.asar'), Buffer.alloc(2 * 1024 * 1024, 0x72))
    fs.writeFileSync(path.join(directory, 'icudtl.dat'), Buffer.alloc(1024 * 1024, 0x31))
    fs.writeFileSync(path.join(directory, 'resources/lx-update-runtime.json'), JSON.stringify({ schema: 1, appId: 'com.lx-m.music.desktop', edition, arch: 'x64', win7, version: directory === next ? '9.0.0' : '8.0.0' }))
  }
  await stageUpdateTools(current)
  fs.writeFileSync(path.join(current, 'resources/obsolete.dll'), 'obsolete program')
  await writeInventory(current)
  const executable = path.join(current, '我改名后的播放器.exe')
  fs.renameSync(path.join(current, 'LX-M Music.exe'), executable)
  fs.mkdirSync(path.join(current, 'portable/userData'), { recursive: true })
  fs.writeFileSync(path.join(current, 'portable/userData/music.db'), 'my playlist database')
  fs.writeFileSync(path.join(current, 'notes.txt'), 'my notes')
  const modified = fs.openSync(path.join(next, 'resources/app.asar'), 'r+')
  fs.writeSync(modified, Buffer.from('new code'), 0, 8, 1024 * 1024 + 20); fs.closeSync(modified)
  await writeInventory(next)
  const greenName = `LX-M.Music-v9.0.0-${win7 ? 'win7' : 'win'}_x64-green.7z`
  const fullName = edition === 'single-file' ? `LX-M.Music-v9.0.0-${win7 ? 'win7_' : ''}x64-portable.exe` : greenName
  const fullPath = path.join(artifacts, fullName)
  if (edition === 'single-file') fs.copyFileSync(newExe, fullPath)
  else {
    const sevenZip = path.join(current, 'resources/update-tools/7za.exe')
    const packed = spawnSync(sevenZip, ['a', '-t7z', '-mx=1', fullPath, '.'], { cwd: next, windowsHide: true, encoding: 'utf8' })
    assert.equal(packed.status, 0, packed.stdout + packed.stderr)
  }
  const sidecars = edition === 'portable' ? await createPortableDelta(next, artifacts, { version: '9.0.0', arch: 'x64', win7 }) : []
  const files = new Map([fullPath, ...sidecars].map(file => [path.basename(file), fs.readFileSync(file)]))
  const certificate = await require('selfsigned').generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }] })
  const requests = []
  const server = https.createServer({ key: certificate.private, cert: certificate.cert }, (req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'https://localhost').pathname.slice(1))
    const bytes = files.get(name)
    requests.push({ name, range: req.headers.range })
    if (!bytes) { res.writeHead(404); res.end(); return }
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '')
    if (range && scenario !== 'full-fallback') {
      const start = Number(range[1]); const end = Number(range[2])
      res.writeHead(206, { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': end - start + 1 })
      res.end(bytes.subarray(start, end + 1))
    } else {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length }); res.end(bytes)
    }
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  let app
  let closed = false
  let marker
  t.after(async() => {
    if (app && !closed) app.kill()
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    if (marker) {
      assert.equal(fs.realpathSync.native(path.dirname(marker.executable)), fs.realpathSync.native(current))
      try { process.kill(marker.pid) } catch {}
      const updateRoot = path.dirname(marker.planFile)
      await safeRemove(updateRoot, 'lx-m-update-')
    }
    await delay(200)
    await safeRemove(root, 'lx-update-electron-')
  })
  const asset = name => ({ fileName: name, downloadUrl: `https://127.0.0.1:${server.address().port}/${encodeURIComponent(name)}`, size: files.get(name).length, digest: 'sha256:' + sha256(files.get(name)) })
  const info = { ...asset(fullName), version: '9.0.0', edition, desc: '## v9.0.0\n\n- 更新行为测试', history: [], ...(sidecars.length ? { differential: { manifest: asset(path.basename(sidecars[0])), payload: asset(path.basename(sidecars[1])) } } : {}) }
  // Browser automation cleans up the whole Electron process tree on disconnect,
  // including an updater that must survive the old app. Launch this lifecycle
  // fixture directly; the production Vue button, IPC, network and helper run.
  const profile = path.join(root, 'profile')
  fs.mkdirSync(path.join(profile, 'portable'), { recursive: true })
  const wrapper = path.join(root, 'wrapper.cjs')
  const uiResult = path.join(root, 'ui-result.json')
  const config = { runtimeProject, current, executable, cert: certificate.cert, port: server.address().port, info, uiResult }
  fs.writeFileSync(wrapper, `const {app}=require('electron'); const fs=require('fs'); const path=require('path');
const cfg=${JSON.stringify(config)};
app.setAppPath(cfg.runtimeProject); app.getVersion=()=>require(path.join(cfg.runtimeProject,'package.json')).version;
app.setAsDefaultProtocolClient=()=>false; app.removeAsDefaultProtocolClient=()=>false;
const tls=require('node:tls'); const connect=tls.connect;
tls.connect=function(options,...args){ if(options.host==='127.0.0.1'&&Number(options.port)===cfg.port) options={...options,ca:cfg.cert};return connect.call(this,options,...args); };
app.on('web-contents-created',(_,contents)=>{
const loadURL=contents.loadURL.bind(contents);
contents.loadURL=(url,options)=>{const parsed=new URL(url);return loadURL(parsed.origin==='http://localhost:9080'?require('url').pathToFileURL(path.join(cfg.runtimeProject,'dist/index.html')).href+parsed.search:url,options);};
contents.once('did-finish-load',()=>{
if(contents.getURL().startsWith('devtools:'))return;
setTimeout(async()=>{try{
await contents.executeJavaScript("window.lxData.versionInfo.newVersion={version:window.lxData.versionInfo.version,history:[],desc:''};window.lxData.appSetting['common.isAgreePact']=true;window.lxData.appSetting['common.showChangeLog']=false;");
await new Promise(resolve=>setTimeout(resolve,3200));
const getPath=app.getPath.bind(app);app.getPath=name=>name==='exe'?cfg.executable:getPath(name);
Object.defineProperty(app,'isPackaged',{value:true,configurable:true});process.resourcesPath=path.join(cfg.current,'resources');
if(cfg.info.edition==='single-file')process.env.PORTABLE_EXECUTABLE_FILE=cfg.executable;else delete process.env.PORTABLE_EXECUTABLE_FILE;
const result=await contents.executeJavaScript('('+(${JSON.stringify(function(info) {
    window.lxData.appSetting['common.isAgreePact'] = true
    window.lxData.appSetting['common.showChangeLog'] = false
    window.lxData.appSetting['common.showErrorDialog'] = true
    const visit = node => {
      if (!node) return
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (node.component) {
        if ('isShowChangeLog' in node.component.setupState) node.component.setupState.isShowChangeLog = false
        visit(node.component.subTree)
      } else if (Array.isArray(node.children)) node.children.forEach(visit)
    }
    visit(document.querySelector('#root')._vnode)
    window.lxData.versionInfo.newVersion = info
    Object.assign(window.lxData.versionInfo, { isLatest: false, isUnknown: false, reCheck: false, status: 'idle', showModal: true })
    return new Promise(resolve => setTimeout(() => {
      const edition = Array.from(document.querySelectorAll('h3')).find(el => el.textContent.startsWith('当前版本类型：'))?.textContent
      const button = Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === '自动更新')
      const clicked = !!button && !button.disabled
      if (clicked) button.click()
      resolve({ edition, clicked })
    }, 100))
  }.toString())})+')('+JSON.stringify(cfg.info)+')');
fs.writeFileSync(cfg.uiResult,JSON.stringify(result));
setInterval(async()=>{try{const state=await contents.executeJavaScript('JSON.stringify({status:window.lxData.versionInfo.status,error:window.lxData.versionInfo.updateError})');fs.writeFileSync(cfg.uiResult+'.state',state);}catch{}},300);
}catch(error){fs.writeFileSync(cfg.uiResult,JSON.stringify({error:error.message}));}},150);
});});
require(path.join(cfg.runtimeProject,'dist/main.js'));
`)
  const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: profile }
  delete env.ELECTRON_RUN_AS_NODE; delete env.PORTABLE_EXECUTABLE_FILE; delete env.LX_M_UPDATE_CONFIRM
  app = spawn(require(path.join(runtimeProject, 'node_modules/electron')), [wrapper, '-hidden', '-dha'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  app.stdout.on('data', bytes => { output = (output + bytes).slice(-4096) })
  app.stderr.on('data', bytes => { output = (output + bytes).slice(-4096) })
  app.on('close', () => { closed = true })
  const ui = await waitJson(uiResult)
  assert.equal(ui.clicked, true, JSON.stringify(ui) + output)
  assert.equal(ui.edition, '当前版本类型：' + (edition === 'portable' ? '便携版' : '单文件版'))
  for (let i = 0; !closed && i < 800; i++) await delay(25)
  assert(closed, (fs.existsSync(uiResult + '.state') ? fs.readFileSync(uiResult + '.state', 'utf8') : '') + output + '\nRequests: ' + JSON.stringify(requests))
  try { marker = await waitJson(path.join(current, 'started-confirm.json')) } catch (error) {
    const helpers = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('lx-m-update-')).flatMap(name => {
      const directory = path.join(os.tmpdir(), name)
      try {
        const plan = JSON.parse(fs.readFileSync(path.join(directory, 'relaunch.json'), 'utf8'))
        if (plan.root !== current) return []
        return ['relaunch.json.ready', 'relaunch.json.result', 'relaunch.log'].map(name => ({ name, text: fs.existsSync(path.join(directory, name)) ? fs.readFileSync(path.join(directory, name), 'utf8') : '' }))
      } catch { return [] }
    })
    throw Error(error.message + '\nHelper result: ' + JSON.stringify(helpers))
  }
  const result = await waitJson(marker.planFile + '.result')
  assert.equal(result.status, 'complete', JSON.stringify(result))
  assert.equal(result.cleanup, undefined)
  assert.equal(fs.realpathSync.native(marker.executable), fs.realpathSync.native(executable))
  assert.deepEqual(fs.readFileSync(executable), fs.readFileSync(newExe))
  assert.equal(fs.readFileSync(path.join(current, 'portable/userData/music.db'), 'utf8'), 'my playlist database')
  assert.equal(fs.readFileSync(path.join(current, 'notes.txt'), 'utf8'), 'my notes')
  if (scenario === 'differential') {
    assert(requests.some(request => request.range && request.name.endsWith('.bin')))
    assert(!requests.some(request => request.name === fullName), 'successful delta must never download the entire green archive')
  } else assert(requests.some(request => request.name === fullName))
  if (edition === 'portable') assert(!fs.existsSync(path.join(current, 'resources/obsolete.dll')))
})
