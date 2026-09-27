import { app, dialog } from 'electron'
import './utils/logInit'
import '@common/error'
import {
  initGlobalData,
  initSingleInstanceHandle,
  applyElectronEnvParams,
  prepareUserData,
  setUserDataPath,
  registerDeeplink,
  listenerAppEvent,
} from './app'
import { isLinux } from '@common/utils'
import { APP_NAME } from '@common/constants'
import { initAppSetting } from '@main/app'
import registerModules from '@main/modules'
import { formatError } from '@common/utils/errorMessage'

// 初始化应用
let startupPromise: Promise<void> | null = null
const init = () => {
  if (startupPromise) return
  console.log('init')
  startupPromise = prepareUserData()
    .then(initAppSetting)
    .then(() => {
      registerModules()
      global.lx.event_app.app_inited()
    }).catch((error: unknown) => {
      console.error('initialize user data failed:', error)
      if (global.lx.appSetting['common.showErrorDialog']) dialog.showErrorBox(APP_NAME, formatError(error, '应用数据初始化失败，请检查错误原因后重试。', 'APP_INIT_FAILED'))
      app.quit()
    }).finally(() => {
      startupPromise = null
    })
}

initGlobalData()
setUserDataPath()
initSingleInstanceHandle()
applyElectronEnvParams()
registerDeeplink(init)
listenerAppEvent(init)


// https://github.com/electron/electron/issues/16809
void app.whenReady().then(() => {
  isLinux ? setTimeout(init, 300) : init()
})
