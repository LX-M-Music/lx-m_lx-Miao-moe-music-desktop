const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled, seedTrack, seedLyrics, showDetail } = require('./helpers/motion-fixture.cjs')

const options = { rendererPath: path.resolve('dist/index.html'), disableHardwareAcceleration: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-backgrounding-occluded-windows'] }
const main = '[data-ambient-background="shared"]'
const update = (page, setting) => page.evaluate(setting => window.lxData.updateSetting(setting), setting)
const state = (page, selector, value) => page.waitForFunction(({ selector, value }) => document.querySelector(selector)?.dataset.ambientState === value, { selector, value })
const backend = (page, value) => page.waitForFunction(({ main, value }) => document.querySelector(main)?.dataset.ambientRenderer === value, { main, value })
const count = (page, selector) => page.locator(selector + ' canvas').evaluate(canvas => canvas.__kawarpProbe?.count ?? 0)
const visual = main + ' > div'
const fallback = visual + ' > div:first-child'
const openSettings = async page => {
  await showDetail(page, false)
  await settled(page)
  await route(page, '/setting?name=SettingAdvanced')
  const title = await page.evaluate(() => window.i18n.t('setting__advanced'))
  await page.getByRole('tab', { name: title, exact: true }).click()
  await page.locator('#setting_advanced_background_enabled').waitFor({ state: 'attached' })
}
const startAudio = async page => {
  const rate = 8000
  const samples = rate * 60
  const bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(rate, 24)
  bytes.writeUInt32LE(rate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(samples * 2, 40)
  // Silent audio advances the real player clock without connecting an analyser.
  await page.evaluate(async src => {
    const player = window.__lxPluginHost.player
    player.setResource(src)
    player.setLoopPlay(true)
    player.getAudioElement().muted = true
    await player.getAudioElement().play()
  }, 'data:audio/wav;base64,' + bytes.toString('base64'))
}
const cover = (page, color) => page.evaluate(color => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${color}"/></svg>`
  window.lxData.musicInfo.pic = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}, color)
const dominant = (page, channel, selector = main) => page.waitForFunction(({ selector, channel }) => {
  const canvas = document.querySelector(selector + ' canvas')
  const gl = canvas.getContext('webgl')
  const pixel = new Uint8Array(4)
  gl.readPixels(canvas.width >> 1, canvas.height >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
  return pixel[channel] > 150 && pixel[channel === 0 ? 2 : 0] < 100
}, { selector, channel })

test('Kawarp replaces the old effects, follows artwork without analysing audio, and releases resources', { timeout: 180000 }, async t => {
  let fixture = await launch(options)
  const output = fixture.output
  let { app, page } = fixture
  page.setDefaultTimeout(12000)
  try {
    await page.evaluate(() => {
      window.__kawarpShaderErrors = []
      window.__kawarpAudioAnalysers = 0
      window.__kawarpPrograms = new Set()
      const createAnalyser = AudioContext.prototype.createAnalyser
      AudioContext.prototype.createAnalyser = function() { window.__kawarpAudioAnalysers++; return createAnalyser.call(this) }
      const prototype = WebGLRenderingContext.prototype
      const compile = prototype.compileShader
      prototype.compileShader = function(shader) {
        compile.call(this, shader)
        if (!this.getShaderParameter(shader, this.COMPILE_STATUS)) window.__kawarpShaderErrors.push(this.getShaderInfoLog(shader))
      }
      const create = prototype.createProgram
      prototype.createProgram = function() {
        const program = create.call(this)
        if (this.canvas.closest('[data-ambient-background]')) window.__kawarpPrograms.add(program)
        return program
      }
      const remove = prototype.deleteProgram
      prototype.deleteProgram = function(program) { window.__kawarpPrograms.delete(program); return remove.call(this, program) }
      const upload = prototype.texImage2D
      prototype.texImage2D = function(...args) {
        if (this.canvas.closest('[data-ambient-background]')) this.canvas.__kawarpUploads = (this.canvas.__kawarpUploads ?? 0) + 1
        return upload.apply(this, args)
      }
      for (const method of ['drawArrays', 'drawElements']) {
        const draw = prototype[method]
        prototype[method] = function(...args) {
          // Count only output frames, excluding the artwork's small blur buffers.
          if (!this.isContextLost() && this.canvas.closest('[data-ambient-background]') && !this.getParameter(this.FRAMEBUFFER_BINDING)) {
            const sample = this.canvas.__kawarpProbe ??= { count: 0 }
            const program = this.getParameter(this.CURRENT_PROGRAM)
            const uniform = name => this.getUniform(program, this.getUniformLocation(program, name))
            sample.count++
            sample.time = uniform('u_time')
          }
          return draw.apply(this, args)
        }
      }
    })
    await t.test('Advanced keeps its switch and quality with no background-style or music-response controls', async() => {
      await openSettings(page)
      assert.equal(await page.locator('#setting_advanced_background_enabled').isChecked(), true)
      assert.equal(await page.locator('#setting_advanced_background_only_play_detail').isChecked(), false)
      assert.equal(await page.locator('#setting_advanced_background_music').count(), 0)
      assert.equal(await page.locator('#setting_advanced_background_style').count(), 0)
      assert.equal(await page.evaluate(() => Object.hasOwn(window.lxData.appSetting, 'ui.ambientBackgroundMusic')), false)
      assert.equal(await page.evaluate(() => Object.hasOwn(window.lxData.appSetting, 'ui.ambientBackgroundStyle')), false)
      await page.locator('label[for="setting_advanced_background_enabled"]').click()
      await page.locator(main).waitFor({ state: 'detached' })
      assert.notEqual(await page.locator('#view > [data-motion-outlet]').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)')
      await page.locator('label[for="setting_advanced_background_enabled"]').click()
      await backend(page, 'kawarp')
      await state(page, main, 'static')
      assert.equal(await page.evaluate(() => window.__kawarpPrograms.size), 2)
      assert.deepEqual(await page.evaluate(() => window.__kawarpShaderErrors), [])
      await page.locator('#setting_advanced_background_quality').selectOption('full')
    })
    await seedTrack(page)
    await page.evaluate(() => {
      window.lxData.musicInfo.lrc = '[00:00.00]Kawarp background check\n[00:01.00]Artwork flow'
      window.app_event.lyricUpdated()
    })
    await startAudio(page)
    await state(page, main, 'playing')
    await t.test('one continuous background covers sidebar, search and bottom player', async() => {
      const coverage = await page.evaluate(main => {
        const background = document.querySelector(main).getBoundingClientRect()
        const area = selector => {
          const element = document.querySelector(selector)
          const bounds = element.getBoundingClientRect()
          return { inside: bounds.left >= background.left && bounds.right <= background.right && bounds.top >= background.top && bounds.bottom <= background.bottom, color: getComputedStyle(element).backgroundColor }
        }
        return { left: area('#left'), right: area('#right'), player: area('#player'), playerOverlay: getComputedStyle(document.querySelector('#player'), '::before').backgroundColor, search: getComputedStyle(document.querySelector('#container')).getPropertyValue('--setting-search-background').trim() }
      }, main)
      for (const key of ['left', 'right', 'player']) assert.equal(coverage[key].inside, true, key)
      assert.equal(coverage.right.color, 'rgba(0, 0, 0, 0)')
      assert.equal(coverage.playerOverlay, 'rgba(0, 0, 0, 0)')
      assert(['transparent', '#0000'].includes(coverage.search))
      await page.screenshot({ path: path.join(output, 'kawarp-settings.png') })
    })
    await t.test('home and lyrics share the same canvas, context and running clock without reloading artwork', async() => {
      const before = await page.locator(main + ' canvas').evaluate(canvas => {
        window.__sharedBackgroundCanvas = canvas
        window.__sharedBackgroundContext = canvas.getContext('webgl')
        return { time: canvas.__kawarpProbe.time, uploads: canvas.__kawarpUploads }
      })
      await showDetail(page, true)
      await settled(page)
      await seedLyrics(page)
      await state(page, main, 'playing')
      const shared = await page.locator(main + ' canvas').evaluate(canvas => ({
        canvas: canvas === window.__sharedBackgroundCanvas,
        context: canvas.getContext('webgl') === window.__sharedBackgroundContext,
        time: canvas.__kawarpProbe.time,
        uploads: canvas.__kawarpUploads,
      }))
      assert.equal(await page.locator('[data-ambient-background] canvas').count(), 1)
      assert.equal(await page.evaluate(() => window.__kawarpPrograms.size), 2)
      assert.equal(shared.canvas, true)
      assert.equal(shared.context, true)
      assert.equal(shared.uploads, before.uploads)
      assert(shared.time > before.time)
      assert.equal(await page.locator('[data-player-detail]').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)')
      assert.equal(await page.locator('[data-player-detail] > div').first().evaluate(element => getComputedStyle(element).display), 'none')
      for (const selector of ['#left', '#right']) {
        assert.equal(await page.locator(selector).evaluate(element => getComputedStyle(element).opacity), '0')
        assert.equal(await page.locator(selector).evaluate(element => element.inert), true)
      }
      await page.screenshot({ path: path.join(output, 'kawarp-album-cover.png') })
      for (const [color, channel] of [['#d92c38', 0], ['#2844ce', 2]]) {
        await cover(page, color)
        await dominant(page, channel, main)
      }
      const uploads = await page.locator(main + ' canvas').evaluate(canvas => canvas.__kawarpUploads)
      for (const opened of [false, true, false, true]) {
        const clock = await page.locator(main + ' canvas').evaluate(canvas => canvas.__kawarpProbe.time)
        await showDetail(page, opened)
        await settled(page)
        await state(page, main, 'playing')
        assert.equal(await page.locator('[data-ambient-background] canvas').count(), 1)
        assert.equal(await page.locator(main + ' canvas').evaluate(canvas => canvas === window.__sharedBackgroundCanvas && canvas.getContext('webgl') === window.__sharedBackgroundContext), true)
        assert.equal(await page.locator(main + ' canvas').evaluate(canvas => canvas.__kawarpUploads), uploads)
        assert(await page.locator(main + ' canvas').evaluate((canvas, before) => canvas.__kawarpProbe.time > before, clock))
        for (const selector of ['#left', '#right']) {
          assert.equal(await page.locator(selector).evaluate(element => getComputedStyle(element).opacity), opened ? '0' : '1')
          assert.equal(await page.locator(selector).evaluate(element => element.inert), opened)
        }
      }
    })
    await t.test('static quality refreshes changed page shading once, stays stopped, and still supports playback', async() => {
      await update(page, { 'ui.ambientBackgroundQuality': 'static' })
      await state(page, main, 'static')
      const snapshot = page.locator(main + ' [data-ambient-snapshot]')
      await snapshot.waitFor()
      const snapshotUrl = await snapshot.getAttribute('src')
      assert.equal(await page.locator(main + ' canvas').isHidden(), true, 'static frames must leave WebGL compositing')
      const difference = await snapshot.evaluate(async image => {
        await image.decode()
        const source = image.parentElement.querySelector('canvas')
        const sample = document.createElement('canvas')
        sample.width = source.width
        sample.height = source.height
        const ctx = sample.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(source, 0, 0)
        const live = ctx.getImageData(0, 0, sample.width, sample.height).data
        ctx.clearRect(0, 0, sample.width, sample.height)
        ctx.drawImage(image, 0, 0)
        const still = ctx.getImageData(0, 0, sample.width, sample.height).data
        let max = 0
        for (let i = 0; i < live.length; i++) max = Math.max(max, Math.abs(live[i] - still[i]))
        return max
      })
      assert.equal(difference, 0, 'the cached image must preserve every rendered pixel')
      const uploads = await page.locator(main + ' canvas').evaluate(canvas => canvas.__kawarpUploads)
      for (const opened of [false, true]) {
        const before = await count(page, main)
        const previousSnapshot = await snapshot.getAttribute('src')
        await showDetail(page, opened)
        await settled(page)
        // Detail always uses its dark surface; changing screens must repaint
        // that shading once, then return to a stopped, decoded PNG.
        assert.equal(await count(page, main), before + 1)
        const after = await count(page, main)
        await page.waitForTimeout(200)
        assert.equal(await count(page, main), after, 'exit cleanup must not redraw or resume polling')
        assert.equal(await page.locator(main + ' canvas').evaluate(canvas => canvas.__kawarpUploads), uploads)
        assert.equal(await page.locator(main + ' canvas').evaluate(canvas => canvas === window.__sharedBackgroundCanvas), true)
        assert.notEqual(await snapshot.getAttribute('src'), previousSnapshot, 'cache the single frame with the new surface shading')
        assert.equal(await page.locator(main + ' canvas').isHidden(), true)
      }
      const win = await app.browserWindow(page)
      const bounds = await win.evaluate(win => win.getBounds())
      try {
        await win.evaluate((win, bounds) => win.setSize(bounds.width + 64, bounds.height + 32), bounds)
        await page.waitForFunction(({ main, snapshotUrl }) => {
          const image = document.querySelector(main + ' [data-ambient-snapshot]')
          const canvas = document.querySelector(main + ' canvas')
          return image?.src !== snapshotUrl && image?.complete && image.naturalWidth === canvas.width && image.naturalHeight === canvas.height && canvas.hidden
        }, { main, snapshotUrl })
      } finally {
        await win.evaluate((win, bounds) => win.setBounds(bounds), bounds)
        await win.dispose()
      }
      await update(page, { 'ui.ambientBackgroundQuality': 'gentle' })
      await state(page, main, 'playing')
      await snapshot.waitFor({ state: 'detached' })
      assert.equal(await page.locator(main + ' canvas').isVisible(), true)
      await page.evaluate(() => window.__lxPluginHost.player.setPause())
      await state(page, main, 'static')
      await snapshot.waitFor()
      const paused = await count(page, main)
      await page.waitForTimeout(200)
      assert.equal(await count(page, main), paused)
      await page.evaluate(() => window.__lxPluginHost.player.setPlay())
      await state(page, main, 'playing')
    })
    await t.test('the merged gradient follows theme changes in static mode without adaptive controls', async() => {
      await showDetail(page, false)
      await settled(page)
      await update(page, { 'ui.ambientBackgroundQuality': 'static', 'ui.ambientBackgroundAutoContrast': false })
      const snapshot = page.locator(main + ' [data-ambient-snapshot]')
      await snapshot.waitFor()
      const previous = await snapshot.getAttribute('src')
      const themeCSS = await page.evaluate(() => window.dom_style.textContent)
      try {
        await page.evaluate(() => window.dom_style.appendChild(document.createTextNode(':root { --color-content-background: rgba(250, 245, 238, 0.4); }')))
        await page.waitForFunction(({ main, previous }) => {
          const image = document.querySelector(main + ' [data-ambient-snapshot]')
          return image?.complete && image.src !== previous
        }, { main, previous })
        const shade = await page.locator(main + ' canvas').evaluate(canvas => {
          const gl = canvas.getContext('webgl')
          const program = gl.getParameter(gl.CURRENT_PROGRAM)
          return Array.from(gl.getUniform(program, gl.getUniformLocation(program, 'u_shade')))
        })
        const expected = [250 / 255, 245 / 255, 238 / 255, 0.04]
        shade.forEach((value, index) => assert(Math.abs(value - expected[index]) < 1e-6))
        assert.equal(await page.locator(main + ' > div > div').count(), 1, 'only the hidden fallback remains, without another full-window gradient')
      } finally {
        await page.evaluate(css => { window.dom_style.textContent = css }, themeCSS)
        await update(page, { 'ui.ambientBackgroundQuality': 'gentle' })
      }
    })
    await t.test('window visibility and app switches control rendering independently of system preferences', async() => {
      const win = await app.browserWindow(page)
      try {
        await win.evaluate(win => win.minimize())
        await state(page, main, 'hidden')
        const before = await count(page, main)
        await page.waitForTimeout(200)
        assert.equal(await count(page, main), before)
        await win.evaluate(win => { win.restore(); win.showInactive() })
        await state(page, main, 'playing')
        await win.evaluate(win => win.hide())
        await state(page, main, 'hidden')
        await win.evaluate(win => win.showInactive())
        await state(page, main, 'playing')
      } finally { await win.evaluate(win => { win.restore(); win.showInactive() }); await win.dispose() }
      await update(page, { 'common.isShowAnimation': false })
      await state(page, main, 'static')
      await update(page, { 'common.isShowAnimation': true })
      await state(page, main, 'playing')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const moving = await count(page, main)
      await page.waitForTimeout(200)
      await state(page, main, 'playing')
      assert(await count(page, main) > moving)
      await update(page, { 'ui.smoothAnimation': false })
      await state(page, main, 'static')
      const before = await count(page, main)
      await page.waitForTimeout(200)
      assert.equal(await count(page, main), before)
      await update(page, { 'ui.smoothAnimation': true })
      await state(page, main, 'playing')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await state(page, main, 'playing')
    })
    await t.test('4K stays bounded and changing artwork updates the actual rendered colors', async() => {
      await openSettings(page)
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      await page.setViewportSize({ width: 3840, height: 2160 })
      await page.waitForTimeout(250)
      const dimensions = await page.locator(main + ' canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height }))
      assert(Math.max(dimensions.width, dimensions.height) <= 900)
      await page.setViewportSize(viewport)
      for (const [color, channel] of [['#d92c38', 0], ['#2844ce', 2]]) { await cover(page, color); await dominant(page, channel) }
      // Cover changes must finish even when there is no animation loop.
      await update(page, { 'ui.ambientBackgroundQuality': 'static' })
      await cover(page, '#d92c38')
      await dominant(page, 0)
      await state(page, main, 'static')
    })
    await t.test('a pending cover keeps the previous background and interrupted crossfades continue from the visible colors', async() => {
      await update(page, { 'ui.ambientBackgroundQuality': 'gentle' })
      await page.evaluate(() => window.__lxPluginHost.player.setPause())
      await cover(page, '#d92c38')
      await state(page, main, 'static')
      await dominant(page, 0)
      const heldSnapshot = page.locator(main + ' [data-ambient-snapshot]')
      await heldSnapshot.waitFor()
      const heldUrl = await heldSnapshot.getAttribute('src')
      let begin
      let finish
      let requests = 0
      const started = new Promise(resolve => { begin = resolve })
      const gate = new Promise(resolve => { finish = resolve })
      await page.route('https://kawarp-artwork.test/transition-blue.svg', async route => {
        requests++
        begin()
        await gate
        await route.fulfill({ contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#2844ce"/></svg>' }).catch(() => {})
      })
      try {
        await page.evaluate(() => { window.lxData.musicInfo.pic = 'https://kawarp-artwork.test/transition-blue.svg' })
        await started
        await page.waitForTimeout(200)
        assert.equal(await heldSnapshot.isVisible(), true)
        assert.equal(await heldSnapshot.getAttribute('src'), heldUrl, 'pending artwork must keep the cached frame')
        assert.equal(await page.locator(visual).evaluate(element => Number(getComputedStyle(element).opacity)), 1)
        await dominant(page, 0)
        assert.equal(requests, 1, 'background and player share the same cover download')
        finish()
        await page.waitForFunction(main => {
          const canvas = document.querySelector(main + ' canvas')
          const gl = canvas.getContext('webgl')
          const value = new Uint8Array(4)
          gl.readPixels(canvas.width >> 1, canvas.height >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value)
          return value[0] > 90 && value[2] > 90
        }, main)
        // Sample and interrupt in the same browser task so remote calls cannot
        // advance the old fade before the new cover is actually requested.
        const { before, after } = await page.evaluate(async main => {
          const canvas = document.querySelector(main + ' canvas')
          const gl = canvas.getContext('webgl')
          const sample = () => {
            // Artwork uploads can leave an offscreen blur target bound between frames.
            const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING)
            gl.bindFramebuffer(gl.FRAMEBUFFER, null)
            const value = new Uint8Array(4)
            gl.readPixels(canvas.width >> 1, canvas.height >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value)
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
            return [...value]
          }
          const before = sample()
          const frames = canvas.__kawarpProbe.count
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#28ce44"/></svg>'
          window.lxData.musicInfo.pic = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
          const after = await new Promise(resolve => {
            const nextFrame = () => {
              if (canvas.__kawarpProbe.count > frames) resolve(sample())
              else requestAnimationFrame(nextFrame)
            }
            requestAnimationFrame(nextFrame)
          })
          return { before, after }
        }, main)
        for (let channel = 0; channel < 3; channel++) assert(Math.abs(after[channel] - before[channel]) < 35, `color jumped: ${before} -> ${after}`)
        await dominant(page, 1)
        await state(page, main, 'static')
      } finally { finish() }
    })
    await t.test('a song without a cover fades back to the theme and a new cover fades in', async() => {
      await page.evaluate(() => { window.lxData.musicInfo.pic = null })
      await page.waitForFunction(visual => {
        const opacity = Number(getComputedStyle(document.querySelector(visual)).opacity)
        return opacity > 0.2 && opacity < 0.8
      }, visual)
      assert.equal(await page.locator(main + ' canvas').isVisible(), true)
      await state(page, main, 'static')
      assert.equal(await page.locator(visual).evaluate(element => Number(getComputedStyle(element).opacity)), 0)
      assert.equal(await page.locator(main + ' canvas').isHidden(), true)
      await cover(page, '#2844ce')
      await page.waitForFunction(visual => {
        const opacity = Number(getComputedStyle(document.querySelector(visual)).opacity)
        return opacity > 0.2 && opacity < 0.8
      }, visual)
      await state(page, main, 'static')
      await dominant(page, 2)
      await page.evaluate(() => window.__lxPluginHost.player.setPlay())
      await state(page, main, 'playing')
    })
    await t.test('rapid track changes discard slow artwork and missing covers reveal the theme without drawing', async() => {
      let began
      let finish
      const loading = new Promise(resolve => { began = resolve })
      const release = new Promise(resolve => { finish = resolve })
      await page.route('https://kawarp-artwork.test/slow.svg', async route => {
        began()
        await release
        await route.fulfill({ contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>' }).catch(() => {})
      })
      await page.evaluate(() => { window.lxData.musicInfo.pic = 'https://kawarp-artwork.test/slow.svg' })
      await loading
      await cover(page, '#2844ce')
      await dominant(page, 2)
      finish()
      await page.waitForTimeout(250)
      await dominant(page, 2)
      await update(page, { 'ui.ambientBackgroundQuality': 'gentle' })
      await state(page, main, 'playing')
      await page.route('https://kawarp-artwork.test/missing.png', route => route.fulfill({ status: 404, body: '' }))
      await page.evaluate(() => { window.lxData.musicInfo.pic = 'https://kawarp-artwork.test/missing.png' })
      await page.waitForFunction(fallback => !document.querySelector(fallback).style.backgroundImage, fallback)
      await state(page, main, 'static')
      assert.equal(await page.locator(main).getAttribute('data-ambient-renderer'), 'kawarp')
      assert.equal(await page.locator(main + ' canvas').isHidden(), true)
      assert.equal(await page.locator(fallback).evaluate(element => getComputedStyle(element).backgroundImage), 'none')
      const before = await count(page, main)
      await page.waitForTimeout(250)
      assert.equal(await count(page, main), before)
      await cover(page, '#2844ce')
      await dominant(page, 2)
      await state(page, main, 'playing')
    })
    await t.test('context loss falls back and restoration recovers the current cover', async() => {
      await page.locator(main + ' canvas').evaluate(canvas => {
        window.__kawarpLost = canvas.getContext('webgl').getExtension('WEBGL_lose_context')
        window.__kawarpLost.loseContext()
      })
      await backend(page, 'fallback')
      await state(page, main, 'static')
      await page.evaluate(() => window.__kawarpLost.restoreContext())
      await backend(page, 'kawarp')
      await state(page, main, 'playing')
      assert.deepEqual(await page.evaluate(() => window.__kawarpShaderErrors), [])
    })
    await t.test('detail-only mode restores normal pages and releases rendering and adaptive colors on every exit', async() => {
      await openSettings(page)
      await update(page, { 'ui.ambientBackground': false })
      await page.locator(main).waitFor({ state: 'detached' })
      const normalColors = () => page.evaluate(async() => {
        const right = document.querySelector('#right')
        await Promise.allSettled(right.getAnimations().map(animation => animation.finished))
        return [
          getComputedStyle(right).backgroundColor,
          getComputedStyle(document.querySelector('#player'), '::before').backgroundColor,
          getComputedStyle(document.querySelector('#setting_advanced_background_enabled + label')).color,
        ]
      })
      const expectedColors = await normalColors()
      await update(page, { 'ui.ambientBackground': true, 'ui.ambientBackgroundAutoContrast': true })
      await page.locator('#root[data-ambient-controls]').waitFor()
      await page.locator('label[for="setting_advanced_background_only_play_detail"]').click()
      await page.locator(main).waitFor({ state: 'detached' })
      const expectNormalPage = async() => {
        assert.equal(await page.locator('#container[data-ambient-enabled], #root[data-ambient-controls], [data-ambient-zone]').count(), 0)
        assert.equal(await page.evaluate(() => window.__kawarpPrograms.size), 0)
        assert.deepEqual(await normalColors(), expectedColors)
      }
      await expectNormalPage()
      for (const [color, channel] of [['#d92c38', 0], ['#2844ce', 2]]) {
        await cover(page, color)
        assert.equal(await page.locator(main).count(), 0, 'changing covers outside detail must not start rendering')
        await showDetail(page, true)
        await settled(page)
        await state(page, main, 'playing')
        await dominant(page, channel)
        assert.equal(await page.locator('[data-ambient-background] canvas').count(), 1)
        assert.equal(await page.evaluate(() => window.__kawarpPrograms.size), 2)
        await page.locator('#root[data-ambient-controls]').waitFor()
        assert.equal(await page.locator('[data-player-detail] [data-ambient-lyrics]').count(), 1)
        await showDetail(page, false)
        await settled(page)
        await page.locator(main).waitFor({ state: 'detached' })
        await expectNormalPage()
      }
      await showDetail(page, true)
      await state(page, main, 'playing')
      await update(page, { 'ui.ambientBackground': false })
      await page.locator(main).waitFor({ state: 'detached' })
      await expectNormalPage()
      await update(page, { 'ui.ambientBackground': true })
      await state(page, main, 'playing')
      await openSettings(page)
      await page.locator(main).waitFor({ state: 'detached' })
      await page.locator('label[for="setting_advanced_background_only_play_detail"]').click()
      await state(page, main, 'playing')
      await update(page, { 'ui.ambientBackgroundAutoContrast': false })
    })
    await t.test('turning off releases all programs, no WebGL stays usable, and no analyser was created', async() => {
      await openSettings(page)
      await update(page, { 'ui.ambientBackground': false })
      await page.locator(main).waitFor({ state: 'detached' })
      assert.equal(await page.evaluate(() => window.__kawarpPrograms.size), 0)
      assert.equal(await page.evaluate(() => window.__kawarpAudioAnalysers), 0)
      await page.evaluate(() => {
        window.__kawarpGetContext = HTMLCanvasElement.prototype.getContext
        HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl' ? null : window.__kawarpGetContext.call(this, type, ...args) }
      })
      await update(page, { 'ui.ambientBackground': true })
      await backend(page, 'fallback')
      await state(page, main, 'static')
      assert.equal(await page.locator('#setting_advanced_background_quality').isEnabled(), true)
      await page.waitForFunction(fallback => document.querySelector(fallback).style.backgroundImage.startsWith('url("data:image/png'), fallback)
      await cover(page, '#d92c38')
      await page.waitForFunction(visual => {
        const previous = document.querySelector(visual + ' > div:nth-child(2)')
        const opacity = previous && Number(getComputedStyle(previous).opacity)
        return previous?.style.backgroundImage && opacity > 0.2 && opacity < 0.8
      }, visual)
      await state(page, main, 'static')
      await page.screenshot({ path: path.join(output, 'kawarp-fallback.png') })
      await page.evaluate(() => { HTMLCanvasElement.prototype.getContext = window.__kawarpGetContext })
    })
    await t.test('detail-only scope, quality and explicit opt-out survive a restart while obsolete style settings are discarded', async() => {
      await openSettings(page)
      await page.locator('#setting_advanced_background_quality').selectOption('static')
      await page.locator('label[for="setting_advanced_background_only_play_detail"]').click()
      await page.waitForFunction(() => window.lxData.appSetting['ui.ambientBackgroundOnlyPlayDetail'] === true)
      await page.locator('label[for="setting_advanced_background_enabled"]').click()
      // Detail-only mode already detached the canvas on this page. Wait for the
      // saved setting acknowledgement before reading the durable configuration.
      await page.waitForFunction(() => window.lxData.appSetting['ui.ambientBackground'] === false)
      await page.locator(main).waitFor({ state: 'detached' })
      const configPath = path.join(output, 'portable/userData/LxDatas/config_v2.json')
      const config = JSON.parse(await fs.readFile(configPath, 'utf8')).setting
      assert.equal(config['ui.ambientBackground'], false)
      assert.equal(config['ui.ambientBackgroundOnlyPlayDetail'], true)
      assert.equal(Object.hasOwn(config, 'ui.ambientBackgroundStyle'), false)
      assert.equal(config['ui.ambientBackgroundQuality'], 'static')
      assert.deepEqual(fixture.errors, [])
      await app.close()
      const saved = JSON.parse(await fs.readFile(configPath, 'utf8'))
      saved.setting['ui.ambientBackgroundStyle'] = 'silk'
      await fs.writeFile(configPath, JSON.stringify(saved))
      fixture = await launch({ ...options, profilePath: output, initializeMotion: false })
      ;({ app, page } = fixture)
      await openSettings(page)
      assert.equal(await page.locator('#setting_advanced_background_enabled').isChecked(), false)
      assert.equal(await page.locator(main).count(), 0)
      await page.locator('label[for="setting_advanced_background_enabled"]').click()
      assert.equal(await page.locator('#setting_advanced_background_style').count(), 0)
      assert.equal(await page.evaluate(() => Object.hasOwn(window.lxData.appSetting, 'ui.ambientBackgroundStyle')), false)
      assert.equal(await page.locator('#setting_advanced_background_quality').inputValue(), 'static')
      assert.equal(await page.locator('#setting_advanced_background_only_play_detail').isChecked(), true)
      assert.equal(await page.locator(main).count(), 0)
      await seedTrack(page)
      await showDetail(page, true)
      await state(page, main, 'static')
    })
    assert.deepEqual(fixture.errors, [])
    console.log('Kawarp background previews:', output)
  } catch (error) {
    console.error('Kawarp background profile:', output, 'Renderer errors:', fixture.errors)
    await page.screenshot({ path: path.join(output, 'kawarp-failure.png') }).catch(() => {})
    throw error
  } finally { await fixture.app.close().catch(() => {}) }
})
