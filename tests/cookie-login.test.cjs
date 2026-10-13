const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')
const core = loader()('src/common/cookieLogin.ts')
const names = { wy: 'MUSIC_U', tx: 'qqmusic_key', kg: 'KuGoo', kw: 'userid', mg: 'mg_auth_sid' }
const credentials = {
  wy: [{ name: 'MUSIC_U', value: 'test-session' }],
  tx: [{ name: 'uin', value: 'o0000007' }, { name: 'qqmusic_key', value: 'test-session' }],
  kg: [{ name: 'KuGoo', value: 'KugooID%3D7%26t%3Dtest-session' }],
  kw: [{ name: 'userid', value: '7' }, { name: 'sid', value: 'test-session' }],
  mg: [{ name: 'mg_auth_sid', value: 'test-session' }],
}
const cookieFor = source => core.serializeCookies(credentials[source], new Map())
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const ready = async predicate => { for (let i = 0; i < 100 && !predicate(); i++) await delay(5); assert(predicate(), 'fixture did not initialize') }
const channels = { cookie_login: 'browser', cookie_login_embedded: 'embedded', cookie_login_embedded_cancel: 'cancel' }

test('all five platforms require usable authentication, including storage-only Migu and WeChat QQ login', () => {
  for (const source of Object.keys(credentials)) {
    const definition = core.COOKIE_LOGIN_DEFINITIONS[source]
    assert(core.hasLoginState(credentials[source], new Map(), definition), source)
    assert.equal(core.hasLoginState(credentials[source].map(cookie => ({ ...cookie, value: '' })), new Map(), definition), false, source)
  }
  assert(core.hasLoginState([], new Map([['mg_auth_sid', 'test-session'], ['mg_auth_uid', '7']]), core.COOKIE_LOGIN_DEFINITIONS.mg))
  assert(core.hasLoginState([{ name: 'pacmtoken', value: 'test-token' }], new Map(), core.COOKIE_LOGIN_DEFINITIONS.mg))
  assert(core.hasLoginState([], new Map([['mg_auth_pacmtoken', 'test-token']]), core.COOKIE_LOGIN_DEFINITIONS.mg))
  assert(core.hasLoginState([{ name: 'wxuin', value: '7' }, { name: 'qqmusic_key', value: 'test-session' }], new Map(), core.COOKIE_LOGIN_DEFINITIONS.tx))
  assert.equal(core.hasLoginState([{ name: 'userid', value: '0' }], new Map(), core.COOKIE_LOGIN_DEFINITIONS.kw), false)
  assert.equal(core.hasLoginState([{ name: 'KuGoo', value: 'KugooID=7&t=' }], new Map(), core.COOKIE_LOGIN_DEFINITIONS.kg), false)
  assert.equal(core.isMusicSource('toString'), false)
})

test('credentials from unrelated domains and empty cookies cannot replace a collected login', () => {
  assert.deepEqual(core.getRelevantCookies([
    { name: 'MUSIC_U', value: 'good', domain: '.music.163.com' },
    { name: 'MUSIC_U', value: 'bad', domain: '163.com.attacker.example' },
  ], core.COOKIE_LOGIN_DEFINITIONS.wy).map(cookie => cookie.value), ['good'])
  assert.equal(core.serializeCookies([{ name: 'MUSIC_U', value: 'good' }, { name: 'MUSIC_U', value: '' }], new Map()), 'MUSIC_U=good')
  assert(core.hasLoginState([{ name: 'MUSIC_U', value: 'good' }, { name: 'MUSIC_U', value: '' }], new Map(), core.COOKIE_LOGIN_DEFINITIONS.wy))
})

function embeddedFixture({ gate } = {}) {
  const handlers = new Map()
  const ipcMain = new EventEmitter()
  const sessions = new Map()
  const windows = []
  const browserCalls = []
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false
      this.webContents = new EventEmitter()
      this.webContents.mainFrame = { url: 'about:blank', frames: [], executeJavaScript: async script => script.includes('fetch(') ? JSON.stringify({ data: { myCreatedMusicLists: { createdMusicLists: [] } } }) : JSON.stringify(this.storage ?? {}) }
      this.webContents.setWindowOpenHandler = callback => { this.open = callback }
      this.webContents.getURL = () => this.webContents.mainFrame.url
      this.webContents.executeJavaScript = this.webContents.mainFrame.executeJavaScript
      windows.push(this)
    }
    isDestroyed() { return this.destroyed }
    setMenuBarVisibility() {}
    show() {}
    async loadURL(url) { this.webContents.mainFrame.url = url; this.emit('ready-to-show') }
    destroy() { if (this.destroyed) return; this.destroyed = true; this.webContents.emit('destroyed'); this.emit('closed') }
    close() { this.destroy() }
    static fromWebContents(contents) { return windows.find(win => win.webContents === contents) }
  }
  const imports = {
    electron: { BrowserWindow: Window, ipcMain, session: { fromPartition(partition) {
      if (!sessions.has(partition)) sessions.set(partition, { values: [], async clearStorageData() { if (gate) await gate }, async clearCache() {}, cookies: { get: async() => sessions.get(partition).values } })
      return sessions.get(partition)
    } } },
    '@common/mainIpc': { mainHandle: (channel, fn) => handlers.set(channel, fn) },
    '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: channels },
    '@main/utils/cookieLoginWindow': loader()('src/main/utils/cookieLoginWindow.ts'),
    './cookieLogin': { loginCookieInBrowser: async source => { browserCalls.push(source); return { cookie: cookieFor(source) } }, miguPlaylistsScript: 'fetch()', parseMiguPlaylists: () => [] },
  }
  loader(imports)('src/main/modules/winMain/rendererEvent/cookieLoginEmbedded.ts').default()
  const invoke = (channel, source) => handlers.get(channel)({ params: source })
  const authenticate = source => { sessions.get('cookie-login-embedded:' + source).values = credentials[source].map(cookie => ({ ...cookie, domain: core.COOKIE_LOGIN_DEFINITIONS[source].domains[0] })) }
  const chrome = (win, action) => ipcMain.emit('cookie-login-chrome-action', { sender: win.webContents, senderFrame: win.webContents.mainFrame }, action)
  return { invoke, windows, sessions, authenticate, Window, chrome, browserCalls }
}

test('embedded login collects all five platforms, resolves duplicates once, and cleans every window', async() => {
  const f = embeddedFixture()
  const tasks = Object.keys(credentials).map(source => f.invoke('embedded', source))
  const duplicate = f.invoke('embedded', 'wy')
  await ready(() => f.windows.length === 5)
  assert.equal(f.windows.filter(win => win.options.title === '登录网易云音乐').length, 1)
  for (const source of Object.keys(credentials)) f.authenticate(source)
  const results = await Promise.all(tasks)
  assert.equal((await duplicate).cookie, results[0].cookie)
  results.forEach((result, index) => assert(result.cookie.includes(names[Object.keys(credentials)[index]] + '=')))
  assert(f.windows.every(win => win.isDestroyed()))
})

test('embedded Migu captures local/session authentication without requiring a cookie first', async() => {
  const f = embeddedFixture()
  const task = f.invoke('embedded', 'mg')
  await ready(() => f.windows.length === 1)
  f.windows[0].storage = { mg_auth_sid: 'test-session', mg_auth_uid: '7', mg_auth_pacmtoken: 'test-token' }
  const result = await task
  assert(result.cookie.includes('mg_auth_sid=test-session')); assert(result.cookie.includes('mg_auth_pacmtoken=test-token'))
  assert.deepEqual(result.playlists, [])
})

test('cancelling before the embedded session initializes never opens a late login window', async() => {
  let release
  const f = embeddedFixture({ gate: new Promise(resolve => { release = resolve }) })
  const rejected = assert.rejects(f.invoke('embedded', 'wy'), /COOKIE_LOGIN_CANCELLED/)
  await f.invoke('cancel', 'wy'); release(); await rejected; await delay(10)
  assert.equal(f.windows.length, 0)
})

test('closing and retrying release the task; authorization popups use the same close/browser controls', async() => {
  const f = embeddedFixture()
  const rejected = assert.rejects(f.invoke('embedded', 'tx'), /COOKIE_LOGIN_CANCELLED/)
  await ready(() => f.windows.length === 1)
  const child = new f.Window(f.windows[0].options)
  f.windows[0].webContents.emit('did-create-window', child)
  f.chrome(child, 'close'); assert(child.isDestroyed()); assert(!f.windows[0].isDestroyed())
  f.windows[0].close(); await rejected
  const next = f.invoke('embedded', 'tx')
  await ready(() => f.windows.length === 3)
  f.chrome(f.windows[2], 'browser')
  assert.equal((await next).cookie, cookieFor('tx')); assert.deepEqual(f.browserCalls, ['tx'])
  assert(f.windows.every(win => win.isDestroyed()))
})

test('only registered login windows follow web authorization redirects, without granting file navigation', () => {
  const registry = loader()('src/main/utils/cookieLoginWindow.ts')
  const contents = new EventEmitter()
  assert.equal(registry.canNavigateCookieLoginWindow(contents, 'https://graph.qq.com/oauth'), false)
  registry.registerCookieLoginWindow(contents)
  assert(registry.canNavigateCookieLoginWindow(contents, 'https://graph.qq.com/oauth'))
  assert.equal(registry.canNavigateCookieLoginWindow(contents, 'file:///C:/secret'), false)
  assert.equal(registry.canNavigateCookieLoginWindow(contents, 'javascript:alert(1)'), false)
  contents.emit('destroyed')
  assert.equal(registry.canNavigateCookieLoginWindow(contents, 'https://y.qq.com/'), false)
})

test('browser login collects all five platforms, Migu storage, and removes its isolated profiles', async() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-cookie-browser-unit-'))
  const launched = []
  const handlers = new Map()
  const create = async profile => {
    const context = new EventEmitter()
    let source
    const frame = { url: () => core.COOKIE_LOGIN_DEFINITIONS[source].url, evaluate: async() => JSON.stringify(source === 'mg' ? { mg_auth_sid: 'test-session', mg_auth_uid: '7' } : {}) }
    const page = { frames: () => [frame], url: frame.url, goto: async url => { source = Object.keys(credentials).find(key => core.COOKIE_LOGIN_DEFINITIONS[key].url === url) }, evaluate: async() => JSON.stringify({ data: { myCreatedMusicLists: { createdMusicLists: [] } } }) }
    context.pages = () => [page]
    context.cookies = async() => source === 'mg' ? [] : credentials[source].map(cookie => ({ ...cookie, domain: core.COOKIE_LOGIN_DEFINITIONS[source].domains[0] }))
    context.close = async() => { context.emit('close'); context.closed = true }
    launched.push({ context, profile })
    return context
  }
  try {
    loader({
      electron: { app: { getApplicationInfoForProtocol: async() => ({ name: 'Chrome', path: process.execPath }), getPath: () => root } },
      'playwright-core': { chromium: { launchPersistentContext: create } },
      './cookieLoginFirefox': {},
      '@common/mainIpc': { mainHandle: (channel, fn) => handlers.set(channel, fn) },
      '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: channels },
    })('src/main/modules/winMain/rendererEvent/cookieLogin.ts').default()
    for (const source of Object.keys(credentials)) assert((await handlers.get('browser')({ params: source })).cookie.includes(names[source] + '='))
    assert(launched.every(({ context, profile }) => context.closed && !fs.existsSync(profile)))
    assert.equal(new Set(launched.map(item => item.profile)).size, 5)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

function rendererFixture({ embedded, browser, saveError } = {}) {
  const appSetting = {}
  const saved = []
  let cancel = () => {}
  const manager = loader({ '@renderer/store/setting': { appSetting } })('src/renderer/utils/cookieManager.ts')
  const coordinator = loader({
    '@common/utils/vueTools': { reactive: value => value },
    '@renderer/utils/cookieManager': manager,
    '@renderer/utils/ipc': { loginCookieEmbedded: embedded ?? (async source => ({ cookie: cookieFor(source) })), loginCookie: browser ?? (async source => ({ cookie: cookieFor(source) })), cancelLoginCookieEmbedded: async() => { cancel(); return true } },
    './setting': { appSetting, updateSetting: async value => { if (saveError) throw saveError; saved.push(value); Object.assign(appSetting, value) } },
    './loginStatus': { COOKIE_SETTING_KEYS: Object.fromEntries(Object.keys(credentials).map(source => [source, 'cookie.' + source])), refreshLoginStatus() {} },
  })('src/renderer/store/platformLogin.ts')
  return { ...coordinator, appSetting, saved, setCancel: callback => { cancel = callback } }
}

test('both renderer entry points save valid credentials for all five platforms', async() => {
  const f = rendererFixture()
  for (const source of Object.keys(credentials)) for (const mode of ['embedded', 'browser']) {
    assert.equal((await f.loginPlatform(source, mode)).cookie, cookieFor(source))
    assert.equal(f.appSetting['cookie.' + source], cookieFor(source))
    assert.equal(f.platformLoginStates[source].mode, undefined)
    assert.equal(f.platformLoginStates[source].success, true)
  }
  assert.equal(f.saved.length, 10)
})

test('switching to browser suppresses cancellation and cannot save a late embedded result', async() => {
  let endEmbedded
  const f = rendererFixture({ embedded: () => new Promise(resolve => { endEmbedded = resolve }) })
  const old = f.loginPlatform('wy', 'embedded')
  f.setCancel(() => endEmbedded({ cookie: 'MUSIC_U=stale' }))
  assert.equal((await f.loginPlatform('wy', 'browser')).cookie, cookieFor('wy'))
  assert.equal(await old, undefined)
  assert.deepEqual(f.saved, [{ 'cookie.wy': cookieFor('wy') }])
  assert.equal(f.platformLoginStates.wy.error, '')
})

test('invalid or unpersisted credentials never produce a successful login state', async() => {
  const invalid = rendererFixture({ browser: async() => ({ cookie: 'MUSIC_U=' }) })
  await assert.rejects(invalid.loginPlatform('wy', 'browser'), /COOKIE_LOGIN_INVALID/)
  assert.deepEqual(invalid.saved, []); assert.equal(invalid.platformLoginStates.wy.success, false)
  const failure = rendererFixture({ saveError: Error('disk failure') })
  await assert.rejects(failure.loginPlatform('wy', 'embedded'), /disk failure/)
  assert.equal(failure.appSetting['cookie.wy'], undefined); assert.equal(failure.platformLoginStates.wy.success, false)
})
