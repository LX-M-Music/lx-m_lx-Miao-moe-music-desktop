import { onMounted, onBeforeUnmount } from '@common/utils/vueTools'
import { useRoute, useRouter } from '@common/utils/vueRouter'
import { setListPosition, getListPosition } from '@renderer/utils/data'
import { appSetting } from '@renderer/store/setting'

export default ({ props, listRef, list, handleRestoreScroll, isSearching }) => {
  const route = useRoute()
  const router = useRouter()

  const saveListPosition = () => {
    if (isSearching?.value) return
    setListPosition(props.listId, listRef.value?.getScrollTop() || 0)
  }

  const handleScrollList = (index, isAnimation, callback = () => {}) => {
    listRef.value?.scrollToIndex(index, -150, isAnimation, callback)
  }

  const restoreScroll = async(index, isAnimation) => {
    if (isSearching?.value) return
    // console.log(index, isAnimation)
    if (!list.value.length) return
    if (index == null) {
      const id = props.listId
      let location = await getListPosition(id) || 0
      if (id !== props.listId || isSearching?.value) return
      if (appSetting['list.isSaveScrollLocation'] && location != null) {
        listRef.value?.scrollTo(location)
      }
      return
    }

    handleScrollList(index, isAnimation)
  }

  onMounted(() => {
    handleRestoreScroll(route.query.scrollIndex, false)
    if (route.query.scrollIndex != null) {
      router.replace({
        path: '/list',
        query: {
          id: props.listId,
          updated: true,
        },
      })
    }
  })
  onBeforeUnmount(() => {
    saveListPosition()
  })

  return {
    saveListPosition,
    restoreScroll,
  }
}
