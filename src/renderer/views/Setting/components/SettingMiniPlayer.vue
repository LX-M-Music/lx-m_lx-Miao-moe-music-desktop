<template lang="pug">
dt#mini_player {{ $t('setting__mini_player') }}
dd
  .gap-top
    base-checkbox(id="setting_mini_player_enable" :model-value="appSetting['miniPlayer.enable']" :label="$t('setting__mini_player_enable')" @update:model-value="updateSetting({ 'miniPlayer.enable': $event })")
  .gap-top
    base-checkbox(id="setting_mini_player_show_border" :model-value="appSetting['miniPlayer.showBorder']" :label="$t('mini_player__show_border')" @update:model-value="updateSetting({ 'miniPlayer.showBorder': $event })")
  .gap-top
    base-checkbox(id="setting_mini_player_hide_controls" :model-value="appSetting['miniPlayer.autoHideControls']" :label="$t('mini_player__hide_controls')" @update:model-value="updateSetting({ 'miniPlayer.autoHideControls': $event })")
  .gap-top
    base-checkbox(id="setting_mini_player_lock" :model-value="appSetting['miniPlayer.isLock']" :label="$t('mini_player__lock')" @update:model-value="updateSetting({ 'miniPlayer.isLock': $event })")
  .gap-top
    base-checkbox(id="setting_mini_player_top" :model-value="appSetting['miniPlayer.isAlwaysOnTop']" :label="$t('mini_player__pin')" @update:model-value="updateSetting({ 'miniPlayer.isAlwaysOnTop': $event })")
  common-setting-reveal(:show="appSetting['miniPlayer.isAlwaysOnTop']" depends="setting_mini_player_top")
    .gap-top
      base-checkbox(id="setting_mini_player_top_loop" :model-value="appSetting['miniPlayer.isAlwaysOnTopLoop']" :label="$t('setting__mini_player_top_loop')" @update:model-value="updateSetting({ 'miniPlayer.isAlwaysOnTopLoop': $event })")
  .gap-top
    base-checkbox(id="setting_mini_player_taskbar" :model-value="appSetting['miniPlayer.isShowTaskbar']" :label="$t('setting__mini_player_taskbar')" @update:model-value="updateSetting({ 'miniPlayer.isShowTaskbar': $event })")
  .gap-top
    base-checkbox(id="setting_mini_player_lock_screen" :model-value="appSetting['miniPlayer.isLockScreen']" :label="$t('setting__mini_player_lock_screen')" @update:model-value="updateSetting({ 'miniPlayer.isLockScreen': $event })")
  .gap-top
    base-checkbox(id="setting_mini_player_transparent" :model-value="appSetting['miniPlayer.backgroundOpacity'] === 0" :label="$t('mini_player__transparent')" @update:model-value="updateSetting({ 'miniPlayer.backgroundOpacity': $event ? 0 : 100 })")
  .gap-top
    base-checkbox(id="setting_mini_player_fullscreen" :model-value="appSetting['miniPlayer.fullscreenHide']" :label="$t('setting__mini_player_fullscreen_hide')" @update:model-value="updateSetting({ 'miniPlayer.fullscreenHide': $event })")
  .gap-top
    base-btn(min @click="updateSetting({ 'miniPlayer.x': null, 'miniPlayer.y': null, 'miniPlayer.width': 450, 'miniPlayer.height': 240 })") {{ $t('setting__mini_player_reset') }}

dd
  h3#mini_player_background_opacity {{ $t('setting__mini_player_background_opacity', { num: appSetting['miniPlayer.backgroundOpacity'] }) }}
  .p(:class="$style.backgroundControl")
    base-input(v-model="backgroundOpacity" :class="$style.backgroundInput" type="number" :min="0" :max="100" :step="1" aria-labelledby="mini_player_background_opacity" @change="changeBackgroundOpacity" @submit="changeBackgroundOpacity")
    span %
    base-btn(min @click="changeBackgroundOpacity(100)") {{ $t('setting__mini_player_background_opaque') }}
</template>
<script setup lang="ts">
import { ref, watch } from '@common/utils/vueTools'
import { appSetting, updateSetting } from '@renderer/store/setting'
const backgroundOpacity = ref(appSetting['miniPlayer.backgroundOpacity'])
watch(() => appSetting['miniPlayer.backgroundOpacity'], value => { backgroundOpacity.value = value })
const changeBackgroundOpacity = (value: string | number) => {
  const opacity = value === '' ? NaN : Number(value)
  const normalized = Number.isFinite(opacity) ? Math.min(100, Math.max(0, Math.round(opacity))) : appSetting['miniPlayer.backgroundOpacity']
  backgroundOpacity.value = normalized
  if (normalized !== appSetting['miniPlayer.backgroundOpacity']) void updateSetting({ 'miniPlayer.backgroundOpacity': normalized })
}
</script>
<style lang="less" module>
.backgroundControl { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.backgroundInput { width: 80px; max-width: 100%; }
</style>
