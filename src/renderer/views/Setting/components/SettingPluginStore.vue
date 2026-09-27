<template>
  <dt id="plugin_store">{{ $t('setting__plugins') }}<svg-icon class="help-icon" name="help-circle-outline" :aria-label="$t('setting__plugins_intro') + '\n' + $t('setting__plugins_preserve_settings')" /></dt>
  <dd>
    <div :class="$style.header">
      <div :class="$style.headerActions">
        <base-btn min :disabled="storeBusy" @click="transferPlugin()">{{ $t(pluginTransferBusy ? 'setting__plugins_working' : 'setting__plugins_import') }}</base-btn>
        <base-btn min :disabled="refreshing" @click="refresh">{{ $t(refreshing ? 'setting__plugins_refreshing' : 'setting__plugins_refresh') }}</base-btn>
      </div>
    </div>
    <p v-if="pluginTransferNotice" :class="$style.notice" :role="pluginTransferNotice.error ? 'alert' : 'status'" data-plugin-transfer-status>{{ pluginTransferNotice.message }}</p>
    <p v-if="pluginStore.catalogError || pluginStoreError" :class="$style.notice" role="status">{{ appSetting['common.showErrorDialog'] ? formatError(pluginStore.catalogError || pluginStoreError, $t('setting__plugins_catalog_error'), 'PLUGIN_CATALOG_LOAD_FAILED') : $t('setting__plugins_catalog_error') }}</p>
    <p v-if="!refreshing && !items.length" :class="$style.notice" role="status">{{ $t('setting__plugins_empty') }}</p>
    <div ref="grid" :class="$style.grid">
      <article v-for="item in items" :key="item.id" :class="[$style.card, { [$style.expanded]: expanded === item.id && item.hasSettings }]" :data-plugin-id="item.id" :data-setting-search="`plugin-card:${item.id}`">
        <div :class="$style.cardHeader">
          <span :class="$style.icon" aria-hidden="true"><svg viewBox="0 0 24 24"><use :xlink:href="item.icon" /></svg></span>
          <div>
            <h3 :class="$style.title">{{ item.title }}</h3>
            <p :class="$style.meta">{{ $t(item.local ? 'setting__plugins_local' : 'setting__plugins_official') }}<span v-if="item.version"> · v{{ item.version }}</span></p>
          </div>
          <span :class="[$style.badge, {[$style.installed]: item.loaded}]" data-plugin-status>{{ $t(item.builtin ? 'setting__plugins_builtin' : item.broken ? 'setting__plugins_broken' : item.disabled ? 'setting__plugins_disabled' : item.installed ? 'setting__plugins_installed' : 'setting__plugins_available') }}</span>
        </div>
        <p v-if="item.description" :class="$style.description">{{ item.description }}</p>
        <p v-if="item.builtin && item.id === 'audio-tag-editor'" :class="$style.meta">{{ $t('setting__plugins_tag_editor_hint') }}</p>
        <p v-if="item.builtin && item.id === 'sound-effects'" :class="$style.meta">{{ $t('setting__plugins_sound_effects_hint') }}</p>
        <p v-if="item.bytes" :class="$style.meta">{{ (item.bytes / 1024 / 1024).toFixed(2) }} MB</p>
        <p v-if="item.incompatible" :class="$style.notice" role="status">{{ $t('setting__plugins_incompatible') }}</p>
        <p v-if="item.local" :class="$style.notice">{{ $t('setting__plugins_local_hint') }}</p>
        <p v-else-if="!item.builtin && item.installed && !item.available" :class="$style.notice" role="status">{{ $t('setting__plugins_removed') }}</p>
        <p v-if="item.broken || pluginOperationErrors[item.id]" :class="$style.notice" role="alert">{{ formatError(pluginOperationErrors[item.id] || item.error, $t('setting__plugins_operation_error'), 'PLUGIN_LOAD_FAILED') }}</p>
        <p v-if="pluginRuntime.cleanupErrors[item.id]" :class="$style.notice" role="alert">{{ formatError(pluginRuntime.cleanupErrors[item.id], $t('setting__plugins_cleanup_error'), 'PLUGIN_CLEANUP_FAILED') }}</p>
        <div :class="$style.actions">
          <base-btn v-if="!item.builtin && !item.local && (!item.installed || item.update || item.broken)" min :disabled="pluginBusy[item.id] || pluginTransferBusy || !item.available || item.incompatible" @click="changePluginInstallation(item.id, true, 'lxplugin')">
            {{ $t(pluginBusy[item.id] ? 'setting__plugins_working' : item.broken ? 'setting__plugins_reinstall' : item.update ? 'setting__plugins_update' : 'setting__plugins_install') }}
          </base-btn>
          <base-btn v-if="item.hasSettings" min :disabled="pluginBusy[item.id] || pluginTransferBusy" @click="expanded = expanded === item.id ? null : item.id">{{ $t(expanded === item.id ? 'setting__plugins_close_settings' : 'setting__plugins_settings') }}</base-btn>
          <base-btn v-if="item.installed && item.exportable && !item.builtin" min :disabled="pluginBusy[item.id] || pluginTransferBusy" @click="changePluginEnabled(item.id, item.disabled)">{{ $t(item.disabled ? 'setting__plugins_enable' : 'setting__plugins_disable') }}</base-btn>
          <base-btn v-if="item.installed && !item.builtin" min :disabled="storeBusy || !item.exportable" @click="transferPlugin(item.id)">{{ $t('setting__plugins_export') }}</base-btn>
          <base-btn v-if="item.installed && !item.builtin" min outline :disabled="pluginBusy[item.id] || pluginTransferBusy" @click="uninstall(item.id)">{{ $t(pluginBusy[item.id] ? 'setting__plugins_working' : 'setting__plugins_uninstall') }}</base-btn>
        </div>
        <section v-if="expanded === item.id && item.hasSettings" :class="$style.settings" :aria-label="item.title" data-plugin-settings-panel>
          <common-plugin-slot :key="item.id" :plugin="item.id" name="Settings" />
        </section>
      </article>
    </div>
  </dd>
</template>

<script setup>
import { formatError } from '@common/utils/errorMessage'
import { computed, nextTick, onMounted, ref, watch } from '@common/utils/vueTools'
import { isPluginApiSupported, pluginPackages, pluginText, comparePluginVersions } from '@common/optionalPlugins'
import { builtinPlugins, getBuiltinPlugin } from '@common/builtinPlugins'
import { pluginStore, pluginRuntime, pluginBusy, pluginOperationErrors, pluginStoreError, pluginTransferBusy, pluginTransferNotice, refreshPlugins, changePluginInstallation, changePluginEnabled, transferPlugin } from '@renderer/store/optionalPlugins'
import { appSetting } from '@renderer/store/setting'

const props = defineProps({ pluginId: { type: String, default: '' } })
const grid = ref(null)
const expanded = ref(null)
let pendingRevealId = ''
const refreshing = ref(false)
const storeBusy = computed(() => pluginTransferBusy.value || Object.values(pluginBusy).some(Boolean))
const items = computed(() => {
  const snapshot = pluginStore.value
  const catalog = new Map(snapshot.catalog.map(plugin => [plugin.id, plugin]))
  const ids = new Set([...builtinPlugins.map(plugin => plugin.id), ...catalog.keys(), ...Object.keys(snapshot.installed), ...Object.keys(snapshot.errors)])
  const language = appSetting['common.langId']
  return [...ids].map(id => {
    const builtin = getBuiltinPlugin(id)
    const installed = snapshot.installed[id]
    const available = catalog.get(id)
    const packages = available ? pluginPackages(available) : {}
    const local = !builtin && (installed?.source === 'local' || snapshot.sources?.[id] === 'local')
    const failure = snapshot.loadFailures?.[id]
    const display = builtin ?? (local ? installed?.manifest : available ?? installed?.manifest)
    return {
      id,
      builtin: !!builtin,
      local,
      title: pluginText(display?.name, language, id),
      description: pluginText(display?.description, language),
      icon: display?.icon ?? '#icon-tune-variant',
      exportable: !!installed,
      installed: !!installed || !!snapshot.errors[id],
      disabled: installed?.enabled === false,
      loaded: !!pluginRuntime.components[id],
      hasSettings: !!pluginRuntime.components[id]?.Settings,
      broken: (!builtin && !!snapshot.errors[id]) || !!pluginRuntime.errors[id] || !!failure,
      error: snapshot.errors[id] ?? pluginRuntime.errors[id] ?? failure?.message,
      available: !!available,
      version: builtin?.version ?? installed?.manifest.version ?? (local ? undefined : available?.version),
      bytes: !!builtin || local ? undefined : packages.lxplugin?.bytes,
      update: installed && available && comparePluginVersions(available.version, installed.manifest.version) > 0,
      incompatible: !builtin && !local && available && !isPluginApiSupported(available.apiVersion),
    }
  })
})
const revealPlugin = async(id) => {
  expanded.value = id
  await nextTick()
  if (props.pluginId !== id) return
  const card = [...(grid.value?.querySelectorAll('[data-plugin-id]') ?? [])].find(element => element.dataset.pluginId === id)
  if (card) {
    pendingRevealId = ''
    card.scrollIntoView({ block: 'start' })
  } else pendingRevealId = id
}
watch(() => props.pluginId, id => {
  pendingRevealId = id
  if (id) void revealPlugin(id)
}, { immediate: true })
const refresh = async() => {
  if (refreshing.value) return
  refreshing.value = true
  try { await refreshPlugins() } finally { refreshing.value = false }
}
const uninstall = async(id) => {
  if (expanded.value === id) expanded.value = null
  await changePluginInstallation(id, false)
}
onMounted(async() => {
  await refresh()
  if (pendingRevealId && pendingRevealId === props.pluginId) await revealPlugin(pendingRevealId)
})
</script>

<style lang="less" module>
.header { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; margin-bottom: 18px; }
.headerActions { display: flex; flex-wrap: wrap; gap: 8px; }
.header button { flex: none; }
.description { color: var(--color-font); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 14px; max-width: 1000px; }
.card { border: 1px solid var(--color-primary-light-100-alpha-700); border-radius: var(--radius-lg); padding: 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.expanded { grid-column: 1 / -1; }
.cardHeader { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.title { margin: 0 !important; font-size: 15px !important; }
.icon { display: flex; width: 36px; height: 36px; padding: 7px; box-sizing: border-box; border-radius: var(--radius-md); color: var(--color-primary); background: var(--color-primary-alpha-900); }
.icon svg { width: 100%; height: 100%; }
.badge { margin-left: auto; color: var(--color-font-label); font-size: 11px; }
.installed { color: var(--color-primary); }
.meta { font-size: 11px; line-height: 1.4; color: var(--color-font-label); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; padding-top: 4px; }
.notice { margin: 8px 15px; color: var(--color-font); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; white-space: pre-line; }
.card .notice { margin: 0; }
.settings { min-width: 0; padding-top: 12px; border-top: 1px solid var(--color-primary-light-100-alpha-700); }
</style>
