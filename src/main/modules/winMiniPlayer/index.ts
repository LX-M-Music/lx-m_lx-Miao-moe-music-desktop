import initRendererEvent, { sendConfigChange, sendMainWindowInitedEvent } from './rendererEvent'
import { buildMiniPlayerConfig, initWindowSize, getWindowBounds } from './utils'
import { closeWindow, createWindow, isExistWindow, updateMouseLock, setSkipTaskbar, setBounds, getBounds, alwaysOnTopTools } from './main'

export default () => {
  initRendererEvent()
  let fullscreen = false
  const synchronizeWindow = () => {
    if (!global.lx.appSetting['miniPlayer.enable'] || (fullscreen && global.lx.appSetting['miniPlayer.fullscreenHide'])) {
      alwaysOnTopTools.clearLoop()
      closeWindow()
    } else if (!isExistWindow()) createWindow()
  }
  global.lx.event_app.on('main_window_inited', () => {
    fullscreen = global.lx.appSetting['common.startInFullscreen']
    synchronizeWindow()
    if (isExistWindow()) sendMainWindowInitedEvent()
  })
  global.lx.event_app.on('main_window_close', () => { alwaysOnTopTools.clearLoop(); closeWindow() })
  global.lx.event_app.on('main_window_fullscreen', value => { fullscreen = value; synchronizeWindow() })
  global.lx.event_app.on('updated_config', (keys, config) => {
    if (keys.some(key => key === 'miniPlayer.enable' || key === 'miniPlayer.fullscreenHide')) synchronizeWindow()
    if (!isExistWindow()) return
    const changed = buildMiniPlayerConfig(config)
    if (Object.keys(changed).length) sendConfigChange(changed)
    if (keys.some(key => key === 'miniPlayer.isLock' || key === 'miniPlayer.autoHideControls' || key === 'miniPlayer.backgroundOpacity')) updateMouseLock()
    if (keys.includes('miniPlayer.isShowTaskbar')) setSkipTaskbar(!global.lx.appSetting['miniPlayer.isShowTaskbar'])
    if (keys.some(key => key === 'miniPlayer.isAlwaysOnTop' || key === 'miniPlayer.isAlwaysOnTopLoop')) {
      alwaysOnTopTools.setAlwaysOnTop(global.lx.appSetting['miniPlayer.isAlwaysOnTop'] && global.lx.appSetting['miniPlayer.isAlwaysOnTopLoop'])
    }
    if (keys.includes('miniPlayer.x') && config['miniPlayer.x'] == null) {
      setBounds(initWindowSize(null, null, global.lx.appSetting['miniPlayer.width'], global.lx.appSetting['miniPlayer.height']))
    }
    if (keys.includes('miniPlayer.isLockScreen') && global.lx.appSetting['miniPlayer.isLockScreen']) {
      const bounds = getBounds()
      if (bounds) setBounds(getWindowBounds(bounds, { x: 0, y: 0, w: bounds.width, h: bounds.height }))
    }
  })
}
