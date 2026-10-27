import { screen } from 'electron'

// 设置窗口位置、大小
export const getMinimumSize = () => ({ minWidth: 280, minHeight: 180 })


// const updateBounds = (bounds: Bounds) => {
//   bounds.x = bounds.x
//   return bounds
// }

/**
 *
 * @param bounds 当前设置
 * @param param 新设置（相对于当前设置）
 * @returns
 */
export const getWindowBounds = (bounds: Electron.Rectangle, { x, y, w, h }: LX.MiniPlayer.NewBounds): Electron.Rectangle => {
  const { minWidth, minHeight } = getMinimumSize()
  if (w < minWidth) w = minWidth
  if (h < minHeight) h = minHeight
  x += bounds.x
  y += bounds.y

  if (global.lx.appSetting['miniPlayer.isLockScreen']) {
    const area = screen.getDisplayMatching({ x, y, width: w, height: h }).workArea
    const maxWinW = area.width
    const maxWinH = area.height

    if (w > maxWinW) w = maxWinW
    if (h > maxWinH) h = maxWinH

    const maxX = area.x + area.width - w
    const maxY = area.y + area.height - h

    if (x > maxX) x = maxX
    else if (x < area.x) x = area.x

    if (y > maxY) y = maxY
    else if (y < area.y) y = area.y
  }

  // console.log('util bounds', bounds)
  return { width: w, height: h, x, y }
}


export const watchConfigKeys = [
  'miniPlayer.enable',
  'miniPlayer.showBorder',
  'miniPlayer.backgroundOpacity',
  'miniPlayer.fullscreenHide',
  'miniPlayer.autoHideControls',
  'miniPlayer.isLock',
  'miniPlayer.isAlwaysOnTop',
  'miniPlayer.isAlwaysOnTopLoop',
  'miniPlayer.isShowTaskbar',
  'miniPlayer.width',
  'miniPlayer.height',
  'miniPlayer.x',
  'miniPlayer.y',
  'miniPlayer.isLockScreen',
  'common.langId',
  'ui.lowPowerMode',
] satisfies Array<keyof LX.AppSetting>

export const buildMiniPlayerConfig = (appSetting: Partial<LX.AppSetting>): Partial<LX.MiniPlayer.Config> => {
  const setting: Partial<LX.MiniPlayer.Config> = {}
  for (const key of watchConfigKeys) {
    // @ts-expect-error
    if (key in appSetting) setting[key] = appSetting[key]
  }
  return setting
}

export const initWindowSize = (x: LX.AppSetting['miniPlayer.x'], y: LX.AppSetting['miniPlayer.y'], width: LX.AppSetting['miniPlayer.width'], height: LX.AppSetting['miniPlayer.height']) => {
  const { minWidth, minHeight } = getMinimumSize()
  if (x == null || y == null) {
    if (width < minWidth) width = minWidth
    if (height < minHeight) height = minHeight
    const area = screen.getPrimaryDisplay().workArea
    width = Math.min(width, area.width)
    height = Math.min(height, area.height)
    x = area.x + area.width - width
    y = area.y + area.height - height
  } else {
    let bounds = getWindowBounds({ x, y, width, height }, { x: 0, y: 0, w: width, h: height })
    x = bounds.x
    y = bounds.y
    width = bounds.width
    height = bounds.height
  }
  return {
    x,
    y,
    width,
    height,
  }
}
