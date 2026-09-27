import { computed, ref, shallowRef, shallowReactive, reactive, nextTick } from '@common/utils/vueTools'
import musicSdk from '@renderer/utils/musicSdk'
import { useI18n } from '@renderer/plugins/i18n'
import { DOWNLOAD_STATUS } from '@common/constants'
import { useRouter } from '@common/utils/vueRouter'
import { pluginText } from '@common/optionalPlugins'
import { pluginRuntime } from '@renderer/store/optionalPlugins'
import { appSetting } from '@renderer/store/setting'
import { dialog } from '@renderer/plugins/Dialog'
import { setDownloadPriority } from '@renderer/store/download/action'

export default ({
  handleStartTask,
  handlePauseTask,
  handleRemoveTask,
  handleOpenFile,
  handleRelocateFile,
  handlePlayMusic,
  handlePlayMusicLater,
  handleShowMusicAddModal,
  handleSearch,
  handleOpenMusicDetail,
}) => {
  const itemMenuControl = reactive({
    play: true,
    start: true,
    pause: true,
    playLater: true,
    file: true,
    sourceDetail: true,
    search: true,
    remove: true,
    addTo: true,
  })
  const t = useI18n()
  const router = useRouter()
  const menuTask = shallowRef(null)
  const menuLocation = shallowReactive({ x: 0, y: 0 })
  const isShowItemMenu = ref(false)

  const menus = computed(() => {
    return [
      {
        name: t('list__play'),
        action: 'play',
        hide: !itemMenuControl.play,
      },
      {
        name: t('list__start'),
        action: 'start',
        hide: !itemMenuControl.start,
      },
      {
        name: t('list__pause'),
        action: 'pause',
        hide: !itemMenuControl.pause,
      },
      {
        name: t('list__play_later'),
        action: 'playLater',
        hide: !itemMenuControl.playLater,
      },
      {
        name: t('list__file'),
        action: 'file',
        hide: !itemMenuControl.file,
      },
      ...Object.entries(pluginRuntime.downloadActions).flatMap(([pluginId, actions]) => actions.map(action => ({
        name: pluginText(action.name, appSetting['common.langId'], action.id),
        action: `plugin:${pluginId}:${action.id}`,
        pluginId,
        pluginAction: action,
        disabled: !menuTask.value || !action.isAvailable(menuTask.value),
      }))),
      {
        name: t('download__relocate'),
        action: 'relocate',
        hide: !menuTask.value?.isComplate,
      },
      {
        name: t(menuTask.value?.priority ? 'download__priority_normal' : 'download__priority_first'),
        action: 'priority',
        hide: !menuTask.value || menuTask.value.isComplate,
      },
      {
        name: t('list__add_to'),
        action: 'addTo',
        disabled: !itemMenuControl.addTo,
      },
      {
        name: t('list__source_detail'),
        action: 'sourceDetail',
        disabled: !itemMenuControl.sourceDetail,
      },
      {
        name: t('list__search'),
        action: 'search',
        hide: !itemMenuControl.search,
      },
      {
        name: t('list__remove'),
        action: 'remove',
        hide: !itemMenuControl.remove,
      },
    ]
  })

  const showMenu = (event, taskInfo) => {
    menuTask.value = taskInfo
    itemMenuControl.sourceDetail = !!musicSdk[taskInfo.metadata.musicInfo.source]?.getMusicDetailPageUrl

    if (taskInfo.isComplate) {
      itemMenuControl.play =
        itemMenuControl.playLater =
        itemMenuControl.file = true
      itemMenuControl.start =
        itemMenuControl.pause = false
    } else if (taskInfo.status === DOWNLOAD_STATUS.ERROR || taskInfo.status === DOWNLOAD_STATUS.PAUSE) {
      itemMenuControl.play =
        itemMenuControl.playLater =
        itemMenuControl.pause =
        itemMenuControl.file = false
      itemMenuControl.start = true
    } else {
      itemMenuControl.play =
        itemMenuControl.playLater =
        itemMenuControl.start =
        itemMenuControl.file = false
      itemMenuControl.pause = true
    }

    if (taskInfo.audioDownloaded) itemMenuControl.file = true

    menuLocation.x = event.pageX
    menuLocation.y = event.pageY

    if (isShowItemMenu.value) return

    nextTick(() => {
      isShowItemMenu.value = true
    })
  }

  const hideMenu = () => {
    isShowItemMenu.value = false
  }

  const menuClick = (action, index) => {
    // console.log(action)
    const task = menuTask.value
    menuTask.value = null
    hideMenu()
    if (!action) return
    if (action.pluginAction) {
      // Keep the clicked task ID: filtering, sorting or removing rows can change its index.
      if (!task || !pluginRuntime.downloadActions[action.pluginId]?.includes(action.pluginAction) || !action.pluginAction.isAvailable(task)) return
      action.pluginAction.run(task.id, {
        openSettings: async() => {
          if (!pluginRuntime.downloadActions[action.pluginId]?.includes(action.pluginAction)) return
          await router.push({ path: '/setting', query: { name: 'SettingPluginStore', plugin: action.pluginId } })
        },
      }).catch(error => { console.error('Download plugin action failed:', error); return dialog.error({ message: String(error.message ?? error) }) })
      return
    }
    switch (action.action) {
      case 'priority':
        if (task) setDownloadPriority([task], task.priority ? 0 : 1)
        break
      case 'relocate':
        handleRelocateFile(task)
        break
      case 'start':
        handleStartTask(index)
        break
      case 'pause':
        handlePauseTask(index)
        break
      case 'file':
        handleOpenFile(index)
        break
      case 'play':
        handlePlayMusic(index)
        break
      case 'playLater':
        handlePlayMusicLater(index)
        break
      case 'addTo':
        handleShowMusicAddModal(index)
        break
      case 'search':
        handleSearch(index)
        break
      case 'remove':
        handleRemoveTask(index)
        break
      case 'sourceDetail':
        handleOpenMusicDetail(index)
    }
  }

  return {
    menus,
    menuLocation,
    isShowItemMenu,
    showMenu,
    menuClick,
  }
}
