<template>
  <section data-audio-tag-editor :class="$style.editor" @keydown.ctrl.s.prevent.stop="save" @keydown.meta.s.prevent.stop="save">
    <p :class="$style.intro">{{ text.intro }}</p>
    <div :class="$style.toolbar">
      <base-btn min :disabled="editor.busy" @click="chooseFile">{{ text.choose }}</base-btn>
      <span :class="$style.hint">MP3 · FLAC</span>
    </div>
    <p v-if="editor.error" :class="$style.error" role="alert">{{ errorText }}</p>
    <p v-if="editor.saved" :class="$style.success" role="status">{{ text.saved }}</p>
    <div :class="$style.workspace">
      <form v-if="editor.snapshot" :class="$style.form" @submit.prevent="save">
        <div :class="$style.fileInfo">
          <h4>{{ fileName }} <span v-if="dirty">{{ text.unsaved }}</span></h4>
          <p>{{ editor.snapshot.format }} · {{ (editor.snapshot.size / 1024 / 1024).toFixed(2) }} MB</p>
          <p :class="$style.path">{{ editor.snapshot.filePath }}</p>
        </div>
        <fieldset :disabled="editor.busy" :class="$style.fields">
          <label v-for="field in fieldNames" :key="field" :class="{[$style.wide]: field === 'comment'}">
            <span>{{ text.fields[field] }}</span>
            <textarea v-if="field === 'comment'" v-model="editor.tags[field]" rows="3" maxlength="10000" />
            <input v-else v-model="editor.tags[field]" type="text" maxlength="10000" :placeholder="field === 'track' || field === 'disc' ? '1/12' : ''">
          </label>
        </fieldset>
        <div :class="$style.mediaFields">
          <section :class="$style.coverEditor" :aria-label="text.cover">
            <h4>{{ text.cover }}</h4>
            <div :class="$style.coverRow">
              <div :class="$style.coverPreview">
                <img v-if="coverPreview" :src="coverPreview" :alt="text.cover">
                <svg v-else aria-hidden="true" viewBox="0 0 24 24"><use xlink:href="#icon-music" /></svg>
              </div>
              <div :class="$style.coverControls">
                <p>{{ editor.cover ? coverPreview ? text.coverPresent : text.coverUnpreviewable : text.noCover }}</p>
                <div :class="$style.coverButtons">
                  <base-btn min :disabled="editor.busy" @click="chooseCover">{{ text.chooseCover }}</base-btn>
                  <base-btn min outline :disabled="editor.busy || !editor.cover" @click="removeCover">{{ text.removeCover }}</base-btn>
                </div>
                <p :class="$style.hint">{{ text.coverHint }}</p>
              </div>
            </div>
          </section>
          <label :class="$style.lyricsEditor">
            <span>{{ text.lyrics }}</span>
            <textarea v-model="editor.tags.lyrics" :aria-label="text.lyrics" :disabled="editor.busy" rows="8" maxlength="262144" :placeholder="text.lyricsHint" />
            <span :class="$style.hint">{{ text.lyricsHint }}</span>
          </label>
        </div>
        <div :class="$style.actions">
          <base-btn min :disabled="editor.busy || !dirty" @click="save">{{ editor.busy ? text.working : text.save }}</base-btn>
          <base-btn min outline :disabled="editor.busy || !dirty" @click="reset">{{ text.reset }}</base-btn>
          <span :class="$style.hint">{{ text.shortcut }}</span>
        </div>
      </form>
      <div v-else :class="$style.placeholder" role="status">
        <svg aria-hidden="true" viewBox="0 0 24 24"><use xlink:href="#icon-music" /></svg>
        <h4>{{ text.start }}</h4>
        <p>{{ text.startHint }}</p>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, watch } from 'vue'
import { ipcRenderer } from 'electron'
import path from 'node:path'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { appSetting } from '@renderer/store/setting'
import { readCoverFile, saveTags } from './metadata'
import { editor } from './session'
import { text, fieldNames } from './text'
import { dirty, errorText, confirmDiscard, report, loadFile, validateDownloadTarget, withEditorAction } from './actions'

const props = defineProps({ afterSave: { type: Function, default: undefined } })

const fileName = computed(() => editor.snapshot ? path.basename(editor.snapshot.filePath) : '')
const coverPreview = computed(() => editor.cover?.data ? `data:${editor.cover.mime};base64,${editor.cover.data}` : '')
watch(() => JSON.stringify(editor.tags), () => { editor.saved = false })
watch(() => editor.cover, () => { editor.saved = false })

const chooseFile = async() => withEditorAction(async() => {
  const result = await ipcRenderer.invoke(WIN_MAIN_RENDERER_EVENT_NAME.show_select_dialog, {
    title: text.value.choose,
    defaultPath: appSetting['download.savePath'],
    properties: ['openFile'],
    filters: [{ name: 'MP3 / FLAC', extensions: ['mp3', 'flac'] }],
  })
  if (result.canceled || !result.filePaths.length || !await confirmDiscard()) return
  await loadFile(result.filePaths[0])
})
const reset = () => {
  if (editor.busy || !editor.snapshot) return
  editor.tags = { ...editor.snapshot.tags }
  editor.cover = editor.snapshot.cover
  editor.error = ''
  editor.saved = false
}
const chooseCover = async() => withEditorAction(async() => {
  if (!editor.snapshot) return
  const result = await ipcRenderer.invoke(WIN_MAIN_RENDERER_EVENT_NAME.show_select_dialog, {
    title: text.value.chooseCover,
    defaultPath: path.dirname(editor.snapshot.filePath),
    properties: ['openFile'],
    filters: [{ name: 'JPEG / PNG', extensions: ['jpg', 'jpeg', 'png'] }],
  })
  if (result.canceled || !result.filePaths.length) return
  editor.cover = await readCoverFile(result.filePaths[0])
})
const removeCover = () => {
  if (editor.busy || !editor.snapshot) return
  editor.cover = null
  editor.saved = false
}
const save = async() => {
  if (editor.busy || !editor.snapshot || !dirty.value) return
  editor.busy = true
  editor.error = ''
  editor.saved = false
  try {
    await validateDownloadTarget()
    const updates = { ...editor.tags }
    if (editor.cover !== editor.snapshot.cover) updates.cover = editor.cover
    const snapshot = await saveTags(editor.snapshot, updates, validateDownloadTarget)
    editor.snapshot = snapshot
    editor.tags = { ...snapshot.tags }
    editor.cover = snapshot.cover
    await props.afterSave?.(snapshot)
    // Let the dirty-state watcher settle before showing the saved confirmation.
    await nextTick()
    editor.saved = true
  } catch (error) { report(error) } finally { editor.busy = false }
}
</script>

<style lang="less" module>
.editor { max-width: 760px; color: var(--color-font); font-size: 13px; line-height: 1.6; }
.intro { margin: 0 0 16px; color: var(--color-font-label); }
.toolbar, .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.hint { color: var(--color-font-label); font-size: 12px; }
.workspace { border: 1px solid var(--color-primary-light-100-alpha-700); border-radius: var(--radius-lg); overflow: hidden; }
.editor h4 { margin: 0 0 12px; font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
.editor h4 span { font-size: 11px; color: var(--color-font-label); margin-left: 6px; font-weight: normal; }
.editor input, .editor textarea { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--color-primary-light-100-alpha-700); border-radius: var(--radius-md); padding: 7px 9px; color: var(--color-font); background: var(--color-app-background); font: inherit; user-select: text; }
.editor input:focus, .editor textarea:focus { outline: 2px solid var(--color-primary); outline-offset: 1px; }
.editor textarea { resize: vertical; }
.form { min-width: 0; padding: 16px; }
.fileInfo { padding-bottom: 14px; margin-bottom: 14px; border-bottom: 1px solid var(--color-primary-light-100-alpha-700); }
.fileInfo h4 { margin-bottom: 4px; }
.fileInfo p { margin: 0; font-size: 11px; color: var(--color-font-label); }
.path { overflow-wrap: anywhere; user-select: text; }
.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 0; border: 0; margin: 0; min-width: 0; }
.fields label { min-width: 0; }
.fields label > span { display: block; margin-bottom: 8px; font-size: 12px; }
.wide { grid-column: 1 / -1; }
.mediaFields { display: grid; gap: 20px; margin-top: 20px; }
.coverEditor h4 { margin-bottom: 8px; }
.coverRow { display: flex; gap: 16px; align-items: center; }
.coverPreview { flex: none; width: 96px; height: 96px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid var(--color-primary-light-100-alpha-700); border-radius: var(--radius-md); background: var(--color-app-background); }
.coverPreview img { width: 100%; height: 100%; object-fit: cover; }
.coverPreview svg { width: 40px; height: 40px; color: var(--color-primary); }
.coverControls { min-width: 0; }
.coverControls p { margin: 0 0 8px; color: var(--color-font-label); }
.coverButtons { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.lyricsEditor > span:first-child { display: block; margin-bottom: 8px; font-size: 12px; }
.lyricsEditor textarea { min-height: 120px; }
.lyricsEditor .hint { display: block; margin-top: 6px; }
.actions { margin: 16px 0 0; }
.placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 300px; padding: 30px; text-align: center; color: var(--color-font-label); }
.placeholder svg { width: 48px; height: 48px; margin-bottom: 16px; color: var(--color-primary); }
.placeholder p, .empty { font-size: 12px; color: var(--color-font-label); }
.empty { padding: 16px 0; }
.error, .success { padding: 10px 12px; border-radius: var(--radius-md); margin-bottom: 14px; background: var(--color-primary-alpha-900); }
.error { border-left: 3px solid #cf5656; }
.success { color: var(--color-primary); }
@media (max-width: 580px) {
  .fields { grid-template-columns: 1fr; }
}
</style>
