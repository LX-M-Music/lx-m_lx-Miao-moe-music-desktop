export const OFFICIAL_PLUGIN_ROOT = 'https://raw.githubusercontent.com/Miao-moe/lx-m_lx-Miao-moe-music-desktop/master/plugins/store/'
// GitHub accelerators that proxy raw.githubusercontent.com. Checked 2026-10-28
// against the plugin catalog; unavailable nodes are skipped at runtime.
export const PLUGIN_MIRROR_PREFIXES = [
  'https://gh-proxy.com/',
  'https://ghfast.top/',
  'https://ghproxy.net/',
]
export const pluginSourceUrls = (url: string, useMirror: boolean) => {
  return useMirror ? [...PLUGIN_MIRROR_PREFIXES.map(prefix => prefix + url), url] : [url]
}
export const PLUGIN_API_VERSION = 3
export const PLUGIN_CATALOG_FILE = 'catalog.json'
export const isPluginApiSupported = (version: number) => version === 1 || version === 2 || version === PLUGIN_API_VERSION
export type PluginId = string
export type PluginText = string | Record<string, string>

export interface PluginDisplayInfo {
  name?: PluginText
  description?: PluginText
  icon?: string
}

export interface PluginManifest extends PluginDisplayInfo {
  id: PluginId
  version: string
  apiVersion: number
  entry: string
  lyricEntry?: string
  styles: string[]
  lyricStyles?: string[]
  files: Array<{ path: string, bytes: number, sha256: string }>
}

export type PluginPackageFormat = 'lxplugin' | 'zip'
export interface PluginPackage {
  path: string
  bytes: number
  sha256: string
}
export interface PluginCatalogEntry extends PluginDisplayInfo, PluginPackage {
  id: PluginId
  version: string
  apiVersion: number
  packages?: Partial<Record<PluginPackageFormat, PluginPackage>>
}
export const pluginPackages = (entry: PluginCatalogEntry): Partial<Record<PluginPackageFormat, PluginPackage>> => ({
  [entry.path.endsWith('.lxplugin') ? 'lxplugin' : 'zip']: { path: entry.path, bytes: entry.bytes, sha256: entry.sha256 },
  ...entry.packages,
})

export interface PluginSourceManifest extends PluginDisplayInfo {
  format: 'lx-m-plugin-source'
  formatVersion: 1
  id: PluginId
  version: string
  apiVersion: number
  entry: string
  lyricEntry?: string
  files: PluginManifest['files']
  assets?: Array<{ from: string, to: string }>
  browser?: { entry: string, output: 'engine', tailwind?: boolean, aliases?: Record<string, string>, replacements?: Array<{ from: string, to: string }> }
}

export interface PluginCatalog {
  schemaVersion: 2
  plugins: PluginCatalogEntry[]
}

export interface InstalledPlugin {
  manifest: PluginManifest
  directory: string
  source?: 'official' | 'local'
  format?: PluginPackageFormat
  enabled?: boolean
}

export interface PluginLoadFailure {
  message: string
  failedVersion: string
  surface?: 'main' | 'lyric'
}

export interface PluginStoreSnapshot {
  revision: number
  catalog: PluginCatalogEntry[]
  installed: Partial<Record<PluginId, InstalledPlugin>>
  errors: Partial<Record<PluginId, string>>
  sources?: Partial<Record<PluginId, 'official' | 'local'>>
  loadFailures?: Partial<Record<PluginId, PluginLoadFailure>>
  catalogError: string | null
}

export type PluginTransferErrorCode = 'invalid_package' | 'incompatible' | 'read_failed' | 'write_failed' | 'changed' | 'not_installed' | 'corrupt_installation' | 'invalid_destination' | 'busy' | 'compile_failed' | 'builtin'
export type PluginTransferResult<T> = { status: 'success', value: T } | { status: 'cancelled' } | { status: 'error', code: PluginTransferErrorCode, detail?: string }
export interface PluginTransferLabels {
  title: string
  filter: string
  confirm: string
  cancel: string
  trust: string
  install: string
  replace: string
  downgrade: string
  unknownVersion: string
}

export const PLUGIN_IPC = {
  list: 'optional_plugins:list',
  refresh: 'optional_plugins:refresh',
  install: 'optional_plugins:install',
  uninstall: 'optional_plugins:uninstall',
  setEnabled: 'optional_plugins:set_enabled',
  runtimeResult: 'optional_plugins:runtime_result',
  import: 'optional_plugins:import',
  export: 'optional_plugins:export',
  scanDropIn: 'optional_plugins:scan_drop_in',
  progress: 'optional_plugins:progress',
  changed: 'optional_plugins:changed',
} as const

// Validate names used as paths and object keys for both catalog and local plugins.
export const isPluginId = (value: unknown): value is PluginId => typeof value == 'string' && value.length <= 64 &&
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) &&
  !/^(constructor|prototype|con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(value)

export const pluginText = (value: PluginText | undefined, language: string, fallback = '') => {
  if (typeof value === 'string') return value
  if (!value) return fallback
  return value[language] ?? value[language.split('-')[0]] ?? value['en-us'] ?? value['zh-cn'] ?? Object.values(value)[0] ?? fallback
}

export const comparePluginVersions = (left: string, right: string) => {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  return 0
}
