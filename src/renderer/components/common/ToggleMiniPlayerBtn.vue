<template>
  <button type="button" :aria-label="$t(appSetting['miniPlayer.enable'] ? 'player__mini_player_off' : 'player__mini_player_on')" @click="updateSetting({ 'miniPlayer.enable': !appSetting['miniPlayer.enable'] })">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" :style="{ opacity: appSetting['miniPlayer.enable'] ? 1 : 'var(--player-control-opacity, .7)' }"><use xlink:href="#icon-mini-player" /></svg>
  </button>
</template>
<script setup>
import { appSetting, updateSetting } from '@renderer/store/setting'
</script>
