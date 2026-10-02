<template lang="pug">
dt#play_detail {{ $t('setting__play_detail') }}
dd
  .gap-top
    base-checkbox(id="setting_play_detail_font_zoom_enable" :model-value="appSetting['playDetail.isZoomActiveLrc']" :label="$t('setting__play_detail_font_zoom')" @update:model-value="updateSetting({'playDetail.isZoomActiveLrc': $event})")
  .gap-top
    base-checkbox(id="setting_play_detail_lyric_delayScroll" :model-value="appSetting['playDetail.isDelayScroll']" :label="$t('setting__play_detail_lyric_delay_scroll')" @update:model-value="updateSetting({ 'playDetail.isDelayScroll': $event })")
  .gap-top
    base-checkbox(id="setting_play_detail_lyric_progress_enable" :model-value="appSetting['playDetail.isShowLyricProgressSetting']" :label="$t('setting__play_detail_lyric_progress')" @update:model-value="updateSetting({'playDetail.isShowLyricProgressSetting': $event})")

dd(data-setting-search="setting__play_detail_font_weight")
  h3#play_detail_font_weight
    | {{ $t('setting__play_detail_font_weight') }}
    svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__play_detail_font_weight_tip')")
  .p.gap-top.setting-slider-row
    span.setting-value {{ appSetting['playDetail.style.fontWeight'] }}
    base-slider-bar.setting-slider(
      id="setting_play_detail_font_weight"
      :value="appSetting['playDetail.style.fontWeight']"
      :min="100" :max="900" :step="100"
      :aria-label="$t('setting__play_detail_font_weight')"
      @change="updateSetting({ 'playDetail.style.fontWeight': $event })"
    )
    base-btn.gap-left(type="button" :disabled="appSetting['playDetail.style.fontWeight'] === 400" @click="updateSetting({ 'playDetail.style.fontWeight': 400 })") {{ $t('setting__play_detail_font_weight_reset') }}

dd
  h3#play_detail_align {{ $t('setting__play_detail_align') }}
  div.setting-options
    base-checkbox.gap-left(id="setting_play_detail_align_left" :model-value="appSetting['playDetail.style.align']" need value="left" :label="$t('setting__play_detail_align_left')" @update:model-value="updateSetting({ 'playDetail.style.align': $event })")
    base-checkbox.gap-left(id="setting_play_detail_align_center" :model-value="appSetting['playDetail.style.align']" need value="center" :label="$t('setting__play_detail_align_center')" @update:model-value="updateSetting({ 'playDetail.style.align': $event })")
    base-checkbox.gap-left(id="setting_play_detail_align_right" :model-value="appSetting['playDetail.style.align']" need value="right" :label="$t('setting__play_detail_align_right')" @update:model-value="updateSetting({ 'playDetail.style.align': $event })")

</template>

<script>
// import { ref, onBeforeUnmount } from '@common/utils/vueTools'
import { appSetting, updateSetting } from '@renderer/store/setting'

export default {
  name: 'SettingPlayDetail',
  setup() {
    return {
      appSetting,
      updateSetting,
    }
  },
}
</script>
