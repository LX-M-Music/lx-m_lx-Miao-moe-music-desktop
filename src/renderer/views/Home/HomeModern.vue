<template>
  <div :class="$style.home">
    <div class="scroll" :class="$style.content">
      <!-- 顶部问候 + 登录状态 -->
      <header :class="$style.header">
        <div :class="$style.greetingWrap">
          <h3 :class="$style.greeting">{{ greeting }}</h3>
          <p :class="$style.loginSummary">
            <template v-if="validLoginCount > 0">{{ $t('home2__connected_tip', { n: String(validLoginCount) }) }}</template>
            <template v-else>{{ $t('home2__not_connected_tip') }}</template>
          </p>
        </div>
        <base-btn :class="$style.manageBtn" min @click="showLoginModal = true">
          <svg-icon name="user" />
          <span>{{ $t('home2__manage_login') }}</span>
        </base-btn>
      </header>

      <!-- 平台连接状态 chips -->
      <div :class="$style.statusRow">
        <button
          v-for="item in loginChips" :key="item.source" type="button"
          :class="$style.statusChip" @click="showLoginModal = true"
        >
          <span :class="$style.dot" :data-state="item.state" />
          <span>{{ item.name }}</span>
          <span :class="$style.stateText">{{ $t('home2__state_' + item.state) }}</span>
        </button>
      </div>

      <div v-if="offlineTip" :class="$style.offlineTip" role="status">
        <svg-icon name="information-slab-circle-outline" />
        <span>{{ $t('home__offline_tip') }}</span>
      </div>

      <!-- 从上次暂停的地方继续 -->
      <section v-if="showContinueCard" :class="$style.continueCard">
        <div :class="$style.continueCover">
          <common-cover-image
            v-if="musicInfo.pic" :class="$style.img" :size="120" :src="musicInfo.pic" :alt="musicInfo.name"
          />
          <svg v-else version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" space="preserve">
            <use xlink:href="#icon-music" />
          </svg>
        </div>
        <div :class="$style.continueInfo">
          <p :class="$style.continueLabel">{{ $t('home2__continue_label') }}</p>
          <h4 :class="$style.continueName">{{ musicInfo.name }}</h4>
          <p :class="$style.continueSinger">{{ musicInfo.singer }}</p>
          <div :class="$style.continueProgress">
            <div :class="$style.progressBar">
              <div :class="$style.progressInner" :style="{ width: (playProgress.progress * 100) + '%' }" />
            </div>
            <span>{{ playProgress.nowPlayTimeStr }} / {{ playProgress.maxPlayTimeStr }}</span>
          </div>
        </div>
        <base-btn :class="$style.continueBtn" @click="handleContinue">
          <svg-icon name="play" />
          <span>{{ $t('home2__continue') }}</span>
        </base-btn>
      </section>

      <!-- 快捷入口 -->
      <section :class="$style.section">
        <div :class="$style.quickRow">
          <button v-for="entry in quickEntries" :key="entry.to" type="button" :class="$style.quickCard" @click="router.push(entry.to)">
            <svg-icon :name="entry.icon" :class="$style.quickIcon" />
            <span>{{ $t(entry.label) }}</span>
          </button>
        </div>
      </section>

      <!-- 热门歌曲 -->
      <section v-if="mergedSongs.length || anySongLoading" :class="$style.section">
        <h4 :class="$style.sectionTitle">
          <svg-icon name="music" />
          <span>{{ $t('home2__hot_songs') }}</span>
        </h4>
        <div :class="$style.songGrid">
          <button
            v-for="(song, index) in mergedSongs" :key="song.source + '__' + song.songmid"
            type="button" :class="$style.songRow" :disabled="playingSong" @click="handlePlaySong(song)"
          >
            <span :class="$style.songIndex">{{ index + 1 }}</span>
            <div :class="$style.songCover">
              <common-cover-image
                v-if="song.img" :class="$style.img" :loading="index < 8 ? 'eager' : 'lazy'" :size="80" :src="song.img" :alt="song.name"
              />
              <svg v-else version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" space="preserve">
                <use xlink:href="#icon-music" />
              </svg>
            </div>
            <div :class="$style.songInfo">
              <span :class="$style.songName">{{ song.name }}</span>
              <span :class="$style.songSinger">{{ song.singer }}</span>
            </div>
            <span :class="[$style.sourceBadge, 'src-' + song.source]">{{ song.source }}</span>
            <svg-icon name="play-outline" :class="$style.songPlayIcon" />
          </button>
        </div>
      </section>

      <!-- 收藏歌单（登录个性化） -->
      <section v-if="favoriteRows.length || anyFavoriteLoading" :class="$style.section">
        <h4 :class="$style.sectionTitle">
          <svg-icon name="heart" />
          <span>{{ $t('home2__favorites') }}</span>
        </h4>
        <div v-for="row in favoriteRows" :key="row.source" :class="$style.favoriteRow">
          <span :class="[$style.sourceBadge, 'src-' + row.source]">{{ row.source }}</span>
          <div :class="$style.favoriteChips">
            <button
              v-for="item in row.list" :key="row.source + item.id" type="button"
              :class="$style.chip" :disabled="importing" :title="$t('home2__import_tip')"
              @click="handleImportFavorite(row.source, item)"
            >{{ item.name }}</button>
          </div>
        </div>
        <div v-if="anyFavoriteLoading && !favoriteRows.length" class="ui-state" role="status" :aria-busy="true">
          <span class="ui-spinner" />
        </div>
      </section>
      <section v-else :class="$style.section">
        <h4 :class="$style.sectionTitle">
          <svg-icon name="heart" />
          <span>{{ $t('home2__favorites') }}</span>
        </h4>
        <div :class="$style.loginHint">
          <p>{{ $t('home2__favorites_login_tip') }}</p>
          <base-btn min @click="showLoginModal = true">{{ $t('home2__go_login') }}</base-btn>
        </div>
      </section>

      <!-- 聚合推荐（全平台合并） -->
      <section :class="$style.section">
        <h4 :class="$style.sectionTitle">
          <svg-icon name="playlist" />
          <span>{{ $t('home__recommend') }}</span>
        </h4>
        <div v-if="mergedPlaylists.length" :class="$style.playlistGrid">
          <div
            v-for="(item, index) in mergedPlaylists" :key="getItemKey(item)" :class="$style.playlistCard" role="button" tabindex="0"
            :aria-label="item.name" @click="toPlaylistDetail(item)" @keydown.enter.space.prevent="toPlaylistDetail(item)"
          >
            <div :class="$style.playlistCover">
              <common-cover-image
                v-if="item.img && !imageErrorSet.has(getItemKey(item))" :class="$style.img"
                :loading="index < 6 ? 'eager' : 'lazy'" :size="160" :src="item.img" :alt="item.name"
                @error="imageErrorSet.add(getItemKey(item))"
              />
              <svg v-else version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" space="preserve">
                <use xlink:href="#icon-music" />
              </svg>
              <span :class="[$style.sourceBadge, 'src-' + item.source]">{{ item.source }}</span>
              <span v-if="item.play_count" :class="$style.playCount">
                <svg-icon name="headphones" />
                {{ item.play_count }}
              </span>
            </div>
            <p :class="$style.playlistName">{{ item.name }}</p>
          </div>
        </div>
        <div v-else-if="anyLoading" class="ui-state" role="status" :aria-busy="true">
          <span class="ui-spinner" />
        </div>
        <div v-else :class="['ui-state', { 'ui-state-error': allFailed }]" role="status">
          <p>{{ allFailed ? $t('list__load_failed') : $t('no_item') }}</p>
          <base-btn class="ui-state-retry" min @click="handleRefresh">{{ $t('reload') }}</base-btn>
        </div>
      </section>
    </div>

    <LoginStatusModal :show="showLoginModal" @close="showLoginModal = false" @changed="handleLoginChanged" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from '@common/utils/vueTools'
import { useRouter, useRoute } from '@common/utils/vueRouter'
import { feedSources, feeds, feedLoading, feedError, initHomeFeed, getAndSetHomeFeed } from '@renderer/store/home'
import { COOKIE_SOURCES, SOURCE_NAME, getCookie, type CookieSource } from '@renderer/utils/cookieManager'
import { getRemoteSongs } from '@renderer/utils/cookiePlaylistApi'
import { refreshLoginStatus, loginStatus, countValidLogin } from '@renderer/store/loginStatus'
import { musicInfo, isPlay } from '@renderer/store/player/state'
import { playProgress } from '@renderer/store/player/playProgress'
import { play, playList } from '@renderer/core/player'
import music from '@renderer/utils/musicSdk'
import { userLists } from '@renderer/store/list/state'
import { createUserList, setTempList } from '@renderer/store/list/action'
import { LIST_IDS } from '@common/constants'
import { deduplicationList, toMD5, toNewMusicInfo } from '@renderer/utils'
import showToast from '@renderer/plugins/Toast'
import LoginStatusModal from './components/LoginStatusModal.vue'

const router = useRouter()
const route = useRoute()

const imageErrorSet = ref(new Set<string>())
const showLoginModal = ref(false)
const importing = ref(false)

// ===== 登录状态 =====
const validLoginCount = computed(() => countValidLogin())
const loginChips = COOKIE_SOURCES.map(source => ({
  source,
  name: SOURCE_NAME[source],
  get state() { return loginStatus[source] },
}))

// ===== 继续播放 =====
const showContinueCard = computed(() => !isPlay.value && !!musicInfo.name && playProgress.maxPlayTime > 0)
const handleContinue = () => {
  play()
}

// ===== 快捷入口 =====
const quickEntries = [
  { to: '/search', label: 'search', icon: 'search' },
  { to: '/songList/list', label: 'song_list', icon: 'playlist' },
  { to: '/leaderboard', label: 'leaderboard', icon: 'fire' },
  { to: '/list', label: 'my_list', icon: 'heart' },
]

// ===== 聚合推荐 =====
const mergedPlaylists = computed(() => {
  const lists = feedSources
    .map(source => feeds[source]?.playlists ?? [])
    .filter(list => list.length)
  const merged: typeof lists[number] = []
  const maxLen = Math.max(0, ...lists.map(list => list.length))
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      if (list[i]) merged.push(list[i])
    }
  }
  return merged
})
const anyLoading = computed(() => feedSources.some(source => !!feedLoading[source] && !(feeds[source]?.playlists.length)))
const allFailed = computed(() => feedSources.some(source => feedError[source]))
const offlineTip = computed(() => feedSources.some(source => feeds[source]?.playlistsOffline))

// ===== 热门歌曲 =====
interface MergedSong {
  songmid: string
  name: string
  singer: string
  img: string
  interval: string
  source: string
}
const mergedSongs = computed<MergedSong[]>(() => {
  const lists = feedSources
    .map(source => feeds[source]?.songs ?? [])
    .filter(list => list.length)
  const merged: MergedSong[] = []
  const maxLen = Math.max(0, ...lists.map(list => list.length))
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      if (list[i]) merged.push(list[i])
    }
  }
  return merged
})
const anySongLoading = computed(() => feedSources.some(source => !!feedLoading[source] && !(feeds[source]?.songs.length)))
const playingSong = ref(false)

const handlePlaySong = async(song: MergedSong) => {
  if (playingSong.value) return
  const boardId = feeds[song.source as LX.OnlineSource]?.boards?.[0]?.id
  if (!boardId) return
  playingSong.value = true
  try {
    const bangId = boardId.split('__')[1] ?? boardId
    const result = await music[song.source as LX.OnlineSource]?.leaderboard?.getList(bangId, 1)
    const list = deduplicationList((result?.list ?? []).map(toNewMusicInfo))
    const index = list.findIndex(m => m.meta.songId == song.songmid)
    if (index < 0) {
      showToast(window.i18n.t('home2__song_gone'))
      return
    }
    await setTempList(LIST_IDS.TEMP, list)
    playList(LIST_IDS.TEMP, index)
  } catch (error) {
    console.log('play hot song failed:', error)
    showToast(window.i18n.t('list__load_failed'))
  } finally {
    playingSong.value = false
  }
}

// ===== 收藏歌单 =====
interface FavoriteRow {
  source: CookieSource
  list: Array<{ id: string, name: string }>
}
const favoriteRows = computed<FavoriteRow[]>(() => COOKIE_SOURCES
  .filter(source => loginStatus[source] == 'valid')
  .map(source => ({
    source,
    list: feeds[source]?.favorites ?? [],
  }))
  .filter(row => row.list.length))
const anyFavoriteLoading = computed(() => COOKIE_SOURCES.some(source => loginStatus[source] == 'valid' && !!feedLoading[source]))

const handleImportFavorite = async(source: CookieSource, item: { id: string, name: string }) => {
  if (importing.value) return
  const listId = `home__${source}__${item.id}`
  const exist = userLists.find(list => list.sourceListId == listId)
  if (exist) {
    showToast(window.i18n.t('home2__import_duplicate', { name: exist.name }))
    return
  }
  importing.value = true
  try {
    const songs = await getRemoteSongs(source, getCookie(source), { id: item.id, name: item.name })
    if (!songs.length) {
      showToast(window.i18n.t('home2__import_empty'))
      return
    }
    await createUserList({
      name: `${SOURCE_NAME[source]} · ${item.name}`,
      id: `${source}_${toMD5(listId)}`,
      list: songs,
      source,
      sourceListId: listId,
    })
    showToast(window.i18n.t('home2__import_done', { name: item.name, n: String(songs.length) }))
  } catch (error) {
    console.log('import favorite playlist failed:', error)
    showToast(window.i18n.t('home2__import_failed'))
  } finally {
    importing.value = false
  }
}

// ===== 导航 =====
const getItemKey = (item: { source: string, id: string }) => `${item.source}__${item.id}`
const toPlaylistDetail = (item: { source: string, id: string, img: string }) => {
  void router.push({
    path: '/songList/detail',
    query: {
      source: item.source,
      id: item.id,
      picUrl: item.img,
      fromName: route.name as string,
    },
  })
}

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 11) return window.i18n.t('home__greeting_morning')
  if (hour < 18) return window.i18n.t('home__greeting_afternoon')
  return window.i18n.t('home__greeting_evening')
})

const handleRefresh = () => {
  for (const source of feedSources) void getAndSetHomeFeed(source, true)
}

const handleLoginChanged = (source: CookieSource) => {
  refreshLoginStatus()
  void getAndSetHomeFeed(source, true)
}

onMounted(async() => {
  await initHomeFeed()
  refreshLoginStatus()
  for (const source of feedSources) void getAndSetHomeFeed(source)
})
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.home {
  height: 100%;
  overflow: hidden;
}
.content {
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 18px 20px 30px;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.greeting {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.loginSummary {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--color-font-label);
}
.manageBtn {
  display: flex;
  align-items: center;
  gap: 6px;
  svg {
    width: 14px;
    height: 14px;
  }
}
.statusRow {
  display: flex;
  flex-flow: row wrap;
  gap: 8px;
  margin: 14px 0;
}
.statusChip {
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  cursor: pointer;
  padding: 5px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--color-font-label);
  background-color: var(--color-000);
  outline: none;
  transition: color var(--duration-fast) var(--ease-standard), background-color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-accent);
  }
  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
  .stateText {
    color: var(--color-500);
  }
}
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--color-450);

  &[data-state='valid'] {
    background-color: var(--color-success);
  }
  &[data-state='invalid'] {
    background-color: var(--color-warning);
  }
}
.offlineTip {
  display: flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  margin-bottom: 14px;
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--color-font-label);
  background-color: var(--color-000);

  svg {
    width: 14px;
    height: 14px;
  }
}

.continueCard {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 22px;
  padding: 14px 18px;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--color-primary-light-300-alpha-700), var(--color-primary-light-1000-alpha-400));
}
.continueCover {
  flex: none;
  width: 84px;
  height: 84px;
  display: flex;
  border-radius: var(--radius-md);
  overflow: hidden;
  background-color: var(--color-active);

  svg {
    width: 34%;
    margin: auto;
    fill: var(--color-text-muted);
    opacity: .45;
  }
  .img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
.continueInfo {
  flex: auto;
  min-width: 0;
}
.continueLabel {
  margin: 0;
  font-size: 12px;
  color: var(--color-font-label);
}
.continueName {
  margin: 3px 0 0;
  font-size: 17px;
  font-weight: 600;
  .mixin-ellipsis-1();
}
.continueSinger {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--color-font-label);
  .mixin-ellipsis-1();
}
.continueProgress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--color-500);

  .progressBar {
    flex: none;
    width: 140px;
    height: 4px;
    border-radius: 999px;
    overflow: hidden;
    background-color: var(--color-primary-alpha-200);
  }
  .progressInner {
    height: 100%;
    border-radius: 999px;
    background-color: var(--color-accent);
  }
}
.continueBtn {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;

  svg {
    width: 13px;
    height: 13px;
  }
}

.section {
  margin-bottom: 26px;
}
.sectionTitle {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;

  svg {
    width: 17px;
    height: 17px;
    color: var(--color-accent);
  }
}

.quickRow {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.quickCard {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  cursor: pointer;
  padding: 14px 10px;
  border-radius: var(--radius-md);
  font-size: 13px;
  color: var(--color-font);
  background-color: var(--color-000);
  outline: none;
  transition: color var(--duration-fast) var(--ease-standard), background-color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-accent);
    background-color: var(--color-active);
  }
  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
  .quickIcon {
    width: 16px;
    height: 16px;
  }
}

.favoriteRow {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 10px;
}
.sourceBadge {
  flex: none;
  margin-top: 4px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: #fff;

  &.src-kw { background-color: #2e5bee; }
  &.src-kg { background-color: #00a2e0; }
  &.src-tx { background-color: #1fbf6d; }
  &.src-wy { background-color: #e5484d; }
  &.src-mg { background-color: #f08a1d; }
}
.favoriteChips {
  display: flex;
  flex-flow: row wrap;
  gap: 8px;
}
.chip {
  border: none;
  cursor: pointer;
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--color-font-label);
  background-color: var(--color-000);
  outline: none;
  transition: color var(--duration-fast) var(--ease-standard), background-color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-accent);
    background-color: var(--color-active);
  }
  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
  &:disabled {
    opacity: .5;
    cursor: default;
  }
}
.loginHint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-radius: var(--radius-md);
  background-color: var(--color-000);

  p {
    margin: 0;
    font-size: 13px;
    color: var(--color-font-label);
  }
}

.songGrid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px 18px;
}
.songRow {
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background-color: transparent;
  color: var(--color-font);
  text-align: left;
  outline: none;
  transition: background-color var(--duration-fast) var(--ease-standard);

  &:hover {
    background-color: var(--color-active);

    .songPlayIcon {
      opacity: 1;
    }
  }
  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
  &:disabled {
    opacity: .6;
    cursor: default;
  }
}
.songIndex {
  flex: none;
  width: 20px;
  text-align: center;
  font-size: 13px;
  color: var(--color-500);
}
.songCover {
  flex: none;
  width: 40px;
  height: 40px;
  display: flex;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background-color: var(--color-active);

  svg {
    width: 55%;
    margin: auto;
    fill: var(--color-text-muted);
    opacity: .45;
  }
  .img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
.songInfo {
  flex: auto;
  min-width: 0;
  display: flex;
  flex-flow: column nowrap;
  gap: 2px;
}
.songName {
  font-size: 13px;
  .mixin-ellipsis-1();
}
.songSinger {
  font-size: 12px;
  color: var(--color-font-label);
  .mixin-ellipsis-1();
}
.songPlayIcon {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--color-accent);
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.playlistGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 16px 14px;
}
.playlistCard {
  cursor: pointer;
  border-radius: var(--radius-sm);
  outline: none;
  transition: color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-accent);

    .img {
      transform: scale(1.03);
    }
  }
  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}
.playlistCover {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  display: flex;
  border-radius: var(--radius-md);
  overflow: hidden;
  background-color: var(--color-active);

  > svg {
    width: 34%;
    margin: auto;
    fill: var(--color-text-muted);
    opacity: .45;
  }
}
.img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--duration-normal) var(--ease-standard);
}
.playCount {
  position: absolute;
  left: 6px;
  bottom: 6px;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--color-000);
  background-color: var(--color-primary-dark-200-alpha-700);

  svg {
    width: 11px;
    height: 11px;
  }
}
.playlistName {
  margin: 7px 2px 0;
  font-size: 13px;
  line-height: 1.35;
  .mixin-ellipsis-2();
}
</style>
