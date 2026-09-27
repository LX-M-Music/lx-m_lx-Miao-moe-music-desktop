import path from 'node:path'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync } from 'fs'
import { app, shell, screen, nativeTheme, dialog } from 'electron'
import { APP_ID, APP_NAME, APP_PROTOCOL_SCHEME, LEGACY_APP_PROTOCOL_SCHEME, URL_SCHEME_RXP } from '@common/constants'
import Database from 'better-sqlite3'
import { getProxy, getTheme, initHotKey, initSetting, parseEnvParams } from './utils'
import { navigationUrlWhiteList } from '@common/config'
import defaultSetting from '@common/defaultSetting'
import { isExistWindow as isExistMainWindow, showWindow as showMainWindow } from './modules/winMain'
import { createAppEvent, createDislikeEvent, createListEvent } from '@main/event'
import { isMac, log } from '@common/utils'
import createWorkers from './worker'
import { migrateDBData } from './utils/migrate'
import { setProxyByHost } from '@common/utils/request'
import { flushStores } from '@main/utils/store'

export const initGlobalData = () => {
  const envParams = parseEnvParams()
  // envParams.cmdParams.dt = !!envParams.cmdParams.dt

  global.envParams = {
    appVersion: app.getVersion(),
    cmdParams: envParams.cmdParams,
    deeplink: envParams.deeplink,
  }
  global.lx = {
    inited: false,
    isSkipTrayQuit: false,
    // mainWindowClosed: true,
    event_app: createAppEvent(),
    event_list: createListEvent(),
    event_dislike: createDislikeEvent(),
    appSetting: defaultSetting,
    worker: createWorkers(),
    hotKey: {
      enable: true,
      config: {
        local: {
          enable: false,
          keys: {},
        },
        global: {
          enable: false,
          keys: {},
        },
      },
      state: new Map(),
    },
    theme: {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
      theme: {
        id: '',
        name: '',
        isDark: false,
        colors: {},
      },
    },
    player_status: {
      status: 'stoped',
      name: '',
      singer: '',
      albumName: '',
      picUrl: '',
      progress: 0,
      duration: 0,
      playbackRate: 1,
      lyricLineText: '',
      lyricLineAllText: '',
      lyric: '',
      tlyric: '',
      rlyric: '',
      lxlyric: '',
      collect: false,
      volume: 0,
      mute: false,
    },
  }

  global.staticPath =
    process.env.NODE_ENV !== 'production'
      ? webpackStaticPath
      : path.join(__dirname, 'static')
}

export const initSingleInstanceHandle = () => {
  // 单例应用程序
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    process.exit(0)
  }

  app.on('second-instance', (event, argv, cwd) => {
    const envParams = parseEnvParams(argv)
    if (isExistMainWindow()) {
      if (envParams.deeplink) {
        global.envParams.deeplink = envParams.deeplink
        global.lx.event_app.deeplink(global.envParams.deeplink)
        return
      }
      if (envParams.cmdParams.hidden !== true) {
        showMainWindow()
      }
    } else {
      Object.assign(global.envParams.cmdParams, envParams.cmdParams)
      if (envParams.deeplink) global.envParams.deeplink = envParams.deeplink
    }
  })
}

export const applyElectronEnvParams = () => {
  // Is disable hardware acceleration
  if (global.envParams.cmdParams.dha) app.disableHardwareAcceleration()
  if (global.envParams.cmdParams.dhmkh) app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling')

  // fix linux transparent fail. https://github.com/electron/electron/issues/25153#issuecomment-843688494
  if (process.platform == 'linux') app.commandLine.appendSwitch('use-gl', 'desktop')

  // https://github.com/electron/electron/issues/22691
  app.commandLine.appendSwitch('wm-window-animations-disabled')

  app.commandLine.appendSwitch('--disable-gpu-sandbox')

  // proxy
  if (global.envParams.cmdParams['proxy-server']) {
    app.commandLine.appendSwitch('proxy-server', global.envParams.cmdParams['proxy-server'])
    app.commandLine.appendSwitch('proxy-bypass-list', global.envParams.cmdParams['proxy-bypass-list'] ?? '<local>')
  }
}

const legacyUserDataName = 'lx-music-desktop'
const legacyRootFiles = ['config.json', 'data.json', 'hotKey.json', 'lyrics_edited.json', 'playList.json', 'userApi.json']
const databaseFiles = new Set(['lx.data.db', 'lx.data.db-shm', 'lx.data.db-wal'])
let legacyUserDataPath: string | null = null
let prepareUserDataPromise: Promise<void> | null = null

const assertNotLinked = (targetPath: string) => {
  if (existsSync(targetPath) && lstatSync(targetPath).isSymbolicLink()) throw new Error(`Refuse to use linked data item: ${targetPath}`)
}

const assertNoLinkedItems = (targetPath: string) => {
  if (!existsSync(targetPath)) return
  const stat = lstatSync(targetPath)
  if (stat.isSymbolicLink()) throw new Error(`Refuse to use linked data item: ${targetPath}`)
  if (!stat.isDirectory()) return
  for (const name of readdirSync(targetPath)) assertNoLinkedItems(path.join(targetPath, name))
}

const normalizeRealPath = (targetPath: string) => {
  const realPath = path.normalize(realpathSync.native(targetPath))
  return process.platform == 'win32' ? realPath.toLowerCase() : realPath
}

const assertSeparatedPaths = (sourcePath: string, targetPath: string) => {
  const sourceRealPath = normalizeRealPath(sourcePath)
  const targetRealPath = normalizeRealPath(targetPath)
  if (sourceRealPath == targetRealPath || sourceRealPath.startsWith(`${targetRealPath}${path.sep}`) || targetRealPath.startsWith(`${sourceRealPath}${path.sep}`)) {
    throw new Error(`Source and target user data paths overlap: ${sourcePath} -> ${targetPath}`)
  }
}

const validateUserDataPath = (userDataPath: string, sourceUserDataPath?: string) => {
  assertNotLinked(userDataPath)
  assertNoLinkedItems(path.join(userDataPath, 'LxDatas'))
  for (const name of legacyRootFiles) assertNotLinked(path.join(userDataPath, name))
  if (!sourceUserDataPath || !existsSync(sourceUserDataPath)) return
  assertNotLinked(sourceUserDataPath)
  assertSeparatedPaths(sourceUserDataPath, userDataPath)
}

const copyRegularDirectory = (sourcePath: string, targetPath: string) => {
  const sourceStat = lstatSync(sourcePath)
  if (sourceStat.isSymbolicLink()) throw new Error(`Refuse to migrate linked directory: ${sourcePath}`)
  mkdirSync(targetPath, { recursive: true })
  for (const name of readdirSync(sourcePath)) {
    if (databaseFiles.has(name)) continue
    const sourceItemPath = path.join(sourcePath, name)
    const targetItemPath = path.join(targetPath, name)
    const stat = lstatSync(sourceItemPath)
    if (stat.isSymbolicLink()) throw new Error(`Refuse to migrate linked item: ${sourceItemPath}`)
    if (stat.isDirectory()) copyRegularDirectory(sourceItemPath, targetItemPath)
    else if (stat.isFile()) copyFileSync(sourceItemPath, targetItemPath)
  }
}

const backupDatabase = async(sourcePath: string, targetPath: string) => {
  const database = new Database(sourcePath, {
    readonly: true,
    fileMustExist: true,
    nativeBinding: path.join(__dirname, '../node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
  })
  try {
    await database.backup(targetPath)
  } finally {
    database.close()
  }
}

const migrateSharedUserData = async() => {
  const userDataPath = app.getPath('userData')
  assertNotLinked(userDataPath)
  for (const name of legacyRootFiles) assertNotLinked(path.join(userDataPath, name))
  if (existsSync(global.lxDataPath)) {
    assertNoLinkedItems(global.lxDataPath)
    return
  }
  const sourceUserDataPath = legacyUserDataPath
  if (!sourceUserDataPath || !existsSync(sourceUserDataPath)) return
  assertNotLinked(sourceUserDataPath)
  assertSeparatedPaths(sourceUserDataPath, userDataPath)

  const legacyDataPath = path.join(sourceUserDataPath, 'LxDatas')
  const hasLegacyFile = legacyRootFiles.some(name => existsSync(path.join(sourceUserDataPath, name)))
  if (!existsSync(legacyDataPath) && !hasLegacyFile) return

  const tempPath = `${global.lxDataPath}.migrating-${process.pid}`
  try {
    rmSync(tempPath, { recursive: true, force: true })
    mkdirSync(tempPath, { recursive: true })
    if (existsSync(legacyDataPath)) {
      copyRegularDirectory(legacyDataPath, tempPath)
      const legacyDatabasePath = path.join(legacyDataPath, 'lx.data.db')
      if (existsSync(legacyDatabasePath)) {
        if (lstatSync(legacyDatabasePath).isSymbolicLink()) throw new Error(`Refuse to migrate linked database: ${legacyDatabasePath}`)
        await backupDatabase(legacyDatabasePath, path.join(tempPath, 'lx.data.db'))
      }
    }
    for (const name of legacyRootFiles) {
      const sourcePath = path.join(sourceUserDataPath, name)
      const targetPath = path.join(app.getPath('userData'), name)
      if (!existsSync(sourcePath) || existsSync(targetPath)) continue
      if (lstatSync(sourcePath).isSymbolicLink()) throw new Error(`Refuse to migrate linked item: ${sourcePath}`)
      copyFileSync(sourcePath, targetPath)
    }
    renameSync(tempPath, global.lxDataPath)
    console.log(`migrated shared user data: ${sourceUserDataPath} -> ${app.getPath('userData')}`)
  } catch (error) {
    rmSync(tempPath, { recursive: true, force: true })
    throw error
  }
}

export const prepareUserData = async() => {
  await (prepareUserDataPromise ??= migrateSharedUserData().then(() => {
    if (!existsSync(global.lxDataPath)) mkdirSync(global.lxDataPath, { recursive: true })
  }))
}

export const setUserDataPath = () => {
  app.setName(APP_NAME)
  if (process.platform == 'win32') app.setAppUserModelId(APP_ID)
  let userDataPath: string

  // windows平台下如果应用目录下存在 portable 文件夹则将数据存在此文件下
  if (process.platform == 'win32') {
    const executableDir = process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(app.getPath('exe'))
    const portablePath = path.join(executableDir, 'portable')
    if (existsSync(portablePath)) {
      assertNotLinked(portablePath)
      app.setPath('appData', portablePath)
      userDataPath = path.join(portablePath, 'userData')
      mkdirSync(userDataPath, { recursive: true })
      validateUserDataPath(userDataPath)
      app.setPath('userData', userDataPath)
    } else {
      const appDataPath = app.getPath('appData')
      userDataPath = path.join(appDataPath, APP_NAME)
      legacyUserDataPath = path.join(appDataPath, legacyUserDataName)
      mkdirSync(userDataPath, { recursive: true })
      validateUserDataPath(userDataPath, legacyUserDataPath)
      app.setPath('userData', userDataPath)
    }
  } else {
    const appDataPath = app.getPath('appData')
    userDataPath = path.join(appDataPath, APP_NAME)
    legacyUserDataPath = path.join(appDataPath, legacyUserDataName)
    mkdirSync(userDataPath, { recursive: true })
    validateUserDataPath(userDataPath, legacyUserDataPath)
    app.setPath('userData', userDataPath)
  }

  log.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'logs', 'main.log')
  global.lxOldDataPath = userDataPath
  global.lxDataPath = path.join(userDataPath, 'LxDatas')
}

export const registerDeeplink = (startApp: () => void) => {
  if (process.platform === 'win32') {
    const protocolArgs = process.env.NODE_ENV !== 'production' && process.argv[1]
      ? [path.resolve(process.argv[1])]
      : []
    if (app.isDefaultProtocolClient(LEGACY_APP_PROTOCOL_SCHEME, process.execPath, protocolArgs)) {
      app.removeAsDefaultProtocolClient(LEGACY_APP_PROTOCOL_SCHEME, process.execPath, protocolArgs)
    }
    // Set the path of electron.exe and your app.
    // These two additional parameters are only available on windows.
    app.setAsDefaultProtocolClient(APP_PROTOCOL_SCHEME, process.execPath, protocolArgs)
  } else {
    app.setAsDefaultProtocolClient(APP_PROTOCOL_SCHEME)
  }

  // deep link
  app.on('open-url', (event, url) => {
    if (!URL_SCHEME_RXP.test(url)) return
    event.preventDefault()
    global.envParams.deeplink = url
    if (isExistMainWindow()) {
      if (global.envParams.deeplink) global.lx.event_app.deeplink(global.envParams.deeplink)
      else showMainWindow()
    } else {
      startApp()
    }
  })
}

export const listenerAppEvent = (startApp: () => void) => {
  app.on('web-contents-created', (event, contents) => {
    contents.on('will-navigate', (event, navigationUrl) => {
      if (process.env.NODE_ENV !== 'production') {
        console.log('navigation to url:', navigationUrl.length > 130 ? navigationUrl.substring(0, 130) + '...' : navigationUrl)
        return
      }
      if (!navigationUrlWhiteList.some(url => url.test(navigationUrl))) {
        event.preventDefault()
        return
      }
      console.log('navigation to url:', navigationUrl)
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (!/^devtools/.test(url) && /^https?:\/\//.test(url)) {
        void shell.openExternal(url)
      }
      console.log(url)
      return { action: 'deny' }
    })
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      // Strip away preload scripts if unused or verify their location is legitimate
      delete webPreferences.preload
      // delete webPreferences.preloadURL

      // Disable Node.js integration
      webPreferences.nodeIntegration = false

      // Verify URL being loaded
      if (!navigationUrlWhiteList.some(url => url.test(params.src))) {
        event.preventDefault()
      }
    })

    // disable create dictionary
    // https://github.com/lyswhut/lx-music-desktop/issues/773
    contents.session.setSpellCheckerDictionaryDownloadURL('http://0.0.0.0')
  })

  app.on('activate', () => {
    if (isExistMainWindow()) {
      showMainWindow()
    } else {
      startApp()
    }
  })

  app.on('before-quit', () => {
    global.lx.isSkipTrayQuit = true
  })
  let storesFlushed = false
  let flushingStores = false
  app.on('will-quit', event => {
    if (storesFlushed) return
    event.preventDefault()
    if (flushingStores) return
    flushingStores = true
    void flushStores().then(() => {
      storesFlushed = true
      app.quit()
    }).catch(error => {
      flushingStores = false
      log.error(error)
      if (global.lx.appSetting['common.showErrorDialog']) void dialog.showMessageBox({ type: 'error', message: '配置保存失败 / Configuration save failed', detail: '请检查磁盘空间和目录权限后重试退出。\nCheck disk space and permissions before quitting again.' })
    })
  })
  app.on('window-all-closed', () => {
    if (isMac) return

    app.quit()
  })

  const initScreenParams = () => {
    global.envParams.workAreaSize = screen.getPrimaryDisplay().workAreaSize
  }
  app.on('ready', () => {
    screen.on('display-metrics-changed', initScreenParams)
    initScreenParams()
  })

  nativeTheme.addListener('updated', () => {
    const shouldUseDarkColors = nativeTheme.shouldUseDarkColors
    if (shouldUseDarkColors == global.lx.theme.shouldUseDarkColors) return
    global.lx.theme.shouldUseDarkColors = shouldUseDarkColors
    global.lx?.event_app.system_theme_change(shouldUseDarkColors)
  })

  const setProxy = () => {
    const proxy = getProxy()
    if (proxy) {
      setProxyByHost(proxy.host, proxy.port ? String(proxy.port) : undefined)
    } else setProxyByHost()
  }
  global.lx.event_app.on('updated_config', (keys, setting) => {
    if (keys.includes('network.proxy.enable') || (global.lx.appSetting['network.proxy.enable'] && keys.some(k => k.includes('network.proxy.')))) {
      setProxy()
    }

    if (keys.includes('player.volume')) {
      global.lx.event_app.player_status({ volume: Math.trunc(setting['player.volume']! * 100) })
    }
    if (keys.includes('player.isMute')) {
      global.lx.event_app.player_status({ mute: setting['player.isMute'] })
    }
  })
  global.lx.event_app.on('app_inited', () => {
    setProxy()
    global.lx.event_app.player_status({ volume: Math.trunc(global.lx.appSetting['player.volume'] * 100) })
    global.lx.event_app.player_status({ mute: global.lx.appSetting['player.isMute'] })
  })
}

const initTheme = () => {
  global.lx.theme = getTheme()
  const themeConfigKeys = ['theme.id', 'theme.lightId', 'theme.darkId']
  global.lx.event_app.on('updated_config', (keys) => {
    let requireUpdate = false
    for (const key of keys) {
      if (themeConfigKeys.includes(key)) {
        requireUpdate = true
        break
      }
    }
    if (requireUpdate) {
      global.lx.theme = getTheme()
      global.lx.event_app.theme_change()
    }
  })
  global.lx.event_app.on('system_theme_change', () => {
    if (global.lx.appSetting['theme.id'] == 'auto') {
      global.lx.theme = getTheme()
      global.lx.event_app.theme_change()
    }
  })
}

let isInitialized = false
export const initAppSetting = async() => {
  if (!global.lx.inited) {
    const config = await initHotKey()
    global.lx.hotKey.config.local = config.local
    global.lx.hotKey.config.global = config.global
    global.lx.inited = true
  }

  if (!isInitialized) {
    const dbFileExists = await global.lx.worker.dbService.init(global.lxDataPath)
    global.lx.appSetting = (await initSetting()).setting
    if (!dbFileExists) await migrateDBData().catch(err => { log.error(err) })
    initTheme()
    if (envParams.cmdParams.dt == null) envParams.cmdParams.dt = !global.lx.appSetting['common.transparentWindow']
  }
  // global.lx.theme = getTheme()

  isInitialized ||= true
}

export const quitApp = () => {
  global.lx.isSkipTrayQuit = true
  app.quit()
}
