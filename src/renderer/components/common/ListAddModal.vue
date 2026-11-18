<template>
  <material-modal :show="show" :bg-close="bgClose" :teleport="modalTeleport" max-width="70%" min-width="200px" @close="handleClose" @after-leave="handleAfterLeave">
    <main :class="$style.main">
      <h2>{{ $t('list_add__' + (isMove ? 'title_first_move' : 'title_first_add')) }}&nbsp;<span :class="$style.name">{{ currentMusicInfo.name }}</span>&nbsp;{{ $t('list_add__title_last') }}</h2>
      <div class="scroll" :class="$style.btnContent">
        <base-btn v-for="(item, index) in lists" :key="item.id" :class="$style.btn" :aria-label="$t('list_add__btn_title', { name: item.name })" :disabled="item.isExist || isSaving" @click="handleClick(index)">{{ item.name }}</base-btn>
        <base-btn :class="[$style.btn, $style.newList, isEditing ? $style.editing : null]" :aria-label="$t('lists__new_list_btn')" :disabled="isSaving" @click="handleEditing($event)">
          <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 42 42" space="preserve">
            <use xlink:href="#icon-addTo" />
          </svg>
          <base-input :class="$style.newListInput" :value="newListName" :placeholder="$t('lists__new_list_input')" @keyup.enter="handleSaveList($event)" @blur="handleSaveList($event)" />
        </base-btn>
        <span v-for="i in spaceNum" :key="i" :class="$style.btn" />
      </div>
    </main>
  </material-modal>
</template>

<script>
// import { mapMutations } from 'vuex'
import { watch, ref, onBeforeUnmount } from '@common/utils/vueTools'
import { defaultList, loveList, userLists } from '@renderer/store/list/state'
import { addListMusics, moveListMusics, createUserList, getMusicExistListIds } from '@renderer/store/list/action'
import { listChangeRevision } from '@renderer/store/list/listManage'
import { isShowPlayerDetail } from '@renderer/store/player/state'
import useKeyDown from '@renderer/utils/compositions/useKeyDown'
import { useI18n } from '@root/lang'
import { dialog } from '@renderer/plugins/Dialog'
import { formatError } from '@common/utils/errorMessage'

export default {
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    musicInfo: {
      type: [Object, null],
      required: true,
    },
    bgClose: {
      type: Boolean,
      default: true,
    },
    excludeListId: {
      type: Array,
      default() {
        return []
      },
    },
    // listName: {
    //   type: String,
    //   default: '',
    // },
    fromListId: {
      type: String,
      default: null,
    },
    isMove: {
      type: Boolean,
      default: false,
    },
    teleport: {
      type: String,
      default: '#root',
    },
  },
  emits: ['update:show'],
  setup(props, { emit }) {
    const keyModDown = useKeyDown('mod')
    const t = useI18n()
    const lists = ref([])

    const currentMusicInfo = ref({})
    const modalTeleport = ref(props.teleport)
    // Every lookup gets a token: a reply for an older song or a closed popup
    // must not paint the lists of the current one.
    let existRequestId = 0

    const musicInfoIdOf = info => info ? ('progress' in info ? info.metadata.musicInfo.id : info.id) : null

    // Root-level popups inherit the library palette from #root. While the
    // playback detail is open its adaptive palette lives on [data-player-detail],
    // so a #root teleport would keep the plain theme colors. Follow the scope
    // the popup is actually drawn on instead.
    const getTeleportTarget = () => {
      if (props.teleport !== '#root') return props.teleport
      const detail = document.querySelector('[data-player-detail]')
      return detail && detail.getAttribute('aria-hidden') !== 'true' ? '[data-player-detail]' : '#root'
    }

    const checkMusicExist = (musicInfo) => {
      if (!musicInfo.id) return
      const request = ++existRequestId
      void getMusicExistListIds(musicInfo.id).then(ids => {
        if (request !== existRequestId || currentMusicInfo.value.id !== musicInfo.id) return
        for (const list of lists.value) list.isExist = ids.includes(list.id)
      }).catch(error => {
        if (request === existRequestId) console.warn('Failed to check playlist membership:', error)
      })
    }

    let stopWatchUserList = null

    const getList = () => {
      lists.value = [
        { ...defaultList, name: t(defaultList.name) },
        { ...loveList, name: t(loveList.name) },
        ...userLists,
      ].filter(l => !props.excludeListId.includes(l.id)).map(l => ({ ...l, isExist: false }))
      checkMusicExist(currentMusicInfo.value)
    }

    watch(() => props.show, show => {
      if (!show) {
        existRequestId++
        if (stopWatchUserList) {
          stopWatchUserList()
          stopWatchUserList = null
        }
        return
      }
      if (!props.musicInfo) return lists.value = []

      modalTeleport.value = getTeleportTarget()
      currentMusicInfo.value = 'progress' in props.musicInfo ? props.musicInfo.metadata.musicInfo : props.musicInfo

      getList()

      stopWatchUserList = watch(userLists, getList)
    })

    watch(listChangeRevision, () => {
      if (props.show) checkMusicExist(currentMusicInfo.value)
    })

    // Do not keep offering the old song after playback moved on.
    watch(() => musicInfoIdOf(props.musicInfo), id => {
      if (props.show && id !== currentMusicInfo.value.id) emit('update:show', false)
    })

    // The detail page owns the teleport target while it is open. If it closes
    // programmatically (shortcut, deeplink, another entry), a popup left inside
    // the now hidden container would be unreachable; close it instead.
    watch(isShowPlayerDetail, open => {
      if (open || !props.show || modalTeleport.value !== '[data-player-detail]') return
      existRequestId++
      emit('update:show', false)
    })

    onBeforeUnmount(() => {
      existRequestId++
      if (stopWatchUserList) {
        stopWatchUserList()
        stopWatchUserList = null
      }
    })

    return {
      keyModDown,
      lists,
      checkMusicExist,
      currentMusicInfo,
      modalTeleport,
    }
  },
  data() {
    return {
      isEditing: false,
      isSaving: false,
      newListName: '',
      rowNum: 3,
    }
  },
  computed: {
    spaceNum() {
      return this.lists.length < 2 ? 0 : (this.rowNum - this.lists.length % this.rowNum - 1)
    },
  },
  mounted() {
    window.addEventListener('resize', this.handleResize)
    this.handleResize()
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize)
  },
  methods: {
    handleResize() {
      const width = window.innerWidth
      this.rowNum = width < 1920
        ? 3
        : width < 2560
          ? 4
          : width < 3840 ? 5 : 6
    },
    async handleClick(index) {
      const target = this.lists[index]
      if (this.isSaving || !target || target.isExist) return
      const keepOpen = this.keyModDown && !this.isMove
      this.isSaving = true
      try {
        if (this.isMove) await moveListMusics(this.fromListId, target.id, [this.currentMusicInfo])
        else await addListMusics(target.id, [this.currentMusicInfo])

        target.isExist = true
        if (keepOpen) return
        this.$nextTick(() => {
          this.handleClose()
        })
      } catch (cause) {
        void dialog.error(formatError(cause, '', this.isMove ? 'LIST_MUSIC_MOVE_FAILED' : 'LIST_MUSIC_ADD_FAILED'))
      } finally {
        this.isSaving = false
      }
    },
    handleClose() {
      this.$emit('update:show', false)
    },
    handleAfterLeave() {
      // A rapid reopen may still be waiting for the leave animation; keep the
      // scope that the new open already resolved.
      if (this.show) return
      // Re-resolve the scope on the next open; the detail page may be gone by then.
      this.modalTeleport = this.teleport
    },
    handleEditing(event) {
      if (this.isEditing) return
      // if (!this.newListName) this.newListName = this.listName
      this.isEditing = true
      this.$nextTick(() => event.currentTarget.querySelector('.' + this.$style.newListInput).focus())
    },
    async handleSaveList(event) {
      if (this.isSaving) return
      let name = event.target.value
      this.newListName = event.target.value = ''
      this.isEditing = false
      if (!name || (
        userLists.some(l => l.name == name) && !(await dialog.confirm(window.i18n.t('list_duplicate_tip'))))
      ) return
      this.isSaving = true
      try {
        await createUserList({ name })
      } catch (cause) {
        void dialog.error(formatError(cause, '', 'LIST_CREATE_FAILED'))
      } finally {
        this.isSaving = false
      }
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  // padding: 15px 0;
  // max-width: 70%;
  // min-width: 200px;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  min-height: 0;
  // max-height: 100%;
  // overflow: hidden;
  h2 {
    font-size: 13px;
    color: var(--color-font);
    line-height: 1.3;
    text-align: center;
    padding: 15px;
  }
}

.name {
  color: var(--color-primary);
}

.btnContent {
  flex: auto;
  max-height: 100%;
  padding-right: 15px;
  display: flex;
  flex-flow: row wrap;
  justify-content: space-evenly;
}

@item-width: (100% / 3);
.btn {
  position: relative;
  box-sizing: border-box;
  margin-left: 15px;
  margin-bottom: 15px;
  height: 36px;
  line-height: 36px;
  padding: 0 10px !important;
  width: calc(@item-width - 15px);
  min-width: 160px;
  .mixin-ellipsis-1();
}

.newList {
  border: 1px dashed var(--color-primary-font-hover);
  // background-color: var(--color-main-background);
  color: var(--color-primary-font-hover);
  opacity: .7;

  svg {
    height: 18px;
    margin-top: 9px;
  }

  &.editing {
    opacity: 1;

    svg {
      display: none;
    }
    .newListInput {
      display: block;
    }
  }
}
.newListInput {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 34px;
  line-height: 34px;
  background: none !important;
  font-size: 14px;
  text-align: center;
  font-family: inherit;
  box-sizing: border-box;
  padding: 0 10px;
  border-radius: 0;
  display: none;
}

@item-width2: (100% / 4);
@media (min-width: 1920px){
  .btn {
    width: calc(@item-width2 - 15px);
  }
}
@item-width3: (100% / 5);
@media (min-width: 2560px){
  .btn {
    width: calc(@item-width3 - 15px);
  }
}
@item-width4: (100% / 6);
@media (min-width: 3840px){
  .btn {
    width: calc(@item-width4 - 15px);
  }
}

</style>
