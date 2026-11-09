const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, seedTrack, seedLyrics, showDetail, settled } = require('./helpers/motion-fixture.cjs')
const { parseColor } = require('./helpers/load-typescript.cjs')()('src/renderer/utils/kawarpBackground/contrast.ts')
const themes = require('../src/common/theme/index.json')

const rendererPath = path.resolve('dist/index.html')
const sameColor = (a, b) => {
  const left = parseColor(a).slice(0, 3)
  const right = parseColor(b).slice(0, 3)
  return left.every((value, index) => Math.abs(value - right[index]) <= 1)
}

test('play detail lyrics stay readable without a background panel', { timeout: 180000 }, async t => {
  const fixture = await launch({ rendererPath })
  const { app, page } = fixture
  const output = path.resolve('output/playwright/play-detail-lyric-contrast')
  const update = values => page.evaluate(values => window.lxData.updateSetting(values), values)
  const read = ambient => page.evaluate(ambient => {
    const right = document.querySelector('.right')
    const lyric = document.querySelector('.lyric')
    const inactive = document.querySelector('.line-content:not(.active)')
    const active = document.querySelector('.line-content.active')
    const readLine = element => {
      if (!element) return null
      const style = window.getComputedStyle(element)
      return { color: style.color, opacity: Number(style.opacity), shadow: style.textShadow }
    }
    return {
      ambientLyrics: right.hasAttribute('data-ambient-lyrics'),
      rightScrim: window.getComputedStyle(right, '::before').content,
      lyricScrim: window.getComputedStyle(lyric, '::before').content,
      themeFont: window.getComputedStyle(right).getPropertyValue('--color-font').trim(),
      idleVar: window.getComputedStyle(right).getPropertyValue('--lyric-idle-color').trim(),
      inactive: readLine(inactive),
      active: readLine(active),
      count: document.querySelectorAll('.line-content').length,
    }
  }, ambient)
  const hasHalo = shadow => ['-1px 0px 0px', '1px 0px 0px', '0px -1px 0px', '0px 1px 0px', '0px 2px 6px'].every(token => shadow.includes(token))

  try {
    await fs.mkdir(output, { recursive: true })
    page.setDefaultTimeout(10000)
    await update({
      'common.langId': 'zh-cn',
      'ui.ambientBackground': false,
      'playDetail.isZoomActiveLrc': false,
    })
    await seedTrack(page)
    // Bright cover: the case where the fixed gray text used to disappear.
    await page.evaluate(() => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#e8e8e8"/><rect y="380" width="600" height="220" fill="#9a9a9a"/></svg>'
      window.lxData.musicInfo.pic = 'data:image/svg+xml,' + encodeURIComponent(svg)
    })
    await showDetail(page, true)
    await settled(page)
    await seedLyrics(page)
    await page.waitForFunction(() => document.querySelectorAll('.line-content').length > 3)

    for (const id of ['green', 'black']) {
      await t.test(`${id} theme keeps text readable with no panel`, async() => {
        const theme = themes.find(value => value.id === id)
        await page.evaluate(colors => window.setTheme(colors), { ...theme.config.themeColors, ...theme.config.extInfo })
        await page.waitForTimeout(300)
        const state = await read(false)
        assert.equal(state.count > 3, true, 'lyrics must be rendered')
        assert.equal(state.rightScrim, 'none', 'the lyric column must not paint a panel')
        assert.equal(state.lyricScrim, 'none', 'the scroller must not paint a panel')
        for (const line of [state.inactive, state.active]) {
          assert.ok(line, 'expected both an active and an inactive lyric line')
          assert(hasHalo(line.shadow), `expected a four-side halo, got ${line.shadow}`)
        }
        assert(sameColor(state.inactive.color, state.themeFont), `line colour ${state.inactive.color} should follow ${state.themeFont}`)
        assert((state.inactive.opacity) >= 0.9, `inactive lyrics are too dim: ${state.inactive.opacity}`)
        await page.screenshot({ path: path.join(output, `lyrics-${id}.png`) })
      })
    }

    await t.test('dynamic background mode uses the adaptive primary text colour', async() => {
      await update({ 'ui.ambientBackground': true })
      await page.waitForFunction(() => document.querySelector('.right')?.hasAttribute('data-ambient-lyrics'))
      await page.waitForTimeout(600)
      const state = await read(true)
      assert.equal(state.ambientLyrics, true, 'expected the ambient lyric mode')
      assert.equal(state.rightScrim, 'none', 'no panel while the dynamic background is on')
      assert.equal(state.lyricScrim, 'none', 'the scroller must not paint a panel')
      assert.notEqual(state.inactive.color, 'rgb(155, 155, 155)', 'must not fall back to the fixed secondary gray')
      assert(sameColor(state.idleVar, state.themeFont), `idle variable ${state.idleVar} should follow the adaptive text ${state.themeFont}`)
      assert(state.inactive.opacity >= 0.9, `ambient lyrics are too dim: ${state.inactive.opacity}`)
      await page.screenshot({ path: path.join(output, 'lyrics-ambient.png') })
    })

    assert.deepEqual(fixture.errors, [])
  } finally {
    await app.close()
  }
})
