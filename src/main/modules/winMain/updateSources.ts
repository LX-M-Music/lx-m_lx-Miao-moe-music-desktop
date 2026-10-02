import type { Dispatcher } from 'undici'
import { requestWithCompatibility } from '@common/utils/undiciCompat'
import { UPDATE_MIRROR_PREFIXES } from '@common/updateMirrors'

const PROBE_BYTES = 64 * 1024
const PROBE_TIMEOUT = 4000
const TEST_DEADLINE = 20000
const TEST_CONCURRENCY = 8

export interface UpdateSource {
  url: string
  name: string
  bytesPerSecond?: number
}

export const getUpdateSources = (url: string): UpdateSource[] => {
  const parsed = new URL(url)
  const direct = { url, name: parsed.hostname === 'github.com' ? 'GitHub' : parsed.hostname }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || !/^\/[^/]+\/[^/]+\/releases\/download\//.test(parsed.pathname)) return [direct]
  return [direct, ...UPDATE_MIRROR_PREFIXES.map(prefix => ({ url: prefix + url, name: new URL(prefix).hostname }))]
}

interface SpeedTestOptions {
  dispatcher: Dispatcher
  signal: AbortSignal
  fileName: string
  size: number
  onProgress: (tested: number, total: number) => void
  concurrency?: number
  timeoutMs?: number
  deadlineMs?: number
}

const probeSource = async(source: UpdateSource, options: SpeedTestOptions, signal: AbortSignal): Promise<UpdateSource> => {
  const controller = new AbortController()
  const abort = () => { controller.abort(signal.reason) }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const timeout = setTimeout(() => { controller.abort() }, options.timeoutMs ?? PROBE_TIMEOUT)
  let body: Awaited<ReturnType<typeof requestWithCompatibility>>['body'] | undefined
  const started = Date.now()
  try {
    controller.signal.throwIfAborted()
    const response = await requestWithCompatibility(source.url, {
      method: 'GET',
      dispatcher: options.dispatcher,
      signal: controller.signal,
      headersTimeout: options.timeoutMs ?? PROBE_TIMEOUT,
      bodyTimeout: options.timeoutMs ?? PROBE_TIMEOUT,
      headers: { 'User-Agent': 'lx-m-music-desktop', Range: `bytes=0-${PROBE_BYTES - 1}`, 'Accept-Encoding': 'identity' },
    })
    body = response.body
    if (response.statusCode !== 200 && response.statusCode !== 206) throw new Error(`HTTP ${response.statusCode}`)
    const type = String(response.headers['content-type'] ?? '')
    if (/text\/html|application\/(?:json|xhtml\+xml)/i.test(type)) throw new Error('镜像返回了网页')
    if (response.statusCode === 206) {
      const range = /^bytes 0-\d+\/(\d+)$/.exec(String(response.headers['content-range'] ?? ''))
      if (!range || (options.size > 0 && Number(range[1]) !== options.size)) throw new Error('镜像返回了错误的文件范围')
    }
    const chunks: Buffer[] = []
    let received = 0
    for await (const raw of body) {
      const chunk = Buffer.from(raw).subarray(0, PROBE_BYTES - received)
      chunks.push(chunk)
      received += chunk.length
      if (received >= PROBE_BYTES) break
    }
    controller.signal.throwIfAborted()
    if (received < Math.min(PROBE_BYTES, options.size > 0 ? options.size : 8192)) throw new Error('镜像未返回足够的安装包数据')
    const sample = Buffer.concat(chunks, received)
    if (/\.exe$/i.test(options.fileName) && sample.subarray(0, 2).toString() !== 'MZ') throw new Error('镜像未返回安装包')
    const bytesPerSecond = received * 1000 / Math.max(1, Date.now() - started)
    return { ...source, bytesPerSecond }
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
    body?.destroy()
    controller.abort()
  }
}

// Probe the actual release asset, not a homepage or an unrelated small file.
// Bound the waiting time even when most catalog nodes are unreachable.
export const speedTestUpdateSources = async(sources: UpdateSource[], options: SpeedTestOptions): Promise<UpdateSource[]> => {
  const controller = new AbortController()
  const abort = () => { controller.abort(options.signal.reason) }
  options.signal.addEventListener('abort', abort, { once: true })
  if (options.signal.aborted) abort()
  const deadline = setTimeout(() => { controller.abort() }, options.deadlineMs ?? TEST_DEADLINE)
  const ranked: UpdateSource[] = []
  let next = 0
  let tested = 0
  try {
    options.onProgress(0, sources.length)
    await Promise.all(Array.from({ length: Math.min(sources.length, Math.max(1, options.concurrency ?? TEST_CONCURRENCY)) }, async() => {
      while (next < sources.length && !controller.signal.aborted) {
        const source = sources[next++]
        try {
          ranked.push(await probeSource(source, options, controller.signal))
        } catch {
          // Unavailable nodes are skipped; cancellation is checked below.
        } finally {
          options.onProgress(++tested, sources.length)
        }
      }
    }))
    options.signal.throwIfAborted()
    ranked.sort((a, b) => (b.bytesPerSecond ?? 0) - (a.bytesPerSecond ?? 0))
    const selected = ranked.slice(0, 6)
    const direct = sources[0]
    if (direct && !selected.some(source => source.url === direct.url)) selected.push(direct)
    return selected
  } finally {
    clearTimeout(deadline)
    options.signal.removeEventListener('abort', abort)
  }
}
