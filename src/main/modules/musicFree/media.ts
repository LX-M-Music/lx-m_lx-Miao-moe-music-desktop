import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { musicFreeHeaders, musicFreeUrl, openMusicFreeRequest } from './network'

const media = new Map<string, { url: string, headers: Record<string, string>, expires: number }>()
let starting: Promise<number> | undefined
let server: http.Server | undefined

const start = async() => {
  starting ??= new Promise<number>((resolve, reject) => {
    server = http.createServer((request, response) => {
      const match = /^\/musicfree\/([a-f\d]{48})$/.exec(request.url ?? '')
      const record = match ? media.get(match[1]) : undefined
      if (!record || record.expires < Date.now() || !['GET', 'HEAD'].includes(request.method ?? '') || request.headers.host !== `127.0.0.1:${(server!.address() as any).port}`) { response.writeHead(404); response.end(); return }
      const controller = new AbortController()
      response.once('close', () => { controller.abort() })
      const headers = { ...record.headers, 'accept-encoding': 'identity' }
      if (typeof request.headers.range === 'string' && /^bytes=\d*-\d*(?:,\d*-\d*)*$/.test(request.headers.range)) Object.assign(headers, { range: request.headers.range })
      void openMusicFreeRequest(record.url, { headers, method: request.method, signal: controller.signal, timeout: 60000 }).then(upstream => {
        upstream.on('error', () => { response.destroy() })
        const forwarded: Record<string, string | number | string[]> = { 'Access-Control-Allow-Origin': '*' }
        for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-encoding', 'etag', 'last-modified']) if (upstream.headers[key] != null) forwarded[key] = upstream.headers[key]!
        response.writeHead(upstream.statusCode ?? 502, forwarded)
        upstream.pipe(response)
      }).catch(() => { if (!response.headersSent) response.writeHead(502); response.end() })
    })
    server.once('error', error => { starting = undefined; reject(error) })
    server.listen(0, '127.0.0.1', () => { server!.unref(); resolve((server!.address() as any).port) })
  })
  return starting
}

// Both Chromium audio and the download worker use this URL. Keeping request
// headers in the main process also avoids exposing credentials in cache files.
export const createMusicFreeMedia = async(value: any): Promise<string> => {
  const url = musicFreeUrl(typeof value === 'string' ? value : value?.url).href
  const headers = musicFreeHeaders({ ...value?.headers, ...(value?.userAgent ? { 'user-agent': value.userAgent } : {}) }, new URL(url).host)
  const port = await start()
  for (const [key, record] of media) if (record.expires < Date.now()) media.delete(key)
  while (media.size >= 512) media.delete(media.keys().next().value!)
  const token = randomBytes(24).toString('hex')
  media.set(token, { url, headers, expires: Date.now() + 2 * 60 * 60 * 1000 })
  return `http://127.0.0.1:${port}/musicfree/${token}`
}
