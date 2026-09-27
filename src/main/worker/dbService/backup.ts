import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getDB } from './db'
import { LIST_IDS } from '@common/constants'
import { BackupError, normalizeBackup, preferenceFile, type BackupData } from '@common/backup'
import { readLxConfigFile } from '@common/utils/nodejs'
import { writeFileAtomic } from '@common/utils/atomicFile'
import { getAllUserList, getListMusics, listDataOverwrite, resetListCache } from './modules/list'
import { getDownloadList, downloadListReplace, resetDownloadCache } from './modules/download'
import { editedLyricAdd, editedLyricRemove, getEditedLyric } from './modules/lyric'
import { readLibraryBackup, restoreLibraryBackup } from './library'
import { getDislikeListInfo, dislikeInfoOverwrite } from './modules/dislike_list'
import { syncRevision } from './syncRevision'
import { hash, portableDownloads, isCompleted, validateData } from '../../modules/webdav/data'
import { WebDAVError } from '../../modules/webdav/errors'
import { isPrivatePlaylistId, retainPrivatePlaylists } from '@common/privatePlaylists'

export interface BackupFile { name: string, data: string }
interface Journal { id: string, files: Array<{ name: string, before: string | null }> }
const journalName = 'backup-restore-journal.json'
const marker = 'manual_backup_commit'
export const backupPreviewFile = async(filename: string) => {
  const raw = await readLxConfigFile(filename)
  return { data: normalizeBackup(raw), createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : undefined }
}
const filePath = (root: string, name: string) => {
  if (!['config_v2.json', 'sound_effect.json', 'plugins/installed.json'].includes(name) && !(name.startsWith('plugins/preferences/') && preferenceFile(name.slice('plugins/preferences/'.length)))) throw new BackupError('invalid', 'file')
  return path.join(root, name)
}
const restoreFiles = async(root: string, files: Journal['files']) => {
  const failures = []
  for (const file of files) {
    try {
      const filename = filePath(root, file.name)
      const current = await fs.readFile(filename, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error })
      if (current === file.before) continue
      if (file.before === null) await fs.rm(filename, { force: true })
      else await writeFileAtomic(filename, file.before)
    } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new BackupError('rollback_failed')
}
export const recoverBackup = async(root: string) => {
  let raw: string
  try { raw = await fs.readFile(path.join(root, journalName), 'utf8') } catch (error: any) { if (error.code === 'ENOENT') return; throw error }
  const journal = JSON.parse(raw) as Journal
  if (!journal || typeof journal.id !== 'string' || !Array.isArray(journal.files) || journal.files.some(file => typeof file.name !== 'string' || (file.before !== null && typeof file.before !== 'string'))) throw new BackupError('rollback_failed')
  const committed = getDB().prepare('SELECT field_value FROM db_info WHERE field_name = ?').get(marker) as { field_value: string } | undefined
  if (committed?.field_value !== journal.id) await restoreFiles(root, journal.files)
  await fs.rm(path.join(root, journalName), { force: true })
}
export const backupRead = (): BackupData => {
  const playlists = [
    { id: LIST_IDS.DEFAULT, name: 'Default', list: getListMusics(LIST_IDS.DEFAULT), locationUpdateTime: null },
    { id: LIST_IDS.LOVE, name: 'Favorites', list: getListMusics(LIST_IDS.LOVE), locationUpdateTime: null },
    { id: LIST_IDS.TEMP, name: 'Temporary', list: getListMusics(LIST_IDS.TEMP), locationUpdateTime: null },
    ...getAllUserList().map(list => ({ ...list, list: getListMusics(list.id) })),
  ]
  const edited = getDB().prepare("SELECT DISTINCT id FROM lyric WHERE source = 'edited'").all() as Array<{ id: string }>
  return { playlists, downloads: getDownloadList(), lyrics: edited.map(({ id }) => ({ id, lyric: getEditedLyric(id) })), library: readLibraryBackup() }
}
const applyDatabase = (data: BackupData) => {
  if (data.playlists) {
    const current = backupRead().playlists!
    const byId = new Map(current.map(list => [list.id, list]))
    for (const list of data.playlists) byId.set(list.id, list)
    const lists = [...byId.values()]
    listDataOverwrite({
      defaultList: byId.get(LIST_IDS.DEFAULT)!.list,
      loveList: byId.get(LIST_IDS.LOVE)!.list,
      tempList: byId.get(LIST_IDS.TEMP)!.list,
      userList: lists.filter(list => ![LIST_IDS.DEFAULT, LIST_IDS.LOVE, LIST_IDS.TEMP].includes(list.id as any)),
    })
  }
  if (data.downloads) {
    const existing = getDownloadList()
    if (existing.some(task => task.status === 'run' || task.status === 'waiting')) throw new BackupError('downloads_running')
    const byId = new Map(existing.map(task => [task.id, task]))
    for (const task of data.downloads) byId.set(task.id, task)
    downloadListReplace([...byId.values()])
  }
  if (data.lyrics) {
    for (const item of data.lyrics) {
      editedLyricRemove([item.id])
      editedLyricAdd(item.id, item.lyric)
    }
  }
  if (data.library) restoreLibraryBackup(data.library)
}

// All worker calls are serialized, so no other DB operation can enter this
// transaction while its configuration files are being durably replaced.
const restoreTransaction = async<T>(root: string, files: BackupFile[], apply: () => T | Promise<T>) => {
  await recoverBackup(root)
  const journal: Journal = { id: randomUUID(), files: [] }
  for (const file of files) {
    const filename = filePath(root, file.name)
    let before: string | null = null
    try { before = await fs.readFile(filename, 'utf8') } catch (error: any) { if (error.code !== 'ENOENT') throw error }
    journal.files.push({ name: file.name, before })
  }
  const journalPath = path.join(root, journalName)
  await writeFileAtomic(journalPath, JSON.stringify(journal))
  const db = getDB()
  let restored: T
  try {
    db.exec('BEGIN IMMEDIATE')
    restored = await apply()
    for (const file of files) await writeFileAtomic(filePath(root, file.name), file.data)
    db.prepare('DELETE FROM db_info WHERE field_name = ?').run(marker)
    db.prepare('INSERT INTO db_info (field_name, field_value) VALUES (?, ?)').run(marker, journal.id)
    db.exec('COMMIT')
  } catch (error) {
    try {
      if (db.inTransaction) db.exec('ROLLBACK')
      resetListCache()
      resetDownloadCache()
      await restoreFiles(root, journal.files)
    } catch (rollbackError) {
      console.error('Backup rollback failed', rollbackError)
      throw new BackupError('rollback_failed')
    }
    try { await fs.rm(journalPath, { force: true }) } catch (cleanupError) {
      // Rollback finished. If the journal cannot be removed, mark its files as
      // finalized so startup cannot overwrite later successful settings saves.
      try {
        db.transaction(() => {
          db.prepare('DELETE FROM db_info WHERE field_name = ?').run(marker)
          db.prepare('INSERT INTO db_info (field_name, field_value) VALUES (?, ?)').run(marker, journal.id)
        })()
      } catch { throw new BackupError('rollback_failed') }
      console.error('Rolled-back journal cleanup failed', cleanupError)
    }
    throw error
  }
  // Commit is durable. A cleanup failure is retried on next startup, never
  // reported as an unsuccessful restore or allowed to roll back committed data.
  await fs.rm(journalPath, { force: true }).catch(error => { console.error('Backup journal cleanup failed', error) })
  return restored
}

export const backupRestore = async(root: string, data: BackupData, files: BackupFile[]) => restoreTransaction(root, files, () => { applyDatabase(data); return backupRead() })

export const webdavRevision = syncRevision
export const webdavRead = (sections: LX.WebDAV.Section[]) => {
  const data: LX.WebDAV.Data = {}
  if (sections.includes('playlists')) {
    data.playlists = {
      defaultList: getListMusics(LIST_IDS.DEFAULT),
      loveList: getListMusics(LIST_IDS.LOVE),
      userList: getAllUserList().map(list => ({ ...list, list: getListMusics(list.id) })),
    }
  }
  if (sections.includes('dislike')) data.dislike = getDislikeListInfo().rules
  if (sections.some(section => section === 'downloadHistory' || section === 'downloadTasks')) {
    const tasks = getDownloadList()
    if (sections.includes('downloadHistory')) data.downloadHistory = tasks.filter(isCompleted)
    if (sections.includes('downloadTasks')) data.downloadTasks = tasks.filter(task => !isCompleted(task))
  }
  return { data, revision: syncRevision(sections) }
}

export const webdavRestore = async(root: string, data: LX.WebDAV.Data, files: BackupFile[], sections: LX.WebDAV.Section[], revision: string) => {
  if (syncRevision(sections) !== revision) throw new WebDAVError('local_changed')
  validateData(data, sections)
  return restoreTransaction(root, files, async() => {
    const hashes: Partial<Record<LX.WebDAV.Section, string>> = {}
    if (data.downloadHistory !== undefined || data.downloadTasks !== undefined) {
      const current = getDownloadList()
      if (current.some(task => task.status === 'run' || task.status === 'waiting')) throw new WebDAVError('downloads_running')
      const byId = new Map(current.map(task => [task.id, task]))
      const retained = current.filter(task => isCompleted(task) ? data.downloadHistory === undefined : data.downloadTasks === undefined)
      const ids = new Set(retained.map(task => task.id))
      for (const task of [...(data.downloadHistory ?? []), ...(data.downloadTasks ?? [])]) {
        if (ids.has(task.id)) continue
        ids.add(task.id)
        const local = byId.get(task.id)
        retained.push({ ...task, metadata: { ...task.metadata, filePath: local && isCompleted(local) === isCompleted(task) ? local.metadata.filePath : '' } })
      }
      downloadListReplace(retained)
      if (data.downloadHistory !== undefined) hashes.downloadHistory = hash(portableDownloads(retained.filter(isCompleted)))
      if (data.downloadTasks !== undefined) hashes.downloadTasks = hash(portableDownloads(retained.filter(task => !isCompleted(task))))
    }
    if (data.playlists) {
      const local = {
        defaultList: getListMusics(LIST_IDS.DEFAULT),
        loveList: getListMusics(LIST_IDS.LOVE),
        userList: getAllUserList().filter(list => isPrivatePlaylistId(list.id)).map(list => ({ ...list, list: getListMusics(list.id) })),
      }
      listDataOverwrite(retainPrivatePlaylists(data.playlists, local))
    }
    if (data.dislike !== undefined) await dislikeInfoOverwrite(data.dislike)
    // Return only canonicalized values, not another copy of the entire library.
    return { dislike: data.dislike !== undefined ? getDislikeListInfo().rules : undefined, hashes }
  })
}
