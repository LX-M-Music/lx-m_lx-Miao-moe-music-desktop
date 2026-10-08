import { computed } from '@common/utils/vueTools'
import type { VisualizerStyle } from './styles'

interface Labels {
  title: string
  desktop: string
  enabled: string
  hint: string
  demo: string
  live: string
  close: string
  error: string
  styles: Record<VisualizerStyle, [string, string]>
}
const zh: Labels = {
  title: '音频可视化',
  desktop: '桌面歌词',
  enabled: '启用可视化',
  hint: '选择样式即可为桌面歌词启用音频可视化，自动保存。',
  demo: '演示预览 · 播放后随音乐律动',
  live: '正在预览当前音乐',
  close: '完成',
  error: '样式设置读写失败，请检查用户数据目录后重试。',
  styles: {
    spectrum: ['经典频谱', '沿底部铺开的连续频谱'],
    wave: ['柔波曲线', '层叠曲线如波浪流动'],
    radial: ['环形频谱', 'audioMotion · 渐变色环随音乐律动'],
  },
}
const tw: Labels = {
  title: '音訊視覺化',
  desktop: '桌面歌詞',
  enabled: '啟用視覺化',
  hint: '選擇樣式即可為桌面歌詞啟用音訊視覺化，自動儲存。',
  demo: '示範預覽 · 播放後隨音樂律動',
  live: '正在預覽目前音樂',
  close: '完成',
  error: '樣式設定讀寫失敗，請檢查使用者資料目錄後重試。',
  styles: {
    spectrum: ['經典頻譜', '沿底部鋪開的連續頻譜'],
    wave: ['柔波曲線', '層疊曲線如波浪流動'],
    radial: ['環形頻譜', 'audioMotion · 漸層色環隨音樂律動'],
  },
}
const en: Labels = {
  title: 'Audio visualization',
  desktop: 'Desktop lyrics',
  enabled: 'Enable visualization',
  hint: 'Choose a style to enable visualization for desktop lyrics. Your selection is saved automatically.',
  demo: 'Demo preview · reacts to music during playback',
  live: 'Previewing your music',
  close: 'Done',
  error: 'Could not read or save the style. Check the user data folder and try again.',
  styles: {
    spectrum: ['Classic spectrum', 'A continuous spectrum along the bottom'],
    wave: ['Flowing waves', 'Layered curves that flow with the sound'],
    radial: ['Radial spectrum', 'audioMotion · a gradient ring of sound'],
  },
}
export const useLabels = () => computed(() => {
  window.i18n.t('audio_visualization') // Track the host's reactive language selection.
  return window.i18n.locale === 'zh-tw' ? tw : window.i18n.locale.startsWith('zh') ? zh : en
})
