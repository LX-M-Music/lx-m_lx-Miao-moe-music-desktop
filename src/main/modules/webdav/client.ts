import http from 'node:http'
import https from 'node:https'
import { randomUUID } from 'node:crypto'
import { WebDAVError } from './errors'

const MAX_BYTES = 32 * 1024 * 1024
const TIMEOUT = 30_000
const FILE_NAME = 'lx-music-sync.json'

interface Response {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
}

export interface RemoteFile {
  content: string | null
  etag?: string
  lastModified?: string
  unchanged?: boolean
}

export const resolveConfig = (config: LX.WebDAV.Config, fileName = FILE_NAME) => {
  let base: URL
  try {
    base = new URL(config.url.trim())
  } catch {
    throw new WebDAVError('invalid_config')
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || config.username.includes(':')) {
    throw new WebDAVError('invalid_config')
  }
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  const parts = config.directory.trim().split('/').filter(Boolean)
  // eslint-disable-next-line no-control-regex -- Reject control characters in remote directory names.
  if (parts.some(part => part == '.' || part == '..' || /[\\\x00-\x1f]/.test(part))) throw new WebDAVError('invalid_config')
  const directories = parts.map((_, index) => new URL(parts.slice(0, index + 1).map(encodeURIComponent).join('/') + '/', base))
  const directory = directories[directories.length - 1] ?? base
  if (![FILE_NAME, 'playlists.json'].includes(fileName)) throw new WebDAVError('invalid_config')
  return { base, directories, directory, file: new URL(fileName, directory) }
}

export const createClient = (config: LX.WebDAV.Config, fileName = FILE_NAME) => {
  const paths = resolveConfig(config, fileName)
  const authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64')}`

  const request = async(method: string, url: URL, body = '', headers: Record<string, string> = {}, redirects = 0): Promise<Response> => {
    if (Buffer.byteLength(body) > MAX_BYTES) throw new WebDAVError('too_large')
    const response = await new Promise<Response>((resolve, reject) => {
      const transport = url.protocol == 'https:' ? https : http
      const req = transport.request(url, {
        method,
        headers: {
          Authorization: authorization,
          'Cache-Control': 'no-cache',
          'Content-Length': String(Buffer.byteLength(body)),
          ...headers,
        },
      }, res => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_BYTES) {
            req.destroy(new WebDAVError('too_large'))
            return
          }
          chunks.push(chunk)
        })
        res.on('error', error => { reject(new WebDAVError('network', undefined, undefined, error)) })
        res.on('end', () => { resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }) })
      })
      // A wall-clock deadline also covers DNS, TLS and servers that drip bytes forever.
      const deadline = setTimeout(() => { req.destroy(new WebDAVError('timeout')) }, TIMEOUT)
      req.on('close', () => { clearTimeout(deadline) })
      req.on('error', error => { reject(error instanceof WebDAVError ? error : new WebDAVError('network', undefined, undefined, error)) })
      req.end(body)
    })
    if ([301, 302, 307, 308].includes(response.status)) {
      if (!response.headers.location || redirects >= 3) throw new WebDAVError('redirect')
      const target = new URL(response.headers.location, url)
      // Never send credentials to another origin or follow an HTTPS downgrade.
      if (target.origin != paths.base.origin || target.username || target.password) throw new WebDAVError('redirect')
      return request(method, target, body, headers, redirects + 1)
    }
    if (response.status == 401 || response.status == 403) throw new WebDAVError('auth', undefined, response.status)
    if (response.status == 412) throw new WebDAVError('remote_changed')
    return response
  }

  const expectStatus = (response: Response, statuses: number[]) => {
    if (!statuses.includes(response.status)) throw new WebDAVError('http', undefined, response.status)
  }

  const checkDirectory = async(url: URL) => {
    const response = await request('PROPFIND', url, '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>', {
      Depth: '0',
      'Content-Type': 'application/xml; charset=utf-8',
    })
    expectStatus(response, [207])
    if (!/<(?:[\w.-]+:)?collection(?:\s[^>]*)?\s*\/?\s*>/.test(response.body)) throw new WebDAVError('invalid_config')
  }

  const ensureDirectory = async() => {
    await checkDirectory(paths.base)
    for (const directory of paths.directories) {
      const response = await request('MKCOL', directory)
      expectStatus(response, [201, 405])
      if (response.status == 405) await checkDirectory(directory)
    }
  }

  return {
    identity: `${paths.file.href}\n${config.username}`,
    async read(previous?: RemoteFile): Promise<RemoteFile> {
      const headers: Record<string, string> = {}
      if (previous?.content != null) {
        if (previous.etag) headers['If-None-Match'] = previous.etag
        else if (previous.lastModified) headers['If-Modified-Since'] = previous.lastModified
      }
      const response = await request('GET', paths.file, '', headers)
      if (response.status === 304 && previous?.content != null) return { ...previous, etag: response.headers.etag ?? previous.etag, lastModified: response.headers['last-modified'] ?? previous.lastModified, unchanged: true }
      if (response.status == 404) return { content: null }
      expectStatus(response, [200])
      return { content: response.body, etag: response.headers.etag, lastModified: response.headers['last-modified'] }
    },
    async write(content: string, previous: RemoteFile) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' }
      if (previous.content == null) {
        await ensureDirectory()
        headers['If-None-Match'] = '*'
      } else if (previous.etag && !previous.etag.startsWith('W/')) headers['If-Match'] = previous.etag
      else if (previous.lastModified) headers['If-Unmodified-Since'] = previous.lastModified
      else throw new WebDAVError('missing_validator')
      const response = await request('PUT', paths.file, content, headers)
      expectStatus(response, [200, 201, 204])
      return { content, etag: response.headers.etag, lastModified: response.headers['last-modified'] }
    },
    async test() {
      await ensureDirectory()
      const probe = new URL(`.lx-webdav-test-${randomUUID()}.txt`, paths.directory)
      const content = randomUUID()
      let created = false
      try {
        expectStatus(await request('PUT', probe, content, { 'If-None-Match': '*', 'Content-Type': 'text/plain' }), [200, 201, 204])
        created = true
        const response = await request('GET', probe)
        expectStatus(response, [200])
        if (response.body != content) throw new WebDAVError('invalid_data')
      } finally {
        if (created) expectStatus(await request('DELETE', probe), [200, 204, 404])
      }
    },
  }
}
