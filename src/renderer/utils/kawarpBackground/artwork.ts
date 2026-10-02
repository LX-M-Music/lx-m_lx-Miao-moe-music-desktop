import { acquireMusicCover } from '@renderer/utils/coverCache'
import { onArtworkCacheCleared } from '@renderer/utils/artworkStorage'

export interface Artwork {
  image: HTMLCanvasElement
  preview: string
}

// Keep a small, origin-clean image for both Kawarp and the static fallback.
// Loading happens outside Kawarp so a cancelled request cannot update a disposed renderer.
const cache = new Map<string, Artwork>()
let memoryLimit = 6
const trimMemory = () => {
  while (cache.size > memoryLimit) cache.delete(cache.keys().next().value!)
}
export const setArtworkMemoryLimit = (entries: number) => {
  memoryLimit = Math.max(1, Math.floor(entries))
  trimMemory()
}
onArtworkCacheCleared(() => { cache.clear() })
export const loadArtwork = async(src: string, signal: AbortSignal): Promise<Artwork | null> => {
  if (signal.aborted) throw new Error('Artwork request cancelled')
  if (!src) return null
  const cached = cache.get(src)
  if (cached) {
    cache.delete(src)
    cache.set(src, cached)
    return cached
  }
  // Share the player's download, but keep the old background while it is pending.
  const cover = await acquireMusicCover(src)
  if (signal.aborted) { cover.release(); throw new Error('Artwork request cancelled') }
  return new Promise<Artwork>((resolve, reject) => {
    const image = new Image()
    let finished = false
    const cleanup = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', fail)
      image.onload = image.onerror = null
      image.src = ''
    }
    const fail = () => {
      if (finished) return
      finished = true
      cleanup()
      reject(new Error('Artwork unavailable'))
    }
    const timeout = setTimeout(fail, 5000)
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onerror = fail
    image.onload = () => {
      if (finished) return
      try {
        if (!image.naturalWidth || !image.naturalHeight) { fail(); return }
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 256
        const context = canvas.getContext('2d')
        if (!context) { fail(); return }
        context.fillStyle = '#384153'
        context.fillRect(0, 0, 256, 256)
        const side = Math.min(image.naturalWidth, image.naturalHeight)
        context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256)
        const artwork = { image: canvas, preview: canvas.toDataURL('image/png') }
        cache.set(src, artwork)
        trimMemory()
        finished = true
        cleanup()
        resolve(artwork)
      } catch { fail() }
    }
    signal.addEventListener('abort', fail, { once: true })
    image.src = cover.src
  }).finally(cover.release)
}
