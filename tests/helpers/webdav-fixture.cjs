const http = require('node:http')
const { createHash } = require('node:crypto')

exports.song = id => ({
  id: 'wy_' + id, name: 'Song ' + id, singer: 'Fixture', source: 'wy', interval: '03:10',
  meta: { songId: id, albumName: 'Album', qualitys: [], _qualitys: {} },
})
exports.playlists = (...ids) => ({ defaultList: ids.map(exports.song), loveList: [], userList: [] })
exports.task = (id, completed = false) => ({
  id: 'task_' + id, isComplate: completed, status: completed ? 'completed' : 'pause', statusText: 'Old text',
  downloaded: 12, total: 100, progress: 12, speed: '12 B/s', writeQueue: 1,
  metadata: { musicInfo: exports.song(id), quality: '128k', ext: 'mp3', fileName: id + '.mp3', filePath: 'D:/local/' + id + '.mp3', url: 'https://expired.example/audio' },
})
exports.snapshot = data => ({ type: 'lx-music-webdav', version: 1, updatedAt: Date.now(), data })

exports.createDAV = async() => {
  const files = new Map()
  const directories = new Set(['/', '/dav/'])
  const requests = []
  const errors = []
  const control = { beforeRequest: null, validators: true }
  const etag = content => '"' + createHash('sha256').update(content).digest('hex') + '"'
  const authorization = 'Basic ' + Buffer.from('fixture: pass word ').toString('base64')
  const server = http.createServer(async(req, res) => {
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks).toString()
      requests.push({ method: req.method, path: req.url, headers: req.headers, body })
      if (req.headers.authorization !== authorization) { res.writeHead(401).end(); return }
      if (await control.beforeRequest?.(req, res, body)) return
      const url = req.url
      if (req.method === 'PROPFIND') {
        if (!directories.has(url)) { res.writeHead(404).end(); return }
        res.writeHead(207, { 'Content-Type': 'application/xml' }).end('<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>')
      } else if (req.method === 'MKCOL') {
        if (directories.has(url)) { res.writeHead(405).end(); return }
        const parent = url.replace(/[^/]+\/$/, '')
        if (!directories.has(parent)) { res.writeHead(409).end(); return }
        directories.add(url)
        res.writeHead(201).end()
      } else if (req.method === 'GET') {
        if (!files.has(url)) { res.writeHead(404).end(); return }
        const content = files.get(url)
        if (control.validators && req.headers['if-none-match'] === etag(content)) { res.writeHead(304, { ETag: etag(content) }).end(); return }
        res.writeHead(200, { 'Content-Type': 'application/json', ...(control.validators ? { ETag: etag(content) } : {}) }).end(content)
      } else if (req.method === 'PUT') {
        if (!directories.has(url.replace(/[^/]+$/, ''))) { res.writeHead(409).end(); return }
        const old = files.get(url)
        if ((req.headers['if-none-match'] === '*' && old !== undefined) || (req.headers['if-match'] && req.headers['if-match'] !== etag(old ?? ''))) { res.writeHead(412).end(); return }
        files.set(url, body)
        res.writeHead(old === undefined ? 201 : 204, control.validators ? { ETag: etag(body) } : {}).end()
      } else if (req.method === 'DELETE') {
        files.delete(url)
        res.writeHead(204).end()
      } else res.writeHead(405).end()
    } catch (error) {
      errors.push(error.message)
      res.writeHead(500).end()
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    files, directories, requests, errors, control,
    config: { url: `http://127.0.0.1:${server.address().port}/dav/`, username: 'fixture', password: ' pass word ', directory: 'lx-music' },
    file: '/dav/lx-music/lx-music-sync.json',
    playlistFile: '/dav/LX_Music/playlists.json',
    seed(data) {
      const { playlists, ...other } = data
      directories.add('/dav/lx-music/')
      files.set('/dav/lx-music/lx-music-sync.json', JSON.stringify(exports.snapshot(other)))
      if (playlists) this.seedMobile({ version: '2', lastModified: Date.now(), data: { ...playlists, tempList: [] } })
    },
    seedLegacy(data) {
      directories.add('/dav/lx-music/')
      files.set('/dav/lx-music/lx-music-sync.json', JSON.stringify(exports.snapshot(data)))
    },
    seedMobile(data) {
      directories.add('/dav/LX_Music/')
      files.set('/dav/LX_Music/playlists.json', JSON.stringify(data))
    },
    async close() {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    },
  }
}
