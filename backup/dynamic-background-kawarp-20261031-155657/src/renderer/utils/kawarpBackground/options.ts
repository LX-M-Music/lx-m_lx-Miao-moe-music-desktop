export type BackgroundQuality = 'static' | 'gentle' | 'full'
export const normalizeQuality = (value: unknown): BackgroundQuality => value === 'static' || value === 'full' ? value : 'gentle'

export const surfaceSize = (width: number, height: number, quality: BackgroundQuality, dpr = 1) => {
  const w = Number.isFinite(width) ? Math.max(1, width) : 1
  const h = Number.isFinite(height) ? Math.max(1, height) : 1
  const density = Number.isFinite(dpr) ? Math.max(0.1, dpr) : 1
  // The source is blurred at 128px. Gentle flow needs fewer output pixels while
  // preserving the same artwork, warp, aspect ratio and animation clock.
  const limit = quality === 'full' ? 1440 : quality === 'gentle' ? 600 : 900
  const scale = Math.min(quality === 'full' ? Math.min(density, 1.5) : quality === 'gentle' ? 0.5 : 0.65, limit / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}
