<template>
  <div :class="$style.download" :style="columnLayout.style">
    <div :class="$style.header">
      <base-tab v-model="activeTab" :class="$style.tab" :list="tabs" />
    </div>
    <div v-if="activeTab === 'error'" :class="$style.failureTools" data-download-failure-tools>
      <base-selection v-model="failureKind" :list="failureOptions" item-key="id" item-name="name" />
      <base-btn min :disabled="!list.length" @click="retryVisibleFailures">{{ $t('download__retry_filtered') }} ({{ list.length }})</base-btn>
    </div>
    <common-list-loading :load-key="list" :loading="isLoading" :class="$style.content">
      <common-music-list-header :layout="columnLayout" />
      <div v-if="list.length" ref="dom_listContent" :class="$style.content">
        <base-virtualized-list
          ref="listRef" v-slot="{ item, index }" :list="list" key-name="id" :item-height="listItemHeight"
          :overscan="10" container-class="scroll music-column-scroll" content-class="list"
        >
          <div
            class="list-item"
            :class="[{[$style.active]: playTaskId == item.id }, { selected: rightClickSelectedIndex == index }, { active: selectedList.includes(item) }]"
            @click="handleListItemClick($event, index)" @contextmenu="handleListItemRightClick($event, index)"
          >
            <div class="list-item-cell no-select" :class="$style.num" style="flex: 0 0 var(--music-column-index);" data-music-cell="index">
              <transition name="play-active">
                <div v-if="playTaskId == item.id" :class="$style.playIcon">
                  <span class="playing-equalizer" :class="{ paused: !isPlay }" aria-hidden="true"><span /><span /><span /></span>
                </div>
                <div v-else class="num">{{ index + 1 }}</div>
              </transition>
            </div>
            <div class="list-item-cell no-select" :class="$style.cover" style="flex: 0 0 var(--music-column-cover); padding: 0 6px;" data-music-cell="cover">
              <common-cover-image v-if="!coverErrorSet.has(getCoverKey(item))" :music-info="item.metadata.musicInfo" :size="appSetting['list.coverSize']" alt="" @error="handleCoverError(item)" />
              <svg v-else version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="60%" height="60%" viewBox="0 0 24 24" space="preserve">
                <use xlink:href="#icon-music" />
              </svg>
            </div>
            <div class="list-item-cell name" style="flex: 0 0 var(--music-column-name);" data-music-cell="name">
              <span class="select name" :aria-label="getName(item)">{{ getName(item) }}</span>
              <span v-if="item.priority" class="no-select badge badge-theme-primary">{{ $t('download__priority_label') }}</span>
            </div>
            <div class="list-item-cell" style="flex: 0 0 var(--music-column-progress);" data-music-cell="progress">{{ item.total > 0 || item.isComplate ? `${Math.max(0, item.progress)}%` : $t('download__downloaded_size', { size: sizeFormate(item.downloaded) }) }}<span v-if="item.status == downloadStatus.RUN && item.speed"> - {{ item.speed }}/s</span></div>
            <div class="list-item-cell" style="flex: 0 0 var(--music-column-status);" :aria-label="item.statusText" data-music-cell="status">{{ item.statusText }}</div>
            <div class="list-item-cell" style="flex: 0 0 var(--music-column-quality);" data-music-cell="quality">{{ getTypeName(item.metadata.quality) }}</div>
            <div class="list-item-cell" style="flex: 0 0 var(--music-column-action); padding-left: 0; padding-right: 0;" data-music-cell="action">
              <material-list-buttons
                :index="index" :download-btn="false" :file-btn="item.audioDownloaded || item.status != downloadStatus.ERROR" remove-btn="remove-btn"
                :start-btn="!item.isComplate && item.status != downloadStatus.WAITING && (item.status != downloadStatus.RUN)"
                :pause-btn="!item.isComplate && (item.status == downloadStatus.RUN || item.status == downloadStatus.WAITING)"
                :list-add-btn="false" :play-btn="item.status == downloadStatus.COMPLETED"
                :search-btn="item.status == downloadStatus.ERROR" @btn-click="handleListBtnClick"
              />
            </div>
          </div>
        </base-virtualized-list>
      </div>
      <div v-else :class="[$style.noItem, 'ui-state', { 'ui-state-error': loadError }]" role="status">
        <p>{{ loadError ? (appSetting['common.showErrorDialog'] ? loadError : $t('list__load_failed')) : $t('no_item') }}</p>
        <base-btn v-if="loadError" class="ui-state-retry" min @click="loadList">{{ $t('reload') }}</base-btn>
      </div>
      <base-menu v-model="isShowItemMenu" :menus="menus" :xy="menuLocation" item-name="name" @menu-click="handleMenuClick" />
      <!-- <base-menu :menus="listItemMenu" :location="listMenu.menuLocation" item-name="name" :is-show="listMenu.isShowItemMenu" @menu-click="handleListItemMenuClick" /> -->
    </common-list-loading>
    <common-list-add-modal v-model:show="isShowListAdd" :music-info="selectedAddMusicInfo" teleport="#view" />
    <common-list-add-multiple-modal v-model:show="isShowListAddMultiple" :music-list="selectedList" teleport="#view" @confirm="removeAllSelect" />
    <TagEditorModal />
  </div>
</template>

<script>
// import { checkPath, openDirInExplorer, openUrl } from '@common/utils/electron'

import { ref, reactive, computed } from '@common/utils/vueTools'
import useListInfo from './useListInfo'
import useList from './useList'
import useTab from './useTab'
import useMenu from './useMenu'
import usePlay from './usePlay'
import useTaskActions from './useTaskActions'
import useMusicAdd from './useMusicAdd'
import { downloadStatus } from '@renderer/store/download/state'
import { appSetting } from '@renderer/store/setting'
import useMusicListColumns from '@renderer/utils/compositions/useMusicListColumns'
import { isPlay } from '@renderer/store/player/state'
import { sizeFormate } from '@renderer/utils'
import { retryFailedDownloads } from '@renderer/store/download/action'
import { downloadFailureKinds } from '@common/utils/download/errors'
import { formatDownloadFileName } from '@common/utils/download/fileName'
import TagEditorModal from './TagEditorModal.vue'

export default {
  name: 'Download',
  components: { TagEditorModal },
  setup() {
    const columnLayout = useMusicListColumns('download')
    const listRef = ref()
    const { tabs, activeTab } = useTab()
    const failureKind = ref('all')
    const failureOptions = computed(() => ['all', ...downloadFailureKinds].map(id => ({ id, name: window.i18n.t(id === 'all' ? 'download__failure_all' : 'download__failure_' + id) })))

    const {
      rightClickSelectedIndex,
      dom_listContent,
      listAll,
      list,
      isLoading,
      loadError,
      loadList,
      playTaskId,
    } = useListInfo(activeTab, failureKind)
    const retryVisibleFailures = () => { void retryFailedDownloads(undefined, [...list.value]) }

    const {
      selectedList,
      listItemHeight,
      removeAllSelect,
      handleSelectData,
    } = useList({ listRef, list, listAll })

    const {
      handlePlayMusic,
      handlePlayMusicLater,
    } = usePlay({ selectedList, list, listAll, removeAllSelect })

    const {
      handleSearch,
      handleOpenMusicDetail,
      handleStartTask,
      handlePauseTask,
      handleRemoveTask,
      handleOpenFile,
      handleRelocateFile,
    } = useTaskActions({ list, removeAllSelect, selectedList })

    const {
      isShowListAdd,
      isShowListAddMultiple,
      selectedAddMusicInfo,
      handleShowMusicAddModal,
    } = useMusicAdd({ selectedList, list })

    const {
      menus,
      menuLocation,
      isShowItemMenu,
      showMenu,
      menuClick,
    } = useMenu({
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
    })

    let clickTime = 0
    let clickIndex = -1
    const doubleClickPlay = index => {
      if (
        window.performance.now() - clickTime > 400 ||
      clickIndex !== index
      ) {
        clickTime = window.performance.now()
        clickIndex = index
        return
      }
      const task = list.value[index]
      if (task.isComplate) {
        handlePlayMusic(list.value.indexOf(task), true)
      } else if (task.status === downloadStatus.RUN || task.status === downloadStatus.WAITING) {
        void handlePauseTask(index, true)
      } else {
        void handleStartTask(index, true)
      }
      clickTime = 0
      clickIndex = -1
    }

    const handleListItemClick = (event, index) => {
      if (rightClickSelectedIndex.value > -1) return
      handleSelectData(index)
      doubleClickPlay(index)
    }
    const handleListItemRightClick = (event, index) => {
      rightClickSelectedIndex.value = index
      showMenu(event, list.value[index], index)
    }
    const handleMenuClick = (action) => {
      let index = rightClickSelectedIndex.value
      rightClickSelectedIndex.value = -1
      menuClick(action, index)
    }

    const handleListBtnClick = ({ action, index }) => {
      switch (action) {
        case 'play':
          handlePlayMusic(index, true)
          break
        case 'start':
          void handleStartTask(index, true)
          break
        case 'pause':
          void handlePauseTask(index, true)
          break
        case 'remove':
          void handleRemoveTask(index, true)
          break
        case 'file':
          void handleOpenFile(index)
          break
        case 'search':
          handleSearch(index)
          break
      }
    }

    const coverErrorSet = reactive(new Set())
    const getCoverKey = (item) => `${item.metadata.musicInfo.source}__${item.metadata.musicInfo.id}`
    const handleCoverError = (item) => {
      coverErrorSet.add(getCoverKey(item))
    }

    const getName = (downloadInfo) => {
      const { metadata } = downloadInfo
      const name = metadata.fileAllocated
        ? metadata.fileName
        : formatDownloadFileName(appSetting['download.fileName'], metadata.musicInfo, metadata.quality, metadata.ext ?? 'mp3')
      return name.replace(/\.[^.]+$/, '')
    }
    const getTypeName = (quality) => {
      switch (quality) {
        case 'flac24bit':
          return 'FLAC 24Bit'
        case 'hires':
          return 'HIRES'
        case 'atmos':
          return 'ATMOS'
        case 'master':
          return 'MASTER'
        default:
          return quality?.toUpperCase()
      }
    }
    return {
      columnLayout,
      listRef,
      list,
      downloadStatus,
      rightClickSelectedIndex,
      dom_listContent,
      tabs,
      activeTab,
      failureKind,
      failureOptions,
      retryVisibleFailures,
      selectedList,
      listItemHeight,
      playTaskId,

      isShowListAdd,
      isShowListAddMultiple,
      selectedAddMusicInfo,

      removeAllSelect,

      menus,
      menuLocation,
      isShowItemMenu,

      handleListItemClick,
      handleListItemRightClick,
      handleMenuClick,
      handleListBtnClick,

      getName,
      getTypeName,
      sizeFormate,
      isPlay,
      appSetting,
      isLoading,
      loadError,
      loadList,
      getCoverKey,
      coverErrorSet,
      handleCoverError,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';
.failureTools { display: flex; align-items: center; gap: 12px; padding: 8px 15px; }

.download {
  position: relative;
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-flow: column nowrap;

  :global(.list-item) {
    &.active {
      color: var(--color-button-font);
    }
  }
}
.num {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.playIcon {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;

  color: var(--color-button-font);
  opacity: .7;
}


.cover {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;

  img {
    width: var(--list-cover-size);
    height: var(--list-cover-size);
    border-radius: var(--radius-sm);
    object-fit: cover;
  }

  svg {
    width: 60%;
    height: auto;
    fill: var(--color-font-label);
    opacity: .5;
  }
}

.content {
  min-height: 0;
  font-size: 14px;
  display: flex;
  flex-flow: column nowrap;
  flex: auto;
}

.noItem {
  position: relative;
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  align-items: center;

  p {
    font-size: 24px;
    color: var(--color-font-label);
  }
}

</style>
