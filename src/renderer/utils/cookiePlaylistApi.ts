import { errorForTransport } from '@common/utils/errorMessage'
import {
  getCookie,
  getCookieValue,
  isCookieRecognized,
  type CookieSource,
} from '@renderer/utils/cookieManager'
import { deduplicationList, toNewMusicInfo } from '@renderer/utils'
import musicSdk from '@renderer/utils/musicSdk'
import { eapi } from '@renderer/utils/musicSdk/wy/utils/crypto'
import { filterMusicInfoListV5 } from '@renderer/utils/musicSdk/mg/musicInfo'
import { toMD5 } from '@renderer/utils/musicSdk/utils'
import { httpFetch } from '@renderer/utils/request'

interface FetchResponse {
  body: any
  statusCode: number
  headers?: Record<string, any>
}

export const fetchResponse = async(url: string, options: Record<string, any> = { method: 'get' }): Promise<FetchResponse> => {
  const response: FetchResponse = await (httpFetch(url, options) as any).promise
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`cookie api: HTTP ${response.statusCode}`)
  return response
}

export interface CookiePlaylistCheck {
  message?: string
  source: CookieSource
  status: 'success' | 'missing_cookie' | 'invalid_cookie' | 'login_expired' | 'failed'
  listCount: number
}

export interface CookieSyncDetail {
  message?: string
  source: CookieSource
  status: 'success' | 'failed'
  listCount: number
  count: number
}

export interface CookieSyncResult {
  synced: boolean
  listCount: number
  count: number
  message?: string
  error?: boolean
  details?: CookieSyncDetail[]
}

export interface RemotePlaylist {
  id: string
  name: string
  raw?: any
}

export class CookieLoginError extends Error {
  code = 'COOKIE_LOGIN_EXPIRED'

  constructor(source: CookieSource) {
    super(`${source}: login expired`)
  }
}

// Client MUSIC_U sessions can be valid for eapi while web/Linux account queries return null.
// Keep account checks, playlist reads and writes on the same authenticated transport.
export const wyEapiRequest = async(cookie: string, api: string, params: Record<string, any>) => {
  const musicU = getCookieValue(cookie, 'MUSIC_U')
  if (!musicU) throw new CookieLoginError('wy')
  const header = {
    os: 'pc',
    appver: '3.1.17.204416',
    MUSIC_U: musicU,
    __csrf: getCookieValue(cookie, '__csrf') ?? '',
    requestId: `${Date.now()}_${Math.floor(Math.random() * 1000)}`,
  }
  const { body } = await fetchResponse(`https://interfacepc.music.163.com${api.replace(/^\/api\//, '/eapi/')}`, {
    method: 'post',
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Referer: 'https://music.163.com/',
      Origin: 'https://music.163.com',
      Cookie: Object.entries(header).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('; '),
    },
    form: eapi(api, { ...params, header, e_r: false }),
  })
  if (body?.code === 301) throw new CookieLoginError('wy')
  if (body?.code !== 200) throw new Error(`wy api: ${api} failed (${body?.code ?? 'unknown'})`)
  return body
}

const getWyPlaylists = async(cookie: string): Promise<RemotePlaylist[]> => {
  const account = await wyEapiRequest(cookie, '/api/nuser/account/get', {})
  const uid = account?.account?.id ?? account?.profile?.userId
  if (!uid) throw new CookieLoginError('wy')
  const body = await wyEapiRequest(cookie, '/api/user/playlist', { uid: String(uid), limit: 1000, offset: 0 })
  if (!Array.isArray(body?.playlist)) throw new Error('wy: failed to load playlists')
  return body.playlist
    .filter((item: any) => String(item?.creator?.userId) === String(uid))
    .map((item: any) => ({ id: String(item.id), name: String(item.name ?? '未命名歌单').trim() }))
    .filter((item: RemotePlaylist) => item.id && item.name)
}

const getWySongs = async(cookie: string, id: string): Promise<LX.Music.MusicInfo[]> => {
  const body = await wyEapiRequest(cookie, '/api/v3/playlist/detail', { id, n: 100000, s: 8 })
  if (!body?.playlist?.tracks) throw new Error('wy: failed to load playlist songs')
  return deduplicationList(musicSdk.wy.songList.filterListDetail(body).map(toNewMusicInfo))
}

const getTxPlaylists = async(cookie: string): Promise<RemotePlaylist[]> => {
  const uin = (getCookieValue(cookie, 'uin') ?? getCookieValue(cookie, 'wxuin') ?? '').match(/\d+/)?.[0]
  if (!uin) throw new Error('tx cookie: missing uin')
  const url = `https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=1&uin=${uin}&hostuin=${uin}&sin=0&size=1000&ein=1000`
  const { body } = await fetchResponse(url, {
    headers: { Cookie: cookie, Origin: 'https://y.qq.com', Referer: 'https://y.qq.com/' },
  })
  const playlists = body?.data?.disslist
  if (body?.code !== 0 || !Array.isArray(playlists)) throw new Error('tx: failed to load playlists')
  return playlists
    .map((item: any) => ({ id: String(item.tid ?? item.dissid ?? ''), name: String(item.diss_name ?? item.title ?? '').trim() }))
    // QQ also returns digital-album and paid-song directories with tid=0.
    // Those are not playlists and cannot be read through the playlist API.
    .filter((item: RemotePlaylist) => /^[1-9]\d*$/.test(item.id) && item.name)
}

const getTxSongs = async(cookie: string, id: string): Promise<LX.Music.MusicInfo[]> => {
  const { body } = await fetchResponse(musicSdk.tx.songList.getListDetailUrl(id), {
    headers: { Cookie: cookie, Origin: 'https://y.qq.com', Referer: `https://y.qq.com/n/ryqq/playlist/${id}` },
  })
  const songs = body?.cdlist?.[0]?.songlist
  if (body?.code !== 0 || !Array.isArray(songs)) throw new Error('tx: failed to load playlist songs')
  return deduplicationList(musicSdk.tx.songList.filterListDetail(songs).map(toNewMusicInfo))
}

const getKwPlaylists = async(cookie: string): Promise<RemotePlaylist[]> => {
  const uid = (getCookieValue(cookie, 'userid') ?? '').match(/\d+/)?.[0]
  if (!uid) throw new Error('kw cookie: missing userid')
  const { body } = await fetchResponse(`https://nplserver.kuwo.cn/pl.svc?op=getlistbyuid&uid=${encodeURIComponent(uid)}&bigid=1&encode=utf8`)
  if (body?.result !== 'ok' || !Array.isArray(body.plist)) throw new Error('kw: failed to load playlists')
  return body.plist
    .filter((item: any) => String(item.uid) === uid && item.type === 'GENERAL')
    .map((item: any) => ({ id: String(item.id), name: String(item.title ?? '').trim() }))
    .filter((item: RemotePlaylist) => item.id && item.name)
}

const KG_APPID = 1005
const KG_CLIENTVER = 20489
const KG_SIGN_SALT = 'OIlwieks28dk2k092lksi2UIkp'
const KG_WEB_APPIDS = new Set([1010, 1014])
const KG_WEB_SIGN_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt'

interface KugouAuth { userid: string, token: string, mid: string, dfid: string, appid: number }

export const getKugouAuth = (cookie: string): KugouAuth => {
  const encoded = getCookieValue(cookie, 'KuGoo')
  if (!encoded) throw new Error('kg cookie: missing KuGoo')
  let value = encoded
  try { value = decodeURIComponent(value) } catch {}
  const account = new URLSearchParams(value.replace(/^"|"$/g, ''))
  const userid = account.get('KugooID') ?? account.get('KugouID') ?? ''
  const token = account.get('t') ?? ''
  if (!userid || !token) throw new Error('kg cookie: incomplete credentials')
  const appid = Number(account.get('a_id') ?? getCookieValue(cookie, 'a_id') ?? KG_APPID)
  return {
    userid,
    token,
    mid: getCookieValue(cookie, 'kg_mid') ?? getCookieValue(cookie, 'mid') ?? '-',
    dfid: getCookieValue(cookie, 'kg_dfid') ?? getCookieValue(cookie, 'dfid') ?? '-',
    appid: KG_WEB_APPIDS.has(appid) ? appid : KG_APPID,
  }
}

export const requestKugou = async(path: string, router: string, data: Record<string, any>, auth: KugouAuth, extra: Record<string, string | number> = {}) => {
  // Web tokens are bound to their app ID and H5 signing protocol; Android requests reject them.
  const isWeb = KG_WEB_APPIDS.has(auth.appid)
  const clienttime = isWeb ? Date.now() : Math.floor(Date.now() / 1000)
  const params: Record<string, string | number> = {
    dfid: auth.dfid,
    mid: auth.mid,
    uuid: isWeb ? auth.mid : '-',
    appid: auth.appid,
    clientver: isWeb ? 20000 : KG_CLIENTVER,
    clienttime,
    plat: isWeb ? 4 : 1,
    userid: auth.userid,
    token: auth.token,
    ...(isWeb ? { srcappid: 2919 } : {}),
    ...extra,
  }
  const bodyText = JSON.stringify(data)
  const signText = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('')
  const salt = isWeb ? KG_WEB_SIGN_SALT : KG_SIGN_SALT
  const signature = toMD5(`${salt}${signText}${bodyText}${salt}`)
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
  query.set('signature', signature)

  const { body } = await fetchResponse(`https://gateway.kugou.com${path}?${query.toString()}`, {
    method: 'post',
    body: bodyText,
    headers: {
      'content-type': 'application/json',
      'user-agent': isWeb
        ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        : 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',
      ...(isWeb ? { Origin: 'https://www.kugou.com', Referer: 'https://www.kugou.com/' } : {}),
      'x-router': router,
      dfid: auth.dfid,
      mid: auth.mid,
      clienttime: String(clienttime),
      'kg-rc': '1',
      'kg-thash': '5d816a0',
      'kg-rec': '1',
      'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
    },
  })
  if (body?.status !== 1 || body?.error_code !== 0) throw new Error(`kg api error: ${body?.error_code ?? 'unknown'}`)
  return body.data
}

const getKgPlaylists = async(cookie: string): Promise<RemotePlaylist[]> => {
  const auth = getKugouAuth(cookie)
  const result: RemotePlaylist[] = []
  const ids = new Set<string>()
  let page = 1
  let loaded = 0
  let total = Number.POSITIVE_INFINITY
  while (loaded < total && page <= 100) {
    const data = await requestKugou('/v7/get_all_list', 'cloudlist.service.kugou.com', {
      userid: auth.userid,
      token: auth.token,
      total_ver: 979,
      type: 2,
      page,
      pagesize: 30,
    }, auth)
    if (!Array.isArray(data?.info)) throw new Error('kg: failed to load playlists')
    const list = data.info
    total = Number(data?.list_count ?? list.length)
    loaded += list.length
    for (const item of list) {
      if (Number(item.type) !== 0 || Number(item.is_def ?? 0) !== 0) continue
      const id = String(item.listid ?? '')
      if (!id || ids.has(id)) continue
      ids.add(id)
      result.push({ id, name: String(item.name ?? '').trim() })
    }
    if (!list.length) break
    page++
  }
  return result.filter(item => item.id && item.name)
}

const getKgSongs = async(cookie: string, id: string): Promise<LX.Music.MusicInfo[]> => {
  const auth = getKugouAuth(cookie)
  const songs: any[] = []
  let page = 1
  let total = Number.POSITIVE_INFINITY
  while (songs.length < total && page <= 1000) {
    const data = await requestKugou('/v4/get_list_all_file', 'cloudlist.service.kugou.com', {
      listid: id,
      userid: auth.userid,
      token: auth.token,
      area_code: 1,
      show_relate_goods: 0,
      pagesize: 30,
      page,
      allplatform: 1,
      show_cover: 1,
      type: 0,
    }, auth)
    if (!Array.isArray(data?.info)) throw new Error('kg: failed to load playlist songs')
    const list = data.info
    total = Number(data?.count ?? list.length)
    if (!list.length) break
    songs.push(...list.map((song: any) => ({ ...song, hash: song.hash ?? song.FileHash })))
    page++
  }
  const infos = await musicSdk.kg.songList.getMusicInfos(songs)
  return deduplicationList(infos.map(toNewMusicInfo))
}

const parseMiguPlaylists = (body: any): RemotePlaylist[] => {
  const list = body?.data?.myCreatedMusicLists?.createdMusicLists ?? body?.myCreatedMusicLists?.createdMusicLists
  if (!Array.isArray(list)) throw new Error('mg: failed to load playlists')
  return list
    .map((item: any) => ({ id: String(item.musicListId ?? item.id ?? ''), name: String(item.title ?? item.name ?? '').trim() }))
    .filter((item: RemotePlaylist) => item.id && item.name)
}

const requestMigu = async(cookie: string, path: string) => {
  // Login can persist pacmtoken from localStorage under mg_auth_pacmtoken.
  const token = getCookieValue(cookie, 'mg_auth_pacmtoken')
  const requestCookie = token && !getCookieValue(cookie, 'pacmtoken') ? `${cookie.replace(/;\s*$/, '')}; pacmtoken=${token}` : cookie
  const { body } = await fetchResponse(`https://app.c.nf.migu.cn${path}`, {
    headers: {
      Cookie: requestCookie,
      Origin: 'https://music.migu.cn',
      Referer: 'https://music.migu.cn/v5/',
      platform: 'H5',
      ua: 'Android_migu',
      version: '6.8.8',
      IMEI: 'h5page',
      IMSI: 'h5page',
    },
  })
  if (String(body?.code) === '290001') throw new CookieLoginError('mg')
  if (String(body?.code) !== '000000') throw new Error(`mg api error: ${body?.code ?? 'unknown'}`)
  return body
}

const getMgPlaylists = async(cookie: string, captured?: RemotePlaylist[]): Promise<RemotePlaylist[]> => {
  if (captured) return captured
  const body = await requestMigu(cookie, '/pc/user/home-page/v2.0')
  return parseMiguPlaylists(body)
}

const getMgSongs = async(cookie: string, id: string): Promise<LX.Music.MusicInfo[]> => {
  const songs: any[] = []
  let total: number | undefined
  for (let page = 1; page <= 1000; page++) {
    const body = await requestMigu(cookie, `/MIGUM3.0/resource/playlist/song/v2.0?pageNo=${page}&pageSize=50&playlistId=${encodeURIComponent(id)}`)
    const list = body?.data?.songList
    const rawCount = body?.data?.totalCount
    const count = Number(rawCount)
    if (!Array.isArray(list) || !['number', 'string'].includes(typeof rawCount) || String(rawCount).trim() === '' || !Number.isSafeInteger(count) || count < 0 || (total !== undefined && total !== count)) throw new Error('mg: incomplete playlist songs')
    total = count
    songs.push(...list)
    if (songs.length === total) return deduplicationList(filterMusicInfoListV5(songs).map(toNewMusicInfo))
    if (!list.length || songs.length > total) break
  }
  throw new Error('mg: incomplete playlist songs')
}

const getPagedSdkSongs = async(source: 'kw', id: string): Promise<LX.Music.MusicInfo[]> => {
  const items: any[] = []
  let page = 1
  let total = Number.POSITIVE_INFINITY
  while (items.length < total && page <= 1000) {
    const result = await musicSdk[source].songList.getListDetail(id, page)
    if (!Array.isArray(result?.list)) throw new Error(`${source}: failed to load playlist songs`)
    const list = result.list
    total = Number(result?.total ?? list.length)
    items.push(...list)
    if (!list.length || items.length >= total) break
    page++
  }
  return deduplicationList(items.map(toNewMusicInfo))
}

export const getRemotePlaylists = async(source: CookieSource, cookie: string, captured?: RemotePlaylist[]): Promise<RemotePlaylist[]> => {
  switch (source) {
    case 'wy': return getWyPlaylists(cookie)
    case 'tx': return getTxPlaylists(cookie)
    case 'kg': return getKgPlaylists(cookie)
    case 'kw': return getKwPlaylists(cookie)
    case 'mg': return getMgPlaylists(cookie, captured)
  }
}

// Check access without importing, overwriting or removing any local playlists.
export const checkCookiePlaylists = async(source: CookieSource): Promise<CookiePlaylistCheck> => {
  const cookie = getCookie(source)
  if (!cookie.trim()) return { source, status: 'missing_cookie', listCount: 0 }
  if (!isCookieRecognized(source, cookie)) return { source, status: 'invalid_cookie', listCount: 0 }
  try {
    const playlists = await getRemotePlaylists(source, cookie)
    return { source, status: 'success', listCount: playlists.length }
  } catch (error) {
    const status = error instanceof CookieLoginError ? 'login_expired' : 'failed'
    return { source, status, listCount: 0, message: errorForTransport(error).message }
  }
}

export const getRemoteSongs = async(source: CookieSource, cookie: string, playlist: RemotePlaylist): Promise<LX.Music.MusicInfo[]> => {
  switch (source) {
    case 'wy': return getWySongs(cookie, playlist.id)
    case 'tx': return getTxSongs(cookie, playlist.id)
    case 'kg': return getKgSongs(cookie, playlist.id)
    case 'kw': return getPagedSdkSongs('kw', playlist.id)
    case 'mg': return getMgSongs(cookie, playlist.id)
  }
}
