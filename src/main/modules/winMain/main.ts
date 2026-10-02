import { BrowserWindow, dialog, screen, session } from 'electron'
import { observeWindowLoadErrors } from '@main/utils/windowLoadError'
import { registerIpcWindow } from '@main/utils/ipcPolicy'
import path from 'node:path'
import { type WindowState, windowSizeList } from '@common/config'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { createTaskBarButtons, getWindowSizeInfo, getWindowSizing } from './utils'
import { getPlatform, isLinux, isWin, log } from '@common/utils'
import { getProxy, openDevTools as handleOpenDevTools } from '@main/utils'
import { mainSend } from '@common/mainIpc'
import { sendFocus, sendTaskbarButtonClick } from './rendererEvent'
import { encodePath } from '@common/utils/electron'

let browserWindow: Electron.BrowserWindow | null = null
let maximizedRestoreBounds: Electron.Rectangle | null = null
let windowFullscreen = false
let windowAspectRatio = 0
let rendererRecoveryAttempts = 0
let rendererRecoveryResetTimer: ReturnType<typeof setTimeout> | null = null

const RENDERER_RECOVERY_RESET_DELAY = 30_000

export const getWindowState = (): WindowState => ({
  isMaximized: !!maximizedRestoreBounds || !!browserWindow?.isMaximized(),
  isFullscreen: windowFullscreen,
  isVisible: !!browserWindow?.isVisible() && !browserWindow.isMinimized(),
})

const sendWindowState = () => {
  if (!browserWindow || browserWindow.webContents.isDestroyed()) return
  sendEvent(WIN_MAIN_RENDERER_EVENT_NAME.window_state_changed, getWindowState())
}

const fitWindowBounds = (bounds: Electron.Rectangle): Electron.Rectangle => {
  const area = screen.getDisplayMatching(bounds).workArea
  const scale = Math.min(1, area.width / bounds.width, area.height / bounds.height)
  const width = Math.max(1, Math.round(bounds.width * scale))
  const height = Math.max(1, Math.round(bounds.height * scale))
  return {
    width,
    height,
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
  }
}

const updateWindowResizeMode = () => {
  if (!browserWindow) return
  const expanded = windowFullscreen || getWindowState().isMaximized
  if (browserWindow.isResizable() === expanded) browserWindow.setResizable(!expanded)
  browserWindow.setAspectRatio(expanded ? 0 : windowAspectRatio)
  if (!expanded) {
    const area = screen.getDisplayMatching(browserWindow.getBounds()).workArea
    const { minWidth, minHeight } = getWindowSizing({ width: windowAspectRatio, height: 1 }, area)
    browserWindow.setMinimumSize(minWidth, minHeight)
  }
}

const updateMaximizedBounds = () => {
  if (!browserWindow || !maximizedRestoreBounds || windowFullscreen) return
  updateWindowResizeMode()
  const area = screen.getDisplayMatching(browserWindow.getBounds()).workArea
  browserWindow.setMinimumSize(Math.min(windowSizeList[0].width, area.width), Math.min(windowSizeList[0].height, area.height))
  browserWindow.setBounds(area)
  sendWindowState()
}

const winEvent = () => {
  if (!browserWindow) return
  const window = browserWindow
  let saveSizeTimer: ReturnType<typeof setTimeout> | undefined
  let userResized = false
  const saveWindowSize = () => {
    clearTimeout(saveSizeTimer)
    saveSizeTimer = undefined
    if (!userResized) return
    userResized = false
    if (window.isDestroyed() || window.isMinimized() || windowFullscreen || getWindowState().isMaximized) return
    const { width, height } = window.getBounds()
    void global.lx.event_app.update_config({ 'common.windowWidth': width, 'common.windowHeight': height })
  }
  window.on('will-resize', () => {
    if (!windowFullscreen && !getWindowState().isMaximized) userResized = true
  })
  window.on('resize', () => {
    if (!userResized) return
    clearTimeout(saveSizeTimer)
    saveSizeTimer = setTimeout(saveWindowSize, 250)
  })
  window.on('resized', saveWindowSize)

  browserWindow.on('close', event => {
    if (saveSizeTimer) saveWindowSize()
    if (global.lx.isSkipTrayQuit || !global.lx.appSetting['tray.enable']) {
      browserWindow!.setProgressBar(-1)
      // global.lx.mainWindowClosed = true
      global.lx.event_app.main_window_close()
      return
    }

    event.preventDefault()
    browserWindow!.hide()
  })

  browserWindow.on('closed', () => {
    clearTimeout(saveSizeTimer)
    // global.lx.mainWindowClosed = true
    browserWindow = null
    maximizedRestoreBounds = null
    windowFullscreen = false
    screen.removeListener('display-metrics-changed', updateMaximizedBounds)
    screen.removeListener('display-removed', updateMaximizedBounds)
  })

  const windowModeChanged = () => { updateWindowResizeMode(); sendWindowState() }
  browserWindow.on('maximize', windowModeChanged)
  browserWindow.on('unmaximize', windowModeChanged)
  browserWindow.on('minimize', sendWindowState)
  browserWindow.on('restore', sendWindowState)
  browserWindow.on('show', sendWindowState)
  browserWindow.on('hide', sendWindowState)
  browserWindow.on('enter-full-screen', () => {
    // Transparent Windows windows emit this event but can report isFullScreen() as false.
    windowFullscreen = true
    updateWindowResizeMode()
    global.lx.event_app.main_window_fullscreen(true)
    sendWindowState()
  })
  browserWindow.on('leave-full-screen', () => {
    windowFullscreen = false
    updateMaximizedBounds()
    updateWindowResizeMode()
    global.lx.event_app.main_window_fullscreen(false)
    sendWindowState()
  })
  screen.on('display-metrics-changed', updateMaximizedBounds)
  screen.on('display-removed', updateMaximizedBounds)

  // browserWindow.on('restore', () => {
  //   browserWindow.webContents.send('restore')
  // })
  browserWindow.on('focus', () => {
    sendFocus()
    global.lx.event_app.main_window_focus()
  })

  browserWindow.on('blur', () => {
    global.lx.event_app.main_window_blur()
  })

  browserWindow.once('ready-to-show', () => {
    if (!global.envParams.cmdParams.hidden) {
      showWindow()
      setThumbarButtons()
    }
    global.lx.event_app.main_window_ready_to_show()
  })

  const webContents = browserWindow.webContents
  webContents.on('did-finish-load', () => {
    sendWindowState()
    if (rendererRecoveryResetTimer) clearTimeout(rendererRecoveryResetTimer)
    rendererRecoveryResetTimer = setTimeout(() => {
      rendererRecoveryAttempts = 0
      rendererRecoveryResetTimer = null
    }, RENDERER_RECOVERY_RESET_DELAY)
  })
  webContents.on('render-process-gone', (_event, details) => {
    log.error(`Main renderer process gone: ${details.reason} (${details.exitCode})`)
    if (rendererRecoveryResetTimer) {
      clearTimeout(rendererRecoveryResetTimer)
      rendererRecoveryResetTimer = null
    }
    if (details.reason == 'clean-exit' || details.reason == 'launch-failed') return
    if (rendererRecoveryAttempts > 0) {
      log.error('Main renderer recovery skipped after repeated failure')
      return
    }
    rendererRecoveryAttempts++

    setTimeout(() => {
      if (webContents.isDestroyed()) return
      webContents.reload()
    }, 300)
  })

  browserWindow.on('show', () => {
    global.lx.event_app.main_window_show()

    // 修复隐藏窗口后再显示时任务栏按钮丢失的问题
    setThumbarButtons()
  })
  browserWindow.on('hide', () => {
    global.lx.event_app.main_window_hide()
  })
}


export const createWindow = () => {
  closeWindow()
  maximizedRestoreBounds = null
  windowFullscreen = global.lx.appSetting['common.startInFullscreen']
  const windowSizeInfo = getWindowSizeInfo(global.lx.appSetting['common.windowSizeId'], global.lx.appSetting['common.windowWidth'], global.lx.appSetting['common.windowHeight'])
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const { width, height, minWidth, minHeight } = getWindowSizing(windowSizeInfo, area)

  const { shouldUseDarkColors, theme } = global.lx.theme
  const ses = session.fromPartition('persist:win-main')
  const proxy = getProxy()
  setSesProxy(ses, proxy?.host, proxy?.port)

  /**
   * Initial window options
   */
  const options: Electron.BrowserWindowConstructorOptions = {
    height,
    // Saved dimensions are getBounds() dimensions, including any native border.
    useContentSize: false,
    width,
    x: area.x + Math.floor((area.width - width) / 2),
    y: area.y + Math.floor((area.height - height) / 2),
    minWidth,
    minHeight,
    frame: false,
    transparent: !global.envParams.cmdParams.dt,
    hasShadow: global.envParams.cmdParams.dt,
    // enableRemoteModule: false,
    // icon: join(global.__static, isWin ? 'icons/256x256.ico' : 'icons/512x512.png'),
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    roundedCorners: global.envParams.cmdParams.dt,
    show: false,
    webPreferences: {
      session: ses,
      nodeIntegrationInWorker: true,
      contextIsolation: false,
      webSecurity: false,
      nodeIntegration: true,
      sandbox: false,
      enableWebSQL: false,
      webgl: true, // Folia's canvas lyric styles create their WebGL context on demand.
      spellcheck: false, // 禁用拼写检查器
    },
  }
  if (global.envParams.cmdParams.dt) options.backgroundColor = theme.colors['--color-primary-light-1000']
  if (global.lx.appSetting['common.startInFullscreen']) {
    options.fullscreen = true
    if (isLinux) options.resizable = true
  }
  browserWindow = new BrowserWindow(options)
  // Fractional display scaling can round initial bounds outward. Correct the
  // requested size before locking its ratio so restarts cannot accumulate it.
  if (!windowFullscreen) {
    let requestedWidth = width
    let requestedHeight = height
    for (let attempt = 0; attempt < 3; attempt++) {
      browserWindow.setBounds({ width: requestedWidth, height: requestedHeight })
      const actual = browserWindow.getBounds()
      if (actual.width === width && actual.height === height) break
      requestedWidth += width - actual.width
      requestedHeight += height - actual.height
    }
  }
  windowAspectRatio = width / height
  updateWindowResizeMode()
  observeWindowLoadErrors(browserWindow)

  const winURL = process.env.NODE_ENV !== 'production' ? 'http://localhost:9080' : `file://${path.join(encodePath(__dirname), 'index.html')}`
  registerIpcWindow(browserWindow.webContents, 'main', winURL)
  void browserWindow.loadURL(winURL + `?os=${getPlatform()}&dt=${global.envParams.cmdParams.dt}&dark=${shouldUseDarkColors}&theme=${encodeURIComponent(JSON.stringify(theme))}`)

  winEvent()

  if (global.envParams.cmdParams.odt) handleOpenDevTools(browserWindow.webContents)

  // global.lx.mainWindowClosed = false
  // browserWindow.webContents.openDevTools()
  global.lx.event_app.main_window_created(browserWindow)
}

export const isExistWindow = (): boolean => !!browserWindow
export const isShowWindow = (): boolean => {
  if (!browserWindow) return false
  return browserWindow.isVisible() && (isWin ? true : browserWindow.isFocused())
}

export const closeWindow = () => {
  if (!browserWindow) return
  browserWindow.close()
}

const setSesProxy = (ses: Electron.Session, host?: string, port?: string | number) => {
  if (host) {
    void ses.setProxy({
      mode: 'fixed_servers',
      proxyRules: `http://${host}:${port}`,
    })
  } else {
    void ses.setProxy({
      mode: 'direct',
    })
  }
}
export const setProxy = () => {
  if (!browserWindow) return
  const proxy = getProxy()
  setSesProxy(browserWindow.webContents.session, proxy?.host, proxy?.port)
}


export const sendEvent = <T = any>(name: string, params?: T) => {
  if (!browserWindow) return
  mainSend(browserWindow, name, params)
}

export const showSelectDialog = async(options: Electron.OpenDialogOptions) => {
  if (!browserWindow) throw new Error('main window is undefined')
  return dialog.showOpenDialog(browserWindow, options)
}
export const showDialog = ({ type, message, detail }: Electron.MessageBoxSyncOptions) => {
  if (!browserWindow) return
  dialog.showMessageBoxSync(browserWindow, {
    type,
    message,
    detail,
  })
}
export const showSaveDialog = async(options: Electron.SaveDialogOptions) => {
  if (!browserWindow) throw new Error('main window is undefined')
  return dialog.showSaveDialog(browserWindow, options)
}
export const minimize = () => {
  if (!browserWindow) return
  browserWindow.minimize()
}
export const maximize = () => {
  if (!browserWindow || getWindowState().isMaximized || windowFullscreen) return
  // Transparent Windows windows do not reliably report native maximization.
  if (isWin && !global.envParams.cmdParams.dt) {
    maximizedRestoreBounds = browserWindow.getBounds()
    updateMaximizedBounds()
    return
  }
  browserWindow.maximize()
}
export const unmaximize = () => {
  if (!browserWindow) return
  if (maximizedRestoreBounds) {
    const bounds = fitWindowBounds(maximizedRestoreBounds)
    maximizedRestoreBounds = null
    browserWindow.setBounds(bounds)
    updateWindowResizeMode()
    sendWindowState()
    return
  }
  browserWindow.unmaximize()
}
export const toggleMaximize = () => {
  if (windowFullscreen) return
  if (getWindowState().isMaximized) unmaximize()
  else maximize()
}
export const toggleHide = () => {
  if (!browserWindow) return
  browserWindow.isVisible()
    ? browserWindow.hide()
    : browserWindow.show()
}
export const toggleMinimize = () => {
  if (!browserWindow) return
  if (browserWindow.isVisible()) {
    if (browserWindow.isMinimized()) browserWindow.restore()
    else browserWindow.minimize()
  } else browserWindow.show()
}
export const showWindow = () => {
  if (!browserWindow) return
  if (browserWindow.isVisible()) {
    if (browserWindow.isMinimized()) browserWindow.restore()
    else browserWindow.focus()
  } else browserWindow.show()
}
export const hideWindow = () => {
  if (!browserWindow) return
  browserWindow.hide()
}
export const setWindowBounds = (options: Partial<Electron.Rectangle>) => {
  if (!browserWindow || windowFullscreen) return
  if (getWindowState().isMaximized) unmaximize()
  browserWindow.setBounds(fitWindowBounds({ ...browserWindow.getBounds(), ...options }))
  const [width, height] = browserWindow.getContentSize()
  windowAspectRatio = width / height
  updateWindowResizeMode()
  if (options.width != null || options.height != null) {
    const bounds = browserWindow.getBounds()
    void global.lx.event_app.update_config({ 'common.windowWidth': bounds.width, 'common.windowHeight': bounds.height })
  }
  sendWindowState()
}
export const setProgressBar = (progress: number, options?: Electron.ProgressBarOptions) => {
  if (!browserWindow) return
  browserWindow.setProgressBar(progress, options)
}
export const setIgnoreMouseEvents = (ignore: boolean, options?: Electron.IgnoreMouseEventsOptions) => {
  if (!browserWindow) return
  browserWindow.setIgnoreMouseEvents(ignore, options)
}
export const toggleDevTools = () => {
  if (!browserWindow) return
  if (browserWindow.webContents.isDevToolsOpened()) {
    browserWindow.webContents.closeDevTools()
  } else {
    handleOpenDevTools(browserWindow.webContents)
  }
}

export const setFullScreen = (isFullscreen: boolean): boolean => {
  if (!browserWindow) return false
  if (isLinux && isFullscreen) browserWindow.setResizable(true)
  browserWindow.setFullScreen(isFullscreen)
  return isFullscreen
}

const taskBarButtonFlags: LX.TaskBarButtonFlags = {
  empty: true,
  collect: false,
  play: false,
  next: true,
  prev: true,
}
export const setThumbarButtons = ({ empty, collect, play, next, prev }: LX.TaskBarButtonFlags = taskBarButtonFlags) => {
  if (!isWin || !browserWindow) return
  taskBarButtonFlags.empty = empty
  taskBarButtonFlags.collect = collect
  taskBarButtonFlags.play = play
  taskBarButtonFlags.next = next
  taskBarButtonFlags.prev = prev
  browserWindow.setThumbarButtons(createTaskBarButtons(taskBarButtonFlags, action => {
    sendTaskbarButtonClick(action)
  }))
}

export const setThumbnailClip = (region: Electron.Rectangle) => {
  if (!browserWindow) return
  browserWindow.setThumbnailClip(region)
}


export const clearCache = async() => {
  if (!browserWindow) throw new Error('main window is undefined')
  await browserWindow.webContents.session.clearCache()
}

export const getCacheSize = async() => {
  if (!browserWindow) throw new Error('main window is undefined')
  return browserWindow.webContents.session.getCacheSize()
}

export const getWebContents = (): Electron.WebContents => {
  if (!browserWindow) throw new Error('main window is undefined')
  return browserWindow.webContents
}
