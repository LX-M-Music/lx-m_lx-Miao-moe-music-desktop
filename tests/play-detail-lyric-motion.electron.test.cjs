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

test('the translation and romanization are wiped in with the karaoke progress', { timeout: 180000 }, async() => {
  const fixture = await launch({ rendererPath })
  const { app, page } = fixture
  // Reveal follows the length of each sung word, so "第一" (2 chars, 0-2s) and
  // "行" (1 char, 2-4s) give 0.167 at 0.5s, 0.6 at 1.8s and 1 after 4s.
  const readTranslation = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('.line-content')]
    const active = rows.find(row => row.classList.contains('active'))
    const inner = active?.querySelector('.extended .font-lrc')
    const style = inner ? window.getComputedStyle(inner) : null
    const passed = rows[0]?.querySelector('.extended .font-lrc')
    return {
      reveal: Number(active?.style.getPropertyValue('--lyric-reveal') || 0),
      // background-size carries the sweep: its width is the sung share of the line.
      sweep: style ? parseFloat(style.backgroundSize) : NaN,
      fill: style?.webkitTextFillColor,
      passedSweep: passed ? parseFloat(window.getComputedStyle(passed).backgroundSize) : NaN,
      activeIndex: rows.indexOf(active),
      translations: rows.filter(row => row.querySelector('.extended')).length,
    }
  })
  try {
    page.setDefaultTimeout(10000)
    const theme = themes.find(value => value.id === 'black')
    await page.evaluate(colors => window.setTheme(colors), { ...theme.config.themeColors, ...theme.config.extInfo })
    await page.evaluate(() => window.lxData.updateSetting({
      'common.langId': 'zh-cn',
      'ui.ambientBackground': true,
      'ui.ambientBackgroundAutoContrast': true,
      'player.isPlayLxlrc': true,
      'player.isShowLyricTranslation': true,
      'playDetail.isZoomActiveLrc': false,
      'playDetail.isDelayScroll': false,
    }))
    await seedTrack(page)
    await page.evaluate(() => Object.assign(window.lxData.musicInfo, {
      lrc: '[00:00.000]第一行\n[00:08.000]第二行',
      lxlrc: '[00:00.000]<0,2000>第一<2000,2000>行\n[00:08.000]<0,2000>第二<2000,2000>行',
      tlrc: '[00:00.000]译文第一行\n[00:08.000]译文第二行',
    }))
    await page.evaluate(() => window.app_event.emit('lyricUpdated'))
    await showDetail(page, true)
    await settled(page)
    await page.waitForFunction(() => document.querySelectorAll('.line-content.font-mode .extended').length >= 2)
    await page.waitForFunction(() => document.querySelectorAll('.line-content.active').length === 1)

    await page.evaluate(() => window.app_event.setProgress(0.5))
    await page.waitForTimeout(500)
    const early = await readTranslation()
    assert(early.translations >= 2, 'both lines carry a translation')
    assert(Math.abs(early.reveal - 0.167) < 0.02, `a quarter of the line is sung at 0.5s, got ${early.reveal}`)
    // The translation is painted through a clipped background like the karaoke
    // characters, so its sweep has to match the published reveal.
    assert.equal(early.fill, 'rgba(0, 0, 0, 0)', `the translation should use the clipped reveal, got ${early.fill}`)
    assert(Math.abs(early.sweep - 16.7) < 1.5, `the translation should be wiped to the sung share, got ${early.sweep}%`)

    await page.evaluate(() => window.app_event.setProgress(1.8))
    await page.waitForTimeout(500)
    const middle = await readTranslation()
    assert(Math.abs(middle.reveal - 0.6) < 0.02, `most of the first word is sung at 1.8s, got ${middle.reveal}`)
    assert(Math.abs(middle.sweep - 60) < 2, `the wipe follows the karaoke, got ${middle.sweep}%`)
    assert(middle.sweep > early.sweep, 'the sweep must advance while the line is sung')

    // A paused sheet holds its value: no ticks arrive and nothing may drift.
    await page.waitForTimeout(250)
    const stillPaused = await readTranslation()
    assert(Math.abs(stillPaused.sweep - middle.sweep) < 0.5, `a paused sweep must stand still, got ${middle.sweep}% then ${stillPaused.sweep}%`)

    // While playing the sweep has to move between ticks too: waiting for the next
    // progress update left it visibly behind the sung characters.
    const playing = await page.evaluate(() => {
      for (const component of window.__motionComponents()) {
        if (component.setupState && 'isPlay' in component.setupState) {
          component.setupState.isPlay = true
          return true
        }
      }
      return false
    })
    assert(playing, 'the playback state must be reachable to simulate playback')
    await page.evaluate(() => window.app_event.setProgress(1.82))
    await page.waitForTimeout(80)
    const frameA = await readTranslation()
    await page.waitForTimeout(220)
    const frameB = await readTranslation()
    assert(frameB.sweep > frameA.sweep + 1, `the sweep must advance between ticks, got ${frameA.sweep}% then ${frameB.sweep}%`)
    await page.evaluate(() => {
      for (const component of window.__motionComponents()) {
        if (component.setupState && 'isPlay' in component.setupState) component.setupState.isPlay = false
      }
    })
    await page.waitForTimeout(300)

    await page.evaluate(() => window.app_event.setProgress(4.5))
    await page.waitForTimeout(500)
    const completed = await readTranslation()
    assert(Math.abs(completed.reveal - 1) < 0.02, `the line is fully sung at 4.5s, got ${completed.reveal}`)
    assert(Math.abs(completed.sweep - 100) < 1, `the translation ends fully lit, got ${completed.sweep}%`)

    // The line-relative progress must reset with the next line, not carry over.
    await page.evaluate(() => window.app_event.setProgress(8.4))
    await page.waitForTimeout(500)
    const next = await readTranslation()
    assert.equal(next.activeIndex, 1, 'the second row is active at 8.4s')
    assert(Math.abs(next.reveal - 0.133) < 0.02, `the new line starts near the unplayed tone, got ${next.reveal}`)
    assert(Math.abs(next.sweep - 13.3) < 1.5, `the new translation starts dim again, got ${next.sweep}%`)
    // A finished line keeps the full tone: nothing is left half-sung above the focus.
    assert(Math.abs(next.passedSweep - 100) < 1, `the finished line should stay fully revealed, got ${next.passedSweep}%`)

    // Without the dynamic background the stock translation keeps painting text.

    // Without the dynamic background the stock translation keeps painting text.
    await page.evaluate(() => window.lxData.updateSetting({ 'ui.ambientBackground': false }))
    await page.waitForFunction(() => window.lxData.appSetting['ui.ambientBackground'] === false)
    await page.waitForTimeout(400)
    const stock = await page.evaluate(() => {
      const inner = document.querySelector('.line-content .extended .font-lrc')
      return {
        fill: window.getComputedStyle(inner).webkitTextFillColor,
        reveal: inner.closest('.line-content').style.getPropertyValue('--lyric-reveal'),
      }
    })
    assert.notEqual(stock.fill, 'rgba(0, 0, 0, 0)', `the stock translation must paint normal text, got ${stock.fill}`)
    assert.equal(stock.reveal, '', 'no karaoke reveal is published without the dynamic background')

    assert.deepEqual(fixture.errors, [])
  } finally { await app.close() }
})
