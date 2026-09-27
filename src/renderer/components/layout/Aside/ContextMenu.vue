<template>
  <teleport to="#root">
    <div
      ref="dom_menu" :class="$style.menu" :style="menuStyles" role="menu" :aria-label="$t('sidebar__visibility')" :aria-hidden="!modelValue"
      @contextmenu.prevent.stop @keydown="onKeyDown" @keyup.stop
    >
      <p :class="$style.heading" role="presentation">{{ $t('sidebar__visibility') }}</p>
      <button
        v-for="item in toggles" :key="item.id" type="button" role="menuitemcheckbox" :aria-checked="isVisible(item.id)"
        :tabindex="modelValue ? 0 : -1" :class="$style.item" :disabled="saving" @click="toggle(item.id)"
      >
        <span :class="$style.check" aria-hidden="true">{{ isVisible(item.id) ? '✓' : '' }}</span>
        {{ $t(item.label) }}
      </button>
      <p :class="$style.hint" role="presentation">{{ $t('sidebar__visibility_tip') }}</p>
      <div :class="$style.divider" role="separator" />
      <button
        type="button" role="menuitemcheckbox" :aria-checked="locked" :tabindex="modelValue ? 0 : -1"
        :class="$style.item" :disabled="saving" @click="toggleLock"
      >
        <span :class="$style.check" aria-hidden="true">{{ locked ? '✓' : '' }}</span>
        {{ $t('sidebar__lock') }}
      </button>
      <button type="button" role="menuitem" :tabindex="modelValue ? 0 : -1" :class="$style.item" :disabled="saving || locked" @click="resetWidth">{{ $t('sidebar__reset_width') }}</button>
      <button type="button" role="menuitem" :tabindex="modelValue ? 0 : -1" :class="$style.item" :disabled="saving || locked" @click="resetOrder">{{ $t('sidebar__reset_order') }}</button>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from '@common/utils/vueTools'
import { DEFAULT_SIDEBAR_ORDER, SIDEBAR_ITEMS, SIDEBAR_VISIBILITY, sidebarItemVisible, type SidebarId } from '@common/sidebar'
import { appSetting } from '@renderer/store/setting'
import { updateSetting } from '@renderer/utils/ipc'
import useMenuLocation from '@renderer/utils/compositions/useMenuLocation'
import showToast from '@renderer/plugins/Toast'

const props = defineProps<{ modelValue: boolean, xy: { x: number, y: number } }>()
const emit = defineEmits<{ (event: 'update:modelValue', visible: boolean): void, (event: 'reset-width'): void }>()
const saving = ref(false)
const locked = computed(() => appSetting['ui.sidebar.locked'])
const toggles = SIDEBAR_ITEMS.filter(item => item.id != 'Setting')
const isVisible = (id: SidebarId) => sidebarItemVisible(id, appSetting)
const hide = () => { emit('update:modelValue', false) }
const { dom_menu, menuStyles } = useMenuLocation({ visible: computed(() => props.modelValue), location: computed(() => props.xy), onHide: hide })
const focusFirst = async() => {
  await nextTick()
  ;(dom_menu.value as HTMLElement | null)?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
}
watch(() => props.modelValue, visible => { if (visible) void focusFirst() })
const persist = async(settings: Partial<LX.AppSetting>) => {
  saving.value = true
  try { await updateSetting(settings) } catch { showToast(window.i18n.t('sidebar__save_error'), { error: true }) } finally { saving.value = false }
}
const toggle = async(id: SidebarId) => {
  if (id == 'Setting' || saving.value) return
  const focused = document.activeElement
  await persist({ [SIDEBAR_VISIBILITY[id]]: !isVisible(id) })
  await nextTick()
  if (props.modelValue && focused instanceof HTMLElement && (dom_menu.value as HTMLElement | null)?.contains(focused)) focused.focus()
}
const toggleLock = async() => {
  if (saving.value) return
  const focused = document.activeElement
  await persist({ 'ui.sidebar.locked': !locked.value })
  await nextTick()
  if (props.modelValue && focused instanceof HTMLElement && (dom_menu.value as HTMLElement | null)?.contains(focused)) focused.focus()
}
const resetWidth = () => {
  if (locked.value || saving.value) return
  emit('reset-width')
  hide()
}
const resetOrder = async() => {
  if (locked.value || saving.value) return
  await persist({ 'ui.sidebar.order': DEFAULT_SIDEBAR_ORDER })
  hide()
}
const onKeyDown = (event: KeyboardEvent) => {
  event.stopPropagation()
  if (event.key == 'Escape') {
    hide()
    document.getElementById('left')?.focus()
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const buttons = Array.from((dom_menu.value as HTMLElement | null)?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key == 'Home' ? 0 : event.key == 'End' ? buttons.length - 1 : (current + (event.key == 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}
</script>

<style lang="less" module>
.menu {
  position: absolute;
  z-index: 20;
  width: 232px;
  padding: 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-elevated);
  box-shadow: var(--shadow-popup);
  transition: transform var(--duration-popup), opacity var(--duration-popup);
  transform-origin: top left;
  -webkit-app-region: no-drag;
}
.heading { padding: 8px; font-size: 13px; }
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 7px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-font);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  outline: none;
  &:hover { background-color: var(--color-primary-background-hover); }
  &:focus-visible { box-shadow: inset var(--focus-ring); }
  &:disabled { opacity: .45; cursor: default; background: transparent; }
}
.check { width: 16px; color: var(--color-primary); }
.hint { padding: 8px; font-size: 11px; line-height: 1.6; opacity: .65; }
.divider { height: 1px; margin: 4px 0; background: var(--color-border); }
</style>
