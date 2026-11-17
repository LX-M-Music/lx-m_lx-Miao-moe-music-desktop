const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, seedTrack, seedLyrics, showDetail, settled } = require('./helpers/motion-fixture.cjs')

const rendererPath = path.resolve('dist/index.html')

test('play detail lyrics scroll the active line to the visual center', { timeout: 180000 }, async() => {
  const fixture = await launch({ rendererPath })
  const { app, page } = fixture
  try {
    page.setDefaultTimeout(10000)
    await page.evaluate(() => window.lxData.updateSetting({
      'common.langId': 'zh-cn',
      'ui.ambientBackground': false,
      'playDetail.isZoomActiveLrc': false,
      'playDetail.isDelayScroll': false,
    }))
    await seedTrack(page)
    await showDetail(page, true)
    await settled(page)
    await seedLyrics(page)
    await page.waitForFunction(() => document.querySelectorAll('.line-content').length > 5)
    const metrics = await page.evaluate(() => {
      const view = document.querySelector('.lyric')
      const lines = [...view.querySelectorAll('.line-content')]
      return {
        preHeight: view.children[0].getBoundingClientRect().height,
        firstTop: lines[0].offsetTop,
      }
    })
    // The rows must be measured from the scroll container: a positioned row
    // wrapper silently drops the leading spacer from offsetTop and breaks centring.
    assert(metrics.preHeight > 100, `expected a leading spacer, got ${metrics.preHeight}`)
    assert(Math.abs(metrics.firstTop - metrics.preHeight) <= 1, `first row top ${metrics.firstTop} should equal spacer ${metrics.preHeight}`)

    // No background panel: readability comes from the text treatment instead.
    const panels = await page.evaluate(() => ({
      column: window.getComputedStyle(document.querySelector('.right'), '::before').content,
      scroller: window.getComputedStyle(document.querySelector('.lyric'), '::before').content,
    }))
    assert.equal(panels.column, 'none', 'the lyric column must not paint a panel')
    assert.equal(panels.scroller, 'none', 'the scrolling lyric element must not paint a panel')

    // Instant scrolling keeps the geometry assertion independent of the spring.
    await page.evaluate(() => { document.documentElement.dataset.motionEnabled = 'false' })
    await page.evaluate(() => {
      window.__motionLyric.line = 4
      window.__motionLyric.text = window.__motionLyric.lines[4]?.text
    })
    await page.waitForFunction(() => document.querySelector('.lyric').scrollTop > 0)
    const state = await page.evaluate(() => {
      const view = document.querySelector('.lyric')
      const line = view.querySelectorAll('.line-content')[4]
      const viewRect = view.getBoundingClientRect()
      const lineRect = line.getBoundingClientRect()
      return {
        scrollTop: view.scrollTop,
        expected: line.offsetTop + line.offsetHeight / 2 - view.clientHeight / 2,
        centerOffset: Math.abs(lineRect.top + lineRect.height / 2 - (viewRect.top + viewRect.height / 2)),
        viewHeight: view.clientHeight,
      }
    })
    assert(Math.abs(state.scrollTop - state.expected) <= 2, `scrollTop ${state.scrollTop} != expected ${state.expected}`)
    assert(state.centerOffset <= 2, `active line is ${state.centerOffset}px away from the center`)
    assert.deepEqual(fixture.errors, [])
  } finally {
    await app.close()
  }
})

test('browsing the lyric sheet keeps every row at full strength', { timeout: 180000 }, async() => {
  const fixture = await launch({ rendererPath })
  const { app, page } = fixture
  const opacities = () => page.evaluate(() => [...document.querySelectorAll('.line-content')].map(row => Number(window.getComputedStyle(row).opacity)))
  try {
    page.setDefaultTimeout(10000)
    await page.evaluate(() => window.lxData.updateSetting({
      'common.langId': 'zh-cn',
      'ui.ambientBackground': true,
      'ui.ambientBackgroundAutoContrast': true,
      'playDetail.isZoomActiveLrc': false,
      'playDetail.isDelayScroll': false,
    }))
    await seedTrack(page)
    await showDetail(page, true)
    await settled(page)
    await seedLyrics(page)
    await page.waitForFunction(() => document.querySelectorAll('.line-content').length > 5)
    await page.evaluate(() => { window.__motionLine(3) })
    await page.waitForFunction(() => document.querySelectorAll('.line-content.isPassed').length > 0)
    // Transitions do not advance in this hidden window, so read the target values.
    await page.evaluate(() => document.documentElement.classList.add('disableAnimation'))
    await page.waitForTimeout(400)

    // Distance shading is what dims the rows the reader is looking at.
    const dimmed = await opacities()
    assert(dimmed[0] < 0.5, `rows above the active line are dimmed before scrolling, got ${dimmed[0]}`)

    const box = await page.locator('.lyric').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 180)
    await page.waitForFunction(() => [...document.querySelectorAll('.line-content')].every(row => Number(window.getComputedStyle(row).opacity) === 1))
    const browsing = await opacities()
    assert(browsing.every(value => value === 1), `every row stays lit while scrolling, got ${JSON.stringify(browsing)}`)

    // Playback takes the sheet back after the idle pause and the shading returns.
    await page.waitForFunction(() => Number(window.getComputedStyle(document.querySelector('.line-content')).opacity) < 0.5, { timeout: 9000 })
    const restored = await opacities()
    assert(restored[0] < 0.5, `the focus shading returns once browsing ends, got ${restored[0]}`)
    assert.deepEqual(fixture.errors, [])
  } finally {
    await app.close()
  }
})
