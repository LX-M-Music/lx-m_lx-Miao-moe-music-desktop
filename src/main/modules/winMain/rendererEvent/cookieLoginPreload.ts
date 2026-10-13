import { ipcRenderer } from 'electron'

/**
 * 内嵌登录窗口的注入脚本（sandbox preload）
 *
 * 在平台登录页之上注入与主程序一致的圆角标题栏：
 *   [平台标题] .................... [浏览器打开] [×]
 * 标题栏为拖拽区；页面内容下移避让；窗口背景裁切为圆角。
 * 按钮动作通过裸 IPC 发送（主进程校验 sender 后处理）。
 */

const ACTION_CHANNEL = 'cookie-login-chrome-action'

const BAR_HEIGHT = '40px'

const applyChrome = () => {
  const doc = document
  const html = doc.documentElement
  const body = doc.body
  if (!body || doc.getElementById('lx-login-titlebar')) return

  // 窗口背景裁切为圆角（窗口本身 transparent，页面背景保持白底圆角）
  html.style.cssText += ';background: transparent !important; height: 100% !important; overflow: hidden !important;'
  body.style.cssText += ';border-radius: 12px !important; height: 100% !important; overflow: hidden !important; margin: 0 !important; padding-top: 0 !important; box-sizing: border-box !important;'
  // Give fixed site headers their own viewport below the title bar. Keep the
  // native drag controls inside body so Chromium computes their hit regions.
  const content = doc.createElement('div')
  content.id = 'lx-login-content'
  content.style.cssText = 'position: absolute; top: ' + BAR_HEIGHT + '; bottom: 0; left: 0; right: 0; overflow: auto; transform: translateZ(0);'
  while (body.firstChild) content.appendChild(body.firstChild)
  body.appendChild(content)

  const bar = doc.createElement('div')
  bar.id = 'lx-login-titlebar'
  const barStyle: Record<string, string> = {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    height: BAR_HEIGHT,
    'z-index': '2147483647',
    display: 'flex',
    'align-items': 'center',
    gap: '6px',
    padding: '0 8px 0 16px',
    background: '#f5f6f8',
    'border-bottom': '1px solid rgba(0,0,0,.08)',
    'border-radius': '12px 12px 0 0',
    '-webkit-app-region': 'drag',
    'user-select': 'none',
  }
  for (const [key, value] of Object.entries(barStyle)) bar.style.setProperty(key, value)

  const title = doc.createElement('span')
  title.textContent = doc.title || ''
  const titleStyle: Record<string, string> = {
    flex: '1',
    'min-width': '0',
    'font-size': '13px',
    color: '#5f6368',
    'white-space': 'nowrap',
    overflow: 'hidden',
    'text-overflow': 'ellipsis',
    'pointer-events': 'none',
  }
  for (const [key, value] of Object.entries(titleStyle)) title.style.setProperty(key, value)

  const makeButton = (text: string, isClose: boolean) => {
    const btn = doc.createElement('button')
    btn.textContent = text
    const btnStyle: Record<string, string> = {
      flex: 'none',
      border: 'none',
      cursor: 'pointer',
      'font-size': isClose ? '15px' : '12px',
      padding: isClose ? '0' : '5px 12px',
      width: isClose ? '30px' : 'auto',
      height: isClose ? '30px' : '26px',
      'border-radius': isClose ? '50%' : '13px',
      background: 'transparent',
      color: '#5f6368',
      '-webkit-app-region': 'no-drag',
      'line-height': '1',
    }
    for (const [key, value] of Object.entries(btnStyle)) btn.style.setProperty(key, value)
    btn.addEventListener('mouseenter', () => { btn.style.background = isClose ? 'rgba(0,0,0,.08)' : 'rgba(0,0,0,.06)' })
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent' })
    return btn
  }

  const browserBtn = makeButton('浏览器登录', false)
  browserBtn.addEventListener('click', () => { ipcRenderer.send(ACTION_CHANNEL, 'browser') })

  const closeBtn = makeButton('×', true)
  closeBtn.addEventListener('click', () => { ipcRenderer.send(ACTION_CHANNEL, 'close') })

  bar.appendChild(title)
  bar.appendChild(browserBtn)
  bar.appendChild(closeBtn)
  body.appendChild(bar)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyChrome)
} else {
  applyChrome()
}
