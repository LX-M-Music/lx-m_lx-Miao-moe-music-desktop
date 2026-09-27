<template>
  <div :class="$style.menu">
    <ul ref="dom_list" :class="$style.list" role="toolbar" :aria-label="$t('sidebar__navigation')">
      <li v-for="item in menus" :key="item.id" :class="$style.navItem" :data-sidebar-nav="item.id" role="presentation">
        <router-link
          :class="[$style.link, { [$style.active]: $route.meta.name == item.id }]" role="tab" :aria-selected="$route.meta.name == item.id"
          :to="item.to" :aria-label="$t(item.label)" :aria-description="locked ? undefined : $t('sidebar__reorder_tip')" draggable="false"
          @keydown.alt.up.prevent.stop="moveByKeyboard(item.id, -1)" @keydown.alt.down.prevent.stop="moveByKeyboard(item.id, 1)"
          @contextmenu.stop.prevent
        >
          <svg :class="$style.icon" xmlns="http://www.w3.org/2000/svg" :viewBox="item.viewBox" aria-hidden="true" draggable="false">
            <use :xlink:href="item.icon" />
          </svg>
        </router-link>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, useCssModule } from '@common/utils/vueTools'
import { SIDEBAR_ITEMS, moveSidebarItem, parseSidebarOrder, sidebarItemVisible, type SidebarId } from '@common/sidebar'
import { appSetting } from '@renderer/store/setting'
import { updateSetting } from '@renderer/utils/ipc'
import showToast from '@renderer/plugins/Toast'
import useNavDrag from './useNavDrag'

const emit = defineEmits<(event: 'dragging', dragging: boolean) => void>()
const dom_list = ref<HTMLElement>()
const draftOrder = ref<SidebarId[] | null>(null)
const styles = useCssModule()
const locked = computed(() => appSetting['ui.sidebar.locked'])
const order = computed(() => draftOrder.value ?? parseSidebarOrder(appSetting['ui.sidebar.order']))
const menus = computed(() => order.value.filter(id => sidebarItemVisible(id, appSetting)).map(id => SIDEBAR_ITEMS.find(item => item.id == id)!))
let revision = 0

const reorder = async(id: SidebarId, toIndex: number) => {
  if (locked.value) return
  const next = moveSidebarItem(order.value, menus.value.map(item => item.id), id, toIndex)
  if (next === order.value) return
  const current = ++revision
  draftOrder.value = next
  try {
    await updateSetting({ 'ui.sidebar.order': next.join(',') })
  } catch {
    showToast(window.i18n.t('sidebar__save_error'), { error: true })
  } finally {
    if (current == revision) draftOrder.value = null
  }
}
const moveByKeyboard = async(id: SidebarId, direction: number) => {
  if (locked.value) return
  await reorder(id, menus.value.findIndex(item => item.id == id) + direction)
  await nextTick()
  dom_list.value?.querySelector<HTMLElement>('[data-sidebar-nav="' + id + '"] a')?.focus()
}
useNavDrag({
  element: dom_list,
  disabled: locked,
  ghostClass: styles.dragging,
  onReorder: (id: SidebarId, toIndex: number) => { void reorder(id, toIndex) },
  onDragging: (dragging: boolean) => { emit('dragging', dragging) },
})
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.menu {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-bottom: 28px;
  -webkit-app-region: no-drag;
  scrollbar-width: thin;
}
.list { -webkit-app-region: no-drag; }
.navItem {
  position: relative;
  height: clamp(44px, calc(var(--sidebar-current-width, 90px) * .84), 80px);
}
.link {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  color: var(--color-nav-font);
  cursor: pointer;
  outline: none;
  transition: background-color var(--duration-fast), color var(--duration-fast), opacity var(--duration-fast);
  .mixin-ellipsis-1();

  &:before {
    .mixin-after();
    left: 0;
    top: 0;
    width: 3px;
    height: 100%;
    background-color: var(--color-primary-dark-200-alpha-700);
    border-radius: 4px;
    transform: translateX(-100%);
    transition: transform var(--duration-fast);
  }
  &.active {
    background-color: var(--color-primary-light-300-alpha-700);
    &:before { transform: translateX(0); }
    &:hover { background-color: var(--color-primary-light-300-alpha-800); }
  }
  &:hover:not(.active) {
    background-color: var(--color-primary-light-400-alpha-700);
  }
  &:focus-visible { box-shadow: inset var(--focus-ring); }
}
.icon {
  width: clamp(20px, calc(var(--sidebar-current-width, 90px) * .32), 40px);
  height: clamp(20px, calc(var(--sidebar-current-width, 90px) * .32), 40px);
  pointer-events: none;
}
.dragging {
  opacity: .3;
  background-color: var(--color-primary-light-300-alpha-700);
}
</style>
