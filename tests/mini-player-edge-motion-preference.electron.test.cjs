const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, seedTrack } = require('./helpers/motion-fixture.cjs')

test('explicit mini-player animation works in real time with system reduced motion enabled', { timeout: 45000 }, async() => {
  const liveDev = process.env.LX_TEST_LIVE_DEV === '1'
  const fixture = await launch({
    hidden: true,
    rendererPath: liveDev ? null : path.resolve('dist/index.html'),
    mainPath: liveDev ? path.resolve('.edge-motion-check/main.js') : process.env.LX_TEST_MAIN_PATH,
  })
  const { app, page } = fixture
  const edition = liveDev ? 'development' : process.env.LX_TEST_PROJECT ? 'win7' : 'standard'
  const output = path.resolve('output/mini-player-edge-motion-preference-20261026', edition)
  let native
  try {
    await fs.mkdir(output, { recursive: true })
    await app.evaluate(({ screen }) => {
      global.__preferencePointer = { x: 80, y: 340 }
      screen.getCursorScreenPoint = () => global.__preferencePointer
    })
    await seedTrack(page)
    await page.evaluate(() => window.lxData.updateSetting({
      'miniPlayer.enable': true, 'miniPlayer.x': 0, 'miniPlayer.y': 300, 'miniPlayer.width': 450, 'miniPlayer.height': 240,
      'miniPlayer.isLock': false, 'miniPlayer.backgroundOpacity': 100, 'miniPlayer.autoHideControls': false,
      'common.isShowAnimation': true, 'ui.smoothAnimation': true, 'ui.lowPowerMode': false,
    }))
    const matches = page => page.url().includes('mini=true')
    const mini = app.windows().find(matches) ?? await app.waitForEvent('window', { predicate: matches })
    await mini.locator('.mini-edge-content').waitFor({ state: 'attached' })
    await mini.emulateMedia({ reducedMotion: 'reduce' })
    native = await app.browserWindow(mini)
    await native.evaluate(window => {
      // Hidden Windows windows can stop their compositor clock. Request real
      // frames without showing/focusing the window or modifying animation time.
      window.__captureEdgeMotion = true
      const capture = async() => {
        if (!window.__captureEdgeMotion || window.isDestroyed()) return
        try { await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }) } catch {}
        if (window.__captureEdgeMotion && !window.isDestroyed()) setTimeout(capture, 16)
      }
      void capture()
    })
    const media = await mini.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
    assert.equal(media, true)
    const initial = await native.evaluate(window => window.getBounds())
    const cursor = point => app.evaluate((_electron, point) => { global.__preferencePointer = point }, point)
    const sample = async phase => {
      await mini.waitForFunction(phase => document.querySelector('.mini-edge-content').dataset.edgePhase === phase, phase, { polling: 5 })
      return mini.evaluate(async phase => {
        const node = document.querySelector('.mini-edge-content')
        const samples = []
        for (let i = 0; i < 4; i++) {
          const style = getComputedStyle(node)
          samples.push({ phase: node.dataset.edgePhase, time: performance.now(), x: new DOMMatrixReadOnly(style.transform).m41, duration: style.transitionDuration, animations: node.getAnimations().map(animation => ({ state: animation.playState, time: animation.currentTime, duration: animation.effect.getTiming().duration })) })
          if (i < 3) await new Promise(resolve => setTimeout(resolve, 30))
        }
        return { requested: phase, samples, width: node.offsetWidth }
      }, phase)
    }
    await mini.evaluate(() => { getComputedStyle(document.querySelector('.mini-edge-content')).transform })
    await cursor({ x: -10000, y: -10000 })
    const outgoing = await sample('hiding')
    await fs.writeFile(path.join(output, 'outgoing.json'), JSON.stringify(outgoing, null, 2) + '\n')
    assert(outgoing.samples.every(sample => sample.duration === '0.24s'), JSON.stringify(outgoing))
    assert(outgoing.samples.some(sample => sample.x < -1 && sample.x > -outgoing.width + 6), 'outgoing has a real intermediate frame')
    assert(outgoing.samples.at(-1).x < outgoing.samples[0].x - 5, 'outgoing progresses with real time')
    await mini.waitForFunction(() => document.querySelector('.mini-edge-content').dataset.edgePhase === 'hidden')
    await cursor({ x: 2, y: 330 })
    const incoming = await sample('showing')
    await fs.writeFile(path.join(output, 'incoming.json'), JSON.stringify(incoming, null, 2) + '\n')
    assert(incoming.samples.every(sample => sample.duration === '0.24s'), JSON.stringify(incoming))
    assert(incoming.samples.some(sample => sample.x < -1 && sample.x > -incoming.width + 6), 'incoming has a real intermediate frame')
    assert(incoming.samples.at(-1).x > incoming.samples[0].x + 5, 'incoming progresses with real time')
    await mini.waitForFunction(() => document.querySelector('.mini-edge-content').dataset.edgePhase === 'shown')
    const final = await native.evaluate(window => ({ bounds: window.getBounds(), width: global.lx.appSetting['miniPlayer.width'], height: global.lx.appSetting['miniPlayer.height'] }))
    assert(Math.abs(final.bounds.width - initial.width) <= 2 && Math.abs(final.bounds.height - initial.height) <= 2)
    assert.deepEqual({ width: final.width, height: final.height }, { width: 450, height: 240 })
    assert.deepEqual(fixture.errors, [])
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ edition, url: new URL(mini.url()).origin, media, initial, final, outgoing, incoming }, null, 2) + '\n')
  } finally {
    await native?.evaluate(window => { window.__captureEdgeMotion = false }).catch(() => {})
    await native?.dispose()
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await app.close().catch(() => {})
  }
})
