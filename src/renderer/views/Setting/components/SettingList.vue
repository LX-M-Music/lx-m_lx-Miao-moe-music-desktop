<template lang="pug">
dt#list {{ $t('setting__list') }}
dd
  .gap-top
    base-checkbox(id="setting_list_actionButtonsVisible_enable" :model-value="appSetting['list.actionButtonsVisible']" :label="$t('setting__list_action_btn')" @update:model-value="updateSetting({'list.actionButtonsVisible': $event})")
  .gap-top
    base-checkbox(id="setting_list_searchBar_enable" :model-value="appSetting['list.isShowSearchBar']" :label="$t('setting__list_search_bar')" @update:model-value="updateSetting({'list.isShowSearchBar': $event})")
  .gap-top
    base-checkbox(id="setting_list_showSource_enable" :model-value="appSetting['list.isShowSource']" :label="$t('setting__list_source')" @update:model-value="updateSetting({'list.isShowSource': $event})")
  .gap-top
    base-checkbox(id="setting_list_scroll_enable" :model-value="appSetting['list.isSaveScrollLocation']" :label="$t('setting__list_scroll')" @update:model-value="updateSetting({'list.isSaveScrollLocation': $event})")
  .gap-top
    base-checkbox(id="setting_list_clickAction_enable" :model-value="appSetting['list.isClickPlayList']" :label="$t('setting__list_click_action')" @update:model-value="updateSetting({'list.isClickPlayList': $event})")
dd
  h3#list_cover_size {{ $t('setting__list_cover_size') }}
  .setting-row
    input.gap-left(
      id="setting_list_cover_size"
      type="number"
      style="width: 80px; padding: 4px 8px; border: 1px solid var(--color-primary-light-200-alpha-700); border-radius: 4px; background: var(--color-main-background); color: var(--color-font); font-size: 13px;"
      :value="appSetting['list.coverSize']"
      min="20" max="100" step="1"
      @change="handleUpdateCoverSize"
    )
    span(style="font-size: 13px;") px
    span.setting-value(v-if="coverSizeHint") {{ coverSizeHint }}
dd
  h3#list_loading_mode {{ $t('setting__list_loading_mode') }}
  div(role="radiogroup" aria-labelledby="list_loading_mode")
    .gap-top.setting-options
      base-checkbox.gap-left(
        id="setting_list_loading_mode_together" name="setting_list_loading_mode" need
        :model-value="appSetting['list.loadingMode']" value="together" :label="$t('setting__list_loading_mode_together')"
        @update:model-value="updateSetting({'list.loadingMode': $event})")
    .gap-top.setting-options
      base-checkbox.gap-left(
        id="setting_list_loading_mode_progressive" name="setting_list_loading_mode" need
        :model-value="appSetting['list.loadingMode']" value="progressive" :label="$t('setting__list_loading_mode_progressive')"
        @update:model-value="updateSetting({'list.loadingMode': $event})")
    .gap-top.setting-options
      base-checkbox.gap-left(
        id="setting_list_loading_mode_immediate" name="setting_list_loading_mode" need
        :model-value="appSetting['list.loadingMode']" value="immediate" :label="$t('setting__list_loading_mode_immediate')"
        @update:model-value="updateSetting({'list.loadingMode': $event})")
dd(:aria-label="$t('setting__list_add_music_location_type')")
  h3#list_addMusicLocationType {{ $t('setting__list_add_music_location_type') }}
  div.setting-options
    base-checkbox.gap-left(
      id="setting_list_add_music_location_type_top" name="setting_list_add_music_location_type" need
      :model-value="appSetting['list.addMusicLocationType']" value="top" :label="$t('setting__list_add_music_location_type_top')"
      @update:model-value="updateSetting({'list.addMusicLocationType': $event})")
    base-checkbox.gap-left(
      id="setting_list_add_music_location_type_bottom" name="setting_list_add_music_location_type" need
      :model-value="appSetting['list.addMusicLocationType']" value="bottom" :label="$t('setting__list_add_music_location_type_bottom')"
      @update:model-value="updateSetting({'list.addMusicLocationType': $event})")

</template>

<script>
import { onBeforeUnmount, ref } from '@common/utils/vueTools'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { useI18n } from '@renderer/plugins/i18n'

export default {
  name: 'SettingList',
  setup() {
    const t = useI18n()
    const coverSizeHint = ref('')
    let coverSizeHintTimer

    const clearCoverSizeHint = () => {
      if (coverSizeHintTimer) clearTimeout(coverSizeHintTimer)
      coverSizeHintTimer = null
      coverSizeHint.value = ''
    }
    const showCoverSizeHint = (key) => {
      clearCoverSizeHint()
      coverSizeHint.value = t(key)
      coverSizeHintTimer = setTimeout(clearCoverSizeHint, 3000)
    }

    const handleUpdateCoverSize = (event) => {
      let size = parseInt(event.target.value)
      if (isNaN(size)) {
        size = appSetting['list.coverSize']
      }
      if (size < 20) {
        size = 20
        showCoverSizeHint('setting__list_cover_size_min')
      } else if (size > 100) {
        size = 100
        showCoverSizeHint('setting__list_cover_size_max')
      } else {
        clearCoverSizeHint()
      }
      event.target.value = size
      void updateSetting({ 'list.coverSize': size })
    }

    onBeforeUnmount(clearCoverSizeHint)

    return {
      appSetting,
      updateSetting,
      coverSizeHint,
      handleUpdateCoverSize,
    }
  },
}
</script>
