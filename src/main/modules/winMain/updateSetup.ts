import fs from 'original-fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { parseUpdateInventory, parseUpdateRuntimeMarker } from '@common/updateManifest'
import { assertUnlinkedPath, fileHash, makeStage, UPDATE_INVENTORY_PATH, validateStagedEdition, verifyStagedUpdate, type StagedUpdate } from './updatePortable'

// electron-builder stores the application payload as an uncompressed 7z archive
// inside the NSIS installer. Reading that payload lets an installed application
// replace only the changed files instead of running the installer again.
const RUNTIME_MARKER_PATH = 'resources/lx-update-runtime.json'
const HASH_CONCURRENCY = 8

export interface SetupUpdateOptions {
  archive: string
  executable: string
  version: string
  runtime: LX.UpdateRuntime
  directory: string
  resources: string
  signal: AbortSignal
  onProgress?: (info: LX.UpdateProgressInfo) => void
}

const runSevenZip = async(sevenZip: string, args: string[], signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  execFile(sevenZip, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, signal }, (error, stdout, stderr) => {
    if (error) {
      reject(new Error(`解包更新安装包失败：${String(stderr || stdout || error.message).trim().slice(0, 400)}`))
      return
    }
    resolve()
  })
})

const mapLimit = async<T, R>(items: T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async() => {
    while (next < items.length) {
      const index = next++
      results[index] = await run(items[index], index)
    }
  }))
  return results
}

export const prepareSetupUpdate = async(options: SetupUpdateOptions): Promise<StagedUpdate> => {
  const { archive, executable, version, runtime, directory, resources, signal, onProgress } = options
  if (runtime.edition !== 'installed') throw new Error('当前版本类型不支持文件级更新')
  if (path.basename(executable).toLowerCase() !== 'lx-m music.exe') throw new Error('安装目录中的程序文件名已变更，需使用安装程序更新')
  const sevenZip = path.join(resources, 'update-tools/7za.exe')
  assertUnlinkedPath(sevenZip)
  await fs.promises.access(sevenZip, fs.constants.R_OK)
  assertUnlinkedPath(archive)
  const root = path.dirname(executable)
  assertUnlinkedPath(root)
  // Fail fast on read-only installation directories (for example Program Files)
  // before spending time on extraction; the caller falls back to the installer.
  const probePath = path.join(root, `.lx-m-update-write-${crypto.randomUUID()}`)
  const probe = await fs.promises.open(probePath, 'wx')
  await probe.close()
  await fs.promises.unlink(probePath)
  const metaDirectory = path.join(path.dirname(directory), 'meta')
  const report = (progress: number, transferred: number, total: number) => {
    onProgress?.({ phase: 'preparing', mode: 'setup', progress, transferred, total, bytesPerSecond: 0 })
  }
  await fs.promises.rm(metaDirectory, { recursive: true, force: true })
  await fs.promises.mkdir(metaDirectory, { recursive: true })
  try {
    report(0, 0, 0)
    await runSevenZip(sevenZip, ['e', '-y', '-bd', '-bso0', '-bsp0', '-scsUTF-8', archive, UPDATE_INVENTORY_PATH, RUNTIME_MARKER_PATH, `-o${metaDirectory}`], signal)
    signal.throwIfAborted()
    const inventoryBytes = await fs.promises.readFile(path.join(metaDirectory, 'lx-update-inventory.json'))
    const inventory = parseUpdateInventory(JSON.parse(inventoryBytes.toString('utf8')))
    const marker = parseUpdateRuntimeMarker(JSON.parse(await fs.promises.readFile(path.join(metaDirectory, 'lx-update-runtime.json'), 'utf8')))
    if (marker.edition !== 'installed' || marker.version !== version || marker.arch !== runtime.arch || marker.win7 !== runtime.win7) {
      throw new Error('更新安装包与当前版本类型、版本号或架构不匹配')
    }
    // Only files whose bytes differ are staged. Everything else stays untouched
    // on disk, which keeps the update small and leaves shortcuts intact.
    const changed = await mapLimit(inventory.files, HASH_CONCURRENCY, async(file) => {
      signal.throwIfAborted()
      const target = path.join(root, file.path)
      const stat = await fs.promises.lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (!stat) return true
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('更新目标不是普通文件，已停止自动更新')
      if (stat.size !== file.size) return true
      return await fileHash(target, signal) !== file.sha256.toLowerCase()
    })
    const files = inventory.files.filter((_file, index) => changed[index])
    const ensure = (name: string) => {
      const entry = inventory.files.find(file => file.path.toLowerCase() === name.toLowerCase())
      if (!entry) throw new Error('更新安装包缺少必要的程序文件')
      if (!files.some(file => file.path.toLowerCase() === name.toLowerCase())) files.push(entry)
    }
    ensure('LX-M Music.exe')
    ensure(RUNTIME_MARKER_PATH)
    const inventoryEntry = { path: UPDATE_INVENTORY_PATH, size: inventoryBytes.length, sha256: crypto.createHash('sha256').update(inventoryBytes).digest('hex') }
    if (!files.some(file => file.path.toLowerCase() === UPDATE_INVENTORY_PATH.toLowerCase())) files.push(inventoryEntry)
    const total = files.reduce((sum, file) => sum + file.size, 0)
    report(10, 0, total)
    const listFile = path.join(metaDirectory, 'files.txt')
    await fs.promises.writeFile(listFile, files.map(file => file.path).join('\n') + '\n', 'utf8')
    await fs.promises.rm(directory, { recursive: true, force: true })
    await fs.promises.mkdir(directory, { recursive: true })
    await runSevenZip(sevenZip, ['x', '-y', '-bd', '-bso0', '-bsp0', '-scsUTF-8', archive, `-o${directory}`, `@${listFile}`], signal)
    signal.throwIfAborted()
    await mapLimit(files, HASH_CONCURRENCY, async(file) => {
      signal.throwIfAborted()
      const staged = path.join(directory, file.path)
      const stat = await fs.promises.lstat(staged)
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== file.size) throw new Error('更新文件解包不完整')
      if (await fileHash(staged, signal) !== file.sha256.toLowerCase()) throw new Error('更新文件校验失败')
    })
    const stage = await makeStage(directory, executable, files, signal, inventory.files.map(file => file.path))
    await validateStagedEdition(stage, runtime, version, 'installed')
    await verifyStagedUpdate(stage, signal)
    report(100, total, total)
    return stage
  } catch (error) {
    await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {})
    throw error
  } finally {
    await fs.promises.rm(metaDirectory, { recursive: true, force: true }).catch(() => {})
  }
}
