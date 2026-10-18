import { shallowRef } from '@common/utils/vueTools'

export const sourceRevision = shallowRef(0)
const listeners = new Set()
export const onSourcesChanged = callback => { listeners.add(callback); return () => listeners.delete(callback) }
export const sourcesChanged = () => {
  sourceRevision.value++
  for (const listener of listeners) listener()
}
