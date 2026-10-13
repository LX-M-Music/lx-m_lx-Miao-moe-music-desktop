export type MusicSource = 'wy' | 'tx' | 'kg' | 'kw' | 'mg'

export interface CookieLoginDefinition {
  url: string
  domains: string[]
  cookieGroups: string[][]
  storageKeys?: string[]
  storageGroups?: string[][]
}

export interface LoginCookie { name: string, value: string, domain?: string }

export const COOKIE_LOGIN_DEFINITIONS: Record<MusicSource, CookieLoginDefinition> = {
  wy: { url: 'https://music.163.com/', domains: ['163.com'], cookieGroups: [['MUSIC_U']] },
  tx: { url: 'https://y.qq.com/', domains: ['qq.com'], cookieGroups: [['uin', 'qqmusic_key'], ['wxuin', 'qqmusic_key']] },
  kg: { url: 'https://www.kugou.com/', domains: ['kugou.com'], cookieGroups: [['KuGoo']] },
  kw: { url: 'https://www.kuwo.cn/', domains: ['kuwo.cn'], cookieGroups: [['userid']] },
  mg: {
    url: 'https://music.migu.cn/v5/',
    domains: ['migu.cn'],
    cookieGroups: [['pacmtoken'], ['mg_auth_pacmtoken'], ['mg_auth_sid'], ['migu_music_sid'], ['USER_ID']],
    storageKeys: ['mg_auth_sid', 'mg_auth_pacmtoken', 'mg_auth_uid', 'mg_auth_utoken', 'migu-utoken-sessionid'],
    storageGroups: [['mg_auth_sid', 'mg_auth_uid']],
  },
}

export const isMusicSource = (source: unknown): source is MusicSource => typeof source === 'string' && Object.hasOwn(COOKIE_LOGIN_DEFINITIONS, source)

export const matchesLoginDomain = (host: string, definition: CookieLoginDefinition) => {
  const domain = host.replace(/^\./, '').toLowerCase()
  return definition.domains.some(root => domain === root || domain.endsWith('.' + root))
}

export const isLoginPage = (url: string, definition: CookieLoginDefinition) => {
  try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) && matchesLoginDomain(parsed.hostname, definition) } catch { return false }
}

export const getRelevantCookies = (cookies: LoginCookie[], definition: CookieLoginDefinition) => cookies.filter(cookie => matchesLoginDomain(cookie.domain ?? '', definition))
const hasValue = (value: string | undefined) => !!value?.trim() && !/^(?:null|undefined|false)$/i.test(value.trim())
const hasUserId = (value: string | undefined) => !!value && /^o?\d+$/.test(value) && /[1-9]/.test(value)

export const hasLoginState = (cookies: LoginCookie[], storage: Map<string, string>, definition: CookieLoginDefinition) => {
  const values = new Map(cookies.filter(cookie => hasValue(cookie.value)).map(cookie => [cookie.name, cookie.value]))
  for (const [name, value] of storage) if (hasValue(value)) values.set(name, value)
  return [...definition.cookieGroups, ...(definition.storageGroups ?? [])].some(group => group.every(name => {
    const value = values.get(name)
    if (!hasValue(value)) return false
    if (['uin', 'wxuin', 'userid', 'USER_ID', 'mg_auth_uid'].includes(name)) return hasUserId(value)
    if (name === 'KuGoo') {
      let account = value!
      try { account = decodeURIComponent(account) } catch {}
      const params = new URLSearchParams(account.replace(/^"|"$/g, ''))
      return hasUserId(params.get('KugooID') ?? params.get('KugouID') ?? undefined) && hasValue(params.get('t') ?? undefined)
    }
    return true
  }))
}

export const serializeCookies = (cookies: LoginCookie[], storage: Map<string, string>) => {
  const values = new Map<string, string>()
  for (const cookie of cookies) if (hasValue(cookie.value)) values.set(cookie.name, cookie.value.replace(/[\r\n]/g, ''))
  for (const [name, value] of storage) if (hasValue(value)) values.set(name, value.replace(/[\r\n]/g, ''))
  return Array.from(values, ([name, value]) => `${name}=${value}`).join('; ')
}

// Read only the platform's authentication fields, including session storage.
export const loginStorageScript = (definition: CookieLoginDefinition) => `JSON.stringify((() => {
  const values = {};
  for (const storage of [localStorage, sessionStorage]) {
    for (const name of ${JSON.stringify(definition.storageKeys ?? [])}) {
      let value = storage.getItem(name);
      if (!value) continue;
      try { const decoded = JSON.parse(value); if (typeof decoded === 'string') value = decoded; } catch {}
      values[name] = value;
    }
  }
  return values;
})())`
