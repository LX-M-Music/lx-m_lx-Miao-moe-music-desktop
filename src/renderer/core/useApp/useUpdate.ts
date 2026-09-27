import { formatError } from '@common/utils/errorMessage'
import { nextTick, onBeforeUnmount, watch } from '@common/utils/vueTools'
import {
  onUpdateDownloaded,
  onUpdateError,
  onUpdateProgress,
  getIgnoreVersion,
  getLastStartInfo,
  saveLastStartInfo,
} from '@renderer/utils/ipc'
import { compareVer } from '@common/utils'
import { APP_NAME } from '@common/constants'
import { isShowChangeLog, versionInfo } from '@renderer/store'
import { getVersionInfo } from '@renderer/utils/update'
import { dialog } from '@renderer/plugins/Dialog'
import { appSetting } from '@renderer/store/setting'

export default () => {
  let isShowedChangeLog = false

  const clearUpdateTimeout = () => {}

  const handleShowChangeLog = () => {
    isShowedChangeLog = true
    void getLastStartInfo().then((version) => {
      if (version == process.versions.app) return
      saveLastStartInfo(process.versions.app)
      if (!appSetting['common.showChangeLog']) return
      if (version) {
        if (compareVer(process.versions.app, version) < 0) {
          void dialog({
            message: window.i18n.t('update__downgrade_tip', { name: APP_NAME, ver: `${version} -> ${process.versions.app}` }),
            confirmButtonText: window.i18n.t('update__ignore_confirm_tip_confirm'),
          })
          return
        }

        if (compareVer(version, versionInfo.newVersion!.version) >= 0) return
      } else if (
        // 如果当前版本不在已发布的版本中，则不需要显示更新日志
        ![{ version: versionInfo.newVersion!.version, desc: '' }, ...(versionInfo.newVersion!.history ?? [])]
          .some(i => i.version == process.versions.app)
      ) return
      isShowChangeLog.value = true
    })
  }

  const handleGetVersionInfo = async(): Promise<NonNullable<typeof versionInfo['newVersion']>> => {
    return (versionInfo.newVersion?.history && !versionInfo.reCheck
      ? Promise.resolve(versionInfo.newVersion)
      : getVersionInfo().then((body: any) => {
        versionInfo.newVersion = body
        return body
      })
    ).catch(error => {
      versionInfo.updateError = formatError(error, '', 'UPDATE_INFO_LOAD_FAILED')
      if (versionInfo.newVersion) return versionInfo.newVersion
      let result = {
        version: '0.0.0',
        desc: '',
      }
      versionInfo.newVersion = result
      return result
    })
  }

  let versionInfoPromise: null | ReturnType<typeof handleGetVersionInfo> = null

  const showUpdateModal = (status?: LX.UpdateStatus) => {
    if (versionInfoPromise) {
      if (
        // @ts-expect-error
        versionInfoPromise.resolved &&
        versionInfo.reCheck) {
        versionInfoPromise = handleGetVersionInfo()
      }
    } else versionInfoPromise = handleGetVersionInfo()
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    void versionInfoPromise.then((result) => {
      versionInfo.reCheck = false

      if (result.version == '0.0.0') {
        versionInfo.isUnknown = true
        versionInfo.status = 'error'
        let ignoreFailTipTime = parseInt(localStorage.getItem('update__check_failed_tip') ?? '0')
        if (appSetting['common.showErrorDialog'] && Date.now() - ignoreFailTipTime > 7 * 86400000) {
          versionInfo.showModal = true
        }
        return
      }
      versionInfo.isUnknown = false
      if (compareVer(versionInfo.version, result.version) != -1) {
        versionInfo.status = 'idle'
        versionInfo.isLatest = true
        handleShowChangeLog()
        return
      }

      return getIgnoreVersion().then((ignoreVersion) => {
        versionInfo.isLatest = false
        let preStatus = versionInfo.status
        if (status) versionInfo.status = status
        if (result.version === ignoreVersion) return
        void nextTick(() => {
          versionInfo.showModal = true
          if (status == 'error' && preStatus == 'downloading' && !localStorage.getItem('update__download_failed_tip')) {
            setTimeout(() => {
              void dialog.error({
                message: window.i18n.t('update__error_top'),
                confirmButtonText: window.i18n.t('alert_button_text'),
              }).finally(() => {
                localStorage.setItem('update__download_failed_tip', '1')
              })
            }, 500)
          }
        })
      })
    }).finally(() => {
      // @ts-expect-error
      versionInfoPromise!.resolved = true
    })
  }

  const rUpdateError = onUpdateError(({ params: message }) => {
    clearUpdateTimeout()
    versionInfo.updateError = formatError(message, '', 'UPDATE_DOWNLOAD_FAILED')
    versionInfo.downloadProgress = null
    void nextTick(() => {
      showUpdateModal('error')
    })
  })
  const rUpdateProgress = onUpdateProgress(({ params: progress }) => {
    if (!['downloading', 'downloaded', 'verifying', 'installing'].includes(versionInfo.status)) return
    versionInfo.downloadProgress = progress
    versionInfo.status = progress.phase ?? 'downloading'
  })
  const rUpdateDownloaded = onUpdateDownloaded(({ params: info }) => {
    if (!['downloading', 'verifying'].includes(versionInfo.status)) return
    clearUpdateTimeout()
    versionInfo.updateError = ''
    versionInfo.status = info.installAfterDownload ? 'verifying' : 'downloaded'
  })

  // 监听 reCheck 变化以触发重新检查
  watch(() => versionInfo.reCheck, (val) => {
    if (val) showUpdateModal()
  })

  watch(() => versionInfo.showModal, (visible) => {
    if (visible || isShowedChangeLog || versionInfo.status == 'downloaded') return
    setTimeout(() => {
      handleShowChangeLog()
    }, 1000)
  })

  // 启动后延迟触发首次版本检查
  setTimeout(() => {
    showUpdateModal()
  }, 3000)

  onBeforeUnmount(() => {
    clearUpdateTimeout()
    rUpdateError()
    rUpdateProgress()
    rUpdateDownloaded()
  })
}
