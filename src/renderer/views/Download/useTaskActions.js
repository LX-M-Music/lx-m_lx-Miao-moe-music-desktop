import { useRouter } from '@common/utils/vueRouter'
import musicSdk from '@renderer/utils/musicSdk'
import { openUrl } from '@common/utils/electron'
import { dialog } from '@renderer/plugins/Dialog'
import { findDownloadFile } from '@renderer/utils/downloadFiles'
// import { useI18n } from '@renderer/plugins/i18n'
// import { appSetting } from '@renderer/store/setting'
import { toOldMusicInfo } from '@renderer/utils/index'
import { startDownloadTasks, pauseDownloadTasks, removeDownloadTasks, relocateDownloadTask } from '@renderer/store/download/action'
import { openDirInExplorer, showSelectDialog } from '@renderer/utils/ipc'

export default ({ list, selectedList, removeAllSelect }) => {
  const router = useRouter()
  // const t = useI18n()

  const handleSearch = index => {
    const info = list.value[index].metadata.musicInfo
    router.push({
      path: '/search',
      query: {
        text: `${info.name} ${info.singer}`,
      },
    })
  }

  const handleOpenMusicDetail = async(index) => {
    const task = list.value[index]
    const mInfo = toOldMusicInfo(task.metadata.musicInfo)
    const url = await musicSdk[mInfo.source]?.getMusicDetailPageUrl?.(mInfo)
    if (!url) return
    openUrl(url)
  }

  const handleStartTask = async(index, single) => {
    if (selectedList.value.length && !single) {
      startDownloadTasks([...selectedList.value])
      removeAllSelect()
    } else {
      startDownloadTasks([list.value[index]])
    }
  }

  const handlePauseTask = async(index, single) => {
    if (selectedList.value.length && !single) {
      pauseDownloadTasks([...selectedList.value])
      removeAllSelect()
    } else {
      pauseDownloadTasks([list.value[index]])
    }
  }

  const handleRemoveTask = async(index, single) => {
    if (selectedList.value.length && !single) {
      // const confirm = await (selectedList.value.length > 1
      //   ? dialog.confirm({
      //     message: t('lists__remove_music_tip', { len: selectedList.value.length }),
      //     confirmButtonText: t('lists__remove_tip_button'),
      //   })
      //   : Promise.resolve(true)
      // )
      // if (!confirm) return
      removeDownloadTasks(selectedList.value.map(m => m.id))
      removeAllSelect()
    } else {
      removeDownloadTasks([list.value[index].id])
    }
  }

  const handleRelocateFile = async(task) => {
    if (!task?.isComplate) return ''
    try {
      const { canceled, filePaths } = await showSelectDialog({
        title: window.i18n.t('download__relocate'),
        defaultPath: task.metadata.filePath,
        properties: ['openFile'],
        filters: [{ name: 'Media File', extensions: ['mp3', 'flac', 'ogg', 'oga', 'wav', 'm4a', 'ape'] }],
      })
      if (canceled || !filePaths.length) return ''
      if (await relocateDownloadTask(task.id, filePaths[0])) return filePaths[0]
      await dialog.error(window.i18n.t('download__relocate_failed'))
    } catch {
      await dialog.error(window.i18n.t('download__relocate_failed'))
    }
    return ''
  }

  const handleOpenFile = async(index) => {
    const task = list.value[index]
    let path = await findDownloadFile(task)
    if (!path && task.isComplate && await dialog.confirm({
      message: window.i18n.t('download__file_missing'),
      confirmButtonText: window.i18n.t('download__relocate'),
    })) path = await handleRelocateFile(task)
    if (path) await openDirInExplorer(path)
  }

  return {
    handleSearch,
    handleOpenMusicDetail,
    handleStartTask,
    handlePauseTask,
    handleRemoveTask,
    handleOpenFile,
    handleRelocateFile,
  }
}
