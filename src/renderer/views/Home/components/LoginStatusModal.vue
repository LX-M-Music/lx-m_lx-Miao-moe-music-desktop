<template>
  <material-modal :show="props.show" @close="handleClose">
    <main :class="$style.main">
      <h2>{{ $t('home2__login_title') }}</h2>
      <p :class="$style.desc">{{ $t('home2__login_desc') }}</p>
      <ul :class="$style.list">
        <li v-for="item in items" :key="item.source" :class="$style.item">
          <span :class="$style.dot" :data-state="loginStatus[item.source]" />
          <div :class="$style.info">
            <strong>{{ item.name }}</strong>
            <span :class="$style.stateText">{{ $t('home2__state_' + loginStatus[item.source]) }}</span>
          </div>
          <div :class="$style.actions">
            <base-btn :class="$style.btn" min :disabled="!!platformLoginStates[item.source]?.mode" @click="handleLogin(item.source, 'embedded')">
              {{ platformLoginStates[item.source]?.mode == 'embedded' ? $t('home2__login_running') : $t('home2__login_embedded') }}
            </base-btn>
            <base-btn :class="$style.btn" min :disabled="platformLoginStates[item.source]?.mode == 'browser'" @click="handleLogin(item.source, 'browser')">{{ platformLoginStates[item.source]?.mode == 'browser' ? $t('home2__login_running') : $t('home2__login_browser') }}</base-btn>
            <base-btn :class="$style.btn" min outline :disabled="!!platformLoginStates[item.source]?.mode || loginStatus[item.source] == 'none'" @click="handleClear(item.source)">{{ $t('home2__login_clear') }}</base-btn>
          </div>
        </li>
      </ul>
      <p :class="$style.tip">{{ $t('home2__login_tip') }}</p>
    </main>
  </material-modal>
</template>

<script setup lang="ts">
import { COOKIE_SOURCES, SOURCE_NAME, type CookieSource } from '@renderer/utils/cookieManager'
import { clearCookie, loginStatus } from '@renderer/store/loginStatus'
import { clearPlatformLoginState, loginPlatform, platformLoginStates, type PlatformLoginMode } from '@renderer/store/platformLogin'
import { syncCookiePlaylists } from '@renderer/utils/cookieSync'
import showToast from '@renderer/plugins/Toast'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'changed', source: CookieSource): void
}>()

const items = COOKIE_SOURCES.map(source => ({
  source,
  name: SOURCE_NAME[source],
}))

const handleClose = () => {
  emit('close')
}

const handleLogin = async(source: CookieSource, mode: PlatformLoginMode) => {
  try {
    const result = await loginPlatform(source, mode)
    if (!result) return
    emit('changed', source)
    handleClose()
    // 登录成功后立即同步该平台收藏歌单（沿用 Cookie 同步链路），结果仅提示
    void syncCookiePlaylists(source, result.playlists).then(result => {
      if (result.synced) showToast(window.i18n.t('home2__import_synced', { n: String(result.count) }))
    }).catch(err => {
      console.log('sync playlists after login failed:', err)
    })
  } catch (error: any) {
    showToast(error?.message || window.i18n.t('home2__login_failed'))
  }
}

const handleClear = async(source: CookieSource) => {
  await clearCookie(source)
  clearPlatformLoginState(source)
  emit('changed', source)
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 20px;
  min-width: 480px;
  h2 {
    margin: 0 0 6px;
    font-size: 16px;
  }
}
.desc {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--color-font-label);
}
.list {
  display: flex;
  flex-flow: column nowrap;
  gap: 10px;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background-color: var(--color-primary-light-400-alpha-700);
}
.dot {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background-color: var(--color-450);

  &[data-state='valid'] {
    background-color: var(--color-success);
  }
  &[data-state='invalid'] {
    background-color: var(--color-warning);
  }
}
.info {
  flex: auto;
  min-width: 0;
  display: flex;
  flex-flow: column nowrap;
  gap: 2px;
  strong {
    font-size: 14px;
  }
  .stateText {
    font-size: 12px;
    color: var(--color-font-label);
  }
}
.actions {
  flex: none;
  display: flex;
  gap: 6px;
}
.btn {
  white-space: nowrap;
}
.tip {
  margin: 14px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-font-label);
}
</style>
