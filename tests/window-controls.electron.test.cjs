const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { setTimeout: delay } = require('node:timers/promises')
const { launch, route, settled, seedTrack, seedLyrics, showDetail } = require('./helpers/motion-fixture.cjs')

const labelsFor = page => page.evaluate(() => Object.fromEntries(
  ['min', 'close', 'window_maximize', 'window_restore', 'fullscreen_exit'].map(key => [key, window.i18n.t(key)]),
))
const waitNative = async(window, check) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await window.evaluate(check)) return
    await delay(50)
  }
  assert.fail('Native window did not reach the expected state')
}
const assertBounds = (actual, expected) => {
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(actual[key] - expected[key]) <= 1, `${key}: ${actual[key]} vs ${expected[key]}`)
  }
}
const assertBetween = async(group, labels, maximized = false, middle = 'max') => {
  const min = await group.getByRole('button', { name: labels.min, exact: true }).boundingBox()
  const max = await group.getByRole('button', { name: labels[maximized ? 'window_restore' : 'window_maximize'], exact: true }).boundingBox()
  const close = await group.getByRole('button', { name: labels.close, exact: true }).boundingBox()
  assert.ok(min && max && close)
  const ordered = [min, max, close].sort((a, b) => a.x - b.x)
  assert.equal(ordered[1], middle === 'min' ? min : max)
  assert.ok(ordered[0].x + ordered[0].width <= ordered[1].x + 1)
  assert.ok(ordered[1].x + ordered[1].width <= ordered[2].x + 1)
}

test('window buttons maximize, restore and preserve state across fullscreen and reload', { timeout: 90000 }, async t => {
  const { app, page, errors } = await launch()
  const window = await app.browserWindow(page)
  try {
    page.setDefaultTimeout(6000)
    const labels = await labelsFor(page)
    const original = await window.evaluate(window => window.getBounds())
    const originalSidebarWidth = (await page.locator('#left').boundingBox()).width
    const workArea = await app.evaluate(({ screen }, bounds) => screen.getDisplayMatching(bounds).workArea, original)
    const displayBounds = await app.evaluate(({ screen }, bounds) => screen.getDisplayMatching(bounds).bounds, original)
    for (const position of ['right', 'left']) {
      await t.test(`${position} controls and fullscreen exit`, async() => {
        await page.evaluate(position => { window.lxData.appSetting['common.controlBtnPosition'] = position }, position)
        const group = page.locator(position === 'right' ? '#toolbar' : '#left')
        const middle = position === 'left' ? 'min' : 'max'
        await assertBetween(group, labels, false, middle)
        await group.getByRole('button', { name: labels.window_maximize, exact: true }).click()
        await page.locator('html.maximized').waitFor()
        await assertBetween(group, labels, true, middle)
        assertBounds(await window.evaluate(window => window.getBounds()), workArea)

        await group.getByRole('button', { name: labels.min, exact: true }).click()
        await waitNative(window, window => window.isMinimized())
        await window.evaluate(window => window.restore())
        await waitNative(window, window => !window.isMinimized())
        await group.getByRole('button', { name: labels.window_restore, exact: true }).waitFor()

        await page.keyboard.press('F11')
        await page.locator('html.fullscreen').waitFor()
        await page.waitForTimeout(250)
        assertBounds(await window.evaluate(window => window.getBounds()), displayBounds)
        await group.getByRole('button', { name: labels.fullscreen_exit, exact: true }).click()
        await page.locator('html.maximized:not(.fullscreen)').waitFor()
        await page.waitForTimeout(250)
        assertBounds(await window.evaluate(window => window.getBounds()), workArea)
        await group.getByRole('button', { name: labels.window_restore, exact: true }).click()
        await page.locator('html:not(.maximized):not(.fullscreen)').waitFor()
        assertBounds(await window.evaluate(window => window.getBounds()), original)
        assert.ok(Math.abs((await page.locator('#left').boundingBox()).width - originalSidebarWidth) <= 1)

        // Native transitions also update the renderer; Esc returns to the normal window.
        await window.evaluate(window => window.setFullScreen(true))
        await page.locator('html.fullscreen').waitFor()
        await page.keyboard.press('Escape')
        await page.locator('html:not(.fullscreen)').waitFor()
        await page.waitForTimeout(250)
        assertBounds(await window.evaluate(window => window.getBounds()), original)
      })
    }

    await seedTrack(page)
    for (const position of ['right', 'left']) {
      await t.test(`${position} player detail controls`, async() => {
        await page.evaluate(position => { window.lxData.appSetting['common.controlBtnPosition'] = position }, position)
        await showDetail(page, true)
        await settled(page)
        const group = page.locator('[data-player-detail] [data-detail-part="chrome"]')
        await assertBetween(group, labels)
        await group.getByRole('button', { name: labels.window_maximize, exact: true }).click()
        await page.locator('html.maximized').waitFor()
        await assertBetween(group, labels, true)
        await page.keyboard.press('F11')
        await page.locator('html.fullscreen').waitFor()
        await group.getByRole('button', { name: labels.fullscreen_exit, exact: true }).click()
        await page.locator('html.maximized:not(.fullscreen)').waitFor()
        await group.getByRole('button', { name: labels.window_restore, exact: true }).click()
        await page.locator('html:not(.maximized)').waitFor()
        assertBounds(await window.evaluate(window => window.getBounds()), original)
        await showDetail(page, false)
        await settled(page)
      })
    }

    await t.test('reloading a maximized window restores its button state', async() => {
      await page.evaluate(() => require('electron').ipcRenderer.invoke('common_set_app_setting', {
        'common.isAgreePact': true,
        'common.showChangeLog': false,
      }))
      await page.locator('#left').getByRole('button', { name: labels.window_maximize, exact: true }).click()
      await page.locator('html.maximized').waitFor()
      await page.reload()
      await page.locator('html.maximized').waitFor()
      await page.locator('#left, #toolbar').getByRole('button', { name: labels.window_restore, exact: true }).click()
      await page.locator('html:not(.maximized)').waitFor()
      assertBounds(await window.evaluate(window => window.getBounds()), original)
    })
    assert.deepEqual(errors, [])
  } finally {
    await window.dispose()
    await app.close()
  }
})

test('opaque windows synchronize native maximize and restore', { timeout: 45000 }, async() => {
  const { app, page, errors } = await launch({ args: ['-dt'] })
  const window = await app.browserWindow(page)
  try {
    assert.equal(await page.evaluate(() => window.dt), true)
    const labels = await labelsFor(page)
    await window.evaluate(window => window.maximize())
    await page.locator('html.maximized').waitFor()
    await page.locator('#left, #toolbar').getByRole('button', { name: labels.window_restore, exact: true }).click()
    await waitNative(window, window => !window.isMaximized())
    await page.locator('html:not(.maximized)').waitFor()
    await page.locator('#left, #toolbar').getByRole('button', { name: labels.window_maximize, exact: true }).click()
    await waitNative(window, window => window.isMaximized())
    await window.evaluate(window => window.unmaximize())
    await page.locator('html:not(.maximized)').waitFor()
    assert.deepEqual(errors, [])
  } finally {
    await window.dispose()
    await app.close()
  }
})

test('starting in fullscreen exposes an exit button and restores a usable window', { timeout: 45000 }, async() => {
  const first = await launch()
  try {
    await first.page.evaluate(() => require('electron').ipcRenderer.invoke('common_set_app_setting', {
      'common.isAgreePact': true,
      'common.showChangeLog': false,
      'common.startInFullscreen': true,
    }))
  } finally {
    await first.app.close()
  }
  const { app, page, errors } = await launch({ profilePath: first.output })
  const window = await app.browserWindow(page)
  try {
    await page.locator('html.fullscreen').waitFor()
    const labels = await labelsFor(page)
    const bounds = await window.evaluate(window => window.getBounds())
    const displayBounds = await app.evaluate(({ screen }, bounds) => screen.getDisplayMatching(bounds).bounds, bounds)
    assertBounds(bounds, displayBounds)
    await page.locator('#left, #toolbar').getByRole('button', { name: labels.fullscreen_exit, exact: true }).click()
    await page.locator('html:not(.fullscreen)').waitFor()
    await page.locator('#left, #toolbar').getByRole('button', { name: labels.window_maximize, exact: true }).waitFor()
    const restored = await window.evaluate(window => window.getBounds())
    assert.ok(restored.width >= 828 && restored.height >= 540)
    assert.ok(restored.width < displayBounds.width && restored.height < displayBounds.height)
    assert.deepEqual(errors, [])
  } finally {
    await window.dispose()
    await app.close()
  }
})

test('window layouts fit small, HD, 2K, 4K and short ultrawide viewports', { timeout: 120000 }, async t => {
  const { app, page, errors, output } = await launch()
  try {
    const labels = await labelsFor(page)
    await page.locator('#left, #toolbar').getByRole('button', { name: labels.window_maximize, exact: true }).click()
    await page.locator('html.maximized').waitFor()
    await page.evaluate(() => {
      window.lxData.appSetting['common.controlBtnPosition'] = 'right'
      window.lxData.appSetting['download.enable'] = true
    })
    await seedTrack(page)
    for (const [width, height] of [[828, 540], [1024, 600], [1366, 768], [1920, 1080], [2560, 1440], [3840, 2160], [2560, 720], [3440, 900]]) {
      await t.test(`${width} x ${height}`, async() => {
        await page.setViewportSize({ width, height })
        await route(page, '/search')
        await settled(page)
        const layout = await page.evaluate(() => {
          const bounds = selector => {
            const { x, y, width, height, right, bottom } = document.querySelector(selector).getBoundingClientRect()
            return { x, y, width, height, right, bottom }
          }
          const rects = ['#left', '#toolbar', '#view', '#player', '#left [role="toolbar"]', '#toolbar input', '#toolbar button:last-child', '#view [role="tablist"]'].map(bounds)
          const root = bounds('#root')
          const tabs = [...document.querySelectorAll('#view [role="tab"]')].map(el => {
            const { x, y, right, bottom } = el.getBoundingClientRect()
            return { x, y, right, bottom }
          })
          return { root, rects, tabs, fontSize: parseFloat(window.getComputedStyle(document.documentElement).fontSize), width: window.innerWidth, height: window.innerHeight }
        })
        assert.equal(layout.width, width)
        assert.equal(layout.height, height)
        for (const rect of [...layout.rects, ...layout.tabs]) {
          assert.ok(rect.x >= layout.root.x - 1 && rect.y >= layout.root.y - 1, JSON.stringify(rect))
          assert.ok(rect.right <= layout.root.right + 1 && rect.bottom <= layout.root.bottom + 1, JSON.stringify(rect))
        }
        assert.ok(layout.rects[0].width <= 100 * layout.fontSize / 16 + 1, 'Sidebar must stay compact on wide displays')
        await assertBetween(page.locator('#toolbar'), labels, true)

        await route(page, '/list?id=love')
        await settled(page)
        await page.evaluate(() => {
          const component = window.__motionComponents().find(c => c.type.name === 'MusicList' && 'list' in c.setupState)
          component.setupState.list = Array.from({ length: 50 }, (_, i) => ({
            id: 'resize-song-' + i,
            name: 'Song ' + i,
            singer: 'Fixture singer',
            source: 'local',
            interval: '03:00',
            meta: { albumName: 'Album', filePath: '', ext: 'mp3', picUrl: '' },
          }))
        })
        await page.locator('#view .list-item').first().waitFor()
        const rows = await page.locator('#view .list-item').evaluateAll(elements => elements.slice(0, 3).map(el => {
          const { y, height } = el.getBoundingClientRect()
          return { y, height }
        }))
        assert.ok(rows.length >= 2)
        assert.ok(rows[0].height >= Math.ceil(layout.fontSize * 2.3))
        assert.ok(Math.abs(rows[1].y - rows[0].y - rows[0].height) <= 1, 'Virtualized rows must not overlap or leave gaps')

        await showDetail(page, true)
        await settled(page)
        await seedLyrics(page)
        await page.waitForFunction(() => [...document.querySelectorAll('[data-detail-part]')].every(el => !el.getAnimations().length))
        const detail = await page.locator('[data-player-detail]').boundingBox()
        for (const part of ['chrome', 'info', 'lyrics', 'controls']) {
          const rect = await page.locator(`[data-player-detail] [data-detail-part="${part}"]`).boundingBox()
          assert.ok(rect && rect.width > 0 && rect.height > 0, part)
          assert.ok(rect.x >= detail.x - 1 && rect.y >= detail.y - 1, part)
          assert.ok(rect.x + rect.width <= detail.x + detail.width + 1 && rect.y + rect.height <= detail.y + detail.height + 1, part)
        }
        if (width === 1366 || width === 3840) {
          await page.waitForTimeout(500)
          await page.screenshot({ path: path.join(output, `detail-${width}.png`) })
        }
        await showDetail(page, false)
        await settled(page)
      })
    }
    t.diagnostic(`Layout screenshots: ${output}`)
    assert.deepEqual(errors, [])
  } finally {
    await app.close()
  }
})
