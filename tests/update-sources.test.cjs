const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { setTimeout: delay } = require('node:timers/promises')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')

const catalog = load()('src/common/updateMirrors.ts')
const payload = Buffer.alloc(64 * 1024, 42)
payload.write('MZ')
const source = name => ({ name, url: `https://${name}/update.exe` })
const response = (body = Readable.from([payload]), headers = {}) => ({ statusCode: 206, headers: { 'content-range': `bytes 0-${payload.length - 1}/1048576`, ...headers }, body })
const api = request => load({
  '@common/updateMirrors': catalog,
  '@common/utils/undiciCompat': { requestWithCompatibility: request },
})('src/main/modules/winMain/updateSources.ts')
const options = values => ({ dispatcher: {}, signal: new AbortController().signal, fileName: 'LX-M-x64-Setup.exe', size: 1048576, onProgress() {}, timeoutMs: 300, deadlineMs: 2000, ...values })

test('catalog combines both websites, removes duplicates and leaves other download hosts intact', () => {
  assert.equal(catalog.UPDATE_MIRROR_PREFIXES.length, 154)
  assert.equal(new Set(catalog.UPDATE_MIRROR_PREFIXES).size, 154)
  for (const prefix of catalog.UPDATE_MIRROR_PREFIXES) {
    const url = new URL(prefix)
    assert.equal(url.protocol, 'https:')
    assert.equal(url.username, '')
    assert.equal(url.password, '')
    assert.equal(url.pathname, '/')
  }
  const utils = api()
  const url = 'https://github.com/Miao-moe/lx-m_lx-Miao-moe-music-desktop/releases/download/v9.0.0/Setup.exe'
  const routes = utils.getUpdateSources(url)
  assert.equal(routes.length, 155)
  assert.equal(routes[0].url, url)
  assert(routes.some(route => route.url === 'https://github.mxw.qzz.io/' + url))
  assert(routes.some(route => route.url === 'https://gh-proxy.net/' + url))
  assert.equal(utils.getUpdateSources('https://example.test/Setup.exe').length, 1)
  assert.equal(utils.getUpdateSources('https://github.com/owner/repo/issues').length, 1)
})

test('selection measures installer bytes rather than headers and bounds concurrent probes', async() => {
  let active = 0
  let peak = 0
  const seen = []
  const progress = []
  const sources = [source('direct.test'), source('fast.test'), source('slow.test')]
  const utils = api(async(url, request) => {
    assert.equal(request.headers.Range, 'bytes=0-65535')
    assert.equal(request.headers['Accept-Encoding'], 'identity')
    seen.push(url)
    peak = Math.max(peak, ++active)
    let finished = false
    const finish = () => { if (!finished) { finished = true; active-- } }
    request.signal.addEventListener('abort', finish, { once: true })
    const body = Readable.from((async function* () {
      await delay(url.includes('fast.test') ? 10 : 140, undefined, { signal: request.signal })
      yield payload
    })())
    body.once('close', finish)
    return response(body)
  })
  const ranked = await utils.speedTestUpdateSources(sources, options({ concurrency: 2, onProgress: (tested, total) => progress.push([tested, total]) }))
  assert.equal(ranked[0].name, 'fast.test')
  assert(ranked[0].bytesPerSecond > ranked[1].bytesPerSecond)
  assert.equal(seen.length, 3)
  assert.equal(peak, 2)
  assert.deepEqual(progress.at(-1), [3, 3])
})

test('error pages, invalid executable bytes, wrong ranges and short replies are rejected', async() => {
  const sources = ['direct.test', 'html.test', 'fake.test', 'range.test', 'short.test', 'valid.test'].map(source)
  const bodies = []
  const utils = api(async url => {
    let result = response()
    if (url.includes('html.test')) result = response(Readable.from(['<html>error</html>']), { 'content-type': 'text/html' })
    if (url.includes('fake.test')) result = response(Readable.from([Buffer.alloc(payload.length, 42)]))
    if (url.includes('range.test')) result = response(undefined, { 'content-range': 'bytes 65536-131071/1048576' })
    if (url.includes('short.test')) result = response(Readable.from(['MZ']))
    bodies.push(result.body)
    return result
  })
  const ranked = await utils.speedTestUpdateSources(sources, options())
  assert.deepEqual(new Set(ranked.map(route => route.name)), new Set(['direct.test', 'valid.test']))
  assert(bodies.every(body => body.destroyed))
})

test('servers that ignore Range are sampled and closed without downloading the entire file', async() => {
  let chunks = 0
  let body
  const utils = api(async() => {
    body = Readable.from((async function* () {
      chunks++
      yield payload
      await delay(50)
      chunks++
      yield Buffer.alloc(1048576)
    })())
    return { statusCode: 200, headers: { 'content-length': '1048576' }, body }
  })
  const ranked = await utils.speedTestUpdateSources([source('direct.test')], options())
  assert(ranked[0].bytesPerSecond > 0)
  assert(body.destroyed)
  assert(chunks <= 2, 'a prefetch may start, but the body must not be fully consumed')
})

const stall = (_, request) => new Promise((resolve, reject) => {
  const abort = () => reject(request.signal.reason)
  request.signal.addEventListener('abort', abort, { once: true })
  if (request.signal.aborted) abort()
})

test('unreachable catalogs have a finite deadline and retain the original GitHub route', async() => {
  let requests = 0
  const sources = Array.from({ length: 20 }, (_, i) => source(`node-${i}.test`))
  const utils = api((...args) => { requests++; return stall(...args) })
  const started = Date.now()
  const ranked = await utils.speedTestUpdateSources(sources, options({ concurrency: 2, deadlineMs: 50, timeoutMs: 1000 }))
  assert(Date.now() - started < 500)
  assert.equal(requests, 2)
  assert.deepEqual(ranked, [sources[0]])
})

test('cancellation aborts active probes and does not return a download route', async() => {
  const controller = new AbortController()
  const utils = api(stall)
  const pending = utils.speedTestUpdateSources([source('direct.test'), source('other.test')], options({ signal: controller.signal }))
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})
