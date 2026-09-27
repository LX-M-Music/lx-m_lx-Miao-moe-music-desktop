import { errorText, formatError, isCancelledError } from './utils/errorMessage'

// A last-resort surface for failures outside a mounted page (including startup).
// Expected loading errors belong to the page that initiated the operation.
export const showLoadError = (error: unknown, code = 'APP_LOAD_FAILED', retry?: () => void) => {
  if (!globalThis.document?.body || isCancelledError(error)) return
  if ((globalThis as { lxData?: { appSetting?: { 'common.showErrorDialog'?: boolean } } }).lxData?.appSetting?.['common.showErrorDialog'] !== true) {
    document.querySelector<HTMLElement>('[data-app-load-error]')?.remove()
    return
  }
  const message = formatError(error, '', code)
  let panel = document.querySelector<HTMLElement>('[data-app-load-error]')
  if (panel?.querySelector('pre')?.textContent === message) return
  if (!panel) {
    panel = document.createElement('section')
    panel.dataset.appLoadError = ''
    panel.setAttribute('role', 'alert')
    Object.assign(panel.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647', maxWidth: 'min(560px, calc(100vw - 32px))', maxHeight: '70vh', overflow: 'auto', boxSizing: 'border-box', padding: '16px', border: '1px solid #986b45', borderRadius: '8px', background: 'var(--color-main-background, #fff)', color: 'var(--color-font, #202020)', boxShadow: '0 4px 20px #0003', fontSize: '13px' })
    document.body.appendChild(panel)
  }
  panel.replaceChildren()
  const content = document.createElement('pre')
  content.textContent = message
  Object.assign(content.style, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit', lineHeight: '1.6', userSelect: 'text', margin: '0 0 12px' })
  panel.appendChild(content)
  const button = (label: string, action: () => void) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    Object.assign(button.style, { cursor: 'pointer', marginRight: '12px', padding: '5px 14px' })
    button.onclick = action
    panel.appendChild(button)
  }
  if (retry) button(errorText('reload', '重新加载'), retry)
  button(errorText('close', '关闭'), () => { panel.remove() })
}
