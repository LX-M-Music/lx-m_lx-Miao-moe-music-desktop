<template>
  <div ref="dom_btns" :class="[$style.controlBtn, { [$style.custom]: isCustomStyle, [$style.traffic]: isTrafficStyle, [$style.iconAlways]: isIconAlways }]">
    <button v-if="isFullscreen" type="button" :class="[$style.btn, $style.min]" :aria-label="$t('fullscreen_exit')" ignore-tip :title="$t('fullscreen_exit')" @click="setFullScreen(false)">
      <svg :class="$style.controlBtniIcon" xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 24 24">
        <use xlink:href="#icon-fullscreen-exit" />
      </svg>
    </button>
    <button v-show="!isFullscreen" type="button" :class="[$style.btn, $style.close]" :aria-label="$t('close')" ignore-tip :title="$t('close')" @click="closeWindow">
      <svg :class="$style.controlBtniIcon" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="100%" viewBox="0 0 24 24" space="preserve">
        <use xlink:href="#icon-window-close" />
      </svg>
    </button>
    <button v-show="!isFullscreen" type="button" :class="[$style.btn, $style.min]" :aria-label="$t('min')" ignore-tip :title="$t('min')" @click="minWindow">
      <svg :class="$style.controlBtniIcon" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="100%" viewBox="0 0 24 24" space="preserve">
        <use xlink:href="#icon-window-minimize" />
      </svg>
    </button>
    <button v-show="!isFullscreen" type="button" :class="[$style.btn, $style.max]" :aria-label="$t(isMaximized ? 'window_restore' : 'window_maximize')" ignore-tip :title="$t(isMaximized ? 'window_restore' : 'window_maximize')" @click="maxWindow">
      <svg :class="$style.controlBtniIcon" xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 24 24">
        <use :xlink:href="isMaximized ? '#icon-window-restore' : '#icon-window-maximize'" />
      </svg>
    </button>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, useCssModule } from '@common/utils/vueTools'
import { minWindow, maxWindow, closeWindow, setFullScreen } from '@renderer/utils/ipc'

// import { getRandom } from '../../utils'
import { isFullscreen, isMaximized } from '@renderer/store'
import { useWindowControls } from '../useWindowControls'

const dom_btns = ref()

const { isCustomStyle, isTrafficStyle, isIconAlways } = useWindowControls()

const cssModule = useCssModule()

const handle_focus = () => {
  if (!dom_btns.value) return
  dom_btns.value.classList.remove(cssModule.hover)
}
const handle_mouseenter = () => {
  dom_btns.value.classList.add(cssModule.hover)
}
const handle_mouseleave = () => {
  dom_btns.value.classList.remove(cssModule.hover)
}


onMounted(() => {
  window.app_event.on('focus', handle_focus)
  dom_btns.value.addEventListener('mouseenter', handle_mouseenter)
  dom_btns.value.addEventListener('mouseleave', handle_mouseleave)
})
onBeforeUnmount(() => {
  window.app_event.off('focus', handle_focus)
  dom_btns.value.removeEventListener('mouseenter', handle_mouseenter)
  dom_btns.value.removeEventListener('mouseleave', handle_mouseleave)
})

</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

@control-btn-width: @height-toolbar * .26;
@control-btn-height: @height-toolbar;
.controlBtn {
  box-sizing: border-box;
  padding: 0 7px;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-evenly;
  width: 100%;
  height: @control-btn-height;
  -webkit-app-region: no-drag;
  opacity: 1;
  transition: opacity @transition-normal;
  &.hover, &:focus-within {
    opacity: 1;
    .controlBtniIcon {
      opacity: 1;
    }
  }

}
.btn {
  position: relative;
  flex: none;
  width: @control-btn-width;
  height: @control-btn-width;
  background: none;
  border: none;
  display: flex;
  outline: none;
  padding: 1px;
  cursor: pointer;
  border-radius: 50%;
  color: var(--color-font);
  transition: background-color 0.2s ease-in-out;

  &.min {
    background-color: var(--color-btn-min);
  }
  &.max {
    background-color: var(--color-btn-max, #e7aa36);
  }
  &.close {
    background-color: var(--color-btn-close);
  }
}

.custom .btn {
  color: var(--color-500);
  &.min, &.max, &.close {
    background-color: var(--color-450);
  }
  &:hover {
    background-color: var(--color-500);
    &.close {
      background-color: #e5776f;
    }
  }
}

// 红绿灯（macOS）风格
.traffic {
  .btn {
    &.min {
      background-color: #febc2e;
      &:hover {
        background-color: #ffc94d;
      }
    }
    &.max {
      background-color: #28c840;
      &:hover {
        background-color: #45d95c;
      }
    }
    &.close {
      background-color: #ff5f57;
      &:hover {
        background-color: #ff7b74;
      }
    }
  }
}

.controlBtniIcon {
  opacity: 0;
  transition: opacity 0.2s ease-in-out;
}

// 图标常亮模式
.iconAlways .controlBtniIcon {
  opacity: 1;
}


</style>
