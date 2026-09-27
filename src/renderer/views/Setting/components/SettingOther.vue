<template lang="pug">
dt#other {{ $t('setting__other') }}
dd
  div
    .gap-top
      base-checkbox(id="setting_transparent_window" :model-value="appSetting['common.transparentWindow']" :label="$t('setting__other_transparent_window')" @update:model-value="updateSetting({'common.transparentWindow': $event})")
      svg-icon(class="help-icon" name="help-circle-outline" :aria-label="$t('setting__other_transparent_window_tip')")

dd
  h3#other_tray_theme {{ $t('setting__other_tray_theme') }}
  div.setting-options
    base-checkbox.gap-left(
      v-for="item in trayThemeList" :id="'setting_tray_theme_' + item.id" :key="item.id" :model-value="appSetting['tray.themeId']" name="setting_tray_theme"
      need :label="item.label" :value="item.id" @update:model-value="updateSetting({'tray.themeId': $event})")
dd
  h3#other_resource_cache
    | {{ $t('setting__other_resource_cache') }}
    svg-icon(class="help-icon" name="help-circle-outline" :aria-label="$t('setting__other_resource_cache_tip')")
  CacheManager

dd
  h3#other_dislike_list {{ $t('setting__other_dislike_list') }}
  div
    .p
      | {{ $t('setting__other_dislike_list_label') }}
      span.auto-hidden {{ dislikeRuleCount }}
    .p
      base-btn.btn(min @click="isShowDislikeList = true") {{ $t('setting__other_dislike_list_show_btn') }}
  DislikeListModal(v-model="isShowDislikeList")

dd
  h3#other_lyric_edited {{ $t('setting__other_lyric_edited_cache') }}
  div
    .p
      | {{ $t('setting__other_lyric_edited_label') }}
      span.auto-hidden {{ lyricEditedCount }}
    .p
      base-btn.btn(min :disabled="isDisabledLyricEditedCacheClear" @click="handleClearLyricEditedCache") {{ $t('setting__other_lyric_edited_clear_btn') }}

dd
  h3#other_listdata {{ $t('setting__other_listdata') }}
  div
    .p
      base-btn.btn(min @click="handleClearListData") {{ $t('setting__other_listdata_clear_btn') }}

</template>

<script>
import { ref, computed } from '@common/utils/vueTools'
import { getLyricEditedCount, clearLyricEdited } from '@renderer/utils/ipc'
import { formatError } from '@common/utils/errorMessage'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { overwriteListFull } from '@renderer/store/list/listManage'
import { dislikeRuleCount } from '@renderer/store/dislikeList'
import DislikeListModal from './DislikeListModal.vue'
import CacheManager from './CacheManager.vue'
import { TRAY_AUTO_ID } from '@common/constants'

export default {
  name: 'SettingOther',
  components: {
    CacheManager,
    DislikeListModal,
  },
  setup() {
    const t = useI18n()

    const trayThemeList = computed(() => {
      return [
        { id: 0, name: 'native', label: t('setting__other_tray_theme_native') },
        { id: 2, name: 'black', label: t('setting__other_tray_theme_black') },
        { id: 1, name: 'origin', label: t('setting__other_tray_theme_origin') },
        { id: TRAY_AUTO_ID, name: 'auto', label: t('setting__other_tray_theme_auto') },
      ]
    })

    const isShowDislikeList = ref(false)


    const lyricEditedCount = ref(0)
    const isDisabledLyricEditedCacheClear = ref(false)
    const refreshLyricEditedCount = () => {
      void getLyricEditedCount().then(count => {
        lyricEditedCount.value = count
      }).catch(error => { void dialog.error({ message: formatError(error, '读取自定义歌词失败') }) })
    }
    const handleClearLyricEditedCache = async() => {
      if (!await dialog.confirm({
        message: t('setting__other_lyric_edited_clear_tip_confirm'),
        cancelButtonText: t('cancel_button_text'),
        confirmButtonText: t('setting__other_resource_cache_confirm'),
      })) return
      isDisabledLyricEditedCacheClear.value = true
      try { await clearLyricEdited(); refreshLyricEditedCount() } catch (error) { void dialog.error({ message: formatError(error, '清理自定义歌词失败') }) } finally { isDisabledLyricEditedCacheClear.value = false }
    }
    refreshLyricEditedCount()

    const handleClearListData = async() => {
      if (!await dialog.confirm({
        message: t('setting__other_listdata_clear_tip_confirm'),
        cancelButtonText: t('cancel_button_text'),
        confirmButtonText: t('setting__other_resource_cache_confirm'),
      })) return
      void overwriteListFull({
        defaultList: [],
        loveList: [],
        userList: [],
        tempList: [],
      })
    }

    return {
      appSetting,
      updateSetting,
      trayThemeList,

      dislikeRuleCount,
      isShowDislikeList,


      lyricEditedCount,
      isDisabledLyricEditedCacheClear,
      handleClearLyricEditedCache,

      handleClearListData,
    }
  },
}
</script>
