<template>
  <material-modal :show="show" teleport="#view" bg-close height="100%" @close="handleClose">
    <main :class="$style.main">
      <base-tab v-model="source" :class="$style.tab" :list="tabs" />
      <base-checkbox id="music_toggle_only_matches" v-model="onlyMatches" :class="$style.filter" :label="$t('music_toggle_only_matches')" />
      <div class="scroll" :class="$style.list">
        <template v-if="list.length">
          <div v-for="item in list" :key="item.id" :class="[$style.listItem, {[$style.selected]: toggleMusicInfo?.id === item.id}]">
            <!-- <div :class="$style.num">{{ index + 1 }}</div> -->
            <div :class="$style.textContent">
              <h3 :class="$style.text" :aria-label="`${item.name} - ${item.singer}`">{{ item.name }}</h3>
              <h3 v-if="item.meta.albumName" :class="[$style.text, $style.albumName]" :aria-label="item.meta.albumName">
                {{ item.singer }}
                <span v-if="item.meta.albumName"> / {{ item.meta.albumName }}</span>
              </h3>
            </div>
            <div :class="$style.label">{{ item.interval }}</div>
            <div :class="$style.btns">
              <button type="button" :class="$style.btn" :aria-label="$t('music_toggle_detail', { name: item.name })" @click="openDetail(item)">
                <svg-icon name="share" />
              </button>
              <button type="button" :class="$style.btn" :aria-label="$t('music_toggle_preview', { name: item.name })" :aria-pressed="toggleMusicInfo?.id === item.id" @click="handlePlay(item)">
                <svg v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="50%" viewBox="0 0 287.386 287.386" space="preserve">
                  <use xlink:href="#icon-testPlay" />
                </svg>
              </button>
            </div>
          </div>
        </template>
        <div v-else :class="$style.noItem">
          <p v-if="!isError" v-text="noItemLabel" />
          <template v-if="isError">
            <p class="load-error-detail">{{ appSetting['common.showErrorDialog'] ? loadErrors[source] : $t('list__load_failed') }}</p>
            <base-btn class="ui-state-retry" min @click="retrySource">{{ $t('reload') }}</base-btn>
          </template>
        </div>
      </div>
      <div :class="$style.footer">
        <div :class="$style.info">
          <h2>
            <div :class="$style.nameLabel">
              <span :class="$style.name">{{ musicInfo.name }}</span>
              <span :class="$style.label">{{ musicInfo.source }} {{ musicInfo.interval }}</span>
            </div>
            <div :class="$style.singer">
              {{ musicInfo.singer }}
              <span v-if="musicInfo.meta.albumName"> / {{ musicInfo.meta.albumName }}</span>
            </div>
          </h2>
          <template v-if="toggleMusicInfo">
            <span style="flex: none;">→</span>
            <h2>
              <div :class="$style.nameLabel">
                <span :class="$style.name">{{ toggleMusicInfo.name }}</span>
                <span :class="$style.label">{{ toggleMusicInfo.source }} {{ toggleMusicInfo.interval }}</span>
              </div>
              <div :class="$style.singer">
                {{ toggleMusicInfo.singer }}
                <span v-if="toggleMusicInfo.meta.albumName"> / {{ toggleMusicInfo.meta.albumName }}</span>
              </div>
            </h2>
          </template>
        </div>
        <base-btn :disabled="!toggleMusicInfo || musicInfo.id == toggleMusicInfo.id" :class="$style.btn" @click="handleConfirm">{{ $t('music_toggle_confirm') }}</base-btn>
      </div>
    </main>
  </material-modal>
</template>

<script>
import { formatError } from '@common/utils/errorMessage'
import { LIST_IDS } from '@common/constants'
import { openUrl } from '@common/utils/electron'
import { playQueueById } from '@renderer/core/player'
import { getSourceI18nPrefix } from '@renderer/store'
import { addTempPlayList } from '@renderer/store/player/action'
import { playMusicInfo } from '@renderer/store/player/state'
import { toNewMusicInfo, toOldMusicInfo } from '@renderer/utils'
import musicSdk from '@renderer/utils/musicSdk'
import { markRaw } from 'vue'
import { rankMusicToggleCandidates } from '@renderer/utils/musicToggleCandidates'
import { appSetting } from '@renderer/store/setting'

const sources = ['kw', 'kg', 'tx', 'wy', 'mg']

export default {
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    musicInfo: {
      type: Object,
      default() {
        return {}
      },
    },
    preferredSource: {
      type: String,
      default: '',
    },
  },
  emits: ['update:show', 'toggle'],
  data() {
    return {
      lists: {},
      source: 'kw',
      loadStates: {},
      loadErrors: {},
      searchKey: 0,
      toggleMusicInfo: null,
      onlyMatches: true,
    }
  },
  computed: {
    appSetting() { return appSetting },
    defaultSource() {
      return [this.preferredSource, this.musicInfo?.source].find(source => sources.includes(source)) ?? sources[0]
    },
    rankedLists() {
      return rankMusicToggleCandidates(this.musicInfo, Object.entries(this.lists).map(([source, list]) => ({ source, list })), this.onlyMatches)
    },
    tabs() {
      const prefix = getSourceI18nPrefix()
      return sources.map(source => ({ id: source, label: window.i18n.t(prefix + source) }))
    },
    list() {
      return this.rankedLists.find(item => item.source === this.source)?.list ?? []
    },
    loading() {
      return this.show && ['pending', 'loading'].includes(this.loadStates[this.source])
    },
    isError() {
      return this.loadStates[this.source] === 'error'
    },
    noItemLabel() {
      return this.$t(this.loading ? 'list__loading' : 'music_toggle_no_match')
    },
  },
  watch: {
    show(n) {
      if (n) this.loadList()
      else this.cancelSearch()
    },
    musicInfo() {
      if (this.show) this.loadList()
    },
    source() {
      this.toggleMusicInfo = null
    },
    onlyMatches() {
      this.toggleMusicInfo = null
    },
  },
  beforeUnmount() {
    this.cancelSearch()
  },
  methods: {
    async fetchSourceList(source, musicInfo) {
      const query = `${musicInfo.name?.trim() ?? ''} ${musicInfo.singer?.trim() ?? ''}`.trim()
      const result = await musicSdk[source].musicSearch.search(query, 1, 25)
      if (!Array.isArray(result?.list)) throw new Error('Invalid source search response')
      return result.list.map(item => markRaw(toNewMusicInfo(item)))
    },
    async loadSource(source, musicInfo, searchKey) {
      if (!this.show || this.searchKey !== searchKey) return
      this.loadStates[source] = 'loading'
      try {
        const list = await this.fetchSourceList(source, musicInfo)
        if (!this.show || this.searchKey !== searchKey) return
        this.lists[source] = list
        this.loadStates[source] = 'ready'
      } catch (error) {
        if (!this.show || this.searchKey !== searchKey) return
        this.lists[source] = []
        this.loadStates[source] = 'error'
        this.loadErrors[source] = formatError(error, this.$t('list__load_failed'), 'MATCH_LOAD_FAILED')
      }
    },
    async loadList() {
      this.toggleMusicInfo = null
      const musicInfo = this.musicInfo
      const preferred = this.defaultSource
      this.source = preferred
      this.lists = {}
      this.loadStates = Object.fromEntries(sources.map(source => [source, 'pending']))
      const searchKey = ++this.searchKey
      await this.loadSource(preferred, musicInfo, searchKey)
      // Publish the preferred platform before starting the remaining searches.
      await this.$nextTick()
      if (!this.show || this.searchKey !== searchKey) return
      await Promise.all(sources.filter(source => source !== preferred).map(async source => this.loadSource(source, musicInfo, searchKey)))
    },
    retrySource() {
      if (!this.show || this.loading) return
      this.toggleMusicInfo = null
      void this.loadSource(this.source, this.musicInfo, this.searchKey)
    },
    handleClose() {
      this.cancelSearch()
      this.$emit('update:show', false)
    },
    cancelSearch() {
      ++this.searchKey
      this.loadStates = {}
      this.toggleMusicInfo = null
    },
    handleConfirm() {
      if (!this.show || !this.toggleMusicInfo || this.toggleMusicInfo.id === this.musicInfo.id || !this.list.some(item => item.id === this.toggleMusicInfo.id)) return
      this.$emit('toggle', this.toggleMusicInfo)
    },
    async openDetail(minfo) {
      const url = await musicSdk[minfo.source]?.getMusicDetailPageUrl(toOldMusicInfo(minfo))
      if (!url) return
      void openUrl(url)
    },
    handlePlay(musicInfo) {
      if (!this.show || !this.list.some(item => item.id === musicInfo.id)) return
      this.toggleMusicInfo = musicInfo
      const isPlaying = !!playMusicInfo.musicInfo
      const index = addTempPlayList([{ listId: LIST_IDS.PLAY_LATER, musicInfo, isTop: true }])
      if (isPlaying) playQueueById(index)
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 10px 7px 0;
  width: 560px;
  max-width: 100%;
  box-sizing: border-box;
  // min-width: 280px;
  display: flex;
  flex-flow: column nowrap;
  min-height: 0;
  // max-height: 100%;
  // overflow: hidden;
  height: 100%;
}
.tab {
  flex: none;
}
.filter {
  flex: none;
  margin: 10px 15px 0;
  font-size: 13px;
}

.list {
  flex: auto;
  min-height: 100px;
  min-width: 460px;
  // background-color: @color-search-form-background;
  font-size: 13px;
  transition-property: height;
  margin-top: 10px;
  padding: 0 7px;
  // position: relative;
  .listItem {
    position: relative;
    padding: 10px 5px;
    transition: background-color .2s ease;
    line-height: 1.4;
    // height: 100%;
    // overflow: hidden;
    display: flex;
    flex-flow: row nowrap;
    align-items: center;
    border-radius: 4px;

    &:hover {
      background-color: var(--color-primary-background-hover);
    }
    &.selected {
      background-color: var(--color-primary-alpha-100);
      box-shadow: inset 3px 0 var(--color-primary);
    }
    // &:last-child {
    //   border-bottom-left-radius: 4px;
    //   border-bottom-right-radius: 4px;
    // }
  }

  .num {
    flex: none;
    font-size: 12px;
    width: 20px;
    text-align: center;
    color: var(--color-font-label);
  }
  .textContent {
    flex: auto;
    min-width: 0;
    display: flex;
    flex-flow: column nowrap;
    align-items: flex-start;
    overflow: hidden;
  }
  .text {
    max-width: 100%;
    .mixin-ellipsis-1();
  }
  .albumName {
    font-size: 12px;
    opacity: 0.6;
    // .mixin-ellipsis-1();
  }
  .label {
    flex: none;
    font-size: 12px;
    opacity: 0.5;
    padding: 0 5px;
    display: flex;
    align-items: center;
    // transform: rotate(45deg);
    // background-color:
  }
  .btns {
    flex: none;
    font-size: 12px;
    padding: 0 5px;
    display: flex;
    align-items: center;
  }
  .btn {
    background-color: transparent;
    border: none;
    border-radius: @form-radius;
    margin-right: 5px;
    cursor: pointer;
    padding: 4px 7px;
    color: var(--color-button-font);
    outline: none;
    transition: background-color 0.2s ease;
    line-height: 0;
    &:last-child {
      margin-right: 0;
    }

    svg {
      width: 16px;
      height: 16px;
    }

    &:hover {
      background-color: var(--color-primary-background-hover);
    }
    &:active {
      background-color: var(--color-primary-font-active);
    }
  }

  .noItem {
    position: relative;
    display: flex;
    flex-flow: column nowrap;
    justify-content: center;
    align-items: center;
    height: 100%;

    p {
      font-size: 16px;
      color: var(--color-font-label);
    }
  }
}

.footer {
  flex: none;
  display: flex;
  flex-flow: row nowrap;
  justify-content: space-between;
  align-items: center;
  padding: 10px 7px;
  .info {
    min-width: 0;
    display: flex;
    flex-flow: row nowrap;
    padding-right: 10px;
    gap: 10px;
    font-size: 12px;
    align-items: center;

    h2 {
      min-width: 0;
      color: var(--color-font);
      line-height: 1.5;
      word-break: break-all;
    }
    .nameLabel {
      display: flex;
      flex-flow: row nowrap;
    }
    .name {
      .mixin-ellipsis();
    }
    .label {
      flex: none;
      font-size: 12px;
      opacity: 0.8;
      padding: 0 5px;
      color: var(--color-primary);
      // display: flex;
      // align-items: center;
      // transform: rotate(45deg);
      // background-color:
    }
    .singer {
      // font-size: 0.9em;
      color: var(--color-font-label);
      .mixin-ellipsis();
    }
  }

  .btn {
    flex: none;
    // box-sizing: border-box;
    // margin-left: 15px;
    // margin-bottom: 15px;
    // height: 36px;
    // line-height: 36px;
    // padding: 0 10px !important;
    min-width: 70px;
    // .mixin-ellipsis-1();

    +.btn {
      margin-left: 10px;
    }
  }
}


</style>
