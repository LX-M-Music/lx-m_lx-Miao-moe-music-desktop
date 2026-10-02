<template>
  <div ref="dom_btns" :class="[$style.control, { [$style.traffic]: isTrafficStyle, [$style.iconAlways]: isIconAlways }]">
    <button v-if="isFullscreen" type="button" :class="[$style.btn, $style.max]" :aria-label="$t('fullscreen_exit')" ignore-tip :title="$t('fullscreen_exit')" @click="setFullScreen(false)">
      <svg xmlns="http://www.w3.org/2000/svg" height="60%" viewBox="0 0 24 24">
        <use xlink:href="#icon-fullscreen-exit" />
      </svg>
    </button>
    <button v-show="!isFullscreen" type="button" :class="[$style.btn, $style.min]" :aria-label="$t('min')" ignore-tip :title="$t('min')" @click="minWindow">
      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="60%" viewBox="0 0 24 24" space="preserve">
        <use xlink:href="#icon-window-minimize-2" />
      </svg>
    </button>
    <button v-show="!isFullscreen" type="button" :class="[$style.btn, $style.max]" :aria-label="$t(isMaximized ? 'window_restore' : 'window_maximize')" ignore-tip :title="$t(isMaximized ? 'window_restore' : 'window_maximize')" @click="maxWindow">
      <svg xmlns="http://www.w3.org/2000/svg" height="60%" viewBox="0 0 24 24">
        <use :xlink:href="isMaximized ? '#icon-window-restore' : '#icon-window-maximize'" />
      </svg>
    </button>
    <button v-show="!isFullscreen" type="button" :class="[$style.btn, $style.close]" :aria-label="$t('close')" ignore-tip :title="$t('close')" @click="closeWindow">
      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="60%" viewBox="0 0 24 24" space="preserve">
        <use xlink:href="#icon-window-close-2" />
      </svg>
    </button>
  </div>
</template>

<script setup>
import { minWindow, maxWindow, closeWindow, setFullScreen } from '@renderer/utils/ipc'
import { onMounted, onBeforeUnmount, ref, useCssModule } from '@common/utils/vueTools'
// import { getRandom } from '../../utils'
import { isFullscreen, isMaximized } from '@renderer/store'
import { useWindowControls } from '../useWindowControls'

const dom_btns = ref()
const { isTrafficStyle, isIconAlways } = useWindowControls()

const cssModule = useCssModule()

const handle_focus = () => {
  if (!dom_btns.value) return
  for (const node of dom_btns.value.childNodes) {
    if (node.tagName != 'BUTTON') continue
    node.classList.remove(cssModule.hover)
  }
}
const getBtnEl = (el) => !el || el.tagName == 'BUTTON' ? el : getBtnEl(el.parentNode)
const handle_mouseover = (event) => {
  const btn = getBtnEl(event.target)
  if (!btn) return
  btn.classList.add(cssModule.hover)
}
const handle_mouseout = (event) => {
  const btn = getBtnEl(event.target)
  if (!btn) return
  btn.classList.remove(cssModule.hover)
}


onMounted(() => {
  window.app_event.on('focus', handle_focus)
  dom_btns.value.addEventListener('mouseover', handle_mouseover)
  dom_btns.value.addEventListener('mouseout', handle_mouseout)
})
onBeforeUnmount(() => {
  window.app_event.off('focus', handle_focus)
  dom_btns.value.removeEventListener('mouseover', handle_mouseover)
  dom_btns.value.removeEventListener('mouseout', handle_mouseout)
})

</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';
@import '@renderer/assets/styles/windowControls.less';

.control {
  display: flex;
  flex: none;
  align-self: flex-start;
  -webkit-app-region: no-drag;
  height: 30px;

  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    width: 46px;
    height: 30px;
    background: none;
    border: none;
    outline: none;
    padding: 1px;
    cursor: pointer;
    color: var(--color-font-label);
    transition: background-color 0.2s ease-in-out, color 0.2s ease-in-out;
    &.hover {
      &.min, &.max {
        background-color: var(--color-button-background-hover);
      }
      &.close {
        background-color: var(--color-btn-close);
      }
    }
  }
  .right-window-controls();
}

</style>
