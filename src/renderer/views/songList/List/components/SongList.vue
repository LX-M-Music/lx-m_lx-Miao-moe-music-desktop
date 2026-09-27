<template>
  <common-list-loading :load-key="props.listInfo.list" :loading="isLoading" :streaming="streaming" :class="$style.container">
    <div v-show="!props.listInfo.noItemLabel || (immediate && isLoading && props.listInfo.list.length)" ref="dom_list_ref" :class="$style.listContent" class="scroll">
      <ul>
        <li
          v-for="(item, index) in props.listInfo.list" :key="getItemKey(item)" :class="$style.item" role="button" tabindex="0"
          :aria-label="item.name" @click="toDetail(item)" @keydown.enter.space.prevent="toDetail(item)"
        >
          <div :class="$style.image">
            <common-cover-image v-if="item.img && !imageErrorSet.has(getItemKey(item))" :class="$style.img" :loading="Number(index) < 6 ? 'eager' : 'lazy'" :size="160" :src="item.img" :alt="item.name" @error="imageErrorSet.add(getItemKey(item))" />
            <svg v-else version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" space="preserve">
              <use xlink:href="#icon-music" />
            </svg>
          </div>
          <div :class="$style.desc">
            <h4>{{ item.name }}</h4>
            <div>
              <p :class="$style.author">{{ item.author }}</p>
              <p v-if="item.time" :class="$style.time">{{ item.time }}</p>
              <div :class="$style.songlist_info">
                <span v-if="item.total != null"><svg-icon name="music" />{{ item.total }}</span>
                <span v-if="item.play_count != null && item.play_count !== ''"><svg-icon name="headphones" />{{ item.play_count }}</span>
                <span v-if="visibleSource">{{ item.source }}</span>
              </div>
            </div>
          </div>
        </li>
        <li v-for="(i, index) in 6" :key="index" :class="$style.item" style="margin-bottom: 0;height: 0;" />
      </ul>
      <div :class="$style.pagination">
        <material-pagination :count="props.listInfo.total" :limit="props.listInfo.limit" :page="props.listInfo.page" @btn-click="togglePage" />
      </div>
    </div>
    <div
      v-show="props.listInfo.noItemLabel && !(immediate && isLoading)" :class="[$style.noitem, 'ui-state', { 'ui-state-error': isMessage(props.listInfo.noItemLabel, 'list__load_failed') }]"
      role="status" :aria-busy="isMessage(props.listInfo.noItemLabel, 'list__loading')"
    >
      <span v-if="isMessage(props.listInfo.noItemLabel, 'list__loading')" class="ui-spinner" />
      <p>{{ !appSetting['common.showErrorDialog'] && isMessage(props.listInfo.noItemLabel, 'list__load_failed') ? $t('list__load_failed') : props.listInfo.noItemLabel }}</p>
      <base-btn v-if="!props.hideRetry && isMessage(props.listInfo.noItemLabel, 'list__load_failed')" class="ui-state-retry" min @click="emit('retry')">{{ $t('reload') }}</base-btn>
    </div>
  </common-list-loading>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'
import type { ListInfo, ListInfoItem } from '@renderer/store/songList/state'
import { useRoute, useRouter } from '@common/utils/vueRouter'


const props = withDefaults(defineProps<{
  listInfo: ListInfo
  streaming?: boolean
  visibleSource?: boolean
  hideRetry?: boolean
  searchOnClick?: boolean
  searchResultType?: 'singer' | 'album'
}>(), {
  visibleSource: false,
  hideRetry: false,
  searchOnClick: false,
  searchResultType: 'singer',
})

const router = useRouter()
const route = useRoute()

const dom_list_ref = ref<HTMLElement | null>(null)
const imageErrorSet = reactive(new Set<string>())
const getItemKey = (item: ListInfoItem) => `${item.source}__${item.id}`
const isMessage = (text: string, key: 'list__loading' | 'list__load_failed') => Object.values(window.i18n.messages).some(messages => messages[key] == text || (key === 'list__load_failed' && text.startsWith(messages[key] + '\n')))
const isLoading = computed(() => isMessage(props.listInfo.noItemLabel, 'list__loading'))
const immediate = computed(() => props.streaming || appSetting['list.loadingMode'] === 'immediate')

const emit = defineEmits(['toggle-page', 'retry'])


const togglePage = (page: number) => {
  emit('toggle-page', page)
}

const toDetail = (info: ListInfoItem) => {
  if (props.searchOnClick) {
    const entityId = props.searchResultType == 'singer' ? `search__singer__${info.name}` : info.id
    void router.push({
      path: '/search/entity/detail',
      query: {
        source: info.source,
        type: props.searchResultType,
        id: entityId,
        name: info.name,
        author: info.author || undefined,
        picUrl: info.img || undefined,
        desc: info.desc ? info.desc : undefined,
        total: info.total ? info.total : undefined,
        page: 1,
        from: route.fullPath,
      },
    })
    return
  }
  void router.push({
    path: '/songList/detail',
    query: {
      source: info.source,
      id: info.id,
      picUrl: info.img,
      fromName: route.name as string,
    },
  })
}

defineExpose({
  scrollTo(top: number) {
    dom_list_ref.value?.scrollTo({
      top,
      // behavior: 'smooth',
    })
  },
  getScrollTop() {
    return dom_list_ref.value?.scrollTop ?? 0
  },
})


</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';
.container {
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  position: relative;
}

.listContent {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  font-size: 14px;
  box-sizing: border-box;
  padding: 15px 15px 0;

  ul {
    display: flex;
    flex-flow: row wrap;
    justify-content: space-between;
  }
}
.item {
  max-width: 360px;
  width: 32%;
  box-sizing: border-box;
  display: flex;
  // flex-flow: column nowrap;
  // padding: 10px;
  margin-bottom: 20px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  outline: none;
  transition: var(--duration-fast) var(--ease-standard);
  transition-property: color, opacity, box-shadow;
  &:hover {
    color: var(--color-accent);

    .img {
      transform: scale(1.025);
    }
  }
  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}
.image {
  flex: none;
  width: 40%;
  display: flex;
  background-position: center;
  background-size: cover;
  border-radius: var(--radius-md);
  overflow: hidden;
  opacity: .9;
  aspect-ratio: 1 / 1;

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

.desc {
  flex: auto;
  padding: 2px 15px 2px 7px;
  overflow: hidden;
  h4 {
    font-size: 14px;
    // height: 2.6em;
    text-align: justify;
    line-height: 1.3;
    .mixin-ellipsis-2();
  }
}
.songlist_info {
  display: flex;
  flex-flow: row nowrap;
  gap: 15px;
  margin-top: 8px;
  font-size: 12px;
  .mixin-ellipsis-1();
  text-align: justify;
  line-height: 1.2;
  // text-indent: 24px;
  color: var(--color-font-label);
  svg {
    margin-right: 2px;
  }
}
.author {
  margin-top: 6px;
  font-size: 12px;
  .mixin-ellipsis-1();
  text-align: justify;
  line-height: 1.3;
  // text-indent: 24px;
  color: var(--color-font-label);
}
.time {
  margin-top: 3px;
  font-size: 12px;
  .mixin-ellipsis-1();
  text-align: justify;
  line-height: 1.3;
  // text-indent: 24px;
  color: var(--color-font-label);
}
.pagination {
  text-align: center;
  padding: 15px 0;
  // left: 50%;
  // transform: translateX(-50%);
}
.noitem {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 100%;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  align-items: center;
  // background-color: var(--color-000);

  p {
    font-size: 24px;
    color: var(--color-font-label);
  }
}

</style>
