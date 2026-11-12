const test = require('node:test')
const assert = require('node:assert')

const { getScrollSpring } = require('./helpers/load-typescript.cjs')()('src/renderer/utils/motion.ts')

test('lyric scroll spring stiffens for dense lines and softens for sparse ones', () => {
  const dense = getScrollSpring({ interval: 150 })
  const medium = getScrollSpring({ interval: 450 })
  const sparse = getScrollSpring({ interval: 780 })
  assert(dense.stiffness > medium.stiffness, `${dense.stiffness} > ${medium.stiffness}`)
  assert(medium.stiffness > sparse.stiffness, `${medium.stiffness} > ${sparse.stiffness}`)
  assert(sparse.stiffness >= 260, `sparse stiffness ${sparse.stiffness} should stay usable`)
  assert(dense.stiffness <= 400, `dense stiffness ${dense.stiffness} should not become harsh`)
  for (const spring of [dense, medium, sparse]) {
    const ratio = spring.damping / (2 * Math.sqrt(spring.stiffness))
    assert(ratio > 0.8 && ratio < 1, `damping ratio ${ratio} should allow a light settle`)
  }
})

test('seeking uses a stable spring without overshoot', () => {
  const seek = getScrollSpring({ seeking: true, interval: 150 })
  assert(seek.damping >= 2 * Math.sqrt(seek.stiffness), `${seek.damping} should be at least critical`)
})
