<template>
  <div id="my-list" :class="$style.container" @click="handleContainerClick">
    <common-resizable-sidebar name="myList" :label="$t('my_list')">
      <MyList ref="myList" :list-id="listId" @show-menu="$refs.musicList?.handleMenuClick()" />
    </common-resizable-sidebar>
    <common-motion-view :motion-key="listId">
      <ListeningHistory v-if="listId === HISTORY_ID" @show-menu="$refs.myList.handleMenuClick()" />
      <MusicList v-else ref="musicList" :list-id="listId" @show-menu="$refs.myList.handleMenuClick()" />
    </common-motion-view>
  </div>
</template>

<script>
import { getListPrevSelectId } from '@renderer/utils/data'
import { LIST_IDS } from '@common/constants'

import MyList from './MyList/index.vue'
import MusicList from './MusicList/index.vue'
import ListeningHistory from './ListeningHistory.vue'

export default {
  name: 'List',
  components: {
    MyList,
    MusicList,
    ListeningHistory,
  },
  async beforeRouteEnter(to, from, next) {
    let id = to.query.id
    if (!id) {
      id = await getListPrevSelectId()
      next({
        path: to.path,
        query: { id },
      })
    } else next()
  },
  beforeRouteUpdate(to, from) {
    // console.log(to, from)
    if (to.query.updated) return
    let id = to.query.id
    if (id == null) return
    // if (!getList(id)) {
    //   id = defaultList.id
    // }
    this.listId = id
    const scrollIndex = to.query.scrollIndex
    const isAnimation = from.query.id == to.query.id
    this.$refs.musicList?.handleRestoreScroll(scrollIndex, isAnimation)

    return {
      path: '/list',
      query: { id, updated: true },
    }
  },
  beforeRouteLeave(to, from) {
    this.$refs.musicList?.saveListPosition()
  },
  data() {
    return {
      listId: null,
      HISTORY_ID: LIST_IDS.HISTORY,
    }
  },
  created() {
    this.listId = this.$route.query.id
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  overflow: hidden;
  height: 100%;
  display: flex;
  position: relative;
}

</style>
