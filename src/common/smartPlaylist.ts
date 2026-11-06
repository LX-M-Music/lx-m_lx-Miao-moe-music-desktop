import { LIST_IDS } from './constants'

/**
 * 智能歌单规则 v1
 *
 * 这个模块只能包含纯逻辑：不依赖 DOM / Electron / Node，主进程、渲染进程与
 * 单元测试共用同一份实现。存储、IPC、数据库查询都在其它层完成。
 */

export const SMART_PLAYLIST_VERSION = 1 as const
export const SMART_PLAYLIST_ERROR_CODE = 'SMART_PLAYLIST_RULE_INVALID'

/** 规则可使用的歌曲字段。 */
export type SmartPlaylistField =
  | 'name'
  | 'singer'
  | 'album'
  | 'source'
  | 'interval'
  | 'playCount'
  | 'lastPlayed'
  | 'inPlaylist'
  | 'isLoved'

/** 规则可使用的操作符。 */
export type SmartPlaylistOperator =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'gt'
  | 'lt'
  | 'inTheRange'
  | 'inTheLast'
  | 'notInTheLast'
  | 'inPlaylist'
  | 'notInPlaylist'

export type SmartPlaylistSort = 'name' | 'singer' | 'album' | 'interval' | 'playCount' | 'lastPlayed' | 'random'
export type SmartPlaylistOrder = 'asc' | 'desc'

/** 文本字段使用字符串；数值字段使用数字；inTheRange 使用 [min, max]；isLoved 使用布尔值。 */
export type SmartPlaylistConditionValue = string | number | boolean | [number, number]

export interface SmartPlaylistCondition {
  field: SmartPlaylistField
  operator: SmartPlaylistOperator
  value: SmartPlaylistConditionValue
}

export interface SmartPlaylistGroup {
  /** true 表示组内任一条件满足即可（OR）；false 表示组内条件全部满足（AND）。 */
  any: boolean
  rules: SmartPlaylistCondition[]
}

/** 顶层规则：groups 之间固定为 AND。 */
export interface SmartPlaylistRule {
  version: typeof SMART_PLAYLIST_VERSION
  name: string
  groups: SmartPlaylistGroup[]
  sort: SmartPlaylistSort
  order: SmartPlaylistOrder
  /** 0 表示不限制。 */
  limit: number
}

export interface SmartPlaylistPlayStat {
  count: number
  lastPlayed: number
}

export interface SmartPlaylistContext {
  playStats: ReadonlyMap<string, SmartPlaylistPlayStat>
  listMembership: ReadonlyMap<string, ReadonlySet<string>>
  now: number
}

export class SmartPlaylistRuleError extends Error {
  readonly code = SMART_PLAYLIST_ERROR_CODE

  constructor(message: string) {
    super(message)
    this.name = 'SmartPlaylistRuleError'
  }
}

export const SMART_PLAYLIST_FIELDS: readonly SmartPlaylistField[] = [
  'name',
  'singer',
  'album',
  'source',
  'interval',
  'playCount',
  'lastPlayed',
  'inPlaylist',
  'isLoved',
]

export const SMART_PLAYLIST_OPERATORS: readonly SmartPlaylistOperator[] = [
  'is',
  'isNot',
  'contains',
  'notContains',
  'startsWith',
  'gt',
  'lt',
  'inTheRange',
  'inTheLast',
  'notInTheLast',
  'inPlaylist',
  'notInPlaylist',
]

export const SMART_PLAYLIST_SORTS: readonly SmartPlaylistSort[] = [
  'name',
  'singer',
  'album',
  'interval',
  'playCount',
  'lastPlayed',
  'random',
]

export const SMART_PLAYLIST_ORDERS: readonly SmartPlaylistOrder[] = ['asc', 'desc']

const TEXT_OPERATORS = ['is', 'isNot', 'contains', 'notContains', 'startsWith'] as const
const RANGE_OPERATORS = ['gt', 'lt', 'inTheRange'] as const

/** 每个字段允许的操作符。字段与操作符的组合在白名单外一律视为非法规则。 */
export const SMART_PLAYLIST_FIELD_OPERATORS: Readonly<Record<SmartPlaylistField, readonly SmartPlaylistOperator[]>> = {
  name: TEXT_OPERATORS,
  singer: TEXT_OPERATORS,
  album: TEXT_OPERATORS,
  source: TEXT_OPERATORS,
  interval: RANGE_OPERATORS,
  playCount: RANGE_OPERATORS,
  lastPlayed: ['inTheLast', 'notInTheLast'],
  inPlaylist: ['inPlaylist', 'notInPlaylist'],
  isLoved: ['is', 'isNot'],
}

const TEXT_FIELDS = new Set<SmartPlaylistField>(['name', 'singer', 'album', 'source'])
const NUMBER_FIELDS = new Set<SmartPlaylistField>(['interval', 'playCount'])
const MAX_TEXT_LENGTH = 500
const MAX_LIST_ID_LENGTH = 200
const MAX_NAME_LENGTH = 200
const MAX_GROUPS = 20
const MAX_RULES_PER_GROUP = 20
const MAX_LIMIT = 100000
const MAX_DAYS = 36500
const DAY_MS = 86400000
const EMPTY_SET: ReadonlySet<string> = new Set()

const fail = (detail: string): never => {
  throw new SmartPlaylistRuleError(`智能歌单规则无效：${detail}`)
}

const isRecord = (value: unknown): value is Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value)

const includes = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === 'string' && (values as readonly string[]).includes(value)

const toNonNegativeNumber = (value: unknown, detail: string): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim())
    if (Number.isSafeInteger(parsed)) return parsed
  }
  return fail(`${detail} 必须是非负数字`)
}

const toDays = (value: unknown, detail: string): number => {
  const days = toNonNegativeNumber(value, detail)
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) fail(`${detail} 必须是 1-${MAX_DAYS} 之间的整数天`)
  return days
}

const requireArray = (value: unknown, detail: string, max: number): unknown[] => {
  if (!Array.isArray(value)) return fail(detail)
  if (value.length > max) fail(detail)
  return value
}
const requireField = (value: unknown, detail: string): SmartPlaylistField => includes(SMART_PLAYLIST_FIELDS, value) ? value : fail(detail)
const requireOperator = (value: unknown, detail: string): SmartPlaylistOperator => includes(SMART_PLAYLIST_OPERATORS, value) ? value : fail(detail)
const requireSort = (value: unknown): SmartPlaylistSort => includes(SMART_PLAYLIST_SORTS, value) ? value : fail('sort 不受支持')
const requireOrder = (value: unknown): SmartPlaylistOrder => includes(SMART_PLAYLIST_ORDERS, value) ? value : fail('order 不受支持')
const requireBoolean = (value: unknown, detail: string): boolean => typeof value === 'boolean' ? value : fail(detail)
const requireLimit = (value: unknown): number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_LIMIT ? value : fail(`limit 必须是 0-${MAX_LIMIT} 之间的整数`)

const normalizeValue = (field: SmartPlaylistField, operator: SmartPlaylistOperator, value: unknown, detail: string): SmartPlaylistConditionValue => {
  if (TEXT_FIELDS.has(field)) {
    if (typeof value !== 'string') return fail(`${detail} 必须是文本`)
    if (value.length > MAX_TEXT_LENGTH) fail(`${detail} 文本过长`)
    return value
  }
  if (NUMBER_FIELDS.has(field)) {
    if (operator === 'inTheRange') {
      if (!Array.isArray(value) || value.length !== 2) return fail(`${detail} 必须是 [最小值, 最大值]`)
      const min = toNonNegativeNumber(value[0], detail + '[0]')
      const max = toNonNegativeNumber(value[1], detail + '[1]')
      if (min > max) fail(`${detail} 的最小值不能大于最大值`)
      return [min, max]
    }
    return toNonNegativeNumber(value, detail)
  }
  if (field === 'lastPlayed') return toDays(value, detail)
  if (field === 'inPlaylist') {
    if (typeof value !== 'string') return fail(`${detail} 必须是非空歌单 ID`)
    if (!value.trim() || value.length > MAX_LIST_ID_LENGTH) fail(`${detail} 必须是非空歌单 ID`)
    return value
  }
  if (field === 'isLoved') {
    if (typeof value === 'boolean') return value
    if (value === 'true') return true
    if (value === 'false') return false
    return fail(`${detail} 必须是布尔值`)
  }
  return fail(`${detail} 的字段不受支持`)
}

const normalizeCondition = (input: unknown, detail: string): SmartPlaylistCondition => {
  if (!isRecord(input)) return fail(`${detail} 必须是对象`)
  const field = requireField(input.field, `${detail}.field 不受支持`)
  const operator = requireOperator(input.operator, `${detail}.operator 不受支持`)
  if (!SMART_PLAYLIST_FIELD_OPERATORS[field].includes(operator)) fail(`${detail} 不支持 ${field} ${operator} 组合`)
  return {
    field,
    operator,
    value: normalizeValue(field, operator, input.value, `${detail}.value`),
  }
}

/**
 * 校验并规范化智能歌单规则。返回全新的对象，调用方可以安全地修改。
 * 非法规则会抛出带 `SMART_PLAYLIST_RULE_INVALID` 错误码的异常。
 */
export const normalizeSmartPlaylist = (input: unknown): SmartPlaylistRule => {
  if (!isRecord(input)) return fail('规则必须是对象')
  if (input.version !== undefined && input.version !== SMART_PLAYLIST_VERSION) return fail('不支持的规则版本')
  const name = input.name === undefined ? '' : input.name
  if (typeof name !== 'string' || name.length > MAX_NAME_LENGTH) fail('name 必须是字符串')
  const groupsInput = requireArray(input.groups === undefined ? [] : input.groups, `groups 必须是最多 ${MAX_GROUPS} 项的数组`, MAX_GROUPS)
  const groups: SmartPlaylistGroup[] = groupsInput.map((rawGroup, groupIndex) => {
    const detail = `groups[${groupIndex}]`
    if (!isRecord(rawGroup)) return fail(`${detail} 必须是对象`)
    const any = rawGroup.any === undefined ? false : requireBoolean(rawGroup.any, `${detail}.any 必须是布尔值`)
    const rulesInput = requireArray(rawGroup.rules === undefined ? [] : rawGroup.rules, `${detail}.rules 必须是最多 ${MAX_RULES_PER_GROUP} 项的数组`, MAX_RULES_PER_GROUP)
    return {
      any,
      rules: rulesInput.map((rawRule, ruleIndex) => normalizeCondition(rawRule, `${detail}.rules[${ruleIndex}]`)),
    }
  })
  const sort = input.sort === undefined ? 'name' : requireSort(input.sort)
  const order = input.order === undefined ? 'asc' : requireOrder(input.order)
  const limit = input.limit === undefined ? 0 : requireLimit(input.limit)
  return {
    version: SMART_PLAYLIST_VERSION,
    name: name as string,
    groups,
    sort,
    order,
    limit,
  }
}

export const emptySmartPlaylist = (name = ''): SmartPlaylistRule => ({
  version: SMART_PLAYLIST_VERSION,
  name,
  groups: [],
  sort: 'name',
  order: 'asc',
  limit: 0,
})

/**
 * 解析歌曲时长（秒）。支持 mm:ss、h:mm:ss 与纯秒数，无法解析时返回 0。
 * 返回 0 同时意味着「时长未知」，数值类规则不会匹配未知时长。
 */
export const parseMusicInterval = (interval: unknown): number => {
  if (typeof interval === 'number') return Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : 0
  if (typeof interval !== 'string') return 0
  const text = interval.trim()
  if (!text) return 0
  if (/^\d+$/.test(text)) {
    const seconds = Number(text)
    return Number.isSafeInteger(seconds) ? seconds : 0
  }
  const matched = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(text)
  if (!matched) return 0
  const hours = matched[1] == null ? 0 : Number(matched[1])
  const minutes = Number(matched[2])
  const seconds = Number(matched[3])
  if (minutes > 59 || seconds > 59) return 0
  return hours * 3600 + minutes * 60 + seconds
}

const normalizeText = (value: string): string => value.toLowerCase()

const matchTextOperator = (operator: SmartPlaylistOperator, actual: string, expected: string): boolean => {
  const text = normalizeText(actual)
  const target = normalizeText(expected)
  switch (operator) {
    case 'is': return text === target
    case 'isNot': return text !== target
    case 'contains': return text.includes(target)
    case 'notContains': return !text.includes(target)
    case 'startsWith': return text.startsWith(target)
    default: return false
  }
}

const fieldText = (field: SmartPlaylistField, song: LX.Music.MusicInfo): string => {
  switch (field) {
    case 'name': return song.name ?? ''
    case 'singer': return song.singer ?? ''
    case 'album': return song.meta?.albumName ?? ''
    case 'source': return String(song.source ?? '')
    default: return ''
  }
}

const matchCondition = (condition: SmartPlaylistCondition, song: LX.Music.MusicInfo, context: SmartPlaylistContext): boolean => {
  const { field, operator, value } = condition
  if (TEXT_FIELDS.has(field)) return matchTextOperator(operator, fieldText(field, song), value as string)
  switch (field) {
    case 'interval': {
      const interval = parseMusicInterval(song.interval)
      if (!interval) return false
      if (operator === 'gt') return interval > (value as number)
      if (operator === 'lt') return interval < (value as number)
      const [min, max] = value as [number, number]
      return interval >= min && interval <= max
    }
    case 'playCount': {
      const count = context.playStats.get(song.id)?.count ?? 0
      if (operator === 'gt') return count > (value as number)
      if (operator === 'lt') return count < (value as number)
      const [min, max] = value as [number, number]
      return count >= min && count <= max
    }
    case 'lastPlayed': {
      const lastPlayed = context.playStats.get(song.id)?.lastPlayed ?? 0
      const within = lastPlayed > 0 && lastPlayed >= context.now - (value as number) * DAY_MS
      return operator === 'inTheLast' ? within : !within
    }
    case 'inPlaylist': {
      const membership = context.listMembership.get(song.id) ?? EMPTY_SET
      const inList = membership.has(value as string)
      return operator === 'inPlaylist' ? inList : !inList
    }
    case 'isLoved': {
      const loved = (context.listMembership.get(song.id) ?? EMPTY_SET).has(LIST_IDS.LOVE)
      return operator === 'is' ? loved === value : loved !== value
    }
    default: return false
  }
}

const compareText = (left: string, right: string): number => {
  const result = left.localeCompare(right, 'zh-CN', { sensitivity: 'base', numeric: true })
  return result < 0 ? -1 : result > 0 ? 1 : 0
}

const sortValue = (sort: SmartPlaylistSort, song: LX.Music.MusicInfo, context: SmartPlaylistContext): string | number => {
  switch (sort) {
    case 'name': return song.name ?? ''
    case 'singer': return song.singer ?? ''
    case 'album': return song.meta?.albumName ?? ''
    case 'interval': return parseMusicInterval(song.interval)
    case 'playCount': return context.playStats.get(song.id)?.count ?? 0
    case 'lastPlayed': return context.playStats.get(song.id)?.lastPlayed ?? 0
    default: return 0
  }
}

const shuffle = (list: LX.Music.MusicInfo[]): void => {
  for (let index = list.length - 1; index > 0; index--) {
    const target = Math.floor(Math.random() * (index + 1))
    const temp = list[index]
    list[index] = list[target]
    list[target] = temp
  }
}

/**
 * 对歌曲执行智能歌单规则。
 *
 * - groups 之间为 AND；组内 any=true 为 OR、any=false 为 AND。
 * - 没有有效条件的组会被忽略；如果最终没有任何有效条件，返回空数组
 *   （避免误配置把整个曲库灌进歌单）。
 * - sort=random 时忽略 order；limit=0 表示不限制。
 * - 返回值是新的数组，不会修改传入的 songs 或规则对象。
 */
export const evaluateSmartPlaylist = (input: unknown, songs: LX.Music.MusicInfo[], context: SmartPlaylistContext): LX.Music.MusicInfo[] => {
  const rule = normalizeSmartPlaylist(input)
  if (!Array.isArray(songs)) return fail('songs 必须是歌曲数组')
  const playStats = context?.playStats ?? new Map<string, SmartPlaylistPlayStat>()
  const listMembership = context?.listMembership ?? new Map<string, ReadonlySet<string>>()
  const now = typeof context?.now === 'number' && Number.isFinite(context.now) ? context.now : Date.now()
  const evaluatorContext: SmartPlaylistContext = { playStats, listMembership, now }
  const groups = rule.groups.filter(group => group.rules.length > 0)
  if (!groups.length) return []
  const matched = songs.filter(song => groups.every(group => group.any
    ? group.rules.some(condition => matchCondition(condition, song, evaluatorContext))
    : group.rules.every(condition => matchCondition(condition, song, evaluatorContext))))
  let result: LX.Music.MusicInfo[]
  if (rule.sort === 'random') {
    result = matched
    shuffle(result)
  } else {
    const indexed = matched.map((song, index) => ({ song, index }))
    const direction = rule.order === 'desc' ? -1 : 1
    indexed.sort((left, right) => {
      const leftValue = sortValue(rule.sort, left.song, evaluatorContext)
      const rightValue = sortValue(rule.sort, right.song, evaluatorContext)
      const compared = typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : compareText(String(leftValue), String(rightValue))
      if (compared !== 0) return compared * direction
      return left.index - right.index
    })
    result = indexed.map(item => item.song)
  }
  if (rule.limit > 0 && result.length > rule.limit) result.length = rule.limit
  return result
}
