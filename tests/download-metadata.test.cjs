const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')
const download = require('../src/common/utils/musicMeta/downloader.js')
const flac = Buffer.concat([Buffer.from('fLaC'), Buffer.from([0x80, 0, 0, 34]), Buffer.alloc(34), Buffer.from('audio-payload')])
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
const meta = { title: 'New title', artist: 'Singer', album: 'Album', lyrics: '' }
async function directory(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lx-download-meta-'))
  t.after(async() => {
    const resolved = await fs.promises.realpath(dir)
    assert(path.dirname(resolved).toLowerCase() === (await fs.promises.realpath(os.tmpdir())).toLowerCase())
    assert(path.basename(resolved).startsWith('lx-download-meta-'))
    await fs.promises.rm(resolved, { recursive: true, force: true })
  })
  return dir
}
function loadFlac(overrides = {}) {
  return loader({ fs, 'image-size': require('image-size'), stream: require('stream'), './downloader': download, ...overrides })('src/common/utils/musicMeta/flacMeta.js')
}
test('C03: FLAC resolves only after tags are readable at the final path; invalid input rejects', async t => {
  const file = path.join(await directory(t), 'song.flac')
  await fs.promises.writeFile(file, flac)
  await loadFlac()(file, meta)
  assert((await fs.promises.readFile(file)).includes(Buffer.from('TITLE=New title')))
  await fs.promises.writeFile(file, 'invalid')
  await assert.rejects(loadFlac()(file, meta), { code: 'ERR_FLAC_METADATA' })
  assert.equal(await fs.promises.readFile(file, 'utf8'), 'invalid')
})
test('C04: rename failure preserves the exact original FLAC and reports the failure', async t => {
  const dir = await directory(t), file = path.join(dir, 'song.flac')
  await fs.promises.writeFile(file, flac)
  const write = loadFlac({ fs: { ...fs, promises: { ...fs.promises, rename: async() => { throw Object.assign(Error('locked'), { code: 'EPERM' }) } } } })
  await assert.rejects(write(file, meta), { code: 'EPERM' })
  assert.deepEqual(await fs.promises.readFile(file), flac)
  assert.deepEqual(await fs.promises.readdir(dir), ['song.flac'])
})
test('C03/C04/C09: MP3 tags finish before resolving and a failed replacement preserves the original', async t => {
  const file = path.join(await directory(t), 'song.mp3')
  const original = require('./helpers/tag-fixtures.cjs').mp3().bytes
  const NodeID3 = require('node-id3')
  const loadMp3 = (filesystem = fs) => loader({ fs: filesystem, 'node-id3': NodeID3, './downloader': download })('src/common/utils/musicMeta/mp3Meta.js')
  await fs.promises.writeFile(file, original)
  const write = loadMp3({ ...fs, promises: { ...fs.promises, rename: async() => { throw Object.assign(Error('locked'), { code: 'EPERM' }) } } })
  await assert.rejects(write(file, meta), { code: 'EPERM' })
  assert.deepEqual(await fs.promises.readFile(file), original)
  assert.deepEqual(await fs.promises.readdir(path.dirname(file)), ['song.mp3'])
  await loadMp3()(file, meta)
  assert.equal(NodeID3.read(await fs.promises.readFile(file)).title, meta.title)
})
test('C12: FLAC stores the detected GIF MIME and leaves caller metadata unchanged', async t => {
  const file = path.join(await directory(t), 'song.flac')
  await fs.promises.writeFile(file, flac)
  const metadata = { ...meta, APIC: 'https://artwork.test/incorrect.jpg' }
  await loadFlac({ './downloader': async(_url, filename) => fs.promises.writeFile(filename, gif) })(file, metadata)
  const bytes = await fs.promises.readFile(file)
  assert(bytes.includes(Buffer.from('image/gif')))
  assert(!bytes.includes(Buffer.from('image/png')))
  assert.equal(metadata.APIC, 'https://artwork.test/incorrect.jpg')
})
test('C02: HTTPS artwork selects the TLS transport', async t => {
  const { PassThrough } = require('node:stream'), { EventEmitter } = require('node:events')
  let secure = 0
  const request = (_url, _options, callback) => {
    secure++
    const req = new EventEmitter()
    req.destroy = () => {}
    req.end = () => queueMicrotask(() => {
      const response = new PassThrough()
      Object.assign(response, { statusCode: 200, headers: {}, complete: true })
      callback(response); response.end(gif)
    })
    return req
  }
  const get = loader({ fs, http: { request() { throw Error('HTTP used for HTTPS') } }, https: { request }, tunnel: require('tunnel') })('src/common/utils/musicMeta/downloader.js')
  await get('https://artwork.test/a', path.join(await directory(t), 'cover'))
  assert.equal(secure, 1)
})
test('C11: artwork follows relative redirects, bounds bytes and time, and removes partial files', async t => {
  const dir = await directory(t)
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') return res.writeHead(302, { Location: '/image' }).end()
    if (req.url === '/loop') return res.writeHead(307, { Location: '/loop' }).end()
    if (req.url === '/stall') { res.writeHead(200); res.write('a'); return }
    if (req.url === '/large') { res.writeHead(200); res.write(Buffer.alloc(100)); res.end(Buffer.alloc(100)); return }
    if (req.url === '/missing') return res.writeHead(404).end()
    res.end(gif)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async() => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const base = 'http://127.0.0.1:' + server.address().port
  await download(base + '/redirect', path.join(dir, 'good'))
  assert.deepEqual(await fs.promises.readFile(path.join(dir, 'good')), gif)
  for (const [name, options, code] of [['stall', { timeout: 40 }, 'ETIMEDOUT'], ['large', { maxBytes: 150 }, 'ERR_ARTWORK_SIZE'], ['missing', {}, 'ERR_ARTWORK_HTTP'], ['loop', {}, 'ERR_ARTWORK_REDIRECT']]) {
    await assert.rejects(download(base + '/' + name, path.join(dir, name), undefined, options), { code })
    assert.equal(fs.existsSync(path.join(dir, name)), false)
  }
  await fs.promises.writeFile(path.join(dir, 'existing'), 'keep')
  await assert.rejects(download(base + '/image', path.join(dir, 'existing')), { code: 'EEXIST' })
  assert.equal(await fs.promises.readFile(path.join(dir, 'existing'), 'utf8'), 'keep')
})

test('artwork HTTP requests use Node URLs even when a browser worker supplies the global URL class', async t => {
  const { URL: NodeURL } = require('node:url')
  class BrowserURL {
    constructor(value, base) { this.parsed = new NodeURL(value, base) }
    get protocol() { return this.parsed.protocol }
    get href() { return this.parsed.href }
    toString() { return this.href }
  }
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') return res.writeHead(302, { Location: '/cover' }).end()
    res.end(gif)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async() => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const module = { exports: {} }
  require('node:vm').runInNewContext(fs.readFileSync('src/common/utils/musicMeta/downloader.js', 'utf8'), {
    module, require, URL: BrowserURL, setTimeout, clearTimeout,
  })
  const file = path.join(await directory(t), 'worker-cover')
  await module.exports(`http://127.0.0.1:${server.address().port}/redirect`, file)
  assert.deepEqual(await fs.promises.readFile(file), gif)
})
