// A stopped WebGL canvas can still require texture transfers on every compositor
// frame. Publish a decoded, lossless image once the background has settled.
// Keep the live canvas until decoding succeeds, and discard outdated captures.
export const createStillFrame = (publish: (url: string) => void) => {
  let revision = 0
  let current = ''
  let disposed = false
  const clear = () => {
    ++revision
    if (!current) return
    const previous = current
    current = ''
    publish('')
    URL.revokeObjectURL(previous)
  }
  const capture = async(canvas: HTMLCanvasElement) => {
    if (disposed) return
    const token = ++revision
    let pending = ''
    try {
      // PNG encoding runs asynchronously; no base64 encoding on the UI thread.
      const blob = await new Promise<Blob | null>(resolve => { canvas.toBlob(resolve, 'image/png') })
      if (!blob || disposed || token !== revision) return
      pending = URL.createObjectURL(blob)
      const image = new Image()
      image.src = pending
      await image.decode()
      if (disposed || token !== revision) return
      const previous = current
      current = pending
      pending = ''
      publish(current)
      if (previous) URL.revokeObjectURL(previous)
    } catch {
      // A lost context or failed decode leaves the live/fallback surface usable.
    } finally {
      if (pending) URL.revokeObjectURL(pending)
    }
  }
  return {
    capture,
    clear,
    dispose() { disposed = true; clear() },
  }
}
