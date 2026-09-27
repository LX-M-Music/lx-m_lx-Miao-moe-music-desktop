import { computed, reactive, ref, watch, type Ref } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'
import { updateSetting } from '@renderer/utils/ipc'
import showToast from '@renderer/plugins/Toast'

interface Column {
  id: string
  label: string
  fraction: number
  min: number
}

const useMusicListColumns = (kind: 'music' | 'download', actionsVisible: Ref<boolean> = ref(true)) => {
  const availableWidth = ref(0)
  const scale = ref(1)
  const draft = ref<number[] | null>(null)
  let revision = 0
  const savedLayouts = computed<Record<string, Record<string, number>>>(() => {
    try {
      const value: unknown = JSON.parse(appSetting['list.columnWidths'])
      if (value && typeof value == 'object' && !Array.isArray(value)) return value as Record<string, Record<string, number>>
    } catch {}
    return {}
  })
  const key = computed(() => kind == 'download' ? 'download' : actionsVisible.value ? 'music' : 'musicCompact')
  const columns = computed<Column[]>(() => [
    { id: 'index', label: '#', fraction: 0.05, min: 28 },
    { id: 'cover', label: 'music_cover', fraction: 0, min: 0 },
    { id: 'name', label: 'music_name', fraction: 0, min: 72 },
    ...(kind == 'download' ? [
      { id: 'progress', label: 'download__progress', fraction: 0.17, min: 70 },
      { id: 'status', label: 'download__status', fraction: 0.18, min: 70 },
      { id: 'quality', label: 'download__quality', fraction: 0.10, min: 54 },
      { id: 'action', label: 'action', fraction: 0.13, min: 96 },
    ] : [
      { id: 'singer', label: 'music_singer', fraction: actionsVisible.value ? 0.22 : 0.24, min: 56 },
      { id: 'album', label: 'music_album', fraction: actionsVisible.value ? 0.22 : 0.27, min: 56 },
      { id: 'time', label: 'music_time', fraction: actionsVisible.value ? 0.09 : 0.10, min: 48 },
      ...(actionsVisible.value ? [{ id: 'action', label: 'action', fraction: 0.16, min: 96 }] : []),
    ]),
  ])
  const coverWidth = computed(() => appSetting['list.coverSize'] + 12 * scale.value)
  const minimums = computed(() => {
    const values = columns.value.map(column => column.id == 'cover' ? coverWidth.value : column.min * scale.value)
    const factor = Math.min(1, availableWidth.value * 0.8 / values.reduce((sum, value) => sum + value, 0))
    return values.map(value => value * factor)
  })
  const widths = computed(() => {
    if (draft.value) return draft.value
    const saved = savedLayouts.value[key.value]
    const preferred = columns.value.map(column => column.id == 'cover' ? coverWidth.value : availableWidth.value * column.fraction)
    preferred[2] = Math.max(1, availableWidth.value - preferred.reduce((sum, value) => sum + value, 0))
    if (saved && columns.value.every(column => Number.isFinite(saved[column.id]) && saved[column.id] > 0)) {
      const total = columns.value.reduce((sum, column) => sum + saved[column.id], 0)
      columns.value.forEach((column, index) => { preferred[index] = availableWidth.value * saved[column.id] / total })
    }
    // Reserve a readable minimum for each column, then distribute the remaining space.
    const extra = Math.max(0, availableWidth.value - minimums.value.reduce((sum, value) => sum + value, 0))
    const weights = preferred.map((value, index) => Math.max(0, value - minimums.value[index]))
    const totalWeight = weights.reduce((sum, value) => sum + value, 0)
    return minimums.value.map((value, index) => value + extra * (totalWeight ? weights[index] / totalWeight : 1 / columns.value.length))
  })
  const style = computed(() => Object.fromEntries([
    ['--list-cover-size', `${appSetting['list.coverSize']}px`],
    ...columns.value.map((column, index) => [`--music-column-${column.id}`, `${widths.value[index]}px`]),
  ]))
  const preview = (values: number[] | null) => { draft.value = values }
  const persist = async(values: number[] | null) => {
    const current = ++revision
    const currentKey = key.value
    const saved = Object.fromEntries(Object.entries(savedLayouts.value).filter(([key]) => key != currentKey))
    if (values) {
      const total = values.reduce((sum, value) => sum + value, 0)
      if (!total) return
      saved[currentKey] = Object.fromEntries(columns.value.map((column, index) => [column.id, values[index] / total]))
    }
    draft.value = values
    try { await updateSetting({ 'list.columnWidths': JSON.stringify(saved) }) } catch { showToast(window.i18n.t('list__column_save_error'), { error: true }) } finally {
      if (current == revision && currentKey == key.value) draft.value = null
    }
  }
  watch(key, () => { revision++; draft.value = null }, { flush: 'sync' })
  const measure = (width: number, fontScale: number) => {
    availableWidth.value = width
    scale.value = fontScale
  }
  return reactive({ key, columns, widths, minimums, availableWidth, style, preview, persist, measure })
}

export default useMusicListColumns
export type MusicColumnLayout = ReturnType<typeof useMusicListColumns>
