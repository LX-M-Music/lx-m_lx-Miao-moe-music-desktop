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

test('lyrics under the adaptive background keep a focus gradient and the zoom overshoot', { timeout: 180000 }, async() => {
  const fixture = await launch({ rendererPath })
  const { app, page } = fixture
  try {
    page.setDefaultTimeout(10000)
    const theme = themes.find(value => value.id === 'black')
    await page.evaluate(colors => window.setTheme(colors), { ...theme.config.themeColors, ...theme.config.extInfo })
    await page.evaluate(() => window.lxData.updateSetting({
      'common.langId': 'zh-cn',
      'ui.ambientBackground': true,
      'ui.ambientBackgroundAutoContrast': true,
      'player.isPlayLxlrc': false,
      'playDetail.isZoomActiveLrc': true,
      'playDetail.isDelayScroll': false,
    }))
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

    await page.evaluate(() => window.lxData.updateSetting({ 'ui.ambientBackground': false }))
    await page.waitForFunction(() => window.lxData.appSetting['ui.ambientBackground'] === false)
    await page.waitForTimeout(600)
    const restored = await readRows(page)
    assert(restored.rows.every(row => !row.passed && !row.upcoming), 'without the adaptive background every focus mark is cleared')
    assert(restored.rows[0].opacity > 0.5, `stock lyric opacity should return, got ${restored.rows[0].opacity}`)

    assert.deepEqual(fixture.errors, [])
  } finally { await app.close() }
})

test('word-level lyrics crossfade the active row with the next one', { timeout: 180000 }, async() => {
  const fixture = await launch({ rendererPath })
  const { app, page } = fixture
  try {
    page.setDefaultTimeout(10000)
    const theme = themes.find(value => value.id === 'black')
    await page.evaluate(colors => window.setTheme(colors), { ...theme.config.themeColors, ...theme.config.extInfo })
    await page.evaluate(() => window.lxData.updateSetting({
      'common.langId': 'zh-cn',
      'ui.ambientBackground': true,
      'ui.ambientBackgroundAutoContrast': true,
      'player.isPlayLxlrc': true,
      'playDetail.isZoomActiveLrc': false,
      'playDetail.isDelayScroll': false,
    }))
    await seedTrack(page)
    await page.evaluate(() => Object.assign(window.lxData.musicInfo, {
      lrc: '[00:00.000]第一行\n[00:04.000]第二行\n[00:08.000]第三行\n[00:12.000]第四行',
      lxlrc: '[00:00.000]<0,1000>第一<1000,1000>行\n[00:04.000]<0,1000>第二<1000,1000>行\n[00:08.000]<0,1000>第三<1000,1000>行\n[00:12.000]<0,1000>第四<1000,1000>行',
      tlrc: '',
    }))
    await page.evaluate(() => window.app_event.emit('lyricUpdated'))
    await showDetail(page, true)
    await settled(page)
    await page.waitForFunction(() => document.querySelectorAll('.line-content.font-mode').length === 4)
    await page.waitForFunction(() => document.querySelectorAll('.line-content.active').length === 1)

    await page.evaluate(() => window.app_event.setProgress(1.5))
    await page.waitForTimeout(700)
    const midway = await readRows(page)
    assert(midway.rows[0].active, 'the first row is active at 1.5s')
    assert(midway.rows[0].opacity > 0.55 && midway.rows[0].opacity < 0.95, `active row should be mid-fade, got ${midway.rows[0].opacity}`)
    assert(midway.rows[1].opacity > 0.7 && midway.rows[1].opacity < 0.95, `next row should be fading in, got ${midway.rows[1].opacity}`)

    await page.evaluate(() => window.app_event.setProgress(2.9))
    await page.waitForTimeout(700)
    const finished = await readRows(page)
    assert(finished.rows[0].active, 'the first row is still active just before 4s')
    assert(finished.rows[0].opacity < 0.5, `active row should reach the passed level before switching, got ${finished.rows[0].opacity}`)
    assert(finished.rows[1].opacity > 0.95, `next row should already be bright before switching, got ${finished.rows[1].opacity}`)

    assert.deepEqual(fixture.errors, [])
  } finally { await app.close() }
})
