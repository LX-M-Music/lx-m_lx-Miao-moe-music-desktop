const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')()
const { surfaceSize, normalizeQuality } = load('src/renderer/utils/kawarpBackground/options.ts')

test('the low-resolution background stays bounded on 4K, portrait and high-DPI displays', () => {
  const limits = { static: 560, gentle: 640, full: 768 }
  for (const [width, height] of [[828, 540], [3840, 2160], [2160, 3840]]) {
    for (const quality of ['static', 'gentle', 'full']) {
      for (const dpr of [0.5, 1, 2, 3]) {
        const size = surfaceSize(width, height, quality, dpr)
        assert(size.width >= 1 && size.height >= 1)
        assert(Math.max(size.width, size.height) <= limits[quality])
        assert(Math.abs(size.width / size.height - width / height) < 0.02)
      }
    }
  }
  const fourK = surfaceSize(3840, 2160, 'full')
  assert.deepEqual(fourK, { width: 768, height: 432 })
  assert(fourK.width * fourK.height * 4 < 1.5 * 1024 * 1024, 'the live buffer must stay under 1.5 MiB')
})

test('hidden surfaces and invalid dimensions cannot allocate unbounded textures', () => {
  for (const value of [0, -1, NaN, Infinity, undefined]) {
    for (const quality of ['static', 'gentle', 'full']) {
      const size = surfaceSize(value, value, quality)
      assert.deepEqual(size, { width: 1, height: 1 })
    }
  }
})

test('saved quality choices are accepted with a safe default', () => {
  for (const quality of ['static', 'gentle', 'full']) assert.equal(normalizeQuality(quality), quality)
  assert.equal(normalizeQuality(undefined), 'gentle')
})

test('each quality tier has a distinct, aspect-preserving pixel budget', () => {
  const staticSize = surfaceSize(1114, 718, 'static')
  const gentleSize = surfaceSize(1114, 718, 'gentle')
  const fullSize = surfaceSize(1114, 718, 'full')
  assert.deepEqual(staticSize, { width: 560, height: 361 })
  assert.deepEqual(gentleSize, { width: 640, height: 412 })
  assert.deepEqual(fullSize, { width: 768, height: 495 })
  assert(staticSize.width * staticSize.height < gentleSize.width * gentleSize.height)
  assert(gentleSize.width * gentleSize.height < fullSize.width * fullSize.height)
})
