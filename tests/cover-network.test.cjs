const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')
const flush = () => new Promise(resolve => setImmediate(resolve))

test('B13: artwork download leases cancel unused queued images but preserve shared consumers', async t => {
  const previous = { fetch: global.fetch, Image: global.Image }
  t.after(() => Object.assign(global, previous))
  const calls = []
  global.Image = class { async decode() {} }
  global.fetch = (url, { signal }) => new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    calls.push({ url, finish() { signal.removeEventListener('abort', abort); resolve({ ok: true, blob: async() => new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')]) }) } })
  })
  const api = load({ 'image-size': require('image-size'), './artworkStorage': { artworkCacheGeneration: () => 1, onArtworkCacheCleared() {}, readArtworkCache: async() => null, writeArtworkCache: async() => {} } })('src/renderer/utils/coverCache.ts')
  const active = Array.from({ length: 6 }, (_, i) => api.acquireCover(`http://artwork.test/${i}`))
  await flush()
  assert.equal(calls.length, 6)
  const unused = new AbortController(), first = new AbortController(), second = new AbortController()
  const queued = api.acquireCover('http://artwork.test/unused', undefined, unused.signal)
  const sharedA = api.acquireCover('http://artwork.test/shared', undefined, first.signal)
  const sharedB = api.acquireCover('http://artwork.test/shared', undefined, second.signal)
  await flush()
  unused.abort(); first.abort()
  await Promise.all([assert.rejects(queued, { name: 'AbortError' }), assert.rejects(sharedA, { name: 'AbortError' })])
  calls.slice().forEach(call => call.finish())
  await flush()
  assert.deepEqual(calls.slice(6).map(call => call.url), ['http://artwork.test/shared'])
  calls[6].finish()
  const leases = await Promise.all([...active, sharedB])
  assert(api.getCoverMemorySize() > 7 * 4, 'resident bytes include encoded images and decoded pixels')
  const resident = api.getCoverMemorySize()
  api.clearCoverMemory()
  assert.equal(api.getCoverMemorySize(), resident, 'mounted images remain accounted for until their leases end')
  for (const lease of leases) lease.release()
  assert.equal(api.getCoverMemorySize(), 0)
})

test('cached artwork is leased before another image can evict it', async t => {
  const previous = { fetch: global.fetch, Image: global.Image }
  t.after(() => Object.assign(global, previous))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
  global.Image = class { async decode() {} }
  global.fetch = async() => new Response(png)
  const api = load({ 'image-size': require('image-size'), './artworkStorage': { artworkCacheGeneration: () => 1, onArtworkCacheCleared() {}, readArtworkCache: async() => null, writeArtworkCache: async() => {} } })('src/renderer/utils/coverCache.ts')
  const first = await api.acquireCover('http://artwork.test/first')
  const second = await api.acquireCover('http://artwork.test/second')
  t.after(() => { first.release(); second.release(); api.clearCoverMemory() })
  first.release()
  const returning = api.acquireCover('http://artwork.test/first')
  await Promise.resolve()
  api.setCoverMemoryLimits(1024, 1)
  const lease = await returning
  t.after(() => lease.release())
  const pixels = await previous.fetch(lease.src)
  assert.deepEqual(Buffer.from(await pixels.arrayBuffer()), png, 'a returning row never receives an already revoked blob URL')
})

test('concurrently decoded covers stay valid until every waiting row acquires its lease', async t => {
  const previous = { fetch: global.fetch, Image: global.Image }
  t.after(() => Object.assign(global, previous))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
  global.Image = class { async decode() {} }
  global.fetch = async() => new Response(png)
  const api = load({ 'image-size': require('image-size'), './artworkStorage': { artworkCacheGeneration: () => 1, onArtworkCacheCleared() {}, readArtworkCache: async() => null, writeArtworkCache: async() => {} } })('src/renderer/utils/coverCache.ts')
  api.setCoverMemoryLimits(0, 0)
  const leases = await Promise.all(Array.from({ length: 6 }, (_, index) => api.acquireCover(`http://artwork.test/concurrent-${index}`)))
  t.after(() => { for (const lease of leases) lease.release(); api.clearCoverMemory() })
  for (const lease of leases) {
    const pixels = await previous.fetch(lease.src)
    assert.deepEqual(Buffer.from(await pixels.arrayBuffer()), png)
  }
})

test('clearing before a download starts keeps old and new artwork consumers independent', async t => {
  const previous = { fetch: global.fetch, Image: global.Image }
  t.after(() => Object.assign(global, previous))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
  let downloads = 0
  global.Image = class { async decode() {} }
  global.fetch = async() => { downloads++; return new Response(png) }
  const api = load({ 'image-size': require('image-size'), './artworkStorage': { artworkCacheGeneration: () => 1, onArtworkCacheCleared() {}, readArtworkCache: async() => null, writeArtworkCache: async() => {} } })('src/renderer/utils/coverCache.ts')
  api.setCoverMemoryLimits(0, 0)
  const old = api.acquireCover('http://artwork.test/cleared')
  api.clearCoverMemory()
  const fresh = api.acquireCover('http://artwork.test/cleared')
  const leases = await Promise.all([old, fresh])
  t.after(() => { for (const lease of leases) lease.release(); api.clearCoverMemory() })
  assert.equal(downloads, 2, 'the fresh consumer does not reuse work from before the clear')
  assert.notEqual(leases[0].src, leases[1].src)
  for (const lease of leases) assert.deepEqual(Buffer.from(await (await previous.fetch(lease.src)).arrayBuffer()), png)
  for (const lease of leases) lease.release()
  assert.equal(api.getCoverMemorySize(), 0, 'both generations release their images after the rows unmount')
})
