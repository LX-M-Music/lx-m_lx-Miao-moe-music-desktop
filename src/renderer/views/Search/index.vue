<template>
  <div :class="$style.container">
    <div :class="$style.header">
      <div ref="dom_sourceTabs" :class="$style.sourceTabs" data-search-sources>
        <base-tab :model-value="source" :list="sources" @change="handleSourceChange" />
      </div>
      <base-tab :class="$style.typeTabs" :model-value="searchType" :list="searchTypes" @change="handleTypeChange" />
    </div>
    <common-motion-view :class="$style.main" :motion-key="`${source}:${searchType}:${page}:${searchText}`">
      <song-list-list v-if="searchType == 'songlist'" v-show="searchText" :page="page" :source-id="source" />
      <entity-list
        v-else-if="searchType == 'singer' || searchType == 'album'" v-show="searchText"
        :type="searchType" :page="page" :source-id="source"
      />
      <music-list v-else v-show="searchText" :page="page" :source-id="source" />
      <blank-view :visible="!searchText" :source="source" />
    </common-motion-view>
  </div>
</template>

<script>
import { useRoute, useRouter } from '@common/utils/vueRouter'
import { searchText } from '@renderer/store/search/state'
import { getSearchSetting, setSearchSetting } from '@renderer/utils/data'
import { sources as _sources } from '@renderer/store/search/music'
import { sources as _entitySources } from '@renderer/store/search/entity'
import { sources as _songlistSources } from '@renderer/store/search/songlist'
import { initMusicFreeSources } from '@renderer/store/musicFree'

import MusicList from './MusicList/index.vue'
import SongListList from './SongListList/index.vue'
import EntityList from './EntityList/index.vue'
import BlankView from './components/BlankView.vue'
import { computed, ref, watch, onMounted } from '@common/utils/vueTools'
import { sourceNames } from '@renderer/store'

const source = ref('kw')
const searchType = ref('music')
const page = ref(1)
const searchTypeIds = ['music', 'songlist', 'singer', 'album']
const normalizeType = type => searchTypeIds.includes(type) ? type : 'music'
const getTypeSources = type => type == 'singer' || type == 'album' ? _entitySources : type == 'songlist' ? _songlistSources : _sources
const normalizeSource = (source, type) => getTypeSources(type).includes(source) ? source : 'all'
const getQueryValue = value => Array.isArray(value) ? value[0] : value
const normalizePage = value => {
  const parsedPage = Number(value)
  return Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
}

const verifyQueryParams = async(to, from, next) => {
  await initMusicFreeSources().catch(error => { console.warn('MusicFree sources:', error) })
  let _source = getQueryValue(to.query.source)
  let _type = getQueryValue(to.query.type)
  const _page = getQueryValue(to.query.page)
  const _text = getQueryValue(to.query.text)

  if (_source == null || _type == null) {
    try {
      const setting = await getSearchSetting()
      _type ??= setting.type
      _source ??= setting.source
    } catch (error) {
      console.log(error)
      _type ??= searchType.value
      _source ??= source.value
    }
  }

  const normalizedType = normalizeType(_type)
  const normalizedSource = normalizeSource(_source, normalizedType)
  const normalizedPage = normalizePage(_page)
  const needsRedirect = to.query.type == null || to.query.source == null || Array.isArray(to.query.type) ||
    Array.isArray(to.query.source) || Array.isArray(to.query.page) || Array.isArray(to.query.text) ||
    normalizedType != _type || normalizedSource != _source || (_page != null && String(normalizedPage) != _page)
  if (needsRedirect) {
    next({
      path: to.path,
      query: {
        ...to.query,
        source: normalizedSource,
        type: normalizedType,
        page: _page == null ? undefined : normalizedPage,
        text: _text,
      },
    })
    return
  }
  source.value = normalizedSource
  searchType.value = normalizedType
  page.value = normalizedPage

  if (_text != null) {
    searchText.value = _text
    if (!_page) page.value = 1
  }
  next()
  void setSearchSetting({ source: normalizedSource, type: normalizedType })
}

export default {
  components: {
    MusicList,
    SongListList,
    EntityList,
    BlankView,
  },
  beforeRouteEnter: verifyQueryParams,
  beforeRouteUpdate: verifyQueryParams,
  setup() {
    const route = useRoute()
    const router = useRouter()
    const dom_sourceTabs = ref(null)
    const revealSource = () => dom_sourceTabs.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    onMounted(revealSource)
    watch([source, searchType], revealSource, { flush: 'post' })

    const sources = computed(() => {
      return getTypeSources(searchType.value).map(id => {
        return {
          id,
          label: sourceNames.value[id],
        }
      })
    })
    const handleSourceChange = (id) => {
      void router.replace({
        path: route.path,
        query: {
          ...route.query,
          source: id,
          page: 1,
        },
      })
    }

    const searchTypes = computed(() => {
      return [
        { label: window.i18n.t('search__type_music'), id: 'music' },
        { label: window.i18n.t('search__type_singer'), id: 'singer' },
        { label: window.i18n.t('search__type_album'), id: 'album' },
        { label: window.i18n.t('search__type_songlist'), id: 'songlist' },
      ]
    })
    const handleTypeChange = (type) => {
      void router.replace({
        path: route.path,
        query: {
          ...route.query,
          type,
          source: normalizeSource(source.value, type),
          page: 1,
        },
      })
    }


    return {
      dom_sourceTabs,
      sources,
      source,
      handleSourceChange,
      searchTypes,
      searchType,
      handleTypeChange,
      page,
      searchText,
    }
  },
}


</script>

<style lang="less" module>
.container {
  display: flex;
  flex-flow: column nowrap;
}

.header {
  // padding: 5px 0;
  flex: none;
  display: flex;
  flex-flow: row nowrap;
  justify-content: space-between;
}

.sourceTabs {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: thin;
  :global(ul) { width: max-content; }
  :global(li) { flex: none; white-space: nowrap; }
}
.typeTabs { flex: none; }

.main {
  position: relative;
  flex: auto;
  // min-height: 0;
}
</style>
