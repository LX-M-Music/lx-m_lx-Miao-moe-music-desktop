<template>
  <material-modal :show="editor.visible" :close-btn="!editor.busy" width="min(780px, calc(100vw - 32px))" max-width="calc(100vw - 32px)" max-height="calc(100vh - 32px)" @close="close" @after-enter="focusEditor">
    <div ref="content" :class="$style.content" role="dialog" aria-modal="true" :aria-label="$t('download__edit_tags')" @keydown.esc.stop.prevent="close">
      <h2 :class="$style.title">{{ $t('download__edit_tags') }}</h2>
      <TagEditor :after-save="afterSave" />
    </div>
  </material-modal>
</template>

<script setup>
import { onBeforeUnmount, ref } from '@common/utils/vueTools'
import TagEditor from '../../../optional-plugins/audio-tag-editor/Settings.vue'
import { editor } from '../../../optional-plugins/audio-tag-editor/session'

defineProps({ afterSave: { type: Function, default: undefined } })

const content = ref(null)
// Keep the draft when closing; opening another file already checks unsaved changes.
const close = () => { if (!editor.busy) editor.visible = false }
const focusEditor = () => { content.value?.querySelector('form input')?.focus() }
onBeforeUnmount(() => { editor.visible = false })
</script>

<style lang="less" module>
.content { min-height: 0; padding: 16px; overflow: auto; color: var(--color-font); }
.title { margin: 0 0 16px; font-size: 16px; line-height: 1.5; }
.content button { min-height: 28px; box-sizing: border-box; line-height: 1.5; }
</style>
