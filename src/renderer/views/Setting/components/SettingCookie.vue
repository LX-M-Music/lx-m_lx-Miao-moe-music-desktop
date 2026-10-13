<template lang="pug">
dt#cookie
  | {{ $t('setting__cookie') }}
  svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__cookie_desc')")
dd
  h3#cookie_sync {{ $t('setting__cookie_sync') }}
  div
    .gap-top
      base-checkbox(
        id="setting_cookie_enable_fav_list_sync"
        :model-value="appSetting['cookie.enableFavListSync']"
        :label="$t('setting__cookie_sync_fav_list')"
        @update:model-value="updateSetting({ 'cookie.enableFavListSync': $event })"
      )
      svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__cookie_sync_fav_list_tip')")
    .gap-top
      base-checkbox(
        id="setting_cookie_enable_play_history_sync"
        :model-value="appSetting['cookie.enablePlayHistorySync']"
        :label="$t('setting__cookie_sync_play_history')"
        @update:model-value="updateSetting({ 'cookie.enablePlayHistorySync': $event })"
      )
      svg-icon.help-icon(name="help-circle-outline" :aria-label="[$t('setting__cookie_sync_play_history_tip'), $t('setting__cookie_sync_play_history_unsupported')].join(String.fromCharCode(10))")
    .p.gap-top.setting-actions
      base-btn.btn(min :disabled="syncing" @click="handleSyncNow") {{ syncing ? $t('setting__cookie_sync_now_running') : $t('setting__cookie_sync_now') }}
      span(v-if="syncTip" :style="{ color: syncError ? 'var(--color-font-label)' : 'var(--color-primary)', fontSize: '12px' }") {{ syncTip }}

dd(v-for="item in sources" :key="item.id" :data-setting-search="`setting__cookie_source_${item.id}`")
  h3(:id="`cookie_${item.id}`") {{ item.name }}
  div
    .p
      textarea(
        :class="$style.cookieInput"
        :value="appSetting[item.settingKey]"
        :placeholder="item.placeholder"
        rows="3"
        spellcheck="false"
        :disabled="loginBusy(item.id)"
        @input="handleCookieChange(item.id, $event.target.value)"
      )
    .p.setting-actions
      base-btn.btn(min :disabled="loginBusy(item.id)" @click="handleLogin(item, 'embedded')") {{ loginMode(item.id) === 'embedded' ? $t('setting__cookie_login_running') : $t('home2__login_embedded') }}
      base-btn.btn(min :disabled="loginMode(item.id) === 'browser'" @click="handleLogin(item, 'browser')") {{ loginMode(item.id) === 'browser' ? $t('setting__cookie_login_running') : $t('home2__login_browser') }}
      base-btn.btn(min :disabled="testStates[item.id]?.busy || loginBusy(item.id) || syncing" @click="handleTestPlaylists(item.id)") {{ testStates[item.id]?.busy ? $t('setting__cookie_test_running') : $t('setting__cookie_test') }}
      base-btn.btn(min :disabled="loginBusy(item.id)" @click="handleClear(item.id)") {{ $t('setting__cookie_clear') }}
      span(v-if="appSetting[item.settingKey]" :style="{ color: isValid(item.id) ? 'var(--color-primary)' : 'var(--color-font-label)', fontSize: '12px' }")
        | {{ isValid(item.id) ? $t('setting__cookie_status_valid') : $t('setting__cookie_status_invalid') }}
      span(v-if="loginTip(item.id)" :style="{ color: loginError(item.id) ? 'var(--color-font-label)' : 'var(--color-primary)', fontSize: '12px' }") {{ loginTip(item.id) }}
    p(v-if="testStates[item.id]?.tip" role="status" :style="{ color: testStates[item.id].error ? 'var(--color-font-label)' : 'var(--color-primary)', fontSize: '12px' }") {{ testStates[item.id].tip }}

</template>

<script>
import { formatError } from '@common/utils/errorMessage'
import { reactive, ref } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, updateSetting } from '@renderer/store/setting'
import {
  SOURCE_NAME,
  isCookieValid,
} from '@renderer/utils/cookieManager'
import { checkCookiePlaylists, syncAllPlaylists, syncCookiePlaylists } from '@renderer/utils/cookieSync'
import { clearPlatformLoginState, loginPlatform, platformLoginStates } from '@renderer/store/platformLogin'
import { refreshLoginStatus } from '@renderer/store/loginStatus'

export default {
  name: 'SettingCookie',
  setup() {
    const t = useI18n()

    const sources = [
      { id: 'wy', name: SOURCE_NAME.wy, settingKey: 'cookie.wy', placeholder: 'MUSIC_U=xxx; __csrf=xxx; ...' },
      { id: 'tx', name: SOURCE_NAME.tx, settingKey: 'cookie.tx', placeholder: 'uin=xxx; qqmusic_key=xxx; ...' },
      { id: 'kg', name: SOURCE_NAME.kg, settingKey: 'cookie.kg', placeholder: 'KuGoo=KugooID=xxx&t=xxx; kg_mid=xxx; ...' },
      { id: 'kw', name: SOURCE_NAME.kw, settingKey: 'cookie.kw', placeholder: 'userid=xxx; kw_token=xxx; ...' },
      { id: 'mg', name: SOURCE_NAME.mg, settingKey: 'cookie.mg', placeholder: 'migu_music_sid=xxx; USER_ID=xxx; ...' },
    ]

    const isValid = (id) => isCookieValid(id)
    const testStates = reactive({})
    const resetTest = (id) => {
      testStates[id] = { busy: false, tip: '', error: false }
    }
    const handleTestPlaylists = async(id) => {
      if (testStates[id]?.busy) return
      const state = reactive({ busy: true, tip: '', error: false })
      testStates[id] = state
      const cookie = appSetting[`cookie.${id}`]
      try {
        const result = await checkCookiePlaylists(id)
        if (testStates[id] !== state || appSetting[`cookie.${id}`] !== cookie) return
        const message = t(`setting__cookie_test_${result.status}`, { count: String(result.listCount) })
        const failure = result.status === 'failed' && result.message
          ? result.message
          : { code: `COOKIE_${result.status.toUpperCase()}`, message }
        testStates[id] = {
          busy: false,
          tip: result.status === 'success' ? message : formatError(failure, '', 'COOKIE_LOAD_FAILED'),
          error: result.status !== 'success',
        }
      } catch (error) {
        if (testStates[id] !== state || appSetting[`cookie.${id}`] !== cookie) return
        testStates[id] = { busy: false, tip: formatError(error, t('setting__cookie_test_failed'), 'COOKIE_LOAD_FAILED'), error: true }
      }
    }

    const cookieSaveTimers = new Map()

    const saveCookie = (key, value) => {
      const timer = cookieSaveTimers.get(key)
      if (timer) clearTimeout(timer)
      cookieSaveTimers.set(key, setTimeout(() => {
        cookieSaveTimers.delete(key)
        void updateSetting({ [key]: value.trim() })
      }, 400))
    }

    const handleCookieChange = (id, value) => {
      const item = sources.find(s => s.id === id)
      if (!item) return
      appSetting[item.settingKey] = value
      clearPlatformLoginState(id)
      resetTest(id)
      saveCookie(item.settingKey, value)
    }

    const handleClear = async(id) => {
      const item = sources.find(s => s.id === id)
      if (!item) return
      const timer = cookieSaveTimers.get(item.settingKey)
      if (timer) {
        clearTimeout(timer)
        cookieSaveTimers.delete(item.settingKey)
      }
      appSetting[item.settingKey] = ''
      clearPlatformLoginState(id)
      resetTest(id)
      await updateSetting({ [item.settingKey]: '' })
      refreshLoginStatus()
    }

    const loginMode = (id) => platformLoginStates[id]?.mode
    const loginBusy = (id) => !!loginMode(id)
    const loginTip = (id) => platformLoginStates[id]?.error || (platformLoginStates[id]?.success ? t('setting__cookie_login_done') : '')
    const loginError = (id) => !!platformLoginStates[id]?.error

    const handleLogin = async(item, mode) => {
      const timer = cookieSaveTimers.get(item.settingKey)
      try {
        if (timer) {
          clearTimeout(timer)
          cookieSaveTimers.delete(item.settingKey)
          await updateSetting({ [item.settingKey]: appSetting[item.settingKey].trim() })
        }
        const loginResult = await loginPlatform(item.id, mode)
        if (!loginResult) return
        resetTest(item.id)

        syncing.value = true
        syncTip.value = ''
        syncError.value = false
        try {
          const result = await syncCookiePlaylists(item.id, loginResult.playlists)
          if (result.synced) {
            syncTip.value = t('setting__cookie_sync_now_done', { list: String(result.listCount), count: String(result.count) })
            syncError.value = !!result.error
            if (result.error) syncTip.value += '\n' + formatError(result.message, '', 'COOKIE_SYNC_FAILED')
          } else if (result.error) {
            syncError.value = true
            syncTip.value = formatError(result.message, t('setting__cookie_sync_now_failed'), 'COOKIE_SYNC_FAILED')
          } else {
            syncTip.value = t('setting__cookie_sync_now_skipped')
          }
        } catch (error) {
          syncError.value = true
          syncTip.value = formatError(error, t('setting__cookie_sync_now_failed'), 'COOKIE_SYNC_FAILED')
        } finally {
          syncing.value = false
        }
      } catch { /* The shared login state carries the error for this platform. */ }
    }

    const syncing = ref(false)
    const syncTip = ref('')
    const syncError = ref(false)

    const SOURCE_SHORT = { wy: '网易云', tx: 'QQ', kg: '酷狗', kw: '酷我', mg: '咪咕' }

    const buildSyncTip = (details = []) => {
      if (!details.length) return ''
      return details.map((d) => {
        const name = SOURCE_SHORT[d.source] ?? d.source
        if (d.status === 'success') {
          return d.listCount > 0
            ? `${name}✓(${d.listCount}/${d.count})`
            : `${name}✓`
        }
        return `${name}✗\n${formatError(d.message, '', 'COOKIE_SYNC_FAILED')}`
      }).join('  ')
    }

    const handleSyncNow = async() => {
      if (syncing.value) return
      syncing.value = true
      syncTip.value = ''
      syncError.value = false
      try {
        const result = await syncAllPlaylists()
        if (!result.synced) {
          syncError.value = true
          syncTip.value = result.details?.length ? buildSyncTip(result.details) : t('setting__cookie_sync_now_skipped')
        } else {
          syncTip.value = buildSyncTip(result.details)
          syncError.value = !!result.error
        }
      } catch (error) {
        syncError.value = true
        syncTip.value = formatError(error, t('setting__cookie_sync_now_failed'), 'COOKIE_SYNC_FAILED')
      } finally {
        syncing.value = false
      }
    }

    return {
      appSetting,
      updateSetting,
      sources,
      isValid,
      testStates,
      handleTestPlaylists,
      handleCookieChange,
      handleClear,
      loginBusy,
      loginMode,
      loginTip,
      loginError,
      handleLogin,
      syncing,
      syncTip,
      syncError,
      handleSyncNow,
    }
  },
}
</script>

<style lang="less" module>
.cookieInput {
  width: 100%;
  min-height: 60px;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid var(--color-primary-light-200-alpha-700);
  background-color: var(--color-main-background);
  color: var(--color-font);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
  transition: border-color 0.2s ease;

  &:focus {
    border-color: var(--color-primary);
  }

  &::placeholder {
    color: var(--color-font-label);
  }
}
</style>
