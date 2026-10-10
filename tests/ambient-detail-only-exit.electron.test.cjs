const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled, seedTrack, showDetail } = require('./helpers/motion-fixture.cjs')
const { startSilentAudio } = require('./helpers/plugin-fixture.cjs')

const options = { rendererPath: path.resolve('dist/index.html'), disableHardwareAcceleration: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-backgrounding-occluded-windows'] }
const background = '[data-ambient-background="shared"]'
const adaptive = '[data-ambient-zone], [data-ambient-controls], [style*="--ambient-zone-"]'
const output = path.resolve('output/playwright/ambient-detail-only-exit', process.env.LX_AMBIENT_EXIT_RUN ?? 'verified')
const update = (page, values) => page.evaluate(values => window.lxData.updateSetting(values), values)

const closeFrames = (page, duration = 900) => page.evaluate(duration => new Promise(resolve => {
  const samples = []
  const snapshot = time => {
    const detail = document.querySelector('[data-player-detail]')
    samples.push({
      time,
      opened: document.querySelector('#container').hasAttribute('data-player-detail-open'),
      ambientEnabled: document.querySelector('#container').hasAttribute('data-ambient-enabled'),
      background: !!document.querySelector('[data-ambient-background]'),
      adaptive: document.querySelectorAll('[data-ambient-zone], [data-ambient-controls], [style*="--ambient-zone-"]').length,
      detailVisible: !!detail && getComputedStyle(detail).display !== 'none',
      detailOpacity: detail ? Number(getComputedStyle(detail).opacity) : 0,
      detailAnimations: detail?.getAnimations().length ?? 0,
    })
  }
  snapshot(-1)
  const label = window.i18n.t('player__hide_detail_tip')
  const button = Array.from(document.querySelectorAll('[data-player-detail] button')).find(button => button.getAttribute('aria-label') === label)
  if (!button) throw new Error('Playback detail close button is missing')
  button.click()
  let started
  const step = time => {
    started ??= time
    snapshot(time - started)
    if (time - started < duration) requestAnimationFrame(step)
    else resolve(samples)
  }
  requestAnimationFrame(step)
}), duration)

const removedImmediately = samples => {
  assert.equal(samples[0].background, true, 'background was displayed before closing')
  const painted = samples.filter(sample => sample.time >= 0)
  assert(painted.length >= 2, 'inspected frames after the actual close-button action')
  const stale = painted.filter(sample => sample.opened || sample.background || sample.ambientEnabled || sample.adaptive)
  assert.equal(stale.length, 0, `returning main page must have no background or adaptive palette from the first frame; first retained frame: ${JSON.stringify(stale[0])}`)
}

test('detail-only dynamic background disappears on closing without waiting for page motion', { timeout: 90000 }, async t => {
  const { app, page, errors } = await launch(options)
  const traces = []
  page.setDefaultTimeout(10000)
  await fs.mkdir(output, { recursive: true })
  try {
    await update(page, { 'ui.ambientBackground': true, 'ui.ambientBackgroundOnlyPlayDetail': true, 'ui.ambientBackgroundAutoContrast': true })
    await route(page, '/setting?name=SettingApi')
    await settled(page)
    await seedTrack(page)
    await page.evaluate(() => {
      Object.assign(window.lxData.musicInfo, { lrc: '[00:00.000]晚风轻轻，掠过海面\n[00:10.000]关闭详情，背景及时退出', lxlrc: '', tlrc: '', rlrc: '' })
      window.app_event.lyricUpdated()
      window.__lxPluginHost.player.getAudioElement().muted = true
    })
    await startSilentAudio(page)
    await page.screenshot({ path: path.join(output, 'library-before.png') })

    for (const scene of [
      { id: 'playing-mask-off', speed: 1, masked: false },
      { id: 'slow-masked', speed: 0.5, masked: true },
      { id: 'fast-masked', speed: 1.5, masked: true },
      { id: 'static-quality', speed: 1, masked: false, quality: 'static' },
      { id: 'low-power', speed: 1, masked: true, lowPower: true },
      { id: 'animations-disabled', speed: 1, masked: false, animation: false },
    ]) {
      await t.test(scene.id, async() => {
        await showDetail(page, false)
        await settled(page)
        await update(page, {
          'ui.animationSpeed': scene.speed,
          'common.isShowAnimation': scene.animation !== false,
          'ui.lowPowerMode': scene.lowPower ?? false,
          'ui.ambientBackgroundQuality': scene.quality ?? 'gentle',
          'ui.ambientBackgroundPlayDetailMask': scene.masked,
        })
        await showDetail(page, true)
        await settled(page)
        await page.locator('[data-player-detail][data-ambient-controls]').waitFor()
        const moving = scene.quality !== 'static' && !scene.lowPower && scene.animation !== false
        await page.waitForFunction(moving => document.querySelector('[data-ambient-background]')?.dataset.ambientState === (moving ? 'playing' : 'static'), moving)
        await page.locator(background + ' canvas').evaluate(canvas => {
          window.__exitingAmbientCanvas = canvas
          window.__exitingAmbientContext = canvas.closest('[data-ambient-background]').dataset.ambientRenderer === 'kawarp' ? canvas.getContext('webgl') : null
        })
        if (scene.id === 'playing-mask-off') await page.screenshot({ path: path.join(output, 'detail-open.png') })
        const closing = closeFrames(page)
        if (scene.id === 'playing-mask-off') {
          await page.waitForFunction(() => !document.querySelector('#container').hasAttribute('data-player-detail-open'))
          await page.waitForTimeout(200)
          await page.screenshot({ path: path.join(output, 'closing-200ms.png') })
        }
        const samples = await closing
        traces.push({ scene, samples })
        removedImmediately(samples)
        if (!scene.lowPower && scene.animation !== false) assert(samples.some(sample => sample.time >= 0 && sample.detailVisible && sample.detailOpacity > 0.1 && sample.detailAnimations > 0), 'the detail page still plays its exit animation')
        await settled(page)
        assert.equal(await page.locator(background).count(), 0)
        assert.equal(await page.locator(adaptive).count(), 0)
        assert.equal(await page.evaluate(() => window.__exitingAmbientCanvas.isConnected), false)
        assert.equal(await page.evaluate(() => window.__exitingAmbientContext?.isContextLost() ?? true), true, 'the removed renderer releases its WebGL context')
      })
    }

    await t.test('reopening during exit restores one background and closing releases it again', async() => {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await update(page, { 'common.isShowAnimation': true, 'ui.lowPowerMode': false, 'ui.animationSpeed': 0.5, 'ui.ambientBackgroundQuality': 'gentle' })
      await showDetail(page, false)
      await settled(page)
      for (let index = 0; index < 8; index++) {
        await showDetail(page, true)
        await page.waitForFunction(() => document.querySelector('[data-ambient-background]')?.dataset.ambientState === 'playing')
        assert.equal(await page.locator(background + ' canvas').count(), 1)
        const samples = await closeFrames(page, 20)
        removedImmediately(samples)
      }
      await settled(page)
      assert.equal(await page.locator(background + ', ' + adaptive + ', [data-cover-flight]').count(), 0)
    })
    await page.screenshot({ path: path.join(output, 'library-after.png') })
    assert.deepEqual(errors, [])
  } finally {
    await fs.writeFile(path.join(output, 'exit-frames.json'), JSON.stringify(traces, null, 2))
    console.log('Detail-only exit frames:', output)
    await showDetail(page, false).catch(() => {})
    await settled(page).catch(() => {})
    await app.close()
  }
})
