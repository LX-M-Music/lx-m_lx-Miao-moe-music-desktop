const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')()
const { surfaceSize, normalizeQuality } = load('src/renderer/utils/kawarpBackground/options.ts')

test('Kawarp stays within the pixel budget on 4K, portrait and high-DPI displays', () => {
  for (const [width, height] of [[828, 540], [3840, 2160], [2160, 3840]]) {
    for (const quality of ['static', 'gentle', 'full']) {
      for (const dpr of [0.5, 1, 2, 3]) {
        const size = surfaceSize(width, height, quality, dpr)
        assert(size.width >= 1 && size.height >= 1)
        assert(Math.max(size.width, size.height) <= ({ full: 1440, gentle: 600, static: 900 })[quality])
        assert(Math.abs(size.width / size.height - width / height) < 0.02)
      }
    }
  }
})

test('hidden surfaces and invalid dimensions cannot allocate unbounded textures', () => {
  for (const value of [0, -1, NaN, Infinity, undefined]) {
    for (const quality of ['static', 'gentle', 'full']) {
      const size = surfaceSize(value, value, quality, value)
      assert.deepEqual(size, { width: 1, height: 1 })
    }
  }
})

test('saved quality choices are accepted with a safe default', () => {
  for (const quality of ['static', 'gentle', 'full']) assert.equal(normalizeQuality(quality), quality)
  assert.equal(normalizeQuality(undefined), 'gentle')
})

test('gentle reduces the moving pixel budget while static and full keep their resolution', () => {
  assert.deepEqual(surfaceSize(1708, 1020, 'static', 1.5), { width: 900, height: 537 })
  assert.deepEqual(surfaceSize(1708, 1020, 'full', 1.5), { width: 1440, height: 860 })
  for (const [width, height] of [[828, 540], [1114, 718], [1708, 1020], [3840, 2160]]) {
    const before = surfaceSize(width, height, 'static')
    const after = surfaceSize(width, height, 'gentle')
    assert(after.width * after.height <= before.width * before.height * 0.6)
  }
})
