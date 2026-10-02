import { ref, reactive, shallowRef, markRaw, computed } from '@common/utils/vueTools'
import { windowSizeList as configWindowSizeList } from '@common/config'
import { appSetting } from './setting'
import music from '@renderer/utils/musicSdk'

export const apiSource = ref<string | null>(null)
export const proxy: {
  enable: boolean
  host: string
  port: string

  envProxy?: {
    host: string
    port: string
  }
} = {
  enable: false,
  host: '',
  port: '',
}
export const sync: {
  enable: boolean
  mode: LX.AppSetting['sync.mode']
  isShowSyncMode: boolean
  isShowAuthCodeModal: boolean
  deviceName: string
  type: keyof LX.Sync.ModeTypes
  server: {
    port: string
    status: {
      status: boolean
      message: string
      address: string[]
      code: string
      devices: LX.Sync.ServerKeyInfo[]
    }
  }
  client: {
    host: string
    status: {
      status: boolean
      message: string
      address: string[]
    }
  }
} = reactive({
  enable: false,
  mode: 'server',
  isShowSyncMode: false,
  isShowAuthCodeModal: false,
  deviceName: '',
  type: 'list',
  server: {
    port: '',
    status: {
      status: false,
      message: '',
      address: [],
      code: '',
      devices: [],
    },
  },
  client: {
    host: '',
    status: {
      status: false,
      message: '',
      address: [],
    },
  },
})

export const openAPI = reactive({
  address: '',
  message: '',
  token: '',
})


export const windowSizeActive = computed(() => {
  return windowSizeList.find(i => i.id === appSetting['common.windowSizeId']) ?? windowSizeList[0]
})

export const getSourceI18nPrefix = () => {
  return appSetting['common.sourceNameType'] == 'real' ? 'source_' : 'source_alias_'
}

export const sourceNames = computed(() => {
  const prefix = getSourceI18nPrefix()
  const sourceNames: Record<LX.OnlineSource | 'all', string> = {
    kw: 'kw',
    tx: 'tx',
    kg: 'kg',
    mg: 'mg',
    wy: 'wy',
    all: window.i18n.t(prefix + 'all' as any),
  }
  for (const { id } of music.sources) {
    sourceNames[id as LX.OnlineSource] = window.i18n.t(prefix + id as any)
  }

  return sourceNames
})

export const windowSizeList = markRaw(configWindowSizeList)

export const isShowPact = ref(false)

export const versionInfo = window.lxData.versionInfo = reactive<{
  version: string
  newVersion: {
    version: string
    desc: string
    history?: LX.VersionInfo[]
    downloadUrl?: string
    fileName?: string
    size?: number
    digest?: string
    edition?: LX.UpdateEdition
    differential?: LX.UpdateDifferential
  } | null
  showModal: boolean
  isUnknown: boolean
  isLatest: boolean
  reCheck: boolean
  status: LX.UpdateStatus
  downloadProgress: LX.UpdateProgressInfo | null
  updateError: string
}>({
  // 挂载界面前由主进程提供当前安装包的版本，避免复用旧构建时显示旧版本。
  version: '',
  newVersion: null,
  showModal: false,
  reCheck: false,
  isUnknown: false,
  isLatest: false,
  status: 'checking',
  downloadProgress: null,
  updateError: '',
})
export const userApi = reactive<{
  list: LX.UserApi.UserApiInfo[]
  status: boolean
  message?: string
  apis: Partial<LX.UserApi.UserApiSources>
}>({
  list: [],
  status: false,
  message: 'initing',
  apis: {},
})

export const isShowChangeLog = ref(false)


export const isFullscreen = ref(false)
export const isWindowVisible = ref(true)
export const isMaximized = ref(false)
export const windowFontSize = ref(appSetting['common.fontSize'])

export const themeShouldUseDarkColors = ref(window.shouldUseDarkColors)


export const qualityList = shallowRef<LX.QualityList>({})
export const setQualityList = (_qualityList: LX.QualityList) => {
  qualityList.value = _qualityList
}

export const themeId = ref('green')
export const themeInfo: LX.ThemeInfo = {
  themes: [],
  userThemes: [],
  dataPath: '',
}
