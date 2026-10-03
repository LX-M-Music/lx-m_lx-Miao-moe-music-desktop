<template>
  <div :class="[$style.lyric, { [$style.fontWeightFont]: setting['desktopLyric.style.isFontWeightFont'], [$style.fontWeightLine]: setting['desktopLyric.style.isFontWeightLine'], [$style.fontWeightExtended]: setting['desktopLyric.style.isFontWeightExtended'] }]" :style="lrcStyles" :title="currentLineText" data-mini-single-line>
    <div ref="textContainer" :class="$style.text" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from '@common/utils/vueTools'
import { lyric } from '@lyric/store/lyric'
import { setting } from '@lyric/store/state'

const textContainer = ref<HTMLDivElement>()
const currentLine = computed(() => lyric.lines[lyric.line])
const currentLineText = computed(() => {
  const line = currentLine.value
  return line ? [line.text, ...line.extendedLyrics].filter(Boolean).join(' · ') : undefined
})
const lrcStyles = computed(() => ({
  fontFamily: setting['desktopLyric.style.font'],
  fontSize: Math.trunc(setting['desktopLyric.style.fontSize']) + 'px',
  opacity: setting['desktopLyric.style.opacity'] / 100,
  textAlign: setting['desktopLyric.style.align'],
  '--single-line-align': setting['desktopLyric.style.align'] == 'left' ? 'flex-start' : setting['desktopLyric.style.align'] == 'right' ? 'flex-end' : 'center',
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
      display: flex !important;
      align-items: center;
      gap: .5em;
      min-width: 0;
      max-width: 100%;
      line-height: 1.2;
      white-space: nowrap;
    }
    .line, .extended {
      display: block !important;
      flex: 0 1 auto;
      min-width: 0;
      max-width: 100%;
    }
    .extended { font-size: .8em; }
    br { display: none !important; }
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
  display: flex;
  justify-content: var(--single-line-align);
  width: 100%;
  min-width: 0;
}
.fontWeightFont :global(.font-mode > .line),
.fontWeightLine :global(.line-mode > .line) { font-weight: bold; }
.fontWeightExtended :global(.extended) { font-weight: bold; }
</style>
