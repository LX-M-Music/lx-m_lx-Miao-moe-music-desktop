<template>
  <common-list-loading :load-key="list" :loading="isLoading" :class="$style.list" :style="columnLayout.style">
    <common-music-list-header :layout="columnLayout" />
    <div v-show="list.length" ref="dom_listContent" :class="$style.content">
      <base-virtualized-list
        v-if="actionButtonsVisible" ref="listRef" v-slot="{ item, index }" :list="list" key-name="id"
        :item-height="listItemHeight" :overscan="10" container-class="scroll music-column-scroll" content-class="list"
        @scroll="saveListPosition" @contextmenu.capture="handleListRightClick"
      >
        <div
          class="list-item" :class="[{ [$style.active]: playerInfo.isPlayList && playerInfo.playIndex === index }, { selected: selectedIndex == index || rightClickSelectedIndex == index }, { active: selectedList.includes(item) }, { disabled: !assertApiSupport(item.source) }]"
          :data-song-id="item.id" :data-song-dragging="songDrag?.ids.has(item.id) || undefined"
          @pointerdown="handleSongPointerDown($event, item)" @dragstart.prevent
          @click="handleListItemClick($event, index)" @contextmenu="handleListItemRightClick($event, index, item)"
        >
          <div class="list-item-cell no-select" :class="$style.num" :aria-label="$t('list__drag_tip')" style="flex: 0 0 var(--music-column-index);" data-music-cell="index">
            <transition name="play-active">
              <div v-if="playerInfo.isPlayList && playerInfo.playIndex === index" :class="$style.playIcon">
                <span class="playing-equalizer" :class="{ paused: !playerInfo.isPlay }" aria-hidden="true"><span /><span /><span /></span>
              </div>
              <div v-else class="num">{{ index + 1 }}</div>
            </transition>
          </div>
          <div class="list-item-cell no-select" :class="$style.cover" style="flex: 0 0 var(--music-column-cover); padding: 0 6px;" data-music-cell="cover">
            <common-cover-image v-if="!coverErrorSet.has(getCoverKey(item))" :music-info="item" :size="appSetting['list.coverSize']" alt="" @error="handleCoverError(item)" />
            <svg v-else version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="60%" height="60%" viewBox="0 0 24 24" space="preserve">
              <use xlink:href="#icon-music" />
            </svg>
          </div>
          <div class="list-item-cell name" :aria-label="item.name" style="flex: 0 0 var(--music-column-name);" data-music-cell="name">
            <span class="select name">{{ item.name }}</span>
            <span v-if="isShowSource" class="no-select label-source">{{ item.source }}</span>
          </div>
          <div class="list-item-cell" style="flex: 0 0 var(--music-column-singer);" data-music-cell="singer">
            <span v-if="canOpenEntity(item) && getSingerNames(item).length" :class="$style.entityLinks" class="select" :aria-label="item.singer">
              <template v-for="(singer, singerIndex) in getSingerNames(item)" :key="`${singer}__${singerIndex}`">
                <span v-if="singerIndex" :class="$style.entitySeparator">、</span>
                <button type="button" :class="$style.entityLink" @click.stop="openEntityDetail(item, 'singer', singer)">{{ singer }}</button>
              </template>
            </span>
            <span v-else class="select" :aria-label="item.singer">{{ item.singer }}</span>
          </div>
          <div class="list-item-cell" style="flex: 0 0 var(--music-column-album);" data-music-cell="album">
            <button
              v-if="canOpenEntity(item) && item.meta.albumName" type="button" class="select" :class="$style.entityLink"
              :aria-label="item.meta.albumName" @click.stop="openEntityDetail(item, 'album', item.meta.albumName)"
            >
              {{ item.meta.albumName }}
            </button>
            <span v-else class="select" :aria-label="item.meta.albumName">{{ item.meta.albumName }}</span>
          </div>
          <div class="list-item-cell" style="flex: 0 0 var(--music-column-time);" data-music-cell="time"><span class="no-select">{{ item.interval || '--/--' }}</span></div>
          <div class="list-item-cell" style="flex: 0 0 var(--music-column-action); padding-left: 0; padding-right: 0;" data-music-cell="action">
            <material-list-buttons :index="index" :download-btn="assertApiSupport(item.source) && item.source != 'local'" @btn-click="handleListBtnClick" />
          </div>
        </div>
      </base-virtualized-list>
      <base-virtualized-list
        v-else ref="listRef" v-slot="{ item, index }" :list="list" key-name="id"
        :item-height="listItemHeight" :overscan="10" container-class="scroll music-column-scroll" content-class="list"
        @scroll="saveListPosition" @contextmenu.capture="handleListRightClick"
      >
        <div
          class="list-item"
          :class="[{ [$style.active]: playerInfo.isPlayList && playerInfo.playIndex === index }, { selected: selectedIndex == index || rightClickSelectedIndex == index }, { active: selectedList.includes(item) }, { disabled: !assertApiSupport(item.source) }]"
          :data-song-id="item.id" :data-song-dragging="songDrag?.ids.has(item.id) || undefined"
          @pointerdown="handleSongPointerDown($event, item)" @dragstart.prevent
          @click="handleListItemClick($event, index)" @contextmenu="handleListItemRightClick($event, index, item)"
        >
          <div class="list-item-cell no-select" :class="$style.num" :aria-label="$t('list__drag_tip')" style="flex: 0 0 var(--music-column-index);" data-music-cell="index">
            <transition name="play-active">
              <div v-if="playerInfo.isPlayList && playerInfo.playIndex === index" :class="$style.playIcon">
                <span class="playing-equalizer" :class="{ paused: !playerInfo.isPlay }" aria-hidden="true"><span /><span /><span /></span>
              </div>
              <div v-else class="num">{{ index + 1 }}</div>
            </transition>
          </div>
          <div class="list-item-cell no-select" :class="$style.cover" style="flex: 0 0 var(--music-column-cover); padding: 0 6px;" data-music-cell="cover">
            <common-cover-image v-if="!coverErrorSet.has(getCoverKey(item))" :music-info="item" :size="appSetting['list.coverSize']" alt="" @error="handleCoverError(item)" />
            <svg v-else version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="60%" height="60%" viewBox="0 0 24 24" space="preserve">
              <use xlink:href="#icon-music" />
            </svg>
          </div>
          <div class="list-item-cell name" style="flex: 0 0 var(--music-column-name);" data-music-cell="name">
            <span class="select name" :aria-label="item.name">{{ item.name }}</span>
            <span v-if="isShowSource" class="no-select label-source">{{ item.source }}</span>
          </div>
          <div class="list-item-cell" style="flex: 0 0 var(--music-column-singer);" data-music-cell="singer">
            <span v-if="canOpenEntity(item) && getSingerNames(item).length" :class="$style.entityLinks" class="select" :aria-label="item.singer">
              <template v-for="(singer, singerIndex) in getSingerNames(item)" :key="`${singer}__${singerIndex}`">
                <span v-if="singerIndex" :class="$style.entitySeparator">、</span>
                <button type="button" :class="$style.entityLink" @click.stop="openEntityDetail(item, 'singer', singer)">{{ singer }}</button>
              </template>
            </span>
            <span v-else class="select" :aria-label="item.singer">{{ item.singer }}</span>
          </div>
          <div class="list-item-cell" style="flex: 0 0 var(--music-column-album);" data-music-cell="album">
            <button
              v-if="canOpenEntity(item) && item.meta.albumName" type="button" class="select" :class="$style.entityLink"
              :aria-label="item.meta.albumName" @click.stop="openEntityDetail(item, 'album', item.meta.albumName)"
            >
              {{ item.meta.albumName }}
            </button>
            <span v-else class="select" :aria-label="item.meta.albumName">{{ item.meta.albumName }}</span>
          </div>
          <div class="list-item-cell" style="flex: 0 0 var(--music-column-time);" data-music-cell="time"><span class="no-select">{{ item.interval || '--/--' }}</span></div>
        </div>
      </base-virtualized-list>
      <div v-if="songDrag" :class="$style.dragOverlay" data-song-drag-preview>
        <div v-if="songDrag.showLine" :class="$style.dropLine" :style="{ top: `${songDrag.lineTop}px` }" data-song-drop-line />
        <div :class="[$style.dragCard, { [$style.invalidDrop]: !songDrag.valid }]" :style="{ transform: `translateY(${songDrag.top}px)` }" role="status">
          <strong>{{ songDrag.name }}</strong>
          <span>{{ $t('list__drag_status', { count: songDrag.ids.size }) }}</span>
        </div>
      </div>
    </div>
    <div v-show="!list.length" :class="[$style.noItem, 'ui-state', { 'ui-state-error': loadError }]" role="status">
      <p>{{ loadError ? (appSetting['common.showErrorDialog'] ? loadError : $t('list__load_failed')) : $t('no_item') }}</p>
      <base-btn v-if="loadError" class="ui-state-retry" min @click="retryList">{{ $t('reload') }}</base-btn>
    </div>
    <common-list-add-modal
      v-model:show="isShowListAdd" :is-move="isMove" :from-list-id="listId"
      :music-info="selectedAddMusicInfo" :exclude-list-id="excludeListIds" teleport="#view"
    />
    <common-list-add-multiple-modal
      v-model:show="isShowListAddMultiple" :from-list-id="listId"
      :is-move="isMoveMultiple" :music-list="selectedList" :exclude-list-id="excludeListIds" teleport="#view" @confirm="removeAllSelect"
    />
    <common-download-modal v-model:show="isShowDownload" :music-info="selectedDownloadMusicInfo" teleport="#view" :list-id="listId" />
    <common-download-multiple-modal v-model:show="isShowDownloadMultiple" :list="selectedList" teleport="#view" :list-id="listId" @confirm="removeAllSelect" />
    <search-list :list="list" :visible="isShowSearchBar" @action="handleMusicSearchAction" />
    <music-toggle-modal v-model:show="isShowMusicToggleModal" :music-info="selectedToggleMusicInfo" :preferred-source="selectedToggleSource" @toggle="toggleSource" />
    <base-menu v-model="isShowItemMenu" :menus="menus" :xy="menuLocation" item-name="name" @menu-click="handleMenuClick" />
  </common-list-loading>
</template>

<script>
import { computed, reactive } from '@common/utils/vueTools'
import { clipboardWriteText } from '@common/utils/electron'
import { assertApiSupport } from '@renderer/store/utils'
import { getCoverKey } from '@renderer/utils/musicCover'
import SearchList from './components/SearchList.vue'
import MusicToggleModal from './components/MusicToggleModal.vue'
import useListInfo from './useListInfo'
import useList from './useList'
import useMenu from './useMenu'
import usePlay from './usePlay'
import useMusicDownload from './useMusicDownload'
import useMusicAdd from './useMusicAdd'
import useSongDrag from './useSongDrag'
import useMusicActions from './useMusicActions'
import useSearch from './useSearch'
import useListScroll from './useListScroll'
import useMusicToggle from './useMusicToggle'
import { appSetting } from '@renderer/store/setting'
import useMusicListColumns from '@renderer/utils/compositions/useMusicListColumns'
import useEntityDetailNavigation from '@renderer/utils/compositions/useEntityDetailNavigation'
export default {
  name: 'MusicList',
  components: {
    SearchList,
    MusicToggleModal,
  },
  props: {
    listId: {
      type: String,
      required: true,
    },
  },
  emits: ['show-menu'],
  setup(props, { emit }) {
    const actionButtonsVisible = computed(() => appSetting['list.actionButtonsVisible'])
    const columnLayout = useMusicListColumns('music', actionButtonsVisible)
    const { canOpenEntity, getSingerNames, openEntityDetail } = useEntityDetailNavigation()

    let scrollIndex = null
    let isAnimation = false
    const handleRestoreScroll = (_scrollIndex, _isAnimation) => {
      scrollIndex = _scrollIndex
      isAnimation = _isAnimation
      if (isAnimation) void restoreScroll(scrollIndex, isAnimation)
      // console.log('handleRestoreScroll', scrollIndex, isAnimation)
    }
    const onLoadedList = async() => {
      // console.log('restoreScroll', scrollIndex, isAnimation)
      return restoreScroll(scrollIndex, isAnimation)
    }

    const coverErrorSet = reactive(new Set())
    const handleCoverError = (item) => {
      coverErrorSet.add(getCoverKey(item))
    }

    const {
      rightClickSelectedIndex,
      selectedIndex,
      dom_listContent,
      listRef,
      list,
      isLoading,
      loadError,
      retryList,
      playerInfo,
      setSelectedIndex,
      isShowSource,
      excludeListIds,
    } = useListInfo({ props, onLoadedList })

    const {
      selectedList,
      listItemHeight,
      handleSelectData,
      removeAllSelect,
    } = useList({ listRef, list })

    const {
      handlePlayMusic,
      handlePlayMusicLater,
      doubleClickPlay,
    } = usePlay({ props, selectedList, list, removeAllSelect })

    const {
      isShowListAdd,
      isMove,
      isShowListAddMultiple,
      isMoveMultiple,
      selectedAddMusicInfo,
      handleShowMusicAddModal,
      handleShowMusicMoveModal,
    } = useMusicAdd({ selectedList, list })

    const {
      isShowDownload,
      isShowDownloadMultiple,
      selectedDownloadMusicInfo,
      handleShowDownloadModal,
    } = useMusicDownload({ selectedList, list })

    const {
      handleShowMusicToggleModal,
      isShowMusicToggleModal,
      selectedToggleMusicInfo,
      selectedToggleSource,
      toggleSource,
    } = useMusicToggle(props, list)

    const {
      handleSearch,
      handleOpenMusicDetail,
      handleCopyName,
      handleDislikeMusic,
      handleRemoveMusic,
    } = useMusicActions({ props, list, removeAllSelect, selectedList })

    const {
      menus,
      menuLocation,
      isShowItemMenu,
      showMenu,
      menuClick,
    } = useMenu({
      assertApiSupport,
      emit,

      handleShowDownloadModal,
      handlePlayMusic,
      handlePlayMusicLater,
      handleShowMusicToggleModal,
      handleSearch,
      handleShowMusicAddModal,
      handleShowMusicMoveModal,
      handleOpenMusicDetail,
      handleCopyName,
      handleDislikeMusic,
      handleRemoveMusic,
    })

    const {
      isShowSearchBar,
      searchList,
      handleMusicSearchAction,
    } = useSearch({
      setSelectedIndex,
      handlePlayMusic,
      listRef,
    })

    const { saveListPosition, restoreScroll } = useListScroll({ props, listRef, list, handleRestoreScroll })

    const { songDrag, handleSongPointerDown } = useSongDrag({
      props,
      list,
      listRef,
      listItemHeight,
      selectedList,
      onStart: () => { handleMenuClick(null) },
      onSaved: () => {
        removeAllSelect()
        setSelectedIndex(-1)
      },
    })

    const handleListItemClick = (event, index) => {
      if (rightClickSelectedIndex.value > -1) return
      handleSelectData(index)
      doubleClickPlay(index)
    }
    let rightClickTarget = null
    const handleListItemRightClick = (event, index, musicInfo) => {
      rightClickTarget = { listId: props.listId, musicId: musicInfo.id }
      rightClickSelectedIndex.value = index
      showMenu(event, musicInfo, index)
    }
    const handleMenuClick = (action) => {
      // The playlist may change while the menu is open. Resolve the clicked song by ID.
      const index = rightClickTarget?.listId === props.listId
        ? list.value.findIndex(item => item.id === rightClickTarget.musicId)
        : -1
      rightClickTarget = null
      rightClickSelectedIndex.value = -1
      menuClick(index < 0 ? null : action, index)
    }
    const handleListRightClick = (event) => {
      if (!event.target.classList.contains('select')) return
      if (!window.getSelection()?.toString().trim()) return
      event.stopImmediatePropagation()
      let classList = dom_listContent.value.classList
      classList.add('copying')
      window.requestAnimationFrame(() => {
        let str = window.getSelection().toString()
        classList.remove('copying')
        str = str.split(/\n\n/).map(s => s.replace(/\n/g, '  ')).join('\n').trim()
        if (!str.length) return
        clipboardWriteText(str)
      })
    }
    const handleListBtnClick = ({ action, index }) => {
      switch (action) {
        case 'download':
          handleShowDownloadModal(index, true)
          break
        case 'play':
          handlePlayMusic(index, true)
          break
        case 'search':
          handleSearch(index)
          break
        case 'listAdd':
          handleShowMusicAddModal(index, true)
          break
      }
    }
    const scrollToTop = () => {
      listRef.value.scrollTo(0, true)
    }

    return {
      columnLayout,
      listItemHeight,
      handleListItemClick,
      selectedList,
      handleListItemRightClick,
      removeAllSelect,
      handleListBtnClick,
      rightClickSelectedIndex,
      selectedIndex,
      dom_listContent,
      listRef,
      excludeListIds,

      menus,
      isShowItemMenu,
      menuLocation,
      handleMenuClick,

      handleListRightClick,
      assertApiSupport,

      isShowListAdd,
      isMove,
      isShowListAddMultiple,
      isMoveMultiple,
      selectedAddMusicInfo,

      songDrag,
      handleSongPointerDown,

      isShowDownload,
      isShowDownloadMultiple,
      selectedDownloadMusicInfo,

      scrollToTop,

      isShowSearchBar,
      searchList,
      handleMusicSearchAction,

      list,
      playerInfo,

      saveListPosition,
      isShowSource,
      handleRestoreScroll,

      actionButtonsVisible,
      appSetting,

      isShowMusicToggleModal,
      selectedToggleMusicInfo,
      selectedToggleSource,
      toggleSource,

      handleCoverError,
      isLoading,
      loadError,
      retryList,
      getCoverKey,
      coverErrorSet,
      canOpenEntity,
      getSingerNames,
      openEntityDetail,
    }
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.list {
  overflow: hidden;
  height: 100%;
  flex: auto;
  display: flex;
  flex-flow: column nowrap;

  :global(.list-item) {
    &.active {
      color: var(--color-button-font);
    }
  }
  :global {
    .label-source {
      color: var(--color-primary);
      padding: 5px;
      font-size: .8em;
      line-height: 1.2;
      opacity: .75;
      display: inline-block;
    }
  }
}
.num {
  cursor: grab;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
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
.content {
  position: relative;
  min-height: 0;
  font-size: 14px;
  display: flex;
  flex-flow: column nowrap;
  flex: auto;
}

:global(body.playlist-song-dragging) {
  &, * {
    cursor: grabbing !important;
    user-select: none !important;
  }
}

.content :global([data-song-dragging]) {
  opacity: .4;
  background: var(--color-primary-background-hover);
}

.dragOverlay {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 3;
}

.dropLine {
  position: absolute;
  left: 4px;
  right: 12px;
  height: 2px;
  background: var(--color-primary);
  border-radius: 2px;

  &::before {
    content: '';
    position: absolute;
    top: -3px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: inherit;
  }
}

.dragCard {
  position: absolute;
  top: 0;
  left: 12px;
  max-width: calc(100% - 40px);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 14px;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-md);
  background: var(--color-surface-elevated);
  box-shadow: var(--shadow-popup);

  strong, span {
    .mixin-ellipsis-1();
  }

  span {
    font-size: 12px;
    color: var(--color-font-label);
  }

  &.invalidDrop {
    opacity: .5;
  }
}

.entityLinks {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
}

.entitySeparator {
  flex: none;
}

.entityLink {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-accent);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
    outline: none;
  }
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
