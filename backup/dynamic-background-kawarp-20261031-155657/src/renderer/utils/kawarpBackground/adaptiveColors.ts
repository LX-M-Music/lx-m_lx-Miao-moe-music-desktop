import { type Artwork } from './artwork'
import { artworkColor, compositeBackgrounds, controlRegions, createAdaptivePalette, createControlColors, mixColor, parseColor, rgb, stabilizeColor, type RGB } from './contrast'
import { createControlRegions } from './controlRegions'

interface BackgroundFrame {
  from: Artwork | null
  to: Artwork | null
  mix: number
  opacity: number
}

// Owned by the shared background. No second renderer, cover request or timer.
export const createAdaptiveColors = (background: HTMLElement, themeChanged: () => void) => {
  const root = document.getElementById('root')!
  const controls = createControlRegions(root, background)
  interface ColorScope {
    element: HTMLElement
    original: Map<string, { value: string, priority: string }>
    values: Map<string, string>
    attribute: string | null
    darkText?: boolean
  }
  const scopes = new Map<HTMLElement, ColorScope>()
  const scopeFor = (element: HTMLElement) => {
    let scope = scopes.get(element)
    if (!scope) {
      scope = { element, original: new Map(), values: new Map(), attribute: element.getAttribute('data-ambient-controls') }
      scopes.set(element, scope)
    }
    return scope
  }
  let enabled = false
  let includeLibrary = true
  let lastSample = -Infinity
  let artwork: RGB | undefined
  let regionColors: RGB[] = []
  let sampler: HTMLCanvasElement | undefined
  let context: CanvasRenderingContext2D | null = null
  const backgroundColors = () => {
    const theme = getComputedStyle(document.documentElement)
    const style = getComputedStyle(background)
    const surface = style.getPropertyValue('--ambient-surface-color').trim()
    return {
      base: parseColor(theme.getPropertyValue('--color-surface')),
      detailBase: parseColor(style.getPropertyValue('--ambient-detail-base')),
      libraryOpacity: Number(style.getPropertyValue('--ambient-library-opacity').trim() || 0.3),
      detailOpacity: Number(style.getPropertyValue('--ambient-detail-opacity').trim() || 0.3),
      shade: surface || theme.getPropertyValue('--color-content-background'),
    }
  }
  const clearScope = (scope: ColorScope) => {
    for (const [key, { value, priority }] of scope.original) {
      if (value) scope.element.style.setProperty(key, value, priority)
      else scope.element.style.removeProperty(key)
    }
    if (scope.attribute == null) delete scope.element.dataset.ambientControls
    else scope.element.setAttribute('data-ambient-controls', scope.attribute)
    scopes.delete(scope.element)
  }
  const clear = () => {
    for (const scope of scopes.values()) clearScope(scope)
    artwork = undefined
    regionColors = []
    lastSample = -Infinity
  }
  const themeObserver = new MutationObserver(() => {
    lastSample = -Infinity
    // Keep the background's shading independent of the foreground palette.
    background.style.setProperty('--ambient-shade-color', backgroundColors().shade)
    // The renderer's gradient follows the theme even when adaptive controls
    // are disabled; static snapshots must be refreshed as well.
    themeChanged()
  })
  const themeStyle = (window as Window & { dom_style?: HTMLStyleElement }).dom_style
  if (themeStyle) themeObserver.observe(themeStyle, { childList: true, characterData: true, subtree: true })

  const write = (scope: ColorScope, key: string, value: string) => {
    if (!scope.original.has(key)) scope.original.set(key, { value: scope.element.style.getPropertyValue(key), priority: scope.element.style.getPropertyPriority(key) })
    if (scope.values.get(key) === value) return
    scope.values.set(key, value)
    scope.element.style.setProperty(key, value)
  }
  const update = (frame: BackgroundFrame, canvas: HTMLCanvasElement | null, moving = false) => {
    if (!enabled || !background.isConnected) return
    const now = performance.now()
    if (now - lastSample < 250) return
    lastSample = now
    sampler ??= document.createElement('canvas')
    if (!context) {
      sampler.width = 24
      sampler.height = 16
      context = sampler.getContext('2d', { willReadFrequently: true })
    }
    if (!context) return
    const backgroundColor = backgroundColors()
    const base = backgroundColor.base
    const shade = parseColor(backgroundColor.shade)
    background.style.setProperty('--ambient-shade-color', backgroundColor.shade)
    const pixels: RGB[] = []
    try {
      context.clearRect(0, 0, 24, 16)
      // Static presentation hides the live canvas, but its retained pixels are
      // still the exact source of the displayed snapshot and its local colors.
      if (canvas && frame.opacity) context.drawImage(canvas, 0, 0, 24, 16)
      else {
        const rect = background.getBoundingClientRect()
        const width = Math.max(1, rect.width)
        const height = Math.max(1, rect.height)
        // Match the fallback's cover crop, 1.18 scale and 48px blur. Stretching
        // the square artwork would sample the wrong region in a wide window.
        context.filter = `blur(${48 * 1.18 * 24 / width}px)`
        const draw = (artwork: Artwork) => {
          const scale = Math.max(width / artwork.image.width, height / artwork.image.height) * 1.18
          const w = artwork.image.width * scale / width * 24
          const h = artwork.image.height * scale / height * 16
          context!.drawImage(artwork.image, (24 - w) / 2, (16 - h) / 2, w, h)
        }
        const from = frame.from ?? frame.to
        if (from) draw(from)
        if (frame.from && frame.to && frame.from !== frame.to) {
          context.globalAlpha = frame.mix
          draw(frame.to)
          context.globalAlpha = 1
        }
        context.filter = 'none'
      }
      const data = context.getImageData(0, 0, 24, 16).data
      for (let index = 0; index < data.length; index += 4) {
        const color: RGB = [data[index], data[index + 1], data[index + 2]]
        // WebGL already contains the gradient; only CSS fallback needs it here.
        const amount = canvas ? 0 : Math.max(0, ((index / 4 % 24) / 23 - 0.12) / 1.03) * 0.1
        pixels.push(mixColor(color, shade.slice(0, 3) as RGB, amount * shade[3]))
      }
    } catch {
      // A lost GPU context must not leave unreadable or stale theme overrides.
      pixels.push(...Array.from({ length: 24 * 16 }, () => base.slice(0, 3) as RGB))
      context.globalAlpha = 1
      context.filter = 'none'
    }
    const currentArtwork = artwork = stabilizeColor(artwork, frame.opacity ? artworkColor(pixels) : [125, 125, 125], moving)
    const regions = controlRegions(pixels, 24, 16)
    regions.forEach((region, index) => {
      regionColors[index] = stabilizeColor(regionColors[index], frame.opacity ? artworkColor(region) : currentArtwork, moving)
    })
    // Both screens can be visible during expansion. Keep their own contrast
    // palettes instead of recoloring the fading screen to match the incoming one.
    const publish = (element: HTMLElement, surface: ReturnType<typeof parseColor>, targetOpacity: number) => {
      const opacity = frame.opacity * targetOpacity
      const scope = scopeFor(element)
      const palette = createAdaptivePalette(compositeBackgrounds(pixels, surface, opacity), currentArtwork, scope.darkText)
      scope.darkText = palette.darkText
      for (const [key, value] of Object.entries(palette.colors)) write(scope, key, value)
      regions.forEach((region, index) => {
        const colors = createControlColors(compositeBackgrounds(region, surface, opacity), regionColors[index], palette)
        write(scope, `--ambient-zone-${index}-accent`, rgb(colors.accent))
        write(scope, `--ambient-zone-${index}-lyric-accent`, rgb(colors.lyricAccent))
        write(scope, `--ambient-zone-${index}-on-accent`, rgb(colors.onAccent))
        write(scope, `--ambient-zone-${index}-text`, rgb(colors.text))
        write(scope, `--ambient-zone-${index}-secondary`, rgb(colors.secondary))
      })
      element.dataset.ambientControls = palette.darkText ? 'light' : 'dark'
    }
    if (includeLibrary) publish(root, base, backgroundColor.libraryOpacity)
    const detail = root.querySelector<HTMLElement>('[data-player-detail]')
    if (detail) publish(detail, backgroundColor.detailBase, backgroundColor.detailOpacity)
    for (const scope of scopes.values()) {
      if (!scope.element.isConnected || (scope.element !== root && scope.element !== detail)) clearScope(scope)
    }
    controls.refresh()
  }
  return {
    update,
    invalidate() { lastSample = -Infinity },
    setEnabled(value: boolean, library = true) {
      enabled = value
      includeLibrary = library
      controls.setEnabled(value, library)
      lastSample = -Infinity
      if (!value) clear()
      else if (!library && scopes.has(root)) clearScope(scopes.get(root)!)
    },
    dispose() {
      themeObserver.disconnect()
      controls.dispose()
      clear()
      background.style.removeProperty('--ambient-shade-color')
      sampler = undefined
      context = null
    },
  }
}
