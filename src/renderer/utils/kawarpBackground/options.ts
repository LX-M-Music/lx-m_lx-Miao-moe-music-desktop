export type BackgroundQuality = 'static' | 'gentle' | 'full'
export const normalizeQuality = (value: unknown): BackgroundQuality => value === 'static' || value === 'full' ? value : 'gentle'

// The background is displayed behind a 30% overlay and is heavily blurred, so
// the internal buffer is deliberately tiny and the browser upscales it. Keeping
// the window aspect ratio avoids stretching the flow.
const LIMITS: Record<BackgroundQuality, number> = {
  static: 560,
  gentle: 640,
  full: 768,
}

export const surfaceSize = (width: number, height: number, quality: BackgroundQuality) => {
  const w = Number.isFinite(width) ? Math.max(1, width) : 1
  const h = Number.isFinite(height) ? Math.max(1, height) : 1
  const scale = Math.min(1, LIMITS[quality] / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}
