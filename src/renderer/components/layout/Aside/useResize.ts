import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from '@common/utils/vueTools'
import { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from '@common/sidebar'
import { appSetting } from '@renderer/store/setting'
import { updateSetting } from '@renderer/utils/ipc'
import showToast from '@renderer/plugins/Toast'

export default (aside: Ref<HTMLElement | undefined>) => {
  const draftWidth = ref<number | null>(null)
  const currentWidth = ref(SIDEBAR_MIN_WIDTH)
  const maxWidth = ref(SIDEBAR_MAX_WIDTH)
  const resizing = ref(false)
  const locked = computed(() => appSetting['ui.sidebar.locked'])
  let observer: ResizeObserver | undefined
  let pointer: { id: number, startX: number, startWidth: number, target: HTMLElement } | null = null
  let revision = 0
  const clamp = (value: number) => Math.round(Math.max(SIDEBAR_MIN_WIDTH, Math.min(maxWidth.value, value)))
  const style = computed(() => {
    const requested = draftWidth.value ?? appSetting['ui.sidebar.width']
    return {
      width: Number.isFinite(requested) && requested > 0 ? `${clamp(requested)}px` : undefined,
      '--sidebar-current-width': `${currentWidth.value}px`,
    }
  })

  const saveWidth = async(width: number) => {
    if (locked.value) return
    const current = ++revision
    draftWidth.value = width
    try {
      await updateSetting({ 'ui.sidebar.width': width })
    } catch {
      showToast(window.i18n.t('sidebar__save_error'), { error: true })
    } finally {
      if (current == revision && !resizing.value) draftWidth.value = null
    }
  }
  const stop = () => {
    const previous = pointer
    pointer = null
    resizing.value = false
    document.documentElement.classList.remove('sidebar-resizing')
    if (previous?.target.hasPointerCapture(previous.id)) previous.target.releasePointerCapture(previous.id)
  }
  const cancelResize = () => {
    if (!pointer) return
    stop()
    draftWidth.value = null
  }
  const onPointerDown = (event: PointerEvent) => {
    if (locked.value || event.button != 0 || !event.isPrimary || !aside.value || pointer) return
    event.preventDefault()
    const target = event.currentTarget as HTMLElement
    pointer = { id: event.pointerId, startX: event.clientX, startWidth: aside.value.getBoundingClientRect().width, target }
    target.setPointerCapture(event.pointerId)
    target.focus()
    resizing.value = true
    document.documentElement.classList.add('sidebar-resizing')
  }
  const onPointerMove = (event: PointerEvent) => {
    if (!pointer || event.pointerId != pointer.id) return
    draftWidth.value = clamp(pointer.startWidth + event.clientX - pointer.startX)
  }
  const onPointerUp = (event: PointerEvent) => {
    if (!pointer || event.pointerId != pointer.id) return
    const width = clamp(pointer.startWidth + event.clientX - pointer.startX)
    stop()
    void saveWidth(width)
  }
  const resetWidth = () => {
    if (locked.value) return
    cancelResize()
    void saveWidth(0)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key == 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelResize()
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    if (locked.value) return
    const step = event.shiftKey ? 1 : 8
    const base = draftWidth.value ?? aside.value?.getBoundingClientRect().width ?? currentWidth.value
    const width = event.key == 'Home' ? SIDEBAR_MIN_WIDTH : event.key == 'End' ? maxWidth.value : base + (event.key == 'ArrowLeft' ? -step : step)
    void saveWidth(clamp(width))
  }
  watch(locked, value => { if (value) cancelResize() }, { flush: 'sync' })
  onMounted(() => {
    if (!aside.value) return
    observer = new ResizeObserver(() => {
      if (!aside.value) return
      currentWidth.value = aside.value.getBoundingClientRect().width
      maxWidth.value = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.floor((aside.value.parentElement?.clientWidth ?? window.innerWidth) * 0.28)))
    })
    observer.observe(aside.value)
    if (aside.value.parentElement) observer.observe(aside.value.parentElement)
    window.addEventListener('blur', cancelResize)
  })
  onBeforeUnmount(() => {
    stop()
    observer?.disconnect()
    window.removeEventListener('blur', cancelResize)
  })
  return { style, locked, currentWidth, maxWidth, resizing, onPointerDown, onPointerMove, onPointerUp, cancelResize, resetWidth, onKeyDown }
}
