export const MAX_FONT_BYTES = 32 * 1024 * 1024
export const CUSTOM_FONT_PREFIX = 'LXCustom-'
export interface CustomFont { id: string, name: string, format: 'ttf' | 'otf' | 'woff' | 'woff2' }
export interface FontImport { name: string, data: Uint8Array }

// A family may itself contain commas, quotes or escaped characters.
export const parseFontStack = (value: string): string[] => {
  const families: string[] = []
  let family = ''
  let quote = ''
  let escaped = false
  for (const char of value) {
    if (escaped) { family += char; escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (quote) {
      if (char === quote) quote = ''
      else family += char
    } else if (char === '"' || char === "'") quote = char
    else if (char === ',') {
      if (family.trim()) families.push(family.trim())
      family = ''
    } else family += char
  }
  if (family.trim()) families.push(family.trim())
  return families
}

const genericFamilies = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong'])
export const quoteFontFamily = (family: string) => genericFamilies.has(family) ? family : `"${family.replace(/["\\]/g, '\\$&').replace(/[\r\n\f]/g, ' ')}"`
export const fontChoices = (value: string): [string, string] => {
  const [primary = '', fallback = ''] = parseFontStack(value)
  return [primary === 'system-ui' ? '' : primary, fallback]
}
export const makeFontStack = (primary: string, fallback: string) => {
  if (!primary && !fallback) return ''
  return [...new Set([primary || 'system-ui', fallback].filter(Boolean))].map(quoteFontFamily).join(', ')
}

export const getLyricDetailFontFamily = (value: string, enabled: boolean | undefined) => {
  // Hosts without the independent detail switch retain their original font stack.
  if (enabled === undefined) return value
  const [, secondary] = fontChoices(value)
  return enabled && secondary ? quoteFontFamily(secondary) : ''
}

export const fontError = (code: string, message: string) => Object.assign(new Error(message), { code })
export const identifyFont = (data: Uint8Array): CustomFont['format'] => {
  if (!data.length || data.length > MAX_FONT_BYTES) throw fontError('FONT_SIZE_LIMIT', '字体文件为空或超过 32 MB，请选择较小的字体文件。')
  const signature = String.fromCharCode(...data.subarray(0, 4))
  if (signature === '\x00\x01\x00\x00' || signature === 'true') return 'ttf'
  if (signature === 'OTTO') return 'otf'
  if (signature === 'wOFF') return 'woff'
  if (signature === 'wOF2') return 'woff2'
  throw fontError('FONT_FORMAT_INVALID', '不是有效的 TTF、OTF、WOFF 或 WOFF2 字体文件。')
}
