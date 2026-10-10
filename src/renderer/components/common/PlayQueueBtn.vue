<template>
  <div ref="dom_btn" :class="$style.content" @click.stop="toggleShow">
    <button :class="[$style.btn, { [$style.btnActive]: isShow }]" :aria-label="$t('player__play_list')" :aria-expanded="isShow">
      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="100%" height="100%" viewBox="0 0 24 24" space="preserve">
        <use xlink:href="#icon-playlist" />
      </svg>
    </button>
    <teleport to="#root">
      <transition name="queue-panel">
        <div v-if="isShow" :class="$style.popup" :style="popupStyle" data-play-queue @click.stop>
        <div :class="$style.header">
          <div :class="$style.titleContent">
            <span :class="$style.title">{{ $t('player__play_list') }}</span>
            <span :class="$style.count">{{ playQueueList.length }}</span>
          </div>
          <div :class="$style.headerActions">
          <button :class="$style.clearBtn" data-motion-button :disabled="!playQueueList.length" @click="openSaveQueue">{{ $t('player__queue_save') }}</button>
          <button :class="$style.clearBtn" data-motion-button :disabled="!playQueueList.length" :aria-label="$t('player__play_list_clear')" @click="handleClear">
            {{ $t('player__play_list_clear') }}
          </button>
          </div>
        </div>
        <div :class="$style.listContent">
          <base-virtualized-list
            v-if="queueList.length"
            ref="listRef"
            v-slot="{ item, index }"
            :list="queueList"
            key-name="key"
            :item-height="rowHeight"
            :overscan="10"
            container-class="scroll"
            content-class="list"
          >
            <div
              :class="[$style.item, { [$style.active]: isCurrentItem(item, index), [$style.dropBefore]: dropIndex === index && !dropAfter, [$style.dropAfter]: dropIndex === index && dropAfter }]"
              :data-queue-index="index"
              :aria-label="getMusicName(item) + ' - ' + getMusicSinger(item)"
              @click="handlePlay(index)"
              @dragover.prevent="dragOver($event, index)"
              @drop.prevent.stop="drop($event, index)"
            >
              <button :ref="element => restoreQueueFocus(element, item, index)" :class="$style.dragHandle" draggable="true" :aria-label="$t('player__queue_move')" :title="$t('player__queue_move')" @click.stop @dragstart="dragStart($event, index)" @dragend="dragEnd" @keydown.alt.up.prevent.stop="moveWithKeyboard(index, -1)" @keydown.alt.down.prevent.stop="moveWithKeyboard(index, 1)">⋮⋮</button>
              <div :class="$style.itemNum">
                <span v-if="isCurrentItem(item, index)" class="playing-equalizer" :class="{ paused: !isPlay }" aria-hidden="true"><span /><span /><span /></span>
                <span v-else>{{ index + 1 }}</span>
              </div>
              <div :class="$style.itemImg">
                <svg v-if="imgErrorSet.has(item.key)" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="60%" height="60%" viewBox="0 0 24 24" space="preserve">
                  <use xlink:href="#icon-music" />
                </svg>
                <common-cover-image v-else :music-info="getMusicInfo(item)" :size="rowHeight" :alt="getMusicName(item)" @error="handleImgError(item.key)" />
              </div>
              <div :class="$style.itemInfo">
                <div :class="$style.itemName">{{ getMusicName(item) }}</div>
                <div :class="$style.itemSinger">
                  <template v-if="canOpenEntity(getMusicInfo(item)) && getSingerNames(getMusicInfo(item)).length">
                    <template v-for="(singer, singerIndex) in getSingerNames(getMusicInfo(item))" :key="`${singer}__${singerIndex}`">
                      <span v-if="singerIndex">、</span>
                      <button :class="$style.entityLink" type="button" @click.stop="handleOpenSinger(item, singer)">{{ singer }}</button>
                    </template>
                  </template>
                  <template v-else>{{ getMusicSinger(item) }}</template>
                </div>
              </div>
              <button :class="$style.removeBtn" :aria-label="$t('player__play_list_remove')" @click.stop="handleRemove(index)">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="100%" height="100%" viewBox="0 0 24 24" space="preserve">
                  <use xlink:href="#icon-close" />
                </svg>
              </button>
            </div>
          </base-virtualized-list>
          <div v-else :class="[$style.empty, 'ui-state']" role="status">
            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" space="preserve">
              <use xlink:href="#icon-playlist" />
            </svg>
            <span>{{ $t('player__play_list_empty') }}</span>
          </div>
        </div>
        </div>
      </transition>
    </teleport>
    <common-save-queue-modal v-model:show="showSaveQueue" :list="saveQueueItems" />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from '@common/utils/vueTools'
import { windowFontSize } from '@renderer/store'
import { isPlay, playQueueList, playQueueRevision, playMusicInfo, playInfo } from '@renderer/store/player/state'
import { removePlayQueue, movePlayQueue, clearPlayQueue, updatePlayIndex, setPlayMusicInfo } from '@renderer/store/player/action'
import { playQueueById, stop } from '@renderer/core/player'
import useEntityDetailNavigation from '@renderer/utils/compositions/useEntityDetailNavigation'

const basePanelWidth = 400
const maxVisibleRows = 9

const uiFontSize = windowFontSize
const rowHeight = computed(() => Math.ceil(uiFontSize.value * 3))
const headerHeight = computed(() => Math.ceil(uiFontSize.value * 3))

const dom_btn = ref(null)
const listRef = ref(null)
const isShow = ref(false)
const showSaveQueue = ref(false)
const saveQueueItems = ref([])
const openSaveQueue = () => {
  saveQueueItems.value = playQueueList.map(item => getMusicInfo(item))
  handleDocumentClick()
  showSaveQueue.value = true
}
const dropIndex = ref(-1)
const dropAfter = ref(false)
let draggedItem = null
let dragRevision = -1
let scrollFrame = 0
let pointerY = 0
const dragEnd = () => {
  draggedItem = null
  dropIndex.value = -1
  cancelAnimationFrame(scrollFrame)
  scrollFrame = 0
  document.removeEventListener('dragend', dragEnd)
  document.removeEventListener('drop', dragEnd)
  window.removeEventListener('blur', dragEnd)
}
const dragStart = (event, index) => {
  draggedItem = playQueueList[index]
  dragRevision = playQueueRevision.value
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(index))
  document.addEventListener('dragend', dragEnd)
  document.addEventListener('drop', dragEnd)
  window.addEventListener('blur', dragEnd)
}
const dragOver = (event, index) => {
  if (!draggedItem || dragRevision !== playQueueRevision.value) { dragEnd(); return }
  dropIndex.value = index
  const targetRect = event.currentTarget.getBoundingClientRect()
  dropAfter.value = event.clientY > targetRect.top + targetRect.height / 2
  pointerY = event.clientY
  event.dataTransfer.dropEffect = 'move'
  if (scrollFrame) return
  const scroll = () => {
    const el = listRef.value?.$el
    if (!draggedItem || !el) return
    const rect = el.getBoundingClientRect()
    if (pointerY >= rect.top && pointerY < rect.top + 35) el.scrollTop -= 8
    else if (pointerY <= rect.bottom && pointerY > rect.bottom - 35) el.scrollTop += 8
    scrollFrame = requestAnimationFrame(scroll)
  }
  scrollFrame = requestAnimationFrame(scroll)
}
const drop = (event, index) => {
  if (draggedItem && dragRevision === playQueueRevision.value) {
    const from = playQueueList.indexOf(draggedItem)
    const rect = event.currentTarget.getBoundingClientRect()
    const after = event.clientY > rect.top + rect.height / 2
    const to = Math.max(0, Math.min(playQueueList.length - 1, index + Number(after) - Number(from < index + Number(after))))
    movePlayQueue(from, to)
  }
  dragEnd()
}
let pendingFocus = null
const restoreQueueFocus = (element, item, index) => {
  // Template refs run after the virtual list has committed its recycled rows.
  if (!element || pendingFocus !== item.key || queueKeys.get(playQueueList[index]) !== item.key) return
  element.focus()
  pendingFocus = null
}
const moveWithKeyboard = (index, direction) => {
  if (index + direction < 0 || index + direction >= playQueueList.length) return
  const item = playQueueList[index]
  pendingFocus = queueKeys.get(item)
  movePlayQueue(index, index + direction)
}
const { canOpenEntity, getSingerNames, openEntityDetail } = useEntityDetailNavigation()

const popupStyle = reactive({
  left: '0px',
  bottom: '0px',
  width: basePanelWidth + 'px',
  height: '480px',
})

const queueKeys = new WeakMap()
let queueKey = 0
const queueList = computed(() => playQueueList.map(item => {
  if (!queueKeys.has(item)) queueKeys.set(item, ++queueKey)
  return { key: queueKeys.get(item), musicInfo: item.musicInfo, listId: item.listId }
}))

const getMusicInfo = (item) => {
  const info = item.musicInfo
  return 'progress' in info ? info.metadata.musicInfo : info
}
const getMusicName = (item) => getMusicInfo(item).name
const getMusicSinger = (item) => getMusicInfo(item).singer
const isCurrentItem = (item, index) => playInfo.playerPlayIndex === index && playMusicInfo.musicInfo?.id == item.musicInfo.id

const imgErrorSet = reactive(new Set())

const handleImgError = (key) => {
  imgErrorSet.add(key)
}

const currentQueueIndex = () => {
  const id = playMusicInfo.musicInfo?.id
  if (!id) return -1
  if (playQueueList[playInfo.playerPlayIndex]?.musicInfo.id === id) return playInfo.playerPlayIndex
  return playQueueList.findIndex(item => item.musicInfo.id == id)
}

// 当前歌曲不在可视范围内时，自动滚动播放列表到对应位置
const scrollToCurrent = () => {
  const index = currentQueueIndex()
  if (index < 0 || !listRef.value) return
  const el = listRef.value.$el
  if (!el?.clientHeight) return
  const top = index * rowHeight.value
  const bottom = top + rowHeight.value
  if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight) {
    listRef.value.scrollToIndex(index, -Math.round((el.clientHeight - rowHeight.value) / 2))
  }
}

watch(() => playMusicInfo.musicInfo?.id, () => {
  if (isShow.value) scrollToCurrent()
})

const updatePosition = () => {
  if (!dom_btn.value) return
  const rect = dom_btn.value.getBoundingClientRect()
  const width = Math.min(Math.round(basePanelWidth * uiFontSize.value / 16), window.innerWidth - 16)
  const bodyHeight = playQueueList.length
    ? rowHeight.value * Math.min(playQueueList.length, maxVisibleRows)
    : rowHeight.value * 2
  const height = Math.min(headerHeight.value + bodyHeight, Math.max(0, rect.top - 16))
  const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)
  popupStyle.left = left + 'px'
  popupStyle.bottom = (window.innerHeight - rect.top + 8) + 'px'
  popupStyle.width = width + 'px'
  popupStyle.height = height + 'px'
}

watch([() => playQueueList.length, rowHeight], () => {
  if (!isShow.value) return
  void nextTick(() => {
    updatePosition()
    scrollToCurrent()
  })
})

const handleDocumentClick = () => {
  window.clearTimeout(frameFocusTimer)
  frameFocusTimer = 0
  pendingFocus = null
  dragEnd()
  isShow.value = false
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('blur', handleWindowBlur)
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('keydown', handleDocumentKeydown)
}
const handleDocumentKeydown = (event) => {
  if (event.key == 'Escape') handleDocumentClick()
}

let frameFocusTimer = 0
const handleWindowBlur = () => {
  // Clicks inside lyric iframes do not bubble to the host document. Wait for
  // Chromium to update activeElement, and close only when focus enters a frame.
  window.clearTimeout(frameFocusTimer)
  frameFocusTimer = window.setTimeout(() => {
    frameFocusTimer = 0
    if (isShow.value && document.activeElement instanceof HTMLIFrameElement) handleDocumentClick()
  }, 0)
}

const handleOpenSinger = (item, singer) => {
  handleDocumentClick()
  openEntityDetail(getMusicInfo(item), 'singer', singer)
}

const toggleShow = () => {
  if (isShow.value) {
    handleDocumentClick()
  } else {
    isShow.value = true
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('blur', handleWindowBlur)
    document.addEventListener('click', handleDocumentClick)
    document.addEventListener('keydown', handleDocumentKeydown)
    void nextTick(() => {
      scrollToCurrent()
    })
  }
}

const handlePlay = (index) => {
  playQueueById(index)
}

const handleRemove = (index) => {
  removePlayQueue(index)
}

const handleClear = () => {
  const hasCurrent = clearPlayQueue()
  updatePlayIndex()
  if (hasCurrent) {
    stop()
    setPlayMusicInfo(null, null)
  }
}

onBeforeUnmount(() => {
  window.clearTimeout(frameFocusTimer)
  dragEnd()
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('blur', handleWindowBlur)
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('keydown', handleDocumentKeydown)
})

</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';
.content {
  flex: none;
  height: 100%;
  position: relative;
  display: inline-block;
}

.btn {
  position: relative;
  justify-content: center;
  align-items: center;
  border-radius: var(--radius-sm);
  transition: var(--duration-fast) var(--ease-standard);
  transition-property: color, background-color, box-shadow, transform;
  cursor: pointer;
  background-color: transparent;
  border: none;
  width: 24px;
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  padding: 0;

  svg {
    transition: opacity @transition-fast;
    opacity: 1;
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.2));
  }
  &:hover {
    background-color: var(--color-hover);
    svg {
      opacity: 1;
    }
  }
  &:active {
    transform: scale(.94);
    svg {
      opacity: 1;
    }
  }
  &:focus-visible {
    box-shadow: var(--focus-ring);
  }

  &.btnActive {
    color: var(--color-primary);

    svg {
      opacity: 1;
    }
  }
}

.popup {
  position: fixed;
  z-index: 10;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface-elevated);
  box-shadow: var(--shadow-popup);
  display: flex;
  flex-flow: column nowrap;
  overflow: hidden;
}

.header {
  flex: none;
  height: 48px;
  box-sizing: border-box;
  display: flex;
  flex-flow: row nowrap;
  justify-content: space-between;
  align-items: center;
  padding: 0 14px;
  border-bottom: var(--color-list-header-border-bottom);
}

.headerActions { display: flex; flex: none; }
.dragHandle {
  -webkit-user-drag: element;
  flex: none;
  width: 20px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-font-label);
  cursor: grab;
  &:focus-visible { box-shadow: var(--focus-ring); }
}
.item.dropBefore { box-shadow: inset 0 2px var(--color-primary); }
.item.dropAfter { box-shadow: inset 0 -2px var(--color-primary); }

.titleContent {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-font);
  .mixin-ellipsis-1();
}

.count {
  flex: none;
  min-width: 20px;
  box-sizing: border-box;
  padding: 2px 6px;
  border-radius: 10px;
  background-color: var(--color-primary-background-active);
  color: var(--color-primary);
  font-size: 11px;
  line-height: 1.35;
  text-align: center;
}

.clearBtn {
  background-color: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-font-label);
  font-size: 12px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  transition: var(--duration-fast) var(--ease-standard);
  transition-property: color, background-color, scale;

  &:hover {
    color: var(--color-primary);
    background-color: var(--color-button-background-hover);
  }
  &:active {
    background-color: var(--color-button-background-active);
  }
  &:disabled {
    opacity: .4;
    cursor: not-allowed;
  }
  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

.listContent {
  flex: auto;
  min-height: 0;
  position: relative;
  display: flex;
  flex-flow: column nowrap;

  :global(.list) {
    flex: auto;
  }
}

.item {
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  height: 100%;
  padding: 0 8px 0 6px;
  box-sizing: border-box;
  cursor: pointer;
  transition: var(--duration-fast) var(--ease-standard);
  transition-property: background-color, color, box-shadow;
  font-size: 12px;

  &:hover {
    background-color: var(--color-primary-background-hover);

    .removeBtn {
      opacity: 1;
    }
  }

  &.active {
    color: var(--color-primary);
    background-color: var(--color-primary-background-active);
    box-shadow: inset 3px 0 0 var(--color-primary);

    .itemName {
      font-weight: 500;
    }
  }
}

.itemNum {
  flex: none;
  width: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-font-label);
  font-size: 11px;

  svg {
    fill: currentColor;
  }
}

.itemImg {
  flex: none;
  width: 36px;
  height: 36px;
  margin-left: 2px;
  border-radius: 5px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-primary-background-active);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  svg {
    fill: var(--color-font-label);
    opacity: .5;
  }
}

.itemInfo {
  flex: auto;
  min-width: 0;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  line-height: 1.25;
  padding-left: 10px;
}

.itemName {
  .mixin-ellipsis-1();
  font-size: 13px;
}

.itemSinger {
  .mixin-ellipsis-1();
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-font-label);
}

.entityLink {
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-primary);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
    outline: none;
  }
}

.removeBtn {
  flex: none;
  width: 28px;
  height: 28px;
  box-sizing: border-box;
  margin-left: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--color-font-label);
  opacity: 1;
  padding: 6px;
  transition: var(--duration-fast) var(--ease-standard);
  transition-property: color, opacity, background-color;

  &:hover {
    opacity: 1 !important;
    color: @red-500;
    background-color: var(--color-button-background-hover);
  }

  &:focus-visible {
    opacity: 1;
  }
}

.empty {
  flex: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-flow: column nowrap;
  gap: 10px;
  color: var(--color-font-label);
  font-size: 13px;

  svg {
    width: 34px;
    height: 34px;
    fill: currentColor;
    opacity: .35;
  }
}

:global(.queue-panel-enter-active) {
  transition: var(--duration-popup) var(--ease-emphasized);
  transition-property: opacity, transform;
}

:global(.queue-panel-leave-active) {
  transition: var(--duration-popup) var(--ease-standard);
  transition-property: opacity, transform;
}

:global(.queue-panel-enter-from),
:global(.queue-panel-leave-to) {
  opacity: 0;
  transform: translateY(10px) scale(.98);
}

</style>
