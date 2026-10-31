export type RGB = [number, number, number]
export type RGBA = [number, number, number, number]

export const mixColor = (from: RGB, to: RGB, amount: number): RGB => from.map((value, index) => value + (to[index] - value) * amount) as RGB
export const rgb = (color: RGB) => `rgb(${color.map(value => Math.round(value)).join(', ')})`
const rgba = (color: RGB, alpha: number) => `rgba(${color.map(value => Math.round(value)).join(', ')}, ${alpha})`

export const parseColor = (value: string): RGBA => {
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value.trim())?.[1]
  if (hex) {
    const full = hex.length < 5 ? [...hex].map(char => char + char).join('') : hex
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), full.length == 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1]
  }
  const parts = value.match(/[\d.]+/g)?.map(Number)
  if (!parts || parts.length < 3) return [255, 255, 255, value == 'transparent' ? 0 : 1]
  return [parts[0], parts[1], parts[2], parts[3] ?? 1]
}
export const luminance = (color: RGB) => color.reduce((total, value, index) => {
  const channel = value / 255
  return total + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]
}, 0)
export const contrastRatio = (a: RGB, b: RGB) => {
  const first = luminance(a)
  const second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

// Include both possible backdrops when a custom theme's surface is translucent.
export const compositeBackgrounds = (pixels: RGB[], base: RGBA, opacity: number): RGB[] => {
  const surface = base.slice(0, 3) as RGB
  const bases = [mixColor([0, 0, 0], surface, base[3]), mixColor([255, 255, 255], surface, base[3])]
  return bases.flatMap(background => pixels.map(pixel => mixColor(background, pixel, opacity)))
}
const bounds = (backgrounds: RGB[]): [number, number] => {
  const values = backgrounds.map(luminance)
  return [Math.min(...values), Math.max(...values)]
}
const contrastScore = (color: RGB, [low, high]: [number, number]) => {
  const value = luminance(color)
  return value <= low ? (low + 0.05) / (value + 0.05) : value >= high ? (value + 0.05) / (high + 0.05) : 1
}
export const toHsl = (color: RGB): RGB => {
  const [r, g, b] = color.map(value => value / 255)
  const high = Math.max(r, g, b)
  const low = Math.min(r, g, b)
  const difference = high - low
  const lightness = (high + low) / 2
  if (!difference) return [0, 0, lightness]
  const hue = high === r ? (g - b) / difference + (g < b ? 6 : 0) : high === g ? (b - r) / difference + 2 : (r - g) / difference + 4
  return [hue / 6, difference / (1 - Math.abs(2 * lightness - 1)), lightness]
}
export const fromHsl = ([hue, saturation, lightness]: RGB): RGB => {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = chroma * (1 - Math.abs(hue * 6 % 2 - 1))
  const sector = Math.floor(hue * 6) % 6
  const channels = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][sector]
  return channels.map(value => (value + lightness - chroma / 2) * 255) as RGB
}

// Keep the chromatic part of a region instead of averaging it away with its
// shadows/highlights. This also avoids muddy gray when several hues coexist.
export const artworkColor = (pixels: RGB[]): RGB => {
  const bins = Array.from({ length: 12 }, () => ({ weight: 0, color: [0, 0, 0] as RGB }))
  let chromatic = 0
  for (const pixel of pixels) {
    const [hue, saturation, lightness] = toHsl(pixel)
    if (saturation < 0.12 || lightness < 0.06 || lightness > 0.94) continue
    chromatic++
    const weight = saturation * (0.35 + 0.65 * (1 - Math.abs(lightness - 0.5) * 2))
    const bin = bins[Math.floor(hue * bins.length) % bins.length]
    bin.weight += weight
    bin.color = bin.color.map((value, index) => value + pixel[index] * weight) as RGB
  }
  const best = bins.reduce((best, bin) => bin.weight > best.weight ? bin : best)
  if (best.weight && chromatic >= pixels.length * 0.05) {
    const index = bins.indexOf(best)
    const neighbors = [bins[(index + 11) % 12], best, bins[(index + 1) % 12]]
    const weight = neighbors.reduce((sum, bin) => sum + bin.weight, 0)
    return [0, 1, 2].map(channel => neighbors.reduce((sum, bin) => sum + bin.color[channel], 0) / weight) as RGB
  }
  return pixels.reduce<RGB>((sum, color) => sum.map((value, index) => value + color[index] / pixels.length) as RGB, [0, 0, 0])
}

export const stabilizeColor = (previous: RGB | undefined, next: RGB, moving: boolean): RGB => {
  if (!previous || !moving) return next
  if (Math.max(...previous.map((value, index) => Math.abs(value - next[index]))) < 3) return previous
  const from = toHsl(previous)
  const to = toHsl(next)
  // Hue has no meaning in gray areas; keep the other endpoint's hue while fading.
  if (from[1] < 0.08) from[0] = to[0]
  if (to[1] < 0.08) to[0] = from[0]
  const delta = (to[0] - from[0] + 1.5) % 1 - 0.5
  return fromHsl([(from[0] + delta * 0.75 + 1) % 1, from[1] + (to[1] - from[1]) * 0.75, from[2] + (to[2] - from[2]) * 0.75])
}

const contrastColor = (seed: RGB, range: [number, number], darkText: boolean, target: number, colorful = false): RGB => {
  const [hue, sourceSaturation] = toHsl(seed)
  const saturation = colorful && sourceSaturation > 0.12 ? Math.max(0.58, Math.min(0.88, sourceSaturation)) : Math.min(sourceSaturation, 0.12)
  const limit: RGB = darkText ? [0, 0, 0] : [255, 255, 255]
  target = Math.min(target, contrastScore(limit, range) * 0.97)
  let low = 0
  let high = 1
  let result = limit
  // Adjust lightness, keeping hue/saturation intact instead of mixing with gray.
  for (let step = 0; step < 12; step++) {
    const lightness = (low + high) / 2
    const color = fromHsl([hue, saturation, lightness]).map(Math.round) as RGB
    const readable = contrastScore(color, range) >= target && (darkText ? luminance(color) <= range[0] : luminance(color) >= range[1])
    if (readable) result = color
    if (readable === darkText) low = lightness
    else high = lightness
  }
  return result
}

export const createAdaptivePalette = (backgrounds: RGB[], artwork: RGB, previousDarkText?: boolean) => {
  const black: RGB = [0, 0, 0]
  const white: RGB = [255, 255, 255]
  const backgroundRange = bounds(backgrounds)
  const darkScore = contrastScore(black, backgroundRange)
  const lightScore = contrastScore(white, backgroundRange)
  // A small dead band prevents light/dark flicker near the crossover.
  const darkText = previousDarkText != null && Math.abs(darkScore - lightScore) < 0.6 ? previousDarkText : darkScore >= lightScore
  const [hue, saturation] = toHsl(artwork)
  const tint = fromHsl([hue, saturation, 0.5])
  const surface = mixColor(darkText ? [249, 250, 252] : [19, 22, 27], tint, 0.04)
  const hover = mixColor(surface, tint, 0.10)
  const active = mixColor(surface, tint, 0.18)
  const range = bounds([...backgrounds, surface, hover, active])
  const target = Math.min(6.5, contrastScore(darkText ? black : white, range) * 0.97)
  const accent = contrastColor(artwork, range, darkText, 5.2, true)
  const text = contrastColor([110, 116, 124], range, darkText, target)
  const secondary = contrastColor([128, 133, 141], range, darkText, Math.min(5, target))
  const onAccent = contrastRatio(accent, white) >= contrastRatio(accent, black) ? white : black
  const colors: Record<string, string> = {}
  const assign = (value: string, names: string[]) => { for (const name of names) colors[`--${name}`] = value }
  assign(rgb(accent), [
    'color-primary', 'color-accent', 'color-nav-font', 'color-primary-font', 'color-primary-font-hover', 'color-primary-font-active',
    'color-button-font', 'color-button-font-selected', 'color-primary-dark-100', 'color-primary-dark-200',
    'color-primary-dark-100-alpha-100', 'color-primary-dark-100-alpha-200', 'color-primary-dark-100-alpha-300',
    'color-primary-light-100-alpha-300', 'color-primary-dark-500-alpha-500', 'color-badge-primary', 'color-badge-secondary', 'color-badge-tertiary',
  ])
  assign(rgb(text), ['color-font', 'color-text', 'color-850', 'color-primary-light-400-alpha-200'])
  assign(rgb(secondary), ['color-font-label', 'color-text-muted', 'color-text-secondary', 'color-200', 'color-300', 'color-400', 'color-450', 'color-500', 'color-550', 'color-650', 'color-700'])
  colors['--ambient-reading-surface'] = rgba(surface, 0.12)
  assign(rgb(onAccent), ['color-000', 'adaptive-selection-text'])
  assign(rgb(accent), ['adaptive-selection-background'])
  assign(rgb(contrastColor(artwork, range, darkText, 7, true)), ['ambient-lyric-accent'])
  assign(rgb(surface), ['color-content-background', 'color-surface-elevated', 'color-button-background', 'color-primary-background', 'color-primary-light-600-alpha-100', 'color-primary-light-900-alpha-200'])
  assign(rgb(hover), [
    'color-hover', 'color-button-background-hover', 'color-primary-background-hover', 'color-primary-light-100-alpha-100',
    'color-primary-light-100-alpha-800', 'color-primary-light-300-alpha-700', 'color-primary-light-400-alpha-700',
    'color-primary-dark-100-alpha-600', 'color-primary-light-500-alpha-700', 'color-primary-light-200-alpha-900',
  ])
  assign(rgb(active), [
    'color-active', 'color-selected', 'color-button-background-active', 'color-button-background-selected', 'color-primary-background-active',
    'color-primary-dark-100-alpha-700', 'color-primary-dark-200-alpha-600', 'color-primary-light-300-alpha-800',
    'color-primary-light-100-alpha-400', 'color-primary-light-100-alpha-600', 'color-btn-hide', 'color-btn-min', 'color-btn-max', 'color-btn-close',
  ])
  assign(rgba(accent, 0.38), ['color-border', 'color-primary-light-100-alpha-700', 'color-primary-light-200-alpha-700', 'color-primary-dark-200-alpha-700'])
  for (let level = 1; level < 10; level++) colors[`--color-primary-alpha-${level * 100}`] = level < 6 ? rgb(accent) : rgba(accent, (10 - level) / 10)
  colors['--focus-ring'] = `0 0 0 2px ${rgba(accent, 0.75)}`
  colors['--color-list-header-border-bottom'] = `1px solid ${rgba(accent, 0.25)}`
  colors['--adaptive-color-scheme'] = darkText ? 'light' : 'dark'
  return { colors, accent, text, secondary, onAccent, surface, hover, active, darkText }
}

export const CONTROL_COLUMNS = 6
export const CONTROL_ROWS = 4
export const controlRegions = (pixels: RGB[], width: number, height: number): RGB[][] => {
  return Array.from({ length: CONTROL_COLUMNS * CONTROL_ROWS }, (_, index) => {
    const column = index % CONTROL_COLUMNS
    const row = Math.floor(index / CONTROL_COLUMNS)
    const region: RGB[] = []
    // Include neighboring samples so controls near a cell edge stay readable.
    for (let y = Math.max(0, Math.floor(row * height / CONTROL_ROWS) - 1); y < Math.min(height, Math.ceil((row + 1) * height / CONTROL_ROWS) + 1); y++) {
      for (let x = Math.max(0, Math.floor(column * width / CONTROL_COLUMNS) - 1); x < Math.min(width, Math.ceil((column + 1) * width / CONTROL_COLUMNS) + 1); x++) region.push(pixels[y * width + x])
    }
    return region
  })
}

export const createControlColors = (backgrounds: RGB[], artwork: RGB, palette: ReturnType<typeof createAdaptivePalette>) => {
  const range = bounds([...backgrounds, palette.surface, palette.hover, palette.active])
  const accent = contrastColor(artwork, range, palette.darkText, 5.2, true)
  const lyricAccent = contrastColor(artwork, range, palette.darkText, 7, true)
  const text = contrastColor([110, 116, 124], range, palette.darkText, 6.5)
  const secondary = contrastColor([128, 133, 141], range, palette.darkText, 5)
  const white: RGB = [255, 255, 255]
  const black: RGB = [0, 0, 0]
  const onAccent = contrastRatio(accent, white) >= contrastRatio(accent, black) ? white : black
  return { accent, onAccent, lyricAccent, text, secondary }
}
