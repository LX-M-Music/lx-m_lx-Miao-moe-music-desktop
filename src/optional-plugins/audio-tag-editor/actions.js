import { formatError } from '@common/utils/errorMessage'
import { computed } from 'vue'
import { dialog } from '@renderer/plugins/Dialog'
import { getDownloads, getDownloadSavePaths } from '@renderer/utils/downloadFiles'
import { readTags, supported } from './metadata'
import { resolveDownloadFile, sameFilePath } from './downloadFile'
import { editor } from './session'
import { text, fieldNames } from './text'

export const dirty = computed(() => editor.snapshot && (editor.cover !== editor.snapshot.cover || editor.tags.lyrics !== editor.snapshot.tags.lyrics || fieldNames.some(key => editor.tags[key] !== editor.snapshot.tags[key])))
export const errorText = computed(() => {
  const reason = text.value.errors[editor.error] ?? text.value.errors.UNKNOWN
  const detail = editor.errorDetail && editor.errorDetail !== editor.error && editor.errorDetail !== reason ? ` ${editor.errorDetail}` : ''
  return formatError({ code: editor.error, message: reason + detail }, '', 'TAGS_LOAD_FAILED')
})
export const confirmDiscard = async() => !dirty.value || dialog.confirm({ message: text.value.discard, confirmButtonText: text.value.discardConfirm, cancelButtonText: text.value.cancel })
export const report = error => { editor.error = error.code ?? 'UNKNOWN'; editor.errorDetail = error.message; editor.saved = false }
const fail = code => { throw Object.assign(new Error(code), { code }) }

export const applySnapshot = (snapshot, id = '') => {
  editor.snapshot = snapshot
  editor.tags = { ...snapshot.tags }
  editor.cover = snapshot.cover
  editor.downloadId = id
  editor.saved = false
}

export const loadFile = async(filePath) => {
  const snapshot = await readTags(filePath)
  if (!editor.active) return false
  applySnapshot(snapshot)
  return true
}

export const withEditorAction = async(action, notifyError = false) => {
  if (!editor.active) return false
  if (editor.busy) {
    if (notifyError) await dialog({ message: text.value.errors.FILE_BUSY })
    return false
  }
  editor.busy = true
  editor.error = ''
  try { return await action() } catch (error) {
    if (editor.active) {
      report(error)
      if (notifyError) await dialog({ message: errorText.value })
    }
    return false
  } finally { editor.busy = false }
}

const downloadTarget = async(id) => {
  const task = (await getDownloads()).find(item => item.id === id)
  return resolveDownloadFile(task, task ? getDownloadSavePaths(task) : [])
}

export const validateDownloadTarget = async() => {
  if (!editor.downloadId || !editor.snapshot) return
  const filePath = await downloadTarget(editor.downloadId)
  if (!sameFilePath(filePath, editor.snapshot.filePath)) fail('FILE_CHANGED')
}

export const openDownload = async(id, notifyError = false) => withEditorAction(async() => {
  const filePath = await downloadTarget(id)
  if (dirty.value && sameFilePath(filePath, editor.snapshot.filePath)) {
    editor.downloadId = id
    return true
  }
  if (!await confirmDiscard() || !editor.active) return false
  // A confirmation dialog may stay open while the file moves or the task restarts.
  if (!sameFilePath(filePath, await downloadTarget(id))) fail('FILE_CHANGED')
  const snapshot = await readTags(filePath)
  if (!sameFilePath(filePath, await downloadTarget(id))) fail('FILE_CHANGED')
  if (!editor.active) return false
  applySnapshot(snapshot, id)
  return true
}, notifyError)

export const canEditLocalMusic = musicInfo => musicInfo?.source === 'local' && supported(musicInfo.meta?.filePath)

export const openLocalMusic = async(musicInfo, notifyError = false) => withEditorAction(async() => {
  if (!canEditLocalMusic(musicInfo)) fail('UNSUPPORTED_FILE')
  const filePath = musicInfo.meta.filePath
  if (dirty.value && sameFilePath(filePath, editor.snapshot.filePath)) {
    editor.downloadId = ''
    return true
  }
  if (!await confirmDiscard() || !editor.active) return false
  return loadFile(filePath)
}, notifyError)
