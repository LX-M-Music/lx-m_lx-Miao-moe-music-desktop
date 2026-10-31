const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const ts = require('typescript')
const { test } = require('node:test')
const { launch } = require('./helpers/motion-fixture.cjs')

test('the flow renderer keeps a tiny bounded surface and animates three blurred layers', { timeout: 120000 }, async t => {
  const fixture = await launch({
    rendererPath: path.resolve('dist/index.html'),
    disableHardwareAcceleration: false,
    args: process.env.LX_BACKGROUND_SOFTWARE ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  try {
    const { page } = fixture
    await page.evaluate(() => window.lxData.updateSetting({ 'ui.ambientBackground': false }))
    for (const name of ['shaders', 'options', 'renderer']) {
      const source = await fs.readFile(path.resolve(`src/renderer/utils/kawarpBackground/${name}.ts`), 'utf8')
      const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
      await page.addScriptTag({ content: `(() => { const exports = {}; const require = () => window.__backgroundShaders; ${code}\nwindow.${name === 'shaders' ? '__backgroundShaders' : name === 'options' ? '__backgroundOptions' : '__backgroundRenderer'} = exports })()` })
    }
    const result = await page.evaluate(async() => {
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 360
      const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'low-power' })
      const resources = new Set()
      let programs = 0
      for (const type of ['Program', 'Shader', 'Buffer', 'Texture', 'Framebuffer']) {
        const create = gl['create' + type].bind(gl)
        const remove = gl['delete' + type].bind(gl)
        gl['create' + type] = (...args) => {
          const value = create(...args)
          if (value) {
            resources.add(value)
            if (type === 'Program') programs++
          }
          return value
        }
        gl['delete' + type] = value => { resources.delete(value); remove(value) }
      }
      const allocations = []
      const allocate = gl.texImage2D.bind(gl)
      gl.texImage2D = (...args) => {
        if (args.length === 9) allocations.push([args[3], args[4]])
        return allocate(...args)
      }
      const renderer = window.__backgroundRenderer.createKawarpRenderer(canvas)
      if (!renderer) throw new Error('Flow renderer failed to initialize')
      const paint = (colors, shape) => {
        const image = document.createElement('canvas')
        image.width = image.height = 256
        const ctx = image.getContext('2d')
        const gradient = ctx.createLinearGradient(0, 0, 220, 256)
        colors.forEach((color, index) => gradient.addColorStop(index / (colors.length - 1), color))
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, 256, 256)
        if (shape) {
          ctx.fillStyle = shape
          ctx.beginPath()
          ctx.arc(80, 90, 52, 0, Math.PI * 2)
          ctx.fill()
        }
        return image
      }
      const read = () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        const pixel = new Uint8Array(4)
        gl.readPixels(canvas.width >> 1, canvas.height >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
        return [...pixel]
      }
      const readSample = () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        const width = 96
        const height = 54
        const data = new Uint8Array(width * height * 4)
        gl.readPixels((canvas.width - width) >> 1, (canvas.height - height) >> 1, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data)
        return [...data]
      }
      const dark = paint(['#10273c', '#297c88', '#deb695', '#172d41'])
      renderer.setSource(dark, 1)
      await new Promise(resolve => setTimeout(resolve, 20))
      const times = [0, 8, 30, 120]
      const frames = []
      for (const time of times) {
        renderer.draw(640, 360, time, false)
        frames.push(readSample())
      }
      const initialAllocations = allocations.length
      // Resizing must reuse the same surfaces; only source uploads can happen
      // afterwards, and those are not 9-argument allocations.
      for (const [width, height] of [[640, 360], [560, 315], [768, 432], [480, 270]]) {
        renderer.draw(width, height, 40, false)
      }
      const resizedAllocations = allocations.length

      const red = paint(['#d92c38', '#d92c38'])
      renderer.setSource(red, 1)
      await new Promise(resolve => setTimeout(resolve, 20))
      renderer.draw(640, 360, 14, false)
      const redPixel = read()
      const blue = paint(['#2844ce', '#2844ce'])
      renderer.setSource(blue, 1)
      await new Promise(resolve => setTimeout(resolve, 20))
      renderer.draw(640, 360, 14, false)
      const bluePixel = read()

      const clock = Object.getOwnPropertyDescriptor(performance, 'now')
      let now = 1000
      Object.defineProperty(performance, 'now', { configurable: true, value: () => now })
      const transitionPixels = []
      try {
        renderer.setSource(blue, 1200, red)
        for (const progress of [0, 0.5, 1]) {
          now = 1000 + progress * 1200
          renderer.draw(640, 360, 14 + progress, progress < 1)
          transitionPixels.push(read())
        }
      } finally {
        if (clock) Object.defineProperty(performance, 'now', clock)
        else delete performance.now
      }
      renderer.finishTransition()
      const errors = [gl.getError()]
      renderer.dispose()
      return {
        programs,
        initialAllocations,
        resizedAllocations,
        allocations,
        remainingResources: resources.size,
        frames,
        redPixel,
        bluePixel,
        transitionPixels,
        errors,
      }
    })
    await fs.writeFile(path.join(fixture.output, 'flow-renderer.json'), JSON.stringify(result, null, 2))
    t.diagnostic(JSON.stringify({ programs: result.programs, allocations: result.initialAllocations, red: result.redPixel, blue: result.bluePixel, transition: result.transitionPixels, output: fixture.output }))

    assert.equal(result.programs, 2)
    assert.equal(result.resizedAllocations, result.initialAllocations, 'resizing must reuse surfaces')
    assert(result.initialAllocations >= 10 && result.initialAllocations <= 14, 'two tiny mip chains plus sources')
    assert(result.allocations.every(([width, height]) => width <= 128 && height <= 128))
    const bytes = result.allocations.reduce((sum, [width, height]) => sum + width * height * 4, 0)
    assert(bytes < 1024 * 1024, `GPU surfaces must stay under 1 MiB, got ${bytes}`)
    assert.equal(result.remainingResources, 0)
    assert.deepEqual(result.errors, [0])
    assert(result.redPixel[0] > 120 && result.redPixel[0] > result.redPixel[2] + 40, JSON.stringify(result.redPixel))
    assert(result.bluePixel[2] > 100 && result.bluePixel[2] > result.bluePixel[0] + 30, JSON.stringify(result.bluePixel))
    // The flow clock is continuous: distant times must not be pixel-identical.
    const distance = (a, b) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0)
    assert(distance(result.frames[0], result.frames[3]) > 50, 'flow must move a visible sample of the frame')
    assert(distance(result.transitionPixels[0], result.transitionPixels[2]) > 40, JSON.stringify(result.transitionPixels))
    assert(distance(result.transitionPixels[0], result.transitionPixels[1]) > 10, JSON.stringify(result.transitionPixels))
    assert.deepEqual(fixture.errors, [])
  } finally { await fixture.app.close() }
})
