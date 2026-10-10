import { onBeforeUnmount, onDeactivated, onMounted, shallowRef, watch, type Ref } from 'vue'
import { updateListMusicsPosition } from '@renderer/store/list/action'
import toast from '@renderer/plugins/Toast'

const LONG_PRESS_DELAY = 450
const MOVE_THRESHOLD = 6

interface DragPreview {
  ids: Set<string>
  name: string
  top: number
  lineTop: number
  valid: boolean
  showLine: boolean
}

interface Gesture {
  pointerId: number
  listId: string
  songs: LX.Music.MusicInfo[]
  musicInfo: LX.Music.MusicInfo
  container: HTMLElement
  startX: number
  startY: number
  x: number
  y: number
  scrollTop: number
  boundary: number
  moved: boolean
}

export default ({ props, list, listRef, listItemHeight, selectedList, enabled, onStart, onSaved }: {
  props: { listId: string }
  list: Ref<LX.Music.MusicInfo[]>
  listRef: Ref<{ $el: HTMLElement } | null>
  listItemHeight: Ref<number>
  selectedList: Ref<LX.Music.MusicInfo[]>
  enabled?: Ref<boolean>
  onStart: () => void
  onSaved: () => void
}) => {
  const songDrag = shallowRef<DragPreview | null>(null)
  let gesture: Gesture | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let frame = 0
  let lastFrame = 0
  let suppressClick = false
  let saving = false

  const cancel = () => {
    clearTimeout(timer)
    cancelAnimationFrame(frame)
    const current = gesture
    gesture = null
    if (current?.container.hasPointerCapture(current.pointerId)) current.container.releasePointerCapture(current.pointerId)
    if (songDrag.value) {
      songDrag.value = null
      document.body.classList.remove('playlist-song-dragging')
      window.app_event.dragEnd()
    }
  }

  const paint = () => {
    const current = gesture
    const preview = songDrag.value
    if (!current || !preview) return
    const rect = current.container.getBoundingClientRect()
    const height = current.container.clientHeight
    const y = current.y - rect.top
    const valid = current.x >= rect.left && current.x < rect.left + current.container.clientWidth && y >= 0 && y <= height
    current.boundary = Math.max(0, Math.min(current.songs.length, Math.round((y + current.container.scrollTop) / listItemHeight.value)))
    const lineTop = current.boundary * listItemHeight.value - current.container.scrollTop
    const position = {
      top: Math.max(0, Math.min(height - 60, y + 14)),
      lineTop: Math.max(2, Math.min(height - 2, lineTop)),
      valid,
      showLine: valid && lineTop >= -1 && lineTop <= height + 1,
    }
    if (position.top !== preview.top || position.lineTop !== preview.lineTop || position.valid !== preview.valid || position.showLine !== preview.showLine) {
      songDrag.value = { ...preview, ...position }
    }
  }

  const autoScroll = (time: number) => {
    const current = gesture
    if (!current || !songDrag.value) return
    const elapsed = Math.min(32, time - lastFrame)
    lastFrame = time
    const rect = current.container.getBoundingClientRect()
    const edge = Math.min(56, rect.height / 4)
    // Wait for intentional movement, so simply holding an edge row never scrolls it away.
    if (current.moved && current.x >= rect.left && current.x < rect.right && current.y >= rect.top - edge && current.y <= rect.bottom + edge) {
      const speed = current.y < rect.top + edge
        ? -Math.min(1, (rect.top + edge - current.y) / edge)
        : current.y > rect.bottom - edge ? Math.min(1, (current.y - rect.bottom + edge) / edge) : 0
      current.container.scrollTop += speed * elapsed * 0.75
    }
    paint()
    frame = requestAnimationFrame(autoScroll)
  }

  const start = () => {
    const current = gesture
    if (!current || current.listId !== props.listId || current.songs !== list.value || !current.container.isConnected) {
      cancel()
      return
    }
    const selected = new Set(selectedList.value.map(song => song.id))
    const ids = selected.has(current.musicInfo.id)
      ? new Set(current.songs.filter(song => selected.has(song.id)).map(song => song.id))
      : new Set([current.musicInfo.id])
    songDrag.value = { ids, name: current.musicInfo.name, top: 0, lineTop: 0, valid: true, showLine: false }
    suppressClick = true
    onStart()
    window.getSelection()?.removeAllRanges()
    document.body.classList.add('playlist-song-dragging')
    // Capture on the stable viewport; virtual rows can be recycled during scrolling.
    current.container.setPointerCapture(current.pointerId)
    window.app_event.dragStart()
    paint()
    lastFrame = performance.now()
    frame = requestAnimationFrame(autoScroll)
  }

  const handleSongPointerDown = (event: PointerEvent, musicInfo: LX.Music.MusicInfo) => {
    if (enabled?.value === false || event.button !== 0 || !event.isPrimary || saving || list.value.length < 2) return
    const target = event.target
    if (!(target instanceof Element) || target.closest('button, a, input, textarea, select, [contenteditable="true"]')) return
    const container = listRef.value?.$el
    // Resolve the rendered song by ID, including during a pending virtual-list refresh.
    if (!container || !list.value.some(song => song.id === musicInfo.id)) return
    gesture = {
      pointerId: event.pointerId,
      listId: props.listId,
      songs: list.value,
      musicInfo,
      container,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      scrollTop: container.scrollTop,
      boundary: 0,
      moved: false,
    }
    timer = setTimeout(start, LONG_PRESS_DELAY)
  }

  const onPointerMove = (event: PointerEvent) => {
    const current = gesture
    if (!current || event.pointerId !== current.pointerId) return
    if (!(event.buttons & 1)) {
      cancel()
      return
    }
    current.x = event.clientX
    current.y = event.clientY
    const moved = Math.hypot(current.x - current.startX, current.y - current.startY) > MOVE_THRESHOLD
    if (!songDrag.value) {
      if (moved) cancel()
      return
    }
    current.moved ||= moved
    event.preventDefault()
    paint()
  }

  const save = async(listId: string, songs: LX.Music.MusicInfo[], ids: Set<string>, boundary: number) => {
    const orderedIds = songs.filter(song => ids.has(song.id)).map(song => song.id)
    const position = songs.slice(0, boundary).filter(song => !ids.has(song.id)).length
    if (orderedIds.every((id, index) => songs[position + index]?.id === id)) return
    saving = true
    try {
      await updateListMusicsPosition({ listId, ids: orderedIds, position })
      if (listId === props.listId) onSaved()
    } catch {
      toast(window.i18n.t('list__reorder_failed'))
    } finally {
      saving = false
    }
  }

  const onPointerUp = (event: PointerEvent) => {
    const current = gesture
    if (!current || event.pointerId !== current.pointerId) return
    current.x = event.clientX
    current.y = event.clientY
    paint()
    const preview = songDrag.value
    const commit = preview?.valid && current.moved && current.listId === props.listId && current.songs === list.value
    cancel()
    if (commit && preview) void save(current.listId, current.songs, preview.ids, current.boundary)
  }

  const onPointerDown = () => {
    cancel()
    suppressClick = false
  }
  const onClick = (event: MouseEvent) => {
    if (!suppressClick || event.detail === 0) return
    suppressClick = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const onContextMenu = (event: Event) => {
    if (!songDrag.value) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (!gesture || event.key !== 'Escape') return
    event.preventDefault()
    event.stopImmediatePropagation()
    cancel()
  }
  const onScroll = (event: Event) => {
    if (gesture && event.target === gesture.container && !songDrag.value && gesture.container.scrollTop !== gesture.scrollTop) cancel()
  }
  const onTouchMove = (event: TouchEvent) => {
    if (songDrag.value) event.preventDefault()
  }
  const onLostPointerCapture = (event: PointerEvent) => {
    if (gesture?.pointerId === event.pointerId && event.target === gesture.container) cancel()
  }

  watch([list, () => props.listId, listRef, listItemHeight, () => enabled?.value], cancel, { flush: 'sync' })
  onDeactivated(cancel)
  onMounted(() => {
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointermove', onPointerMove, { capture: true, passive: false })
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', cancel, true)
    document.addEventListener('lostpointercapture', onLostPointerCapture, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('contextmenu', onContextMenu, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
    window.addEventListener('blur', cancel)
  })
  onBeforeUnmount(() => {
    cancel()
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('pointercancel', cancel, true)
    document.removeEventListener('lostpointercapture', onLostPointerCapture, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('contextmenu', onContextMenu, true)
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('scroll', onScroll, true)
    document.removeEventListener('touchmove', onTouchMove, true)
    window.removeEventListener('blur', cancel)
  })

  return { songDrag, handleSongPointerDown }
}
