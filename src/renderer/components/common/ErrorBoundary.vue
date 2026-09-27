<template>
  <div class="view-container" :class="$style.root">
    <div v-if="errorInfo" :class="$style.container">
      <div :class="$style.card">
        <svg-icon name="help-circle-outline" :class="$style.icon" />
        <h2 :class="$style.title">{{ $t('error_view__title') }}</h2>
        <div v-if="appSetting['common.showErrorDialog']" :class="$style.detail">
          <p :class="$style.row">
            <span :class="$style.label">{{ $t('error_view__reason') }}</span>
            <span :class="$style.value" :title="errorInfo?.message">{{ errorInfo?.message }}</span>
          </p>
          <p :class="$style.row">
            <span :class="$style.label">{{ $t('error_view__code') }}</span>
            <span :class="$style.value" :title="errorInfo?.code">{{ errorInfo?.code }}</span>
          </p>
        </div>
        <p :class="$style.tip">{{ $t('error_view__tip') }}</p>
        <div :class="$style.actions">
          <base-btn min @click="handleRetry">{{ $t('error_view__retry') }}</base-btn>
          <base-btn min outline @click="handleBackHome">{{ $t('error_view__back_home') }}</base-btn>
        </div>
      </div>
    </div>
    <slot v-else />
  </div>
</template>

<script setup lang="ts">
import { onErrorCaptured, ref, watch } from '@common/utils/vueTools'
import { useRoute, useRouter } from '@common/utils/vueRouter'
import { appSetting } from '@renderer/store/setting'

interface ErrorInfo {
  message: string
  code: string
}

const errorInfo = ref<ErrorInfo | null>(null)
const route = useRoute()
const router = useRouter()

onErrorCaptured((err: any, _instance, info) => {
  console.error(err)
  const error = err instanceof Error ? err : new Error(typeof err == 'string' ? err : 'Unknown error')
  errorInfo.value = {
    message: error.message || 'Unknown error',
    code: info ? `${error.name} · ${info}` : error.name,
  }
  return false
})

// 切换页面时自动恢复
watch(() => route.fullPath, () => {
  errorInfo.value = null
})

const handleRetry = () => {
  errorInfo.value = null
}

const handleBackHome = () => {
  void router.replace('/')
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.root {
  height: 100%;

  > :global(.view-container) {
    height: 100%;
    width: 100%;
  }
}

.container {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card {
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  max-width: 480px;
  padding: 32px;
  text-align: center;
}

.icon {
  width: 56px;
  height: 56px;
  color: var(--color-font-label);
  opacity: .6;
}

.title {
  margin: 16px 0 0;
  font-size: 18px;
  font-weight: normal;
  color: var(--color-font);
}

.detail {
  width: 100%;
  margin-top: 16px;
  padding: 12px 16px;
  border-radius: var(--radius-md);
  background-color: var(--color-content-background);
  text-align: left;
}

.row {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.6;
  + .row {
    margin-top: 6px;
  }
}

.label {
  flex: none;
  color: var(--color-font-label);
}

.value {
  flex: 1;
  min-width: 0;
  color: var(--color-font);
  word-break: break-all;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}

.tip {
  margin-top: 16px;
  font-size: 13px;
  color: var(--color-font-label);
}

.actions {
  display: flex;
  gap: 12px;
  margin-top: 20px;
}
</style>
