import { safeStorage } from 'electron'
import type { MusicFreeRecord } from '@common/musicFree'
import type { PluginStore } from './manager'
import { sourceError } from '../sourcePlugins/network'

type StoredRecord = MusicFreeRecord & { encryptedVariables?: string }
const requireEncryption = () => {
  const backend = Reflect.get(safeStorage, 'getSelectedStorageBackend') as (() => string) | undefined
  if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && backend?.call(safeStorage) === 'basic_text')) throw sourceError('MUSICFREE_STORAGE_UNAVAILABLE', '系统安全存储不可用，无法保存或读取 MusicFree 插件配置')
}

export const protectedMusicFreeStore = (store: PluginStore): PluginStore => ({
  get<T>(key: string): T {
    const value = store.get<StoredRecord[] | undefined>(key)
    if (!Array.isArray(value)) return value as T
    return value.map(({ encryptedVariables, ...record }) => {
      if (!encryptedVariables) return record
      requireEncryption()
      try {
        const variables = JSON.parse(safeStorage.decryptString(Buffer.from(encryptedVariables, 'base64')))
        if (!variables || typeof variables !== 'object' || Array.isArray(variables) || Object.values(variables).some(value => typeof value !== 'string')) throw new Error('Invalid variables')
        return { ...record, variables }
      } catch { throw sourceError('MUSICFREE_STORAGE_INVALID', 'MusicFree 插件配置无法解密，请使用原系统账户恢复；原文件已保留') }
    }) as T
  },
  async set(key: string, value: MusicFreeRecord[]) {
    const records = value.map(record => {
      if (!Object.values(record.variables).some(Boolean)) return record
      requireEncryption()
      return { ...record, variables: {}, encryptedVariables: safeStorage.encryptString(JSON.stringify(record.variables)).toString('base64') }
    })
    await store.set(key, records)
  },
})
