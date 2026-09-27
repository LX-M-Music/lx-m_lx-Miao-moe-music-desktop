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
        @input="handleCookieChange(item.id, $event.target.value)"
      )
    .p.setting-actions
      base-btn.btn(min :disabled="loginBusy(item.id)" @click="handleLogin(item)") {{ loginBusy(item.id) ? $t('setting__cookie_login_running') : $t('setting__cookie_login') }}
      base-btn.btn(min :disabled="testStates[item.id]?.busy || loginBusy(item.id) || syncing" @click="handleTestPlaylists(item.id)") {{ testStates[item.id]?.busy ? $t('setting__cookie_test_running') : $t('setting__cookie_test') }}
      base-btn.btn(min @click="handleClear(item.id)") {{ $t('setting__cookie_clear') }}
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
import { loginCookieEmbedded } from '@renderer/utils/ipc'

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
        testStates[id] = {
          busy: false,
          tip: result.status === 'success' ? t(`setting__cookie_test_${result.status}`, { count: String(result.listCount) }) : formatError(result.message ?? { code: `COOKIE_${result.status.toUpperCase()}`, message: t(`setting__cookie_test_${result.status}`) }, '', 'COOKIE_LOAD_FAILED'),
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
      resetTest(id)
      await updateSetting({ [item.settingKey]: '' })
    }

    const loginStates = reactive({})
    const loginBusy = (id) => loginStates[id]?.busy === true
    const loginTip = (id) => loginStates[id]?.tip ?? ''
    const loginError = (id) => loginStates[id]?.error === true

    const handleLogin = async(item) => {
      if (loginBusy(item.id)) return
      loginStates[item.id] = { busy: true, tip: '', error: false }
      try {
        // 一键登录使用软件内嵌登录窗口，完成后窗口自动关闭并回收 Cookie
        const { cookie, playlists } = await loginCookieEmbedded(item.id)
        appSetting[item.settingKey] = cookie
        resetTest(item.id)
        await updateSetting({ [item.settingKey]: cookie })
        loginStates[item.id] = { busy: false, tip: t('setting__cookie_login_done'), error: false }

        syncing.value = true
        syncTip.value = ''
        syncError.value = false
        try {
          const result = await syncCookiePlaylists(item.id, playlists)
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
      } catch (error) {
        loginStates[item.id] = { busy: false, tip: formatError(error, t('setting__cookie_login_failed'), 'COOKIE_LOGIN_FAILED'), error: true }
      }
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
