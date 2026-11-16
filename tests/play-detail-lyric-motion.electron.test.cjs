const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert')
const { launch, seedTrack, showDetail, settled } = require('./helpers/motion-fixture.cjs')
const themes = require('../src/common/theme/index.json')

const rendererPath = path.resolve('dist/index.html')

const readRows = page => page.evaluate(() => {
  const lyric = document.querySelector('.lyric')
  return {
    activeScale: lyric ? window.getComputedStyle(lyric).getPropertyValue('--lyric-active-scale').trim() : '',
    rows: [...document.querySelectorAll('.line-content')].map(row => ({
      active: row.classList.contains('active'),
      passed: row.classList.contains('isPassed'),
      upcoming: row.classList.contains('isUpcoming'),
      distance: row.dataset.lyricDistance,
      opacity: Number(window.getComputedStyle(row).opacity),
      timing: window.getComputedStyle(row).transitionTimingFunction,
    })),
  }
})

test('line-level lyrics fade passed rows and keep the zoom overshoot', { timeout: 180000 }, async() => {
  const fixture = await launch({ rendererPath })
  const { app, page } = fixture
  try {
    page.setDefaultTimeout(10000)
    const theme = themes.find(value => value.id === 'black')
    await page.evaluate(colors => window.setTheme(colors), { ...theme.config.themeColors, ...theme.config.extInfo })
    await page.evaluate(() => window.lxData.updateSetting({
      'common.langId': 'zh-cn',
      'ui.ambientBackground': false,
      'player.isPlayLxlrc': false,
      'playDetail.isZoomActiveLrc': true,
      'playDetail.isDelayScroll': false,
      'playDetail.hidePassedLyric': true,
    }))
    await page.waitForFunction(() => window.lxData.appSetting['playDetail.hidePassedLyric'] === true)
    await seedTrack(page)
    await page.evaluate(() => Object.assign(window.lxData.musicInfo, {
      lrc: '[00:00.000]第一行\n[00:02.000]第二行\n[00:04.000]第三行\n[00:06.000]第四行',
      lxlrc: '',
      tlrc: '',
    }))
    await page.evaluate(() => window.app_event.emit('lyricUpdated'))
    await showDetail(page, true)
    await settled(page)
    await page.waitForFunction(() => document.querySelectorAll('.line-content.line-mode').length === 4)
    await page.evaluate(() => window.app_event.setProgress(5))
    await page.waitForFunction(() => document.querySelectorAll('.line-content.active').length === 1)
    await page.waitForTimeout(600)

    const state = await readRows(page)
    assert.equal(state.activeScale, '1.14', 'zoom should be active for this test')
    assert.equal(state.rows.length, 4)
    assert(state.rows[0].passed && state.rows[1].passed, 'rows above the active line are passed')
    assert(state.rows[0].opacity > 0.1 && state.rows[0].opacity < 0.6, `passed row stays readable, got ${state.rows[0].opacity}`)
    assert(state.rows[1].opacity > state.rows[0].opacity, `the row closer to the focus is brighter, got ${state.rows[0].opacity} then ${state.rows[1].opacity}`)
    assert(state.rows[0].distance === '2' && state.rows[1].distance === '1', 'passed rows carry their distance from the active line')
    assert(state.rows[2].active, 'third row should be active at 5s')
    assert(!state.rows[2].passed, 'active row is never marked as passed')
    assert(state.rows[2].opacity > 0.9, `active row stays visible, got ${state.rows[2].opacity}`)
    assert(state.rows[3].upcoming, 'upcoming rows are marked so they can fade in')
    assert(state.rows[3].opacity > 0.2 && state.rows[3].opacity < 0.9, `upcoming row stays dimmer than the active one, got ${state.rows[3].opacity}`)
    assert(state.rows[2].timing.includes('cubic-bezier'), `expected a timed scale transition, got ${state.rows[2].timing}`)
    assert(state.rows[2].timing.includes('1.56'), `expected the overshoot curve, got ${state.rows[2].timing}`)

    await page.evaluate(() => window.lxData.updateSetting({ 'playDetail.hidePassedLyric': false }))
    await page.waitForFunction(() => window.lxData.appSetting['playDetail.hidePassedLyric'] === false)
    await page.waitForTimeout(600)
    const restored = await readRows(page)
    assert(restored.rows.every(row => !row.passed && !row.upcoming), 'disabling the setting clears every focus mark')
    assert(restored.rows[0].opacity > 0.5, `disabling should restore passed rows, got ${restored.rows[0].opacity}`)

    assert.deepEqual(fixture.errors, [])
  } finally { await app.close() }
})
