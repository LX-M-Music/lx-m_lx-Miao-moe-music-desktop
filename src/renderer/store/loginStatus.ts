import { reactive } from '@common/utils/vueTools'
import { COOKIE_SOURCES, hasCookie, isCookieValid, type CookieSource } from '@renderer/utils/cookieManager'
import { updateSetting } from '@renderer/store/setting'

/**
 * 各平台登录状态（基于已保存的 Cookie 做字段级校验）
 * - valid:   Cookie 存在且包含平台必需的登录字段
 * - invalid: Cookie 存在但缺少必需字段（过期或复制不完整）
 * - none:    未保存 Cookie
 */

export type LoginState = 'valid' | 'invalid' | 'none'

export const COOKIE_SETTING_KEYS: Record<CookieSource, 'cookie.wy' | 'cookie.tx' | 'cookie.kg' | 'cookie.kw' | 'cookie.mg'> = {
  wy: 'cookie.wy',
  tx: 'cookie.tx',
  kg: 'cookie.kg',
  kw: 'cookie.kw',
  mg: 'cookie.mg',
}

export const loginStatus = reactive<Record<CookieSource, LoginState>>({
  wy: 'none',
  tx: 'none',
  kg: 'none',
  kw: 'none',
  mg: 'none',
})

export const refreshLoginStatus = () => {
  for (const source of COOKIE_SOURCES) {
    loginStatus[source] = !hasCookie(source) ? 'none' : (isCookieValid(source) ? 'valid' : 'invalid')
  }
}

export const countValidLogin = () => COOKIE_SOURCES.filter(source => loginStatus[source] == 'valid').length

export const clearCookie = async(source: CookieSource) => {
  await updateSetting({ [COOKIE_SETTING_KEYS[source]]: '' })
  refreshLoginStatus()
}
