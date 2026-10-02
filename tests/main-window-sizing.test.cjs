const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')({ electron: { nativeImage: {} } })
const { getWindowSizeInfo, getWindowSizing } = load('src/main/modules/winMain/utils.ts')

test('saved dimensions take precedence while existing profiles retain their old preset', () => {
  assert.deepEqual(getWindowSizeInfo(3), { id: 3, name: 'big', width: 1114, height: 718 })
  const saved = getWindowSizeInfo(6, 1122, 724)
  assert.equal(saved.width, 1122)
  assert.equal(saved.height, 724)
  for (const [width, height] of [[0, 0], [0.1, 200], [-1, 200], [Infinity, 200], [200, NaN], [40000, 200]]) assert.equal(getWindowSizeInfo(3, width, height).width, 1114)
})

for (const [width, height] of [[1920, 1080], [1024, 600], [800, 600], [2560, 720]]) {
  test(`saved oversized windows fit ${width} x ${height} without changing aspect ratio`, () => {
    const result = getWindowSizing({ width: 2000, height: 1280 }, { width, height })
    assert(result.width <= width && result.height <= height)
    assert(result.width >= result.minWidth && result.height >= result.minHeight)
    assert(Math.abs(result.width - result.height * 2000 / 1280) <= 1)
    assert(Math.abs(result.minWidth - result.minHeight * 2000 / 1280) <= 2)
    if (width >= 828 && height >= 540) assert(result.width >= 828 && result.height >= 540)
  })
}

test('small saved dimensions expand to a usable proportional minimum', () => {
  const result = getWindowSizing({ width: 320, height: 200 }, { width: 1920, height: 1080 })
  assert(result.width >= 828 && result.height >= 540)
  assert.equal(result.width / result.height, 1.6)
})

test('window dimensions stay device-local when settings are synchronized', () => {
  const load = require('./helpers/load-typescript.cjs')({ '@common/constants': { LIST_IDS: {}, QUALITYS: [] } })
  const { portableSettings } = load('src/main/modules/webdav/data.ts')
  const portable = portableSettings({ 'common.windowWidth': 1122, 'common.windowHeight': 724, 'common.windowSizeId': 6, 'common.fontSize': 16 })
  assert.equal(portable['common.windowWidth'], undefined)
  assert.equal(portable['common.windowHeight'], undefined)
  assert.equal(portable['common.fontSize'], 16)
})
