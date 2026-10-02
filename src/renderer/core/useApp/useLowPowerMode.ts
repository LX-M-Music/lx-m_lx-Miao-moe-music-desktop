import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import { webFrame } from 'electron'
import { getPerformancePolicy } from '@common/performance'
import { appSetting } from '@renderer/store/setting'
import { setCoverMemoryLimits } from '@renderer/utils/coverCache'
import { setArtworkMemoryLimit } from '@renderer/utils/kawarpBackground/artwork'
import { setCoverUrlMemoryLimit } from '@renderer/utils/musicCover'

export default () => {
  let releaseTimer: ReturnType<typeof setTimeout> | undefined
  watch(() => appSetting['ui.lowPowerMode'], enabled => {
    clearTimeout(releaseTimer)
    const policy = getPerformancePolicy(enabled)
    document.documentElement.dataset.lowPowerMode = String(enabled)
    setCoverMemoryLimits(policy.coverBytes, policy.coverEntries)
    setArtworkMemoryLimit(policy.backgroundArtworks)
    setCoverUrlMemoryLimit(policy.coverUrls)
    window.dispatchEvent(new Event('lx-performance-change'))
    if (enabled) {
      // Wait for Vue to release the old background and trim inactive images.
      // This is a one-off release of unused Blink resources, not periodic flushing.
      releaseTimer = setTimeout(() => {
        releaseTimer = undefined
        if (appSetting['ui.lowPowerMode']) webFrame.clearCache()
      }, 250)
    }
  }, { immediate: true })
  onBeforeUnmount(() => { clearTimeout(releaseTimer) })
}
