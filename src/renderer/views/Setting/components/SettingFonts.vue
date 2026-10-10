<template>
  <dd data-setting-search="setting__basic_font setting__font_primary setting__font_fallback setting__font_import setting__font_play_detail setting__font_play_detail_hint">
    <h3 id="basic_font">{{ $t('setting__basic_font') }}<svg-icon class="help-icon" name="help-circle-outline" :aria-label="$t('setting__font_hint')" /></h3>
    <div :class="$style.choices">
      <div data-font-primary>
        <p id="font_primary_label">{{ $t('setting__font_primary') }}</p>
        <base-selection :list="fontList" :model-value="fonts[0]" item-key="id" item-name="label" aria-labelledby="font_primary_label" @update:model-value="selectFont($event, fonts[1])" />
      </div>
      <div data-font-fallback>
        <p id="font_fallback_label">{{ $t('setting__font_fallback') }}</p>
        <base-selection :list="fontList" :model-value="fonts[1]" item-key="id" item-name="label" aria-labelledby="font_fallback_label" @update:model-value="selectFont(fonts[0], $event)" />
      </div>
    </div>
    <div class="setting-actions" :class="$style.detailFont" data-font-play-detail>
      <base-checkbox id="setting_font_play_detail" :model-value="appSetting['playDetail.useAppFont']" :label="$t('setting__font_play_detail')" @update:model-value="setDetailFont($event)" />
      <svg-icon class="help-icon" name="help-circle-outline" :aria-label="$t('setting__font_play_detail_hint')" />
    </div>
    <p :class="$style.preview" data-font-preview>{{ $t('setting__font_preview') }}</p>
    <div class="setting-actions">
      <base-btn min :disabled="importing" data-font-import @click="handleImport">{{ importing ? $t('setting__font_importing') : $t('setting__font_import') }}</base-btn>
      <svg-icon class="help-icon" name="help-circle-outline" :aria-label="$t('setting__font_import_hint')" />
      <base-btn min :disabled="!appSetting['common.font']" data-font-reset @click="selectFont('', '')">{{ $t('setting__font_reset') }}</base-btn>
    </div>
    <p v-if="error" :class="$style.error" role="alert" data-font-error>{{ error }}</p>
  </dd>
</template>

<script setup lang="ts">
import fs from 'node:fs/promises'
import path from 'node:path'
import { computed, onMounted, ref } from '@common/utils/vueTools'
import { CUSTOM_FONT_PREFIX, MAX_FONT_BYTES, fontChoices, fontError, makeFontStack, parseFontStack, type CustomFont } from '@common/fonts'
import { formatError } from '@common/utils/errorMessage'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { showSelectDialog } from '@renderer/utils/ipc'
import { rendererInvoke } from '@common/rendererIpc'
import { CMMON_EVENT_NAME } from '@common/ipcNames'
import { importCustomFont, listCustomFonts } from '@renderer/utils/fonts'
import { useI18n } from '@root/lang'

const t = useI18n()
const systemFonts = ref<string[]>([])
const customFonts = ref<CustomFont[]>([])
const importing = ref(false)
const error = ref('')
const fonts = computed(() => fontChoices(appSetting['common.font']))
const fontList = computed(() => {
  const list = [{ id: '', label: t('setting__desktop_lyric_font_default') }]
  const seen = new Set([''])
  for (const font of customFonts.value) { list.push({ id: font.id, label: `${font.name} (${t('setting__font_imported')})` }); seen.add(font.id) }
  for (const font of [...systemFonts.value, ...fonts.value]) {
    if (seen.has(font)) continue
    seen.add(font)
    list.push({ id: font, label: font.startsWith(CUSTOM_FONT_PREFIX) ? t('setting__font_imported') : font })
  }
  return list
})
const selectFont = async(primary: string, fallback: string) => {
  try { await updateSetting({ 'common.font': makeFontStack(primary, fallback) }) } catch (err) { error.value = formatError(err, '', 'FONT_SAVE_FAILED') }
}
const setDetailFont = async(enabled: boolean) => {
  try { await updateSetting({ 'playDetail.useAppFont': enabled }) } catch (err) { error.value = formatError(err, '', 'FONT_SAVE_FAILED') }
}
const handleImport = async() => {
  if (importing.value) return
  importing.value = true
  error.value = ''
  try {
    const result = await showSelectDialog({ title: t('setting__font_import'), properties: ['openFile'], filters: [{ name: t('setting__basic_font'), extensions: ['ttf', 'otf', 'woff', 'woff2'] }] })
    if (result.canceled || !result.filePaths.length) return
    const filename = result.filePaths[0]
    const handle = await fs.open(filename, 'r')
    let data: Buffer
    try {
      const size = (await handle.stat()).size
      if (!size || size > MAX_FONT_BYTES) throw fontError('FONT_SIZE_LIMIT', t('setting__font_size_error'))
      data = await handle.readFile()
    } finally { await handle.close() }
    const font = await importCustomFont({ name: path.basename(filename), data })
    customFonts.value = await listCustomFonts()
    await selectFont(font.id, fonts.value[1])
  } catch (err) { error.value = formatError(err, t('setting__font_import_failed'), 'FONT_IMPORT_FAILED') } finally { importing.value = false }
}
onMounted(async() => {
  const results = await Promise.allSettled([
    rendererInvoke<string[]>(CMMON_EVENT_NAME.get_system_fonts).then(fonts => { systemFonts.value = fonts.flatMap(parseFontStack) }),
    listCustomFonts().then(fonts => { customFonts.value = fonts }),
  ])
  const failed = results.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') error.value = formatError(failed.reason, '', 'FONT_LIST_LOAD_FAILED')
})
</script>

<style lang="less" module>
.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  --selection-width: 15rem;
  > div { min-width: 0; max-width: 100%; }
  p { margin-bottom: 8px; }
}
.detailFont { margin-top: 14px; }
.preview { margin: 14px 0; padding: 12px; border: 1px solid var(--color-primary-alpha-200); border-radius: 6px; line-height: 1.7; overflow-wrap: anywhere; }
.error { margin-top: 12px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; }
</style>
