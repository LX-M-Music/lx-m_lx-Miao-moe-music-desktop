import { BrowserWindow, ipcMain, session, shell } from 'electron'
import path from 'node:path'
import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import {
  COOKIE_LOGIN_DEFINITIONS,
  getRelevantCookies,
  hasLoginState,
  serializeCookies,
  type CookieLoginDefinition,
  type CookieLoginResult,
  type MusicSource,
} from './cookieLogin'

const SOURCE_TITLES: Record<MusicSource, string> = {
  wy: '登录网易云音乐',
  tx: '登录 QQ 音乐',
  kg: '登录酷狗音乐',
  kw: '登录酷我音乐',
  mg: '登录咪咕音乐',
}

const CHROME_ACTION_CHANNEL = 'cookie-login-chrome-action'

/**
 * 软件内嵌登录窗口
 *
 * 打开一个独立的 BrowserWindow 加载对应平台官网登录页（官方页面自带扫码/手机号/密码登录），
 * 轮询会话 Cookie / localStorage，登录成功后自动把 Cookie 返回给渲染进程并关闭窗口。
 * 会话使用独立内存 partition 并在每次打开前清空，不污染应用默认会话。
 */

const POLL_INTERVAL = 1000
const LOGIN_TIMEOUT = 5 * 60 * 1000

const isMusicSource = (source: unknown): source is MusicSource => {
  return typeof source == 'string' && source in COOKIE_LOGIN_DEFINITIONS
}

const getRelevantStorage = async(win: BrowserWindow, definition: CookieLoginDefinition) => {
  const values = new Map<string, string>()
  if (!definition.storageKeys?.length) return values
  const keys = new Set(definition.storageKeys)
  const empty: Record<string, string> = {}
  const raw: Record<string, string> = await win.webContents.executeJavaScript('JSON.stringify({ ...localStorage })')
    .then((text: unknown) => typeof text == 'string' ? JSON.parse(text) as Record<string, string> : empty)
    .catch(() => empty)
  for (const [name, value] of Object.entries(raw)) {
    if (keys.has(name) && value) values.set(name, value)
  }
  return values
}

const createLoginWindow = async(source: MusicSource, definition: CookieLoginDefinition, ses: Electron.Session) => {
  const win = new BrowserWindow({
    title: SOURCE_TITLES[source],
    width: 560,
    height: 720,
    minWidth: 420,
    minHeight: 560,
    // 无边框 + 透明窗口：由注入的 preload 绘制与主程序一致的圆角标题栏
    frame: false,
    transparent: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      session: ses,
      preload: path.join(__dirname, 'cookie-login-preload.js'),
    },
  })

  // 登录过程中的授权弹窗（如 QQ 互联）在相同会话内打开，保证 Cookie 可被捕获，并同样注入圆角标题栏
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      autoHideMenuBar: true,
      frame: false,
      transparent: true,
      width: 820,
      height: 620,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: ses,
        preload: path.join(__dirname, 'cookie-login-preload.js'),
      },
    },
  }))

  return win
}

// 注入标题栏按钮的动作（裸 IPC，校验 sender 属于本模块的登录窗口/其弹窗）
const handleChromeAction = (sourceOf: (contents: Electron.WebContents) => MusicSource | undefined) => {
  ipcMain.on(CHROME_ACTION_CHANNEL, (event, action: unknown) => {
    const source = sourceOf(event.sender)
    if (!source) return
    if (action == 'browser') {
      void shell.openExternal(COOKIE_LOGIN_DEFINITIONS[source].url).catch(() => {})
      return
    }
    if (action == 'close') BrowserWindow.fromWebContents(event.sender)?.close()
  })
}

const loginWindows = new Map<MusicSource, BrowserWindow>()

const loginEmbedded = async(source: MusicSource): Promise<CookieLoginResult> => {
  const definition = COOKIE_LOGIN_DEFINITIONS[source]
  const ses = session.fromPartition(`cookie-login-embedded:${source}`)
  await ses.clearStorageData().catch(() => {})
  await ses.clearCache().catch(() => {})

  return new Promise<CookieLoginResult>((resolve, reject) => {
    let settled = false
    let pollTimer: ReturnType<typeof setInterval> | undefined
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    let win: BrowserWindow | null = null

    const cleanup = () => {
      if (pollTimer) clearInterval(pollTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      pollTimer = timeoutTimer = undefined
      if (win && !win.isDestroyed()) win.destroy()
      win = null
      loginWindows.delete(source)
    }
    const settle = (fn: typeof resolve | typeof reject, value: CookieLoginResult | Error) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value as never)
    }

    void (async() => {
      try {
        win = await createLoginWindow(source, definition, ses)
      } catch (error) {
        settle(reject, error as Error)
        return
      }
      loginWindows.set(source, win)

      win.setMenuBarVisibility(false)
      win.once('ready-to-show', () => win?.show())
      win.on('closed', () => {
        if (!settled) {
          settled = true
          if (pollTimer) clearInterval(pollTimer)
          if (timeoutTimer) clearTimeout(timeoutTimer)
          reject(new Error('登录窗口已关闭'))
        }
        win = null
      })

      const poll = async() => {
        if (!win || win.isDestroyed()) return
        try {
          const cookies = await ses.cookies.get({})
          const relevant = getRelevantCookies(cookies as Array<{ name: string, value: string, domain: string }>, definition)
          if (!hasLoginState(relevant, new Map(), definition)) return
          const storage = await getRelevantStorage(win, definition)
          const cookie = serializeCookies(relevant, storage)
          if (!cookie) return
          settle(resolve, { cookie })
        } catch { /* 页面跳转期间读取可能失败，等待下一轮 */ }
      }

      pollTimer = setInterval(() => { void poll() }, POLL_INTERVAL)
      timeoutTimer = setTimeout(() => { settle(reject, new Error('登录超时')) }, LOGIN_TIMEOUT)
      void win.loadURL(definition.url).catch(() => {})
    })()
  })
}

export default () => {
  handleChromeAction((contents) => {
    for (const [source, win] of loginWindows) {
      if (win.isDestroyed()) continue
      if (win.webContents === contents) return source
      if (contents.hostWebContents === win.webContents) return source
    }
    return undefined
  })
  mainHandle<MusicSource, CookieLoginResult>(WIN_MAIN_RENDERER_EVENT_NAME.cookie_login_embedded, async({ params: source }) => {
    if (!isMusicSource(source)) throw new Error('Unsupported music source')
    return loginEmbedded(source)
  })
  // 取消进行中的内嵌登录（窗口销毁后渲染端收到「登录窗口已关闭」拒绝）
  mainHandle<MusicSource, boolean>(WIN_MAIN_RENDERER_EVENT_NAME.cookie_login_embedded_cancel, async({ params: source }) => {
    if (!isMusicSource(source)) throw new Error('Unsupported music source')
    const win = loginWindows.get(source)
    if (win && !win.isDestroyed()) win.destroy()
    loginWindows.delete(source)
    return true
  })
}
