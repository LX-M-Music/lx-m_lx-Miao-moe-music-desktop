<template>
  <dd>
    <h3 id="sync_webdav">{{ $t('setting__sync_webdav') }}</h3>
    <div :class="$style.panel">
      <base-checkbox id="setting_sync_webdav_enable" :disabled="disabled" :model-value="appSetting['sync.webdav.enable']" :label="$t('setting__sync_webdav_enable')" @update:model-value="updateOption('sync.webdav.enable', $event)" />
      <div :class="$style.fields">
        <label for="setting_sync_webdav_url">{{ $t('setting__sync_webdav_url') }}</label>
        <base-input id="setting_sync_webdav_url" v-model="form.url" :disabled="disabled" placeholder="https://dav.example.com/dav/" :auto-paste="false" />
        <label for="setting_sync_webdav_username">{{ $t('setting__sync_webdav_username') }}</label>
        <base-input id="setting_sync_webdav_username" v-model="form.username" :disabled="disabled" :trim="false" :auto-paste="false" autocomplete="off" />
        <label for="setting_sync_webdav_password">{{ $t('setting__sync_webdav_password') }}</label>
        <base-input id="setting_sync_webdav_password" v-model="form.password" type="password" :disabled="disabled" :trim="false" :auto-paste="false" autocomplete="new-password" />
        <label for="setting_sync_webdav_directory">{{ $t('setting__sync_webdav_directory') }}</label>
        <base-input id="setting_sync_webdav_directory" v-model="form.directory" :disabled="disabled" placeholder="lx-music" :auto-paste="false" />
        <label for="setting_sync_webdav_playlists_directory">{{ $t('setting__sync_webdav_playlists_directory') }}</label>
        <base-input id="setting_sync_webdav_playlists_directory" v-model="form.playlistsDirectory" :disabled="disabled" placeholder="LX_Music" :auto-paste="false" />
      </div>
      <div class="p" :class="$style.buttons">
        <base-btn min :disabled="disabled || !dirty" @click="saveConnection">{{ $t('setting__sync_webdav_save') }}</base-btn>
        <base-btn min :disabled="disabled || !form.url.trim()" @click="run('test')">{{ $t('setting__sync_webdav_test') }}</base-btn>
        <span v-if="dirty" class="small">{{ $t('setting__sync_webdav_unsaved') }}</span>
        <span v-else-if="saved" class="small">{{ $t('setting__sync_webdav_saved') }}</span>
      </div>
      <p v-if="saveError" class="p small" role="alert">{{ saveError }}</p>

      <h3 id="sync_webdav_items">{{ $t('setting__sync_webdav_items') }}<svg-icon class="help-icon" name="help-circle-outline" :aria-label="$t('setting__sync_webdav_download_tip') + '\n' + $t('setting__sync_webdav_settings_tip')" /></h3>
      <div :class="$style.options">
        <base-checkbox
          v-for="section in sections" :id="'setting_sync_webdav_' + section" :key="section" :disabled="disabled"
          :model-value="sectionEnabled(section)" :label="$t('setting__sync_webdav_item_' + section)"
          @update:model-value="updateOption('sync.webdav.' + section, $event)"
        />
      </div>

      <div class="p">
        <base-checkbox id="setting_sync_webdav_auto" :disabled="disabled" :model-value="appSetting['sync.webdav.autoSync']" :label="$t('setting__sync_webdav_auto')" @update:model-value="updateOption('sync.webdav.autoSync', $event)" />
        <common-setting-reveal :show="appSetting['sync.webdav.autoSync']" depends="setting_sync_webdav_auto">
          <div class="p" :class="$style.automatic">
            <label for="setting_sync_webdav_interval">{{ $t('setting__sync_webdav_interval') }}</label>
            <base-input id="setting_sync_webdav_interval" v-model="intervalInput" :class="$style.interval" type="number" min="1" max="1440" :disabled="disabled" @change="setInterval" />
          </div>
        </common-setting-reveal>
      </div>
      <div class="p" :class="$style.buttons">
        <base-btn min :disabled="disabled || !canSync" @click="run('sync')">{{ $t('setting__sync_webdav_sync') }}</base-btn>
        <base-btn min :disabled="disabled || !canSync" @click="run('upload')">{{ $t('setting__sync_webdav_upload') }}</base-btn>
        <base-btn min :disabled="disabled || !canSync" @click="run('download')">{{ $t('setting__sync_webdav_download') }}</base-btn>
      </div>
      <div class="p small" :class="$style.status" role="status" aria-live="polite">
        <span>{{ statusText }}</span>
        <span v-if="!webdav.busy && webdav.result">{{ $t('setting__sync_webdav_last_time', { time: lastTime }) }}</span>
      </div>
      <SyncDiffPanel :diff="webdav.result?.diff" :title="$t('setting__sync_webdav_diff_title')" />
    </div>
  </dd>
</template>

<script setup lang="ts">
import { formatError } from '@common/utils/errorMessage'
import { computed, reactive, ref, watch } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'
import { updateSetting } from '@renderer/utils/ipc'
import { webdav, runWebDAVAction } from '@renderer/store/webdav'
import { useI18n } from '@renderer/plugins/i18n'
import { dialog } from '@renderer/plugins/Dialog'
import SyncDiffPanel from '@renderer/components/common/SyncDiffPanel.vue'

const t = useI18n()
const sections = ['playlists', 'downloadHistory', 'downloadTasks', 'settings', 'dislike'] as const
const connectionKeys = ['url', 'username', 'password', 'directory', 'playlistsDirectory'] as const
const form = reactive({ url: '', username: '', password: '', directory: '', playlistsDirectory: '' })
for (const key of connectionKeys) watch(() => appSetting[`sync.webdav.${key}`], value => { form[key] = value }, { immediate: true })
const saving = ref(false)
const saved = ref(false)
const saveError = ref('')
const intervalInput = ref<string | number>(5)
watch(() => appSetting['sync.webdav.interval'], value => { intervalInput.value = value }, { immediate: true })
const lastTime = computed(() => webdav.result ? new Date(webdav.result.time).toLocaleString() : '')
const disabled = computed(() => saving.value || webdav.busy)
const dirty = computed(() => connectionKeys.some(key => form[key] != appSetting[`sync.webdav.${key}`]))
const selected = computed(() => sections.filter(section => appSetting[`sync.webdav.${section}`]))
const sectionEnabled = (section: LX.WebDAV.Section) => appSetting[`sync.webdav.${section}`]
const canSync = computed(() => appSetting['sync.webdav.enable'] && selected.value.length && form.url.trim())
const sectionNames = (items: readonly LX.WebDAV.Section[]) => items.map(section => t(`setting__sync_webdav_item_${section}`)).join(t('sync_diff__list_separator'))

const statusText = computed(() => {
  if (webdav.busy) return t('setting__sync_webdav_working')
  const result = webdav.result
  if (!result) return t('setting__sync_webdav_idle')
  if (!result.success) {
    const message = t(`setting__sync_webdav_error_${result.error ?? 'local_error'}`)
    if (result.diagnostic) return formatError(result.diagnostic, message, 'WEBDAV_LOCAL_ERROR')
    return formatError({ code: result.statusCode ? `HTTP_${result.statusCode}` : `WEBDAV_${(result.error ?? 'local_error').toUpperCase()}`, message }, result.sections?.length ? sectionNames(result.sections) : '')
  }
  if (result.operation == 'test') return t('setting__sync_webdav_test_success')
  if (!result.uploaded.length && !result.downloaded.length) return t('setting__sync_webdav_up_to_date')
  return t('setting__sync_webdav_success', { uploaded: result.uploaded.length, downloaded: result.downloaded.length })
})

const saveConnection = async() => {
  saving.value = true
  saveError.value = ''
  try {
    await updateSetting({
      'sync.webdav.url': form.url.trim(),
      'sync.webdav.username': form.username,
      'sync.webdav.password': form.password,
      'sync.webdav.directory': form.directory.trim(),
      'sync.webdav.playlistsDirectory': form.playlistsDirectory.trim(),
    })
    saved.value = true
    return true
  } catch (error) {
    saveError.value = formatError(error, t('setting__sync_webdav_error_local_error'), 'WEBDAV_CONFIG_FAILED')
    return false
  } finally { saving.value = false }
}

const updateOption = async(key: string, value: boolean | number) => {
  saveError.value = ''
  try { await updateSetting({ [key]: value }) } catch (error) { saveError.value = formatError(error, t('setting__sync_webdav_error_local_error'), 'WEBDAV_CONFIG_FAILED') }
}
const setInterval = (value: string) => {
  intervalInput.value = Math.max(1, Math.min(1440, Math.round(Number(value)) || 5))
  void updateOption('sync.webdav.interval', intervalInput.value)
}
const run = async(operation: LX.WebDAV.Operation) => {
  if (disabled.value) return
  if (operation == 'upload' || operation == 'download') {
    if (!await dialog.confirm({
      message: t(`setting__sync_webdav_confirm_${operation}`, { items: sectionNames(selected.value) }),
      confirmButtonText: t(`setting__sync_webdav_${operation}`),
      cancelButtonText: t('cancel_button_text'),
    })) return
  }
  if (await saveConnection()) await runWebDAVAction(operation)
}
</script>

<style lang="less" module>
.panel {
  max-width: 780px;
}
.fields {
  display: grid;
  grid-template-columns: max-content minmax(180px, 1fr);
  align-items: center;
  gap: 12px 16px;
  margin: 12px 0;
  font-size: 13px;

  input { min-width: 0; }
}
.buttons, .automatic {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 8px;
}
.automatic { font-size: 13px; }
.interval { width: 65px; }
.status {
  display: flex;
  flex-direction: column;
  gap: 8px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
</style>
