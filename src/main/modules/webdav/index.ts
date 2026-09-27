/* eslint-disable require-atomic-updates */
// runWebDAV admits only one operation at a time through state.busy.
import getStore, { withStoreExclusive, protectStoreRecovery } from '@main/utils/store'
import { mergeSetting } from '@main/utils'
import { serializePublicConfig } from '@main/utils/credentials'
import { STORE_NAMES } from '@common/constants'
import { playlistDiff } from '@common/syncDiff'
import { createClient, type RemoteFile } from './client'
import { hash, normalizeData, parseSnapshot, selectedSections, validateData } from './data'
import { planSync, type Baseline } from './plan'
import { WebDAVError } from './errors'
import { errorForTransport, getErrorInfo } from '@common/utils/errorMessage'
import { retainPrivatePlaylists, sharedPlaylistData } from '@common/privatePlaylists'
import { buildMobilePlaylists, parseMobilePlaylists } from './mobilePlaylists'

const state = { busy: false }
interface Restored { dislike?: string, hashes?: Partial<Record<LX.WebDAV.Section, string>> }
// One bounded remote document. A 304 reuses its parsed data as well as its body.
let cached: { identity: string, file: RemoteFile, snapshot: LX.WebDAV.Snapshot, normalized: LX.WebDAV.Data, validated: Set<LX.WebDAV.Section>, hashes: Partial<Record<LX.WebDAV.Section, string>> } | undefined
let mobileCached: { identity: string, remoteFile: RemoteFile, parsed: ReturnType<typeof parseMobilePlaylists> } | undefined
export const getWebDAVLastResult = (): LX.WebDAV.Result | null => getStore('webdav').get<LX.WebDAV.Result>('lastResult') ?? null

const applyLocal = async(data: LX.WebDAV.Data, sections: LX.WebDAV.Section[], revision: string, checkSettings: () => void, localPlaylists?: LX.Sync.List.ListData) => withStoreExclusive(async() => {
  checkSettings()
  const restoreData = data.playlists && localPlaylists ? { ...data, playlists: retainPrivatePlaylists(data.playlists, localPlaylists) } : data
  const config = getStore(STORE_NAMES.APP_SETTINGS)
  const change = data.settings ? mergeSetting(config.get<LX.AppSetting>('setting') ?? global.lx.appSetting, data.settings) : undefined
  const next = change ? { ...config.snapshot(), setting: change.setting } : undefined
  let restored: Restored
  try {
    restored = await global.lx.worker.dbService.webdavRestore(global.lxDataPath, restoreData, next ? [{ name: 'config_v2.json', data: serializePublicConfig(next) }] : [], sections, revision)
    protectStoreRecovery(null)
  } catch (error) {
    if (String(error).includes('backup:rollback_failed')) protectStoreRecovery(error instanceof Error ? error : new Error(String(error)))
    throw error
  }
  if (next && change) {
    config.acceptCommitted(next)
    restored.hashes = { ...restored.hashes, settings: hash(normalizeData({ settings: change.setting }, ['settings']).settings) }
  }
  // Notify renderers only after every selected section has committed.
  const notify = (action: () => void) => { try { action() } catch (error) { console.error('WebDAV committed notification failed', errorForTransport(error)) } }
  if (change) notify(() => { global.lx.event_app.config_committed(change.setting, change.updatedSettingKeys, change.updatedSetting) })
  if (restoreData.playlists) notify(() => { global.lx.event_list.list_data_restored(restoreData.playlists!) })
  if (restored.dislike !== undefined) notify(() => { global.lx.event_dislike.dislike_data_restored(restored.dislike!) })
  return restored
})

export const runWebDAV = async(operation: LX.WebDAV.Operation): Promise<LX.WebDAV.Result> => {
  const result: LX.WebDAV.Result = { success: false, operation, time: Date.now(), uploaded: [], downloaded: [] }
  if (state.busy) return { ...result, error: 'busy' }
  state.busy = true
  try {
    const settings = { ...global.lx.appSetting }
    if (!['test', 'sync', 'upload', 'download'].includes(operation)) throw new WebDAVError('invalid_config')
    if (operation !== 'test' && !settings['sync.webdav.enable']) throw new WebDAVError('disabled')
    const config = { url: settings['sync.webdav.url'], username: settings['sync.webdav.username'], password: settings['sync.webdav.password'], directory: settings['sync.webdav.directory'] }
    const client = createClient(config)
    const mobileClient = createClient({ ...config, directory: settings['sync.webdav.playlistsDirectory'] }, 'playlists.json')
    if (operation === 'test') {
      if (selectedSections(settings).some(section => section !== 'playlists') || !settings['sync.webdav.playlists']) await client.test()
      if (settings['sync.webdav.playlists']) await mobileClient.test()
    } else {
      const sections = selectedSections(settings)
      if (!sections.length) throw new WebDAVError('empty_selection')
      const primarySections = sections.filter(section => section !== 'playlists')
      const syncPlaylists = sections.includes('playlists')
      const storage = getStore('webdav')
      const identity = hash([client.identity, mobileClient.identity])
      const cacheIdentity = hash([client.identity, settings['sync.webdav.password']])
      const mobileCacheIdentity = hash([mobileClient.identity, settings['sync.webdav.password']])
      if (cached?.identity !== cacheIdentity) cached = undefined
      if (mobileCached?.identity !== mobileCacheIdentity) mobileCached = undefined
      const baseline = storage.get<{ identity: string, data: Baseline }>('baseline')
      const previous = baseline?.identity === identity || baseline?.identity === hash(client.identity) ? baseline.data : {}
      const captured = await global.lx.worker.dbService.webdavRead(sections)
      const raw = { ...captured.data, ...(sections.includes('settings') ? { settings } : {}) }
      const sharedRaw = raw.playlists ? { ...raw, playlists: sharedPlaylistData(raw.playlists) } : raw
      validateData(sharedRaw, sections)
      const local = normalizeData(sharedRaw, sections)
      const localHashes = Object.fromEntries(sections.map(section => [section, hash(local[section])]))
      const mobileFile = syncPlaylists ? await mobileClient.read(mobileCached?.remoteFile) : undefined
      const mobileParsed = mobileFile?.unchanged && mobileCached ? mobileCached.parsed : mobileFile?.content == null ? undefined : parseMobilePlaylists(mobileFile.content)
      if (mobileFile && mobileParsed) mobileCached = { identity: mobileCacheIdentity, remoteFile: mobileFile, parsed: mobileParsed }
      else if (mobileFile) mobileCached = undefined
      const readPrimary = primarySections.length > 0 || (syncPlaylists && !mobileParsed)
      const remoteFile: RemoteFile = readPrimary ? await client.read(cached?.file) : { content: null }
      const remote = remoteFile.unchanged && cached ? cached.snapshot : remoteFile.content == null ? { type: 'lx-music-webdav' as const, version: 1 as const, updatedAt: 0, data: {} } : parseSnapshot(remoteFile.content)
      const normalized = remoteFile.unchanged && cached ? cached.normalized : {}
      const validated = remoteFile.unchanged && cached ? cached.validated : new Set<LX.WebDAV.Section>()
      const unchecked = primarySections.filter(section => !validated.has(section))
      validateData(remote.data, unchecked)
      Object.assign(normalized, normalizeData(remote.data, unchecked))
      for (const section of unchecked) validated.add(section)
      if (readPrimary) cached = { identity: cacheIdentity, file: remoteFile, snapshot: remote, normalized, validated, hashes: remoteFile.unchanged && cached ? cached.hashes : {} }
      if (syncPlaylists && !mobileParsed && remote.data.playlists && (!Array.isArray(remote.data.playlists.userList) || remote.data.playlists.userList.some(list => !list || typeof list !== 'object'))) throw new WebDAVError('invalid_data', ['playlists'])
      const legacyPlaylists = syncPlaylists && !mobileParsed && remote.data.playlists ? sharedPlaylistData(remote.data.playlists) : undefined
      if (legacyPlaylists) validateData({ playlists: legacyPlaylists }, ['playlists'])
      const remoteData: LX.WebDAV.Data = { ...Object.fromEntries(primarySections.map(section => [section, normalized[section]])), ...(syncPlaylists ? { playlists: mobileParsed?.playlists ?? legacyPlaylists } : {}) }
      const missingPrimary = primarySections.length > 0 && remoteFile.content == null
      const missingPlaylists = syncPlaylists && !remoteData.playlists && primarySections.length === 0
      if (operation === 'download' && (missingPrimary || missingPlaylists)) throw new WebDAVError('missing_remote')
      const remoteHashes = remoteFile.unchanged && cached ? { ...cached.hashes } : {}
      if (syncPlaylists) remoteHashes.playlists = hash(remoteData.playlists)
      for (const section of sections) remoteHashes[section] ??= hash(remoteData[section])
      if (readPrimary && cached) cached.hashes = remoteHashes
      const hashes: Baseline = Object.fromEntries(sections.map(section => [section, { local: localHashes[section], remote: remoteHashes[section]! }]))
      let plan: ReturnType<typeof planSync>
      try { plan = planSync(operation, local, remoteData, previous, sections, hashes) } catch (error) {
        if (error instanceof WebDAVError && error.code === 'conflict' && local.playlists && remoteData.playlists) result.diff = playlistDiff(local.playlists, remoteData.playlists)
        throw error
      }
      const settingHash = hash(local.settings)
      const checkSettings = () => {
        const changed = (Object.keys(settings) as Array<keyof LX.AppSetting>).some(key => key.startsWith('sync.webdav.') && settings[key] !== global.lx.appSetting[key])
        if (changed || (sections.includes('settings') && hash(normalizeData({ settings: global.lx.appSetting }, ['settings']).settings) !== settingHash)) throw new WebDAVError('local_changed')
      }
      const checkLocal = async() => {
        checkSettings()
        if (await global.lx.worker.dbService.webdavRevision(sections) !== captured.revision) throw new WebDAVError('local_changed')
      }
      await checkLocal()
      if (plan.download.length) await getStore('webdav-local-backup').override({ type: 'lx-music-webdav', version: 1, updatedAt: Date.now(), data: Object.fromEntries(plan.download.map(section => [section, section === 'settings' ? local.settings : raw[section]])) })
      const playlistUpload = syncPlaylists && (plan.upload.includes('playlists') || (!mobileParsed && remoteData.playlists !== undefined) || mobileParsed?.containsPrivate)
      if (playlistUpload) {
        const content = buildMobilePlaylists(mobileParsed?.file, (plan.upload.includes('playlists') ? local.playlists : remoteData.playlists)!)
        const file = await mobileClient.write(JSON.stringify(content), mobileFile!)
        mobileCached = { identity: mobileCacheIdentity, remoteFile: file, parsed: parseMobilePlaylists(JSON.stringify(content)) }
        result.uploaded.push('playlists')
      }
      const primaryUpload = plan.upload.filter(section => section !== 'playlists')
      if (primaryUpload.length) {
        const upload: LX.WebDAV.Snapshot = { ...remote, updatedAt: Date.now(), data: { ...remote.data, ...Object.fromEntries(primaryUpload.map(section => [section, local[section]])) } }
        const file = await client.write(JSON.stringify(upload), remoteFile)
        cached = { identity: cacheIdentity, file, snapshot: upload, normalized: { ...normalized, ...Object.fromEntries(primaryUpload.map(section => [section, local[section]])) }, validated, hashes: { ...remoteHashes, ...Object.fromEntries(primaryUpload.map(section => [section, localHashes[section]])) } }
        result.uploaded.push(...primaryUpload)
      }
      let restored: Restored = {}
      if (plan.download.length) {
        await checkLocal()
        restored = await applyLocal(Object.fromEntries(plan.download.map(section => [section, remoteData[section]])), sections, captured.revision, checkSettings, raw.playlists)
        result.downloaded = plan.download
      }
      const next: Baseline = { ...previous }
      for (const section of sections) {
        next[section] = {
          local: plan.download.includes(section) ? restored.hashes?.[section] ?? (section === 'dislike' ? hash(restored.dislike) : remoteHashes[section]!) : localHashes[section],
          remote: plan.upload.includes(section) ? localHashes[section] : remoteHashes[section]!,
        }
      }
      await storage.set('baseline', { identity, data: next })
      result.uploaded.sort((a, b) => sections.indexOf(a) - sections.indexOf(b))
    }
    result.success = true
  } catch (error) {
    if (error instanceof WebDAVError) {
      result.error = error.code; result.sections = error.sections; result.statusCode = error.statusCode
      if (error.cause) result.diagnostic = errorForTransport(error.cause).message
    } else {
      // Worker exceptions cross IPC as a readable code prefix.
      const { code } = getErrorInfo(error)
      result.error = ['local_changed', 'downloads_running', 'invalid_data'].includes(code) ? code as LX.WebDAV.ErrorCode : 'local_error'
      result.diagnostic = errorForTransport(error).message
    }
  }
  result.time = Date.now()
  try {
    result.lastSuccess = result.success && operation !== 'test' ? result.time : getWebDAVLastResult()?.lastSuccess
    await getStore('webdav').set('lastResult', result)
  } catch { /* Still returned to the caller. */ } finally { state.busy = false }
  return result
}
