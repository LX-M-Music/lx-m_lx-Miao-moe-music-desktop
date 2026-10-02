import { CONTROL_COLUMNS, CONTROL_ROWS } from './contrast'

const selector = 'button, [role="tab"], [role="checkbox"], [role="radio"], [role="slider"], input, select, textarea, .list-item .select, [data-player-detail] .font-lrc'
const properties = ['--ambient-local-accent', '--ambient-local-on-accent', '--ambient-local-lyric-accent', '--ambient-local-text', '--ambient-local-secondary'] as const

// Wide reading panels inherit the whole-background palette; widgets follow the
// area behind them. Palette changes only update 24 shared variable sets.
export const createControlRegions = (root: HTMLElement, background: HTMLElement) => {
  const bindings = new Map<HTMLElement, { zone: number, attribute: string | null, styles: Array<{ value: string, priority: string }> }>()
  let enabled = false
  let includeLibrary = true
  let pending = 0
  const restore = (element: HTMLElement, binding: { attribute: string | null, styles: Array<{ value: string, priority: string }> }) => {
    if (binding.attribute == null) element.removeAttribute('data-ambient-zone')
    else element.setAttribute('data-ambient-zone', binding.attribute)
    properties.forEach((key, index) => {
      const { value, priority } = binding.styles[index]
      if (value) element.style.setProperty(key, value, priority)
      else element.style.removeProperty(key)
    })
  }
  const sync = () => {
    pending = 0
    if (!enabled || document.hidden || !background.isConnected) return
    const frame = background.getBoundingClientRect()
    if (!frame.width || !frame.height) return
    const targets = new Map<HTMLElement, number>()
    const rows = new Map<Element, boolean>()
    const visible = (rect: DOMRect) => rect.width > 0 && rect.height > 0 && rect.right > frame.left && rect.left < frame.right && rect.bottom > frame.top && rect.top < frame.bottom
    // Read all geometry before applying styles, including virtual/scrolling lists.
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      if (!includeLibrary && !element.closest('[data-player-detail]')) continue
      const row = element.closest('.list-item, .line-content')
      if (row) {
        if (!rows.has(row)) rows.set(row, visible(row.getBoundingClientRect()))
        if (!rows.get(row)) continue
      }
      const rect = element.getBoundingClientRect()
      if (!visible(rect)) continue
      const x = Math.max(0, Math.min(CONTROL_COLUMNS - 1, Math.floor(((rect.left + rect.right) / 2 - frame.left) / frame.width * CONTROL_COLUMNS)))
      const y = Math.max(0, Math.min(CONTROL_ROWS - 1, Math.floor(((rect.top + rect.bottom) / 2 - frame.top) / frame.height * CONTROL_ROWS)))
      targets.set(element, y * CONTROL_COLUMNS + x)
    }
    for (const [element, binding] of bindings) {
      if (targets.has(element)) continue
      restore(element, binding)
      bindings.delete(element)
    }
    for (const [element, zone] of targets) {
      let binding = bindings.get(element)
      if (!binding) {
        binding = { zone: -1, attribute: element.getAttribute('data-ambient-zone'), styles: properties.map(key => ({ value: element.style.getPropertyValue(key), priority: element.style.getPropertyPriority(key) })) }
        bindings.set(element, binding)
      }
      if (binding.zone === zone) continue
      binding.zone = zone
      element.dataset.ambientZone = String(zone)
      element.style.setProperty(properties[0], `var(--ambient-zone-${zone}-accent)`)
      element.style.setProperty(properties[1], `var(--ambient-zone-${zone}-on-accent)`)
      element.style.setProperty(properties[2], `var(--ambient-zone-${zone}-lyric-accent)`)
      element.style.setProperty(properties[3], `var(--ambient-zone-${zone}-text)`)
      element.style.setProperty(properties[4], `var(--ambient-zone-${zone}-secondary)`)
    }
  }
  const schedule = () => { if (enabled && !pending && !document.hidden) pending = requestAnimationFrame(sync) }
  const observer = new MutationObserver(schedule)
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'aria-hidden'] })
  root.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  document.addEventListener('visibilitychange', schedule)
  const clear = () => {
    cancelAnimationFrame(pending)
    pending = 0
    for (const [element, binding] of bindings) restore(element, binding)
    bindings.clear()
  }
  return {
    refresh: schedule,
    setEnabled(value: boolean, library = true) {
      enabled = value
      includeLibrary = library
      if (enabled) schedule()
      else clear()
    },
    dispose() {
      enabled = false
      observer.disconnect()
      root.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('visibilitychange', schedule)
      clear()
    },
  }
}
