import { addListMusics, setFetchingListStatus } from '@renderer/store/list/action'
import { showSelectDialog } from '@renderer/utils/ipc'
import { dialog } from '@renderer/plugins/Dialog'


const handleAddMusics = async(listId: string, filePaths: string[]) => {
  const failures = new Set<string>()
  for (let index = 0; index < filePaths.length; index += 200) {
    const paths = filePaths.slice(index, index + 200)
    try {
      const { musicInfos, failedPaths } = await window.lx.worker.main.createLocalMusicInfos(paths)
      for (const path of failedPaths) failures.add(path)
      if (musicInfos.length) await addListMusics(listId, musicInfos)
    } catch {
      for (const path of paths) failures.add(path)
    }
  }
  return [...failures]
}
export const addLocalFile = async(listInfo: LX.List.MyListInfo) => {
  const { canceled, filePaths } = await showSelectDialog({
    title: window.i18n.t('lists__add_local_file_desc'),
    properties: ['openFile', 'multiSelections'],
    filters: [
      // https://support.google.com/chromebook/answer/183093
      // 3gp, .avi, .mov, .m4v, .m4a, .mp3, .mkv, .ogm, .ogg, .oga, .webm, .wav
      { name: 'Media File', extensions: ['mp3', 'flac', 'ogg', 'oga', 'wav', 'm4a'] },
      // { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (canceled || !filePaths.length) return

  setFetchingListStatus(listInfo.id, true)
  let failedPaths: string[] = []
  try {
    failedPaths = await handleAddMusics(listInfo.id, filePaths)
  } finally {
    setFetchingListStatus(listInfo.id, false)
  }
  if (failedPaths.length) {
    await dialog.error({
      message: window.i18n.t('lists__local_import_failed', { count: failedPaths.length }) + '\n' + failedPaths.join('\n'),
      selection: true,
    })
  }
}
