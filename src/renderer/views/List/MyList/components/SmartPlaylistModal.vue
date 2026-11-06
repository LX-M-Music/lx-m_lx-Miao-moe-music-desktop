<template>
  <material-modal :show="visible" bg-close teleport="#view" @close="close">
    <section :class="$style.panel" data-smart-playlist-modal>
      <h2>{{ listInfo ? $t('smart_playlist__title_edit') : $t('smart_playlist__title_create') }}</h2>
      <p v-if="listInfo" :class="$style.listName">{{ listInfo.name }}</p>
      <label v-else :class="$style.row">
        <span :class="$style.label">{{ $t('smart_playlist__name') }}</span>
        <base-input
          v-model="name" :class="$style.nameInput" :placeholder="$t('smart_playlist__name_placeholder')"
          :disabled="busy" maxlength="200"
        />
      </label>

      <div :class="$style.groups">
        <div v-for="(group, groupIndex) in groups" :key="group.key" :class="$style.group" :data-smart-group="groupIndex">
          <div :class="$style.groupHeader">
            <span :class="$style.label">{{ groupIndex === 0 ? $t('smart_playlist__conditions') : $t('smart_playlist__and') }}</span>
            <base-selection
              :model-value="group.any ? 'any' : 'all'" :list="matchOptions" item-key="id" item-name="name"
              :aria-label="$t('smart_playlist__match')" :style="{ '--selection-width': '8rem' }"
              @update:model-value="group.any = $event === 'any'"
            />
            <button
              v-if="groups.length > 1" type="button" :class="$style.iconBtn" :aria-label="$t('smart_playlist__remove_group')"
              :title="$t('smart_playlist__remove_group')" @click="removeGroup(groupIndex)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12M9 7V5h6v2M8 7l1 12h6l1-12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
            </button>
          </div>
          <div v-for="(rule, ruleIndex) in group.rules" :key="rule.key" :class="$style.rule" :data-smart-rule="ruleIndex">
            <base-selection
              :model-value="rule.field" :list="fieldOptions" item-key="id" item-name="name"
              :aria-label="$t('smart_playlist__field')" :style="{ '--selection-width': '6.5rem' }"
              @update:model-value="changeField(rule, $event)"
            />
            <base-selection
              :model-value="rule.operator" :list="operatorOptions(rule.field)" item-key="id" item-name="name"
              :aria-label="$t('smart_playlist__operator')" :style="{ '--selection-width': '7.5rem' }"
              @update:model-value="changeOperator(rule, $event)"
            />
            <template v-if="rule.field === 'isLoved'">
              <base-selection
                :model-value="rule.value" :list="boolOptions" item-key="id" item-name="name"
                :aria-label="$t('smart_playlist__value')" :style="{ '--selection-width': '5rem' }"
                @update:model-value="rule.value = $event"
              />
            </template>
            <template v-else-if="rule.field === 'inPlaylist'">
              <base-selection
                :model-value="rule.value" :list="playlistOptions" item-key="id" item-name="name"
                :aria-label="$t('smart_playlist__value')" :style="{ '--selection-width': '9rem' }"
                @update:model-value="rule.value = $event"
              />
            </template>
            <template v-else-if="needsRange(rule)">
              <base-input v-model="rule.valueMin" type="number" min="0" :class="$style.numberInput" :aria-label="$t('smart_playlist__value_min')" />
              <span :class="$style.rangeMark">-</span>
              <base-input v-model="rule.valueMax" type="number" min="0" :class="$style.numberInput" :aria-label="$t('smart_playlist__value_max')" />
              <span v-if="rule.field === 'interval'" :class="$style.unit">{{ $t('smart_playlist__unit_seconds') }}</span>
            </template>
            <template v-else>
              <base-input
                v-model="rule.value" :type="numberField(rule.field) ? 'number' : 'text'" min="0" :class="$style.valueInput"
                :placeholder="valuePlaceholder(rule)" :aria-label="$t('smart_playlist__value')"
              />
              <span v-if="rule.field === 'interval'" :class="$style.unit">{{ $t('smart_playlist__unit_seconds') }}</span>
              <span v-else-if="rule.field === 'lastPlayed'" :class="$style.unit">{{ $t('smart_playlist__unit_days') }}</span>
            </template>
            <button
              type="button" :class="$style.iconBtn" :aria-label="$t('smart_playlist__remove_rule')"
              :title="$t('smart_playlist__remove_rule')" @click="removeRule(group, ruleIndex)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
            </button>
          </div>
          <button type="button" :class="$style.textBtn" @click="addRule(group)">{{ $t('smart_playlist__add_rule') }}</button>
        </div>
        <button type="button" :class="$style.textBtn" :disabled="groups.length >= 20" @click="addGroup">{{ $t('smart_playlist__add_group') }}</button>
      </div>

      <div :class="$style.options">
        <label :class="$style.option">
          <span :class="$style.label">{{ $t('smart_playlist__sort') }}</span>
          <base-selection :model-value="sort" :list="sortOptions" item-key="id" item-name="name" :style="{ '--selection-width': '7rem' }" @update:model-value="sort = $event" />
        </label>
        <label :class="$style.option">
          <span :class="$style.label">{{ $t('smart_playlist__order') }}</span>
          <base-selection :model-value="order" :list="orderOptions" item-key="id" item-name="name" :style="{ '--selection-width': '5rem' }" @update:model-value="order = $event" />
        </label>
        <label :class="$style.option">
          <span :class="$style.label">{{ $t('smart_playlist__limit') }}</span>
          <base-input v-model="limit" type="number" min="0" max="100000" :class="$style.numberInput" :placeholder="'0'" />
        </label>
      </div>

      <p :class="$style.preview" data-smart-playlist-preview role="status">
        <template v-if="previewError">{{ $t('smart_playlist__preview_invalid') }}</template>
        <template v-else-if="previewCount == null">{{ $t('smart_playlist__preview_loading') }}</template>
        <template v-else>{{ $t('smart_playlist__preview_count', { count: previewCount }) }}</template>
      </p>
      <p v-if="error" :class="$style.error" role="alert">{{ error }}</p>
      <div :class="$style.actions">
        <base-btn :disabled="busy" @click="close">{{ $t('btn_cancel') }}</base-btn>
        <base-btn :disabled="busy" data-smart-playlist-save @click="save">{{ $t('btn_confirm') }}</base-btn>
      </div>
    </section>
  </material-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from '@common/utils/vueTools'
import { formatError } from '@common/utils/errorMessage'
import { LIST_IDS } from '@common/constants'
import {
  SMART_PLAYLIST_FIELD_OPERATORS,
  SMART_PLAYLIST_FIELDS,
  SMART_PLAYLIST_ORDERS,
  SMART_PLAYLIST_SORTS,
  type SmartPlaylistCondition,
  type SmartPlaylistField,
  type SmartPlaylistGroup,
  type SmartPlaylistOperator,
  type SmartPlaylistOrder,
  type SmartPlaylistRule,
  type SmartPlaylistSort,
} from '@common/smartPlaylist'
import { useI18n } from '@renderer/plugins/i18n'
import { defaultList, loveList, userLists } from '@renderer/store/list/state'
import { createUserList } from '@renderer/store/list/action'
import { getSmartPlaylistRule, loadSmartPlaylists, previewSmartPlaylist, refreshSmartPlaylist, saveSmartPlaylistRule } from '@renderer/store/list/smartPlaylist'

const props = defineProps<{ visible: boolean, listInfo?: { id: string, name: string } }>()
const emit = defineEmits<{ 'update:visible': [visible: boolean], saved: [listId: string] }>()

interface EditableRule {
  key: number
  field: SmartPlaylistField
  operator: SmartPlaylistOperator
  value: string
  valueMin: string
  valueMax: string
}
interface EditableGroup {
  key: number
  any: boolean
  rules: EditableRule[]
}

const t = useI18n()
const name = ref('')
const groups = ref<EditableGroup[]>([])
const sort = ref<SmartPlaylistSort>('name')
const order = ref<SmartPlaylistOrder>('asc')
const limit = ref('0')
const busy = ref(false)
const error = ref('')
const previewCount = ref<number | null>(null)
const previewError = ref('')
let keySeed = 0
let previewTimer: ReturnType<typeof setTimeout> | null = null
let generation = 0

const FIELD_I18N = {
  name: 'smart_playlist__field_name',
  singer: 'smart_playlist__field_singer',
  album: 'smart_playlist__field_album',
  source: 'smart_playlist__field_source',
  interval: 'smart_playlist__field_interval',
  playCount: 'smart_playlist__field_playCount',
  lastPlayed: 'smart_playlist__field_lastPlayed',
  inPlaylist: 'smart_playlist__field_inPlaylist',
  isLoved: 'smart_playlist__field_isLoved',
} as const
const OPERATOR_I18N = {
  is: 'smart_playlist__op_is',
  isNot: 'smart_playlist__op_isNot',
  contains: 'smart_playlist__op_contains',
  notContains: 'smart_playlist__op_notContains',
  startsWith: 'smart_playlist__op_startsWith',
  gt: 'smart_playlist__op_gt',
  lt: 'smart_playlist__op_lt',
  inTheRange: 'smart_playlist__op_inTheRange',
  inTheLast: 'smart_playlist__op_inTheLast',
  notInTheLast: 'smart_playlist__op_notInTheLast',
  inPlaylist: 'smart_playlist__op_inPlaylist',
  notInPlaylist: 'smart_playlist__op_notInPlaylist',
} as const
const SORT_I18N = {
  name: 'smart_playlist__sort_name',
  singer: 'smart_playlist__sort_singer',
  album: 'smart_playlist__sort_album',
  interval: 'smart_playlist__sort_interval',
  playCount: 'smart_playlist__sort_playCount',
  lastPlayed: 'smart_playlist__sort_lastPlayed',
  random: 'smart_playlist__sort_random',
} as const

const fieldOptions = computed(() => SMART_PLAYLIST_FIELDS.map(field => ({ id: field, name: t(FIELD_I18N[field]) })))
const sortOptions = computed(() => SMART_PLAYLIST_SORTS.map(value => ({ id: value, name: t(SORT_I18N[value]) })))
const orderOptions = computed(() => SMART_PLAYLIST_ORDERS.map(value => ({ id: value, name: t(value === 'asc' ? 'smart_playlist__order_asc' : 'smart_playlist__order_desc') })))
const matchOptions = computed(() => [
  { id: 'all', name: t('smart_playlist__match_all') },
  { id: 'any', name: t('smart_playlist__match_any') },
])
const boolOptions = computed(() => [
  { id: 'true', name: t('smart_playlist__yes') },
  { id: 'false', name: t('smart_playlist__no') },
])
const playlistOptions = computed(() => {
  const options = [
    { id: LIST_IDS.DEFAULT, name: t(defaultList.name) },
    { id: LIST_IDS.LOVE, name: t(loveList.name) },
    ...userLists.map(list => ({ id: list.id, name: list.name })),
  ]
  return options.filter(option => option.id !== props.listInfo?.id)
})

const numberField = (field: SmartPlaylistField) => field === 'interval' || field === 'playCount' || field === 'lastPlayed'
const needsRange = (rule: EditableRule) => (rule.field === 'interval' || rule.field === 'playCount') && rule.operator === 'inTheRange'
const valuePlaceholder = (rule: EditableRule) => {
  if (rule.field === 'interval') return '180'
  if (rule.field === 'playCount') return '0'
  if (rule.field === 'lastPlayed') return '30'
  return ''
}

const firstOperator = (field: SmartPlaylistField): SmartPlaylistOperator => SMART_PLAYLIST_FIELD_OPERATORS[field][0]
const createRule = (field: SmartPlaylistField = 'name'): EditableRule => ({
  key: ++keySeed,
  field,
  operator: firstOperator(field),
  value: '',
  valueMin: '',
  valueMax: '',
})
const createGroup = (): EditableGroup => ({ key: ++keySeed, any: false, rules: [createRule()] })

const applyRule = (rule: SmartPlaylistRule) => {
  name.value = rule.name
  sort.value = rule.sort
  order.value = rule.order
  limit.value = String(rule.limit)
  groups.value = rule.groups.length
    ? rule.groups.map(group => ({
      key: ++keySeed,
      any: group.any,
      rules: group.rules.map(condition => {
        const editable: EditableRule = {
          key: ++keySeed,
          field: condition.field,
          operator: condition.operator,
          value: '',
          valueMin: '',
          valueMax: '',
        }
        if (condition.field === 'interval' || condition.field === 'playCount') {
          if (condition.operator === 'inTheRange') {
            const [min, max] = condition.value as [number, number]
            editable.valueMin = String(min)
            editable.valueMax = String(max)
          } else editable.value = String(condition.value)
        } else if (condition.field === 'lastPlayed') {
          editable.value = String(condition.value)
        } else if (condition.field === 'isLoved') {
          editable.value = condition.value ? 'true' : 'false'
        } else {
          editable.value = String(condition.value)
        }
        return editable
      }),
    }))
    : [createGroup()]
}

const reset = async() => {
  const current = ++generation
  error.value = ''
  previewCount.value = null
  previewError.value = ''
  name.value = ''
  groups.value = [createGroup()]
  sort.value = 'name'
  order.value = 'asc'
  limit.value = '0'
  if (props.listInfo) {
    try { await loadSmartPlaylists() } catch (error) { console.warn('[smartPlaylist] load rules failed', error) }
    if (current !== generation) return
    const rule = getSmartPlaylistRule(props.listInfo.id)
    if (rule) applyRule(rule)
  }
  schedulePreview()
}

const buildCondition = (rule: EditableRule): SmartPlaylistCondition => {
  if (rule.field === 'isLoved') return { field: rule.field, operator: rule.operator, value: rule.value === 'true' }
  if (rule.field === 'interval' || rule.field === 'playCount') {
    if (rule.operator === 'inTheRange') return { field: rule.field, operator: rule.operator, value: [Number(rule.valueMin || 0), Number(rule.valueMax || 0)] }
    return { field: rule.field, operator: rule.operator, value: Number(rule.value || 0) }
  }
  if (rule.field === 'lastPlayed') return { field: rule.field, operator: rule.operator, value: Number(rule.value || 0) }
  return { field: rule.field, operator: rule.operator, value: rule.value }
}

const buildRule = (): SmartPlaylistRule => {
  const targetName = props.listInfo?.name ?? name.value.trim()
  return {
    version: 1,
    name: targetName,
    groups: groups.value.map<SmartPlaylistGroup>(group => ({
      any: group.any,
      rules: group.rules.map(buildCondition),
    })),
    sort: sort.value,
    order: order.value,
    limit: Math.max(0, Math.floor(Number(limit.value || 0))),
  }
}

const schedulePreview = () => {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => { void runPreview() }, 300)
}
const runPreview = async() => {
  const current = generation
  const rule = buildRule()
  try {
    const count = await previewSmartPlaylist(rule, props.listInfo?.id)
    if (current !== generation) return
    previewCount.value = count
    previewError.value = ''
  } catch (cause) {
    if (current !== generation) return
    previewCount.value = null
    previewError.value = 'invalid'
    console.warn('[smartPlaylist] preview failed', cause)
  }
}

const changeField = (rule: EditableRule, field: SmartPlaylistField) => {
  rule.field = field
  rule.operator = firstOperator(field)
  rule.value = ''
  rule.valueMin = ''
  rule.valueMax = ''
  schedulePreview()
}
const changeOperator = (rule: EditableRule, operator: SmartPlaylistOperator) => {
  rule.operator = operator
  rule.valueMin = ''
  rule.valueMax = ''
  schedulePreview()
}
const operatorOptions = (field: SmartPlaylistField) => SMART_PLAYLIST_FIELD_OPERATORS[field].map(operator => ({ id: operator, name: t(OPERATOR_I18N[operator]) }))

const addRule = (group: EditableGroup) => {
  group.rules.push(createRule())
  schedulePreview()
}
const removeRule = (group: EditableGroup, index: number) => {
  group.rules.splice(index, 1)
  schedulePreview()
}
const addGroup = () => {
  groups.value.push(createGroup())
  schedulePreview()
}
const removeGroup = (index: number) => {
  groups.value.splice(index, 1)
  schedulePreview()
}

watch(() => [props.visible, props.listInfo?.id], () => {
  if (props.visible) void reset()
  else if (previewTimer) { clearTimeout(previewTimer); previewTimer = null }
}, { immediate: true })
watch([groups, sort, order, limit], () => { schedulePreview() }, { deep: true })

const close = () => { if (!busy.value) emit('update:visible', false) }

const save = async() => {
  if (busy.value) return
  const targetName = props.listInfo?.name ?? name.value.trim()
  if (!targetName) {
    error.value = t('smart_playlist__name_required')
    return
  }
  let listId = props.listInfo?.id
  busy.value = true
  error.value = ''
  const rule = buildRule()
  if (rule.groups.every(group => !group.rules.length)) {
    busy.value = false
    error.value = t('smart_playlist__empty_rule')
    return
  }
  try {
    if (!listId) {
      listId = `userlist_${Date.now()}`
      await createUserList({ id: listId, name: targetName })
    }
    await saveSmartPlaylistRule(listId, rule)
    await refreshSmartPlaylist(listId)
    emit('saved', listId)
    emit('update:visible', false)
  } catch (cause) {
    error.value = formatError(cause, t('smart_playlist__save_failed'), 'SMART_PLAYLIST_SAVE_FAILED')
  } finally {
    busy.value = false
  }
}
</script>

<style lang="less" module>
.panel {
  box-sizing: border-box;
  width: min(760px, calc(100vw - 60px));
  max-height: min(86vh, 720px);
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--color-font);
}
.panel h2 { font-size: 18px; }
.listName { color: var(--color-font-label); font-size: 13px; overflow-wrap: anywhere; }
.row { display: flex; align-items: center; gap: 10px; }
.label { flex: none; font-size: 12px; color: var(--color-font-label); }
.nameInput { flex: 1; min-width: 0; }
.groups { display: flex; flex-direction: column; gap: 10px; }
.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-primary-background);
}
.groupHeader { display: flex; align-items: center; gap: 10px; }
.rule { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.valueInput { flex: 1; min-width: 80px; }
.numberInput { width: 84px; }
.rangeMark { color: var(--color-font-label); }
.unit { font-size: 12px; color: var(--color-font-label); }
.iconBtn {
  flex: none;
  width: 26px;
  height: 26px;
  padding: 5px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-button-font);
  cursor: pointer;
  svg { width: 100%; height: 100%; }
  &:hover { background-color: var(--color-primary-background-hover); }
  &:focus-visible { outline: none; box-shadow: var(--focus-ring); }
}
.textBtn {
  align-self: flex-start;
  padding: 4px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-primary);
  font-size: 12px;
  cursor: pointer;
  &:hover { background-color: var(--color-primary-background-hover); }
  &:focus-visible { outline: none; box-shadow: var(--focus-ring); }
}
.options { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
.option { display: flex; align-items: center; gap: 8px; }
.preview { font-size: 12px; color: var(--color-font-label); white-space: pre-wrap; }
.error { font-size: 12px; color: var(--color-danger); white-space: pre-wrap; }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
</style>
