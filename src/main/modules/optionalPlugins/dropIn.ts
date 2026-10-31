import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { comparePluginVersions, type PluginStoreSnapshot } from '@common/optionalPlugins'
import type { PluginManager } from './manager'

// Bound the startup scan so a crowded folder cannot delay the app indefinitely.
const MAX_DROP_IN_FILES = 50
const STATE_VERSION = 1

interface DropInRecord {
  size: number
  mtimeMs: number
  sha256: string
  id?: string
  version?: string
  status: 'installed' | 'skipped' | 'error'
  error?: string
}

interface DropInState {
  version: number
  lastScanAt: number
  files: Record<string, DropInRecord>
}

export const shouldImportDropInPackage = (previousVersion: string | null, packageVersion: string) => {
  return !previousVersion || comparePluginVersions(packageVersion, previousVersion) > 0
}

export const isDropInRecordCurrent = (record: DropInRecord | undefined, file: { size: number, mtimeMs: number }) => {
  return !!record && record.size === file.size && record.mtimeMs === file.mtimeMs
}

const readState = async(statePath: string): Promise<DropInState> => {
  try {
    const state = JSON.parse(await fs.readFile(statePath, 'utf8')) as DropInState
    if (state?.version === STATE_VERSION && state.files && typeof state.files === 'object' && !Array.isArray(state.files) && Number.isFinite(state.lastScanAt)) return state
  } catch (error: any) {
    if (error.code !== 'ENOENT') console.error('Drop-in plugin state could not be read:', error.message)
  }
  return { version: STATE_VERSION, lastScanAt: 0, files: {} }
}

const writeState = async(statePath: string, state: DropInState) => {
  const temporary = `${statePath}.tmp`
  await fs.writeFile(temporary, JSON.stringify(state))
  await fs.rename(temporary, statePath)
}

const hashFile = async(filename: string) => {
  return createHash('sha256').update(await fs.readFile(filename)).digest('hex')
}

export interface DropInImportResult {
  snapshot: PluginStoreSnapshot | null
  imported: number
  failed: number
}

/**
 * Imports plugin packages dropped into a folder once per file revision.
 * Newer packages upgrade an installation; equal or older packages are skipped,
 * so a package that was uninstalled in the store is not silently restored.
 */
export const importDropInPlugins = async({ manager, directory, statePath }: {
  manager: PluginManager
  directory: string
  statePath: string
}): Promise<DropInImportResult> => {
  let entries
  try { entries = await fs.readdir(directory, { withFileTypes: true }) } catch { return { snapshot: null, imported: 0, failed: 0 } }
  const state = await readState(statePath)
  let imported = 0
  let failed = 0
  const candidates = entries
    .filter(entry => entry.isFile() && /\.(?:lxplugin|zip)$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_DROP_IN_FILES)
  for (const entry of candidates) {
    const filename = path.join(directory, entry.name)
    const file = await fs.stat(filename).catch(() => null)
    if (!file?.isFile()) continue
    const previous = state.files[entry.name]
    if (isDropInRecordCurrent(previous, file)) continue
    const sha256 = await hashFile(filename).catch(() => '')
    if (!sha256) continue
    if (previous?.sha256 === sha256) {
      state.files[entry.name] = { ...previous, size: file.size, mtimeMs: file.mtimeMs }
      continue
    }
    try {
      const prepared = await manager.prepareImport(filename)
      if (!shouldImportDropInPackage(prepared.previousVersion, prepared.manifest.version)) {
        state.files[entry.name] = { size: file.size, mtimeMs: file.mtimeMs, sha256, id: prepared.manifest.id, version: prepared.manifest.version, status: 'skipped' }
      } else {
        await manager.importPrepared(prepared)
        state.files[entry.name] = { size: file.size, mtimeMs: file.mtimeMs, sha256, id: prepared.manifest.id, version: prepared.manifest.version, status: 'installed' }
        imported++
      }
    } catch (error: any) {
      failed++
      state.files[entry.name] = { size: file.size, mtimeMs: file.mtimeMs, sha256, status: 'error', error: String(error?.message ?? error).slice(0, 300) }
      console.error(`Drop-in plugin "${entry.name}" could not be imported:`, error)
    }
  }
  state.lastScanAt = Date.now()
  await writeState(statePath, state).catch(error => { console.error('Drop-in plugin state could not be saved:', error.message) })
  return { snapshot: imported ? await manager.snapshot() : null, imported, failed }
}
