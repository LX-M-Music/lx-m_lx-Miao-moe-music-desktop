import { BrowserWindow, ipcMain, session } from 'electron'
import path from 'node:path'
import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { registerCookieLoginWindow } from '@main/utils/cookieLoginWindow'
import { COOKIE_LOGIN_DEFINITIONS, getRelevantCookies, hasLoginState, isLoginPage, isMusicSource, loginStorageScript, serializeCookies, type CookieLoginDefinition, type MusicSource } from '@common/cookieLogin'
import { loginCookieInBrowser, miguPlaylistsScript, parseMiguPlaylists, type CookieLoginResult } from './cookieLogin'

const SOURCE_TITLES: Record<MusicSource, string> = { wy: '登录网易云音乐', tx: '登录 QQ 音乐', kg: '登录酷狗音乐', kw: '登录酷我音乐', mg: '登录咪咕音乐' }
const CHROME_ACTION_CHANNEL = 'cookie-login-chrome-action'
const LOGIN_TIMEOUT = 5 * 60 * 1000
interface EmbeddedTask {
  promise: Promise<CookieLoginResult>
  cancel: () => void
  switchToBrowser: () => void
}
const loginTasks = new Map<MusicSource, EmbeddedTask>()
const owners = new WeakMap<Electron.WebContents, EmbeddedTask>()

const getRelevantStorage = async(windows: Set<BrowserWindow>, definition: CookieLoginDefinition) => {
  const values = new Map<string, string>()
  if (!definition.storageKeys?.length) return values
  const visit = async(frame: Electron.WebFrameMain) => {
    if (isLoginPage(frame.url, definition)) {
      const raw = await frame.executeJavaScript(loginStorageScript(definition)).catch(() => '{}')
      try {
        const entries = typeof raw === 'string' ? JSON.parse(raw) as Record<string, string> : {}
        for (const [name, value] of Object.entries(entries)) if (value) values.set(name, value)
      } catch {}
    }
    for (const child of frame.frames) await visit(child)
  }
  for (const win of windows) if (!win.isDestroyed()) await visit(win.webContents.mainFrame).catch(() => {})
  return values
}

const loginEmbedded = async(source: MusicSource): Promise<CookieLoginResult> => {
  const current = loginTasks.get(source)
  if (current) return current.promise
  const definition = COOKIE_LOGIN_DEFINITIONS[source]
  const ses = session.fromPartition(`cookie-login-embedded:${source}`)
  const windows = new Set<BrowserWindow>()
  let settled = false
  let switching = false
  let disposing = false
  let polling = false
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined
  let resolve: (value: CookieLoginResult) => void
  let reject: (error: Error) => void
  const promise = new Promise<CookieLoginResult>((_resolve, _reject) => { resolve = _resolve; reject = _reject })
  const disposeWindows = () => {
    disposing = true
    if (pollTimer) clearInterval(pollTimer)
    if (timeoutTimer) clearTimeout(timeoutTimer)
    for (const win of [...windows]) if (!win.isDestroyed()) win.destroy()
    windows.clear()
  }
  const finish = (result?: CookieLoginResult, error?: Error) => {
    if (settled) return
    settled = true
    disposeWindows()
    if (loginTasks.get(source) === task) loginTasks.delete(source)
    if (result) resolve(result)
    else reject(error ?? new Error('[COOKIE_LOGIN_CANCELLED] 登录窗口已关闭'))
  }
  const task: EmbeddedTask = {
    promise,
    cancel: () => { finish() },
    switchToBrowser: () => {
      if (settled || switching) return
      switching = true
      disposeWindows()
      void loginCookieInBrowser(source).then(result => { finish(result) }, error => { finish(undefined, error) })
    },
  }
  loginTasks.set(source, task)
  const preferences = {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false,
    session: ses,
    preload: path.join(__dirname, 'cookie-login-preload.js'),
  }
  const trackWindow = (win: BrowserWindow, root = false) => {
    const contents = win.webContents
    registerCookieLoginWindow(contents)
    windows.add(win)
    owners.set(contents, task)
    win.setMenuBarVisibility(false)
    contents.setWindowOpenHandler(({ url }) => ({
      action: /^(?:https?:|about:blank)/i.test(url) ? 'allow' : 'deny',
      overrideBrowserWindowOptions: { autoHideMenuBar: true, frame: false, transparent: true, width: 900, height: 720, webPreferences: preferences },
    }))
    contents.on('did-create-window', child => { trackWindow(child) })
    win.on('closed', () => {
      owners.delete(contents)
      windows.delete(win)
      if (root && !disposing) finish()
    })
  }
  void (async() => {
    try {
      await ses.clearStorageData()
      await ses.clearCache()
      if (settled) return
      const win = new BrowserWindow({ title: SOURCE_TITLES[source], width: 1000, height: 760, minWidth: 760, minHeight: 560, frame: false, transparent: true, show: false, webPreferences: preferences })
      trackWindow(win, true)
      win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show() })
      win.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
        if (mainFrame && code !== -3 && !switching) finish(undefined, new Error('[COOKIE_LOGIN_PAGE_FAILED] 登录页面加载失败：' + description))
      })
      const poll = async() => {
        if (settled || switching || polling) return
        polling = true
        try {
          const cookies = getRelevantCookies(await ses.cookies.get({}), definition)
          const storage = await getRelevantStorage(windows, definition)
          if (!hasLoginState(cookies, storage, definition) || settled || switching) return
          let playlists
          if (source === 'mg') {
            const page = [...windows].find(item => !item.isDestroyed() && isLoginPage(item.webContents.getURL(), definition))
            const body = await page?.webContents.executeJavaScript(miguPlaylistsScript).catch(() => undefined)
            if (body) { try { playlists = parseMiguPlaylists(JSON.parse(body)) } catch {} }
          }
          if (settled || switching) return
          const finalCookies = getRelevantCookies(await ses.cookies.get({}), definition)
          const finalStorage = await getRelevantStorage(windows, definition)
          if (hasLoginState(finalCookies, finalStorage, definition)) finish({ cookie: serializeCookies(finalCookies, finalStorage), ...(playlists ? { playlists } : {}) })
        } catch { /* A navigating frame can disappear; retry on the next poll. */ } finally {
          // No other poll can enter while this attempt owns the flag.
          // eslint-disable-next-line require-atomic-updates
          polling = false
        }
      }
      pollTimer = setInterval(() => { void poll() }, 1000)
      timeoutTimer = setTimeout(() => { finish(undefined, new Error('[COOKIE_LOGIN_TIMEOUT] 登录超时，请重新打开登录窗口')) }, LOGIN_TIMEOUT)
      void win.loadURL(definition.url).catch(error => { if (!settled && !switching && !String(error).includes('ERR_ABORTED')) finish(undefined, new Error('[COOKIE_LOGIN_PAGE_FAILED] 登录页面加载失败，请检查网络后重试')) })
    } catch (error) { finish(undefined, error as Error) }
  })()
  return promise
}

export default () => {
  ipcMain.on(CHROME_ACTION_CHANNEL, (event, action: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame) return
    const task = owners.get(event.sender)
    if (!task) return
    if (action === 'browser') task.switchToBrowser()
    else if (action === 'close') BrowserWindow.fromWebContents(event.sender)?.close()
  })
  mainHandle<MusicSource, CookieLoginResult>(WIN_MAIN_RENDERER_EVENT_NAME.cookie_login_embedded, async({ params: source }) => {
    if (!isMusicSource(source)) throw new Error('[COOKIE_LOGIN_SOURCE] Unsupported music source')
    return loginEmbedded(source)
  })
  mainHandle<MusicSource, boolean>(WIN_MAIN_RENDERER_EVENT_NAME.cookie_login_embedded_cancel, async({ params: source }) => {
    if (!isMusicSource(source)) throw new Error('[COOKIE_LOGIN_SOURCE] Unsupported music source')
    loginTasks.get(source)?.cancel()
    return true
  })
}
