<template>
  <aside ref="sidebar" :class="[$style.root, { [$style.resizing]: resizing, [$style.collapsed]: collapsed }]" :style="sidebarStyle" :data-panel-sidebar="name" :aria-label="label">
    <div :id="contentId" :class="$style.content" :aria-hidden="collapsed || undefined" :inert="collapsed ? '' : null">
      <slot />
    </div>
    <div v-if="keys.collapsed" :class="$style.rail">
      <button
        type="button" :class="$style.toggle" :aria-expanded="!collapsed" :aria-controls="contentId" data-motion-button
        :aria-label="$t(collapsed ? 'sidebar__expand_panel' : 'sidebar__collapse_panel', { name: label })"
        @click="toggleCollapsed" @keydown.stop @keyup.stop
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 5-7 7 7 7" />
        </svg>
      </button>
    </div>
    <div
      v-if="!collapsed" :class="[$style.resizeHandle, { [$style.fullHeight]: !keys.collapsed }]" data-panel-sidebar-resize role="separator" tabindex="0"
      aria-orientation="vertical" :aria-controls="contentId" :aria-label="$t('sidebar__resize')"
      :aria-valuemin="MIN_WIDTH" :aria-valuemax="maxWidth" :aria-valuenow="currentWidth"
      @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
      @pointercancel="cancelResize" @lostpointercapture="cancelResize" @keydown="onKeyDown" @keyup.stop
      @dblclick.prevent.stop="resetWidth"
    />
  </aside>
</template>

<script setup lang="ts">
import type { PropType } from 'vue'
import { computed, onBeforeUnmount, onMounted, ref } from '@common/utils/vueTools'
import { windowFontSize } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'
import { updateSetting } from '@renderer/utils/ipc'
import showToast from '@renderer/plugins/Toast'

const props = defineProps({
  name: { type: String as PropType<'myList' | 'leaderboard' | 'setting'>, required: true },
  label: { type: String, required: true },
})
const settings = {
  myList: { width: 'ui.myListSidebar.width', collapsed: 'ui.myListSidebar.collapsed', defaultWidth: (width: number) => width * 0.16 },
  leaderboard: { width: 'ui.leaderboardSidebar.width', collapsed: 'ui.leaderboardSidebar.collapsed', defaultWidth: (width: number) => width * 0.148 },
  setting: { width: 'ui.settingSidebar.width', collapsed: null, defaultWidth: () => 180 * windowFontSize.value / 16 },
} as const
const keys = computed(() => settings[props.name])
const contentId = computed(() => `panel-sidebar-${props.name}`)
const MIN_WIDTH = 140
const MAX_WIDTH = 420
const RAIL_WIDTH = 24
const sidebar = ref<HTMLElement | null>(null)
const parentWidth = ref(0)
const draftWidth = ref<number | null>(null)
const draftCollapsed = ref<boolean | null>(null)
const resizing = ref(false)
const maxWidth = computed(() => parentWidth.value
  ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(parentWidth.value * 0.5), parentWidth.value - 280))
  : MAX_WIDTH)
const clamp = (width: number) => Math.round(Math.max(MIN_WIDTH, Math.min(maxWidth.value, width)))
const currentWidth = computed(() => {
  const width = draftWidth.value ?? appSetting[keys.value.width]
  return clamp(Number.isFinite(width) && width > 0 ? width : keys.value.defaultWidth(parentWidth.value))
})
const collapsed = computed(() => draftCollapsed.value ?? (keys.value.collapsed ? appSetting[keys.value.collapsed] : false))
const sidebarStyle = computed(() => ({
  width: `${collapsed.value ? RAIL_WIDTH : currentWidth.value}px`,
  marginRight: `${collapsed.value ? -RAIL_WIDTH : 0}px`,
  '--panel-sidebar-rail': `${RAIL_WIDTH}px`,
}))

let pointer: { id: number, startX: number, startWidth: number, target: HTMLElement } | null = null
let observer: ResizeObserver | undefined
let widthRevision = 0
let collapseRevision = 0

const saveWidth = async(width: number) => {
  const revision = ++widthRevision
  draftWidth.value = width
  try {
    await updateSetting({ [keys.value.width]: width })
  } catch {
    showToast(window.i18n.t('sidebar__save_error'), { error: true })
  } finally {
    if (revision === widthRevision && !resizing.value) draftWidth.value = null
  }
}
const stop = () => {
  const previous = pointer
  pointer = null
  resizing.value = false
  document.documentElement.classList.remove('panel-sidebar-resizing')
  if (previous?.target.hasPointerCapture(previous.id)) previous.target.releasePointerCapture(previous.id)
}
const cancelResize = () => {
  if (!pointer) return
  stop()
  draftWidth.value = null
}
const onPointerDown = (event: PointerEvent) => {
  event.stopPropagation()
  if (event.button !== 0 || !event.isPrimary || !sidebar.value || pointer) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  pointer = { id: event.pointerId, startX: event.clientX, startWidth: sidebar.value.getBoundingClientRect().width, target }
  draftWidth.value = clamp(pointer.startWidth)
  target.setPointerCapture(event.pointerId)
  target.focus()
  resizing.value = true
  document.documentElement.classList.add('panel-sidebar-resizing')
}
const onPointerMove = (event: PointerEvent) => {
  if (!pointer || event.pointerId !== pointer.id) return
  draftWidth.value = clamp(pointer.startWidth + event.clientX - pointer.startX)
}
const onPointerUp = (event: PointerEvent) => {
  if (!pointer || event.pointerId !== pointer.id) return
  const width = clamp(pointer.startWidth + event.clientX - pointer.startX)
  stop()
  void saveWidth(width)
}
const resetWidth = () => {
  cancelResize()
  void saveWidth(0)
}
const toggleCollapsed = async() => {
  const key = keys.value.collapsed
  if (!key) return
  cancelResize()
  const revision = ++collapseRevision
  const value = !collapsed.value
  draftCollapsed.value = value
  try {
    await updateSetting({ [key]: value })
  } catch {
    showToast(window.i18n.t('sidebar__save_error'), { error: true })
  } finally {
    if (revision === collapseRevision) draftCollapsed.value = null
  }
}
const onKeyDown = (event: KeyboardEvent) => {
  event.stopPropagation()
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelResize()
    return
  }
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const step = event.shiftKey ? 1 : 8
  const width = event.key === 'Home' ? MIN_WIDTH : event.key === 'End' ? maxWidth.value : currentWidth.value + (event.key === 'ArrowLeft' ? -step : step)
  void saveWidth(clamp(width))
}

onMounted(() => {
  const parent = sidebar.value?.parentElement
  if (parent) {
    const measure = () => { parentWidth.value = parent.clientWidth }
    measure()
    observer = new ResizeObserver(measure)
    observer.observe(parent)
  }
  window.addEventListener('blur', cancelResize)
})
onBeforeUnmount(() => {
  stop()
  observer?.disconnect()
  window.removeEventListener('blur', cancelResize)
})
</script>

<style lang="less" module>
.root {
  position: relative;
  z-index: 1;
  display: flex;
  flex: none;
  // Keep the control inside a nonzero box when a collapsed page is mounted again.
  min-width: var(--panel-sidebar-rail);
  min-height: 0;
  height: 100%;
  transition: width var(--duration-page) var(--ease-standard), margin-right var(--duration-page) var(--ease-standard);
}
.content {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  opacity: 1;
  visibility: visible;
  transition: opacity var(--duration-panel) var(--ease-standard), visibility 0s;
}
.collapsed {
  // The negative margin returns the column to the song list; only the button takes clicks.
  pointer-events: none;
  .content {
    opacity: 0;
    visibility: hidden;
    transition: opacity var(--duration-panel) var(--ease-standard), visibility 0s var(--duration-page);
  }
  .toggle {
    pointer-events: auto;
    border-radius: 0 4px 4px 0;
    background-color: var(--color-primary-background-hover);
    &:hover { background-color: var(--color-button-background-hover); }
    svg { transform: rotate(180deg); }
  }
}
.rail {
  position: absolute;
  top: 0;
  // A percentage keeps the zero's unit through the px-to-rem build step.
  left: max(0%, calc(100% - var(--panel-sidebar-rail)));
  width: var(--panel-sidebar-rail);
  height: auto;
  -webkit-app-region: no-drag;
}
.toggle {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 38px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-button-font);
  cursor: pointer;
  -webkit-app-region: no-drag;
  &:hover { background-color: var(--color-primary-background-hover); }
  &:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--color-primary); }
  svg {
    flex: none;
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--duration-page) var(--ease-standard);
  }
}
.resizeHandle {
  position: absolute;
  top: 38px;
  left: 100%;
  bottom: 0;
  width: 8px;
  // Leave the sidebar's scrollbar reachable while keeping the divider on its edge.
  transform: translateX(-1px);
  cursor: col-resize;
  touch-action: none;
  outline: none;
  -webkit-app-region: no-drag;
  &:before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 1px;
    width: 1px;
    transform: translateX(-50%);
    background: var(--color-primary);
    opacity: .15;
    transition: opacity var(--duration-fast);
  }
  &:hover:before, &:focus-visible:before { opacity: .65; }
  &.fullHeight { top: 0; }
}
.resizing {
  transition: none;
  .resizeHandle:before { opacity: .8; }
}
</style>

<style lang="less">
.panel-sidebar-resizing, .panel-sidebar-resizing * {
  cursor: col-resize !important;
  user-select: none !important;
}
</style>
