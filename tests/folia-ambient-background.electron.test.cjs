const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, seedTrack, showDetail, settled } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, label, install, startSilentAudio } = require('./helpers/plugin-fixture.cjs')
const themes = require('../src/common/theme/index.json')

const appearance = async(page, filename) => {
  const image = await page.screenshot({ path: filename })
  return page.evaluate(async data => {
    const image = new Image()
    image.src = 'data:image/png;base64,' + data
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const footer = document.querySelector('[data-player-detail] [data-detail-part="controls"]')
    const rect = footer.getBoundingClientRect()
    const style = getComputedStyle(footer)
    const scale = image.width / innerWidth
    const pixel = Array.from(context.getImageData(Math.floor((rect.left + rect.width * 0.5) * scale), Math.floor((rect.bottom - 4) * scale), 1, 1).data).slice(0, 3)
    return {
      pixel, background: style.backgroundImage, backgroundColor: style.backgroundColor,
      color: style.color, readingSurface: style.getPropertyValue('--ambient-reading-surface'),
      detailPalette: document.querySelector('[data-player-detail]').dataset.ambientControls,
      buttonColors: Array.from(footer.querySelectorAll('button')).map(button => getComputedStyle(button).color),
    }
  }, image.toString('base64'))
}

test('Folia retains its bottom surface and control colors when dynamic background is enabled first', { timeout: 90000 }, async t => {
  const output = path.resolve(process.env.LX_FOLIA_CHECK_DIR ?? 'output/playwright/folia-ambient-bottom/verified')
  await fs.mkdir(output, { recursive: true })
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html'), disableHardwareAcceleration: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const { app, page } = fixture
  try {
    page.setDefaultTimeout(10000)
    await mockGitHub(app)
    await openStore(page)
    await install(page, 'folia-lyrics')
    await page.locator('[data-plugin-id="folia-lyrics"]').getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
    await page.locator('[data-folia-enabled]').uncheck()
    await seedTrack(page)
    await page.evaluate(() => {
      Object.assign(window.lxData.musicInfo, { lrc: '[00:00.000]晚风轻轻，掠过海面\n[00:10.000]双击歌词，全屏欣赏', lxlrc: '', tlrc: '', rlrc: '' })
      window.app_event.lyricUpdated()
      window.lxData.updateSetting({ 'common.isShowAnimation': false, 'ui.ambientBackground': true, 'ui.ambientBackgroundQuality': 'static', 'ui.ambientBackgroundAutoContrast': true, 'ui.ambientBackgroundPlayDetailMask': false })
    })
    await showDetail(page, true)
    await settled(page)
    await page.locator('[data-player-detail][data-ambient-controls]').waitFor()
    await page.locator('[data-folia-toggle]').click()
    await page.locator('[data-folia-stage="player"] iframe').waitFor()
    const frame = await (await page.locator('[data-folia-stage="player"] iframe').elementHandle()).contentFrame()
    await frame.waitForFunction(() => document.documentElement?.dataset.mode === 'classic')
    await frame.waitForFunction(() => document.querySelector('#root')?.textContent.includes('晚'))
    const footer = page.locator('[data-player-detail] [data-detail-part="controls"]')
    const reveal = async() => {
      const bounds = await footer.boundingBox()
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height - 4)
      await footer.evaluate(element => new Promise(resolve => {
        const check = () => Number(getComputedStyle(element).opacity) === 1 ? resolve() : requestAnimationFrame(check)
        check()
      }))
    }
    await reveal()
    await page.waitForTimeout(300)
    const ambient = await appearance(page, path.join(output, 'ambient-folia.png'))
    await page.evaluate(() => window.lxData.updateSetting({ 'ui.ambientBackground': false }))
    await page.locator('[data-ambient-background]').waitFor({ state: 'detached' })
    await reveal()
    const plain = await appearance(page, path.join(output, 'folia-only.png'))
    await fs.writeFile(path.join(output, 'appearance.json'), JSON.stringify({ ambient, plain }, null, 2))
    const stable = result => {
      assert.equal(result.background, plain.background, 'the hidden shared artwork must not replace the Folia footer gradient')
      assert.equal(result.color, plain.color, 'footer text must retain the Folia palette')
      assert.deepEqual(result.buttonColors, plain.buttonColors, 'playback controls must retain their Folia colors')
      assert(result.pixel.every(channel => channel < 80), 'the visible bottom edge must remain dark')
    }
    await t.test('enabling Folia after ambient colors have already been applied keeps the footer dark', () => stable(ambient))
    const results = [{ name: 'ambient-first', ...ambient }, { name: 'folia-only', ...plain }]
    const update = settings => page.evaluate(settings => window.lxData.updateSetting(settings), settings)
    for (const id of ['green', 'black']) {
      const theme = themes.find(theme => theme.id === id)
      await page.evaluate(colors => window.setTheme(colors), { ...theme.config.themeColors, ...theme.config.extInfo })
      for (const mask of [true, false]) for (const following of [true, false]) {
        const name = `${id}-mask-${mask}-following-${following}`
        await t.test(name, async() => {
          await update({ 'ui.ambientBackground': true, 'ui.ambientBackgroundAutoContrast': following, 'ui.ambientBackgroundPlayDetailMask': mask })
          await reveal()
          await page.waitForTimeout(300)
          const result = await appearance(page, path.join(output, name + '.png'))
          results.push({ name, ...result })
          stable(result)
        })
      }
    }
    await t.test('moving artwork and low-power rendering do not change the canvas-style footer', async() => {
      await page.locator('[data-folia-stage="player"] [data-folia-mode]').selectOption('fume')
      await frame.waitForFunction(() => document.documentElement?.dataset.mode === 'fume' && !!document.querySelector('canvas'))
      await update({ 'common.isShowAnimation': true, 'ui.ambientBackgroundQuality': 'gentle', 'ui.ambientBackgroundAutoContrast': true })
      await page.evaluate(() => { window.__lxPluginHost.player.getAudioElement().muted = true })
      await startSilentAudio(page)
      await page.waitForFunction(() => document.querySelector('[data-ambient-background]')?.dataset.ambientState === 'playing')
      await reveal()
      await page.waitForTimeout(800)
      const moving = await appearance(page, path.join(output, 'moving-fume.png'))
      results.push({ name: 'moving-fume', ...moving })
      stable(moving)
      await update({ 'ui.lowPowerMode': true })
      await page.locator('[data-ambient-background][data-ambient-renderer="low-power"]').waitFor()
      await reveal()
      await page.waitForTimeout(300)
      const lowPower = await appearance(page, path.join(output, 'low-power-fume.png'))
      results.push({ name: 'low-power-fume', ...lowPower })
      stable(lowPower)
      await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().pause())
    })
    await t.test('switching back to ordinary lyrics restores adaptive colors for bright artwork', async() => {
      await page.locator('[data-folia-toggle]').click()
      await page.locator('[data-folia-stage="player"]').waitFor({ state: 'detached' })
      await update({ 'common.isShowAnimation': false, 'ui.lowPowerMode': false, 'ui.ambientBackgroundQuality': 'static', 'ui.ambientBackgroundPlayDetailMask': false })
      await page.evaluate(() => {
        window.lxData.musicInfo.pic = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#f0f0f0"/></svg>')
      })
      await page.waitForFunction(() => document.querySelector('[data-player-detail]')?.dataset.ambientControls === 'light')
      await page.waitForTimeout(300)
      const native = await appearance(page, path.join(output, 'native-restored.png'))
      results.push({ name: 'native-restored', ...native })
      assert.notEqual(native.color, plain.color, 'ordinary lyrics must recover the artwork-based palette')
      assert(native.pixel.every(channel => channel > 150), 'ordinary lyrics must show bright artwork again')
    })
    await fs.writeFile(path.join(output, 'appearance-matrix.json'), JSON.stringify(results, null, 2))
    assert.deepEqual(fixture.errors, [])
    console.log('Folia ambient-background screenshots: ' + output)
  } finally {
    if (!page.isClosed()) {
      await showDetail(page, false)
      await settled(page)
    }
    let closeTimer
    try {
      await Promise.race([app.close(), new Promise((resolve, reject) => { closeTimer = setTimeout(() => reject(new Error('Electron did not close within 15 seconds')), 15000) })])
    } catch (error) {
      app.process().kill()
      throw error
    } finally { clearTimeout(closeTimer) }
  }
})
