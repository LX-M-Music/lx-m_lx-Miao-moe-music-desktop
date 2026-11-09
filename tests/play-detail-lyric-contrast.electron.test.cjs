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

// A translation / romanization row must keep the same colour as its lyric line.
const addTranslation = page => page.evaluate(() => {
  const line = document.querySelectorAll('.line-content')[1]
  if (document.querySelector('.test-translation')) return
  const extended = document.createElement('div')
  extended.className = 'extended'
  const text = document.createElement('div')
  text.className = 'font-lrc test-translation'
  text.textContent = '翻译/音译'
  extended.appendChild(text)
  line.appendChild(extended)
})

test('play detail lyrics keep one colour and the stock look without the dynamic background', { timeout: 180000 }, async t => {
  const fixture = await launch({ rendererPath })
  const { app, page } = fixture
  const output = path.resolve('output/playwright/play-detail-lyric-contrast')
  const update = values => page.evaluate(values => window.lxData.updateSetting(values), values)
  const read = () => page.evaluate(() => {
    const right = document.querySelector('.right')
    const lyric = document.querySelector('.lyric')
    const idle = document.querySelector('.line-content:not(.active)')
    const active = document.querySelector('.line-content.active')
    const translation = document.querySelector('.test-translation')
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
      lyricText: window.getComputedStyle(right).getPropertyValue('--lyric-text').trim(),
      themeSecondary: window.getComputedStyle(right).getPropertyValue('--color-450').trim(),
      idleVar: window.getComputedStyle(right).getPropertyValue('--lyric-idle-color').trim(),
      idle: readLine(idle?.querySelector('.font-lrc')),
      active: readLine(active?.querySelector('.font-lrc')),
      translation: readLine(translation),
      lineOpacity: Number(window.getComputedStyle(idle).opacity),
      count: document.querySelectorAll('.line-content').length,
    }
  })
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
    await page.evaluate(() => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#e8e8e8"/><rect y="380" width="600" height="220" fill="#9a9a9a"/></svg>'
      window.lxData.musicInfo.pic = 'data:image/svg+xml,' + encodeURIComponent(svg)
    })
    await showDetail(page, true)
    await settled(page)
    await seedLyrics(page)
    await page.waitForFunction(() => document.querySelectorAll('.line-content').length > 3)
    await addTranslation(page)

    for (const id of ['green', 'black']) {
      await t.test(`${id} theme keeps the stock lyric styling`, async() => {
        const theme = themes.find(value => value.id === id)
        await page.evaluate(colors => window.setTheme(colors), { ...theme.config.themeColors, ...theme.config.extInfo })
        await page.waitForTimeout(300)
        const state = await read()
        assert.equal(state.count > 3, true, 'lyrics must be rendered')
        assert.equal(state.rightScrim, 'none', 'the lyric column must not paint a panel')
        assert.equal(state.lyricScrim, 'none', 'the scroller must not paint a panel')
        assert.equal(state.idle.shadow, 'none', 'no halo without the dynamic background')
        assert(sameColor(state.idle.color, state.themeSecondary), `line colour ${state.idle.color} should follow ${state.themeSecondary}`)
        assert(Math.abs(state.lineOpacity - 0.64) <= 0.01, `inactive opacity ${state.lineOpacity}`)
        assert(sameColor(state.translation.color, state.idle.color), 'translation must match the lyric colour')
        await page.screenshot({ path: path.join(output, `lyrics-${id}.png`) })
      })
    }

    await t.test('dynamic background keeps every lyric row on one adaptive colour', async() => {
      await update({ 'ui.ambientBackground': true })
      await page.waitForFunction(() => document.querySelector('.right')?.hasAttribute('data-ambient-lyrics'))
      await page.waitForTimeout(600)
      // Comparing colours while the 250 ms colour transition runs would sample an
      // intermediate frame; freeze transitions for a deterministic read.
      await page.evaluate(() => document.documentElement.classList.add('disableAnimation'))
      await page.waitForTimeout(50)
      const state = await read()
      assert.equal(state.ambientLyrics, true, 'expected the ambient lyric mode')
      assert.equal(state.rightScrim, 'none', 'no panel while the dynamic background is on')
      assert.equal(state.lyricScrim, 'none', 'the scroller must not paint a panel')
      assert(hasHalo(state.idle.shadow), `expected the subtitle halo, got ${state.idle.shadow}`)
      assert(state.lyricText.length > 0, 'the reading area must publish a lyric colour')
      assert(sameColor(state.idleVar, state.lyricText), `idle variable ${state.idleVar} should follow ${state.lyricText}`)
      assert(sameColor(state.idle.color, state.lyricText), 'idle lyrics should use the reading-area colour')
      const channels = parseColor(state.idle.color).slice(0, 3)
      assert(channels[0] === channels[1] && channels[1] === channels[2], `lyric colour must be neutral, got ${state.idle.color}`)
      assert(sameColor(state.active.color, state.idle.color), 'activating a line must not recolour the sheet')
      assert(sameColor(state.translation.color, state.idle.color), 'translation must match the lyric colour')
      assert(state.lineOpacity >= 0.9, `inactive lyrics are too dim: ${state.lineOpacity}`)
      await page.screenshot({ path: path.join(output, 'lyrics-ambient.png') })
    })

    assert.deepEqual(fixture.errors, [])
  } finally {
    await app.close()
  }
})
