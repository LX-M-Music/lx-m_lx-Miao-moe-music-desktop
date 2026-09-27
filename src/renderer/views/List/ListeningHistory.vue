<template>
  <section :class="$style.page" data-listening-history>
    <header :class="$style.header">
      <h2>{{ $t('history__title') }}</h2>
      <p>{{ $t('history__stats', { plays: result.stats.plays, songs: result.stats.songs, artists: result.stats.singers }) }}</p>
      <base-btn min :class="$style.clearButton" :disabled="loading || !result.stats.plays" @click="clearHistory">{{ $t('history__clear') }}</base-btn>
    </header>
    <div :class="$style.musicList" :style="columnLayout.style">
      <common-music-list-header :layout="columnLayout" :action-label="$t('history__listened_at')" />
      <p v-if="error" :class="[$style.status, $style.error]" role="alert">{{ appSetting['common.showErrorDialog'] ? error : error.split('\n')[0] }}</p>
      <p v-else-if="loading" :class="$style.status" role="status">{{ $t('history__loading') }}</p>
      <p v-else-if="!entries.length" :class="$style.status" role="status">{{ $t('history__empty') }}</p>
      <div v-else ref="listContent" :class="$style.content">
        <base-virtualized-list
          ref="listRef" v-slot="row" :list="entries" key-name="id"
          :item-height="listItemHeight" :overscan="10" container-class="scroll music-column-scroll" content-class="list"
          @contextmenu.capture="handleTextSelectionContextMenu"
        >
          <div
            class="list-item" :class="[{ active: selectedList.includes(row.item.song) }, { selected: rightClickEntryId === row.item.id }, { disabled: !assertApiSupport(row.item.song.source) }]"
            :data-history-id="row.item.id" :aria-label="$t('history__play_song', { name: row.item.song.name })"
            @click="handleRowClick($event, row.index)" @dblclick="handleRowDoubleClick($event, row.index)" @contextmenu="handleRowContextMenu($event, row.item)"
          >
            <div class="list-item-cell no-select" :class="$style.num" style="flex: 0 0 var(--music-column-index);" data-music-cell="index"><div class="num">{{ page * 50 + row.index + 1 }}</div></div>
            <div class="list-item-cell no-select" :class="$style.cover" style="flex: 0 0 var(--music-column-cover); padding: 0 6px;" data-music-cell="cover">
              <common-cover-image v-if="!coverErrorSet.has(getCoverKey(row.item.song))" :music-info="row.item.song" :size="appSetting['list.coverSize']" alt="" @error="handleCoverError(row.item.song)" />
              <svg v-else version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="60%" height="60%" viewBox="0 0 24 24" space="preserve"><use xlink:href="#icon-music" /></svg>
            </div>
            <div class="list-item-cell name" style="flex: 0 0 var(--music-column-name);" data-music-cell="name">
              <span class="select name" :aria-label="row.item.song.name">{{ row.item.song.name }}</span>
              <span v-if="isShowSource" class="no-select label-source">{{ row.item.song.source }}</span>
            </div>
            <div class="list-item-cell" style="flex: 0 0 var(--music-column-singer);" data-music-cell="singer">
              <span v-if="canOpenEntity(row.item.song) && getSingerNames(row.item.song).length" :class="$style.entityLinks" class="select" :aria-label="row.item.song.singer">
                <template v-for="(singer, singerIndex) in getSingerNames(row.item.song)" :key="`${singer}__${singerIndex}`">
                  <span v-if="singerIndex" :class="$style.entitySeparator">、</span>
                  <button type="button" :class="$style.entityLink" @click.stop="openEntityDetail(row.item.song, 'singer', singer)" @dblclick.stop>{{ singer }}</button>
                </template>
              </span>
              <span v-else class="select" :aria-label="row.item.song.singer">{{ row.item.song.singer }}</span>
            </div>
            <div class="list-item-cell" style="flex: 0 0 var(--music-column-album);" data-music-cell="album">
              <button
                v-if="canOpenEntity(row.item.song) && row.item.song.meta.albumName" type="button" class="select" :class="$style.entityLink"
                :aria-label="row.item.song.meta.albumName" @click.stop="openEntityDetail(row.item.song, 'album', row.item.song.meta.albumName)" @dblclick.stop
              >{{ row.item.song.meta.albumName }}</button>
              <span v-else class="select" :aria-label="row.item.song.meta.albumName">{{ row.item.song.meta.albumName }}</span>
            </div>
            <div class="list-item-cell" style="flex: 0 0 var(--music-column-time);" data-music-cell="time"><span class="no-select">{{ row.item.song.interval || '--/--' }}</span></div>
            <div class="list-item-cell" :class="$style.listenedAt" style="flex: 0 0 var(--music-column-action);" data-music-cell="action">
              <time :datetime="new Date(row.item.time).toISOString()" :title="date(row.item.time)">{{ date(row.item.time) }}</time>
            </div>
          </div>
        </base-virtualized-list>
      </div>
    </div>
    <footer :class="$style.footer">
      <base-btn :disabled="loading || page === 0" @click="changePage(-1)">{{ $t('history__previous') }}</base-btn>
      <span>{{ page + 1 }}</span>
      <base-btn :disabled="loading || (page + 1) * 50 >= result.stats.plays" @click="changePage(1)">{{ $t('history__next') }}</base-btn>
    </footer>
    <common-list-add-modal v-model:show="isShowListAdd" :music-info="selectedAddMusicInfo" teleport="#view" />
    <common-list-add-multiple-modal v-model:show="isShowListAddMultiple" :music-list="selectedMusicList" teleport="#view" @confirm="removeAllSelect" />
    <common-download-modal v-model:show="isShowDownload" :music-info="selectedDownloadMusicInfo" teleport="#view" />
    <common-download-multiple-modal v-model:show="isShowDownloadMultiple" :list="selectedMusicList" teleport="#view" @confirm="removeAllSelect" />
    <base-menu v-model="isShowItemMenu" :menus="menus" :xy="menuLocation" item-name="name" @menu-click="handleMenuClick" />
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from '@common/utils/vueTools'
import { clipboardWriteText } from '@common/utils/electron'
import { formatError } from '@common/utils/errorMessage'
import { libraryCall, listeningHistoryVersion } from '@renderer/utils/library'
import { getCoverKey } from '@renderer/utils/musicCover'
import { appSetting } from '@renderer/store/setting'
import { assertApiSupport } from '@renderer/store/utils'
import { addTempPlayList } from '@renderer/store/player/action'
import { playMusicInfo } from '@renderer/store/player/state'
import { playQueueById } from '@renderer/core/player'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import useMusicListColumns from '@renderer/utils/compositions/useMusicListColumns'
import useEntityDetailNavigation from '@renderer/utils/compositions/useEntityDetailNavigation'
import useList from './MusicList/useList'
import useMenu from './MusicList/useMenu'
import useMusicAdd from './MusicList/useMusicAdd'
import useMusicDownload from './MusicList/useMusicDownload'
import useMusicActions from './MusicList/useMusicActions'

const emit = defineEmits(['show-menu'])
const t = useI18n()
const page = ref(0)
const loading = ref(false)
const error = ref('')
const result = ref({ rows: [], stats: { plays: 0, songs: 0, singers: 0 }, artists: [] })
const entries = computed(() => result.value.rows)
const list = computed(() => entries.value.map(entry => entry.song))
const isShowSource = computed(() => appSetting['list.isShowSource'])
const columnLayout = useMusicListColumns('music')
const { canOpenEntity, getSingerNames, openEntityDetail } = useEntityDetailNavigation()
const coverErrorSet = reactive(new Set())
const handleCoverError = song => { coverErrorSet.add(getCoverKey(song)) }
const listRef = ref()
const listContent = ref()
const rightClickEntryId = ref(null)
const selection = useList({ listRef, list })
const selectedList = selection.selectedList
const { listItemHeight, handleSelectData, removeAllSelect } = selection
const selectedMusicList = computed(() => [...new Map(selectedList.value.map(song => [`${song.source}:${song.id}`, song])).values()])
const { isShowListAdd, isShowListAddMultiple, selectedAddMusicInfo, handleShowMusicAddModal } = useMusicAdd({ selectedList, list })
const { isShowDownload, isShowDownloadMultiple, selectedDownloadMusicInfo, handleShowDownloadModal } = useMusicDownload({ selectedList, list })
const { handleSearch, handleOpenMusicDetail, handleCopyName, handleDislikeMusic } = useMusicActions({ props: { listId: 'history' }, list, selectedList, removeAllSelect })

let generation = 0
const date = time => new Date(time).toLocaleString(window.i18n.locale)
const load = async() => {
  const current = ++generation
  loading.value = true
  error.value = ''
  try {
    const next = await libraryCall('getListeningHistory', { page: page.value })
    if (current === generation) result.value = next
  } catch (cause) {
    if (current === generation) error.value = formatError(cause, t('history__load_failed'), 'HISTORY_LOAD_FAILED')
  } finally {
    if (current === generation) loading.value = false
  }
}
const changePage = direction => { page.value += direction; void load() }
const clearHistory = async() => {
  if (!await dialog.confirm({ message: t('history__clear_confirm'), confirmButtonText: t('history__clear') })) return
  try { await libraryCall('clearListeningHistory'); page.value = 0; listeningHistoryVersion.value++ } catch (cause) {
    error.value = formatError(cause, t('history__clear_failed'), 'HISTORY_CLEAR_FAILED')
  }
}
const play = index => {
  const song = list.value[index]
  if (!song) return
  const wasPlaying = !!playMusicInfo.musicInfo
  const queueIndex = addTempPlayList([{ listId: null, musicInfo: song }])
  if (wasPlaying) playQueueById(queueIndex)
}
const playLater = index => {
  const songs = selectedList.value.length ? selectedMusicList.value : list.value[index] ? [list.value[index]] : []
  if (!songs.length) return
  addTempPlayList(songs.map(song => ({ listId: null, musicInfo: song })))
  removeAllSelect()
}
const removeHistory = async(index) => {
  const selectedEntries = selectedList.value.length ? entries.value.filter(entry => selectedList.value.includes(entry.song)) : []
  const ids = selectedEntries.length ? selectedEntries.map(entry => entry.id) : entries.value[index] ? [entries.value[index].id] : []
  if (!ids.length) return
  if (ids.length > 1 && !await dialog.confirm({ message: t('history__remove_confirm', { count: ids.length }), confirmButtonText: t('list__remove') })) return
  try {
    await libraryCall('removeListeningHistory', ids)
    removeAllSelect()
    if (page.value > 0 && result.value.stats.plays - ids.length <= page.value * 50) page.value--
    listeningHistoryVersion.value++
  } catch (cause) { error.value = formatError(cause, t('history__remove_failed'), 'HISTORY_REMOVE_FAILED') }
}
const { menus, menuLocation, isShowItemMenu, showMenu, menuClick } = useMenu({
  assertApiSupport,
  emit,
  hiddenActions: ['moveTo', 'toggleSource'],
  handleShowMusicMoveModal: () => {},
  handleShowMusicToggleModal: () => {},
  handleShowDownloadModal,
  handlePlayMusic: play,
  handlePlayMusicLater: playLater,
  handleSearch,
  handleShowMusicAddModal,
  handleOpenMusicDetail,
  handleCopyName,
  handleDislikeMusic,
  handleRemoveMusic: removeHistory,
})
const handleRowClick = (event, index) => {
  if (rightClickEntryId.value != null || event.target.closest('button')) return
  handleSelectData(index)
}
const handleRowDoubleClick = (event, index) => {
  if (!event.target.closest('button')) play(index)
}
const handleRowContextMenu = (event, entry) => {
  rightClickEntryId.value = entry.id
  showMenu(event, entry.song)
}
const handleMenuClick = action => {
  const index = entries.value.findIndex(entry => entry.id === rightClickEntryId.value)
  rightClickEntryId.value = null
  menuClick(index < 0 ? null : action, index)
}
const handleTextSelectionContextMenu = event => {
  if (!event.target.classList.contains('select')) return
  const selection = window.getSelection()?.toString().trim()
  if (!selection) return
  event.stopImmediatePropagation()
  listContent.value?.classList.add('copying')
  requestAnimationFrame(() => {
    listContent.value?.classList.remove('copying')
    clipboardWriteText(selection.split(/\n\n/).map(line => line.replace(/\n/g, '  ')).join('\n').trim())
  })
}
watch(listeningHistoryVersion, () => { void load() })
onMounted(() => { void load() })
onBeforeUnmount(() => { generation++ })
</script>

<style lang="less" module>
.page { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; box-sizing: border-box; color: var(--color-font); }
.header { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; margin: 20px 20px 16px; }
.header h2 { font-size: 20px; }
.header p { color: var(--color-font-label); font-size: 12px; }
.clearButton { margin-left: auto; }
.musicList { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.content { display: flex; flex: 1; flex-direction: column; min-height: 0; font-size: 14px; }
.status { margin: 20px; color: var(--color-font-label); }
.error { color: var(--color-danger); white-space: pre-wrap; }
.num { height: 100%; display: flex; align-items: center; justify-content: center; }
.cover { height: 100%; display: flex; align-items: center; justify-content: center; box-sizing: border-box; }
.cover img { width: var(--list-cover-size); height: var(--list-cover-size); border-radius: var(--radius-sm); object-fit: cover; }
.cover svg { width: 60%; height: auto; fill: var(--color-font-label); opacity: .5; }
.listenedAt time { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entityLinks { display: flex; align-items: center; min-width: 0; overflow: hidden; }
.entitySeparator { flex: none; }
.entityLink { min-width: 0; max-width: 100%; overflow: hidden; padding: 0; border: 0; border-radius: 2px; background: none; color: inherit; font: inherit; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; transition: color var(--duration-fast) var(--ease-standard); }
.entityLink:hover { border-radius: var(--radius-sm); background-color: var(--color-primary-alpha-400); transition: background-color var(--duration-normal) var(--ease-standard); }
.footer { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 12px 0; }
.musicList :global(.label-source) { color: var(--color-primary); padding: 5px; font-size: .8em; line-height: 1.2; opacity: .75; display: inline-block; }
</style>
