/* eslint-disable @typescript-eslint/promise-function-async -- Preserve the original rejection-handled promise for legacy event callers. */
import { dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { log } from '@common/utils'
import { writeFileAtomic } from '@common/utils/atomicFile'
import { readProtectedConfig, writeProtectedConfig } from './credentials'

type Stores = Record<string, Store>

const stores: Stores = {}
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value))
let writes: Promise<unknown> = Promise.resolve()
let recoveryError: Error | null = null
export const protectStoreRecovery = (error: Error | null) => { recoveryError = error }
export const withStoreExclusive = <T>(action: () => Promise<T>): Promise<T> => {
  const task = writes.then(action)
  writes = task.catch(error => { log.error(error) })
  return task
}
export const flushStores = async() => {
  // Include mutations queued in the same turn, and ones added while flushing.
  do {
    await Promise.resolve()
    const pending = writes
    await pending
    if (pending === writes && !Object.values(stores).some(store => store.pending)) return
  } while (true)
}


class Store {
  readonly filePath: string
  private store: Record<string, any>
  private readonly changes: Array<{ change: (data: Record<string, any>) => Record<string, any>, resolve: () => void, reject: (error: unknown) => void }> = []
  get pending() { return this.changes.length > 0 }

  update(change: (data: Record<string, any>) => Record<string, any>): Promise<void> {
    const first = !this.changes.length
    const task = new Promise<void>((resolve, reject) => { this.changes.push({ change, resolve, reject }) })
    // Keep fire-and-forget legacy callers safe; awaiting this promise still rejects.
    void task.catch(error => { log.error(error) })
    if (first) {
      void withStoreExclusive(async() => {
        const batch = this.changes.splice(0)
        try {
          if (recoveryError) throw recoveryError
          let next = clone(this.store)
          for (const item of batch) next = item.change(next)
          next = clone(next)
          if (path.basename(this.filePath) === 'config_v2.json') await writeProtectedConfig(this.filePath, next)
          else await writeFileAtomic(this.filePath, JSON.stringify(next, null, '\t'))
          this.store = next
          for (const item of batch) item.resolve()
        } catch (error) { for (const item of batch) item.reject(error) }
      })
    }
    return task
  }

  snapshot() { return clone(this.store) }
  // Only called under withStoreExclusive after a coordinated disk commit.
  acceptCommitted(value: Record<string, any>) { this.store = clone(value) }

  constructor(filePath: string, clearInvalidConfig: boolean = false) {
    this.filePath = filePath

    let store: Record<string, any>
    if (fs.existsSync(this.filePath)) {
      if (clearInvalidConfig) {
        try {
          store = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
        } catch {
          store = {}
        }
      } else store = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
    } else store = {}

    if (store === null || typeof store != 'object' || Array.isArray(store)) {
      if (clearInvalidConfig) store = {}
      else throw new Error('parse data error: ' + String(store))
    }
    this.store = path.basename(this.filePath) === 'config_v2.json' ? readProtectedConfig(this.filePath, store) : store
  }

  get<Value>(key: string): Value {
    return clone(this.store[key])
  }

  has(key: string): boolean {
    return key in this.store
  }

  set(key: string, value: any) {
    const saved = clone(value)
    return this.update(data => ({ ...data, [key]: saved }))
  }

  override(value: Record<string, any>) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Config must be an object')
    const saved = clone(value)
    return this.update(() => saved)
  }
}

/**
 * 获取 Store 对象
 * @param name store 名
 * @param isIgnoredError 是否忽略错误
 * @param isShowErrorAlert=true 是否显示错误弹窗
 * @returns Store
 */
export default (name: string, isIgnoredError = true, isShowErrorAlert = true): Store => {
  if (stores[name]) return stores[name]
  let store: Store
  const storePath = path.join(global.lxDataPath, name + '.json')
  try {
    store = stores[name] = new Store(storePath, false)
  } catch (err: any) {
    const error = err as Error
    if (String(err?.code).startsWith('CREDENTIAL_')) throw error
    log.error(error)

    if (!isIgnoredError) throw error


    const backPath = storePath + '.bak'
    fs.renameSync(storePath, backPath)
    if (isShowErrorAlert && global.lx?.appSetting?.['common.showErrorDialog']) {
      dialog.showMessageBoxSync({
        type: 'error',
        message: name + ' data load error',
        detail: `We have helped you back up the old ${name} file to: ${backPath}\nYou can try to repair and restore it manually\n\nError detail: ${error.message}`,
      })
      shell.showItemInFolder(backPath)
    }


    store = stores[name] = new Store(storePath, true)
  }
  return store
}

export {
  Store,
}
