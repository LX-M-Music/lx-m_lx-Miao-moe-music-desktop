import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import { isIP } from 'node:net'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { publicAddress, sourceError } from '../sourcePlugins/network'

export const musicFreeUrl = (raw: unknown): URL => {
  if (typeof raw !== 'string' || raw.length > 8192) throw sourceError('MUSICFREE_URL_INVALID', 'MusicFree 地址无效')
  const url = new URL(raw)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && !publicAddress(host))) throw sourceError('MUSICFREE_URL_DENIED', 'MusicFree 仅允许访问公共 HTTP(S) 地址')
  return url
}

export const musicFreeHeaders = (input: any = {}, expectedHost?: string): Record<string, string> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw sourceError('MUSICFREE_HEADERS_INVALID', 'MusicFree 请求头格式无效')
  const headers: Record<string, string> = {}
  if (Object.keys(input).length > 100) throw sourceError('MUSICFREE_HEADERS_INVALID', 'MusicFree 请求头过多')
  for (const [key, value] of Object.entries(input)) {
    if (value == null || value === false) continue
    if (!/^[a-z\d!#$%&'*+.^_`|~-]{1,64}$/i.test(key) || !['string', 'number', 'boolean'].includes(typeof value) || String(value).length > 16384 || /[\r\n\0]/.test(String(value))) throw sourceError('MUSICFREE_HEADERS_INVALID', 'MusicFree 请求头无效')
    // Accept browser-style plugin headers, while Node owns HTTP framing and
    // Host always follows the address whose DNS answer we actually checked.
    if (/^(connection|content-length|proxy-.*|transfer-encoding)$/i.test(key)) continue
    if (key.toLowerCase() === 'host') {
      if (!expectedHost || String(value).toLowerCase() !== expectedHost.toLowerCase()) throw sourceError('MUSICFREE_HEADERS_INVALID', 'MusicFree Host 与请求地址不一致')
      continue
    }
    headers[key.toLowerCase()] = String(value)
  }
  return headers
}

export interface PublicRequestOptions {
  method?: string
  headers?: Record<string, string>
  data?: string | Uint8Array
  timeout?: number
  signal?: AbortSignal
}

// Every redirect and DNS answer is checked, and the checked address is used by
// the socket. Plugin code never receives Node, local files, or LAN access.
export const openMusicFreeRequest = async(raw: string, options: PublicRequestOptions = {}, redirects = 0): Promise<IncomingMessage> => {
  const url = musicFreeUrl(raw)
  const method = String(options.method ?? 'GET').toUpperCase()
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'PROPFIND', 'MKCOL', 'MOVE', 'COPY'].includes(method)) throw sourceError('MUSICFREE_METHOD_INVALID', 'MusicFree 请求方法无效')
  const headers = musicFreeHeaders(options.headers ?? {}, url.host)
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method,
      headers,
      agent: false,
      signal: options.signal,
      lookup: ((host: string, lookupOptions: any, callback: (...args: any[]) => void) => {
        dns.lookup(host, { all: true, verbatim: true }, (error, addresses) => {
          if (error) { callback(error); return }
          if (!addresses.length || addresses.some(item => !publicAddress(item.address))) { callback(sourceError('MUSICFREE_ADDRESS_DENIED', 'MusicFree 不能访问本机或私有网络')); return }
          if (lookupOptions?.all) callback(null, addresses)
          else callback(null, addresses[0].address, addresses[0].family)
        })
      }) as any,
    })
    const timer = setTimeout(() => { request.destroy(sourceError('MUSICFREE_REQUEST_TIMEOUT', 'MusicFree 网络请求超时')) }, Math.min(Math.max(Number(options.timeout) || 15000, 1000), 60000))
    request.on('error', error => { clearTimeout(timer); reject(error) })
    request.on('response', response => {
      response.once('close', () => { clearTimeout(timer) })
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.destroy()
        if (redirects >= 5) { reject(sourceError('MUSICFREE_REDIRECT_LIMIT', 'MusicFree 重定向次数过多')); return }
        try {
          const next = musicFreeUrl(new URL(response.headers.location, url).href)
          if (next.origin !== url.origin) { delete headers.authorization; delete headers.cookie }
          const toGet = response.statusCode === 303 || ([301, 302].includes(response.statusCode!) && method === 'POST')
          if (toGet) delete headers['content-type']
          resolve(openMusicFreeRequest(next.href, { ...options, headers, method: toGet ? 'GET' : method, data: toGet ? undefined : options.data }, redirects + 1))
        } catch (error) { reject(error) }
      } else resolve(response)
    })
    request.end(options.data)
  })
}

export const requestMusicFree = (raw: string, options: any = {}, maxBytes = 8 * 1024 * 1024) => {
  const controller = new AbortController()
  const promise = (async() => {
    const value = options.data
    const data = value instanceof ArrayBuffer ? new Uint8Array(value) : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : value
    if (data != null && ((typeof data !== 'string' && !(data instanceof Uint8Array)) || Buffer.byteLength(data) > 2 * 1024 * 1024)) throw sourceError('MUSICFREE_BODY_LIMIT', 'MusicFree 请求正文无效或过大')
    const response = await openMusicFreeRequest(raw, { ...options, data, signal: controller.signal })
    const encoding = response.headers['content-encoding']
    const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : encoding === 'deflate' ? createInflate() : null
    const stream = decoder ? response.pipe(decoder) : response
    response.on('error', error => { stream.destroy(error) })
    const chunks: Buffer[] = []
    let size = 0
    try {
      for await (const chunk of stream) {
        const bytes = Buffer.from(chunk)
        if ((size += bytes.length) > maxBytes) throw sourceError('MUSICFREE_RESPONSE_LIMIT', 'MusicFree 响应过大')
        chunks.push(bytes)
      }
      const bytes = Buffer.concat(chunks)
      return { status: response.statusCode ?? 0, statusText: response.statusMessage ?? '', headers: { ...response.headers }, data: options.responseType === 'arraybuffer' ? new Uint8Array(bytes) : bytes.toString('utf8') }
    } finally { response.destroy(); decoder?.destroy() }
  })()
  return { promise, cancelHttp: () => { controller.abort() } }
}
