const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')()
const { artworkColor, compositeBackgrounds, contrastRatio, controlRegions, createAdaptivePalette, createControlColors, mixColor, parseColor, stabilizeColor, toHsl } = load('src/renderer/utils/kawarpBackground/contrast.ts')

const white = [255, 255, 255]
const black = [0, 0, 0]
const covers = [white, black, [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255]]
const themes = [[255, 255, 255, 1], [19, 19, 19, 0.9]]
const readable = (foreground, backgrounds, label, minimum = 4.5) => {
  for (const background of backgrounds) assert(contrastRatio(foreground, background) >= minimum, `${label}: ${foreground} / ${background}`)
}

test('controls and text remain readable across bright, dark and saturated artwork on both theme surfaces', () => {
  for (const theme of themes) {
    for (const cover of [...covers.map(color => [color]), covers]) {
      const backgrounds = compositeBackgrounds(cover, theme, 0.3)
      const palette = createAdaptivePalette(backgrounds, cover[0])
      const surfaces = [...backgrounds, palette.surface, palette.hover, palette.active]
      readable(palette.accent, surfaces, 'button/selected text')
      readable(palette.text, surfaces, 'body text')
      readable(palette.secondary, surfaces, 'labels')
      readable(palette.onAccent, [palette.accent], 'text selection')
      assert.equal(palette.darkText, theme[0] > 128)
    }
  }
})

test('crossfading opposite covers preserves contrast at every stage', () => {
  for (const theme of themes) {
    let previous
    for (let step = 0; step <= 20; step++) {
      const color = mixColor([235, 40, 50], [40, 70, 230], step / 20)
      const backgrounds = compositeBackgrounds([color], theme, 0.3)
      const palette = createAdaptivePalette(backgrounds, color, previous)
      readable(palette.accent, backgrounds, 'crossfade')
      readable(palette.onAccent, [palette.accent], 'crossfade selection')
      previous = palette.darkText
    }
  }
})

test('the accent follows artwork hues and chooses the best contrast on middle-gray surfaces', () => {
  const red = createAdaptivePalette(compositeBackgrounds([[240, 20, 30]], themes[0], 0.3), [240, 20, 30])
  const blue = createAdaptivePalette(compositeBackgrounds([[20, 30, 240]], themes[0], 0.3), [20, 30, 240])
  assert(red.accent[0] > red.accent[2])
  assert(blue.accent[2] > blue.accent[0])
  for (let value = 0; value <= 255; value += 5) {
    const background = [value, value, value]
    const palette = createAdaptivePalette([background], background)
    readable(palette.accent, [background], 'gray', 4.4)
    readable(palette.onAccent, [palette.accent], 'gray selection')
  }
})

test('fully faded artwork uses the base surface and translucent bases include both backdrop extremes', () => {
  assert(compositeBackgrounds(covers, [20, 30, 40, 1], 0).every(color => color.join() === '20,30,40'))
  const backgrounds = compositeBackgrounds([black], [100, 100, 100, 0.5], 0)
  assert.deepEqual(backgrounds, [[50, 50, 50], [177.5, 177.5, 177.5]])
  assert.deepEqual(parseColor('rgba(19, 19, 19, 0.9)'), [19, 19, 19, 0.9])
})

test('a minified CSS detail surface keeps dark artwork text readable', () => {
  const backgrounds = compositeBackgrounds(covers, parseColor('#131313'), 0.3)
  const palette = createAdaptivePalette(backgrounds, [40, 120, 130])
  assert.equal(palette.darkText, false)
  readable(palette.text, backgrounds, 'detail text after CSS minification')
  readable(palette.secondary, backgrounds, 'detail labels after CSS minification')
})

test('moving colors change controls at their own positions even with an unchanged global average', () => {
  const red = [230, 45, 65]
  const blue = [35, 105, 235]
  const frame = Array.from({ length: 24 * 16 }, (_, index) => index % 24 < 12 ? red : blue)
  const moved = frame.map(color => color === red ? blue : red)
  const palette = createAdaptivePalette(compositeBackgrounds(frame, themes[0], 0.3), artworkColor(frame))
  const region = controlRegions(frame, 24, 16)[0]
  const changed = controlRegions(moved, 24, 16)[0]
  const first = createControlColors(compositeBackgrounds(region, themes[0], 0.3), artworkColor(region), palette)
  const next = createControlColors(compositeBackgrounds(changed, themes[0], 0.3), artworkColor(changed), palette)
  assert(first.accent[0] > first.accent[2])
  assert(next.accent[2] > next.accent[0])
  assert(Math.max(...first.accent.map((value, index) => Math.abs(value - next.accent[index]))) > 80)
  readable(first.accent, compositeBackgrounds(region, themes[0], 0.3), 'local red')
  readable(next.accent, compositeBackgrounds(changed, themes[0], 0.3), 'local blue')
})

test('colorful regions keep their saturation; black-and-white artwork stays neutral', () => {
  const artwork = artworkColor([...Array(80).fill([35, 42, 46]), ...Array(40).fill([20, 175, 185])])
  for (const theme of themes) {
    const palette = createAdaptivePalette(compositeBackgrounds([artwork], theme, 0.3), artwork)
    assert(toHsl(palette.accent)[1] >= 0.5)
  }
  const neutral = artworkColor([black, white, [100, 100, 100]])
  assert.equal(toHsl(neutral)[1], 0)
  assert.deepEqual(stabilizeColor([90, 120, 180], [91, 121, 181], true), [90, 120, 180])
  assert.deepEqual(stabilizeColor([90, 120, 180], [240, 40, 60], false), [240, 40, 60])
})

test('subtle reading surfaces keep full-panel text and regional widget text readable', () => {
  for (const theme of themes) {
    for (const cover of [...covers.map(color => [color]), covers]) {
      const backgrounds = compositeBackgrounds(cover, theme, 0.3)
      const palette = createAdaptivePalette(backgrounds, artworkColor(cover))
      const surface = parseColor(palette.colors['--ambient-reading-surface'])
      const readingBackgrounds = backgrounds.map(background => mixColor(background, surface.slice(0, 3), surface[3]))
      readable(palette.text, readingBackgrounds, 'reading body text')
      readable(palette.secondary, readingBackgrounds, 'reading labels')
      // Wide panels use the full-frame palette; only individual widgets use
      // their own sampled region now that masks are deliberately subtle.
      for (let index = 0; index < cover.length; index++) {
        const region = compositeBackgrounds([cover[index]], theme, 0.3)
        const local = createControlColors(region, cover[index], palette)
        readable(local.text, region, 'local reading body text')
        readable(local.secondary, region, 'local reading labels')
        readable(local.accent, [...region, palette.surface, palette.hover, palette.active], 'local control text')
        for (const background of [palette.surface, palette.hover, palette.active]) {
          readable(local.text, [background], 'input and popup body text')
          readable(local.secondary, [background], 'input and popup labels')
        }
      }
    }
  }
})
