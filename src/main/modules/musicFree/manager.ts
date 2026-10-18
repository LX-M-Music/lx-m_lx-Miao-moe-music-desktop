import { createHash } from 'node:crypto'
import { isMusicFreeSource, type MusicFreePlugin, type MusicFreeRecord } from '@common/musicFree'
import { sourceError } from '../sourcePlugins/network'

export interface PluginStore {
  get: <T>(key: string) => T
  set: (key: string, value: any) => Promise<void>
}
type Inspect = (script: string, variables: Record<string, string>) => Promise<Omit<MusicFreePlugin, 'id' | 'variables' | 'enabled'>>
const publicPlugin = ({ script, ...plugin }: MusicFreeRecord): MusicFreePlugin => plugin

export class MusicFreeManager {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly store: PluginStore) {}
  private records(): MusicFreeRecord[] {
    const records = this.store.get<MusicFreeRecord[]>('plugins') ?? []
    if (!Array.isArray(records) || records.some(item => !isMusicFreeSource(item?.id) || typeof item.script !== 'string' || typeof item.name !== 'string' || !Array.isArray(item.methods))) throw sourceError('MUSICFREE_STORE_INVALID', 'MusicFree 音源记录损坏，请检查配置备份')
    return records
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    const task = this.queue.then(action)
    this.queue = task.catch(() => {})
    return task
  }

  list() { return this.records().map(publicPlugin) }
  get(id: string) {
    const record = this.records().find(item => item.id === id)
    if (!record) throw sourceError('MUSICFREE_NOT_INSTALLED', 'MusicFree 音源已移除或尚未安装')
    return record
  }

  async import(script: string, inspect: Inspect, sourceUrl?: string): Promise<MusicFreePlugin> {
    if (typeof script !== 'string' || !script.trim() || Buffer.byteLength(script) > 2 * 1024 * 1024) throw sourceError('MUSICFREE_SCRIPT_INVALID', 'MusicFree 插件应为不超过 2 MiB 的 JavaScript 文件')
    const metadata = await inspect(script.replace(/^\uFEFF/, ''), {})
    const id = `musicfree_${createHash('sha256').update(metadata.name).digest('hex').slice(0, 24)}` as const
    return this.exclusive(async() => {
      const records = this.records()
      const previous = records.find(item => item.id === id)
      if (!previous && records.length >= 40) throw sourceError('MUSICFREE_PLUGIN_LIMIT', '最多导入 40 个 MusicFree 音源')
      const record: MusicFreeRecord = { ...metadata, id, script: script.replace(/^\uFEFF/, ''), enabled: previous?.enabled ?? true, variables: previous?.variables ?? {}, ...(sourceUrl ? { sourceUrl } : {}) }
      await this.store.set('plugins', [...records.filter(item => item.id !== id), record])
      return publicPlugin(record)
    })
  }

  async remove(id: string) {
    return this.exclusive(async() => { await this.store.set('plugins', this.records().filter(item => item.id !== id)); return this.list() })
  }

  async configure(id: string, enabled: boolean, variables: Record<string, string>) {
    return this.exclusive(async() => {
      const record = this.get(id)
      if (typeof enabled !== 'boolean' || !variables || typeof variables !== 'object' || Array.isArray(variables) || Object.entries(variables).some(([key, value]) => !record.userVariables.some(item => item.key === key) || typeof value !== 'string' || value.length > 8192)) throw sourceError('MUSICFREE_CONFIG_INVALID', 'MusicFree 插件配置无效')
      const records = this.records().map(item => item.id === id ? { ...item, enabled, variables: { ...variables } } : item)
      await this.store.set('plugins', records)
      return this.list()
    })
  }
}
