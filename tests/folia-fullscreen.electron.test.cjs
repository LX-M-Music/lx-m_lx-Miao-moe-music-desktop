const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, showDetail, settled } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, label, install } = require('./helpers/plugin-fixture.cjs')

const engineFor = async(page, surface) => {
  const element = await page.locator(`[data-folia-stage="${surface}"] iframe`).elementHandle()
  const frame = await element.contentFrame()
  await frame.waitForFunction(() => !!document.documentElement?.dataset.mode)
  return frame
}
const doubleClickLyrics = async frame => {
  const bounds = await frame.locator('body').boundingBox()
  await frame.locator('body').dblclick({ position: { x: bounds.width / 2, y: bounds.height / 2 } })
}

test('Folia double-click fullscreen restores window bounds across lyric styles and ignores the preview and controls', { timeout: 90000 }, async() => {
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  const nativeWindow = await app.browserWindow(page)
  try {
    page.setDefaultTimeout(6000)
    await mockGitHub(app)
    await openStore(page)
    await install(page, 'folia-lyrics')
    await page.locator('[data-plugin-id="folia-lyrics"]').getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
    let frame = await engineFor(page, 'preview')
    await doubleClickLyrics(frame)
    await page.waitForTimeout(150)
    assert.equal(await page.locator('html.fullscreen').count(), 0, 'settings previews must keep the window size')

    await showDetail(page, true)
    await settled(page)
    frame = await engineFor(page, 'player')
    const originalBounds = await nativeWindow.evaluate(window => window.getBounds())
    const assertRestored = async() => {
      await page.locator('html:not(.fullscreen)').waitFor()
      assert.deepEqual(await nativeWindow.evaluate(window => window.getBounds()), originalBounds)
    }
    const togglePair = async() => {
      await doubleClickLyrics(frame)
      await page.locator('html.fullscreen').waitFor()
      const fullBounds = await nativeWindow.evaluate(window => window.getBounds())
      assert(fullBounds.width > originalBounds.width || fullBounds.height > originalBounds.height, 'fullscreen must expand the native window')
      assert.equal(await page.locator('[data-folia-window-drag]').isVisible(), false)
      await doubleClickLyrics(frame)
      await assertRestored()
      assert.equal(await page.locator('[data-folia-window-drag]').isVisible(), true)
    }
    await frame.getByText('暂无歌词', { exact: true }).waitFor()
    await togglePair()
    await page.evaluate(() => {
      Object.assign(window.lxData.musicInfo, { id: 'folia-fullscreen-track', name: 'Fullscreen fixture', singer: 'Fixture artist', album: 'Fixture album', lrc: '[00:00.000]双击歌词全屏\n[00:10.000]再次双击还原', lxlrc: '', tlrc: '', rlrc: '' })
      window.app_event.lyricUpdated()
    })
    for (const mode of ['classic', 'monet', 'fume']) {
      await page.locator('[data-folia-stage="player"] [data-folia-mode]').selectOption(mode)
      await frame.waitForFunction(mode => document.documentElement.dataset.mode === mode, mode)
      await frame.waitForFunction(() => document.querySelector('#root canvas') || document.querySelector('#root')?.textContent.trim())
      await togglePair()
    }
    await page.locator('[data-folia-stage="player"] [data-folia-mode]').evaluate(element => element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })))
    await page.evaluate(() => window.postMessage({ channel: 'lx-m:folia-lyrics', type: 'toggle-fullscreen' }, '*'))
    await frame.evaluate(() => {
      const button = document.createElement('button')
      document.body.appendChild(button)
      button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
      button.remove()
    })
    await page.waitForTimeout(150)
    await assertRestored()
    await doubleClickLyrics(frame)
    await page.locator('html.fullscreen').waitFor()
    await frame.locator('body').press('Escape')
    await assertRestored()
    await showDetail(page, false)
    await settled(page)
    assert.deepEqual(fixture.errors, [])
    console.log('Folia fullscreen profile: ' + fixture.output)
  } finally {
    await nativeWindow.dispose()
    let closeTimer
    try {
      await Promise.race([
        app.close(),
        new Promise((resolve, reject) => { closeTimer = setTimeout(() => reject(new Error('Electron did not close within 15 seconds')), 15000) }),
      ])
    } catch (error) {
      app.process().kill()
      throw error
    } finally {
      clearTimeout(closeTimer)
    }
  }
})
