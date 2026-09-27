import { ref, nextTick } from '@common/utils/vueTools'
import { replaceListMusic } from '@renderer/store/list/listManage'
import { playListById } from '@renderer/core/player'
import { playMusicInfo } from '@renderer/store/player/state'
import { userLists } from '@renderer/store/list/state'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'

export default (props, list) => {
  const isShowMusicToggleModal = ref(false)
  const musicInfo = ref(null)
  const selectedToggleSource = ref('')
  const t = useI18n()
  let targetListId = null
  const changing = ref(false)

  const handleShowMusicToggleModal = (index) => {
    musicInfo.value = list.value[index]
    if (!musicInfo.value) return
    targetListId = props.listId
    selectedToggleSource.value = userLists.find(list => list.id === targetListId)?.source ?? musicInfo.value.source
    nextTick(() => {
      if (targetListId === props.listId) isShowMusicToggleModal.value = true
    })
  }

  const toggleSource = async(toggleMusicInfo) => {
    if (changing.value || !isShowMusicToggleModal.value || !toggleMusicInfo || !musicInfo.value || toggleMusicInfo.id === musicInfo.value.id) return
    if (targetListId !== props.listId) { isShowMusicToggleModal.value = false; return }
    changing.value = true
    const listId = targetListId
    const oldId = musicInfo.value.id
    try {
      let result = await replaceListMusic(listId, oldId, toggleMusicInfo)
      if (result === 'duplicate') {
        if (!await dialog.confirm({
          message: t('music_toggle_duplicate_tip'),
          cancelButtonText: t('cancel_button_text'),
          confirmButtonText: t('confirm_button_text'),
        })) return
        if (props.listId !== listId || !isShowMusicToggleModal.value) return
        result = await replaceListMusic(listId, oldId, toggleMusicInfo, true)
      }
      isShowMusicToggleModal.value = false
      if (result === 'missing') { await dialog.error({ message: t('music_toggle_missing') }); return }
      if (playMusicInfo.listId === listId && playMusicInfo.musicInfo?.id === oldId) playListById(listId, toggleMusicInfo.id)
    } catch {
      await dialog.error({ message: t('music_toggle_failed') })
    } finally { changing.value = false }
  }

  return {
    isShowMusicToggleModal,
    selectedToggleMusicInfo: musicInfo,
    selectedToggleSource,
    handleShowMusicToggleModal,
    toggleSource,
  }
}
