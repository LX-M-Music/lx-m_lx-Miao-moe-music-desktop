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

    // The scrim must be anchored to the column, not to the scrolling rows.
    const scrim = await page.evaluate(() => ({
      column: window.getComputedStyle(document.querySelector('.right'), '::before').content,
      scroller: window.getComputedStyle(document.querySelector('.lyric'), '::before').content,
    }))
    assert.notEqual(scrim.column, 'none', 'the column must paint the reading scrim')
    assert.equal(scrim.scroller, 'none', 'the scrolling lyric element must not paint a scrim')

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
