import type { createKawarpRenderer } from './renderer'

export const lowPowerSurfaceSize = (width: number, height: number) => {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const scale = Math.min(0.5, 384 / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

// Blur once on a small 2D surface; avoid a GPU context and full-window CSS blur.
export const createLowPowerBackgroundRenderer = (canvas: HTMLCanvasElement): ReturnType<typeof createKawarpRenderer> => {
  const context = canvas.getContext('2d')
  if (!context) return null
  let image: HTMLCanvasElement | undefined
  let shade: readonly number[] = [0, 0, 0, 0]
  let dirty = true
  let disposed = false
  return {
    setSource(value) { image = value; dirty = true },
    finishTransition() {},
    setShade(value) {
      if (value.every((component, index) => component === shade[index])) return
      shade = value.slice()
      dirty = true
    },
    draw(width, height) {
      if (disposed || !image) return
      if (!dirty && canvas.width === width && canvas.height === height) return
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      context.clearRect(0, 0, width, height)
      const scale = Math.max(width / image.width, height / image.height) * 1.18
      const w = image.width * scale
      const h = image.height * scale
      context.filter = `blur(${Math.max(2, Math.min(width, height) * 0.08)}px)`
      context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h)
      context.filter = 'none'
      const gradient = context.createLinearGradient(0, 0, width, 0)
      gradient.addColorStop(0.12, 'rgba(0, 0, 0, 0)')
      gradient.addColorStop(1, `rgba(${shade[0]}, ${shade[1]}, ${shade[2]}, ${shade[3] * 0.085})`)
      context.fillStyle = gradient
      context.fillRect(0, 0, width, height)
      dirty = false
    },
    dispose() {
      disposed = true
      image = undefined
      canvas.width = canvas.height = 0
    },
  }
}
