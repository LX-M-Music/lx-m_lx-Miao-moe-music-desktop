const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')()
const { shareRequest, awaitRequest, withRequestScope, getRequestSignal } = load('src/renderer/utils/requestContext.js')
const flush = () => new Promise(resolve => setImmediate(resolve))

test('B13: custom audio source cancellation forwards the existing IPC cancellation handle', async() => {
  const controller = new AbortController()
  let cancelled = 0
  const pending = awaitRequest({ promise: new Promise(() => {}), canceleFn() { cancelled++ } }, controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(cancelled, 1)
})

test('B13/B15: cancelling during retry backoff clears the pending wait immediately', async() => {
  const { requestDelay } = load('src/renderer/utils/requestContext.js')
  const controller = new AbortController()
  let retried = false
  const task = withRequestScope(controller.signal, async() => { await requestDelay(10000); retried = true })
  await flush()
  controller.abort()
  await assert.rejects(task, { name: 'AbortError' })
  assert.equal(retried, false)
})

test('B10/B13: aborting queued detail work removes it without blocking later jobs', async() => {
  const { createRequestLimiter } = load('src/renderer/utils/musicSdk/requestCache.js')
  const limit = createRequestLimiter(1)
  let release, cancelledStarts = 0
  const active = limit(() => new Promise(resolve => { release = resolve }))
  await flush()
  const controller = new AbortController()
  const queued = withRequestScope(controller.signal, () => limit(() => { cancelledStarts++; return 'cancelled' }))
  await flush()
  controller.abort()
  await assert.rejects(queued, { name: 'AbortError' })
  await assert.rejects(withRequestScope(controller.signal, () => limit(() => { cancelledStarts++ })), { name: 'AbortError' })
  const next = limit(() => 'next')
  release('active')
  assert.equal(await active, 'active')
  assert.equal(await next, 'next')
  assert.equal(cancelledStarts, 0)
})

test('B16: automatic source matching returns a fast match and cancels unused slow platforms', async() => {
  const overrides = {}, stopped = []
  const original = { source: 'kw', name: 'Song', singer: 'Singer', albumName: 'Album', interval: '03:00' }
  let context
  for (const source of ['kw', 'kg', 'tx', 'wy', 'mg', 'bd']) {
    overrides[`./${source}/index`] = { musicSearch: { search: async() => source === 'kg'
      ? { source, list: [{ ...original, source, songmid: 'match' }] }
      : context.awaitRequest({ promise: new Promise(() => {}), cancelHttp: () => stopped.push(source) }) } }
  }
  Object.assign(overrides, { './xm': {}, './api-source': {}, './plugins/loader': { loadLocalSourcePlugins: () => [] }, '@common/utils/vueTools': require('vue') })
  const sdkLoad = require('./helpers/load-typescript.cjs')(overrides)
  context = sdkLoad('src/renderer/utils/requestContext.js')
  const sdk = sdkLoad('src/renderer/utils/musicSdk/index.js').default
  const matches = await sdk.findMusic(original)
  assert.equal(matches[0].source, 'kg')
  await flush()
  assert.deepEqual(new Set(stopped), new Set(['tx', 'wy', 'mg']))
})

test('B15: a total deadline stops a stalled attempt and prevents subsequent retries', async() => {
  const { withRequestDeadline } = load('src/renderer/utils/requestContext.js')
  let cancelled = 0, attempts = 0
  const started = Date.now()
  await assert.rejects(withRequestDeadline(40, async() => {
    for (let i = 0; i < 6; i++) {
      attempts++
      await awaitRequest({ promise: new Promise(() => {}), cancelHttp() { cancelled++ } })
    }
  }), error => error.code === 'ETIMEDOUT' && error.retryable === false)
  assert.equal(attempts, 1)
  assert.equal(cancelled, 1)
  assert(Date.now() - started < 500)
})

test('B13: cancelling one shared consumer does not stop the other; the last consumer aborts transport', async() => {
  const pending = new Map(), first = new AbortController(), second = new AbortController()
  let started = 0, stopped = 0
  const task = () => { started++; return awaitRequest({ promise: new Promise(() => {}), cancelHttp: () => { stopped++ } }) }
  const a = shareRequest(pending, 'same', task, first.signal)
  const b = shareRequest(pending, 'same', task, second.signal)
  const settled = Promise.allSettled([a, b])
  await flush()
  assert.equal(started, 1)
  first.abort()
  await flush()
  assert.equal(stopped, 0)
  second.abort()
  await settled
  await flush()
  assert.equal(stopped, 1)
  assert.equal(pending.size, 0)
})

test('B13: asynchronous request scopes remain isolated and cancelled queued work never starts', async() => {
  const a = new AbortController(), b = new AbortController(), seen = []
  const first = withRequestScope(a.signal, async() => { await flush(); seen.push(getRequestSignal()) })
  const second = withRequestScope(b.signal, async() => { await flush(); seen.push(getRequestSignal()) })
  await Promise.all([first, second])
  assert.deepEqual(seen, [a.signal, b.signal])
  const cancelled = withRequestScope(a.signal, () => { throw new Error('must not start') })
  a.abort()
  await assert.rejects(cancelled, { name: 'AbortError' })
})
