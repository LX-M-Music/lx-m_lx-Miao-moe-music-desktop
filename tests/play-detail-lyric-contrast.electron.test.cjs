const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, seedTrack, seedLyrics, showDetail, settled } = require('./helpers/motion-fixture.cjs')
const { parseColor, contrastRatio, mixColor } = require('./helpers/load-typescript.cjs')()('src/renderer/utils/kawarpBackground/contrast.ts')
const themes = require('../src/common/theme/index.json')

const rendererPath = path.resolve('dist/index.html')

// Composite a text color (with its opacity) over every possible artwork tone and
// require a readable result, so the guarantee does not depend on the cover.
const worstCaseContrast = (color, opacity, surface, surfaceOpacity) => {
  const text = parseColor(color).slice(0, 3)
  const scrim = parseColor(surface)
  let worst = Infinity
  for (let tone = 0; tone <= 255; tone += 5) {
    const background = mixColor([tone, tone, tone], scrim.slice(0, 3), surfaceOpacity * scrim[3])
    const effective = mixColor(background, text, opacity)
    worst = Math.min(worst, contrastRatio(effective, background))
  }
  return worst
}

// The softened panel paints a vertical gradient; the fully opaque stop is the
// colour the reading area actually uses.
const scrimFill = backgroundImage => {
  const tokens = backgroundImage.match(/rgba?\([^)]*\)/g) ?? []
  const opaque = tokens.find(token => parseColor(token)[3] === 1)
  return opaque ?? tokens[0] ?? 'rgba(0, 0, 0, 0)'
}

test('play detail lyrics keep a readable surface over bright and dark artwork', { timeout: 180000 }, async t => {
  const fixture = await launch({ rendererPath })
  const { app, page } = fixture
  const output = path.resolve('output/playwright/play-detail-lyric-contrast')
  const update = values => page.evaluate(values => window.lxData.updateSetting(values), values)
  const read = () => page.evaluate(() => {
    const right = document.querySelector('.right')
    const lyric = document.querySelector('.lyric')
    // The scrim must live on the viewport-anchored column, not on the scroller,
    // otherwise it travels away with the rows.
    const before = window.getComputedStyle(right, '::before')
    const lyricBefore = window.getComputedStyle(lyric, '::before')
    const readLine = selector => {
      const element = document.querySelector(selector)
      if (!element) return null
      const style = window.getComputedStyle(element)
      return { color: style.color, opacity: Number(style.opacity), shadow: style.textShadow }
    }
    return {
      ambientLyrics: right.hasAttribute('data-ambient-lyrics'),
      scrim: { content: before.content, backgroundImage: before.backgroundImage, opacity: Number(before.opacity), radius: before.borderRadius },
      lyricScrim: lyricBefore.content,
      inactive: readLine('.line-content:not(.active)'),
      active: readLine('.line-content.active'),
      count: document.querySelectorAll('.line-content').length,
    }
  })
  try {
    await fs.mkdir(output, { recursive: true })
    page.setDefaultTimeout(10000)
    await update({
      'common.langId': 'zh-cn',
      'ui.ambientBackground': false,
      'playDetail.isZoomActiveLrc': false,
    })
    // A bright cover is the case where the old fixed gray text disappeared.
    await seedTrack(page)
    await page.evaluate(() => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#e8e8e8"/><rect y="380" width="600" height="220" fill="#9a9a9a"/></svg>'
      window.lxData.musicInfo.pic = 'data:image/svg+xml,' + encodeURIComponent(svg)
    })
    await showDetail(page, true)
    await settled(page)
    await seedLyrics(page)
    await page.waitForFunction(() => document.querySelectorAll('.line-content').length > 3)

    for (const id of ['green', 'black']) {
      await t.test(`${id} theme gives the lyric column a scrim and readable text`, async() => {
        const theme = themes.find(value => value.id === id)
        await page.evaluate(colors => window.setTheme(colors), { ...theme.config.themeColors, ...theme.config.extInfo })
        await page.waitForTimeout(300)
        const state = await read()
        assert.equal(state.ambientLyrics, false, 'this case covers the non-ambient background path')
        assert(state.count > 3, 'lyrics must be rendered')
        assert.notEqual(state.scrim.content, 'none', 'the lyric column must paint a scrim')
        assert.equal(state.scrim.radius, '0px', `the scrim must stay square, got ${state.scrim.radius}`)
        assert.equal(state.lyricScrim, 'none', 'the scroller must not paint its own moving scrim')
        assert(state.scrim.opacity >= 0.7, `scrim opacity ${state.scrim.opacity}`)
        assert(state.scrim.backgroundImage.includes('linear-gradient'), 'the scrim must fade its edges')
        for (const line of [state.inactive, state.active]) {
          assert.ok(line, 'expected both an active and an inactive lyric line')
          assert.notEqual(line.shadow, 'none', 'lyrics must keep a text shadow')
          const contrast = worstCaseContrast(line.color, line.opacity, scrimFill(state.scrim.backgroundImage), state.scrim.opacity)
          assert(contrast >= 3, `contrast ${contrast.toFixed(2)} for ${line.color} @ ${line.opacity}`)
        }
        await page.screenshot({ path: path.join(output, `lyrics-${id}.png`) })
      })
    }
    assert.deepEqual(fixture.errors, [])
  } finally {
    await app.close()
  }
})
