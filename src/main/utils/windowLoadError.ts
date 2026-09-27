import { dialog, type BrowserWindow } from 'electron'
import { formatError } from '@common/utils/errorMessage'

export const observeWindowLoadErrors = (window: BrowserWindow) => {
  let showing = false
  window.webContents.on('did-fail-load', (_event, code, reason, _url, isMainFrame) => {
    if (!isMainFrame || code === -3 || showing || window.isDestroyed()) return
    console.error('Main window load failed:', code, reason)
    if (!global.lx.appSetting['common.showErrorDialog']) return
    showing = true
    void dialog.showMessageBox(window, {
      type: 'error',
      title: 'LX-M Music',
      message: formatError({ code: `CHROMIUM_${code}`, message: reason }, '', 'WINDOW_LOAD_FAILED'),
      buttons: ['重新加载 / Reload', '关闭 / Close'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0 && !window.isDestroyed()) window.webContents.reload()
    }).catch(console.error).finally(() => { showing = false })
  })
}
