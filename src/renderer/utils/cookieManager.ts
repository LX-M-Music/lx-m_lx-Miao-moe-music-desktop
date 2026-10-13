/**
 * Cookie 管理工具
 *
 * ⚠️ 重要：本项目中的 Cookie 仅用于以下用途，**不会解锁高音质**：
 *   1. 拉取登录用户的云端歌单（同步到本地）
 *   2. 上报本地播放记录到平台（影响平台「每日推荐」算法）
 *   3. 在列表更新管理中单独开启后，将本地歌单编辑同步回对应平台
 *
 * 高音质解锁请通过「设置 → 基本设置 → 自定义源」配置音源，
 * 详见 README.md 中「高音质解锁 / 音源机制」章节。
 *
 * 支持的平台：
 *   - wy   网易云音乐   https://music.163.com
 *   - tx   QQ 音乐      https://y.qq.com
 *   - kg   酷狗音乐     https://www.kugou.com
 *   - kw   酷我音乐     https://www.kuwo.cn
 *   - mg   咪咕音乐     https://music.migu.cn
 */

import { appSetting } from '@renderer/store/setting'
import { COOKIE_LOGIN_DEFINITIONS, hasLoginState } from '@common/cookieLogin'

/** 音乐平台标识 */
export type MusicSource = 'wy' | 'tx' | 'kg' | 'kw' | 'mg'

/** 支持歌单同步的音乐平台标识 */
export type CookieSource = 'wy' | 'tx' | 'kg' | 'kw' | 'mg'

/** 可同步歌单的平台列表 */
export const COOKIE_SOURCES: CookieSource[] = ['wy', 'tx', 'kg', 'kw', 'mg']

/** 平台对应的设置项 key */
const SOURCE_SETTING_KEY: Record<MusicSource, 'cookie.wy' | 'cookie.tx' | 'cookie.kg' | 'cookie.kw' | 'cookie.mg'> = {
  wy: 'cookie.wy',
  tx: 'cookie.tx',
  kg: 'cookie.kg',
  kw: 'cookie.kw',
  mg: 'cookie.mg',
}

/** 平台对应的根域名（用于在 UI 中提供「打开官网」按钮，便于用户登录后取 Cookie） */
export const SOURCE_DOMAIN: Record<MusicSource, string> = {
  wy: 'music.163.com',
  tx: 'y.qq.com',
  kg: 'www.kugou.com',
  kw: 'www.kuwo.cn',
  mg: 'music.migu.cn',
}

/** 平台中文名 */
export const SOURCE_NAME: Record<MusicSource, string> = {
  wy: '网易云音乐',
  tx: 'QQ 音乐',
  kg: '酷狗音乐',
  kw: '酷我音乐',
  mg: '咪咕音乐',
}

/**
 * 获取指定平台的 Cookie 字符串
 * @param source 音乐平台标识
 * @returns Cookie 字符串（未设置时返回空串）
 */
export const getCookie = (source: MusicSource): string => {
  return appSetting[SOURCE_SETTING_KEY[source]] ?? ''
}

/**
 * 判断指定平台是否已设置 Cookie
 * @param source 音乐平台标识
 */
export const hasCookie = (source: MusicSource): boolean => {
  return getCookie(source).trim().length > 0
}

/**
 * 从 Cookie 字符串中提取指定字段的值
 * @param cookie Cookie 字符串
 * @param name 字段名
 */
export const getCookieValue = (cookie: string, name: string): string | null => {
  if (!cookie) return null
  // 兼容 `key=value; key2=value2` 与换行/制表分隔
  const match = new RegExp(`(?:^|[;\\s])${name}\\s*=\\s*([^;]+)`).exec(cookie)
  return match ? match[1].trim() || null : null
}

/**
 * 判断 Cookie 是否看起来有效（仅用于 UI 提示）
 *
 * 简单启发式判断：
 *   - 网易云：检查 `MUSIC_U` 字段是否存在
 *   - QQ 音乐：检查 `uin`（或 `wxuin`）和 `qqmusic_key` 字段是否存在
 *   - 酷狗：检查同步接口所需的 `KuGoo` 登录字段是否存在
 *   - 酷我：检查同步接口所需的 `userid` 字段是否存在
 *   - 咪咕：检查 `mg_auth_sid` / `migu_music_sid` / `USER_ID` 字段是否存在
 */
export const isCookieValid = (source: MusicSource, cookie?: string): boolean => {
  const c = cookie ?? getCookie(source)
  if (!c.trim()) return false
  const definition = COOKIE_LOGIN_DEFINITIONS[source]
  const names = new Set([...definition.cookieGroups.flat(), ...(definition.storageKeys ?? [])])
  return hasLoginState([...names].map(name => ({ name, value: getCookieValue(c, name) ?? '' })), new Map(), definition)
}

/**
 * 判断 Cookie 是否可识别（用于歌单同步前的快速校验，等价于 isCookieValid）
 * @param source 音乐平台标识
 * @param cookie 可选 Cookie 字符串，默认读取已保存的值
 */
export const isCookieRecognized = (source: CookieSource, cookie?: string): boolean => {
  return isCookieValid(source, cookie)
}

/**
 * 播放记录同步开关
 */
export const isPlayHistorySyncEnabled = (): boolean => {
  return appSetting['cookie.enablePlayHistorySync']
}

/**
 * 收藏歌单同步开关
 */
export const isFavListSyncEnabled = (): boolean => {
  return appSetting['cookie.enableFavListSync']
}
