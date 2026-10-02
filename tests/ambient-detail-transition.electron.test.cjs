const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled, seedTrack, showDetail } = require('./helpers/motion-fixture.cjs')
const { startSilentAudio } = require('./helpers/plugin-fixture.cjs')
const themes = require('../src/common/theme/index.json')

const options = { rendererPath: path.resolve('dist/index.html'), disableHardwareAcceleration: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-backgrounding-occluded-windows'] }
const background = '[data-ambient-background="shared"]'
const update = (page, values) => page.evaluate(values => window.lxData.updateSetting(values), values)
const rgbDifference = (from, to) => {
  const rgb = value => value.match(/[\d.]+/g).map(Number)
  return Math.max(...rgb(from).slice(0, 3).map((value, index) => Math.abs(value - rgb(to)[index])))
}

const capture = (page, visible) => page.evaluate(visible => new Promise(resolve => {
  const samples = []
  const snapshot = time => {
    const controls = []
    for (const [section, selector] of [
      ['shell', '#left [role="tab"], #toolbar button, #player button'],
      ['detail', '[data-player-detail] button'],
    ]) {
      Array.from(document.querySelectorAll(selector)).forEach((element, index) => {
        const icon = element.querySelector('svg')
        if (!icon || !element.getBoundingClientRect().width) return
        let opacity = 1
        for (let current = icon; current && current.id !== 'container'; current = current.parentElement) opacity *= Number(getComputedStyle(current).opacity)
        controls.push({ id: section + index, section, label: element.getAttribute('aria-label'), color: getComputedStyle(icon).color, opacity, zone: element.dataset.ambientZone ?? '' })
      })
    }
    samples.push({ time, rootMode: document.querySelector('#root').dataset.ambientControls ?? '', detailMode: document.querySelector('[data-player-detail]')?.dataset.ambientControls ?? '', background: !!document.querySelector('[data-ambient-background]'), controls })
  }
  snapshot(-1)
  window.__motionDetail().isShowPlayerDetail = visible
  let started
  const step = time => {
    started ??= time
    snapshot(time - started)
    if (time - started < 850) requestAnimationFrame(step)
    else resolve(samples)
  }
  requestAnimationFrame(step)
}), visible)

const stableColors = (samples, section, reference, label) => {
  const expected = new Map(reference.controls.filter(control => control.section === section).map(control => [control.id, control]))
  const failures = []
  let checked = 0
  for (const sample of samples) {
    for (const control of sample.controls.filter(control => control.section === section && control.opacity > 0.1)) {
      const before = expected.get(control.id)
      if (!before) continue
      checked++
      const delta = rgbDifference(before.color, control.color)
      if (delta > 8) failures.push({ time: Math.round(sample.time), label: control.label, delta, from: before.color, to: control.color })
    }
  }
  assert(checked > 12, `${label}: inspected visible animated controls`)
  assert.deepEqual(failures, [], `${label}: icons retain their scene colors while fading`)
}

test('dynamic background detail transitions keep window, sidebar and playback icons stable', { timeout: 120000 }, async t => {
  const fixture = await launch(options)
  const { app, page, output, errors } = fixture
  const traces = []
  page.setDefaultTimeout(10000)
  try {
    await route(page, '/setting?name=SettingApi')
    await settled(page)
    await seedTrack(page)
    await page.evaluate(() => {
      window.lxData.musicInfo.pic = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#258b98"/></svg>')
      window.lxData.musicInfo.lrc = '[00:00.00]I just wanna run\n[00:01.00]Run because they are chasing me down\n[00:03.00]I just wanna run throw it away'
      window.app_event.lyricUpdated()
    })
    await update(page, { 'ui.ambientBackground': true, 'ui.ambientBackgroundOnlyPlayDetail': false, 'ui.ambientBackgroundQuality': 'static' })
    await page.waitForTimeout(1400)
    await page.evaluate(() => { window.__detailTransitionCanvas = document.querySelector('[data-ambient-background] canvas') })

    for (const id of ['green', 'black']) {
      const theme = themes.find(value => value.id === id)
      await page.evaluate(colors => window.setTheme(colors), { ...theme.config.themeColors, ...theme.config.extInfo })
      for (const [adaptive, masked] of [[true, true], [false, true], [true, false], [false, false]]) {
        await t.test(`${id} theme, button color following ${adaptive ? 'on' : 'off'}, playback mask ${masked ? 'on' : 'off'}`, async() => {
          await showDetail(page, false)
          await settled(page)
          await update(page, { 'ui.ambientBackgroundAutoContrast': adaptive, 'ui.ambientBackgroundPlayDetailMask': masked })
          await page.waitForTimeout(750)
          const enter = await capture(page, true)
          stableColors(enter, 'shell', enter[0], 'outgoing main page')
          stableColors(enter, 'detail', enter.at(-1), 'incoming detail page')
          assert(enter.every(sample => sample.rootMode === (adaptive ? (id === 'black' ? 'dark' : 'light') : '')), 'detail opening does not change the main page contrast mode')
          const detailMode = enter.at(-1).detailMode
          assert(['light', 'dark'].includes(detailMode), 'incoming playback page has its own contrast palette')
          if (masked) assert.equal(detailMode, 'dark')
          const leave = await capture(page, false)
          stableColors(leave, 'detail', leave[0], 'outgoing detail page')
          stableColors(leave, 'shell', leave.at(-1), 'incoming main page')
          for (const sample of leave) {
            if (sample.controls.some(control => control.section === 'detail' && control.opacity > 0.1)) assert.equal(sample.detailMode, detailMode, 'detail colors remain active until its exit finishes')
          }
          // A busy compositor can start the flight after the first sampled
          // frame. Check cleanup against the actual exit, not a wall-clock delay.
          await settled(page)
          assert.equal(await page.locator('[data-player-detail]').isVisible(), false)
          assert.equal(await page.locator(background + ' canvas').evaluate(canvas => canvas === window.__detailTransitionCanvas), true)
          if (!adaptive) assert.equal(await page.locator('[data-ambient-zone], [data-ambient-controls], [style*="--ambient-zone-"]').count(), 0, 'adaptive styles restore after the page is hidden')
          traces.push({ id, adaptive, masked, enter, leave })
        })
      }
    }

    await t.test('playing, fast reversals and disabling motion do not leave stale palettes or extra canvases', async() => {
      await update(page, { 'ui.ambientBackgroundQuality': 'gentle', 'ui.ambientBackgroundAutoContrast': false })
      await page.evaluate(() => { window.__lxPluginHost.player.getAudioElement().muted = true })
      await startSilentAudio(page)
      await page.waitForFunction(() => document.querySelector('[data-ambient-background]').dataset.ambientState === 'playing')
      const enter = await capture(page, true)
      stableColors(enter, 'shell', enter[0], 'playing main page')
      const leave = await capture(page, false)
      stableColors(leave, 'detail', leave[0], 'playing detail page')
      for (let index = 0; index < 16; index++) {
        await showDetail(page, index % 2 === 0)
        await page.waitForTimeout(35)
      }
      await settled(page)
      assert.equal(await page.locator('[data-player-detail]').isVisible(), false)
      assert.equal(await page.locator('[data-detail-entering], [data-ambient-controls], [data-ambient-zone], [data-cover-flight]').count(), 0)
      assert.equal(await page.locator(background + ' canvas').count(), 1)
      await showDetail(page, true)
      await update(page, { 'common.isShowAnimation': false })
      await settled(page)
      await showDetail(page, false)
      await page.waitForFunction(() => !document.querySelector('[data-player-detail]') || getComputedStyle(document.querySelector('[data-player-detail]')).display === 'none')
      assert.equal(await page.locator('[data-ambient-controls], [data-ambient-zone], [data-detail-entering]').count(), 0)
      await update(page, { 'common.isShowAnimation': true })
    })

    await t.test('detail-only background survives the visible exit and releases resources afterward, including fallback', async() => {
      await page.evaluate(() => window.__lxPluginHost.player.setPause())
      await update(page, { 'ui.ambientBackgroundOnlyPlayDetail': true, 'ui.ambientBackgroundQuality': 'static' })
      await page.locator(background).waitFor({ state: 'detached' })
      await showDetail(page, true)
      await settled(page)
      await page.locator('[data-player-detail][data-ambient-controls="dark"]').waitFor()
      const leave = await capture(page, false)
      assert(leave.some(sample => sample.controls.some(control => control.section === 'detail' && control.opacity > 0.1)), 'measured the actual exit')
      for (const sample of leave) {
        if (sample.controls.some(control => control.section === 'detail' && control.opacity > 0.1)) assert(sample.background, 'background must remain behind the visible exiting page')
      }
      await page.locator(background).waitFor({ state: 'detached' })
      assert.equal(await page.locator('[data-ambient-zone], [data-ambient-controls]').count(), 0)
      await update(page, { 'ui.ambientBackgroundOnlyPlayDetail': false })
      await page.locator(background + ' canvas').evaluate(canvas => canvas.getContext('webgl').getExtension('WEBGL_lose_context').loseContext())
      await page.waitForFunction(() => document.querySelector('[data-ambient-background]').dataset.ambientRenderer === 'fallback')
      await page.waitForTimeout(500)
      const fallbackEnter = await capture(page, true)
      const fallbackLeave = await capture(page, false)
      stableColors(fallbackEnter, 'shell', fallbackEnter[0], 'fallback main page')
      stableColors(fallbackLeave, 'detail', fallbackLeave[0], 'fallback detail page')
      await update(page, { 'ui.ambientBackground': false })
      assert.equal(await page.locator('[data-ambient-background], [data-ambient-zone], [data-ambient-controls], [style*="--ambient-zone-"]').count(), 0)
    })
    assert.deepEqual(errors, [])
    await fs.writeFile(path.join(output, 'detail-icon-frames.json'), JSON.stringify(traces, null, 2))
    console.log('Detail icon transition traces:', output)
  } finally { await app.close() }
})
