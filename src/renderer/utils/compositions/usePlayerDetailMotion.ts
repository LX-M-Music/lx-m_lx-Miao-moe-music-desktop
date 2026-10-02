import { nextTick, onBeforeUnmount, ref, watch } from '@common/utils/vueTools'
import { isShowPlayerDetail, isPlayerDetailDisplayed } from '@renderer/store/player/state'
import { isMotionEnabled, playMotion } from '@renderer/utils/motion'

export default ({ onOpened, onClosed }: { onOpened: () => void, onClosed: () => void }) => {
  const detailRoot = ref<HTMLElement | null>(null)
  const detailCover = ref<HTMLImageElement | null>(null)
  const detailMounted = ref(false)
  const detailDisplayed = isPlayerDetailDisplayed
  const visibled = ref(false)
  const coverTravelling = ref(false)
  let revision = 0
  let disposed = false
  let running: Animation[] = []
  const flight: { element: HTMLImageElement | null } = { element: null }

  const clear = () => {
    for (const animation of running) animation.cancel()
    running = []
    detailRoot.value?.removeAttribute('data-detail-entering')
    flight.element?.remove()
    flight.element = null
    coverTravelling.value = false
  }
  const footerCover = () => document.querySelector<HTMLImageElement>('#player [data-player-cover] img')

  watch(isShowPlayerDetail, async(visible) => {
    const token = ++revision
    const wasDisplayed = detailDisplayed.value
    const previousOpacity = wasDisplayed && detailRoot.value ? getComputedStyle(detailRoot.value).opacity : '0'
    const sourceElement = flight.element ?? (visible ? footerCover() : detailCover.value)
    const from = sourceElement?.getBoundingClientRect()
    const fromOpacity = sourceElement ? getComputedStyle(sourceElement).opacity : '1'
    clear()
    if (visible) {
      detailMounted.value = true
      detailDisplayed.value = true
      visibled.value = true
    }
    await nextTick()
    if (disposed || token !== revision || !detailRoot.value) return
    const root = detailRoot.value
    // Apply the first artwork palette while the page is still transparent.
    if (visible && !wasDisplayed) root.dataset.detailEntering = ''
    root.style.pointerEvents = visible ? '' : 'none'
    const rootAnimation = playMotion(root, [{ opacity: previousOpacity }, { opacity: visible ? 1 : 0 }], 'detail')
    if (rootAnimation) running.push(rootAnimation)

    if (visible && !wasDisplayed) {
      const parts = root.querySelectorAll<HTMLElement>('[data-detail-part]')
      parts.forEach((part, index) => {
        const animation = playMotion(part, [{ opacity: 0, transform: 'translateY(20px)' }, { opacity: 1, transform: 'translateY(0)' }], 'slow', Math.min(index * 65, 195))
        if (animation) running.push(animation)
      })
    }

    const target = visible ? detailCover.value : footerCover()
    const to = target?.getBoundingClientRect()
    let source = detailCover.value?.currentSrc
    if (!source) source = footerCover()?.currentSrc
    if (isMotionEnabled() && target && source && from?.width && to?.width && from.height && to.height) {
      const image = document.createElement('img')
      image.src = source
      image.alt = ''
      image.setAttribute('aria-hidden', 'true')
      image.dataset.coverFlight = ''
      Object.assign(image.style, {
        position: 'fixed',
        left: `${to.x}px`,
        top: `${to.y}px`,
        width: `${to.width}px`,
        height: `${to.height}px`,
        objectFit: 'cover',
        pointerEvents: 'none',
        zIndex: '30',
        transformOrigin: '0 0',
        borderRadius: getComputedStyle(target).borderRadius,
        boxShadow: getComputedStyle(target).boxShadow,
      })
      document.getElementById('root')!.appendChild(image)
      flight.element = image
      coverTravelling.value = true
      const animation = playMotion(image, [
        { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: fromOpacity },
        { transform: 'translate(0, 0) scale(1)', opacity: getComputedStyle(target).opacity },
      ], 'cover')
      if (animation) running.push(animation)
    }
    await Promise.allSettled(running.map(async animation => animation.finished))
    if (disposed || token !== revision) return
    if (visible) onOpened()
    else {
      detailDisplayed.value = false
      visibled.value = false
      onClosed()
    }
    clear()
  }, { flush: 'pre' })

  const handleCoverMove = (event: MouseEvent) => {
    if (!isMotionEnabled() || coverTravelling.value || !detailCover.value) return
    const image = detailCover.value
    const rect = image.getBoundingClientRect()
    const x = Math.max(-1, Math.min(1, (event.clientX - rect.x) / rect.width * 2 - 1))
    const y = Math.max(-1, Math.min(1, (event.clientY - rect.y) / rect.height * 2 - 1))
    image.style.transform = `perspective(1000px) rotateX(${-y * 6}deg) rotateY(${x * 6}deg) scale(1.02)`
  }
  const resetCoverTilt = () => { if (detailCover.value) detailCover.value.style.transform = '' }
  window.addEventListener('lx-motion-change', resetCoverTilt)
  onBeforeUnmount(() => {
    disposed = true
    ++revision
    clear()
    detailDisplayed.value = false
    onClosed()
    window.removeEventListener('lx-motion-change', resetCoverTilt)
  })
  return { detailRoot, detailCover, detailMounted, detailDisplayed, visibled, coverTravelling, handleCoverMove, resetCoverTilt }
}
