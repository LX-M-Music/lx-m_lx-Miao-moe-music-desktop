const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert')
const { launch, seedTrack, showDetail, settled } = require('./helpers/motion-fixture.cjs')
const themes = require('../src/common/theme/index.json')

const rendererPath = path.resolve('dist/index.html')

test('lyric zoom overshoots and played rows fade out when enabled', { timeout: 180000 }, async() => {
  const fixture = await launch({ rendererPath })
  const { app, page } = fixture
  try {
    page.setDefaultTimeout(10000)
    const theme = themes.find(value => value.id === 'black')
    await page.evaluate(colors => window.setTheme(colors), { ...theme.config.themeColors, ...theme.config.extInfo })
    await page.evaluate(() => window.lxData.updateSetting({
      'common.langId': 'zh-cn',
      'ui.ambientBackground': false,
      'player.isPlayLxlrc': true,
      'playDetail.isZoomActiveLrc': true,
      'playDetail.isDelayScroll': false,
      'playDetail.hidePassedLyric': true,
    }))
    await page.waitForFunction(() => window.lxData.appSetting['playDetail.hidePassedLyric'] === true)
    await seedTrack(page)
    await page.evaluate(() => Object.assign(window.lxData.musicInfo, {
      lrc: '[00:00.000]原文第一行\n[00:05.000]原文第二行\n[00:10.000]原文第三行',
      lxlrc: '[00:00.000]<0,1500>原文<1500,3000>第一行\n[00:05.000]<0,1500>原文<1500,3000>第二行\n[00:10.000]<0,1500>原文<1500,3000>第三行',
      tlrc: '',
    }))
    await page.evaluate(() => window.app_event.emit('lyricUpdated'))
    await showDetail(page, true)
    await settled(page)
    await page.waitForFunction(() => document.querySelectorAll('.line-content.font-mode').length > 1)
    await page.evaluate(() => window.app_event.setProgress(6))
    await page.waitForTimeout(500)

    const state = await page.evaluate(() => {
      const lyric = document.querySelector('.lyric')
      const rows = [...document.querySelectorAll('.line-content')]
      const row = rows.find(line => !line.classList.contains('active')) ?? rows[0]
      row.classList.add('played')
      const style = window.getComputedStyle(row)
      return {
        activeScale: lyric ? window.getComputedStyle(lyric).getPropertyValue('--lyric-active-scale').trim() : '',
        playedOpacity: Number(style.opacity),
        timing: style.transitionTimingFunction,
      }
    })

    assert.equal(state.activeScale, '1.14', 'zoom should be active for this test')
    assert(state.timing.includes('cubic-bezier'), `expected a timed scale transition, got ${state.timing}`)
    assert(state.timing.includes('1.56'), `expected the overshoot curve, got ${state.timing}`)
    assert.equal(state.playedOpacity, 0, `played row should be hidden, got ${state.playedOpacity}`)

    await page.evaluate(() => window.lxData.updateSetting({ 'playDetail.hidePassedLyric': false }))
    await page.waitForFunction(() => window.lxData.appSetting['playDetail.hidePassedLyric'] === false)
    await page.waitForTimeout(500)
    const visibleOpacity = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.line-content')].find(line => line.classList.contains('played'))
      return row ? Number(window.getComputedStyle(row).opacity) : null
    })
    assert.notEqual(visibleOpacity, 0, 'disabling the setting should restore played rows')

    assert.deepEqual(fixture.errors, [])
  } finally { await app.close() }
})
