<template>
  <HomeModern v-if="appSetting['experimental.newHome']" />
  <HomeClassic v-else />
</template>

<script setup lang="ts">
import { appSetting } from '@renderer/store/setting'
import HomeClassic from './HomeClassic.vue'
import HomeModern from './HomeModern.vue'
</script>
