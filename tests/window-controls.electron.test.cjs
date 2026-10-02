const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
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

test('window-control settings update all headers, preview and saved preferences', { timeout: 120000 }, async() => {
  let fixture = await launch()
  let { app, page } = fixture
  const profilePath = fixture.output
  const output = path.resolve('output/playwright/window-control-settings', process.env.LX_TEST_ELECTRON ? 'compatible' : 'ordinary')
  await fs.mkdir(output, { recursive: true })
  const update = async values => {
    await page.evaluate(values => window.lxData.updateSetting(values), values)
    await page.waitForFunction(values => Object.entries(values).every(([key, value]) => window.lxData.appSetting[key] === value), values)
  }
  const park = async() => {
    await page.mouse.move(10, 500)
    await page.evaluate(() => document.activeElement?.blur())
  }
  const waitIcons = (selector, names, visible) => page.waitForFunction(({ selector, names, visible }) => {
    const scope = document.querySelector(selector)
    const root = scope && [...scope.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === names[0])?.parentElement
    if (!root) return false
    return names.every(name => {
      const button = [...root.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === name)
      const icon = button?.querySelector('svg')
      if (!icon) return false
      const opacity = Number(getComputedStyle(icon).opacity)
      return visible ? opacity > 0.99 : opacity < 0.01
    })
  }, { selector, names, visible }).catch(async error => {
    console.error(await page.evaluate(({ selector, names, visible }) => ({
      selector, names, visible,
      mode: window.lxData.appSetting['ui.windowControlsIconMode'],
      position: window.lxData.appSetting['common.controlBtnPosition'],
      html: document.documentElement.className,
      buttons: [...document.querySelectorAll(selector + ' button')].map(button => ({ label: button.getAttribute('aria-label'), opacity: button.querySelector('svg') && getComputedStyle(button.querySelector('svg')).opacity, parent: button.parentElement.className, hover: button.parentElement.matches(':hover'), focus: button.parentElement.matches(':focus-within') })),
    }), { selector, names, visible }))
    await page.screenshot({ path: path.join(output, 'failure.png') })
    throw error
  })
  try {
    page.setDefaultTimeout(7000)
    await update({ 'common.langId': 'zh-cn' })
    await route(page, '/setting?name=SettingAdvanced')
    await page.locator('[data-setting-tab="SettingAdvanced"]').click()
    const section = page.locator('#advanced_window_controls').locator('..')
    const filter = page.getByPlaceholder('搜索设置项', { exact: true })
    await filter.fill('窗口控制按钮')
    await page.locator('#advanced_window_controls').waitFor({ state: 'visible' })
    await filter.fill('')
    const labels = await labelsFor(page)
    const names = [labels.min, labels.window_maximize, labels.close]
    await seedTrack(page)
    for (const style of ['default', 'traffic']) {
      for (const mode of ['hover', 'always']) {
        await page.locator(`label[for="setting_advanced_window_controls_${style}"]`).click()
        await page.locator(`label[for="setting_advanced_window_controls_icon_${mode}"]`).click()
        await page.waitForFunction(({ style, mode }) => window.lxData.appSetting['ui.windowControlStyle'] === style && window.lxData.appSetting['ui.windowControlsIconMode'] === mode, { style, mode })
        await park()
        await page.waitForFunction(visible => [...document.querySelectorAll('.control-preview .pv-icon')].every(icon => visible ? Number(getComputedStyle(icon).opacity) > 0.99 : Number(getComputedStyle(icon).opacity) < 0.01), mode === 'always')
        await section.screenshot({ path: path.join(output, `settings-${style}-${mode}.png`) })
        await section.locator('.control-preview').hover()
        await page.waitForFunction(() => [...document.querySelectorAll('.control-preview .pv-icon')].every(icon => Number(getComputedStyle(icon).opacity) > 0.99))
        for (const position of ['left', 'right']) {
          await update({ 'common.controlBtnPosition': position })
          for (const detail of [false, true]) {
            await showDetail(page, detail)
            await settled(page)
            const selector = detail ? '[data-player-detail] [data-detail-part="chrome"]' : position === 'left' ? '#left' : '#toolbar'
            const root = page.locator(selector)
            const min = root.getByRole('button', { name: labels.min, exact: true })
            await park()
            await waitIcons(selector, names, mode === 'always')
            await page.waitForFunction(({ selector, names, style }) => {
              const scope = document.querySelector(selector)
              const root = [...scope.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === names[0])?.parentElement
              const colors = names.map(name => {
                const button = [...root.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === name)
                if (!button) return null
                const dot = getComputedStyle(button, '::before')
                return dot.content === 'none' || dot.content === 'normal' ? getComputedStyle(button).backgroundColor : dot.backgroundColor
              })
              return style === 'traffic' ? JSON.stringify(colors) === JSON.stringify(['rgb(254, 188, 46)', 'rgb(40, 200, 64)', 'rgb(255, 95, 87)']) : colors.every(color => color && color === colors[0] && color !== 'rgba(0, 0, 0, 0)')
            }, { selector, names, style })
            await min.locator('..').screenshot({ path: path.join(output, `${style}-${mode}-${position}-${detail ? 'detail' : 'main'}.png`) })
            await min.hover()
            await waitIcons(selector, names, true)
            await park()
            await min.focus()
            await page.keyboard.press('Tab')
            await waitIcons(selector, names, true)
            await park()
            await waitIcons(selector, names, mode === 'always')
          }
          await showDetail(page, false)
          await settled(page)
        }
      }
    }
    for (const locale of ['zh-tw', 'en-us', 'zh-cn']) {
      const expected = require(`../src/lang/${locale}.json`).setting__advanced_window_controls_default
      await update({ 'common.langId': locale })
      await page.waitForFunction(expected => document.querySelector('label[for="setting_advanced_window_controls_default"]').textContent.trim() === expected, expected)
    }
    await page.locator('label[for="setting_advanced_window_controls_icon_hover"]').click()
    await page.waitForFunction(() => window.lxData.appSetting['ui.windowControlsIconMode'] === 'hover')
    await page.reload()
    await page.waitForFunction(() => window.lxData?.appSetting?.['ui.windowControlStyle'] === 'traffic' && window.lxData.appSetting['ui.windowControlsIconMode'] === 'hover')
    assert.deepEqual(fixture.errors, [])
    await app.close()
    fixture = await launch({ profilePath }); app = fixture.app; page = fixture.page
    await route(page, '/setting?name=SettingAdvanced')
    await page.locator('[data-setting-tab="SettingAdvanced"]').click()
    assert.equal(await page.locator('#setting_advanced_window_controls_traffic').isChecked(), true)
    assert.equal(await page.locator('#setting_advanced_window_controls_icon_hover').isChecked(), true)
    await park()
    await waitIcons('#toolbar', names, false)
    assert.deepEqual(fixture.errors, [])
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ electron: await app.evaluate(() => process.versions.electron), combinations: 4, controlGroups: 4, persisted: true, errors: fixture.errors }, null, 2))
  } finally {
    await app.close()
  }
})

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
          const bounds = target => {
            const element = typeof target === 'string' ? document.querySelector(target) : target
            const { x, y, width, height, right, bottom } = element.getBoundingClientRect()
            return { x, y, width, height, right, bottom }
          }
          const rects = ['#left', '#toolbar', '#view', '#player', '#toolbar input', '#toolbar button:last-child', '#view [role="tablist"]'].map(bounds)
          // The navigation list can extend beyond its scrollport on small windows.
          // Check the visible menu region rather than the clipped list contents.
          rects.push(bounds(document.querySelector('#left [role="toolbar"]').parentElement))
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
