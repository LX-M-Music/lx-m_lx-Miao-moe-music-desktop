<template lang="pug">
dt#update
  | {{ $t('setting__update') }}
  svg-icon.help-icon(name="help-circle-outline" :aria-label="$t('setting__update_start_tip')")
dd
  .gap-top
    base-checkbox(id="setting__update_showChangeLog" :model-value="appSetting['common.showChangeLog']" :label="$t('setting__update_show_change_log')" @update:model-value="updateSetting({'common.showChangeLog': $event})")
  .gap-top
    .gap-top
      .p.small(@click="handleOpenDevTools") {{ $t('setting__update_current_label') }}{{ versionInfo.version }}
      .p.small(v-if="commit_id")
        | {{ $t('setting__update_commit_id') }}
        span.select {{ commit_id }}
      .p.small(v-if="commit_date") {{ $t('setting__update_commit_date') }}{{ commit_date }}

    .p.small.gap-top
      | {{ $t('setting__update_latest_label') }}{{ versionInfo.newVersion && versionInfo.newVersion.version != '0.0.0' ? versionInfo.newVersion.version : $t('setting__update_unknown') }}
    .p.small(v-if="downloadProgress" style="line-height: 1.5;")
      | {{ updateLabel }}
      br
      | {{ $t('setting__update_progress') }}{{ downloadProgress }}
    template(v-if="versionInfo.newVersion")
      .p(v-if="versionInfo.isLatest")
        span {{ $t('setting__update_latest') }}
      .p(v-else-if="versionInfo.isUnknown")
        span {{ $t('setting__update_unknown_tip') }}
      .p(v-else-if="!['testing', 'downloading', 'preparing', 'verifying', 'installing'].includes(versionInfo.status)")
        span {{ $t('setting__update_new_version') }}
      .p
        base-btn.btn.gap-left(min @click="showUpdateModal") {{ $t('setting__update_open_version_modal_btn') }}
    .p.small(v-else-if="versionInfo.status =='checking'") {{ $t('setting__update_checking') }}
</template>

<script>
import { computed } from '@common/utils/vueTools'
import { versionInfo } from '@renderer/store'
import { dateFormat, sizeFormate } from '@common/utils/common'
// import { openDirInExplorer, selectDir } from '@renderer/utils'
import { openDevTools } from '@renderer/utils/ipc'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, updateSetting } from '@renderer/store/setting'

export default {
  name: 'SettingUpdate',
  setup() {
    let lastClickTime = 0
    let clickNum = 0
    const commit_id = COMMIT_ID
    const commit_date = dateFormat(COMMIT_DATE)

    const t = useI18n()

    const handleOpenDevTools = () => {
      if (window.performance.now() - lastClickTime > 1000) {
        if (clickNum > 0) clickNum = 0
      } else {
        if (clickNum > 4) {
          openDevTools()
          clickNum = 0
          return
        }
      }
      clickNum++
      lastClickTime = window.performance.now()
    }

    const updateLabel = computed(() => t(versionInfo.status == 'testing' ? 'setting__update_testing' : versionInfo.status == 'preparing' ? 'setting__update_preparing' : 'setting__update_downloading'))
    const downloadProgress = computed(() => {
      if (versionInfo.status == 'testing') {
        const info = versionInfo.downloadProgress
        return info?.totalSources ? t('setting__update_tested', { tested: info.testedSources ?? 0, total: info.totalSources }) : t('setting__update_init')
      }
      if (versionInfo.status == 'preparing') return t('setting__update_init')
      return versionInfo.status == 'downloading'
        ? versionInfo.downloadProgress
          ? `${versionInfo.downloadProgress.progress.toFixed(2)}% - ${sizeFormate(versionInfo.downloadProgress.transferred)}/${sizeFormate(versionInfo.downloadProgress.total)} - ${sizeFormate(versionInfo.downloadProgress.bytesPerSecond)}/s`
          : t('setting__update_init')
        : ''
    })

    const showUpdateModal = () => {
      versionInfo.showModal = true
    }

    return {
      versionInfo,
      downloadProgress,
      updateLabel,
      handleOpenDevTools,
      showUpdateModal,
      appSetting,
      updateSetting,
      commit_id,
      commit_date,
    }
  },
}
</script>

<style lang="less" module>
// .savePath {
//   font-size: 12px;
// }
</style>
