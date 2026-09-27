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

dd
  h3#advanced_experimental {{ $t('setting__advanced_experimental') }}
  p.p.gap-top(style="color: var(--color-500); font-size: 12px; line-height: 1.6;")
    | {{ $t('setting__advanced_experimental_tip') }}
  .gap-top
    base-checkbox(
      id="setting_advanced_experimental_new_home"
      :model-value="appSetting['experimental.newHome']"
      :label="$t('setting__advanced_experimental_new_home')"
      @update:model-value="updateSetting({ 'experimental.newHome': $event })"
    )
    svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__advanced_experimental_new_home_tip')")

dd
  h3#advanced_window_controls {{ $t('setting__advanced_window_controls') }}
  div.setting-options
    base-checkbox(
      v-for="item in windowControlStyleList" :id="`setting_advanced_window_controls_${item.id}`" :key="item.id"
      name="setting_advanced_window_controls" need :model-value="appSetting['ui.windowControlStyle']" :value="item.id"
      :label="item.label" @update:model-value="updateSetting({'ui.windowControlStyle': $event})")
  div.setting-options.gap-top
    base-checkbox(
      v-for="item in windowControlIconModeList" :id="`setting_advanced_window_controls_icon_${item.id}`" :key="item.id"
      name="setting_advanced_window_controls_icon" need :model-value="appSetting['ui.windowControlsIconMode']" :value="item.id"
      :label="item.label" @update:model-value="updateSetting({'ui.windowControlsIconMode': $event})")
    svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__advanced_window_controls_icon_tip')")
  //- 实时预览
  div.gap-top.setting-preview-row
    span.setting-label {{ $t('setting__advanced_window_controls_preview') }}
    span.control-preview(:class="{ traffic: appSetting['ui.windowControlStyle'] == 'traffic', 'icon-always': appSetting['ui.windowControlsIconMode'] == 'always' }")
      span.pv-dot.pv-close
        span.pv-icon ×
      span.pv-dot.pv-min
        span.pv-icon −
      span.pv-dot.pv-max
        span.pv-icon □

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
    const windowControlStyleList = [
      { id: 'default', label: window.i18n.t('setting__advanced_window_controls_default') },
      { id: 'traffic', label: window.i18n.t('setting__advanced_window_controls_traffic') },
    ]
    const windowControlIconModeList = [
      { id: 'always', label: window.i18n.t('setting__advanced_window_controls_icon_always') },
      { id: 'hover', label: window.i18n.t('setting__advanced_window_controls_icon_hover') },
    ]
    return {
      appSetting,
      updateSetting,
      gaplessValue,
      updateGapless,
      windowControlStyleList,
      windowControlIconModeList,
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
.setting-preview-row {
  display: flex;
  align-items: center;
  gap: 10px;
  .setting-label {
    font-size: 12px;
    color: var(--color-500);
  }
}
.control-preview {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--color-primary-light-400-alpha-700);

  .pv-dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background-color: var(--color-450);

    .pv-icon {
      font-size: 9px;
      line-height: 1;
      color: var(--color-500);
      opacity: 0;
      transition: opacity .15s;
    }
  }
  &.icon-always .pv-icon {
    opacity: 1;
  }
  &.traffic {
    .pv-close { background-color: #ff5f57; }
    .pv-min { background-color: #febc2e; }
    .pv-max { background-color: #28c840; }
    .pv-icon {
      color: #6b6f76;
      opacity: 1;
    }
  }
}
</style>
