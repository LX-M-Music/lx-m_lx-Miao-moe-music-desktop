import { app, shell } from 'electron'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { chromium, type Page, type Response } from 'playwright-core'
import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'

export type MusicSource = 'wy' | 'tx' | 'kg' | 'kw' | 'mg'

export interface CookieLoginDefinition {
  url: string
  domains: string[]
  cookieGroups: string[][]
  storageKeys?: string[]
  storageGroups?: string[][]
}

export interface CookieLoginPlaylist {
  id: string
  name: string
}

export interface CookieLoginResult {
  cookie: string
  playlists?: CookieLoginPlaylist[]
}

export const COOKIE_LOGIN_DEFINITIONS: Record<MusicSource, CookieLoginDefinition> = {
  wy: {
    url: 'https://music.163.com/',
    domains: ['163.com'],
    cookieGroups: [['MUSIC_U']],
  },
  tx: {
    url: 'https://y.qq.com/',
    domains: ['qq.com'],
    cookieGroups: [['uin', 'qqmusic_key'], ['wxuin', 'qqmusic_key']],
  },
  kg: {
    url: 'https://www.kugou.com/',
    domains: ['kugou.com'],
    cookieGroups: [['KuGoo']],
  },
  kw: {
    url: 'https://www.kuwo.cn/',
    domains: ['kuwo.cn'],
    cookieGroups: [['userid']],
  },
  mg: {
    url: 'https://music.migu.cn/v5/',
    domains: ['migu.cn'],
    cookieGroups: [['migu_music_sid'], ['USER_ID']],
    storageKeys: [
      'mg_auth_sid',
      'mg_auth_pacmtoken',
      'mg_auth_uid',
      'mg_auth_utoken',
      'migu-utoken-sessionid',
    ],
    storageGroups: [['mg_auth_sid', 'mg_auth_uid']],
  },
}

const loginTasks = new Map<MusicSource, Promise<CookieLoginResult>>()

const isMusicSource = (source: unknown): source is MusicSource => {
  return typeof source == 'string' && source in COOKIE_LOGIN_DEFINITIONS
}

const getDefaultBrowserExecutable = async(): Promise<string> => {
  const browser = await app.getApplicationInfoForProtocol('https://')
  let executablePath = browser.path

  if (process.platform == 'darwin' && executablePath.endsWith('.app')) {
    const appName = path.basename(executablePath, '.app')
    executablePath = path.join(executablePath, 'Contents', 'MacOS', appName)
  }

  const browserInfo = `${browser.name} ${executablePath}`.toLowerCase()
  if (!existsSync(executablePath) || /firefox|safari/.test(browserInfo)) {
    throw new Error('The default browser is not supported by Playwright')
  }
  return executablePath
}

export const getRelevantCookies = (cookies: Array<{ name: string, value: string, domain: string }>, definition: CookieLoginDefinition) => {
  return cookies.filter(cookie => {
    const domain = cookie.domain.replace(/^\./, '').toLowerCase()
    return definition.domains.some(rootDomain => domain == rootDomain || domain.endsWith(`.${rootDomain}`))
  })
}

export const hasLoginState = (cookies: Array<{ name: string }>, storage: Map<string, string>, definition: CookieLoginDefinition) => {
  const names = new Set([...cookies.map(cookie => cookie.name), ...storage.keys()])
  return [...definition.cookieGroups, ...(definition.storageGroups ?? [])]
    .some(group => group.every(name => names.has(name)))
}

const sanitizeCookieValue = (value: string) => value.replace(/[\r\n]/g, '')

export const serializeCookies = (cookies: Array<{ name: string, value: string }>, storage: Map<string, string>) => {
  const values = new Map<string, string>()
  for (const cookie of cookies) values.set(cookie.name, sanitizeCookieValue(cookie.value))
  for (const [name, value] of storage) values.set(name, sanitizeCookieValue(value))
  return Array.from(values, ([name, value]) => `${name}=${value}`).join('; ')
}

const getRelevantStorage = async(context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>, definition: CookieLoginDefinition) => {
  const values = new Map<string, string>()
  if (!definition.storageKeys?.length) return values

  const keys = new Set(definition.storageKeys)
  for (const page of context.pages()) {
    const entries = await page.evaluate(() => Object.entries(localStorage)).catch(() => [])
    for (const [name, value] of entries) {
      if (keys.has(name) && value) values.set(name, value)
    }
  }
  return values
}

const parseMiguPlaylists = (body: any): CookieLoginPlaylist[] | undefined => {
  const lists = body?.data?.myCreatedMusicLists?.createdMusicLists ??
    body?.myCreatedMusicLists?.createdMusicLists
  if (!Array.isArray(lists)) return
  return lists.map((item: any) => ({
    id: String(item.musicListId ?? item.id ?? ''),
    name: String(item.title ?? item.name ?? '').trim(),
  })).filter((item: CookieLoginPlaylist) => item.id && item.name)
}

const wait = async(milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

const loginWithPlaywright = async(source: MusicSource): Promise<CookieLoginResult> => {
  const definition = COOKIE_LOGIN_DEFINITIONS[source]
  const executablePath = await getDefaultBrowserExecutable()
  const profilePath = path.join(app.getPath('userData'), 'cookie-login', source)
  rmSync(profilePath, { recursive: true, force: true })
  mkdirSync(path.dirname(profilePath), { recursive: true })

  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined
  try {
    context = await chromium.launchPersistentContext(profilePath, {
      executablePath,
      headless: false,
      args: ['--no-first-run', '--no-default-browser-check'],
    })
    let miguPlaylists: CookieLoginPlaylist[] | undefined
    const watchMiguPlaylists = (page: Page) => {
      if (source != 'mg') return
      page.on('response', (response: Response) => {
        if (!response.url().includes('/pc/user/home-page/v2.0')) return
        void response.json().then((body: any) => {
          const playlists = parseMiguPlaylists(body)
          if (playlists) miguPlaylists = playlists
        }).catch(() => {})
      })
    }

    for (const currentPage of context.pages()) watchMiguPlaylists(currentPage)
    context.on('page', watchMiguPlaylists)

    const page = context.pages()[0] ?? await context.newPage()
    await page.goto(definition.url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})

    const deadline = Date.now() + 5 * 60 * 1000
    while (Date.now() < deadline) {
      const relevantCookies = getRelevantCookies(await context.cookies(), definition)
      const storage = await getRelevantStorage(context, definition)
      if (hasLoginState(relevantCookies, storage, definition)) {
        if (source == 'mg' && miguPlaylists == null) {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
          const playlistDeadline = Date.now() + 8_000
          // eslint-disable-next-line no-unmodified-loop-condition
          while (miguPlaylists == null && Date.now() < playlistDeadline) await wait(250)
        }

        const finalCookies = getRelevantCookies(await context.cookies(), definition)
        const finalStorage = await getRelevantStorage(context, definition)
        const cookie = serializeCookies(finalCookies, finalStorage)
        if (cookie) return { cookie, playlists: miguPlaylists }
      }
      await wait(1_000)
    }
    throw new Error('Login timed out')
  } finally {
    await context?.close().catch(() => {})
    try {
      rmSync(profilePath, { recursive: true, force: true })
    } catch {}
  }
}

const login = async(source: MusicSource): Promise<CookieLoginResult> => {
  const currentTask = loginTasks.get(source)
  if (currentTask) return currentTask

  const task = loginWithPlaywright(source).catch(async(error) => {
    if (error instanceof Error && error.message.includes('not supported')) {
      await shell.openExternal(COOKIE_LOGIN_DEFINITIONS[source].url).catch(() => {})
    }
    throw error
  }).finally(() => {
    loginTasks.delete(source)
  })
  loginTasks.set(source, task)
  return task
}

export default () => {
  mainHandle<MusicSource, CookieLoginResult>(WIN_MAIN_RENDERER_EVENT_NAME.cookie_login, async({ params: source }) => {
    if (!isMusicSource(source)) throw new Error('Unsupported music source')
    return login(source)
  })
}
