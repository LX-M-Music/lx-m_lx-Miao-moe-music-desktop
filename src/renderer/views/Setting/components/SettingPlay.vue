<template lang="pug">
dt#play {{ $t('setting__play') }}
dd
  .gap-top
    base-checkbox(id="setting_player_startup_auto_play" :model-value="appSetting['player.startupAutoPlay']" :label="$t('setting__play_startup_auto_play')" @update:model-value="updateSetting({'player.startupAutoPlay': $event})")
  .gap-top
    base-checkbox(id="setting_player_power_save_blocker" :model-value="appSetting['player.powerSaveBlocker']" :label="$t('setting__play_power_save_blocker')" @update:model-value="handleUpdatePowerSaveBlocker")
  .gap-top
    base-checkbox(id="setting_player_save_play_time" :model-value="appSetting['player.isSavePlayTime']" :label="$t('setting__play_save_play_time')" @update:model-value="updateSetting({'player.isSavePlayTime': $event})")
  .gap-top
    base-checkbox(id="setting_player_auto_clean_played_list" :model-value="appSetting['player.isAutoCleanPlayedList']" :label="$t('setting__play_auto_clean_played_list')" @update:model-value="updateSetting({'player.isAutoCleanPlayedList': $event})")
    svg-icon(class="help-icon" name="help-circle-outline" :aria-label="$t('setting__play_auto_clean_played_list_tip')")
  .gap-top
    base-checkbox(id="setting_player_lyric_transition" :model-value="appSetting['player.isShowLyricTranslation']" :label="$t('setting__play_lyric_transition')" @update:model-value="updateSetting({'player.isShowLyricTranslation': $event})")
  .gap-top
    base-checkbox(id="setting_player_lyric_roma" :model-value="appSetting['player.isShowLyricRoma']" :label="$t('setting__play_lyric_roma')" @update:model-value="updateSetting({'player.isShowLyricRoma': $event})")
  .gap-top
    base-checkbox(id="setting_player_awap_lyric_trans_roma" :model-value="appSetting['player.isSwapLyricTranslationAndRoma']" :label="$t('setting__player_swap_lyric_trans_roma')" @update:model-value="updateSetting({'player.isSwapLyricTranslationAndRoma': $event})")
  .gap-top
    base-checkbox(id="setting_player_auto_skip_on_error" :model-value="appSetting['player.autoSkipOnError']" :label="$t('setting__play_auto_skip_on_error')" @update:model-value="updateSetting({'player.autoSkipOnError': $event})")
  .gap-top
    base-checkbox(id="setting_player_lyric_s2t" :model-value="appSetting['player.isS2t']" :label="$t('setting__play_lyric_s2t')" @update:model-value="updateSetting({'player.isS2t': $event})")
  .gap-top
    base-checkbox(id="setting_player_lyric_play_lxlrc" :model-value="appSetting['player.isPlayLxlrc']" :label="$t('setting__play_lyric_lxlrc')" @update:model-value="updateSetting({'player.isPlayLxlrc': $event})")
    svg-icon(class="help-icon" name="help-circle-outline" :aria-label="$t('setting__play_lyric_lxlrc_tip')")
  .gap-top
    base-checkbox(id="setting_player_showTaskProgess" :model-value="appSetting['player.isShowTaskProgess']" :label="$t('setting__play_task_bar')" @update:model-value="updateSetting({'player.isShowTaskProgess': $event})")
  .gap-top(v-if="isMac")
    base-checkbox(id="setting_player_showStatusBarLyric" :model-value="appSetting['player.isShowStatusBarLyric']" :label="$t('setting__play_statusbar_lyric')" @update:model-value="updateSetting({'player.isShowStatusBarLyric': $event})")
    svg-icon(class="help-icon" name="help-circle-outline" :aria-label="$t('setting__play_statusbar_lyric_tip')")
  .gap-top
    base-checkbox(id="setting_player_isMaxOutputChannelCount" :model-value="isMaxOutputChannelCount" :label="$t('setting__play_max_output_channel_count')" @update:model-value="handleUpdateMaxOutputChannelCount")
  .gap-top
    base-checkbox(id="setting_player_isMediaDeviceRemovedStopPlay" :model-value="appSetting['player.isMediaDeviceRemovedStopPlay']" :label="$t('setting__play_mediaDevice_remove_stop_play')" @update:model-value="updateSetting({'player.isMediaDeviceRemovedStopPlay': $event})")

dd
  h3#basic_play_quality {{ $t('setting__play_playQuality') }}
  div.setting-options
    base-checkbox.gap-left(
      v-for="item in playQualityList" :id="`setting_play_quality_${item}`" :key="item"
      name="setting_play_quality" need :model-value="appSetting['player.playQuality']" :value="item" :label="item"
      @update:model-value="updateSetting({'player.playQuality': $event})")

dd
  h3#basic_play_max_volume
    | {{ $t('setting__play_max_volume') }}
    svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__play_max_volume_label')")
  .setting-row
    input.gap-left(
      type="number"
      style="width: 80px; padding: 4px 8px; border: 1px solid var(--color-primary-light-200-alpha-700); border-radius: 4px; background: var(--color-main-background); color: var(--color-font); font-size: 13px;"
      :value="maxVolumePercent"
      min="100" max="200" step="1"
      @change="handleUpdateMaxVolumeInput"
    )
    span(style="font-size: 13px;") %
    span.setting-value(v-if="maxVolumeHint") {{ maxVolumeHint }}

dd
  h3#play_volume_normalization
    | {{ $t('setting__play_volume_normalization') }}
    svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__play_volume_normalization_tip')")
  .setting-row
    base-checkbox(id="setting_player_volume_normalization" :model-value="appSetting['player.volumeNormalization']" :label="$t('setting__play_volume_normalization_enable')" @update:model-value="updateSetting({'player.volumeNormalization': $event})")

dd(:aria-label="$t('setting__play_mediaDevice_title')")
  h3#play_mediaDevice {{ $t('setting__play_mediaDevice') }}
  div.setting-row
    base-selection.gap-left(v-model="mediaDeviceId" :list="mediaDevices" item-key="deviceId" item-name="label" @change="handleMediaDeviceIdChnage")
</template>

<script>
import { ref, onBeforeUnmount, watch, computed } from '@common/utils/vueTools'
import { hasInitedAdvancedAudioFeatures, supportsAudioOutputDeviceSelection, setMediaDeviceId } from '@renderer/plugins/player'
import { visualizerInstalled } from '@renderer/store/optionalPlugins'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, saveMediaDeviceId, updateSetting } from '@renderer/store/setting'
import { setPowerSaveBlocker } from '@renderer/core/player/utils'
import { isPlay } from '@renderer/store/player/state'
import { TRY_QUALITYS_LIST } from '@renderer/core/music/utils'
import { isMac } from '@common/utils'


export default {
  name: 'SettingPlay',
  setup() {
    const t = useI18n()
    const playQualityList = [...TRY_QUALITYS_LIST, '128k'].reverse()

    const mediaDevices = ref([])
    const getMediaDevice = async() => {
      const devices = await navigator.mediaDevices.enumerateDevices()
      let audioDevices = devices.filter(device => device.kind === 'audiooutput')
      mediaDevices.value = audioDevices
      // console.log(this.mediaDevices)
    }
    void getMediaDevice()

    navigator.mediaDevices.addEventListener('devicechange', getMediaDevice)
    onBeforeUnmount(() => {
      navigator.mediaDevices.removeEventListener('devicechange', getMediaDevice)
    })

    const mediaDeviceId = ref(appSetting['player.mediaDeviceId'])
    const handleMediaDeviceIdChnage = async() => {
      if (hasInitedAdvancedAudioFeatures() && !supportsAudioOutputDeviceSelection()) {
        await dialog.error({
          message: t('setting__play_media_device_error_tip'),
          confirmButtonText: t('alert_button_text'),
        })
        mediaDeviceId.value = appSetting['player.mediaDeviceId']
      } else if (visualizerInstalled.value && appSetting['player.audioVisualization'] && !supportsAudioOutputDeviceSelection()) {
        const confirm = await dialog.confirm({
          message: t('setting__play_media_device_tip'),
          cancelButtonText: t('cancel_button_text'),
          confirmButtonText: t('confirm_button_text'),
        })
        if (confirm) {
          void updateSetting({
            'player.audioVisualization': false,
            'player.mediaDeviceId': mediaDeviceId.value,
          })
        } else {
          mediaDeviceId.value = appSetting['player.mediaDeviceId']
        }
      } else {
        appSetting['player.mediaDeviceId'] = mediaDeviceId.value
      }
    }
    watch(() => appSetting['player.mediaDeviceId'], val => {
      mediaDeviceId.value = val
    })

    const handleUpdatePowerSaveBlocker = (enabled) => {
      if (enabled) {
        if (isPlay.value) setPowerSaveBlocker(true, true)
      } else {
        setPowerSaveBlocker(false, true)
      }
      void updateSetting({ 'player.powerSaveBlocker': enabled })
    }

    const isMaxOutputChannelCount = ref(appSetting['player.isMaxOutputChannelCount'])
    const handleUpdateMaxOutputChannelCount = async(enabled) => {
      isMaxOutputChannelCount.value = enabled
      if (appSetting['player.mediaDeviceId'] != 'default') {
        const confirm = await dialog.confirm({
          message: t('setting__play_advanced_audio_features_tip'),
          cancelButtonText: t('cancel_button_text'),
          confirmButtonText: t('confirm_button_text'),
        })
        if (!confirm) {
          isMaxOutputChannelCount.value = false
          return
        }
        await setMediaDeviceId('default').catch(_ => _)
        saveMediaDeviceId('default')
      }
      void updateSetting({ 'player.isMaxOutputChannelCount': enabled })
    }

    const maxVolume = ref(appSetting['player.maxVolume'] ?? 1)
    const maxVolumePercent = computed(() => Math.trunc(maxVolume.value * 100))
    const maxVolumeHint = ref('')

    const handleUpdateMaxVolumeInput = (event) => {
      let pct = parseInt(event.target.value)
      if (isNaN(pct)) {
        pct = Math.trunc(maxVolume.value * 100)
      }
      if (pct < 100) {
        pct = 100
        maxVolumeHint.value = '最低支持 100%（不可低于 100%）'
        setTimeout(() => { maxVolumeHint.value = '' }, 3000)
      } else if (pct > 200) {
        pct = 200
        maxVolumeHint.value = '最高支持 200%（不可超过 200%）'
        setTimeout(() => { maxVolumeHint.value = '' }, 3000)
      } else {
        maxVolumeHint.value = ''
      }
      maxVolume.value = pct / 100
      void updateSetting({ 'player.maxVolume': maxVolume.value })
    }
    watch(() => appSetting['player.maxVolume'], (val) => {
      if (val != null) maxVolume.value = val
    })


    return {
      appSetting,
      updateSetting,
      mediaDevices,
      mediaDeviceId,
      handleMediaDeviceIdChnage,
      handleUpdatePowerSaveBlocker,
      isMaxOutputChannelCount,
      handleUpdateMaxOutputChannelCount,
      playQualityList,
      maxVolume,
      maxVolumePercent,
      maxVolumeHint,
      handleUpdateMaxVolumeInput,
      isMac,
    }
  },
}
</script>
