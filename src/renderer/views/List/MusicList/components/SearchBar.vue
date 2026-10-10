<template>
  <div :class="$style.search" data-playlist-search @keydown.escape.stop>
    <div :class="$style.input">
      <svg :class="$style.icon" viewBox="0 0 30.239 30.239" aria-hidden="true"><use xlink:href="#icon-search" /></svg>
      <base-input
        ref="input" v-model="text" :trim="false" class="ignore-esc" :class="$style.field"
        :placeholder="$t('list__search_placeholder')" :aria-label="$t('list__search_placeholder')" :auto-paste="false"
        @update:model-value="handleInput" @compositionstart="composing = true" @compositionend="finishComposition"
        @keydown.escape.stop.prevent="clear"
      />
      <button v-if="text" type="button" :class="$style.clear" :aria-label="$t('list__search_clear')" @click="clear">
        <svg viewBox="0 0 24 24" aria-hidden="true"><use xlink:href="#icon-window-close" /></svg>
      </button>
    </div>
    <base-selection
      ref="scope" :list="fields" :model-value="field" item-key="id" item-name="label" :class="$style.scope"
      :aria-label="$t('list__search_field')" @update:model-value="selectField"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from '@common/utils/vueTools'
import { useI18n } from '@root/lang'
import type { PlaylistSearchField } from '../search'

const props = defineProps<{ modelValue: string, field: PlaylistSearchField }>()
const emit = defineEmits<{ 'update:modelValue': [value: string], 'update:field': [value: PlaylistSearchField] }>()
const t = useI18n()
const input = ref<{ focus: () => void } | null>(null)
const scope = ref<{ handleKeyboardHide: () => void } | null>(null)
const text = ref(props.modelValue)
const composing = ref(false)
const fields = computed(() => (['name', 'singer', 'album', 'all'] as const).map(id => ({ id, label: t(`list__search_field_${id}`) })))
const selectField = (field: PlaylistSearchField) => {
  emit('update:field', field)
  scope.value?.handleKeyboardHide()
}
const handleInput = (value: string) => {
  if (!composing.value) emit('update:modelValue', value)
}
const finishComposition = (event: CompositionEvent) => {
  composing.value = false
  text.value = (event.target as HTMLInputElement).value
  emit('update:modelValue', text.value)
}
const focus = () => { input.value?.focus() }
const clear = () => {
  composing.value = false
  text.value = ''
  emit('update:modelValue', '')
  focus()
}
watch(() => props.modelValue, value => { text.value = value })
defineExpose({ focus })
</script>

<style lang="less" module>
.search { display: flex; align-items: center; gap: 10px; flex: none; padding: 10px 12px; min-width: 0; }
.input { position: relative; flex: 1; min-width: 0; }
.field { display: block; width: 100%; height: 28px; box-sizing: border-box; padding: 0 34px; }
.icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 15px; height: 15px; color: var(--color-button-font); pointer-events: none; }
.clear { position: absolute; right: 5px; top: 50%; transform: translateY(-50%); width: 26px; height: 26px; padding: 6px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-button-font); cursor: pointer; }
.clear svg { width: 100%; height: 100%; }
.clear:hover { background: var(--color-button-background-hover); }
.clear:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.scope { flex: none; --selection-width: 6.5rem; }
@media (max-width: 900px) { .search { gap: 6px; padding: 8px; } .scope { --selection-width: 5.8rem; } }
</style>
