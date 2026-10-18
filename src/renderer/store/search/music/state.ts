import { reactive, markRaw, shallowReactive } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'
import type { AggregateSearchState } from '../aggregate'

// import { deduplicationList } from '@common/utils/renderer'

export declare interface ListInfo {
  list: LX.Music.MusicInfo[]
  total: number
  page: number
  maxPage: number
  limit: number
  key: string | null
  noItemLabel: string
  aggregate?: AggregateSearchState
}

interface ListInfos extends Partial<Record<LX.OnlineSource, ListInfo>> {
  'all': ListInfo
}

export const sources: Array<LX.OnlineSource | 'all'> = shallowReactive([])

export const listInfos: ListInfos = markRaw({
  all: reactive<ListInfo>({
    page: 1,
    maxPage: 0,
    limit: 30,
    total: 0,
    list: [],
    key: null,
    noItemLabel: '',
  }),
})
export const maxPages: Partial<Record<LX.OnlineSource, number>> = {}
const refreshSources = () => {
  const nextSources: Array<LX.OnlineSource | 'all'> = []
  for (const source of music.sources) {
    if (!music[source.id as LX.OnlineSource]?.musicSearch) continue
    nextSources.push(source.id as LX.OnlineSource)
    if (listInfos[source.id as LX.OnlineSource]) continue
    listInfos[source.id as LX.OnlineSource] = reactive<ListInfo>({
      page: 1,
      maxPage: 0,
      limit: 30,
      total: 0,
      list: [],
      key: '',
      noItemLabel: '',
    })
    maxPages[source.id as LX.OnlineSource] = 0
  }
  nextSources.push('all')
  sources.splice(0, sources.length, ...nextSources)
}
refreshSources()
music.onSourcesChanged(refreshSources)
