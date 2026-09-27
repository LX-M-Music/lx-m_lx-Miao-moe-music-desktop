import { formatError } from '@common/utils/errorMessage'
import {
  downloadTasksGet,
  // downloadListClear,
  downloadTasksCreate,
  downloadTasksRemove,
  downloadTasksUpdate,
  getDownloadDiskSpace,
} from '@renderer/utils/ipc'
import {
  downloadList,
} from './state'
import { markRaw, toRaw } from '@common/utils/vueTools'
import { getMusicUrl, getPicUrl, getLyricInfo } from '@renderer/core/music/online'
import { appSetting } from '../setting'
import { qualityList } from '..'
import { proxyCallback } from '@renderer/worker/utils'
import { arrPush, arrUnshift, joinPath } from '@renderer/utils'
import { DOWNLOAD_STATUS } from '@common/constants'
import { proxy } from '../index'
import { buildSavePath } from './utils'
import showToast from '@renderer/plugins/Toast'
import { getFileStats } from '@common/utils/nodejs'
import { classifyDownloadError, type DownloadFailureKind } from '@common/utils/download/errors'
import { downloadLimitBytes, summarizeDownloadStorage, type DownloadStorageSummary } from '@common/utils/download/storage'
import { withRequestDeadline, throwIfRequestCancelled } from '@renderer/utils/requestContext'
import { finishDownloadFiles } from './postprocess'

let downloadSyncLocked = false
let downloadMutations = 0
let pendingTaskUpdate: Promise<unknown> = Promise.resolve()
const checkDownloadSyncLock = () => {
  if (!downloadSyncLocked) return false
  showToast(window.i18n.t('setting__sync_webdav_error_busy'), { error: true })
  return true
}

const waitingUpdateTasks = new Map<string, LX.Download.ListItem>()
let timer: NodeJS.Timeout | null = null
const throttleUpdateTask = (tasks: LX.Download.ListItem[]) => {
  for (const task of tasks) waitingUpdateTasks.set(task.id, toRaw(task))
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    pendingTaskUpdate = downloadTasksUpdate(Array.from(waitingUpdateTasks.values()))
    void pendingTaskUpdate.catch(console.error)
    waitingUpdateTasks.clear()
  }, 100)
}

const runingTask = new Map<string, LX.Download.ListItem>()
const batchSizeSnapshots = new Map<string, Promise<number>>()
let loadingDownloadList: Promise<LX.Download.ListItem[]> | null = null

const getBatchInitialBytes = async(batchId: string) => {
  let snapshot = batchSizeSnapshots.get(batchId)
  if (snapshot) return snapshot
  snapshot = (async() => {
    const members = downloadList.filter(task => task.batchId === batchId && task.metadata.filePath)
    let bytes = 0
    for (let index = 0; index < members.length; index += 8) {
      const stats = await Promise.all(members.slice(index, index + 8).map(async task => getFileStats(task.metadata.filePath)))
      for (const item of stats) if (item?.isFile()) bytes += item.size
    }
    return bytes
  })()
  batchSizeSnapshots.set(batchId, snapshot)
  void snapshot.catch(() => { batchSizeSnapshots.delete(batchId) })
  return snapshot
}

const prepareDownloadList = (list: LX.Download.ListItem[]) => {
  for (const downloadInfo of list) {
    markRaw(downloadInfo.metadata)
    if (downloadInfo.status == DOWNLOAD_STATUS.RUN || downloadInfo.status == DOWNLOAD_STATUS.WAITING) downloadInfo.status = DOWNLOAD_STATUS.PAUSE
    if (downloadInfo.status == DOWNLOAD_STATUS.PAUSE) downloadInfo.statusText = window.i18n.t('download___status_paused')
    if (downloadInfo.status == DOWNLOAD_STATUS.COMPLETED) downloadInfo.statusText = window.i18n.t('download___status_completed')
  }
  return list
}

/** Keep worker writes and UI task actions outside a WebDAV restore. */
export const withDownloadListSync = async<T>(action: () => Promise<T>): Promise<T> => {
  if (downloadSyncLocked || downloadMutations) throw new Error('downloads_running')
  downloadSyncLocked = true
  let ready = false
  try {
    await getDownloadList()
    if (runingTask.size || stopping.size || finalizers.size || downloadList.some(task => task.status == DOWNLOAD_STATUS.RUN || task.status == DOWNLOAD_STATUS.WAITING)) throw new Error('downloads_running')
    if (timer) clearTimeout(timer)
    timer = null
    await pendingTaskUpdate
    waitingUpdateTasks.clear()
    await downloadTasksUpdate(downloadList.map(task => toRaw(task)))
    ready = true
    return await action()
  } finally {
    try {
      if (ready) {
        const list = prepareDownloadList(await downloadTasksGet())
        downloadList.splice(0, downloadList.length)
        arrPush(downloadList, list)
        window.app_event.downloadListUpdate()
      }
    } finally {
      // eslint-disable-next-line require-atomic-updates -- This operation exclusively owns the download sync lock.
      downloadSyncLocked = false
    }
  }
}

// const initDownloadList = (list: LX.Download.ListItem[]) => {
//   downloadList.splice(0, downloadList.length, ...list)
// }

export const getDownloadList = async(): Promise<LX.Download.ListItem[]> => {
  if (!downloadList.length && !loadingDownloadList) {
    loadingDownloadList = downloadTasksGet().then(list => {
      arrPush(downloadList, prepareDownloadList(list))
      return downloadList
    }).finally(() => { loadingDownloadList = null })
  }
  if (loadingDownloadList) await loadingDownloadList
  return downloadList
}

const addTasks = async(list: LX.Download.ListItem[]) => {
  const addMusicLocationType = appSetting['list.addMusicLocationType']

  await downloadTasksCreate(list.map(i => toRaw(i)), addMusicLocationType)

  if (addMusicLocationType === 'top') {
    arrUnshift(downloadList, list)
  } else {
    arrPush(downloadList, list)
  }
  window.app_event.downloadListUpdate()
}

const setStatusText = (downloadInfo: LX.Download.ListItem, text: string) => { // 设置状态文本
  downloadInfo.statusText = text
  throttleUpdateTask([downloadInfo])
}

const setUrl = (downloadInfo: LX.Download.ListItem, url: string) => {
  downloadInfo.metadata.url = url
  throttleUpdateTask([downloadInfo])
}

const updateFilePath = (downloadInfo: LX.Download.ListItem, filePath: string) => {
  downloadInfo.metadata.filePath = filePath
  throttleUpdateTask([downloadInfo])
}

export const relocateDownloadTask = async(id: string, filePath: string) => {
  if (checkDownloadSyncLock()) return false
  if (!/\.(mp3|flac|ogg|oga|wav|m4a|ape)$/i.test(filePath)) return false
  downloadMutations++
  try {
    const stats = await getFileStats(filePath)
    const task = downloadList.find(item => item.id === id)
    if (!stats?.isFile() || !stats.size || !task?.isComplate) return false
    const metadata = markRaw({ ...task.metadata, filePath })
    await downloadTasksUpdate([{ ...toRaw(task), metadata }])
    task.metadata = metadata
    window.app_event.downloadListUpdate()
    return true
  } finally { downloadMutations-- }
}

const setProgress = (downloadInfo: LX.Download.ListItem, progress: LX.Download.ProgressInfo) => {
  downloadInfo.total = progress.total
  downloadInfo.downloaded = progress.downloaded
  downloadInfo.writeQueue = progress.writeQueue
  if (progress.progress == 100) {
    downloadInfo.speed = ''
    downloadInfo.progress = 99.99
    setStatusText(downloadInfo, window.i18n.t('download_status_write_queue', { num: progress.writeQueue }))
  } else {
    downloadInfo.speed = progress.speed
    downloadInfo.progress = progress.progress
  }
  throttleUpdateTask([downloadInfo])
}

const setStatus = (downloadInfo: LX.Download.ListItem, status: LX.Download.DownloadTaskStatus, statusText?: string) => { // 设置状态及状态文本
  if (statusText == null) {
    switch (status) {
      case DOWNLOAD_STATUS.RUN:
        statusText = window.i18n.t('download___status_running')
        break
      case DOWNLOAD_STATUS.WAITING:
        statusText = window.i18n.t('download___status_waiting')
        break
      case DOWNLOAD_STATUS.PAUSE:
        statusText = window.i18n.t('download___status_paused')
        break
      case DOWNLOAD_STATUS.ERROR:
        statusText = window.i18n.t('download___status_error')
        break
      case DOWNLOAD_STATUS.COMPLETED:
        statusText = window.i18n.t('download___status_completed')
        break
      default:
        statusText = ''
        break
    }
  }

  if (downloadInfo.statusText == statusText && downloadInfo.status == status) return

  if (status == DOWNLOAD_STATUS.COMPLETED) downloadInfo.isComplate = true
  downloadInfo.statusText = statusText
  downloadInfo.status = status
  throttleUpdateTask([downloadInfo])
}

const getProxy = () => {
  return proxy.enable && proxy.host ? {
    host: proxy.host,
    port: parseInt(proxy.port || '80'),
  } : proxy.envProxy ? {
    host: proxy.envProxy.host,
    port: parseInt(proxy.envProxy.port || '80'),
  } : undefined
}
interface DownloadRun { controller: AbortController }
const runs = new Map<string, DownloadRun>()
const finalizers = new Map<string, Promise<void>>()
const stopping = new Map<string, Promise<unknown>>()
const isCurrentRun = (info: LX.Download.ListItem, run: DownloadRun) => runs.get(info.id) === run && !run.controller.signal.aborted
const stopRun = async(info: LX.Download.ListItem) => {
  runs.get(info.id)?.controller.abort()
  runs.delete(info.id)
  runingTask.delete(info.id)
  const finishing = finalizers.get(info.id)
  const stopped = (finishing ? finishing.catch(() => {}) : Promise.resolve()).then(async() => window.lx.worker.download.pauseTask(info.id))
  stopping.set(info.id, stopped)
  void stopped.finally(() => { if (stopping.get(info.id) === stopped) stopping.delete(info.id) }).catch(console.error)
  return stopped
}
const handleError = (info: LX.Download.ListItem, error: any, kind?: DownloadFailureKind) => {
  const failureKind = kind ?? classifyDownloadError(error)
  info.failure = { kind: failureKind, code: String(error?.code ?? ''), message: String(error?.message ?? error ?? '') }
  info.isComplate = false
  const limitMessage = error?.code === 'DOWNLOAD_BATCH_SIZE_LIMIT' ? 'download__size_limit_batch' : 'download__size_limit_task'
  const fallback = failureKind === 'limit' ? window.i18n.t(limitMessage) : window.i18n.t(info.audioDownloaded ? 'download__postprocess_failed' : ('download__failure_' + failureKind) as any)
  setStatus(info, DOWNLOAD_STATUS.ERROR, formatError(error, fallback, 'DOWNLOAD_FAILED'))
  void stopRun(info).finally(checkStartTask).catch(console.error)
}
const getUrl = async(info: LX.Download.ListItem, run: DownloadRun, refresh = false) => {
  const url = await withRequestDeadline(30000, async() => {
    const alternate = info.metadata.musicInfo.meta.toggleMusicInfo
    if (alternate) {
      try { return await getMusicUrl({ musicInfo: alternate, quality: info.metadata.quality, isRefresh: refresh, allowToggleSource: false }) } catch { throwIfRequestCancelled() }
    }
    return getMusicUrl({ musicInfo: info.metadata.musicInfo, quality: info.metadata.quality, isRefresh: refresh, allowToggleSource: appSetting['download.isUseOtherSource'] })
  }, run.controller.signal)
  if (!url) throw Object.assign(new Error(window.i18n.t('download_status_error_url_failed')), { code: 'ERR_DOWNLOAD_URL' })
  return url
}
const completeTask = (info: LX.Download.ListItem, run: DownloadRun) => {
  if (!isCurrentRun(info, run) || finalizers.has(info.id)) return
  info.audioDownloaded = true
  info.progress = 99.99
  info.speed = ''
  setStatusText(info, window.i18n.t('download__postprocessing'))
  const settings = { ...appSetting }
  const query = { musicInfo: info.metadata.musicInfo, isRefresh: false, allowToggleSource: settings['download.isUseOtherSource'] }
  const finishing = finishDownloadFiles(info, settings, {
    lyric: async() => withRequestDeadline(20000, async() => getLyricInfo(query), run.controller.signal),
    picture: async() => withRequestDeadline(20000, async() => getPicUrl(query), run.controller.signal),
    writeMeta: async(meta, lyric) => window.lx.worker.download.writeMeta(meta, lyric, getProxy()),
    saveLrc: async(lyric, options) => window.lx.worker.download.saveLrc(lyric, options),
    cancelled: () => !isCurrentRun(info, run),
  })
  finalizers.set(info.id, finishing)
  void finishing.then(async() => {
    if (!isCurrentRun(info, run)) return
    await window.lx.worker.download.pauseTask(info.id)
    if (!isCurrentRun(info, run)) return
    info.progress = 100
    info.failure = undefined
    setStatus(info, DOWNLOAD_STATUS.COMPLETED)
    runs.delete(info.id)
    runingTask.delete(info.id)
  }, error => { if (isCurrentRun(info, run)) handleError(info, error, 'postprocess') }).finally(() => {
    if (finalizers.get(info.id) === finishing) finalizers.delete(info.id)
    void checkStartTask()
  }).catch(console.error)
}
const handleStartTask = async(info: LX.Download.ListItem, run: DownloadRun) => {
  await stopping.get(info.id)
  if (!isCurrentRun(info, run)) return
  if (info.audioDownloaded) {
    const stats = await getFileStats(info.metadata.filePath)
    if (!isCurrentRun(info, run)) return
    if (stats?.isFile() && stats.size) { completeTask(info, run); return }
    info.audioDownloaded = false
    info.metadata.fileAllocated = false
    info.downloaded = 0
  }
  if (!info.metadata.url) {
    setStatusText(info, window.i18n.t('download_status_url_getting'))
    const url = await getUrl(info, run)
    if (!isCurrentRun(info, run)) return
    setUrl(info, url)
  }
  const savePath = buildSavePath(info)
  const filePath = joinPath(savePath, info.metadata.fileName)
  if (info.metadata.filePath !== filePath) {
    info.metadata.fileAllocated = false
    info.downloaded = 0
    updateFilePath(info, filePath)
  }
  setStatusText(info, window.i18n.t('download_status_start'))
  const batchInitialBytes = info.batchId ? await getBatchInitialBytes(info.batchId) : 0
  if (!isCurrentRun(info, run)) return
  await window.lx.worker.download.startTask(toRaw(info), savePath, appSetting['download.skipExistFile'], proxyCallback((event: LX.Download.DownloadTaskActions) => {
    if (!isCurrentRun(info, run)) return
    switch (event.action) {
      case 'filePath':
        Object.assign(info.metadata, event.data, { fileAllocated: true })
        throttleUpdateTask([info])
        break
      case 'start': setStatus(info, DOWNLOAD_STATUS.RUN); break
      case 'complete': completeTask(info, run); break
      case 'progress': setProgress(info, event.data); break
      case 'statusText': setStatusText(info, event.data); break
      case 'error': handleError(info, event.data, event.data.kind); break
      case 'refreshUrl':
        setStatusText(info, window.i18n.t('download_status_error_refresh_url'))
        void getUrl(info, run, true).then(async url => {
          if (!isCurrentRun(info, run)) return
          setUrl(info, url)
          await window.lx.worker.download.updateUrl(info.id, url)
        }).catch(error => { if (isCurrentRun(info, run)) handleError(info, error) })
        break
    }
  }), getProxy(), Math.max(0, appSetting['download.rateLimit'] || 0) * 1024,
  downloadLimitBytes(appSetting['download.maxTaskSizeMiB']),
  batchInitialBytes)
}
const startTask = async(info: LX.Download.ListItem) => {
  const run: DownloadRun = { controller: new AbortController() }
  runs.set(info.id, run)
  info.isComplate = false
  if (info.failure?.kind === 'url') info.metadata.url = null
  info.failure = undefined
  setStatus(info, DOWNLOAD_STATUS.RUN)
  runingTask.set(info.id, info)
  void handleStartTask(info, run).catch(error => { if (isCurrentRun(info, run)) handleError(info, error) })
}

const getStartTask = (list: LX.Download.ListItem[]): LX.Download.ListItem | null => {
  let downloadCount = 0
  const waitList = list.filter(item => {
    if (item.status == DOWNLOAD_STATUS.WAITING) return true
    if (item.status == DOWNLOAD_STATUS.RUN) ++downloadCount
    return false
  })
  // console.log(downloadCount, waitList)
  waitList.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  return downloadCount < appSetting['download.maxDownloadNum'] ? waitList.shift() ?? null : null
}

const checkStartTask = async() => {
  if (downloadSyncLocked || (typeof navigator !== 'undefined' && !navigator.onLine)) return
  if (runingTask.size >= appSetting['download.maxDownloadNum']) return
  let result = getStartTask(downloadList)
  // console.log(result)
  while (result) {
    await startTask(result)
    result = getStartTask(downloadList)
  }
}

/**
 * 过滤重复任务
 * @param list
 */
const filterTask = (list: LX.Download.ListItem[]) => {
  const set = new Set<string>()
  for (const item of downloadList) set.add(item.id)
  return list.filter(item => {
    if (set.has(item.id)) return false
    markRaw(item.metadata)
    set.add(item.id)
    return true
  })
}
const prepareDownloadTasks = async(list: LX.Music.MusicInfoOnline[], quality: LX.Quality, listId?: string) => {
  await getDownloadList()
  return filterTask(await window.lx.worker.download.createDownloadTasks(list, quality,
    appSetting['download.fileName'], toRaw(qualityList.value), listId))
}
export interface DownloadStoragePreview {
  count: number
  availableBytes: number | null
  summary: DownloadStorageSummary
}
const assessDownloadTasks = async(tasks: LX.Download.ListItem[], isBatch: boolean): Promise<DownloadStoragePreview> => {
  let availableBytes: number | null = null
  try { availableBytes = (await getDownloadDiskSpace(appSetting['download.savePath'])).availableBytes } catch (error) { console.warn('Unable to read download disk space', (error as { code?: string })?.code ?? '') }
  return {
    count: tasks.length,
    availableBytes,
    summary: summarizeDownloadStorage(tasks,
      downloadLimitBytes(appSetting['download.maxTaskSizeMiB']),
      isBatch ? downloadLimitBytes(appSetting['download.maxBatchSizeMiB']) : 0,
      availableBytes),
  }
}
export const previewDownloadTasks = async(list: LX.Music.MusicInfoOnline[], quality: LX.Quality, listId?: string, forceBatch = false): Promise<DownloadStoragePreview> => {
  if (downloadSyncLocked) throw new Error('downloads_running')
  return assessDownloadTasks(await prepareDownloadTasks(list, quality, listId), forceBatch || list.length > 1)
}
/**
 * 创建下载任务
 * @param list 要下载的歌曲
 * @param quality 下载音质
 */
export const createDownloadTasks = async(list: LX.Music.MusicInfoOnline[], quality: LX.Quality, listId?: string, forceBatch = false): Promise<boolean> => {
  if (!list.length || checkDownloadSyncLock()) return false
  downloadMutations++
  try {
    const tasks = await prepareDownloadTasks(list, quality, listId)
    const isBatch = forceBatch || list.length > 1
    const preview = await assessDownloadTasks(tasks, isBatch)
    const failureKey = !tasks.length ? 'download__space_no_new_tasks'
      : preview.summary.overTaskCount ? 'download__space_task_exceeded'
        : preview.summary.overBatch ? 'download__space_batch_exceeded'
          : preview.summary.insufficientDisk ? 'download__space_disk_shortage' : null
    if (failureKey) {
      showToast(window.i18n.t(failureKey, { count: preview.summary.overTaskCount }), { error: true })
      return false
    }
    const batchLimitBytes = downloadLimitBytes(appSetting['download.maxBatchSizeMiB'])
    if (isBatch && batchLimitBytes) {
      const batchId = globalThis.crypto.randomUUID()
      for (const task of tasks) Object.assign(task, { batchId, batchLimitBytes })
    }
    await addTasks(tasks)
    void checkStartTask()
    return true
  } catch (error) {
    showToast(formatError(error, window.i18n.t('download___status_error'), 'DOWNLOAD_CREATE_FAILED'), { error: true })
    return false
  } finally { downloadMutations-- }
}

/**
 * 开始下载任务
 * @param list
 */
export const startDownloadTasks = async(list: LX.Download.ListItem[]) => {
  if (checkDownloadSyncLock()) return
  for (const downloadInfo of list) {
    switch (downloadInfo.status) {
      case DOWNLOAD_STATUS.PAUSE:
      case DOWNLOAD_STATUS.ERROR:
        setStatus(downloadInfo, DOWNLOAD_STATUS.WAITING)
      default:
        break
    }
  }
  void checkStartTask()
}

/**
 * 暂停下载任务
 * @param list
 */
export const pauseDownloadTasks = async(list: LX.Download.ListItem[]) => {
  if (checkDownloadSyncLock()) return
  for (const downloadInfo of list) {
    switch (downloadInfo.status) {
      case DOWNLOAD_STATUS.RUN:
        void stopRun(downloadInfo).catch(console.error)
      case DOWNLOAD_STATUS.WAITING:
      case DOWNLOAD_STATUS.ERROR:
        setStatus(downloadInfo, DOWNLOAD_STATUS.PAUSE)
      default:
        break
    }
  }
  void checkStartTask()
}

/**
 * 移除下载任务
 * @param ids 要移除的任务Id
 */
export const removeDownloadTasks = async(ids: string[]) => {
  if (checkDownloadSyncLock()) return
  downloadMutations++
  try {
    await downloadTasksRemove(ids)

    const idsSet = new Set<string>(ids)
    const newList = downloadList.filter(task => {
      if (idsSet.has(task.id) && runingTask.has(task.id)) {
        void stopRun(task).catch(console.error)
      }
      return !idsSet.has(task.id)
    })
    downloadList.splice(0, downloadList.length)
    arrPush(downloadList, newList)


    void checkStartTask()
    window.app_event.downloadListUpdate()
  } finally { downloadMutations-- }
}

export const retryFailedDownloads = async(kind?: DownloadFailureKind, list = downloadList) => {
  await startDownloadTasks(list.filter(task => task.status === DOWNLOAD_STATUS.ERROR && (!kind || task.failure?.kind === kind)))
}
export const setDownloadPriority = (list: LX.Download.ListItem[], priority: number) => {
  if (checkDownloadSyncLock()) return
  for (const task of list) task.priority = priority > 0 ? 1 : 0
  throttleUpdateTask(list)
  void checkStartTask()
}
export const setDownloadRateLimit = async(kibPerSecond: number) => {
  await window.lx.worker.download.setRateLimit(Math.max(0, Number(kibPerSecond) || 0) * 1024)
}
window.addEventListener?.('offline', () => {
  for (const info of [...runingTask.values()]) {
    if (info.audioDownloaded) continue
    void stopRun(info).catch(console.error)
    setStatus(info, appSetting['download.autoResume'] ? DOWNLOAD_STATUS.WAITING : DOWNLOAD_STATUS.PAUSE)
  }
})
window.addEventListener?.('online', () => {
  if (appSetting['download.autoResume']) void retryFailedDownloads('network')
  void checkStartTask()
})
