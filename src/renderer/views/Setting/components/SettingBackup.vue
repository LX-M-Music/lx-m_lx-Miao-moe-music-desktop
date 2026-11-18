<template>
  <dt id="backup">{{ $t('setting__backup') }}</dt>
  <dd>
    <h3 id="backup_part">{{ $t('setting__backup_part') }}</h3>
    <div class="setting-actions">
      <base-btn class="btn gap-left" min :disabled="busy" @click="openImport('playlists')">{{ $t('setting__backup_part_import_list') }}</base-btn>
      <base-btn class="btn gap-left" min :disabled="busy" @click="exportBackup('playlists')">{{ $t('setting__backup_part_export_list') }}</base-btn>
      <base-btn class="btn gap-left" min :disabled="busy" @click="exportBackup('compat_playlists')">{{ $t('setting__backup_compat_export_list') }}</base-btn>
      <base-btn class="btn gap-left" min :disabled="busy" @click="openImport('settings')">{{ $t('setting__backup_part_import_setting') }}</base-btn>
      <base-btn class="btn gap-left" min :disabled="busy" @click="exportBackup('settings')">{{ $t('setting__backup_part_export_setting') }}</base-btn>
      <base-btn class="btn gap-left" min :disabled="busy" @click="exportBackup('compat_settings')">{{ $t('setting__backup_compat_export_setting') }}</base-btn>
    </div>
  </dd>
  <dd>
    <h3 id="backup_all">{{ $t('setting__backup_all') }}<svg-icon class="help-icon" name="help-circle-outline" :aria-label="$t('setting__backup_scope')" /></h3>
    <div class="setting-actions">
      <base-btn class="btn gap-left" min :disabled="busy" @click="openImport('all')">{{ $t('setting__backup_all_import') }}</base-btn>
      <base-btn class="btn gap-left" min :disabled="busy" @click="exportBackup('all')">{{ $t('setting__backup_all_export') }}</base-btn>
      <base-btn class="btn gap-left" min :disabled="busy" @click="exportBackup('compat_all')">{{ $t('setting__backup_compat_export_all') }}</base-btn>
      <svg-icon class="help-icon" name="help-circle-outline" :aria-label="$t('setting__backup_compat_hint')" />
    </div>
    <p v-if="busy" :class="$style.note" role="status">{{ $t('setting__backup_working') }}</p>
    <p v-if="notice" :class="$style.notice" :role="failed ? 'alert' : 'status'" data-backup-notice>{{ notice }}</p>
  </dd>
  <dd>
    <h3 id="backup_other">{{ $t('setting__backup_other') }}</h3>
    <div class="setting-actions">
      <base-btn class="btn gap-left" min :disabled="busy" @click="exportText(false)">{{ $t('setting__backup_other_export_list_text') }}</base-btn>
      <base-btn class="btn gap-left" min :disabled="busy" @click="exportText(true)">{{ $t('setting__backup_other_export_list_csv') }}</base-btn>
    </div>
  </dd>
  <material-modal :show="!!preview" :bg-close="!busy" max-width="640px" @close="closePreview">
    <form v-if="preview" :class="$style.preview" data-backup-preview @submit.prevent="restore">
      <h2>{{ $t('setting__backup_preview') }}<svg-icon class="help-icon" name="help-circle-outline" :aria-label="$t('setting__backup_selection')" /></h2>
      <p :class="$style.filename">{{ preview.filename }}</p>
      <p v-if="preview.createdAt" :class="$style.note">{{ new Date(preview.createdAt).toLocaleString() }}</p>
      <div :class="$style.sections">
        <section v-for="section in availableSections" :key="section" :class="$style.section">
          <div :class="$style.sectionHeader">
            <base-checkbox :id="'backup_section_' + section" v-model="selected" :class="$style.backupCheckbox" :value="section" :disabled="busy" :data-backup-section="section">
              {{ $t(`setting__backup_section_${section}`) }} <span>{{ preview.counts[section] }}</span>
            </base-checkbox>
            <svg-icon class="help-icon" name="help-circle-outline" :aria-label="$t(`setting__backup_replace_${section}`)" />
          </div>
          <transition name="backup-lists">
            <div v-if="section === 'playlists' && selected.includes('playlists')" :class="$style.lists">
              <base-checkbox v-for="(list, index) in preview.playlists" :id="'backup_list_' + index" :key="list.id" v-model="playlistIds" :class="$style.backupCheckbox" :value="list.id" :disabled="busy" :data-backup-list="list.id">
                {{ listName(list) }} <span>{{ list.count }}</span>
              </base-checkbox>
            </div>
          </transition>
        </section>
      </div>
      <p v-if="notice && failed" role="alert">{{ notice }}</p>
      <div :class="$style.actions">
        <base-btn type="button" :disabled="busy" @click="closePreview">{{ $t('btn_cancel') }}</base-btn>
        <base-btn type="submit" :disabled="busy || !selected.length || (selected.includes('playlists') && preview.playlists.length > 0 && !playlistIds.length)">{{ $t(busy ? 'setting__backup_working' : 'setting__backup_restore') }}</base-btn>
      </div>
    </form>
  </material-modal>
</template>

<script setup>
import { formatError } from '@common/utils/errorMessage'
import { computed, onBeforeUnmount, ref, toRaw } from '@common/utils/vueTools'
import { ipcRenderer } from 'electron'
import { BACKUP_IPC, BACKUP_SECTIONS } from '@common/backup'
import { showSelectDialog, openSaveDir } from '@renderer/utils/ipc'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import { getListMusics } from '@renderer/store/list/action'
import { defaultList, loveList, tempList, userLists } from '@renderer/store/list/state'
import { withLocalListLocks } from '@renderer/store/list/localMutationLock'
import { withDownloadListSync } from '@renderer/store/download/action'

const t = useI18n()
const rendererInvoke = ipcRenderer.invoke.bind(ipcRenderer)
const busy = ref(false)
const notice = ref('')
const failed = ref(false)
const preview = ref(null)
const selected = ref([])
const playlistIds = ref([])
const availableSections = computed(() => BACKUP_SECTIONS.filter(section => preview.value?.counts[section] !== undefined))
const listName = list => list.id === 'default' ? t('default_list') : list.id === 'love' ? t('love_list') : list.id === 'temp' ? t('setting__backup_temp_list') : list.name
const errorMessage = error => {
  const code = /backup:([a-z_]+)/.exec(String(error?.message ?? error))?.[1]
  if (String(error?.message ?? error).includes('downloads_running')) return formatError(error, t('setting__backup_error_downloads_running'), 'BACKUP_DOWNLOADS_RUNNING')
  return formatError(error, t(`setting__backup_error_${['file_size', 'expanded_size', 'file_changed', 'compression', 'json', 'invalid', 'type', 'expired', 'selection', 'busy', 'rollback_failed'].includes(code) ? code : 'io'}`), 'BACKUP_FAILED')
}
const run = async action => {
  if (busy.value) return
  busy.value = true
  notice.value = ''
  failed.value = false
  try { await action() } catch (error) { failed.value = true; notice.value = errorMessage(error) } finally { busy.value = false }
}
const discard = async() => {
  const token = preview.value?.token
  preview.value = null
  if (token) await rendererInvoke(BACKUP_IPC.discard, token)
}
const closePreview = () => { if (!busy.value) void discard().catch(console.error) }
onBeforeUnmount(() => { void discard().catch(console.error) })
const openImport = async kind => run(async() => {
  const result = await showSelectDialog({ title: t('setting__backup_all_import_desc'), properties: ['openFile'], filters: [{ name: 'LX Music', extensions: ['lxmc', 'json'] }] })
  if (result.canceled || !result.filePaths.length) return
  const value = await rendererInvoke(BACKUP_IPC.preview, result.filePaths[0])
  preview.value = value
  selected.value = BACKUP_SECTIONS.filter(section => value.counts[section] !== undefined && (kind === 'all' || kind === section))
  playlistIds.value = value.playlists.map(list => list.id)
  if (!selected.value.length) { await discard(); throw new Error('backup:type') }
})
const restore = async() => run(async() => {
  const request = { token: preview.value.token, sections: [...selected.value], ...(selected.value.includes('playlists') && playlistIds.value.length ? { playlistIds: [...playlistIds.value] } : {}) }
  const apply = async() => rendererInvoke(BACKUP_IPC.restore, request)
  const downloadSafe = async() => request.sections.includes('downloads') ? withDownloadListSync(apply) : apply()
  const result = await withLocalListLocks([defaultList.id, loveList.id, tempList.id, ...userLists.map(list => list.id), ...playlistIds.value], downloadSafe)
  preview.value = null
  notice.value = t(result.restart ? 'setting__backup_restored_restart' : 'setting__backup_restored')
})
const exportBackupNames = {
  playlists: 'lx_list.lxmc',
  settings: 'lx_setting_v2.lxmc',
  all: 'lx_datas_v3.lxmc',
  compat_playlists: 'lx_list_compat.lxmc',
  compat_settings: 'lx_setting_compat.lxmc',
  compat_all: 'lx_datas_compat.lxmc',
}
const exportBackup = async kind => run(async() => {
  const result = await openSaveDir({ title: t('setting__backup_all_export_desc'), defaultPath: exportBackupNames[kind] })
  if (result.canceled || !result.filePath) return
  await rendererInvoke(BACKUP_IPC.export, { path: result.filePath, kind })
  notice.value = t('setting__backup_exported')
})
const exportText = async csv => run(async() => {
  const merge = await dialog.confirm({ message: t('setting__backup_other_export_list_text_confirm'), cancelButtonText: t('cancel_button_text'), confirmButtonText: t('confirm_button_text') })
  const extension = csv ? '.csv' : '.txt'
  const result = merge ? await openSaveDir({ title: t('setting__backup_other_export_dir'), defaultPath: 'lx_list_all' + extension }) : await showSelectDialog({ title: t('setting__backup_other_export_dir'), properties: ['openDirectory'] })
  if (result.canceled) return
  let filename = merge ? result.filePath : result.filePaths[0]
  if (merge && !filename.toLowerCase().endsWith(extension)) filename += extension
  const lists = []
  for (const list of [defaultList, loveList, tempList, ...userLists]) lists.push({ ...toRaw(list), list: toRaw(await getListMusics(list.id)) })
  if (csv) await window.lx.worker.main.exportPlayListToCSV(filename, lists, merge, `${t('music_name')},${t('music_singer')},${t('music_album')}\n`)
  else await window.lx.worker.main.exportPlayListToText(filename, lists, merge)
  notice.value = t('setting__backup_exported')
})
</script>

<style lang="less" module>
.note { line-height: 1.6; font-size: .9em; opacity: .8; margin: 6px 0 12px; }
.notice { margin-top: 14px; line-height: 1.6; white-space: pre-wrap; }
.preview { padding: 24px; display: flex; flex-direction: column; gap: 10px; }
.preview h2 { font-size: 1.2em; }
.filename { overflow-wrap: anywhere; }
.sections { overflow-y: auto; max-height: 42vh; }
.section { padding: 12px 0; border-bottom: 1px solid var(--color-border-background); }
.sectionHeader { display: flex; align-items: center; gap: 8px; }
.sectionHeader .backupCheckbox { flex: 1; min-width: 0; width: auto; }
.sectionHeader :global(.help-icon) { margin: 0; }
.section label { display: flex; align-items: center; gap: 10px; line-height: 1.6; }
.section label span { margin-left: auto; opacity: .7; }
.section .backupCheckbox { display: block; width: 100%; }
.lists { padding-left: 22px; }
.lists .backupCheckbox { margin: 6px 0; }
:global(.backup-lists-enter-active), :global(.backup-lists-leave-active) { transition: opacity var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard); }
:global(.backup-lists-enter-from), :global(.backup-lists-leave-to) { opacity: 0; transform: translateY(-5px); }
.actions { display: flex; justify-content: flex-end; gap: 12px; }
</style>
