import Toast from './Toast.vue'
import { createApp } from 'vue'

let currentToast = null

/**
 * 在屏幕中间显示一个短暂的提示（Toast）
 * @param message 提示内容
 * @param {{ autoCloseTime?: number, actionText?: string, onAction?: (() => void | Promise<void>) | null, error?: boolean }} options
 */
export default (message, { autoCloseTime = 1500, actionText = '', onAction = null, error = false } = {}) => {
  if (error && window.lxData?.appSetting?.['common.showErrorDialog'] !== true) return { cancel() {} }
  if (currentToast) currentToast.cancel()

  let timer = null
  const pause = () => { clearTimeout(timer) }
  const resume = () => {
    pause()
    timer = setTimeout(() => { toast.cancel() }, autoCloseTime)
  }
  let app = createApp(Toast, {
    actionText,
    onAction: async() => {
      pause()
      try { await onAction?.() } finally { toast.cancel() }
    },
    pause,
    resume,
    afterLeave() {
      app.unmount()
      app = null
    },
  })
  const instance = app.mount(document.createElement('div'))

  instance.visible = true
  instance.message = message

  document.body.appendChild(instance.$el)

  const toast = {
    cancel() {
      if (currentToast !== toast) return
      clearTimeout(timer)
      currentToast = null
      instance.visible = false
    },
  }
  currentToast = toast
  resume()

  return toast
}
