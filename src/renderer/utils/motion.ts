export const MOTION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
export const MOTION_DURATION = {
  press: 100,
  fast: 180,
  normal: 250,
  slow: 400,
  page: 240,
  panel: 180,
  popup: 250,
  cover: 700,
  detail: 600,
  image: 500,
} as const
export type MotionKind = keyof typeof MOTION_DURATION

const animations = new Set<Animation>()
const finishTasks = new Set<() => void>()

export const isMotionEnabled = () => {
  const root = document.documentElement
  if (root.classList.contains('disableAnimation')) return false
  return root.dataset.motionEnabled !== 'false'
}

export const getMotionDuration = (kind: MotionKind) => {
  if (!isMotionEnabled()) return 0
  const value = Number(document.documentElement.dataset.motionSpeed ?? 1)
  const speed = Number.isFinite(value) ? Math.max(0.5, Math.min(1.5, value)) : 1
  return MOTION_DURATION[kind] / speed
}

export const playMotion = (element: HTMLElement, frames: Keyframe[], kind: MotionKind, delay = 0) => {
  const duration = getMotionDuration(kind)
  if (!duration || !element.animate) return null
  const animation = element.animate(frames, {
    duration,
    delay: delay * duration / MOTION_DURATION[kind],
    easing: MOTION_EASING,
    fill: 'both',
  })
  animations.add(animation)
  void animation.finished.then(() => animations.delete(animation), () => animations.delete(animation))
  return animation
}

export const finishMotions = () => {
  for (const animation of animations) {
    try { animation.finish() } catch { animation.cancel() }
  }
  animations.clear()
  for (const finish of finishTasks) finish()
  finishTasks.clear()
}

/** Scroll on the same browser timing curve as the lyric scale transition. */
export const scrollWithMotion = (element: HTMLElement, target: number, kind: MotionKind = 'slow') => {
  const to = Math.max(0, Math.min(target, element.scrollHeight - element.clientHeight))
  const from = element.scrollTop
  const animation = playMotion(element, [], kind)
  if (!animation) {
    element.scrollTop = to
    return () => {}
  }
  let frame = 0
  const cancel = () => {
    cancelAnimationFrame(frame)
    finishTasks.delete(finish)
    animation.cancel()
  }
  const finish = () => {
    element.scrollTop = to
    cancel()
  }
  finishTasks.add(finish)
  const step = () => {
    if (!element.isConnected) { cancel(); return }
    if (animation.playState === 'finished') { finish(); return }
    const progress = animation.effect?.getComputedTiming().progress
    if (progress != null) element.scrollTop = from + (to - from) * progress
    frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
  return cancel
}

/** Damped lyric scrolling, cancellable as soon as the user takes control. */
export const scrollWithSpring = (element: HTMLElement, target: number) => {
  const to = Math.max(0, Math.min(target, element.scrollHeight - element.clientHeight))
  let frame = 0
  let position = element.scrollTop
  let velocity = 0
  let previous = performance.now()
  const started = previous
  const speed = MOTION_DURATION.panel / (getMotionDuration('panel') || MOTION_DURATION.panel)
  const cancel = () => { cancelAnimationFrame(frame); finishTasks.delete(finish) }
  const finish = () => { element.scrollTop = to; cancel() }
  if (!isMotionEnabled()) { finish(); return cancel }
  finishTasks.add(finish)
  const step = (time: number) => {
    if (!element.isConnected) { cancel(); return }
    const dt = Math.min((time - previous) / 1000, 0.032)
    previous = time
    velocity += ((to - position) * 230 * speed * speed - velocity * 27 * speed) * dt
    position += velocity * dt
    element.scrollTop = position
    if ((Math.abs(to - position) < 0.3 && Math.abs(velocity) < 2) || time - started > 2000 / speed) finish()
    else frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
  return cancel
}
