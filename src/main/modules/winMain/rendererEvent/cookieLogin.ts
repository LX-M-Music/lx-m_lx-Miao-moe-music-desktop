import { app } from 'electron'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { chromium, type BrowserContext } from 'playwright-core'
import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { COOKIE_LOGIN_DEFINITIONS, getRelevantCookies, hasLoginState, isLoginPage, isMusicSource, loginStorageScript, serializeCookies, type CookieLoginDefinition, type MusicSource } from '@common/cookieLogin'
import { createFirefoxLoginBrowser } from './cookieLoginFirefox'

export { COOKIE_LOGIN_DEFINITIONS, getRelevantCookies, hasLoginState, isLoginPage, isMusicSource, loginStorageScript, serializeCookies }
export type { CookieLoginDefinition, MusicSource }

export interface CookieLoginPlaylist { id: string, name: string }
export interface CookieLoginResult { cookie: string, playlists?: CookieLoginPlaylist[] }
const loginTasks = new Map<MusicSource, Promise<CookieLoginResult>>()

export const getDefaultLoginBrowser = async() => {
  const browser = await app.getApplicationInfoForProtocol('https://music.163.com/')
  let executablePath = browser.path
  if (process.platform === 'darwin' && executablePath.endsWith('.app')) {
    const appName = path.basename(executablePath, '.app')
    executablePath = path.join(executablePath, 'Contents', 'MacOS', appName)
  }
  if (!existsSync(executablePath)) throw new Error('[COOKIE_LOGIN_BROWSER_MISSING] 未找到默认浏览器，请检查系统浏览器设置')
  const name = `${browser.name} ${executablePath}`.toLowerCase()
  if (name.includes('safari')) throw new Error('[COOKIE_LOGIN_BROWSER_UNSUPPORTED] 请将 Chrome、Edge 或 Firefox 系列浏览器设为默认浏览器后重试')
  return { executablePath, firefox: /firefox|zen(?:\.exe| browser|\/|$)|librewolf|waterfox|floorp/.test(name) }
}

export const getRelevantStorage = async(context: BrowserContext, definition: CookieLoginDefinition) => {
  const values = new Map<string, string>()
  if (!definition.storageKeys?.length) return values
  for (const page of context.pages()) {
    for (const frame of page.frames()) {
      if (!isLoginPage(frame.url(), definition)) continue
      const raw = await frame.evaluate(loginStorageScript(definition)).catch(() => '{}')
      const entries = typeof raw === 'string' ? JSON.parse(raw) as Record<string, string> : {}
      for (const [name, value] of Object.entries(entries)) if (value) values.set(name, value)
    }
  }
  return values
}

export const parseMiguPlaylists = (body: any): CookieLoginPlaylist[] | undefined => {
  const lists = body?.data?.myCreatedMusicLists?.createdMusicLists ?? body?.myCreatedMusicLists?.createdMusicLists
  if (!Array.isArray(lists)) return
  return lists.map((item: any) => ({ id: String(item.musicListId ?? item.id ?? ''), name: String(item.title ?? item.name ?? '').trim() }))
    .filter((item: CookieLoginPlaylist) => item.id && item.name)
}

export const miguPlaylistsScript = `(async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch('https://c.musicapp.migu.cn/pc/user/home-page/v2.0', {
      credentials: 'include', signal: controller.signal,
      headers: { platform: 'H5', ua: 'Android_migu', version: '6.8.8', IMEI: 'h5page', IMSI: 'h5page' }
    });
    return response.ok ? JSON.stringify(await response.json()) : '';
  } catch { return ''; } finally { clearTimeout(timer); }
})()`

const wait = async(milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

const loginWithBrowser = async(source: MusicSource): Promise<CookieLoginResult> => {
  const definition = COOKIE_LOGIN_DEFINITIONS[source]
  const browser = await getDefaultLoginBrowser()
  const profileRoot = path.resolve(app.getPath('userData'), 'cookie-login')
  mkdirSync(profileRoot, { recursive: true })
  const profilePath = mkdtempSync(path.join(profileRoot, source + '-'))
  let chromiumContext: BrowserContext | undefined
  let firefoxContext: Awaited<ReturnType<typeof createFirefoxLoginBrowser>> | undefined
  let browserClosed = false
  try {
    if (browser.firefox) {
      firefoxContext = await createFirefoxLoginBrowser(browser.executablePath, profilePath)
      await firefoxContext.loadURL(definition.url)
    } else {
      chromiumContext = await chromium.launchPersistentContext(profilePath, {
        executablePath: browser.executablePath, headless: false, args: ['--no-first-run', '--no-default-browser-check'],
      })
      chromiumContext.on('close', () => { browserClosed = true })
      const page = chromiumContext.pages()[0] ?? await chromiumContext.newPage()
      await page.goto(definition.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    }
    const deadline = Date.now() + 5 * 60 * 1000
    while (Date.now() < deadline) {
      if (browserClosed || (firefoxContext?.isClosed() ?? false) || (chromiumContext ? !chromiumContext.pages().length : false)) throw new Error('[COOKIE_LOGIN_CANCELLED] 登录窗口已关闭')
      const cookies = getRelevantCookies(await (firefoxContext?.cookies() ?? chromiumContext!.cookies()), definition)
      const storage = await (firefoxContext?.storage(definition) ?? getRelevantStorage(chromiumContext!, definition))
      if (hasLoginState(cookies, storage, definition)) {
        let playlists: CookieLoginPlaylist[] | undefined
        if (source === 'mg') {
          const body = firefoxContext
            ? await firefoxContext.evaluate(miguPlaylistsScript).catch(() => undefined)
            : await chromiumContext!.pages().find(page => isLoginPage(page.url(), definition))?.evaluate(miguPlaylistsScript).catch(() => undefined)
          if (typeof body === 'string' && body) { try { playlists = parseMiguPlaylists(JSON.parse(body)) } catch {} }
        }
        // Authentication redirects may add the final cookies after the first match.
        const finalCookies = getRelevantCookies(await (firefoxContext?.cookies() ?? chromiumContext!.cookies()), definition)
        const finalStorage = await (firefoxContext?.storage(definition) ?? getRelevantStorage(chromiumContext!, definition))
        if (hasLoginState(finalCookies, finalStorage, definition)) return { cookie: serializeCookies(finalCookies, finalStorage), ...(playlists ? { playlists } : {}) }
      }
      await wait(1_000)
    }
    throw new Error('[COOKIE_LOGIN_TIMEOUT] 登录超时，请重新打开登录窗口')
  } finally {
    await firefoxContext?.close().catch(() => {})
    await chromiumContext?.close().catch(() => {})
    // Remove only the unique profile allocated for this attempt.
    if (path.dirname(path.resolve(profilePath)) === profileRoot) {
      try { rmSync(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch {}
    }
  }
}

export const loginCookieInBrowser = async(source: MusicSource): Promise<CookieLoginResult> => {
  const current = loginTasks.get(source)
  if (current) return current
  const task = loginWithBrowser(source).finally(() => { if (loginTasks.get(source) === task) loginTasks.delete(source) })
  loginTasks.set(source, task)
  return task
}

export default () => {
  mainHandle<MusicSource, CookieLoginResult>(WIN_MAIN_RENDERER_EVENT_NAME.cookie_login, async({ params: source }) => {
    if (!isMusicSource(source)) throw new Error('[COOKIE_LOGIN_SOURCE] Unsupported music source')
    return loginCookieInBrowser(source)
  })
}
