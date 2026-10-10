import { rendererInvoke } from '@common/rendererIpc'
import { CMMON_EVENT_NAME } from '@common/ipcNames'
import { CUSTOM_FONT_PREFIX, identifyFont, quoteFontFamily, parseFontStack, type CustomFont, type FontImport } from '@common/fonts'
import { showLoadError } from '@common/loadErrorNotice'

export const listCustomFonts = async() => rendererInvoke<CustomFont[]>(CMMON_EVENT_NAME.list_custom_fonts)
export const importCustomFont = async(font: FontImport) => {
  identifyFont(font.data)
  // Let Chromium validate the actual font, not just its extension or header.
  await new FontFace('LXFontImportValidation', Uint8Array.from(font.data).buffer).load()
  return rendererInvoke<FontImport, CustomFont>(CMMON_EVENT_NAME.import_custom_font, font)
}

const sources = new Map<string, Promise<string>>()
const loadFont = async(id: string) => {
  let pending = sources.get(id)
  if (!pending) {
    pending = rendererInvoke<string, { format: CustomFont['format'], data: Uint8Array }>(CMMON_EVENT_NAME.read_custom_font, id).then(async({ format, data }) => {
      const source = `url("data:font/${format};base64,${Buffer.from(data).toString('base64')}")`
      await new FontFace(id, source).load()
      return `@font-face { font-family: ${quoteFontFamily(id)}; src: ${source}; font-display: swap; }`
    }).catch(error => { sources.delete(id); throw error })
    sources.set(id, pending)
  }
  return pending
}

const STYLE_ID = 'lx-custom-fonts'
let styleText = ''
let revision = 0
const applyStyle = (doc: Document) => {
  if (!doc.head) return
  let style = doc.getElementById(STYLE_ID)
  if (!style) { style = doc.createElement('style'); style.id = STYLE_ID; doc.head.appendChild(style) }
  if (style.textContent !== styleText) style.textContent = styleText
}
const applyFrame = (frame: HTMLIFrameElement) => {
  try { if (frame.contentDocument) applyStyle(frame.contentDocument) } catch (error) { showLoadError(error, 'FONT_FRAME_LOAD_FAILED') }
}
// The lyric iframe is a separate document. Font changes and new stage loads
// need the same local faces, without scanning on every animated lyric mutation.
document.addEventListener('load', event => {
  if (event.target instanceof HTMLIFrameElement && event.target.hasAttribute('data-folia-frame')) applyFrame(event.target)
}, true)

export const applyAppFont = async(value: string) => {
  const current = ++revision
  const families = parseFontStack(value)
  document.documentElement.style.fontFamily = ''
  const defaults = getComputedStyle(document.documentElement).fontFamily
  document.documentElement.style.setProperty('--app-default-font-family', defaults)
  document.documentElement.style.fontFamily = families.length ? `${families.map(quoteFontFamily).join(', ')}, ${defaults}` : ''
  const ids = [...new Set(families.filter(family => family.startsWith(CUSTOM_FONT_PREFIX)))]
  // Do not retain every font the user has ever previewed in memory.
  for (const id of sources.keys()) { if (!ids.includes(id)) sources.delete(id) }
  const results = await Promise.allSettled(ids.map(loadFont))
  if (current !== revision) return
  styleText = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []).join('\n')
  applyStyle(document)
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[data-folia-frame]')) applyFrame(frame)
  for (const result of results) { if (result.status === 'rejected') showLoadError(result.reason, 'FONT_LOAD_FAILED') }
}
