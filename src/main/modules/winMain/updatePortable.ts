import fs from 'original-fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { inflateRaw } from 'node:zlib'
import { promisify } from 'node:util'
import type { Dispatcher } from 'undici'
import { requestWithCompatibility } from '@common/utils/undiciCompat'
import { isManagedUpdatePath, isSafeUpdatePath, parsePortableManifest, type UpdateFile } from '@common/updateManifest'
import type { UpdateSource } from './updateSources'

const inflate = promisify(inflateRaw)
const hash = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex')
const inventoryPath = 'resources/lx-update-inventory.json'

const writeAt = async(handle: fs.promises.FileHandle, bytes: Buffer, position: number) => {
  let written = 0
  while (written < bytes.length) {
    const result = await handle.write(bytes, written, bytes.length - written, position + written)
    if (!result.bytesWritten) throw new Error('无法写入更新文件')
    written += result.bytesWritten
  }
}

export interface StagedUpdate {
  root: string
  executable: string
  directory: string
  files: Array<{ path: string, source: string, size: number, sha256: string }>
  obsolete: Array<{ path: string, sha256: string }>
}

export const assertUnlinkedPath = (filePath: string) => {
  let current = path.resolve(filePath)
  while (true) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('更新路径包含链接，已停止自动更新') } catch (error: any) { if (error.code !== 'ENOENT') throw error }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
}

export const fileHash = async(filePath: string, signal: AbortSignal) => {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath, { signal })) hash.update(chunk)
  return hash.digest('hex')
}

const targetPath = (name: string, executable: string) => name.toLowerCase() === 'lx-m music.exe' ? path.basename(executable) : name

const obsoleteFiles = async(root: string, files: StagedUpdate['files'], signal: AbortSignal): Promise<StagedUpdate['obsolete']> => {
  const inventory = path.join(root, inventoryPath)
  assertUnlinkedPath(inventory)
  try {
    const stat = await fs.promises.stat(inventory)
    if (stat.size > 16 * 1024 * 1024) return []
    const info = JSON.parse(await fs.promises.readFile(inventory, 'utf8'))
    if (info.schema !== 1 || info.appId !== 'com.lx-m.music.desktop' || !Array.isArray(info.files) || info.files.length > 10000) return []
    const current = new Set(files.map(file => file.path.toLowerCase()))
    const obsolete: StagedUpdate['obsolete'] = []
    for (const entry of info.files) {
      signal.throwIfAborted()
      if (typeof entry.path !== 'string' || !isManagedUpdatePath(entry.path) || current.has(entry.path.toLowerCase()) || !/^[a-f0-9]{64}$/i.test(entry.sha256)) continue
      const file = path.join(root, entry.path)
      assertUnlinkedPath(file)
      if (fs.existsSync(file) && (await fs.promises.stat(file)).isFile() && await fileHash(file, signal) === entry.sha256.toLowerCase()) obsolete.push({ path: entry.path, sha256: entry.sha256.toLowerCase() })
    }
    return obsolete
  } catch (error) {
    signal.throwIfAborted()
    return []
  }
}

const makeStage = async(directory: string, executable: string, files: Array<Pick<UpdateFile, 'path' | 'size' | 'sha256'>>, signal: AbortSignal): Promise<StagedUpdate> => {
  const root = path.dirname(executable)
  assertUnlinkedPath(root)
  const staged = files.map(file => ({ ...file, source: file.path, path: targetPath(file.path, executable) }))
  return { root, executable, directory, files: staged, obsolete: await obsoleteFiles(root, staged, signal) }
}

export const verifyStagedUpdate = async(stage: StagedUpdate, signal: AbortSignal) => {
  assertUnlinkedPath(stage.root)
  assertUnlinkedPath(stage.directory)
  for (const file of stage.files) {
    signal.throwIfAborted()
    const name = path.join(stage.directory, file.source)
    assertUnlinkedPath(name)
    const stat = await fs.promises.stat(name)
    if (!stat.isFile() || stat.size !== file.size || await fileHash(name, signal) !== file.sha256) throw new Error('已准备的更新文件发生变化，请重新下载')
  }
}

export const validateStagedPortable = async(stage: StagedUpdate, runtime: LX.UpdateRuntime, version: string) => {
  const markerPath = path.join(stage.directory, 'resources/lx-update-runtime.json')
  if (fs.existsSync(markerPath)) {
    const marker = JSON.parse(await fs.promises.readFile(markerPath, 'utf8'))
    if (marker.schema !== 1 || marker.appId !== 'com.lx-m.music.desktop' || marker.edition !== 'portable' || marker.version !== version || marker.arch !== runtime.arch || marker.win7 !== runtime.win7) throw new Error('便携包内的版本类型、版本号或架构与本次更新不匹配')
  }
  const file = await fs.promises.open(path.join(stage.directory, 'LX-M Music.exe'), 'r')
  try {
    const header = Buffer.alloc(64)
    await file.read(header, 0, header.length, 0)
    const offset = header.readUInt32LE(60)
    if (header.subarray(0, 2).toString() !== 'MZ' || offset > 1024 * 1024) throw new Error('便携包内的程序无效')
    const pe = Buffer.alloc(6)
    await file.read(pe, 0, pe.length, offset)
    const machine = { x64: 0x8664, ia32: 0x14c, arm64: 0xaa64 }[runtime.arch]
    if (pe.readUInt32LE(0) !== 0x4550 || !machine || pe.readUInt16LE(4) !== machine) throw new Error('便携包内的程序架构与当前版本不匹配')
  } finally { await file.close() }
}

interface DifferentialOptions {
  manifest: unknown
  payload: LX.UpdateAsset
  runtime: LX.UpdateRuntime
  version: string
  executable: string
  directory: string
  sources: UpdateSource[]
  dispatcher: Dispatcher
  signal: AbortSignal
  onProgress: (info: LX.UpdateProgressInfo) => void
}

export const prepareDifferentialUpdate = async(options: DifferentialOptions): Promise<StagedUpdate> => {
  const { directory, executable, signal } = options
  const manifest = parsePortableManifest(options.manifest, options.runtime, options.version, options.payload)
  const root = path.dirname(executable)
  assertUnlinkedPath(root)
  await fs.promises.mkdir(directory, { recursive: true })
  const needed: Array<{ file: UpdateFile, chunk: UpdateFile['chunks'][number], position: number }> = []
  let reusedBytes = 0
  let total = 0
  let transferred = 0
  const started = Date.now()
  const report = (phase: LX.UpdateProgressInfo['phase'], source?: string) => {
    options.onProgress({
      phase,
      mode: 'differential',
      progress: total ? transferred / total * 100 : 0,
      transferred,
      total,
      bytesPerSecond: transferred * 1000 / Math.max(1, Date.now() - started),
      reusedBytes,
      source,
    })
  }
  report('preparing')
  // Stage verified local chunks first; the current application is never modified.
  for (const file of manifest.files) {
    signal.throwIfAborted()
    const oldPath = path.join(root, targetPath(file.path, executable))
    assertUnlinkedPath(oldPath)
    const old = await fs.promises.open(oldPath, 'r').catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return null })
    const output = path.join(directory, file.path)
    await fs.promises.mkdir(path.dirname(output), { recursive: true })
    const staged = await fs.promises.open(output, 'wx')
    try {
      let position = 0
      for (const chunk of file.chunks) {
        signal.throwIfAborted()
        const bytes = Buffer.alloc(chunk.size)
        const read = old ? await old.read(bytes, 0, bytes.length, position) : null
        if (read?.bytesRead === chunk.size && hash(bytes) === chunk.sha256.toLowerCase()) {
          await writeAt(staged, bytes, position)
          reusedBytes += bytes.length
        } else {
          needed.push({ file, chunk, position })
          total += chunk.length
        }
        position += chunk.size
      }
      await staged.truncate(file.size)
    } finally { await old?.close(); await staged.close() }
  }
  report('downloading')
  for (const { file, chunk, position } of needed) {
    signal.throwIfAborted()
    let bytes: Buffer | undefined
    let selected: string | undefined
    let failure: unknown = new Error('差分下载节点不可用')
    for (const source of options.sources) {
      let body: Awaited<ReturnType<typeof requestWithCompatibility>>['body'] | undefined
      try {
        const response = await requestWithCompatibility(source.url, {
          method: 'GET',
          dispatcher: options.dispatcher,
          signal,
          headersTimeout: 15000,
          bodyTimeout: 15000,
          headers: { 'User-Agent': 'lx-m-music-desktop', 'Accept-Encoding': 'identity', Range: `bytes=${chunk.offset}-${chunk.offset + chunk.length - 1}` },
        })
        body = response.body
        if (response.statusCode !== 206 || String(response.headers['content-range']) !== `bytes ${chunk.offset}-${chunk.offset + chunk.length - 1}/${options.payload.size}`) throw new Error('节点不支持精确差分下载')
        const buffers: Buffer[] = []
        let length = 0
        for await (const raw of body) {
          length += raw.length
          if (length > chunk.length) throw new Error('差分数据大小无效')
          buffers.push(Buffer.from(raw))
        }
        if (length !== chunk.length) throw new Error('差分数据不完整')
        const data = Buffer.concat(buffers, length)
        const decoded = chunk.encoding === 'raw' ? data : await inflate(data, { maxOutputLength: chunk.size })
        if (decoded.length !== chunk.size || hash(decoded) !== chunk.sha256.toLowerCase()) throw new Error('差分数据 SHA-256 校验失败')
        signal.throwIfAborted()
        bytes = decoded
        selected = source.name
        break
      } catch (error) { signal.throwIfAborted(); failure = error } finally { body?.destroy() }
    }
    if (!bytes) throw failure
    const output = await fs.promises.open(path.join(directory, file.path), 'r+')
    try { await writeAt(output, bytes, position) } finally { await output.close() }
    transferred += chunk.length
    report('downloading', selected)
  }
  report('verifying')
  const stage = await makeStage(directory, executable, manifest.files, signal)
  await verifyStagedUpdate(stage, signal)
  return stage
}

export const prepareArchiveUpdate = async(archive: string, directory: string, executable: string, resources: string, signal: AbortSignal): Promise<StagedUpdate> => {
  const sevenZip = path.join(resources, 'update-tools/7za.exe')
  assertUnlinkedPath(sevenZip)
  await fs.promises.access(sevenZip, fs.constants.R_OK)
  const run = async(args: string[]) => new Promise<string>((resolve, reject) => {
    execFile(sevenZip, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, signal }, (error, stdout) => { if (error) reject(error); else resolve(stdout) })
  })
  const listing = await run(['l', '-slt', '-ba', '-sccUTF-8', archive])
  for (const entry of listing.split(/\r?\n\r?\n/)) {
    const name = /^Path = (.+)$/m.exec(entry)?.[1]?.replace(/\r$/, '').replace(/\\/g, '/')
    if (!name) continue
    if (!isSafeUpdatePath(name) || /(?:Symbolic Link|Hard Link) =/i.test(entry)) throw new Error('便携压缩包包含不安全的路径或链接')
    const folder = /^Folder = \+/m.test(entry) || /^Attributes = .*D/m.test(entry)
    const managedFolder = ['resources', 'locales', 'swiftshader', 'licenses'].includes(name.split('/')[0].toLowerCase())
    if (folder ? !managedFolder : !isManagedUpdatePath(name)) throw new Error('便携压缩包包含非程序文件')
  }
  await fs.promises.mkdir(directory, { recursive: true })
  await run(['x', '-y', '-bd', '-sccUTF-8', archive, `-o${directory}`])
  const files: Array<Pick<UpdateFile, 'path' | 'size' | 'sha256'>> = []
  const walk = async(relative = '') => {
    for (const name of await fs.promises.readdir(path.join(directory, relative))) {
      signal.throwIfAborted()
      const item = relative ? relative + '/' + name : name
      const location = path.join(directory, item)
      const stat = await fs.promises.lstat(location)
      if (stat.isSymbolicLink()) throw new Error('便携压缩包包含链接')
      if (stat.isDirectory()) await walk(item)
      else if (stat.isFile()) {
        if (!isManagedUpdatePath(item)) throw new Error('便携压缩包包含非程序文件')
        files.push({ path: item, size: stat.size, sha256: await fileHash(location, signal) })
      }
    }
  }
  await walk()
  if (!files.some(file => file.path === 'LX-M Music.exe') || !files.some(file => file.path === 'resources/app.asar')) throw new Error('便携压缩包缺少程序文件')
  return makeStage(directory, executable, files, signal)
}
