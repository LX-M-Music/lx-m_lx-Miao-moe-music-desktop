<template lang="pug">
dt#advanced
  | {{ $t('setting__advanced') }}
  svg-icon.help-icon(name="help-circle-outline" :aria-label="[$t('setting__advanced_desc'), $t('setting__advanced_nav_tip')].join(String.fromCharCode(10))")

dd
  h3#advanced_ui {{ $t('setting__advanced_ui') }}
  div
    .gap-top
      base-checkbox(
        id="setting_advanced_ui_smooth_anim"
        :model-value="appSetting['ui.smoothAnimation']"
        :label="$t('setting__advanced_ui_smooth_anim')"
        @update:model-value="updateSetting({ 'ui.smoothAnimation': $event })"
      )
      svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__advanced_ui_smooth_anim_tip')")

common-setting-reveal(tag="dd" :show="appSetting['ui.smoothAnimation']" data-setting-search="setting__advanced_ui_anim_speed" depends="setting_advanced_ui_smooth_anim")
  .p.gap-top.setting-slider-row
    .setting-label
      span {{ $t('setting__advanced_ui_anim_speed') }}
      svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__advanced_ui_anim_speed_tip')")
    span.setting-value {{ appSetting['ui.animationSpeed'] }}x
    base-slider-bar.setting-slider(
      :value="appSetting['ui.animationSpeed']"
      :min="0.5" :max="1.5" :step="0.1"
      @change="updateSetting({ 'ui.animationSpeed': $event })"
    )

dd
  h3#advanced_errors {{ $t('setting__advanced_errors') }}
  .gap-top
    base-checkbox(
      id="setting_advanced_show_error_dialog"
      :model-value="appSetting['common.showErrorDialog']"
      :label="$t('setting__advanced_show_error_dialog')"
      @update:model-value="updateSetting({ 'common.showErrorDialog': $event })"
    )
    svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__advanced_show_error_dialog_tip')")

dd
  h3#advanced_background {{ $t('setting__advanced_background') }}
  .gap-top
    base-checkbox(
      id="setting_advanced_background_enabled"
      :model-value="appSetting['ui.ambientBackground']"
      :label="$t('setting__advanced_background_enabled')"
      @update:model-value="updateSetting({ 'ui.ambientBackground': $event })"
    )
  common-setting-reveal(:show="appSetting['ui.ambientBackground']" depends="setting_advanced_background_enabled")
    .gap-top
      base-checkbox(
        id="setting_advanced_background_only_play_detail"
        :model-value="appSetting['ui.ambientBackgroundOnlyPlayDetail']"
        :label="$t('setting__advanced_background_only_play_detail')"
        @update:model-value="updateSetting({ 'ui.ambientBackgroundOnlyPlayDetail': $event })"
      )
    .gap-top
      base-checkbox(
        id="setting_advanced_background_auto_contrast"
        :model-value="appSetting['ui.ambientBackgroundAutoContrast']"
        :label="$t('setting__advanced_background_auto_contrast')"
        @update:model-value="updateSetting({ 'ui.ambientBackgroundAutoContrast': $event })"
      )
      svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__advanced_background_auto_contrast_tip')")
    .p.gap-top.setting-row
      label(for="setting_advanced_background_quality") {{ $t('setting__advanced_background_quality') }}
      select#setting_advanced_background_quality.gap-left(:value="appSetting['ui.ambientBackgroundQuality']" @change="updateSetting({ 'ui.ambientBackgroundQuality': $event.target.value })")
        option(value="static") {{ $t('setting__advanced_background_static') }}
        option(value="gentle") {{ $t('setting__advanced_background_gentle') }}
        option(value="full") {{ $t('setting__advanced_background_full') }}

dd
  h3#advanced_play {{ $t('setting__advanced_play') }}
  div
    .gap-top
      base-checkbox(
        id="setting_advanced_play_gapless"
        :model-value="gaplessValue"
        :label="$t('setting__advanced_play_gapless')"
        @update:model-value="updateGapless"
      )
      svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__advanced_play_gapless_tip')")
    common-setting-reveal(:show="gaplessValue" depends="setting_advanced_play_gapless")
      .gap-top
        base-checkbox(
          id="setting_advanced_play_fade"
          :model-value="appSetting['player.fadeInFadeOut']"
          :label="$t('setting__advanced_play_fade')"
          @update:model-value="updateSetting({ 'player.fadeInFadeOut': $event })"
        )
        svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__advanced_play_fade_tip')")
      common-setting-reveal(:show="appSetting['player.fadeInFadeOut']" depends="setting_advanced_play_fade")
        .p.gap-top.setting-slider-row
          .setting-label
            span {{ $t('setting__advanced_play_fade_duration') }}
            svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__advanced_play_fade_duration_tip')")
          span.setting-value {{ appSetting['player.fadeDuration'] }} ms
          base-slider-bar.setting-slider(
            :value="appSetting['player.fadeDuration']"
            :min="100" :max="3000" :step="100"
            @change="updateSetting({ 'player.fadeDuration': $event })"
          )

</template>

<script>
import { appSetting, updateSetting } from '@renderer/store/setting'
import { ref, watch } from '@common/utils/vueTools'

export default {
  name: 'SettingAdvanced',
  setup() {
    const gaplessValue = ref(appSetting['player.gaplessPlayback'])
    let pendingSaves = 0
    let saveQueue = Promise.resolve()
    watch(() => appSetting['player.gaplessPlayback'], value => {
      if (!pendingSaves) gaplessValue.value = value
    })
    const updateGapless = (value) => {
      gaplessValue.value = value
      pendingSaves++
      saveQueue = saveQueue.then(async() => {
        let saved = false
        try {
          await updateSetting({ 'player.gaplessPlayback': value })
          saved = true
        } catch { /* updateSetting already reports the write error. */ }
        pendingSaves--
        if (!pendingSaves && !saved) gaplessValue.value = appSetting['player.gaplessPlayback']
      })
    }
    return {
      appSetting,
      updateSetting,
      gaplessValue,
      updateGapless,
    }
  },
}
</script>

<style lang="less" scoped>
select {
  min-width: 156px;
  padding: 6px 10px;
  color: var(--color-font);
  background: var(--color-content-background);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
  &:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
}
</style>
