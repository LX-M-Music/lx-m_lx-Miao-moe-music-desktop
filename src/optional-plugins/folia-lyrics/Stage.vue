<template>
  <div :class="$style.stage" :data-folia-stage="preview ? 'preview' : 'player'" @dblclick="handleDoubleClick">
    <template v-if="!preview">
      <div :class="$style.topReveal" aria-hidden="true" />
      <div :class="$style.bottomReveal" aria-hidden="true" />
    </template>
    <div :class="$style.toolbar" data-folia-toolbar>
      <span>{{ preview ? labels.demo : labels.title }}</span>
      <label :class="$style.picker">
        <span>{{ labels.style }}</span>
        <select :value="preferences.mode" data-folia-mode @change="selectMode">
          <option v-for="mode in FOLIA_MODES" :key="mode" :value="mode">{{ labels.styles[mode] }}</option>
        </select>
      </label>
      <button v-if="!preview" type="button" @click="savePreferences({ enabled: false })">{{ labels.standard }}</button>
    </div>
    <div :class="$style.surface">
      <iframe v-if="!failed && (!preview || !isShowPlayerDetail)" ref="element" :src="engineUrl" :title="labels.title" sandbox="allow-scripts allow-same-origin" data-folia-frame />
      <div v-if="failed" :class="$style.error" role="alert">
        <p>{{ labels.error }}</p>
        <button type="button" @click="retry">{{ labels.retry }}</button>
      </div>
    </div>
    <p v-if="preferencesError" role="alert" :class="$style.saveError">{{ labels.saveError }}</p>
    <Teleport v-if="!preview && dragReady" to="[data-player-detail]">
      <div :class="$style.windowDrag" data-folia-window-drag aria-hidden="true" />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from '@common/utils/vueTools'
import { isShowPlayerDetail } from '@renderer/store/player/state'
import { FOLIA_INTERACTIVE_TARGETS, FOLIA_MODES, type FoliaMode } from './protocol'
import { engineUrl, preferences, preferencesError, savePreferences } from './preferences'
import { useLabels } from './labels'
import useStage from './useStage'

const props = defineProps({ preview: { type: Boolean, default: false } })
const labels = useLabels()
const element = ref<HTMLIFrameElement | null>(null)
const dragReady = ref(false)
onMounted(() => { dragReady.value = true })
const { failed, retry, toggleFullscreen } = useStage(element, props.preview)
const handleDoubleClick = (event: MouseEvent) => {
  if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest(FOLIA_INTERACTIVE_TARGETS)) return
  toggleFullscreen()
}
const selectMode = (event: Event) => { savePreferences({ mode: (event.target as HTMLSelectElement).value as FoliaMode, enabled: true }) }
</script>

<style lang="less" module>
@import '@renderer/assets/styles/variables.less';

.stage { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; color: var(--color-font); background: radial-gradient(ellipse at 25% 90%, var(--color-primary-light-300-alpha-700), var(--color-content-background) 70%); border-radius: 12px; }
.toolbar { flex: none; display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 10px 14px; font-size: 12px; position: relative; z-index: 1; }
.picker { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.toolbar select, .toolbar button, .error button { color: var(--color-font); background: var(--color-primary-background); border: 1px solid var(--color-border); border-radius: 6px; padding: 5px 9px; font: inherit; cursor: pointer; }
.toolbar option { color: var(--color-font); background: var(--color-primary-background); }
.surface { position: relative; flex: auto; min-height: 0; }
// Match the engine document's default scheme. A mismatched iframe scheme makes
// Chromium paint an opaque canvas behind otherwise transparent lyric content.
.surface iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: transparent; color-scheme: normal; }
.error { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 16px; padding: 16px; text-align: center; }
.saveError { flex: none; padding: 8px 14px; font-size: 12px; }
.topReveal, .bottomReveal { display: none; }

// Teleport after the host chrome so older app versions keep a native drag
// region above the Folia iframe and its no-drag reveal areas.
.windowDrag {
  position: absolute;
  top: 0;
  left: 240px;
  right: 240px;
  height: @height-toolbar;
  z-index: 3;
  -webkit-app-region: drag;
}
:global([data-player-detail].fullscreen) > .windowDrag,
:global(.maximized) .windowDrag { display: none; }

// Use the existing API 2 player slots so this layout can ship as a plugin update.
.stage[data-folia-stage='player'] {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  max-width: none;
  margin: 0;
  padding: 0;
  border-radius: 0;
  background: #111b2c;

  .toolbar {
    position: absolute;
    top: @height-toolbar;
    left: 0;
    right: 0;
    padding: 8px 30px;
    color: #c9d7e3;
  }

  .surface { position: absolute; inset: 0; }

  .toolbar select, .toolbar button {
    background: rgba(255, 255, 255, .06);
    border-color: rgba(201, 215, 227, .2);
    transition: background-color var(--duration-fast), border-color var(--duration-fast);

    &:hover {
      background: rgba(255, 255, 255, .12);
      border-color: rgba(201, 215, 227, .4);
    }
    &:focus-visible {
      outline: 2px solid #74dab5;
      outline-offset: 3px;
    }
  }

  .saveError {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100px;
    z-index: 1;
    padding-inline: 30px;
    background: rgba(17, 27, 44, .9);
  }
}

// Scope the surrounding chrome to the mounted player stage. Comments, native
// lyrics, closing the player and uninstalling immediately restore the host theme.
.foliaPalette() {
  --color-font: #e5edf4;
  --color-font-label: #c9d7e3;
  --color-button-font: #e5edf4;
  --color-button-background-hover: rgba(255, 255, 255, .12);
  --color-content-background: #111b2c;
  --color-primary-background: #111b2c;
  --color-primary: #74dab5;
  --color-accent: #74dab5;
  --color-hover: rgba(255, 255, 255, .1);
  --color-primary-light-100-alpha-800: rgba(201, 215, 227, .18);
  --ambient-reading-surface: transparent;
}
:global(#root [data-player-detail]):has(> .stage[data-folia-stage='player']) {
  background: #111b2c;
  .foliaPalette();

  // The shared background publishes an inline palette on the host detail and
  // binds local colors to its controls. Paint Folia's actual surfaces with their
  // own palette so artwork hidden behind the iframe cannot recolor them.
  .stage,
  > :global([data-detail-part='chrome']),
  > :global([data-detail-part='controls']),
  :global([data-ambient-zone]) {
    .foliaPalette();
    color-scheme: dark;
  }

  > :global([data-detail-part='chrome']),
  > :global([data-detail-part='controls']) {
    position: relative;
    z-index: 1;
    color: var(--color-font);
  }

  > :global([data-detail-part='chrome']) {
    background: linear-gradient(to bottom, rgba(7, 13, 24, .24), transparent);
  }

  > :global([data-detail-part='controls']) {
    margin-top: auto;
    background: linear-gradient(to bottom, transparent, rgba(7, 13, 24, .42));
  }
}

// Edge hit areas work even while the pointer is over the isolated lyric iframe.
// They are behind the controls and leave the middle of the lyrics interactive.
@media (hover: hover) and (pointer: fine) {
  .topReveal, .bottomReveal {
    display: block;
    position: absolute;
    left: 0;
    right: 0;
    z-index: 1;
    -webkit-app-region: no-drag;
  }
  .topReveal { top: 0; height: @height-toolbar + 80px; }
  .bottomReveal { bottom: 0; height: 136px; }

  :global([data-player-detail]):has(> .stage[data-folia-stage='player']) {
    --folia-top-opacity: 0;
    --folia-top-events: none;
    --folia-top-delay: 450ms;
    --folia-bottom-opacity: 0;
    --folia-bottom-events: none;
    --folia-bottom-delay: 450ms;

    .toolbar, > :global([data-detail-part='chrome']) {
      opacity: var(--folia-top-opacity);
      pointer-events: var(--folia-top-events);
      transition: opacity var(--duration-fast) ease var(--folia-top-delay);
    }
    > :global([data-detail-part='chrome']) {
      -webkit-app-region: no-drag;
    }
    > :global([data-detail-part='controls']) {
      opacity: var(--folia-bottom-opacity);
      pointer-events: var(--folia-bottom-events);
      transition: opacity var(--duration-fast) ease var(--folia-bottom-delay);
    }

    &:has(.topReveal:hover, .toolbar:hover, .toolbar :focus-visible, .toolbar :active, .stage [role='alert']),
    &:has(> :global([data-detail-part='chrome']:hover)),
    &:has(> :global([data-detail-part='chrome']) :focus-visible) {
      --folia-top-opacity: 1;
      --folia-top-events: auto;
      --folia-top-delay: 0s;
    }

    &:has(.bottomReveal:hover, .stage [role='alert']),
    &:has(> :global([data-detail-part='controls']:hover)),
    &:has(> :global([data-detail-part='controls']) :focus-visible),
    &:has(> :global([data-detail-part='controls']) :active),
    &:has(> :global([data-detail-part='controls']) :global([aria-expanded='true'])) {
      --folia-bottom-opacity: 1;
      --folia-bottom-events: auto;
      --folia-bottom-delay: 0s;
    }

    // Keep mouse events in the host during a progress drag across the lyrics.
    &:has(> :global([data-detail-part='controls']) :global([role='slider']:active)) .surface iframe {
      pointer-events: none;
    }

    &:has(.topReveal:hover, .toolbar:hover) > :global([data-detail-part='chrome']) {
      -webkit-app-region: drag;
    }
    &:global(.fullscreen) > :global([data-detail-part='chrome']),
    :global(.maximized) & > :global([data-detail-part='chrome']) {
      -webkit-app-region: no-drag;
    }
  }

  // LX-M teleports volume/rate popups to #root; their arrow offset identifies
  // those popups without depending on the host's generated CSS module names.
  :global(#root):has(> :global([aria-hidden='false'][style*='--arrow-left'])) :global([data-player-detail]):has(> .stage[data-folia-stage='player']) {
    --folia-bottom-opacity: 1;
    --folia-bottom-events: auto;
    --folia-bottom-delay: 0s;
  }
}
</style>
