<template>
  <ul v-show="!loadStatus" ref="dom_lists_list" class="scroll" :class="$style.listsContent">
    <li
      v-for="(item, index) in list"
      :key="item.id" :class="[$style.listsItem, { [$style.active]: item.id == boardId }, { [$style.clicked]: rightClickItemIndex == index }]"
      :aria-label="item.name" @click="handleToggleList(item.id)" @contextmenu="handleRigthClick($event, index)"
    >
      <span :class="$style.listsLabel">
        <transition name="list-active">
          <svg-icon v-if="item.id == boardId" name="angle-right-solid" :class="$style.activeIcon" />
        </transition>
        {{ item.name }}
      </span>
    </li>
  </ul>
  <div
    v-if="loadStatus" :class="[$style.loadState, 'ui-state', { 'ui-state-error': loadStatus == 'error' }]"
    role="status" :aria-busy="loadStatus == 'loading'"
  >
    <span v-if="loadStatus == 'loading'" class="ui-spinner" />
    <p>{{ loadStatus == 'loading' ? $t('list__loading') : appSetting['common.showErrorDialog'] ? loadError : $t('list__load_failed') }}</p>
    <base-btn v-if="loadStatus == 'error'" class="ui-state-retry" min @click="loadBoards">{{ $t('reload') }}</base-btn>
  </div>
  <base-menu
    v-model="isShowMenu"
    :menus="menus"
    :xy="menuLocation"
    item-name="name"
    @menu-click="handleMenuClick"
  />
</template>

<script setup>
import { formatError } from '@common/utils/errorMessage'
import { appSetting } from '@renderer/store/setting'
import { watch, shallowReactive, ref } from '@common/utils/vueTools'
import { getBoardsList, setBoard } from '@renderer/store/leaderboard/action'
import { boards } from '@renderer/store/leaderboard/state'
import useMenu from './useMenu'
import { useRouter, useRoute } from '@common/utils/vueRouter'

const props = defineProps({
  source: {
    type: String,
    required: true,
  },
  boardId: {
    type: [String, undefined],
    default: undefined,
  },
})

const emit = defineEmits(['show-menu'])

const router = useRouter()
const route = useRoute()

const list = shallowReactive([])
const rightClickItemIndex = ref(-1)
const loadStatus = ref('')
const loadError = ref('')
let loadKey = 0

const handleToggleList = (id) => {
  void router.replace({
    path: route.path,
    query: {
      source: props.source,
      boardId: id,
    },
  })
}

const {
  menus,
  menuLocation,
  isShowMenu,
  showMenu,
  menuClick,
} = useMenu({ emit, list })

const handleRigthClick = (event, index) => {
  rightClickItemIndex.value = index
  showMenu(event, index)
}
const handleMenuClick = (action) => {
  if (rightClickItemIndex.value < 0) return
  let index = rightClickItemIndex.value
  rightClickItemIndex.value = -1
  menuClick(action, index, props.source)
}


const loadBoards = async() => {
  const source = props.source
  const key = ++loadKey
  loadStatus.value = 'loading'
  list.splice(0, list.length)
  try {
    let boardList = boards[source]
    if (boardList == null) setBoard(boardList = await getBoardsList(source), source)
    if (key != loadKey || source != props.source) return
    list.splice(0, list.length, ...boardList.list)
    loadStatus.value = ''
    if (!props.boardId && boardList.list.length) handleToggleList(boardList.list[0].id)
  } catch (error) {
    if (key != loadKey || source != props.source) return
    console.log(error)
    loadStatus.value = 'error'
    loadError.value = formatError(error, window.i18n.t('list__load_failed'), 'BOARDS_LOAD_FAILED')
  }
}

watch(() => props.source, () => {
  void loadBoards()
}, {
  immediate: true,
})

defineExpose({ hideMenu: handleMenuClick })

</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.listsContent {
  flex: auto;
  min-width: 0;
  overflow-y: scroll;
  // overflow-y: scroll !important;
  // border-right: 1px solid rgba(0, 0, 0, 0.12);
}
.loadState {
  flex: auto;
  min-height: 0;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  align-items: center;
  padding: 10px;
  text-align: center;
}
.listsItem {
  position: relative;
  transition: .3s ease;
  transition-property: color, background-color;
  background-color: transparent;
  &:hover:not(.active) {
    background-color: var(--color-primary-background-hover);
    cursor: pointer;
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
.listsLabel {
  display: block;
  height: 100%;
  padding: 0 10px;
  font-size: 13px;
  line-height: 36px;
  .mixin-ellipsis-1();
}


</style>
