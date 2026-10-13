import { reactive } from '@common/utils/vueTools'
import { formatError } from '@common/utils/errorMessage'
import { isCookieValid, type CookieSource } from '@renderer/utils/cookieManager'
import { cancelLoginCookieEmbedded, loginCookie, loginCookieEmbedded, type CookieLoginResult } from '@renderer/utils/ipc'
import { appSetting, updateSetting } from './setting'
import { COOKIE_SETTING_KEYS, refreshLoginStatus } from './loginStatus'

export type PlatformLoginMode = 'embedded' | 'browser'
interface LoginState { mode?: PlatformLoginMode, error: string, success: boolean }
interface LoginTask { mode: PlatformLoginMode, superseded: boolean, promise: Promise<CookieLoginResult | undefined> }
export const platformLoginStates = reactive<Partial<Record<CookieSource, LoginState>>>({})
const tasks = new Map<CookieSource, LoginTask>()
export const clearPlatformLoginState = (source: CookieSource) => { if (!tasks.has(source)) platformLoginStates[source] = undefined }

// Share in-flight attempts between the home modal and platform settings.
export const loginPlatform = async(source: CookieSource, mode: PlatformLoginMode): Promise<CookieLoginResult | undefined> => {
  const current = tasks.get(source)
  if (current) {
    if (mode !== 'browser' || current.mode !== 'embedded') return
    current.superseded = true
    await cancelLoginCookieEmbedded(source)
    await current.promise.catch(() => {})
    if (tasks.has(source)) return
  }
  const state: LoginState = reactive({ mode, error: '', success: false })
  const task: LoginTask = { mode, superseded: false, promise: Promise.resolve(undefined) }
  platformLoginStates[source] = state
  tasks.set(source, task)
  task.promise = (async() => {
    try {
      const result = await (mode === 'embedded' ? loginCookieEmbedded(source) : loginCookie(source))
      if (task.superseded || tasks.get(source) !== task) return
      if (!isCookieValid(source, result.cookie)) throw new Error('[COOKIE_LOGIN_INVALID] 未获取到完整登录信息，请重新登录')
      const key = COOKIE_SETTING_KEYS[source]
      await updateSetting({ [key]: result.cookie })
      appSetting[key] = result.cookie
      refreshLoginStatus()
      state.success = true
      return result
    } catch (error) {
      if (task.superseded) return
      state.error = formatError(error, '', 'COOKIE_LOGIN_FAILED')
      throw error
    } finally {
      if (tasks.get(source) === task) { tasks.delete(source); state.mode = undefined }
    }
  })()
  return task.promise
}
