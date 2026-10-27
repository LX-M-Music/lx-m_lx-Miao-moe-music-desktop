import { screen, type BrowserWindow } from 'electron'
import { MINI_PLAYER_EDGE_STRIP, MINI_PLAYER_EDGE_ANIMATION_MS, type MiniPlayerEdge, type MiniPlayerEdgeMotion } from '@common/miniPlayer'
import { isWin, isLinux } from '@common/utils'

const EDGE_DISTANCE = 8
const HIDE_DELAY = 600
const SETTLE_DELAY = 800

export const getDockedEdge = (bounds: Electron.Rectangle, area: Electron.Rectangle): MiniPlayerEdge => {
  // Corners belong to a side, even when the top is equally close.
  if (Math.abs(bounds.x - area.x) <= EDGE_DISTANCE) return 'left'
  if (Math.abs(bounds.x + bounds.width - area.x - area.width) <= EDGE_DISTANCE) return 'right'
  if (Math.abs(bounds.y - area.y) <= EDGE_DISTANCE) return 'top'
  return null
}

const contains = (bounds: Electron.Rectangle, point: Electron.Point) => point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height
const fitBounds = (bounds: Electron.Rectangle, area: Electron.Rectangle): Electron.Rectangle => ({
  width: bounds.width,
  height: bounds.height,
  x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)),
  y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height)),
})

interface Options {
  getSize: () => Pick<Electron.Rectangle, 'width' | 'height'>
  onChange: (edge: MiniPlayerEdge) => void
  onMotion: (motion: MiniPlayerEdgeMotion) => void
  isResizing: () => boolean
}

export const createEdgeHideControls = (window: BrowserWindow, { getSize, onChange, onMotion, isResizing }: Options) => {
  let timer: NodeJS.Timeout | null = null
  let motionTimer: NodeJS.Timeout | null = null
  let hidden: { edge: Exclude<MiniPlayerEdge, null>, phase: 'hiding' | 'hidden' | 'showing', bounds: Electron.Rectangle, strip: Electron.Rectangle, minimum: number[] } | null = null
  const useShape = isWin || isLinux
  let applying = false
  let interacting = false
  let leaveSince: number | null = null
  let leaveEdge: MiniPlayerEdge = null
  let ownedBounds: Electron.Rectangle | null = null
  let settleUntil = 0

  const atOwnedBounds = () => {
    const expected = ownedBounds
    if (!expected) return false
    const actual = window.getBounds()
    return (['x', 'y', 'width', 'height'] as const).every(key => Math.abs(actual[key] - expected[key]) <= 2)
  }
  const ownsBounds = () => hidden !== null || applying || (Date.now() < settleUntil && atOwnedBounds())
  const getExpandedBounds = () => hidden ? { ...hidden.bounds } : ownedBounds && atOwnedBounds() ? { ...ownedBounds } : null
  const applyBounds = (bounds: Electron.Rectangle, minimum: number[], shape: Electron.Rectangle[] = []) => {
    applying = true
    ownedBounds = bounds
    settleUntil = Date.now() + SETTLE_DELAY
    try {
      if (useShape) {
        // Windows enforces a larger system minimum even with minWidth=1.
        // A native region limits both drawing and hit testing to the strip.
        window.setShape(shape)
        window.setBounds(bounds)
      } else {
        window.setMinimumSize(1, 1)
        window.setBounds(bounds)
        window.setMinimumSize(minimum[0], minimum[1])
      }
    } finally {
      applying = false
    }
  }
  const clearMotionTimer = () => {
    if (motionTimer) clearTimeout(motionTimer)
    motionTimer = null
  }
  const finishMotion = () => {
    clearMotionTimer()
    if (!hidden || window.isDestroyed()) return
    const { edge, bounds, strip, minimum, phase } = hidden
    if (phase === 'showing') {
      hidden = null
      onChange(null)
    } else {
      hidden.phase = 'hidden'
      applyBounds(useShape ? bounds : strip, useShape ? minimum : [1, 1], [{ ...strip, x: strip.x - bounds.x, y: strip.y - bounds.y }])
      onChange(edge)
    }
  }
  const startMotion = (show: boolean, animate: boolean) => {
    if (!hidden) return
    clearMotionTimer()
    hidden.phase = show ? 'showing' : 'hiding'
    const setting = global.lx.appSetting
    const duration = animate && setting['common.isShowAnimation'] && setting['ui.smoothAnimation'] && !setting['ui.lowPowerMode'] ? MINI_PLAYER_EDGE_ANIMATION_MS : 0
    // Keep the native rectangle fixed while its content slides. Repeated
    // native position changes can accumulate fractional-DPI rounding.
    applyBounds(hidden.bounds, hidden.minimum)
    onMotion({ edge: hidden.edge, phase: hidden.phase, duration })
    if (duration) motionTimer = setTimeout(finishMotion, duration)
    else finishMotion()
  }
  const restore = (animate = false) => {
    leaveSince = null
    leaveEdge = null
    if (!hidden || window.isDestroyed()) return
    if (animate && hidden.phase === 'showing') return
    const area = screen.getDisplayMatching(hidden.bounds).workArea
    hidden.bounds = fitBounds({ ...hidden.bounds, ...getSize() }, area)
    startMotion(true, animate)
  }
  const checkPointer = () => {
    if (window.isDestroyed()) { stop(); return }
    if (interacting || isResizing()) { leaveSince = null; return }
    const point = screen.getCursorScreenPoint()
    if (hidden) {
      if (hidden.phase === 'hidden') {
        if (contains(hidden.strip, point)) restore(true)
      } else if (contains(hidden.bounds, point)) {
        if (hidden.phase === 'hiding') restore(true)
      } else if (hidden.phase === 'showing') startMotion(false, true)
      return
    }
    const bounds = { ...(getExpandedBounds() ?? window.getBounds()), ...getSize() }
    const area = screen.getDisplayMatching(bounds).workArea
    const edge = getDockedEdge(bounds, area)
    if (!edge || contains(bounds, point)) { leaveSince = null; leaveEdge = null; return }
    if (leaveSince == null || leaveEdge !== edge) { leaveSince = Date.now(); leaveEdge = edge; return }
    if (Date.now() - leaveSince < HIDE_DELAY) return
    const expanded = fitBounds(bounds, area)
    if (edge === 'left') expanded.x = area.x
    else if (edge === 'right') expanded.x = area.x + area.width - expanded.width
    else expanded.y = area.y
    const strip = { ...expanded }
    if (edge === 'top') strip.height = MINI_PLAYER_EDGE_STRIP
    else {
      strip.width = MINI_PLAYER_EDGE_STRIP
      if (edge === 'right') strip.x = area.x + area.width - MINI_PLAYER_EDGE_STRIP
    }
    hidden = { edge, phase: 'hiding', bounds: expanded, strip, minimum: window.getMinimumSize() }
    startMotion(false, true)
  }
  const beginInteraction = () => {
    if (hidden?.phase === 'hidden') return false
    if (hidden) restore()
    interacting = true
    ownedBounds = null
    leaveSince = null
    return true
  }
  const endInteraction = () => { interacting = false; leaveSince = null }
  const reset = () => { restore(); endInteraction(); ownedBounds = null }
  const start = () => {
    if (timer !== null || window.isDestroyed()) return
    checkPointer()
    timer = setInterval(checkPointer, 100)
  }
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
    clearMotionTimer()
    screen.removeListener('display-metrics-changed', recover)
    screen.removeListener('display-removed', recover)
  }
  const recover = () => { restore() }
  window.on('focus', recover)
  window.once('closed', stop)
  screen.on('display-metrics-changed', recover)
  screen.on('display-removed', recover)
  return { start, reset, restore, ownsBounds, beginInteraction, endInteraction, getExpandedBounds, isHidden: () => hidden !== null }
}
