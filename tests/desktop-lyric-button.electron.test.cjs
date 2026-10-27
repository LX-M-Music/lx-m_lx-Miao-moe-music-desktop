const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, seedTrack, showDetail, settled, captureHidden } = require('./helpers/motion-fixture.cjs')

test('the original LX desktop lyric icon is visible and works directly in every bottom bar', { timeout: 120000 }, async t => {
  const fixture = await launch({ hidden: true, rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  const edition = process.env.LX_TEST_PROJECT ? 'win7' : 'standard'
  const output = path.resolve('output/desktop-lyric-bottom-bar-20261025', edition)
  await fs.mkdir(output, { recursive: true })
  const label = key => page.evaluate(key => window.i18n.t(key), key)
  const update = values => page.evaluate(values => window.lxData.updateSetting(values), values)
  const iconIsVisible = async(button, enabled) => {
    assert.equal(await button.isVisible(), true)
    const geometry = await button.locator('svg').evaluate(svg => {
      const use = svg.querySelector('use')
      const b = use.getBBox()
      const v = svg.viewBox.baseVal
      const width = Math.max(0, Math.min(b.x + b.width, v.x + v.width) - Math.max(b.x, v.x))
      const height = Math.max(0, Math.min(b.y + b.height, v.y + v.height) - Math.max(b.y, v.y))
      const rect = svg.getBoundingClientRect()
      return { visibleRatio: width * height / (b.width * b.height), width: rect.width, height: rect.height, href: use.getAttribute('xlink:href') }
    })
    assert(geometry.width >= 14 && geometry.height >= 14, JSON.stringify(geometry))
    assert(geometry.visibleRatio >= 0.9, 'the actual icon geometry must fit within the viewport: ' + JSON.stringify(geometry))
    assert.equal(geometry.href, enabled ? '#icon-desktop-lyric-on' : '#icon-desktop-lyric-off')
  }
  const checkToggle = async(scope, screenshotName) => {
    let button = scope.getByRole('button', { name: await label('player__desktop_lyric_on') })
    await iconIsVisible(button, false)
    await button.click()
    await page.waitForFunction(() => window.lxData.appSetting['desktopLyric.enable'])
    button = scope.getByRole('button', { name: await label('player__desktop_lyric_off') })
    await iconIsVisible(button, true)
    const native = app.windows().find(p => p.url().includes('lyric.html') && !p.url().includes('mini=true')) ?? await app.waitForEvent('window', { predicate: p => p.url().includes('lyric.html') && !p.url().includes('mini=true') })
    await native.locator('#container').waitFor()
    assert.equal(await page.evaluate(() => window.lxData.appSetting['miniPlayer.enable']), false)
    await button.click({ button: 'right' })
    await page.waitForFunction(() => window.lxData.appSetting['desktopLyric.enable'] && window.lxData.appSetting['desktopLyric.isLock'])
    await button.click({ button: 'right' })
    await page.waitForFunction(() => !window.lxData.appSetting['desktopLyric.isLock'])
    await page.mouse.move(20, 20)
    await captureHidden(app, page, path.join(output, screenshotName))
    await button.click()
    await page.waitForFunction(() => !window.lxData.appSetting['desktopLyric.enable'])
  }
  try {
    page.setDefaultTimeout(8000)
    await seedTrack(page)
    await update({ 'desktopLyric.enable': false, 'desktopLyric.isLock': false, 'miniPlayer.enable': false })
    for (const style of ['mini', 'middle', 'full']) {
      await t.test(style + ' progress layout', async() => {
        await update({ 'common.playBarProgressStyle': style })
        await checkToggle(page.locator('#player'), `bottom-bar-${style}.png`)
      })
    }
    await t.test('the lyric detail bottom bar uses the original icon too', async() => {
      await showDetail(page, true)
      await settled(page)
      await checkToggle(page.locator('[data-player-detail]'), 'detail-bottom-bar.png')
      await showDetail(page, false)
    })
    assert.deepEqual(fixture.errors, [])
    console.log('Bottom lyric button screenshots:', output)
  } finally {
    // This isolated fixture checks button rendering and input. Exit its hidden
    // windows directly; normal shutdown/persistence is covered by mini-player.
    await app.evaluate(({ app }) => { app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
