import { app, shell } from 'electron'
import fs from 'original-fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Agent, ProxyAgent } from 'undici'
import { composeDispatcher, requestWithCompatibility } from '@common/utils/undiciCompat'
import { log, isLinux } from '@common/utils'
import { mainHandle, mainOn } from '@common/mainIpc'
import { isExistWindow, sendEvent } from './index'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { getProxy } from '@main/utils'
import { quitApp } from '@main/app'
import { getWindowsUpdatePriority } from '@common/utils/update'
import { isSafeUpdatePath } from '@common/updateManifest'
import { launchWindowsInstaller } from './updateInstaller'
import { formatError } from '@common/utils/errorMessage'
import { getUpdateSources, speedTestUpdateSources, type UpdateSource } from './updateSources'
import { getUpdateExecutable, getUpdateRuntime } from './updateRuntime'
import { fileHash, prepareArchiveUpdate, prepareDifferentialUpdate, validateStagedPortable, verifyStagedUpdate, type StagedUpdate } from './updatePortable'
import { launchWindowsRelaunch } from './updateRelaunch'

interface DownloadedUpdate {
  filePath: string
  sha256: string
  size: number
  edition?: LX.UpdateEdition
  version?: string
  stage?: StagedUpdate
}

const updateState: {
  downloaded: DownloadedUpdate | null
  controller: AbortController | null
  installing: boolean
  installController: AbortController | null
  installPromise: Promise<void> | null
} = { downloaded: null, controller: null, installing: false, installController: null, installPromise: null }

const sendStatusToWindow = <T = unknown>(name: string, params?: T) => {
  if (isExistWindow()) sendEvent(name, params)
}

const buildDownloadDispatcher = () => {
  const proxy = getProxy()
  const base = proxy
    ? new ProxyAgent(`http://${proxy.host}:${proxy.port}`)
    : new Agent()
  return composeDispatcher(base, 5)
}

const removeUpdateFile = (filePath: string) => {
  const directory = path.dirname(filePath)
  // A portable update also owns its staged files. Only its mkdtemp directory
  // under the configured temp root can be removed recursively.
  if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('lx-m-update-')) return
  try { if (!fs.lstatSync(directory).isSymbolicLink()) fs.rmSync(directory, { recursive: true, force: true }) } catch {}
}

const validateAsset = (asset: LX.UpdateAsset, runtime: LX.UpdateRuntime, differential?: 'manifest' | 'payload') => {
  if (typeof asset.digest !== 'string' || !/^(?:sha256:)?[a-f0-9]{64}$/i.test(asset.digest)) throw Object.assign(new Error('更新包缺少有效的上游 SHA-256 摘要，已停止自动更新'), { code: 'UPDATE_DIGEST_REQUIRED' })
  const url = new URL(asset.downloadUrl)
  if (url.protocol !== 'https:' || url.username || url.password) throw Object.assign(new Error('更新包必须来自 HTTPS 地址'), { code: 'UPDATE_URL_INVALID' })
  if (!isSafeUpdatePath(asset.fileName) || asset.fileName.includes('/')) throw new Error('更新文件名无效')
  if (!Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > 3 * 1024 ** 3) throw new Error('更新文件大小无效')
  if (process.platform === 'win32' && !getWindowsUpdatePriority(asset.fileName, runtime, differential)) {
    const kind = { installed: 'Setup 安装包', portable: 'green 便携包', 'single-file': 'portable 单文件包', development: '更新包' }[runtime.edition]
    throw new Error(`${kind}与当前版本类型、系统架构或 Win7 版本不匹配，请手动更新`)
  }
}

const downloadFromSource = async(source: UpdateSource, dispatcher: ReturnType<typeof buildDownloadDispatcher>, controller: AbortController, tempPath: string, size: number, digest: string): Promise<DownloadedUpdate> => {
  const expectedSize = Number.isSafeInteger(size) && size > 0 ? size : 0
  const report = (progress: Omit<LX.UpdateProgressInfo, 'source'>) => {
    if (!controller.signal.aborted) sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_progress, { ...progress, source: source.name })
  }
  report({ phase: 'downloading', progress: 0, transferred: 0, total: expectedSize, bytesPerSecond: 0 })
  const response = await requestWithCompatibility(source.url, {
    method: 'GET',
    dispatcher,
    headersTimeout: 30000,
    bodyTimeout: 30000,
    headers: { 'User-Agent': 'lx-m-music-desktop', 'Accept-Encoding': 'identity' },
    signal: controller.signal,
  })
  if (response.statusCode !== 200) {
    response.body.destroy()
    throw new Error(`下载失败，状态码: ${response.statusCode}`)
  }
  const contentLength = Number(response.headers['content-length'])
  const total = Number.isSafeInteger(contentLength) && contentLength > 0 ? contentLength : expectedSize
  if (expectedSize && total !== expectedSize) {
    response.body.destroy()
    throw new Error('更新安装包不完整，返回的大小与发布信息不符')
  }
  const hash = crypto.createHash('sha256')
  let transferred = 0
  let lastReportTime = Date.now()
  let lastReportBytes = 0
  const progressStream = new Transform({
    transform(chunk: Buffer, encoding, callback) {
      hash.update(chunk)
      transferred += chunk.length
      if (transferred > (expectedSize || 3 * 1024 ** 3)) { callback(new Error('更新安装包不完整，返回的大小与发布信息不符')); return }
      const now = Date.now()
      const elapsed = (now - lastReportTime) / 1000
      if (elapsed >= 0.5) {
        report({ phase: 'downloading', progress: total ? Math.min(100, (transferred / total) * 100) : 0, transferred, total, bytesPerSecond: (transferred - lastReportBytes) / elapsed })
        lastReportTime = now
        lastReportBytes = transferred
      }
      callback(null, chunk)
    },
  })
  await pipeline(response.body, progressStream, fs.createWriteStream(tempPath, { flags: 'wx' }), { signal: controller.signal })
  controller.signal.throwIfAborted()
  if (!transferred || (size > 0 && transferred !== size) || (total > 0 && transferred !== total)) throw new Error('更新安装包下载不完整，请重新下载')
  report({ phase: 'verifying', progress: 100, transferred, total: total || transferred, bytesPerSecond: 0 })
  const actualHash = hash.digest('hex')
  const expectedHash = digest.replace(/^sha256:/i, '').toLowerCase()
  if (actualHash !== expectedHash) {
    throw new Error(`SHA-256 校验失败
期望: ${expectedHash}
实际: ${actualHash}`)
  }
  log.info('update download SHA-256 verification passed')
  return { filePath: tempPath, sha256: actualHash, size: transferred }
}

const downloadUpdate = async({ downloadUrl: url, fileName, digest, size, version, edition, differential, installAfterDownload = false }: LX.UpdateDownloadInfo) => {
  if (updateState.controller != null || updateState.installing) return
  const controller = updateState.controller = new AbortController()
  const tempName = fileName || `lx-m-music-desktop-update-${Date.now()}`
  let tempPath: string | null = null
  let dispatcher: ReturnType<typeof buildDownloadDispatcher> | null = null
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    const runtime = getUpdateRuntime()
    const fullAsset = { downloadUrl: url, fileName: tempName, digest, size }
    validateAsset(fullAsset, runtime)
    if (edition && edition !== runtime.edition) throw new Error('更新包类型与当前运行版本不匹配')
    deadline = setTimeout(() => { controller.abort(Object.assign(new Error('更新下载超过 30 分钟，请重试'), { code: 'UPDATE_TOTAL_TIMEOUT' })) }, 30 * 60_000)
    let delta: LX.UpdateDifferential | undefined
    if (process.platform === 'win32' && runtime.edition === 'portable' && differential) {
      try {
        validateAsset(differential.manifest, runtime, 'manifest')
        validateAsset(differential.payload, runtime, 'payload')
        if (!Number.isSafeInteger(differential.manifest.size) || differential.manifest.size <= 0 || differential.manifest.size > 16 * 1024 * 1024) throw new Error('差分信息大小无效')
        delta = differential
      } catch (error) { log.warn('portable differential metadata unavailable, using the matching full archive', error) }
    }
    if (updateState.downloaded) {
      removeUpdateFile(updateState.downloaded.filePath)
      updateState.downloaded = null
    }
    dispatcher = buildDownloadDispatcher()
    const probeAsset = delta?.payload ?? fullAsset
    const candidates = getUpdateSources(probeAsset.downloadUrl)
    const sources = candidates.length > 1 ? await speedTestUpdateSources(candidates, {
      dispatcher,
      signal: controller.signal,
      fileName: probeAsset.fileName,
      size: probeAsset.size,
      onProgress(testedSources, totalSources) {
        if (!controller.signal.aborted) {
          sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_progress, {
            phase: 'testing', progress: 0, transferred: 0, total: 0, bytesPerSecond: 0, testedSources, totalSources,
          } satisfies LX.UpdateProgressInfo)
        }
      },
    }) : candidates
    controller.signal.throwIfAborted()
    tempPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lx-m-update-')), tempName)
    const tempRoot = path.dirname(tempPath)
    const stageDirectory = path.join(tempRoot, 'app')
    let downloaded: DownloadedUpdate | null = null
    let lastError: unknown = new Error('没有可用的更新下载地址')
    const reroute = (asset: LX.UpdateAsset): UpdateSource[] => sources.map(source => ({
      ...source,
      url: source.url.endsWith(probeAsset.downloadUrl) ? source.url.slice(0, -probeAsset.downloadUrl.length) + asset.downloadUrl : getUpdateSources(asset.downloadUrl)[0].url,
    }))
    if (delta) {
      try {
        const manifestPath = path.join(tempRoot, delta.manifest.fileName)
        let manifestFile: DownloadedUpdate | undefined
        for (const source of reroute(delta.manifest)) {
          try {
            manifestFile = await downloadFromSource(source, dispatcher, controller, manifestPath, delta.manifest.size, delta.manifest.digest)
            break
          } catch (error) { try { fs.unlinkSync(manifestPath) } catch {}; controller.signal.throwIfAborted(); lastError = error }
        }
        if (!manifestFile) throw lastError
        const stage = await prepareDifferentialUpdate({
          manifest: JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')),
          payload: delta.payload,
          runtime,
          version,
          executable: getUpdateExecutable(),
          directory: stageDirectory,
          sources,
          dispatcher,
          signal: controller.signal,
          onProgress(info) { if (!controller.signal.aborted) sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_progress, info) },
        })
        downloaded = { ...manifestFile, stage }
      } catch (error) {
        controller.signal.throwIfAborted()
        log.warn('portable differential update failed, downloading the matching full archive', error)
        await fs.promises.rm(stageDirectory, { recursive: true, force: true })
      }
    }
    for (const source of downloaded ? [] : delta ? reroute(fullAsset) : sources) {
      controller.signal.throwIfAborted()
      try {
        log.info(`update download source: ${source.name}`)
        downloaded = await downloadFromSource(source, dispatcher, controller, tempPath, size, digest)
        break
      } catch (error) {
        try { fs.unlinkSync(tempPath) } catch {}
        controller.signal.throwIfAborted()
        lastError = error
        log.warn(`update source failed: ${source.name}`, error)
      }
    }
    if (!downloaded) throw lastError
    controller.signal.throwIfAborted()
    if (process.platform === 'win32' && runtime.edition === 'portable' && !downloaded.stage) {
      sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_progress, { phase: 'preparing', mode: 'full', progress: 100, transferred: size, total: size, bytesPerSecond: 0 })
      downloaded.stage = await prepareArchiveUpdate(tempPath, stageDirectory, getUpdateExecutable(), path.join(path.dirname(getUpdateExecutable()), 'resources'), controller.signal)
    } else if (process.platform === 'win32' && runtime.edition === 'single-file') {
      await fs.promises.mkdir(stageDirectory)
      const source = 'update.exe'
      await fs.promises.copyFile(tempPath, path.join(stageDirectory, source))
      downloaded.stage = {
        root: path.dirname(getUpdateExecutable()),
        executable: getUpdateExecutable(),
        directory: stageDirectory,
        files: [{ path: path.basename(getUpdateExecutable()), source, size: downloaded.size, sha256: downloaded.sha256 }],
        obsolete: [],
      }
    }
    if (process.platform === 'win32' && runtime.edition === 'portable' && downloaded.stage) await validateStagedPortable(downloaded.stage, runtime, version)
    if (isLinux) {
      try { fs.chmodSync(tempPath, 0o755) } catch {}
    }
    controller.signal.throwIfAborted()
    tempPath = downloaded.filePath
    updateState.downloaded = { ...downloaded, edition: runtime.edition, version }
    updateState.controller = null
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_progress, { phase: 'verifying', progress: 100, transferred: downloaded.size, total: downloaded.size, bytesPerSecond: 0 })
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_downloaded, { fileName: tempName, installAfterDownload })
    if (installAfterDownload && !controller.signal.aborted) await quitAndInstall()
  } catch (err: any) {
    if (tempPath) removeUpdateFile(tempPath)
    if (!controller.signal.aborted || controller.signal.reason?.code === 'UPDATE_TOTAL_TIMEOUT') {
      log.error('update download error:', err)
      sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_error, formatError(controller.signal.reason?.code === 'UPDATE_TOTAL_TIMEOUT' ? controller.signal.reason : err, '更新下载失败', 'UPDATE_DOWNLOAD_FAILED'))
    }
  } finally {
    clearTimeout(deadline)
    await dispatcher?.close().catch(error => { log.warn('update download dispatcher close error:', error) })
    if (updateState.controller === controller) updateState.controller = null
  }
}


const installUpdate = async(controller: AbortController) => {
  const update = updateState.downloaded
  try {
    if (updateState.controller) throw new Error('更新安装包尚未下载完成')
    if (!update || !fs.existsSync(update.filePath)) throw new Error('更新安装包不存在，请重新下载更新')
    if (process.platform === 'win32' && update.edition !== getUpdateRuntime().edition) throw new Error('更新包类型与当前运行版本不匹配，请重新下载')
    const stat = await fs.promises.lstat(update.filePath)
    controller.signal.throwIfAborted()
    if (!stat.isFile() || stat.size == 0 || stat.size != update.size) throw new Error('更新安装包不完整，请重新下载更新')
    const progress = { progress: 100, transferred: update.size, total: update.size, bytesPerSecond: 0 }
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_progress, { ...progress, phase: 'verifying' })
    if (await fileHash(update.filePath, controller.signal) !== update.sha256) throw new Error('更新安装包已发生变化，请重新下载更新')
    if (update.stage) await verifyStagedUpdate(update.stage, controller.signal)
    controller.signal.throwIfAborted()

    const installDirectory = path.dirname(app.getPath('exe'))
    const isWindowsInstall = process.platform === 'win32' && update.edition === 'installed' && app.isPackaged
    // From this point the installer can be running; cancellation must not claim
    // success or remove the file handed to it.
    updateState.installController = null
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_progress, { ...progress, phase: 'installing' })
    if (process.platform === 'win32' && update.stage && (update.edition === 'portable' || update.edition === 'single-file')) {
      await launchWindowsRelaunch(update.stage, update.edition, update.version!, path.dirname(update.filePath))
    } else if (isWindowsInstall) {
      log.info(`starting silent update: ${update.filePath} -> ${installDirectory}`)
      await launchWindowsInstaller(update.filePath, installDirectory, process.resourcesPath)
    } else {
      const errorMsg = await shell.openPath(update.filePath)
      if (errorMsg) throw new Error(`无法打开安装程序: ${errorMsg}`)
    }

    // Transfer ownership only after the installer starts. Keep the file on
    // failure, and do not let will-quit delete an installer that is still running.
    updateState.downloaded = null
    // NSIS --updated waits for the old app to close; start the normal shutdown
    // immediately so window-close handlers can save state and bypass the tray.
    if (isWindowsInstall || update.stage) quitApp()
    else setTimeout(() => { quitApp() }, 1000)
  } catch (err: any) {
    updateState.installing = false
    if (controller.signal.aborted) {
      if (update && updateState.downloaded === update) {
        updateState.downloaded = null
        removeUpdateFile(update.filePath)
      }
      return
    }
    log.error('failed to install update:', err)
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_error, String(err?.message ?? err))
  } finally {
    if (updateState.installController === controller) updateState.installController = null
  }
}

const quitAndInstall = async() => {
  if (updateState.installing) return
  updateState.installing = true
  const controller = updateState.installController = new AbortController()
  const promise = updateState.installPromise = installUpdate(controller)
  try { await promise } finally {
    if (updateState.installPromise === promise) updateState.installPromise = null
  }
}

const cancelUpdate = async(): Promise<boolean> => {
  if (updateState.installing && !updateState.installController) return false
  updateState.controller?.abort()
  updateState.controller = null
  if (updateState.installController) {
    updateState.installController.abort()
    // Wait for the verification stream to close before allowing another task.
    await updateState.installPromise
  }
  if (updateState.downloaded) removeUpdateFile(updateState.downloaded.filePath)
  updateState.downloaded = null
  return true
}

export default () => {
  mainHandle<LX.UpdateRuntime>(WIN_MAIN_RENDERER_EVENT_NAME.update_get_runtime, async() => getUpdateRuntime())
  mainOn<LX.UpdateDownloadInfo | null>(WIN_MAIN_RENDERER_EVENT_NAME.update_download_update, ({ params }) => {
    if (params?.downloadUrl) {
      void downloadUpdate(params)
    } else void cancelUpdate()
  })

  mainHandle<boolean>(WIN_MAIN_RENDERER_EVENT_NAME.update_cancel_update, cancelUpdate)

  mainOn(WIN_MAIN_RENDERER_EVENT_NAME.quit_update, () => {
    void quitAndInstall()
  })

  app.on('will-quit', () => {
    updateState.controller?.abort()
    updateState.installController?.abort()
    if (updateState.downloaded) removeUpdateFile(updateState.downloaded.filePath)
  })
}
