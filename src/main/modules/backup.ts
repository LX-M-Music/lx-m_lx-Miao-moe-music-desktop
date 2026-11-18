import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { assertIpcRequest } from '@main/utils/ipcPolicy'
import { errorForTransport } from '@common/utils/errorMessage'
import { BACKUP_COMPAT_KINDS, BACKUP_IPC, BACKUP_SECTIONS, BackupError, buildCompatExport, preferenceFile, validateBackupData, type BackupCompatKind, type BackupData, type BackupPreview, type BackupSection } from '@common/backup'
import { LIST_IDS, STORE_NAMES } from '@common/constants'
import { readFileLimited, saveLxConfigFile } from '@common/utils/nodejs'
import getStore, { withStoreExclusive, protectStoreRecovery } from '@main/utils/store'
import { mergeSetting } from '@main/utils'
import { serializePublicConfig } from '@main/utils/credentials'
import { getPluginManager, notifyPluginBackupRestored } from './optionalPlugins'
import { getWebContents } from './winMain/main'
import type { BackupFile } from '@main/worker/dbService/backup'

const handle = (name: string, listener: (event: Electron.IpcMainInvokeEvent, params: any) => unknown) => {
  ipcMain.handle(name, async(event, params) => {
    try { return await listener(event, params) } catch (error) { throw errorForTransport(error) }
  })
}

const preferences = async() => {
  const directory = path.join(global.lxDataPath, 'plugins/preferences')
  const files = await fs.readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  const result: Record<string, Record<string, unknown>> = {}
  for (const file of files) {
    if (!file.name.endsWith('.json')) continue
    if (!file.isFile() || !preferenceFile(file.name) || Object.keys(result).length >= 500) throw new BackupError('invalid', 'preferences')
    result[file.name] = JSON.parse((await readFileLimited(path.join(directory, file.name), 1024 * 1024)).toString('utf8'))
  }
  return result
}

export default () => {
  let preview: { token: string, sender: number, time: number, data: BackupData } | null = null
  let previewTimer: NodeJS.Timeout | undefined
  let previewOwner: Electron.WebContents | undefined
  const clearPreview = () => {
    clearTimeout(previewTimer)
    previewOwner?.removeListener('destroyed', clearPreview)
    previewOwner = undefined
    preview = null
  }
  let busy = false
  const authorize = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== getWebContents() || event.senderFrame !== event.sender.mainFrame) throw new BackupError('window')
  }
  const exclusive = async<T>(action: () => Promise<T>) => {
    if (busy) throw new BackupError('busy')
    busy = true
    try { return await action() } finally {
      // eslint-disable-next-line require-atomic-updates -- This operation exclusively owns the busy flag.
      busy = false
    }
  }
  handle(BACKUP_IPC.preview, async(event, filename: string): Promise<BackupPreview> => {
    assertIpcRequest(event, BACKUP_IPC.preview, filename)
    authorize(event)
    return exclusive(async() => {
      clearPreview()
      if (typeof filename !== 'string' || filename.length > 8192) throw new BackupError('invalid')
      const { data, createdAt } = await global.lx.worker.dbService.backupPreviewFile(filename)
      if (event.sender.isDestroyed()) throw new BackupError('window')
      const token = randomUUID()
      preview = { token, sender: event.sender.id, time: Date.now(), data }
      previewOwner = event.sender
      previewOwner.once('destroyed', clearPreview)
      previewTimer = setTimeout(clearPreview, 15 * 60_000)
      previewTimer.unref()
      const counts: BackupPreview['counts'] = {}
      for (const section of BACKUP_SECTIONS) {
        if (data[section] === undefined) continue
        counts[section] = section === 'plugins'
          ? new Set([...Object.keys(data.plugins!.enabled), ...Object.keys(data.plugins!.preferences).map(name => name.replace(/\.json$/, ''))]).size
          : section === 'library' ? data.library!.versions.length + data.library!.listening.length + Object.keys(data.library!.preferences.lists).length
            : section === 'settings' ? Object.keys(data.settings ?? {}).length : (data[section] as unknown[]).length
      }
      return { token, filename: path.basename(filename), createdAt, counts, playlists: (data.playlists ?? []).map(list => ({ id: list.id, name: list.name, count: list.list.length })) }
    })
  })
  handle(BACKUP_IPC.discard, (event, token: string) => { assertIpcRequest(event, BACKUP_IPC.discard, token); authorize(event); if (preview?.token === token) clearPreview() })
  const isCompatKind = (kind: unknown): kind is BackupCompatKind => typeof kind === 'string' && BACKUP_COMPAT_KINDS.includes(kind as BackupCompatKind)
  handle(BACKUP_IPC.export, async(event, params: { path: string, kind: 'all' | 'settings' | 'playlists' | BackupCompatKind }) => {
    assertIpcRequest(event, BACKUP_IPC.export, params)
    authorize(event)
    return exclusive(async() => {
      if (!params || typeof params.path !== 'string' || params.path.length > 8192 || !(params.kind === 'all' || params.kind === 'settings' || params.kind === 'playlists' || isCompatKind(params.kind))) throw new BackupError('invalid')
      // Original LX Music 2.12.6 formats: save the raw v2 structure without
      // v3 validation, which rejects `allData_v2` and `setting_v2` by design.
      if (isCompatKind(params.kind)) {
        const playlists = (await global.lx.worker.dbService.backupRead()).playlists ?? []
        const settings = getStore(STORE_NAMES.APP_SETTINGS).get<LX.AppSetting>('setting') ?? { ...global.lx.appSetting }
        return saveLxConfigFile(params.path, buildCompatExport(params.kind, { playlists, settings }))
      }
      const data = await withStoreExclusive(async() => getPluginManager().withBackupRegistry(async registry => {
        const data: BackupData = params.kind === 'settings' ? {} : await global.lx.worker.dbService.backupRead()
        if (params.kind !== 'playlists') data.settings = getStore(STORE_NAMES.APP_SETTINGS).get<LX.AppSetting>('setting') ?? { ...global.lx.appSetting }
        if (params.kind === 'all') {
          data.plugins = {
            enabled: Object.fromEntries(Object.entries(registry).filter(([, entry]) => !!entry).map(([id, entry]) => [id, entry!.enabled !== false])),
            preferences: await preferences(),
            soundEffect: getStore(STORE_NAMES.SOUND_EFFECT).snapshot(),
          }
        } else { delete data.downloads; delete data.lyrics; delete data.library }
        return validateBackupData(JSON.parse(JSON.stringify(data)))
      }))
      const output = params.kind === 'all' ? { type: 'allData_v3', version: 3, createdAt: Date.now(), data }
        : { type: params.kind === 'settings' ? 'setting_v2' : 'playList_v2', data: params.kind === 'settings' ? data.settings : data.playlists }
      return saveLxConfigFile(params.path, output)
    })
  })
  handle(BACKUP_IPC.restore, async(event, request: { token: string, sections: BackupSection[], playlistIds?: string[] }) => {
    assertIpcRequest(event, BACKUP_IPC.restore, request)
    authorize(event)
    return exclusive(async() => {
      if (!preview || preview.sender !== event.sender.id || request?.token !== preview.token || Date.now() - preview.time > 15 * 60_000) throw new BackupError('expired')
      if (!Array.isArray(request.sections) || !request.sections.length || new Set(request.sections).size !== request.sections.length || request.sections.some(section => !BACKUP_SECTIONS.includes(section) || preview!.data[section] === undefined)) throw new BackupError('selection')
      const selected = Object.fromEntries(request.sections.map(section => [section, preview!.data[section]])) as BackupData
      if (selected.playlists && request.playlistIds) {
        if (!Array.isArray(request.playlistIds) || !request.playlistIds.length || request.playlistIds.some(id => !selected.playlists!.some(list => list.id === id))) throw new BackupError('selection')
        selected.playlists = selected.playlists.filter(list => request.playlistIds!.includes(list.id))
      }
      const data = validateBackupData(JSON.parse(JSON.stringify(selected)))
      await withStoreExclusive(async() => getPluginManager().withBackupRegistry(async registry => {
        const files: BackupFile[] = []
        const config = getStore(STORE_NAMES.APP_SETTINGS)
        const sound = getStore(STORE_NAMES.SOUND_EFFECT)
        const settingChange = data.settings ? mergeSetting(config.get<LX.AppSetting>('setting') ?? global.lx.appSetting, { ...data.settings, 'common.isAgreePact': false }) : null
        if (settingChange) settingChange.setting.version = global.lx.appSetting.version
        const nextConfig = settingChange ? { ...config.snapshot(), setting: settingChange.setting, version: settingChange.setting.version } : null
        if (nextConfig) files.push({ name: 'config_v2.json', data: serializePublicConfig(nextConfig) })
        if (data.plugins) {
          files.push({ name: 'sound_effect.json', data: JSON.stringify(data.plugins.soundEffect) })
          for (const [name, value] of Object.entries(data.plugins.preferences)) files.push({ name: 'plugins/preferences/' + name, data: JSON.stringify(value) })
          for (const [id, enabled] of Object.entries(data.plugins.enabled)) if (registry[id]) registry[id].enabled = enabled
          files.push({ name: 'plugins/installed.json', data: JSON.stringify(registry) })
        }
        let restored: BackupData
        try {
          restored = await global.lx.worker.dbService.backupRestore(global.lxDataPath, data, files)
          protectStoreRecovery(null)
        } catch (error) {
          if (String(error).includes('backup:rollback_failed')) protectStoreRecovery(new BackupError('rollback_failed'))
          throw error
        }
        if (nextConfig && settingChange) {
          config.acceptCommitted(nextConfig)
          global.lx.event_app.config_committed(settingChange.setting, settingChange.updatedSettingKeys, settingChange.updatedSetting)
        }
        if (data.plugins) sound.acceptCommitted(data.plugins.soundEffect)
        if (data.playlists) {
          const lists = restored.playlists!
          try {
            global.lx.event_list.list_data_restored({
              defaultList: lists.find(list => list.id === LIST_IDS.DEFAULT)!.list,
              loveList: lists.find(list => list.id === LIST_IDS.LOVE)!.list,
              tempList: lists.find(list => list.id === LIST_IDS.TEMP)!.list,
              userList: lists.filter(list => ![LIST_IDS.DEFAULT, LIST_IDS.LOVE, LIST_IDS.TEMP].some(id => id === list.id)),
            })
          } catch (error) { console.error('Backup list notification failed', error) }
        }
      }))
      clearPreview()
      if (data.plugins) await notifyPluginBackupRestored().catch(error => { console.error('Plugin backup notification failed', error) })
      return { sections: request.sections, restart: !!data.plugins }
    })
  })
}
