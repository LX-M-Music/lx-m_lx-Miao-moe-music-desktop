const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const ts = require('typescript')
const { test } = require('node:test')
const { launch } = require('./helpers/motion-fixture.cjs')

// Compare with the original renderer at the same clock, size and artwork. This
// catches changes to flow, cover orientation, blur, shading and transition color.
test('background renderer retains Kawarp appearance within its dithering tolerance', { timeout: 120000 }, async t => {
  const fixture = await launch({
    rendererPath: path.resolve('dist/index.html'),
    disableHardwareAcceleration: false,
    args: process.env.LX_BACKGROUND_SOFTWARE ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
  })
  try {
    const { page } = fixture
    await page.evaluate(() => window.lxData.updateSetting({ 'ui.ambientBackground': false }))
    const reference = await fs.readFile(path.resolve('node_modules/@kawarp/core/dist/index.js'), 'utf8')
    await page.addScriptTag({ content: reference.replace('export class Kawarp', 'class Kawarp').replace('export default Kawarp;', 'window.__originalKawarp = Kawarp;') })
    for (const name of ['shaders', 'options', 'renderer']) {
      const source = await fs.readFile(path.resolve(`src/renderer/utils/kawarpBackground/${name}.ts`), 'utf8')
      const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
      await page.addScriptTag({ content: `(() => { const exports = {}; const require = () => window.__backgroundShaders; ${code}\nwindow.${name === 'shaders' ? '__backgroundShaders' : name === 'options' ? '__backgroundOptions' : '__backgroundRenderer'} = exports })()` })
    }
    const result = await page.evaluate(async() => {
      const oldCanvas = document.createElement('canvas')
      const newCanvas = document.createElement('canvas')
      for (const canvas of [oldCanvas, newCanvas]) canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'low-power' })
      const original = new window.__originalKawarp(oldCanvas, { warpIntensity: 0.85, blurPasses: 8, saturation: 1, scale: 1.08, tintIntensity: 0, dithering: 0.006 })
      const gl = newCanvas.getContext('webgl')
      const resources = new Set()
      for (const type of ['Program', 'Shader', 'Buffer', 'Texture', 'Framebuffer']) {
        const create = gl['create' + type].bind(gl); const remove = gl['delete' + type].bind(gl)
        gl['create' + type] = (...args) => { const value = create(...args); if (value) resources.add(value); return value }
        gl['delete' + type] = value => { resources.delete(value); remove(value) }
      }
      const allocations = []
      const allocate = gl.texImage2D.bind(gl)
      gl.texImage2D = (...args) => { if (args.length === 9) allocations.push([args[3], args[4]]); return allocate(...args) }
      const renderer = window.__backgroundRenderer.createKawarpRenderer(newCanvas)
      if (!renderer) throw new Error('Optimized renderer failed to initialize')
      const initialAllocations = allocations.length
      const referenceGL = oldCanvas.getContext('webgl')
      const debug = gl.getExtension('WEBGL_debug_renderer_info')
      const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
      const paint = variant => {
        const image = document.createElement('canvas')
        image.width = image.height = 256
        const ctx = image.getContext('2d')
        const gradient = ctx.createLinearGradient(0, 0, 220, 256)
        const colors = variant ? ['#fafff0', '#edac19', '#bd19ae', '#010028'] : ['#10273c', '#297c88', '#deb695', '#172d41']
        colors.forEach((color, i) => gradient.addColorStop(i / 3, color))
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, 256, 256)
        ctx.fillStyle = variant ? '#002f48' : '#f7d6a2'; ctx.fillRect(8, 12, 120, 95)
        return image
      }
      const read = (context, width, height) => {
        const data = new Uint8Array(width * height * 4)
        context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, data)
        return data
      }
      const comparisons = []
      const gentleComparisons = []
      const times = [0, 14, 170, 3600]
      const compare = (label, width, height, time, transitioning = false) => {
        oldCanvas.width = width; oldCanvas.height = height
        original.renderFrame(time)
        renderer.draw(width, height, time, transitioning)
        const before = read(referenceGL, width, height)
        const after = read(gl, width, height)
        let sum = 0; let max = 0
        for (let i = 0; i < before.length; i++) {
          const delta = Math.abs(before[i] - after[i])
          sum += delta; max = Math.max(max, delta)
        }
        comparisons.push({ label, width, height, time, mean: sum / before.length, max })
      }
      const compareGentle = (label, width, height, time, transitioning = false, shade = [28, 40, 60, 1]) => {
        // Static retains the former gentle resolution. Compare the final scaled
        // presentation at the application's opacity, including dithering.
        const beforeSize = window.__backgroundOptions.surfaceSize(width, height, 'static')
        const afterSize = window.__backgroundOptions.surfaceSize(width, height, 'gentle')
        oldCanvas.width = beforeSize.width; oldCanvas.height = beforeSize.height
        original.renderFrame(time)
        renderer.setShade(shade)
        renderer.draw(afterSize.width, afterSize.height, time, transitioning, true)
        renderer.setShade([0, 0, 0, 0])
        const sample = document.createElement('canvas')
        sample.width = width; sample.height = height
        const ctx = sample.getContext('2d', { willReadFrequently: true })
        const layer = document.createElement('canvas')
        layer.width = width; layer.height = height
        const layerContext = layer.getContext('2d')
        const readDisplay = surface => {
          layerContext.globalAlpha = 1
          layerContext.drawImage(surface, 0, 0, width, height)
          if (surface === oldCanvas) {
            const gradient = layerContext.createLinearGradient(width * 0.12, 0, width * 1.15, 0)
            // CSS interpolates transparent stops with premultiplied alpha.
            // Canvas gradients need the same RGB at their zero-alpha stop.
            gradient.addColorStop(0, `rgba(${shade.slice(0, 3).join(',')},0)`)
            gradient.addColorStop(1, `rgba(${shade.join(',')})`)
            layerContext.fillStyle = gradient
            layerContext.globalAlpha = 0.1
            layerContext.fillRect(0, 0, width, height)
          }
          ctx.globalAlpha = 1
          ctx.fillStyle = '#172536'; ctx.fillRect(0, 0, width, height)
          ctx.globalAlpha = 0.3
          ctx.drawImage(layer, 0, 0, width, height)
          return ctx.getImageData(0, 0, width, height).data
        }
        const before = readDisplay(oldCanvas)
        const after = readDisplay(newCanvas)
        let sum = 0; let max = 0
        for (let i = 0; i < before.length; i++) {
          const delta = Math.abs(before[i] - after[i])
          sum += delta; max = Math.max(max, delta)
        }
        gentleComparisons.push({ label, width, height, time, mean: sum / before.length, max })
      }
      try {
        for (const variant of [0, 1]) {
          const art = paint(variant)
          original.transitionDuration = 1
          original.loadImageElement(art)
          renderer.setSource(art, 1)
          await new Promise(resolve => setTimeout(resolve, 10))
          for (const [width, height] of [[714, 456], [1440, 921], [456, 714]]) {
            for (const time of times) compare('cover-' + variant, width, height, time)
          }
          for (const [width, height] of [[828, 540], [1708, 1020], [1020, 1708]]) {
            for (const time of times) compareGentle('cover-' + variant, width, height, time)
          }
          compareGentle('light-theme-' + variant, 1708, 1020, 14, false, [245, 250, 238, 1])
          compareGentle('transparent-theme-' + variant, 1708, 1020, 14, false, [245, 250, 238, 0.4])
        }
        // Freeze only the synchronous comparison's transition clock. The same
        // easing and intermediate colors must survive merging the GPU passes.
        const clock = Object.getOwnPropertyDescriptor(performance, 'now')
        let now = 1000
        Object.defineProperty(performance, 'now', { configurable: true, value: () => now })
        try {
          const from = paint(0); const to = paint(1)
          original.transitionDuration = 1200
          original.loadImageElement(from)
          original.loadImageElement(to)
          renderer.setSource(to, 1200, from)
          for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
            now = 1000 + progress * 1200
            compare('transition-' + progress, 714, 456, 14, true)
            compareGentle('transition-' + progress, 1708, 1020, 14, true)
          }
        } finally {
          if (clock) Object.defineProperty(performance, 'now', clock)
          else delete performance.now
        }
        original.transitionDuration = 1
        renderer.finishTransition()
        // Include GPU completion, after warmup; report timing, never assert wall
        // time on busy CI machines. Pixel and allocation budgets are deterministic.
        const timings = {}
        for (const [label, context, draw] of [
          ['before', referenceGL, time => original.renderFrame(time)],
          ['after', gl, time => renderer.draw(1440, 921, time, false)],
          ['gentleBefore', gl, time => renderer.draw(900, 537, time, false)],
          ['gentleAfter', gl, time => renderer.draw(600, 358, time, false, true)],
        ]) {
          oldCanvas.width = 1440; oldCanvas.height = 921
          const pixel = new Uint8Array(4)
          const complete = () => context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel)
          for (let i = 0; i < 4; i++) { draw(i); complete() }
          const samples = []
          for (let i = 0; i < 20; i++) {
            const start = performance.now(); draw(14 + i / 30); complete()
            samples.push(performance.now() - start)
          }
          samples.sort((a, b) => a - b)
          timings[label] = { median: samples[10], p95: samples[19] }
        }
        const errors = [gl.getError(), referenceGL.getError()]
        renderer.dispose()
        return { gpu, comparisons, gentleComparisons, timings, allocations, initialAllocations, remainingResources: resources.size, errors }
      } finally {
        renderer.dispose(); original.dispose()
        gl.getExtension('WEBGL_lose_context')?.loseContext()
        referenceGL.getExtension('WEBGL_lose_context')?.loseContext()
      }
    })
    await fs.writeFile(path.join(fixture.output, 'background-renderer-comparison.json'), JSON.stringify(result, null, 2))
    t.diagnostic(JSON.stringify({ gpu: result.gpu, timings: result.timings, mean: Math.max(...result.comparisons.map(value => value.mean)), max: Math.max(...result.comparisons.map(value => value.max)), output: fixture.output }))
    t.diagnostic(JSON.stringify({ gentleMean: Math.max(...result.gentleComparisons.map(value => value.mean)), gentleMax: Math.max(...result.gentleComparisons.map(value => value.max)) }))
    assert.deepEqual(result.errors, [0, 0])
    assert.equal(result.remainingResources, 0)
    assert.equal(result.allocations.length, result.initialAllocations, 'resize must not allocate intermediate textures')
    assert(result.initialAllocations >= 4 && result.initialAllocations <= 8, 'only four small surfaces, including optional format fallback')
    assert(result.allocations.every(([width, height]) => width <= 128 && height <= 128))
    for (const comparison of result.comparisons) {
      assert(comparison.mean < 0.1, JSON.stringify(comparison))
      assert(comparison.max <= 2, JSON.stringify(comparison))
    }
    for (const comparison of result.gentleComparisons) {
      assert(comparison.mean < 0.2, JSON.stringify(comparison))
      assert(comparison.max <= 2, JSON.stringify(comparison))
    }
    assert.deepEqual(fixture.errors, [])
  } finally { await fixture.app.close() }
})
