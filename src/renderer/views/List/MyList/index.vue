<template>
  <div ref="dom_lists" :class="$style.lists">
    <div :class="$style.listHeader">
      <h2 :class="$style.listsTitle">{{ $t('my_list') }}</h2>
      <div :class="$style.headerBtns">
        <button :class="$style.listsAdd" :aria-label="$t('list_trash__title')" :title="$t('list_trash__title')" @click="isShowRecycleBin = true">
          <svg height="70%" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7m4-7v7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <button :class="$style.listsAdd" :aria-label="$t('lists__new_list_btn')" @click="isShowNewList = true">
          <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="70%" viewBox="0 0 24 24" space="preserve">
            <use xlink:href="#icon-list-add" />
          </svg>
        </button>
        <button :class="$style.listsAdd" :aria-label="$t('list_update_modal__title')" @click="isShowListUpdateModal = true">
          <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" style="transform: rotate(45deg);" height="70%" viewBox="0 0 24 24" space="preserve">
            <use xlink:href="#icon-refresh" />
          </svg>
        </button>
      </div>
    </div>
    <ul ref="dom_lists_list" class="scroll" :class="[$style.listsContent, { [$style.sortable]: isModDown || isDragging }]">
      <li
        class="default-list" :class="[$style.listsItem, {[$style.active]: defaultList.id == listId}, {[$style.clicked]: rightClickItemIndex == -2}, {[$style.fetching]: fetchingListStatus[defaultList.id]}]"
        :aria-label="$t(defaultList.name)" :aria-selected="defaultList.id == listId"
        @contextmenu="handleListsItemRigthClick($event, -2)" @click="handleListToggle(defaultList.id)"
      >
        <span :class="$style.listsLabel">
          <transition name="list-active">
            <svg-icon v-if="defaultList.id == listId" name="angle-right-solid" :class="$style.activeIcon" />
          </transition>
          {{ $t(defaultList.name) }}
        </span>
      </li>
      <li
        class="default-list" :class="[$style.listsItem, {[$style.active]: LIST_IDS.HISTORY == listId}]"
        :aria-label="$t('history__title')" :aria-selected="LIST_IDS.HISTORY == listId"
        @click="handleListToggle(LIST_IDS.HISTORY)"
      >
        <span :class="$style.listsLabel">
          <transition name="list-active">
            <svg-icon v-if="LIST_IDS.HISTORY == listId" name="angle-right-solid" :class="$style.activeIcon" />
          </transition>
          {{ $t('history__title') }}
        </span>
      </li>
      <li
        class="default-list" :class="[$style.listsItem, {[$style.active]: loveList.id == listId}, {[$style.clicked]: rightClickItemIndex == -1}, {[$style.fetching]: fetchingListStatus[loveList.id]}]"
        :aria-label="$t(loveList.name)" :aria-selected="loveList.id == listId"
        @contextmenu="handleListsItemRigthClick($event, -1)" @click="handleListToggle(loveList.id)"
      >
        <span :class="$style.listsLabel">
          <transition name="list-active">
            <svg-icon v-if="loveList.id == listId" name="angle-right-solid" :class="$style.activeIcon" />
          </transition>
          {{ $t(loveList.name) }}
        </span>
      </li>
      <template v-for="group in listGroups" :key="group.id">
        <li v-if="group.name" :class="$style.folderHeader">
          <button type="button" :aria-expanded="!!expandedFolders[group.id]" @click="handleFolderToggle(group.id)">
            <svg-icon name="angle-right-solid" :class="[$style.folderArrow, { [$style.folderExpanded]: expandedFolders[group.id] }]" />
            <svg :class="$style.folderIcon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 5h7l2 2h9v13H3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
            </svg>
            <span :class="$style.folderName">{{ group.name }}</span>
            <span :class="$style.folderCount">{{ group.lists.length }}</span>
          </button>
        </li>
        <template v-if="!group.name || expandedFolders[group.id]">
          <li
            v-for="{ item, index, name } in group.lists"
            :key="item.id" class="user-list"
            :class="[$style.listsItem, {[$style.folderListItem]: group.name}, {[$style.active]: item.id == listId}, {[$style.clicked]: rightClickItemIndex == index}, {[$style.fetching]: fetchingListStatus[item.id]}]"
            :data-id="item.id" :data-index="index" :data-group="group.id" :aria-label="item.name" :aria-selected="item.id == listId" @contextmenu="handleListsItemRigthClick($event, index)"
          >
            <span :class="$style.listsLabel" @click="handleListToggle(item.id)">
              <transition name="list-active">
                <svg-icon v-if="item.id == listId" name="angle-right-solid" :class="$style.activeIcon" />
              </transition>
              {{ name }}
            </span>
            <base-input
              :class="$style.listsInput" type="text" :value="item.name"
              :placeholder="item.name" @keyup.enter="handleSaveListName(index, $event)" @blur="handleSaveListName(index, $event)"
            />
          </li>
          <li v-if="group.name && !group.lists.length" :class="$style.folderEmpty">{{ $t('lists__folder_empty') }}</li>
        </template>
        <transition v-if="group.id === 'local'" enter-active-class="animated-fast slideInLeft" leave-active-class="animated-fast fadeOut" @after-leave="isNewListLeave = false" @after-enter="focusNewListInput">
          <li v-if="isShowNewList" :class="[$style.listsItem, $style.listsNew, {[$style.newLeave]: isNewListLeave}]">
            <base-input
              :class="$style.listsInput" type="text" :placeholder="$t('lists__new_list_input')"
              @keyup.enter="handleCreateList" @blur="handleCreateList"
            />
          </li>
        </transition>
      </template>
    </ul>
    <base-menu v-model="isShowMenu" :menus="menus" :xy="menuLocation" item-name="name" @menu-click="handleMenuClick" />
    <DuplicateMusicModal v-model:visible="isShowDuplicateMusicModal" :list-info="duplicateListInfo" />
    <ListSortModal v-model:visible="isShowListSortModal" :list-info="sortListInfo" />
    <ListUpdateModal v-model:visible="isShowListUpdateModal" />
    <RecycleBinModal v-model:visible="isShowRecycleBin" />
    <PlaylistTagsModal v-model:visible="isShowTagsModal" :list-info="tagsListInfo" />
  </div>
</template>

<script>
import { openUrl } from '@common/utils/electron'

import musicSdk from '@renderer/utils/musicSdk'
import DuplicateMusicModal from './components/DuplicateMusicModal.vue'
import ListSortModal from './components/ListSortModal.vue'
import ListUpdateModal from './components/ListUpdateModal.vue'
import RecycleBinModal from './components/RecycleBinModal.vue'
import PlaylistTagsModal from './components/PlaylistTagsModal.vue'

import { defaultList, loveList, userLists, fetchingListStatus } from '@renderer/store/list/state'
import { removeUserList } from '@renderer/store/list/action'

import { computed, ref, watch, useCssModule } from '@common/utils/vueTools'
import { useRouter } from '@common/utils/vueRouter'
import { LIST_IDS } from '@common/constants'

import { dialog } from '@renderer/plugins/Dialog'

import { saveListPrevSelectId } from '@renderer/utils/data'

import { useI18n } from '@renderer/plugins/i18n'


import useShare from './useShare'
import useMenu from './useMenu'
import useListUpdate from './useListUpdate'
import useSort from './useSort'
import useDarg from './useDarg'
import useEditList from './useEditList'
import useListScroll from './useListScroll'
import useDuplicate from './useDuplicate'
import useFolders from './useFolders'

export default {
  name: 'MyLists',
  components: {
    PlaylistTagsModal,
    RecycleBinModal,
    DuplicateMusicModal,
    ListSortModal,
    ListUpdateModal,
  },
  props: {
    listId: {
      type: String,
      required: true,
    },
  },
  emits: ['show-menu'],
  setup(props, { emit }) {
    const router = useRouter()
    const t = useI18n()

    const dom_lists_list = ref(null)
    const rightClickItemIndex = ref(-10)
    const styles = useCssModule()
    const { listGroups, expandedFolders, toggleFolder } = useFolders({ listId: computed(() => props.listId) })

    const { handleImportList, handleExportList } = useShare()
    const { isShowListUpdateModal, handleUpdateSourceList } = useListUpdate()
    const { isShowListSortModal, sortListInfo, handleSortList } = useSort()
    const { isShowDuplicateMusicModal, duplicateListInfo, handleDuplicateList } = useDuplicate()
    const isShowTagsModal = ref(false)
    const tagsListInfo = ref(null)
    const handleEditTags = (listInfo) => {
      tagsListInfo.value = listInfo
      isShowTagsModal.value = true
    }
    const { handleRename, handleSaveListName, isShowNewList, isNewListLeave, handleCreateList } = useEditList({ dom_lists_list })
    const handleFolderToggle = async(source) => {
      await handleSaveListName()
      toggleFolder(source)
    }
    const focusNewListInput = () => {
      dom_lists_list.value?.querySelector(`.${styles.listsNew} input`)?.focus()
    }
    useListScroll({ dom_lists_list })

    const handleOpenSourceDetailPage = async(listInfo) => {
      const { source, sourceListId } = listInfo
      if (!sourceListId) return
      let url
      if (/board__/.test(sourceListId)) {
        const id = sourceListId.replace(/board__/, '')
        url = musicSdk[source].leaderboard.getDetailPageUrl(id)
      } else if (musicSdk[source]?.songList?.getDetailPageUrl) {
        url = await musicSdk[source].songList.getDetailPageUrl(sourceListId)
      }
      if (!url) return
      void openUrl(url)
    }

    const handleRemove = (listInfo) => {
      void dialog.confirm({
        message: t('lists__remove_tip', { name: listInfo.name }),
        confirmButtonText: t('lists__remove_tip_button'),
      }).then(async isRemove => {
        if (!isRemove) return
        if (!await removeUserList([listInfo.id])) return
        if (props.listId == listInfo.id) {
          handleListToggle(LIST_IDS.DEFAULT)
        }
      })
    }

    const {
      menus,
      menuLocation,
      isShowMenu,
      showMenu,
      menuClick,
    } = useMenu({
      emit,

      handleImportList,
      handleExportList,
      handleUpdateSourceList,
      handleOpenSourceDetailPage,
      handleSortList,
      handleDuplicateList,
      handleRename,
      handleRemove,
      handleEditTags,
    })

    const handleListsItemRigthClick = (event, index) => {
      rightClickItemIndex.value = index
      showMenu(event, index)
    }

    const handleListToggle = (id) => {
      if (id == props.listId) return
      router.replace({
        path: '/list',
        query: { id },
      }).catch(_ => _)
    }

    const handleMenuClick = (action) => {
      if (rightClickItemIndex.value < -2) return
      let index = rightClickItemIndex.value
      rightClickItemIndex.value = -10
      menuClick(action, index)
    }

    const { isModDown, isDragging } = useDarg({ dom_lists_list, handleMenuClick, handleSaveListName })


    watch(() => props.listId, (listId) => {
      saveListPrevSelectId(listId)
    })

    watch(() => userLists, (lists) => {
      if (props.listId === LIST_IDS.DEFAULT || props.listId === LIST_IDS.HISTORY || props.listId === loveList.id) return
      if (lists.some(l => l.id == props.listId)) return
      void router.replace({
        path: '/list',
        query: {
          id: LIST_IDS.DEFAULT,
        },
      })
    })

    return {
      isShowRecycleBin: ref(false),
      isShowTagsModal,
      tagsListInfo,
      LIST_IDS,
      rightClickItemIndex,
      defaultList,
      loveList,
      userLists,
      listGroups,
      expandedFolders,
      handleFolderToggle,
      focusNewListInput,
      fetchingListStatus,
      dom_lists_list,
      isShowListUpdateModal,
      isShowListSortModal,
      sortListInfo,
      isShowDuplicateMusicModal,
      duplicateListInfo,
      handleSaveListName,
      isShowNewList,
      isNewListLeave,
      handleCreateList,
      handleListsItemRigthClick,
      isShowMenu,
      handleMenuClick,
      menus,
      menuLocation,
      handleListToggle,
      isModDown,
      isDragging,
      hideMenu: handleMenuClick,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

@lists-item-height: 36px;
.lists {
  flex: auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-flow: column nowrap;
}
.listHeader {
  box-sizing: border-box;
  position: relative;
  display: flex;
  flex-flow: row nowrap;
  padding-right: var(--panel-sidebar-rail, 0px);
  border-bottom: var(--color-list-header-border-bottom);
  &:hover {
    .listsAdd {
      opacity: 1;
    }
  }
}
.listsTitle {
  flex: auto;
  font-size: 12px;
  line-height: 38px;
  padding: 0 10px;
  .mixin-ellipsis-1();
}
.headerBtns {
  flex: none;
  display: flex;
}
.listsAdd {
  // position: absolute;
  // right: 0;
  margin-top: 6px;
  background: none;
  height: 30px;
  border: none;
  outline: none;
  border-radius: @radius-border;
  cursor: pointer;
  opacity: 1;
  transition: opacity @transition-normal;
  color: var(--color-button-font);
  svg {
    vertical-align: bottom;
  }
  &:active {
    opacity: 1 !important;
  }
  &:hover {
    opacity: 1 !important;
  }
  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}
.listsContent {
  flex: auto;
  min-width: 0;
  overflow-y: scroll !important;
  // border-right: 1px solid rgba(0, 0, 0, 0.12);

  &.sortable {
    .listsItem {
      &:hover, &.active, &.selected, &.clicked {
        background-color: transparent !important;
      }

      &.chosenItem, &.dragingItem {
        background-color: var(--color-primary-background-hover) !important;
        cursor: grabbing !important;
        box-shadow: inset 3px 0 var(--color-primary);
      }

      &.dragingItem {
        opacity: .35;
      }
    }
  }
}
.listsItem {
  position: relative;
  transition: .3s ease;
  transition-property: color, background-color, opacity;
  background-color: transparent;
  &:not(.active) {
    &:hover {
      background-color: var(--color-primary-background-hover);
      cursor: pointer;
    }
  }
  &.active {
    // background-color:
    color: var(--color-primary);
  }
  &.selected {
    background-color: var(--color-primary-font-active);
  }
  &.clicked {
    background-color: var(--color-primary-background-hover);
  }
  &.fetching {
    opacity: .5;
  }
  &.editing {
    padding: 0 10px;
    background-color: var(--color-primary-background-hover);
    .listsLabel {
      display: none;
    }
    .listsInput {
      display: block;
    }
  }
}
.activeIcon {
  height: .9em;
  width: .9em;
  margin-left: -0.45em;
  vertical-align: -0.05em;
}
.folderHeader {
  button {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    height: @lists-item-height;
    padding: 0 10px;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    text-align: left;
    transition: background-color var(--duration-fast) var(--ease-standard);
    &:hover, &:focus-visible {
      background-color: var(--color-primary-background-hover);
    }
    &:active { background-color: var(--color-primary-background-active); }
  }
}
.folderArrow {
  flex: none;
  width: 8px;
  height: 8px;
  transition: transform var(--duration-fast) var(--ease-standard);
  &.folderExpanded {
    transform: rotate(90deg);
  }
}
.folderIcon {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--color-primary);
}
.folderName {
  flex: auto;
  font-size: 12px;
  .mixin-ellipsis-1();
}
.folderCount {
  flex: none;
  color: var(--color-font-label);
  font-size: 11px;
}
.folderListItem {
  .listsLabel {
    padding-left: 28px;
  }
  &.editing {
    padding-left: 28px;
  }
}
.folderEmpty {
  padding: 8px 10px 8px 28px;
  color: var(--color-font-label);
  font-size: 11px;
  line-height: 1.5;
}
.listsLabel {
  display: block;
  height: @lists-item-height;
  padding: 0 10px;
  font-size: 13px;
  line-height: @lists-item-height;
  .mixin-ellipsis-1();
}
.listsInput {
  width: 100%;
  height: @lists-item-height;
  // border: none;
  padding: 0;
  // padding-bottom: 1px;
  line-height: @lists-item-height;
  background: none !important;
  border-radius: 0;
  // outline: none;
  font-size: 13px;
  display: none;
  // font-family: inherit;
}

.listsNew {
  padding: 0 10px;
  background-color: var(--color-primary-background-hover) !important;
  .listsInput {
    display: block;
  }
}
.newLeave {
  margin-top: -@lists-item-height;
  z-index: -1;
}


</style>
