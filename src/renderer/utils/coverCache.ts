import { artworkCacheGeneration, onArtworkCacheCleared, readArtworkCache, writeArtworkCache } from './artworkStorage'
import { getCoverThumbnail } from './coverThumbnail'
import { awaitRequest, getRequestSignal, shareRequest, throwIfRequestCancelled, withRequestDeadline, withRequestScope } from './requestContext'
import { createRequestLimiter } from './musicSdk/requestCache'
import { readArtworkResponse, validateArtwork } from '@common/utils/imageLimits'

interface CachedImage { src: string, bytes: number, users: number, retired: boolean }
const images = new Map<string, CachedImage>()
const retiredImages = new Set<CachedImage>()
let memoryGeneration = 0
const pending = new Map()
const scheduleDownload = createRequestLimiter(6)
let maxMemoryBytes = 32 * 1024 * 1024
let maxMemoryEntries = 256

const trimMemory = () => {
  let bytes = [...images.values()].reduce((total, image) => total + image.bytes, 0)
  for (const [key, image] of images) {
    if (images.size <= maxMemoryEntries && bytes <= maxMemoryBytes) break
    if (image.users || pending.has(key)) continue
    images.delete(key)
    bytes -= image.bytes
    URL.revokeObjectURL(image.src)
  }
}

export const clearCoverMemory = () => {
  memoryGeneration++
  for (const image of images.values()) {
    image.retired = true
    if (!image.users) URL.revokeObjectURL(image.src)
    else retiredImages.add(image)
  }
  images.clear()
  pending.clear()
}

export const setCoverMemoryLimits = (bytes: number, entries: number) => {
  maxMemoryBytes = Math.max(0, Math.floor(bytes))
  maxMemoryEntries = Math.max(0, Math.floor(entries))
  trimMemory()
}
onArtworkCacheCleared(clearCoverMemory)

const download = async(url: string): Promise<Blob> => {
  return scheduleDownload(async() => withRequestDeadline(12000, async() => {
    const response = await fetch(url, { signal: getRequestSignal(), credentials: 'include' })
    if (!response.ok) throw new Error(`Artwork HTTP ${response.status}`)
    return await readArtworkResponse(response)
  }))
}

const load = async(url: string, fallbackUrl?: string): Promise<CachedImage> => {
  const memoryVersion = memoryGeneration
  const generation = artworkCacheGeneration()
  const key = `image:${url}`
  let cached = await readArtworkCache<Blob>(key)
  throwIfRequestCancelled()
  const candidates = [...new Set([url, fallbackUrl].filter(Boolean))] as string[]
  for (let index = 0; index < candidates.length; index++) {
    let src = ''
    try {
      const blob = cached ?? await download(candidates[index])
      const dimensions = validateArtwork(new Uint8Array(await blob.arrayBuffer()))
      throwIfRequestCancelled()
      src = URL.createObjectURL(blob)
      // Decode before persisting: a 200 response can still contain an error page.
      const decoded = new Image()
      decoded.src = src
      await awaitRequest(decoded.decode())
      throwIfRequestCancelled()
      // A working original also satisfies this thumbnail key, avoiding another
      // failed thumbnail request every time the playlist is opened.
      if (!cached) await writeArtworkCache(key, blob, generation)
      const image = { src, bytes: blob.size + dimensions.decodedBytes, users: 0, retired: generation !== artworkCacheGeneration() || memoryVersion !== memoryGeneration }
      if (!image.retired) images.set(url, image)
      return image
    } catch (error) {
      if (src) URL.revokeObjectURL(src)
      throwIfRequestCancelled()
      if (cached) {
        cached = undefined
        index-- // A damaged disk entry should be replaced by a fresh download.
        continue
      }
      if (index === candidates.length - 1) throw error
    }
  }
  throw new Error('No artwork URL')
}

const getImage = async(url: string, fallbackUrl?: string) => {
  const image = images.get(url)
  if (image) return image
  return shareRequest(pending, url, async() => load(url, fallbackUrl))
}

// Each mounted image leases its URL. Eviction never revokes an image still on screen.
const leaseImage = (url: string, image: CachedImage) => {
  image.users++
  if (image.retired) retiredImages.add(image)
  if (!image.retired) {
    images.delete(url)
    images.set(url, image)
  }
  trimMemory()
  let released = false
  return {
    src: image.src,
    release: () => {
      if (released) return
      released = true
      image.users--
      if (image.retired && !image.users) { URL.revokeObjectURL(image.src); retiredImages.delete(image) }
      trimMemory()
    },
  }
}

export const acquireCover = async(url: string, fallbackUrl?: string, signal: AbortSignal | undefined = getRequestSignal()) => {
  throwIfRequestCancelled(signal)
  if (!/^https?:\/\//i.test(url)) return { src: url, release: () => {} }
  const image = await withRequestScope(signal, async() => getImage(url, fallbackUrl))
  throwIfRequestCancelled(signal)
  return leaseImage(url, image)
}

// Song rows and every player surface use the same detail-sized artwork. Display
// dimensions must not produce separate downloads or enlarge a tiny list thumbnail.
const musicCoverUrl = (url: string) => getCoverThumbnail(url, 640)
export const getCoverMemorySize = () => [...images.values(), ...retiredImages].reduce((bytes, image) => bytes + image.bytes, 0)
export const acquireMusicCover = async(url: string, signal?: AbortSignal) => acquireCover(musicCoverUrl(url), url, signal)
export const acquireCachedMusicCover = (url: string) => {
  if (!/^https?:\/\//i.test(url)) return { src: url, release: () => {} }
  const key = musicCoverUrl(url)
  const image = images.get(key)
  return image ? leaseImage(key, image) : undefined
}
