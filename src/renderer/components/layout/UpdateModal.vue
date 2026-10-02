<template lang="pug">
material-modal(:show="versionInfo.showModal" :close-btn="!isInstalling && !isCancelling" max-width="60%" @close="handleClose")
  main(v-if="versionInfo.isLatest" :class="$style.main")
    h2 🎉 已是最新版本 🎉
    div.scroll.select(:class="$style.info")
      div(:class="$style.current")
        h3 最新版本：{{ versionInfo.newVersion?.version }}
        h3 当前版本：{{ versionInfo.version }}
        h3 版本变化：
        pre(:class="$style.desc" v-text="desc")
    div(:class="$style.footer")
      div(:class="$style.btns")
        base-btn(v-if="versionInfo.status == 'checking'" :class="$style.btn" disabled) 检查更新中...
        base-btn(v-else :class="$style.btn" @click="handleCheckUpdate") 重新检查更新
  main(v-else-if="versionInfo.isUnknown" :class="$style.main")
    h2 ❓ 获取最新版本信息失败 ❓
    p.load-error-detail(v-if="versionInfo.updateError && appSetting['common.showErrorDialog']" role="alert") {{ versionInfo.updateError }}
    div.scroll.select(:class="$style.info")
      div(:class="$style.current")
        h3 当前版本：{{ versionInfo.version }}
        div(:class="$style.desc")
          p 更新信息获取失败，可能是无法访问 GitHub 导致的，请手动检查更新！
          p
            | 检查方法：打开
            base-btn(min aria-label="点击打开" @click="handleOpenUrl('https://github.com/Miao-moe/lx-m_lx-Miao-moe-music-desktop/releases')") 软件发布页
            | ，查看「Latest」发布的
            strong 版本号
            | 与当前版本({{ versionInfo.version }})对比是否一致。
          p 若一致则不必理会该弹窗，直接关闭即可；否则请手动下载新版本更新。
    div(:class="$style.footer")
      div(:class="$style.btns")
        base-btn(v-if="versionInfo.status == 'error'" :class="$style.btn2" @click="handleCheckUpdate") 重新检查更新
        base-btn(v-else :class="$style.btn2" disabled) 检查更新中...
        base-btn(:disabled="disabledIgnoreFailBtn" :class="$style.btn2" @click="handleIgnoreFailTipClick") 一个星期内不再提醒
  main(v-else :class="$style.main")
    h2 🌟发现新版本🌟
    div.scroll.select(:class="$style.info")
      div(:class="$style.current")
        h3 最新版本：{{ versionInfo.newVersion?.version }}
        h3 当前版本：{{ versionInfo.version }}
        h3(v-if="editionLabel") 当前版本类型：{{ editionLabel }}
        h3 版本变化：
        pre(:class="$style.desc" v-text="desc")
      div(v-if="history.length" :class="[$style.history, $style.desc]")
        h3 历史版本：
        pre(v-text="historyDesc")

    div(:class="$style.footer")
      div(:class="$style.desc")
        p {{ updateDescription }}
        p 手动更新可以去&nbsp;
          strong.hover.underline(aria-label="点击打开" @click="handleOpenUrl('https://github.com/Miao-moe/lx-m_lx-Miao-moe-music-desktop/releases')") 软件发布页
          | 下载。
        p 若遇到问题可以阅读
          strong.hover.underline(aria-label="点击打开" @click="handleOpenUrl('https://lyswhut.github.io/lx-music-doc/desktop/faq')") 桌面版常见问题
          | 。
        p(v-if="versionInfo.status == 'downloaded'") 新版本已下载，点击“自动更新”即可安装并重启。
        p(v-if="versionInfo.updateError && appSetting['common.showErrorDialog']" role="alert") {{ versionInfo.updateError }}
        p(v-else-if="!versionInfo.newVersion?.downloadUrl") 暂无适用的自动更新安装包，请手动更新。
      div(v-if="isUpdating" :class="$style.updateProgress" data-update-progress)
        div(:class="$style.progressHeader" role="status")
          span {{ progressLabel }}
          span(v-if="progressValue != null") {{ progressValue.toFixed(1) }}%
        div(:class="$style.progressTrack" role="progressbar" aria-label="更新进度" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="progressValue" :aria-valuetext="progressLabel")
          div(:class="[$style.progressFill, {[$style.indeterminate]: progressValue == null}]" :style="{ width: `${progressValue ?? 32}%` }")
        p(v-if="progress" :class="$style.progressDetail") {{ progress }}
      div(:class="$style.btns")
        base-btn(:class="$style.btn3" :disabled="isInstalling || isCancelling" @click="handleClose") 暂不更新
        base-btn(:class="$style.btn3" :disabled="isInstalling || isCancelling" @click="handleManualUpdate") 手动更新
        base-btn(:class="$style.btn3" :disabled="isUpdating || !versionInfo.newVersion?.downloadUrl" @click="handleDownloadClick") 自动更新
</template>

<script>
import { compareVer, sizeFormate } from '@common/utils'
import { openUrl, clipboardWriteText } from '@common/utils/electron'
import { dialog } from '@renderer/plugins/Dialog'
import { versionInfo } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'
import { getIgnoreVersion, saveIgnoreVersion, quitUpdate, downloadUpdate, cancelDownloadUpdate, checkUpdate } from '@renderer/utils/ipc'
import { formatChangeLog } from '@renderer/utils/changeLog'

export default {
  setup() {
    return {
      versionInfo,
      appSetting,
    }
  },
  data() {
    return {
      ignoreVersion: null,
      disabledIgnoreFailBtn: true,
      isCancelling: false,
    }
  },
  computed: {
    desc() {
      return formatChangeLog(this.versionInfo.newVersion?.desc)
    },
    history() {
      if (!this.versionInfo.newVersion?.history) return []
      let arr = []
      let currentVer = this.versionInfo.version
      this.versionInfo.newVersion?.history.forEach(ver => {
        if (compareVer(currentVer, ver.version) < 0) arr.push(ver)
      })

      return arr
    },
    historyDesc() {
      return this.history.map(ver => formatChangeLog(ver.desc, ver.version)).join('\n\n')
    },
    isUpdating() {
      return this.isCancelling || ['testing', 'downloading', 'preparing', 'verifying', 'installing'].includes(this.versionInfo.status)
    },
    editionLabel() {
      return { installed: '安装版', portable: '便携版', 'single-file': '单文件版', development: '开发版本' }[this.versionInfo.newVersion?.edition] ?? ''
    },
    updateDescription() {
      const edition = this.versionInfo.newVersion?.edition
      if (edition == 'portable') return '点击“自动更新”后先测速，优先下载差分数据；不可用时下载完整便携包，完成后自动替换程序并重启。'
      if (edition == 'single-file') return '点击“自动更新”后先测速并下载完整单文件版，完成后自动替换原文件并重启。'
      return '点击“自动更新”后先测速并选择下载节点，下载完成后将自动安装并重启。'
    },
    isInstalling() {
      return this.versionInfo.status == 'installing'
    },
    progressLabel() {
      if (this.isCancelling) return '正在停止更新…'
      if (this.versionInfo.status == 'testing') return '正在测速更新节点…'
      if (this.versionInfo.status == 'preparing') return this.versionInfo.downloadProgress?.mode == 'differential' ? '正在比对并复用本地文件…' : '正在准备便携版更新…'
      if (this.versionInfo.status == 'verifying') return '正在校验更新文件…'
      if (this.versionInfo.status == 'installing') return ['portable', 'single-file'].includes(this.versionInfo.newVersion?.edition) ? '正在准备替换程序，稍后将自动重启…' : '正在启动安装，稍后将自动重启…'
      if (this.versionInfo.downloadProgress?.mode == 'differential') return '正在下载差分数据…'
      return '正在下载更新…'
    },
    progressValue() {
      const info = this.versionInfo.downloadProgress
      if (this.isCancelling || this.versionInfo.status != 'downloading' || !info || info.total <= 0 || !Number.isFinite(info.progress)) return undefined
      return Math.max(0, Math.min(100, info.progress))
    },
    progress() {
      if (this.isCancelling) return ''
      const info = this.versionInfo.downloadProgress
      if (this.versionInfo.status == 'testing') return info?.totalSources ? `已测试 ${info.testedSources ?? 0} / ${info.totalSources} 个节点` : '正在连接测速…'
      if (this.versionInfo.status != 'downloading') return ''
      if (!info) return '正在连接下载…'
      const total = info.total > 0 ? ` / ${sizeFormate(info.total)}` : ''
      return `${sizeFormate(info.transferred)}${total} · ${sizeFormate(info.bytesPerSecond)}/s${info.source ? ` · ${info.source}` : ''}${info.reusedBytes ? ` · 已复用 ${sizeFormate(info.reusedBytes)}` : ''}`
    },
    isIgnored() {
      return this.ignoreVersion == this.versionInfo.newVersion?.version
    },
  },
  created() {
    void getIgnoreVersion().then(version => {
      this.ignoreVersion = version
    })
    this.disabledIgnoreFailBtn = Date.now() - parseInt(localStorage.getItem('update__check_failed_tip') ?? '0') < 7 * 86400000
  },
  methods: {
    async handleClose() {
      if (this.isInstalling || this.isCancelling) return false
      if (['testing', 'downloading', 'preparing', 'downloaded', 'verifying'].includes(this.versionInfo.status)) {
        this.isCancelling = true
        try {
          if (!await cancelDownloadUpdate()) return false
          versionInfo.status = 'idle'
          versionInfo.downloadProgress = null
          versionInfo.updateError = ''
        } catch (error) {
          versionInfo.updateError = `无法停止更新，请重试：${error?.message ?? error}`
          return false
        } finally {
          this.isCancelling = false
        }
      }
      versionInfo.showModal = false
      return true
    },
    handleOpenUrl(url) {
      void openUrl(url)
    },
    handleCopy(text) {
      clipboardWriteText(text)
    },
    async handleIgnoreClick() {
      if (this.isIgnored) {
        saveIgnoreVersion(this.ignoreVersion = null)
        return
      }

      if (this.history.length >= 2) {
        if (await dialog.confirm({
          message: window.i18n.t('update__ignore_tip', { num: this.history.length + 1 }),
          cancelButtonText: window.i18n.t('update__ignore_cancel'),
          confirmButtonText: window.i18n.t('update__ignore_confirm'),
        })) {
          setTimeout(() => {
            void dialog({
              message: window.i18n.t('update__ignore_confirm_tip'),
              confirmButtonText: window.i18n.t('update__ignore_confirm_tip_confirm'),
            })
          }, 500)
          return
        }
      }
      saveIgnoreVersion(this.ignoreVersion = this.versionInfo.newVersion?.version)
      // saveIgnoreVersion(this.versionInfo.newVersion?.version)
      // this.handleClose()
    },
    handleDownloadClick() {
      if (this.isUpdating) return
      if (this.isIgnored) saveIgnoreVersion(this.ignoreVersion = null)
      const info = this.versionInfo.newVersion
      if (!info?.downloadUrl) return
      versionInfo.updateError = ''
      if (versionInfo.status == 'downloaded') {
        versionInfo.status = 'verifying'
        quitUpdate()
        return
      }
      versionInfo.downloadProgress = null
      versionInfo.status = 'testing'
      downloadUpdate({
        version: info.version,
        downloadUrl: info.downloadUrl,
        fileName: info.fileName ?? '',
        size: info.size ?? 0,
        digest: info.digest ?? '',
        installAfterDownload: true,
        edition: info.edition,
        differential: info.differential,
      })
    },
    async handleManualUpdate() {
      if (await this.handleClose()) this.handleOpenUrl('https://github.com/Miao-moe/lx-m_lx-Miao-moe-music-desktop/releases')
    },
    handleCheckUpdate() {
      versionInfo.updateError = ''
      if (this.isIgnored) saveIgnoreVersion(this.ignoreVersion = null)
      versionInfo.status = 'checking'
      versionInfo.reCheck = true
      checkUpdate()
    },
    handleIgnoreFailTipClick() {
      localStorage.setItem('update__check_failed_tip', Date.now().toString())
      this.disabledIgnoreFailBtn = true
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  position: relative;
  padding: 15px 0;
  // max-width: 450px;
  min-width: 300px;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  overflow: hidden;
  // overflow-y: auto;
  * {
    box-sizing: border-box;
  }
  h2 {
    flex: 0 0 none;
    font-size: 16px;
    color: var(--color-font);
    line-height: 1.3;
    text-align: center;
    margin-bottom: 15px;
  }
  h3 {
    font-size: 14px;
    line-height: 1.3;
  }
  pre {
    white-space: pre-wrap;
    text-align: justify;
    margin-top: 10px;
  }
}

.info {
  flex: 1 1 auto;
  font-size: 14px;
  line-height: 1.5;
  overflow-y: auto;
  height: 100%;
  padding: 0 15px;
}
.current {
  > p {
    padding-left: 15px;
  }
}

.desc {
  h3, h4 {
    font-weight: bold;
  }
  h3 {
    padding: 5px 0 3px;
  }
  ul {
    list-style: initial;
    padding-inline-start: 30px;
  }
  p {
    font-size: 14px;
    line-height: 1.5;
  }
}

.history {
  h3 {
    padding-top: 15px;
  }
}
.footer {
  flex: 0 0 none;
  padding: 0 15px;
  .desc {
    padding-top: 10px;
    font-size: 13px;
    color: var(--color-primary-font);
    line-height: 1.25;

    p {
      font-size: 13px;
      color: var(--color-primary-font);
      line-height: 1.25;
    }
  }
}
.btns {
  display: flex;
  flex-flow: row nowrap;
  gap: 15px;
}

.updateProgress {
  margin-top: 14px;
  padding: 12px;
  border-radius: var(--radius-sm);
  background: var(--color-primary-alpha-900);
}
.progressHeader {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: var(--color-font);
  font-variant-numeric: tabular-nums;
}
.progressTrack {
  height: 7px;
  margin-top: 9px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--color-primary-alpha-800);
}
.progressFill {
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
  transition: width var(--duration-fast) linear;
}
.indeterminate {
  animation: update-progress-pulse 1.4s ease-in-out infinite;
}
.progressDetail {
  margin-top: 7px;
  color: var(--color-font-label);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
@keyframes update-progress-pulse {
  from { transform: translateX(-100%); }
  to { transform: translateX(315%); }
}
:global(html[data-motion-enabled='false']) .indeterminate {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  .indeterminate { animation: none; }
}

.btn {
  margin-top: 10px;
  display: block;
  width: 100%;
}
.btn2 {
  margin-top: 10px;
  display: block;
  width: 50%;
}
.btn3 {
  margin-top: 10px;
  display: block;
  flex: 1;
}

</style>

