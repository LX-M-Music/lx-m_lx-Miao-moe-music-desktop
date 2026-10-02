<template>
  <div id="container" class="view-container" :data-ambient-enabled="ambientBackgroundEnabled ? '' : null" :data-player-detail-open="isShowPlayerDetail ? '' : null" :data-player-detail-mask="appSetting['ui.ambientBackgroundPlayDetailMask'] ? null : 'off'">
    <KawarpBackground v-if="ambientBackgroundEnabled" :key="appSetting['ui.lowPowerMode'] ? 'low-power' : 'normal'" :cover="musicInfo.pic" :detail="isShowPlayerDetail" :detail-visible="isPlayerDetailDisplayed" />
    <layout-aside id="left" :inert="isShowPlayerDetail ? '' : null" />
    <div id="right" :inert="isShowPlayerDetail ? '' : null">
      <layout-toolbar id="toolbar" />
      <layout-view id="view" />
      <layout-play-bar id="player" />
    </div>
    <layout-icons />
    <layout-change-log-modal />
    <layout-update-modal />
    <layout-pact-modal />
    <layout-sync-mode-modal />
    <layout-sync-auth-code-modal />
    <layout-play-detail />
  </div>
</template>

<script setup>
import { computed, onMounted } from '@common/utils/vueTools'
// import BubbleCursor from '@common/utils/effects/cursor-effects/bubbleCursor'
// import '@common/utils/effects/snow.min'
import useApp from '@renderer/core/useApp'
import { useSmoothAnimation } from '@renderer/utils/smoothAnimation'
import KawarpBackground from '@renderer/components/layout/PlayDetail/KawarpBackground.vue'
import { appSetting } from '@renderer/store/setting'
import { musicInfo, isShowPlayerDetail, isPlayerDetailDisplayed } from '@renderer/store/player/state'

const ambientBackgroundEnabled = computed(() => appSetting['ui.ambientBackground'] &&
  (!appSetting['ui.ambientBackgroundOnlyPlayDetail'] || isPlayerDetailDisplayed.value))

useApp()

// 启用全局平滑动画系统
useSmoothAnimation()

onMounted(() => {
  document.getElementById('root').style.display = 'block'

  // const styles = getComputedStyle(document.documentElement)
  // window.lxData.bubbleCursor = new BubbleCursor({
  //   fillStyle: styles.getPropertyValue('--color-primary-alpha-900'),
  //   strokeStyle: styles.getPropertyValue('--color-primary-alpha-700'),
  // })
})
// onBeforeUnmount(() => {
//   window.lxData.bubbleCursor?.destroy()
// })

</script>


<style lang="less">
@import './assets/styles/index.less';
@import './assets/styles/layout.less';

html {
  height: 100vh;
}
html, body {
  // overflow: hidden;
  box-sizing: border-box;
}

body {
  user-select: none;
  height: 100%;
}
#root {
  height: 100%;
  position: relative;
  overflow: hidden;
  color: var(--color-font);
  background: var(--background-image) var(--background-image-position) no-repeat;
  background-size: var(--background-image-size);
  transition: background-color var(--duration-normal) var(--ease-standard);
  background-color: var(--color-content-background);
  box-sizing: border-box;
}

.disableAnimation * {
  transition: none !important;
  animation: none !important;
}

.transparent {
  background: transparent;
  padding: @shadow-app;
  // #waiting-mask {
  //   border-radius: @radius-border;
  //   left: @shadow-app;
  //   right: @shadow-app;
  //   top: @shadow-app;
  //   bottom: @shadow-app;
  // }
  #body {
    border-radius: @radius-border;
  }
  #root {
    box-shadow: 0 0 @shadow-app rgba(0, 0, 0, 0.5);
    border-radius: @radius-border;
  }
  // #container {
    // border-radius: @radius-border;
    // background-color: transparent;
  // }
}
.disableTransparent {
  background-color: var(--color-content-background);

  #body {
    border: 1Px solid var(--color-primary-light-500);
  }

  #right {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }

  // #view { // 偏移5px距离解决非透明模式下右侧滚动条无法拖动的问题
  //   margin-right: 5Px;
  // }
}
.fullscreen, .maximized {
  background-color: var(--color-content-background);

  #right {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
}

#container {
  position: relative;
  display: flex;
  height: 100%;
  background-color: var(--color-app-background);
}

#left {
  flex: none;
  width: clamp(76px, @width-app-left, min(112px, 14vh));
}
.maximized #left, .fullscreen #left {
  width: clamp(68px, 5.8%, min(100px, 12.5vh));
}
.maximized #left, .maximized #toolbar {
  -webkit-app-region: no-drag;
}
#right {
  position: relative;
  flex: auto;
  display: flex;
  flex-flow: column nowrap;
  min-width: 0;
  transition: background-color var(--duration-normal) var(--ease-standard);
  background-color: var(--color-surface);

  border-top-left-radius: @radius-border;
  border-bottom-left-radius: @radius-border;
  overflow: hidden;
  box-shadow: inset 1px 0 0 var(--color-border);
}
#toolbar, #player {
  flex: none;
}
#view {
  position: relative;
  flex: auto;
  // display: flex;
  min-height: 0;
}
#container[data-ambient-enabled] {
  isolation: isolate;
  background-color: var(--color-surface);
  --setting-search-background: transparent;
  --player-control-opacity: 1;
  --ambient-library-opacity: .30;
  --ambient-detail-opacity: .30;
  --ambient-background-opacity: var(--ambient-library-opacity);
  --ambient-detail-surface: rgb(19, 19, 19);
  --ambient-detail-base: var(--ambient-detail-surface);
  transition: opacity var(--duration-normal) var(--ease-standard), background-color var(--duration-detail) var(--ease-standard);

  // The same canvas stays behind both screens throughout player expansion.
  > [data-ambient-background] { z-index: -1; }
  #right, #view [data-motion-outlet] { background-color: transparent; }
  #player::before { background-color: transparent; }
  > #left, > #right {
    transition: opacity var(--duration-detail) var(--ease-standard), background-color var(--duration-normal) var(--ease-standard);
  }
  &[data-player-detail-mask="off"] {
    --ambient-detail-opacity: 1;
    --ambient-detail-surface: transparent;
    --ambient-detail-base: var(--color-surface);
  }
  &[data-player-detail-open] {
    --ambient-background-opacity: var(--ambient-detail-opacity);
    --ambient-surface-color: var(--ambient-detail-surface);
    background-color: var(--ambient-surface-color);
    > #left, > #right { opacity: 0; pointer-events: none; }
  }
}

#root[data-ambient-controls], [data-player-detail][data-ambient-controls] {
  color-scheme: var(--adaptive-color-scheme);
  #container[data-ambient-enabled] {
    #left, #toolbar, #view [data-motion-outlet], #player {
      color: var(--color-font);
    }
    // Shared reading surfaces protect all inherited text without changing the
    // background renderer, typography, or individual control hover surfaces.
    #left, #toolbar, #view > [data-motion-outlet], #player {
      background-color: var(--ambient-reading-surface);
    }
  }
  // Controls inherit the live color at their own position. Shared background
  // samples drive these tokens; modal/input surfaces keep their readable base.
  [data-ambient-zone] {
    --color-font: var(--ambient-local-text);
    --color-text: var(--ambient-local-text);
    --color-850: var(--ambient-local-text);
    --color-primary-light-400-alpha-200: var(--ambient-local-text);
    --color-font-label: var(--ambient-local-secondary);
    --color-text-muted: var(--ambient-local-secondary);
    --color-text-secondary: var(--ambient-local-secondary);
    --color-200: var(--ambient-local-secondary);
    --color-300: var(--ambient-local-secondary);
    --color-400: var(--ambient-local-secondary);
    --color-450: var(--ambient-local-secondary);
    --color-500: var(--ambient-local-secondary);
    --color-550: var(--ambient-local-secondary);
    --color-650: var(--ambient-local-secondary);
    --color-700: var(--ambient-local-secondary);
    --color-primary: var(--ambient-local-accent);
    --color-accent: var(--ambient-local-accent);
    --color-nav-font: var(--ambient-local-accent);
    --color-primary-font: var(--ambient-local-accent);
    --color-primary-font-hover: var(--ambient-local-accent);
    --color-primary-font-active: var(--ambient-local-accent);
    --color-button-font: var(--ambient-local-accent);
    --color-button-font-selected: var(--ambient-local-accent);
    --color-primary-dark-100: var(--ambient-local-accent);
    --color-primary-dark-200: var(--ambient-local-accent);
    --color-primary-dark-100-alpha-100: var(--ambient-local-accent);
    --color-primary-dark-100-alpha-200: var(--ambient-local-accent);
    --color-primary-dark-100-alpha-300: var(--ambient-local-accent);
    --color-primary-light-100-alpha-300: var(--ambient-local-accent);
    --color-primary-dark-500-alpha-500: var(--ambient-local-accent);
    --color-primary-alpha-100: var(--ambient-local-accent);
    --color-primary-alpha-200: var(--ambient-local-accent);
    --color-primary-alpha-300: var(--ambient-local-accent);
    --color-primary-alpha-400: var(--ambient-local-accent);
    --color-primary-alpha-500: var(--ambient-local-accent);
    --color-000: var(--ambient-local-on-accent);
    --adaptive-selection-text: var(--ambient-local-on-accent);
    --adaptive-selection-background: var(--ambient-local-accent);
  }
  button[data-ambient-zone] { --color-font-label: var(--ambient-local-accent); }
  // Muted colors already encode the secondary hierarchy. Fading enabled text
  // again can undo its measured contrast, particularly on bright artwork.
  button[data-ambient-zone]:not(:disabled):not(.disabled):not([aria-disabled="true"]),
  [role="tab"][data-ambient-zone]:not(.disabled):not([aria-disabled="true"]),
  .label-source, .setting-value {
    opacity: 1;
  }
  input::placeholder, textarea::placeholder {
    color: var(--color-font-label);
    opacity: 1;
  }
  ::selection {
    color: var(--adaptive-selection-text);
    -webkit-text-fill-color: var(--adaptive-selection-text);
    background-color: var(--adaptive-selection-background);
    text-shadow: none;
  }
  input, textarea { caret-color: var(--color-accent); }
}

[data-player-detail][data-ambient-controls] {
  [data-detail-part="info"], [data-detail-part="controls"], [data-detail-part="chrome"] {
    color: var(--color-font);
    background-image: radial-gradient(ellipse closest-side at center, var(--ambient-reading-surface), transparent 100%);
  }
}

#root [data-player-detail][data-detail-entering] {
  // The page already fades in. Interpolating its initial icon color from the
  // library palette would expose a second flash during the same transition.
  button, button svg {
    transition-property: background-color, opacity, transform, box-shadow, scale;
  }
}

.view-container {
  transition: opacity var(--duration-normal) var(--ease-standard);
}
#root.show-modal > .view-container {
  opacity: .9;
}
#view.show-modal > .view-container {
  opacity: .2;
}

</style>

