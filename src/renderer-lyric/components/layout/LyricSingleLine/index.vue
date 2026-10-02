<template>
  <div :class="[$style.lyric, { [$style.fontWeightFont]: setting['desktopLyric.style.isFontWeightFont'], [$style.fontWeightLine]: setting['desktopLyric.style.isFontWeightLine'] }]" :style="lrcStyles" :title="currentLine?.text" data-mini-single-line>
    <div ref="textContainer" :class="$style.text" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from '@common/utils/vueTools'
import { lyric } from '@lyric/store/lyric'
import { setting } from '@lyric/store/state'

const textContainer = ref<HTMLDivElement>()
const currentLine = computed(() => lyric.lines[lyric.line])
const lrcStyles = computed(() => ({
  fontFamily: setting['desktopLyric.style.font'],
  fontSize: Math.trunc(setting['desktopLyric.style.fontSize']) + 'px',
  opacity: setting['desktopLyric.style.opacity'] / 100,
  textAlign: setting['desktopLyric.style.align'],
}))

const showCurrentLine = () => {
  const container = textContainer.value
  if (!container) return
  // Keep the engine's original node so per-word progress continues unchanged.
  // Only this node is mounted; there are no neighbouring rows or transitions.
  const line = currentLine.value?.dom_line
  container.replaceChildren(...(line ? [line] : []))
}
onMounted(showCurrentLine)
watch(() => currentLine.value?.dom_line, showCurrentLine, { flush: 'post' })
</script>

<style lang="less" module>
@import '@lyric/assets/styles/layout.less';

.lyric {
  position: relative;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 16px;
  overflow: hidden;
  contain: strict;

  :global {
    .line-content {
      line-height: 1.2;
      white-space: nowrap;
    }
    .line {
      display: block !important;
      max-width: 100%;
    }
    .extended, br { display: none !important; }
    .font-lrc, .shadow {
      padding: .08em .14em;
      margin: -.08em 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .font-lrc { color: var(--color-lyric-unplay); }
    .shadow { color: transparent; }
    .line-mode .font-lrc {
      color: var(--color-lyric-played);
      .stroke3(var(--color-lyric-shadow));
    }
    .font-mode > .line > .font-lrc > span {
      background-repeat: no-repeat;
      background-color: var(--color-lyric-unplay);
      background-image: -webkit-linear-gradient(left, var(--color-lyric-played), var(--color-lyric-played));
      -webkit-text-fill-color: transparent;
      -webkit-background-clip: text;
      background-size: 0 100%;
    }
    .font-mode.played > .line > .font-lrc > span { background-size: 100% 100%; }
    .font-mode .shadow span { .stroke(1px, var(--color-lyric-shadow-font-mode)); }
    .line-content, .line, .font-lrc, .shadow, span {
      transition: none !important;
    }
  }
}
.text {
  width: 100%;
  min-width: 0;
}
.fontWeightFont :global(.font-mode > .line),
.fontWeightLine :global(.line-mode > .line) { font-weight: bold; }
</style>
