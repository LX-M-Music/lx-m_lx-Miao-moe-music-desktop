<template lang="pug">
div(:class="$style.header")
  div(ref="dom_btns" :class="[$style.controBtn, { [$style.traffic]: isTrafficStyle, [$style.iconAlways]: isIconAlways }]")
    button(type="button" :class="$style.hide" :aria-label="$t('player__hide_detail_tip')" ignore-tip :title="$t('player__hide_detail_tip')" @click="hide")
      svg(:class="$style.controBtnIcon" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="80%" viewBox="0 0 30.727 30.727" space="preserve")
        use(xlink:href="#icon-window-hide")
    button(type="button" :class="$style.fullscreenExit" :aria-label="$t('fullscreen_exit')" ignore-tip :title="$t('fullscreen_exit')" @click="fullscreenExit")
      svg(:class="$style.controBtnIcon" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="100%")
        use(xlink:href="#icon-fullscreen-exit")
    button(type="button" :class="$style.min" :aria-label="$t('min')" ignore-tip :title="$t('min')" @click="minWindow")
      svg(:class="$style.controBtnIcon" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="100%" viewBox="0 0 24 24" space="preserve")
        use(xlink:href="#icon-window-minimize")

    button(type="button" :class="$style.max" :aria-label="$t(isMaximized ? 'window_restore' : 'window_maximize')" ignore-tip :title="$t(isMaximized ? 'window_restore' : 'window_maximize')" @click="maxWindow")
      svg(:class="$style.controBtnIcon" xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 24 24")
        use(:xlink:href="isMaximized ? '#icon-window-restore' : '#icon-window-maximize'")
    button(type="button" :class="$style.close" :aria-label="$t('close')" ignore-tip :title="$t('close')" @click="closeWindow")
      svg(:class="$style.controBtnIcon" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="100%" viewBox="0 0 24 24" space="preserve")
        use(xlink:href="#icon-window-close")
</template>


<script setup>
import { ref, onMounted, onBeforeUnmount, useCssModule } from '@common/utils/vueTools'
import { isFullscreen, isMaximized } from '@renderer/store'
import { setShowPlayerDetail } from '@renderer/store/player/action'
import { closeWindow, minWindow, maxWindow, setFullScreen } from '@renderer/utils/ipc'
import { useWindowControls } from '../useWindowControls'

const dom_btns = ref()

const { isTrafficStyle, isIconAlways } = useWindowControls()

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


const hide = () => {
  dom_btns.value?.classList.remove(cssModule.hover)
  setShowPlayerDetail(false)
}
const fullscreenExit = () => {
  dom_btns.value?.classList.remove(cssModule.hover)
  void setFullScreen(false).then((fullscreen) => {
    isFullscreen.value = fullscreen
  })
}


</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

@control-btn-width: @height-toolbar * .26;

:global(.fullscreen) {
  .header {
    -webkit-app-region: no-drag;
    align-self: flex-start;
    .controBtn {
      .close, .min, .max {
        display: none;
      }
      .fullscreenExit {
        display: flex;
      }
    }
  }
}
:global(.maximized) .header {
  -webkit-app-region: no-drag;
}
.header {
  position: relative;
  flex: 0 0 @height-toolbar;
  -webkit-app-region: drag;
  width: 100%;

  .controBtn {
    position: absolute;
    top: 0;
    display: flex;
    -webkit-app-region: no-drag;

    button {
      display: flex;
      position: relative;
      background: none;
      border: none;
      outline: none;
      padding: 1px;
      cursor: pointer;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .fullscreenExit {
      display: none;
    }
  }
  .controBtn {
    align-items: center;
    padding: 0 @control-btn-width;
    left: 0;
    flex-direction: row-reverse;
    height: @height-toolbar * .7;
    transition: opacity @transition-normal;
    opacity: 1;
    &.hover {
      opacity: 1;
      .controBtnIcon {
        opacity: 1;
      }
    }

    button {
      width: @control-btn-width;
      height: @control-btn-width;
      border-radius: 50%;
      // 图标使用中性灰、圆滑样式（与原版 lx-music-desktop 一致）
      color: var(--color-500);
      + button {
        margin-right: (@control-btn-width / 2);
      }

      &.hide {
        background-color: var(--color-450);
      }
      &.min, &.fullscreenExit {
        background-color: var(--color-450);
      }
      &.max {
        background-color: var(--color-450);
      }
      &.close {
        background-color: var(--color-450);
        &:hover {
          background-color: #e5776f;
        }
      }
      &:hover:not(.close) {
        background-color: var(--color-500);
      }
    }
  }

  // 红绿灯（macOS）风格
  .controBtn.traffic {
    button {
      &.min, &.fullscreenExit {
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

  .controBtn.iconAlways .controBtnIcon {
    opacity: 1;
  }

  .controBtnIcon {
    opacity: 0;
    transition: opacity 0.2s ease-in-out;
  }
}

</style>
