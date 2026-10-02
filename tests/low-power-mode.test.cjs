const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const load = (filename, globals) => {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  vm.runInNewContext(code, { exports, ...globals })
  return exports
}

test('visual frame cancellation follows the scheduled clock across live mode changes', () => {
  const calls = []
  const root = { dataset: { lowPowerMode: 'false' } }
  const globals = {
    document: { documentElement: root },
    window: { setTimeout: (_callback, delay) => { calls.push(['timer', delay]); return 7 } },
    requestAnimationFrame: () => 3,
    cancelAnimationFrame: id => calls.push(['cancel-frame', id]),
    clearTimeout: id => calls.push(['cancel-timer', id]),
  }
  const api = load('src/common/performance.ts', globals)
  const normal = api.requestVisualFrame(() => {})
  root.dataset.lowPowerMode = 'true'
  api.cancelVisualFrame(normal)
  const low = api.requestVisualFrame(() => {})
  root.dataset.lowPowerMode = 'false'
  api.cancelVisualFrame(low)
  assert.deepEqual(calls, [['cancel-frame', 3], ['timer', Math.ceil(1000 / 30)], ['cancel-timer', 7]])
})

test('the updated visualizer works with both the performance host and older hosts', () => {
  const cancelled = []
  const window = {}
  const bridge = load('src/optional-plugins/audio-visualizer/performance.ts', {
    window,
    requestAnimationFrame: () => 11,
    cancelAnimationFrame: id => cancelled.push(id),
  })
  assert.equal(bridge.isLowPowerMode(), false)
  assert.equal(bridge.getPerformancePolicy(true).visualizerDpr, 2)
  const legacy = bridge.requestVisualFrame(() => {})
  bridge.cancelVisualFrame(legacy)
  assert.deepEqual(cancelled, [11])
  window.__lxPluginHost = { performance: {
    isLowPowerMode: () => true,
    getPerformancePolicy: () => ({ visualizerPixels: 1000000, visualizerDpr: 1 }),
    requestVisualFrame: () => ({ id: 19, timer: true }),
    cancelVisualFrame: frame => cancelled.push(frame.id),
  } }
  assert.equal(bridge.isLowPowerMode(), true)
  assert.equal(bridge.getPerformancePolicy(true).visualizerDpr, 1)
  bridge.cancelVisualFrame(bridge.requestVisualFrame(() => {}))
  assert.deepEqual(cancelled, [11, 19])
})
