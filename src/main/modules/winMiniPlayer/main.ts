import path from 'node:path'
import { BrowserWindow } from 'electron'
import { observeWindowLoadErrors } from '@main/utils/windowLoadError'
import { registerIpcWindow } from '@main/utils/ipcPolicy'
import { getPlatform, isWin } from '@common/utils'
import { initWindowSize, getMinimumSize, getWindowBounds } from './utils'
import { mainSend } from '@common/mainIpc'
import { encodePath } from '@common/utils/electron'
import { createLockControls } from './lockControls'
import { createEdgeHideControls } from './edgeHide'
import { WIN_MINI_PLAYER_RENDERER_EVENT_NAME } from '@common/ipcNames'

// require('./event')
// require('./rendererEvent')

let browserWindow: Electron.BrowserWindow | null = null
let lockControls: ReturnType<typeof createLockControls> | null = null
let edgeHideControls: ReturnType<typeof createEdgeHideControls> | null = null
let isWinBoundsUpdateing = false
let lastSetBoundsTime = 0
let requestedWindowSize: Pick<Electron.Rectangle, 'width' | 'height'> | null = null
const SET_BOUNDS_GRACE_MS = 800

const winEvent = () => {
  if (!browserWindow) return
  const window = browserWindow
  let isResizing = false
  let isCorrectingPosition = false
  // Keep the requested size separate from position-dependent DIP rounding.
  const windowSize = requestedWindowSize = {
    width: global.lx.appSetting['miniPlayer.width'],
    height: global.lx.appSetting['miniPlayer.height'],
  }
  const updateWindowSize = () => {
    // A move can emit resize later, after the correction has returned. Only
    // learn native dimensions from a user-authorized resize gesture.
    if (isCorrectingPosition || !isResizing) return
    const { width, height } = window.getBounds()
    Object.assign(windowSize, { width, height })
  }
  let saveBoundsTimer: NodeJS.Timeout | null = null
  const saveBoundsConfig = () => {
    if (saveBoundsTimer) {
      clearTimeout(saveBoundsTimer)
      saveBoundsTimer = null
    }
    const bounds = controls.getExpandedBounds() ?? window.getBounds()
    void global.lx.event_app.update_config({
      'miniPlayer.x': bounds.x,
      'miniPlayer.y': bounds.y,
      'miniPlayer.width': windowSize.width,
      'miniPlayer.height': windowSize.height,
    })
    isWinBoundsUpdateing = false
  }
  const scheduleBoundsSave = () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
    saveBoundsTimer = setTimeout(saveBoundsConfig, 500)
  }
  const controls = edgeHideControls = createEdgeHideControls(window, {
    getSize: () => windowSize,
    isResizing: () => isResizing,
    onMotion: motion => {
      mainSend(window, WIN_MINI_PLAYER_RENDERER_EVENT_NAME.edge_motion, motion)
      lockControls?.update()
      scheduleBoundsSave()
    },
    onChange: edge => {
      mainSend(window, WIN_MINI_PLAYER_RENDERER_EVENT_NAME.edge_hidden, edge)
      lockControls?.update()
      scheduleBoundsSave()
    },
  })

  // browserWindow.on('close', () => {
  //   if (global.lx.appSetting['miniPlayer.enable'] && !global.lx.mainWindowClosed) {
  //     browserWindow = null
  //     global.lx.event_app.update_config({ 'miniPlayer.enable': false })
  //   }
  // })

  window.on('close', () => {
    if (saveBoundsTimer != null || isResizing || controls.isHidden()) saveBoundsConfig()
  })
  window.on('closed', () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
    if (browserWindow === window) {
      browserWindow = null
      lockControls = null
      edgeHideControls = null
      requestedWindowSize = null
    }
  })

  window.on('will-resize', event => {
    if (global.lx.appSetting['miniPlayer.isLock'] || !controls.beginInteraction()) {
      event.preventDefault()
      return
    }
    // Resizing an edge may emit move before resize. Keep the entire gesture
    // authorized even if the user pauses long enough for a debounced save.
    isResizing = true
    isWinBoundsUpdateing = true
    lastSetBoundsTime = Date.now()
  })
  window.on('resized', () => {
    controls.endInteraction()
    if (!isResizing) return
    updateWindowSize()
    isResizing = false
    lastSetBoundsTime = Date.now()
    saveBoundsConfig()
  })

  browserWindow.on('will-move', (event, bounds) => {
    if (global.lx.appSetting['miniPlayer.isLock'] || !controls.beginInteraction()) {
      event.preventDefault()
      return
    }
    // Native dragging is intentional movement, just like setBounds below.
    isWinBoundsUpdateing = true
    lastSetBoundsTime = Date.now()
    if (!isWin || !global.lx.appSetting['miniPlayer.isLockScreen']) return
    const limited = getWindowBounds(bounds, { x: 0, y: 0, w: windowSize.width, h: windowSize.height })
    if (limited.x === bounds.x && limited.y === bounds.y) return
    event.preventDefault()
    const current = window.getBounds()
    if (current.x !== limited.x || current.y !== limited.y) {
      // setPosition reuses the rounded getBounds size and can enlarge a window
      // on every step along an edge at fractional display scales. Pin its size
      // explicitly and don't learn a new size from this correction's resize event.
      isCorrectingPosition = true
      try {
        window.setBounds(limited)
      } finally {
        isCorrectingPosition = false
      }
    }
    scheduleBoundsSave()
  })

  browserWindow.on('move', () => {
    if (controls.ownsBounds()) return
    // bounds = browserWindow.getBounds()
    // console.log('move', isWinBoundsUpdateing)
    if (isResizing || isWinBoundsUpdateing || Date.now() - lastSetBoundsTime < SET_BOUNDS_GRACE_MS) {
      scheduleBoundsSave()
    } else if (isWin) { // Linux 不允许将窗口设置出屏幕之外，MacOS未知，故只在Windows下执行强制设置
      // 非主动调整窗口触发的窗口位置变化将重置回设置值
      browserWindow!.setBounds({
        x: global.lx.appSetting['miniPlayer.x'] ?? 0,
        y: global.lx.appSetting['miniPlayer.y'] ?? 0,
        width: global.lx.appSetting['miniPlayer.width'],
        height: global.lx.appSetting['miniPlayer.height'],
      })
    }
  })

  browserWindow.on('resize', () => {
    if (controls.ownsBounds()) return
    updateWindowSize()
    // bounds = browserWindow.getBounds()
    // console.log(bounds)
    isWinBoundsUpdateing = true
    lastSetBoundsTime = Date.now()
    scheduleBoundsSave()
  })
  window.on('moved', controls.endInteraction)

  // browserWindow.on('restore', () => {
  //   browserWindow.webContents.send('restore')
  // })
  // browserWindow.on('focus', () => {
  //   browserWindow.webContents.send('focus')
  // })

  browserWindow.once('ready-to-show', () => {
    showWindow()
    updateMouseLock()
    controls.start()
    // linux下每次重开时貌似要重新设置置顶
    // if (isLinux && global.lx.appSetting['miniPlayer.isAlwaysOnTop']) {
    //   browserWindow!.setAlwaysOnTop(global.lx.appSetting['miniPlayer.isAlwaysOnTop'], 'screen-saver')
    // }
    if (global.lx.appSetting['miniPlayer.isAlwaysOnTop'] && global.lx.appSetting['miniPlayer.isAlwaysOnTopLoop']) alwaysOnTopTools.startLoop()
    browserWindow!.blur()
  })
}

export const createWindow = () => {
  closeWindow()
  isWinBoundsUpdateing = false
  lastSetBoundsTime = 0
  if (!global.envParams.workAreaSize) return
  let x = global.lx.appSetting['miniPlayer.x']
  let y = global.lx.appSetting['miniPlayer.y']
  let width = global.lx.appSetting['miniPlayer.width']
  let height = global.lx.appSetting['miniPlayer.height']
  let isAlwaysOnTop = global.lx.appSetting['miniPlayer.isAlwaysOnTop']
  // let isLockScreen = global.lx.appSetting['miniPlayer.isLockScreen']
  let isShowTaskbar = global.lx.appSetting['miniPlayer.isShowTaskbar']
  // let { width: screenWidth, height: screenHeight } = global.envParams.workAreaSize
  const winSize = initWindowSize(x, y, width, height)
  void global.lx.event_app.update_config({
    'miniPlayer.x': winSize.x,
    'miniPlayer.y': winSize.y,
    'miniPlayer.width': winSize.width,
    'miniPlayer.height': winSize.height,
  })

  const { shouldUseDarkColors, theme } = global.lx.theme

  /**
   * Initial window options
   */
  browserWindow = new BrowserWindow({
    height: winSize.height,
    width: winSize.width,
    x: winSize.x,
    y: winSize.y,
    ...getMinimumSize(),
    useContentSize: true,
    frame: false,
    transparent: true,
    hasShadow: false,
    // enableRemoteModule: false,
    // icon: join(global.__static, isWin ? 'icons/256x256.ico' : 'icons/512x512.png'),
    resizable: isWin,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    roundedCorners: false,
    show: false,
    alwaysOnTop: isAlwaysOnTop,
    skipTaskbar: !isShowTaskbar,
    webPreferences: {
      contextIsolation: false,
      webSecurity: false,
      sandbox: false,
      nodeIntegration: true,
      enableWebSQL: false,
      webgl: false,
      spellcheck: false, // 禁用拼写检查器
      backgroundThrottling: false,
    },
  })
  lockControls = createLockControls(browserWindow, point => { sendEvent(WIN_MINI_PLAYER_RENDERER_EVENT_NAME.pointer_position, point) }, () => edgeHideControls?.isHidden() ?? false)
  observeWindowLoadErrors(browserWindow)

  const winURL = process.env.NODE_ENV !== 'production' ? 'http://localhost:9081/lyric.html' : `file://${path.join(encodePath(__dirname), 'lyric.html')}`
  registerIpcWindow(browserWindow.webContents, 'mini', winURL)
  void browserWindow.loadURL(winURL + `?os=${getPlatform()}&mini=true&dark=${shouldUseDarkColors}&theme=${encodeURIComponent(JSON.stringify(theme))}`)

  winEvent()
  // browserWindow.webContents.openDevTools()
}
export const isExistWindow = (): boolean => !!browserWindow

export const closeWindow = () => {
  if (!browserWindow) return
  browserWindow.close()
}

export const showWindow = () => {
  if (!browserWindow) return
  edgeHideControls?.restore()
  browserWindow.show()
}

export const setResizeable = (isResizeable: boolean) => {
  if (!browserWindow) return
  browserWindow.setResizable(isResizeable)
}

export const sendEvent = <T = any>(name: string, params?: T) => {
  if (!browserWindow) return
  mainSend(browserWindow, name, params)
}

export const getBounds = (): Electron.Rectangle | null => {
  if (!browserWindow) return null
  return edgeHideControls?.getExpandedBounds() ?? browserWindow.getBounds()
}

export const setBounds = (bounds: Electron.Rectangle) => {
  if (!browserWindow) return
  edgeHideControls?.reset()
  // Renderer resizing and explicit configuration changes are intentional. Do
  // not replace these requested dimensions with a rounded move notification.
  if (requestedWindowSize) Object.assign(requestedWindowSize, { width: bounds.width, height: bounds.height })
  isWinBoundsUpdateing = true
  lastSetBoundsTime = Date.now()
  browserWindow.setBounds(bounds)
}


export const updateMouseLock = () => { lockControls?.update() }

export const setSkipTaskbar = (skip: boolean) => {
  if (!browserWindow) return
  browserWindow.setSkipTaskbar(skip)
}

export const setAlwaysOnTop = (flag: boolean, level?: 'normal' | 'floating' | 'torn-off-menu' | 'modal-panel' | 'main-menu' | 'status' | 'pop-up-menu' | 'screen-saver' | undefined, relativeLevel?: number | undefined) => {
  if (!browserWindow) return
  browserWindow.setAlwaysOnTop(flag, level, relativeLevel)
}

export const getMainFrame = (): Electron.WebFrameMain | null => {
  if (!browserWindow) return null
  return browserWindow.webContents.mainFrame
}

interface AlwaysOnTopTools {
  timeout: NodeJS.Timeout | null
  setAlwaysOnTop: (isLoop: boolean) => void
  startLoop: () => void
  clearLoop: () => void
}
export const alwaysOnTopTools: AlwaysOnTopTools = {
  timeout: null,
  setAlwaysOnTop(isLoop) {
    this.clearLoop()
    setAlwaysOnTop(global.lx.appSetting['miniPlayer.isAlwaysOnTop'], 'screen-saver')
    // console.log(isLoop)
    if (isLoop) this.startLoop()
  },
  startLoop() {
    this.clearLoop()
    this.timeout = setInterval(() => {
      if (!isExistWindow()) {
        this.clearLoop()
        return
      }
      setAlwaysOnTop(true, 'screen-saver')
    }, 500)
  },
  clearLoop() {
    if (!this.timeout) return
    clearInterval(this.timeout)
    this.timeout = null
  },
}
