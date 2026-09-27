<template>
  <div :class="$style.home">
    <div class="scroll" :class="$style.content">
      <header :class="$style.header">
        <h3 :class="$style.greeting">{{ greeting }}</h3>
        <div :class="$style.toolbar">
          <div :class="$style.sources" role="tablist" :aria-label="$t('home__source_select')">
            <button
              v-for="s in sources" :key="s" type="button" role="tab"
              :class="[$style.sourceChip, { [$style.active]: s == currentSource }]"
              :aria-selected="s == currentSource" @click="handleSelectSource(s)"
            >{{ sourceNames[s] }}</button>
          </div>
          <base-btn :class="$style.refresh" min :disabled="loading" aria-label="refresh" @click="handleRefresh">
            <svg-icon name="sync" :class="[$style.refreshIcon, { [$style.spinning]: loading }]" />
          </base-btn>
        </div>
      </header>

      <div v-if="offlineTip" :class="$style.offlineTip" role="status">
        <svg-icon name="information-slab-circle-outline" />
        <span>{{ $t('home__offline_tip') }}</span>
      </div>

      <section :class="$style.section">
        <h4 :class="$style.sectionTitle">
          <svg-icon name="playlist" />
          <span>{{ $t('home__recommend') }}</span>
        </h4>
        <div v-if="playlists.length" :class="$style.playlistGrid">
          <div
            v-for="(item, index) in playlists" :key="getItemKey(item)" :class="$style.playlistCard" role="button" tabindex="0"
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
              <span v-if="item.play_count" :class="$style.playCount">
                <svg-icon name="headphones" />
                {{ item.play_count }}
              </span>
            </div>
            <p :class="$style.playlistName">{{ item.name }}</p>
          </div>
        </div>
        <div v-else-if="loading" class="ui-state" role="status" :aria-busy="true">
          <span class="ui-spinner" />
        </div>
        <div v-else :class="['ui-state', { 'ui-state-error': currentError }]" role="status">
          <p>{{ currentError ? $t('list__load_failed') : $t('no_item') }}</p>
          <base-btn class="ui-state-retry" min @click="handleRefresh">{{ $t('reload') }}</base-btn>
        </div>
      </section>

      <section v-if="boards.length" :class="$style.section">
        <h4 :class="$style.sectionTitle">
          <svg-icon name="list" />
          <span>{{ $t('leaderboard') }}</span>
        </h4>
        <div :class="$style.chipWrap">
          <button v-for="board in boards" :key="board.id" type="button" :class="$style.chip" @click="toBoard(board)">{{ board.name }}</button>
        </div>
      </section>

      <section v-if="hotWords.length" :class="$style.section">
        <h4 :class="$style.sectionTitle">
          <svg-icon name="fire" />
          <span>{{ $t('search__hot_search') }}</span>
        </h4>
        <div :class="$style.chipWrap">
          <button v-for="(word, index) in hotWords" :key="index" type="button" :class="$style.chip" @click="toSearch(word)">{{ word }}</button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from '@common/utils/vueTools'
import { useRoute, useRouter } from '@common/utils/vueRouter'
import { sourceNames } from '@renderer/store'
import { feedSources, feeds, feedLoading, feedError, currentSource, initHomeFeed, getAndSetHomeFeed } from '@renderer/store/home'
import type { HomePlaylistItem, HomeBoardItem } from '@renderer/utils/ipc'

const router = useRouter()
const route = useRoute()

const sources = feedSources
const imageErrorSet = ref(new Set<string>())

const currentFeed = computed(() => currentSource.value ? feeds[currentSource.value] : undefined)
const playlists = computed(() => currentFeed.value?.playlists ?? [])
const boards = computed(() => currentFeed.value?.boards ?? [])
const hotWords = computed(() => currentFeed.value?.hotWords ?? [])
const loading = computed(() => {
  const source = currentSource.value
  return !!source && !!feedLoading[source]
})
const currentError = computed(() => {
  const source = currentSource.value
  return !!source && !!feedError[source]
})
const offlineTip = computed(() => {
  const feed = currentFeed.value
  return !!feed && (feed.playlistsOffline || feed.hotWordsOffline || feed.boardsOffline)
})

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 11) return window.i18n.t('home__greeting_morning')
  if (hour < 18) return window.i18n.t('home__greeting_afternoon')
  return window.i18n.t('home__greeting_evening')
})

const getItemKey = (item: HomePlaylistItem) => `${item.source}__${item.id}`

const toPlaylistDetail = (item: HomePlaylistItem) => {
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

const toBoard = (board: HomeBoardItem) => {
  void router.push({
    path: '/leaderboard',
    query: {
      source: currentSource.value,
      boardId: board.id,
    },
  })
}

const toSearch = (text: string) => {
  void router.push({
    path: '/search',
    query: { text },
  })
}

const handleSelectSource = (source: LX.OnlineSource) => {
  if (source == currentSource.value) return
  void getAndSetHomeFeed(source)
}

const handleRefresh = () => {
  if (!currentSource.value) return
  void getAndSetHomeFeed(currentSource.value, true)
}

onMounted(async() => {
  await initHomeFeed()
  if (currentSource.value) void getAndSetHomeFeed(currentSource.value)
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
  flex-flow: row wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}
.greeting {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sources {
  display: flex;
  flex-flow: row wrap;
  gap: 6px;
}
.sourceChip {
  border: none;
  cursor: pointer;
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--color-font-label);
  background-color: var(--color-000);
  outline: none;
  transition: background-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-accent);
  }
  &.active {
    color: var(--color-000);
    background-color: var(--color-accent);
  }
  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}
.refresh {
  width: 32px;
  height: 32px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.refreshIcon {
  width: 16px;
  height: 16px;
}
.spinning {
  animation: home-refresh-spin 1s linear infinite;
}
@keyframes home-refresh-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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

  svg {
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
  right: 6px;
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

.chipWrap {
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
}
</style>
