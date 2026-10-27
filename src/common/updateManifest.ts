export interface UpdateChunk {
  offset: number
  length: number
  size: number
  sha256: string
  encoding: 'deflate' | 'raw'
}

export interface UpdateFile {
  path: string
  size: number
  sha256: string
  chunks: UpdateChunk[]
}

export interface UpdateInventoryEntry {
  path: string
  size: number
  sha256: string
}

export interface UpdateInventory {
  schema: 1
  appId: 'com.lx-m.music.desktop'
  files: UpdateInventoryEntry[]
}

export interface UpdateRuntimeMarker {
  schema: 1
  appId: 'com.lx-m.music.desktop'
  edition: LX.UpdateEdition
  arch: string
  win7: boolean
  version: string
}

export interface PortableManifest {
  schema: 1
  appId: 'com.lx-m.music.desktop'
  version: string
  arch: string
  win7: boolean
  edition: 'portable'
  payload: { fileName: string, size: number, sha256: string }
  files: UpdateFile[]
}

export const isSafeUpdatePath = (name: string): boolean => {
  if (!name || name.length > 512 || /[\\:"<>|?*]/.test(name) || Array.from(name).some(char => char.charCodeAt(0) < 32) || name.startsWith('/')) return false
  return name.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
}

// Only program files belong to an update. Local data and extra user files stay
// outside this list even if an old inventory or archive accidentally names them.
export const isManagedUpdatePath = (name: string): boolean => {
  if (!isSafeUpdatePath(name)) return false
  const parts = name.split('/')
  if (parts.length > 1) return ['resources', 'locales', 'swiftshader', 'licenses'].includes(parts[0].toLowerCase())
  return /^(?:LX-M Music\.exe|LICENSE|LICENSE\.electron\.txt|LICENSES\.chromium\.html|version|vk_swiftshader_icd\.json)$/i.test(name) || /\.(?:dll|pak|bin|dat)$/i.test(name)
}

const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
const integer = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max

export const parsePortableManifest = (value: any, runtime: LX.UpdateRuntime, version: string, payload: LX.UpdateAsset): PortableManifest => {
  const fail = (): never => { throw new Error('便携版差分信息无效或与当前版本类型、架构不匹配') }
  if (!value || value.schema !== 1 || value.appId !== 'com.lx-m.music.desktop' || value.edition !== 'portable' ||
    runtime.edition !== 'portable' || value.version !== version || value.arch !== runtime.arch || value.win7 !== runtime.win7 ||
    value.payload?.fileName !== payload.fileName || value.payload.size !== payload.size || !hash(value.payload.sha256) ||
    value.payload.sha256.toLowerCase() !== payload.digest.replace(/^sha256:/i, '').toLowerCase() ||
    !Array.isArray(value.files) || value.files.length === 0 || value.files.length > 10000 || !integer(payload.size, 3 * 1024 ** 3)) fail()
  const names = new Set<string>()
  let offset = 0
  let bytes = 0
  for (const file of value.files) {
    if (typeof file.path !== 'string' || !isManagedUpdatePath(file.path) || names.has(file.path.toLowerCase()) || !hash(file.sha256) ||
      !integer(file.size, 1024 ** 3) || !Array.isArray(file.chunks) || file.chunks.length > 8192) fail()
    names.add(file.path.toLowerCase())
    let size = 0
    for (const chunk of file.chunks) {
      if (!chunk || chunk.offset !== offset || !integer(chunk.length, 1024 * 1024 + 1024) || chunk.length === 0 ||
        !integer(chunk.size, 1024 * 1024) || chunk.size === 0 || !hash(chunk.sha256) || !['deflate', 'raw'].includes(chunk.encoding)) fail()
      offset += chunk.length
      size += chunk.size
    }
    bytes += file.size
    if (size !== file.size || bytes > 3 * 1024 ** 3 || offset > payload.size) fail()
  }
  if (offset !== payload.size || !names.has('lx-m music.exe') || !names.has('resources/app.asar')) fail()
  return value as PortableManifest
}

// The inventory is packaged next to the application and lists the exact bytes
// of every program file. It is used to update an installed application in place
// from the Setup archive instead of running the NSIS installer again.
export const parseUpdateInventory = (value: any): UpdateInventory => {
  const fail = (): never => { throw new Error('更新包内的程序清单无效') }
  if (!value || value.schema !== 1 || value.appId !== 'com.lx-m.music.desktop' ||
    !Array.isArray(value.files) || value.files.length === 0 || value.files.length > 20000) fail()
  const names = new Set<string>()
  for (const file of value.files) {
    if (!file || typeof file.path !== 'string' || !isManagedUpdatePath(file.path) || names.has(file.path.toLowerCase()) ||
      !hash(file.sha256) || !integer(file.size, 1024 ** 3)) fail()
    names.add(file.path.toLowerCase())
  }
  if (!names.has('lx-m music.exe') || !names.has('resources/app.asar')) fail()
  return value as UpdateInventory
}

export const parseUpdateRuntimeMarker = (value: any): UpdateRuntimeMarker => {
  const editions = ['installed', 'portable', 'single-file', 'development']
  if (!value || value.schema !== 1 || value.appId !== 'com.lx-m.music.desktop' || !editions.includes(value.edition) ||
    typeof value.arch !== 'string' || value.arch.length === 0 || typeof value.win7 !== 'boolean' ||
    typeof value.version !== 'string' || value.version.length === 0 || value.version.length > 64) throw new Error('更新包内的版本类型信息无效')
  return value as UpdateRuntimeMarker
}
