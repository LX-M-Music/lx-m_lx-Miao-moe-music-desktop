import { type Artwork } from './artwork'

const blendArtwork = (from: Artwork, to: Artwork, amount: number): Artwork => {
  if (amount <= 0 || from === to) return from
  if (amount >= 1) return to
  const image = document.createElement('canvas')
  image.width = image.height = 256
  const context = image.getContext('2d')!
  context.drawImage(from.image, 0, 0, 256, 256)
  context.globalAlpha = amount
  context.drawImage(to.image, 0, 0, 256, 256)
  return { image, preview: image.toDataURL('image/png') }
}

// Snapshot the current blend only when a new cover interrupts it. Both renderers
// can then continue from the visible colors without jumping to the previous target.
export const createArtworkTransition = () => {
  let from: Artwork | null = null
  let to: Artwork | null = null
  let fromOpacity = 0
  let toOpacity = 0
  let started = 0
  let duration = 0
  const frame = (now = performance.now()) => {
    const progress = duration ? Math.max(0, Math.min(1, (now - started) / duration)) : 1
    const mix = 0.5 - 0.5 * Math.cos(progress * Math.PI)
    return { from, to, mix, opacity: fromOpacity + (toOpacity - fromOpacity) * mix, remaining: Math.max(0, started + duration - now), done: progress === 1 }
  }
  const snapshot = (now: number) => {
    const current = frame(now)
    const artwork = current.opacity > 0
      ? current.from && current.to ? blendArtwork(current.from, current.to, current.mix) : current.to ?? current.from
      : null
    return { artwork, opacity: current.opacity }
  }
  const start = (next: Artwork | null, milliseconds: number, now = performance.now()) => {
    const current = snapshot(now)
    from = current.artwork
    fromOpacity = current.opacity
    to = next
    toOpacity = next ? 1 : 0
    started = now
    duration = Math.max(0, milliseconds)
    return frame(now)
  }
  const finish = () => {
    from = to
    fromOpacity = toOpacity
    duration = 0
  }
  const resume = () => {
    const now = performance.now()
    const current = snapshot(now)
    from = current.artwork
    fromOpacity = current.opacity
    duration = Math.max(0, started + duration - now)
    started = now
    return frame(now)
  }
  const hold = () => {
    const current = snapshot(performance.now())
    from = to = current.artwork
    fromOpacity = toOpacity = current.opacity
    duration = 0
  }
  return { start, frame, finish, resume, hold }
}
