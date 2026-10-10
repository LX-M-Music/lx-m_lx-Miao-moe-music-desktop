const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, seedTrack, showDetail, settled } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, install, label } = require('./helpers/plugin-fixture.cjs')

const close = async app => {
  let timer
  try {
    await Promise.race([app.close(), new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('Electron close timed out')), 15000) })])
  } catch (error) { app.process().kill(); throw error } finally { clearTimeout(timer) }
}

test('Folia queue closes on outside clicks and preserves queue actions and fullscreen', { timeout: 90000 }, async t => {
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  const screenshots = path.resolve('output/playwright/folia-queue-outside')
  const queue = page.locator('[data-play-queue]')
  const controls = page.locator('[data-player-detail] [data-detail-part="controls"]')
  let opener
  const openQueue = async() => {
    await opener.hover({ force: true })
    await opener.click()
    await queue.waitFor()
    assert.equal(await opener.getAttribute('aria-expanded'), 'true')
  }
  const assertClosed = async() => {
    await queue.waitFor({ state: 'hidden' })
    assert.equal(await opener.getAttribute('aria-expanded'), 'false')
  }
  try {
    page.setDefaultTimeout(6000)
    await fs.mkdir(screenshots, { recursive: true })
    await seedTrack(page)
    await showDetail(page, true)
    await settled(page)
    opener = controls.getByRole('button', { name: await label(page, 'player__play_list'), exact: true })
    await t.test('native lyrics still close the queue with an outside click', async() => {
      await openQueue()
      await page.mouse.click(48, 300)
      await assertClosed()
    })
    await showDetail(page, false)
    await settled(page)
    await mockGitHub(app)
    await openStore(page)
    await install(page, 'folia-lyrics')
    await page.evaluate(() => {
      Object.assign(window.lxData.musicInfo, { lrc: '[00:00.000]点击列表外空白处收起\n[00:10.000]列表内部仍可操作', lxlrc: '', tlrc: '', rlrc: '' })
      window.app_event.lyricUpdated()
    })
    await showDetail(page, true)
    await settled(page)
    const stage = page.locator('[data-folia-stage="player"]')
    const iframe = await stage.locator('iframe').elementHandle()
    const frame = await iframe.contentFrame()
    await frame.waitForFunction(() => !!document.documentElement.dataset.mode)
    const body = frame.locator('body')
    const outsideClick = () => body.click({ position: { x: 48, y: 300 } })
    await t.test('clicking queue contents, deleting an entry and ordinary window blur keep it open', async() => {
      await openQueue()
      await queue.getByText(await label(page, 'player__play_list'), { exact: true }).click()
      assert.equal(await opener.getAttribute('aria-expanded'), 'true')
      await queue.locator('[data-queue-index="4"]').getByRole('button', { name: await label(page, 'player__play_list_remove'), exact: true }).click()
      await page.waitForFunction(() => window.lxData.playQueueList.length === 4)
      await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      await page.waitForTimeout(50)
      assert.equal(await opener.getAttribute('aria-expanded'), 'true')
      await page.screenshot({ path: path.join(screenshots, 'queue-open.png') })
      await outsideClick()
      await assertClosed()
      await page.screenshot({ path: path.join(screenshots, 'outside-click-closed.png') })
    })
    const modes = await stage.locator('[data-folia-mode] option').evaluateAll(options => options.map(option => option.value))
    for (const mode of modes) {
      await t.test(`a real click in the ${mode} iframe closes a reopened queue`, async() => {
        await stage.locator('[data-folia-mode]').selectOption(mode)
        await frame.waitForFunction(mode => document.documentElement.dataset.mode === mode, mode)
        await openQueue()
        await outsideClick()
        await assertClosed()
      })
    }
    await t.test('host blank areas and Escape still close the queue', async() => {
      await openQueue()
      // The top reveal strip belongs to the host, outside the iframe and queue.
      await stage.click({ position: { x: 48, y: 110 } })
      await assertClosed()
      await openQueue()
      await page.keyboard.press('Escape')
      await assertClosed()
    })
    await t.test('outside double-clicks close the queue while retaining Folia fullscreen', async() => {
      await openQueue()
      await body.dblclick({ position: { x: 48, y: 300 } })
      await page.locator('html.fullscreen').waitFor()
      await assertClosed()
      await body.dblclick({ position: { x: 48, y: 300 } })
      await page.locator('html:not(.fullscreen)').waitFor()
      const nativeWindow = await app.browserWindow(page)
      // Fullscreen exit restores the previously active desktop window. Refocus
      // this test window before simulating the next mouse interaction.
      await nativeWindow.evaluate(window => window.focus())
      await nativeWindow.dispose()
    })
    await t.test('closing the detail page removes listeners and leaves the main player queue usable', async() => {
      await openQueue()
      await showDetail(page, false)
      await settled(page)
      await queue.waitFor({ state: 'hidden' })
      const mainOpener = page.locator('#player').getByRole('button', { name: await label(page, 'player__play_list'), exact: true })
      await mainOpener.click()
      await queue.waitFor()
      await page.keyboard.press('Escape')
      await queue.waitFor({ state: 'hidden' })
    })
    assert.deepEqual(fixture.errors, [])
  } finally { await close(app) }
})
