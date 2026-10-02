import defaultSetting from '@common/defaultSetting'
import { CMMON_EVENT_NAME, WIN_MAIN_RENDERER_EVENT_NAME, WIN_LYRIC_RENDERER_EVENT_NAME, PLAYER_EVENT_NAME, DISLIKE_EVENT_NAME, HOTKEY_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { PLUGIN_IPC, isPluginId } from '@common/optionalPlugins'
import { BACKUP_IPC } from '@common/backup'
import { SOURCE_PLUGIN_IPC } from '@common/sourcePlugin'

type Role = 'main' | 'lyric' | 'userApi'
type SenderEvent = Pick<Electron.IpcMainEvent, 'sender' | 'senderFrame'>
type Check = (value: any) => boolean
const owners = new WeakMap<Electron.WebContents, { role: Role, url: string }>()
const canonical = (url: string) => { const parsed = new URL(url); parsed.hash = ''; parsed.search = ''; return parsed.href }
function fail(code: string, reason: string): never { throw Object.assign(new Error(reason), { code }) }

export const registerIpcWindow = (contents: Electron.WebContents, role: Role, url: string) => {
  owners.set(contents, { role, url: canonical(url) })
  contents.once('destroyed', () => owners.delete(contents))
}
export const ipcWindowRole = (event: SenderEvent) => owners.get(event.sender)?.role

// Bound both traversal work and serialized payload size before dispatching privileged work.
export const validateIpcValue = (value: unknown) => {
  let bytes = 0
  let nodes = 0
  const seen = new Set<object>()
  const visit = (item: any, depth: number) => {
    if (++nodes > 1_000_000 || depth > 32 || bytes > 64 * 1024 * 1024) fail('IPC_PAYLOAD_LIMIT', '请求数据过大或嵌套过深')
    if (item == null || typeof item === 'boolean') return
    if (typeof item === 'string') { bytes += Buffer.byteLength(item); return }
    if (typeof item === 'number' && Number.isFinite(item)) return
    if (typeof item !== 'object') fail('IPC_ARGUMENT_INVALID', '请求包含不支持的数据类型')
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) { bytes += item.byteLength; return }
    if (seen.has(item)) fail('IPC_ARGUMENT_INVALID', '请求包含循环引用')
    seen.add(item)
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) fail('IPC_ARGUMENT_INVALID', '请求对象类型无效')
    for (const [key, val] of Object.entries(item)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('IPC_ARGUMENT_INVALID', '请求包含保留字段')
      bytes += Buffer.byteLength(key)
      visit(val, depth + 1)
    }
    seen.delete(item)
  }
  visit(value, 0)
  if (bytes > 64 * 1024 * 1024) fail('IPC_PAYLOAD_LIMIT', '请求数据过大')
}

const obj: Check = v => !!v && typeof v === 'object' && !Array.isArray(v)
const str: Check = v => typeof v === 'string' && v.length <= 8192 && !v.includes('\0')
const bool: Check = v => typeof v === 'boolean'
const strings: Check = v => Array.isArray(v) && v.every(str)
const objects: Check = v => Array.isArray(v) && v.every(obj)
const empty: Check = v => v === undefined || v === null
const shape = (fields: Record<string, Check>): Check => v => obj(v) && Object.entries(fields).every(([key, check]) => check(v[key]))
const oneOf = (...values: unknown[]): Check => v => values.includes(v)
const optional = (check: Check): Check => v => v === undefined || check(v)
const finite: Check = v => typeof v === 'number' && Number.isFinite(v)
const known = new Set<string>([CMMON_EVENT_NAME, WIN_MAIN_RENDERER_EVENT_NAME, WIN_LYRIC_RENDERER_EVENT_NAME, PLAYER_EVENT_NAME, DISLIKE_EVENT_NAME, HOTKEY_RENDERER_EVENT_NAME, PLUGIN_IPC, BACKUP_IPC].flatMap(group => Object.values(group)))
const checks = new Map<string, Check>()
for (const name of [SOURCE_PLUGIN_IPC.load, SOURCE_PLUGIN_IPC.call, SOURCE_PLUGIN_IPC.cancel]) known.add(name)
checks.set(SOURCE_PLUGIN_IPC.load, obj)
checks.set(SOURCE_PLUGIN_IPC.call, shape({ id: str, callId: str, method: str, args: Array.isArray }))
checks.set(SOURCE_PLUGIN_IPC.cancel, shape({ id: str, callId: str }))
const add = (prefix: string, names: string, check: Check) => { for (const name of names.split(' ')) checks.set(prefix + name, check) }
add('common_', 'get_env_params clear_env_params_deeplink get_system_fonts list_custom_fonts get_app_setting', empty)
add('common_', 'read_custom_font', str)
add('common_', 'import_custom_font', obj) // FontLibrary validates file type, size and destination.
add('winMain_', 'focus min max min_toggle hide_toggle quit inited get_window_state clear_cache get_cache_size open_dev_tools get_themes get_hot_key get_user_api_list get_user_api_status webdav_last_result sync_get_server_devices download_list_get download_list_clear get_sound_effect_eq_preset get_sound_effect_convolution_preset clear_lyric_raw get_lyric_raw_count clear_lyric_edited get_lyric_edited_count clear_music_url get_music_url_count clear_other_source get_other_source_count update_check update_get_runtime update_cancel_update quit_update', empty)
add('winMain_', 'close fullscreen', optional(bool))
add('winMain_', 'set_power_save_blocker set_ignore_mouse_events', bool)
add('winMain_', 'open_dir_in_explorer remove_theme get_data get_palyer_lyric get_lyric_raw get_lyric_edited remove_lyric_edited get_music_url remove_music_url get_other_source sync_remove_server_device request_user_api_cancel', str)
checks.set('winMain_download_disk_space', str)
add('winMain_', 'remove_user_api download_list_remove', strings)
add('winMain_', 'download_list_update save_sound_effect_eq_preset save_sound_effect_convolution_preset', objects)
add('winMain_', 'import_user_api', v => typeof v === 'string' && v.length <= 2 * 1024 * 1024)
add('winMain_', 'cookie_login cookie_login_embedded cookie_login_embedded_cancel', oneOf('wy', 'tx', 'kg', 'kw', 'mg'))
add('winMain_', 'webdav_action', oneOf('test', 'upload', 'download', 'sync'))
add('winMain_', 'set_user_api', str)
add('backup_', 'preview discard', str)
checks.set('winMain_save_data', shape({ path: str }))
checks.set('winMain_library_action', shape({ method: str, args: Array.isArray }))
checks.set('winMain_request_user_api', shape({ requestKey: str, data: obj }))
checks.set('winMain_user_api_set_allow_update_alert', shape({ id: str, enable: bool }))
const lyricHex: Check = v => typeof v === 'string' && v.length <= 512 * 1024 && /^(?:[a-f\d]{16})*$/i.test(v)
checks.set('winMain_handle_tx_decode_lyric', shape({ lrc: lyricHex, tlrc: lyricHex, rlrc: lyricHex }))
checks.set('winMain_handle_kw_decode_lyric', shape({ lrcBase64: v => typeof v === 'string' && v.length <= 2 * 1024 * 1024, isGetLyricx: bool }))
checks.set('winMain_open_api_action', v => obj(v) && (v.action === 'status' || (v.action === 'enable' && obj(v.data) && (v.data.enable === false || shape({ enable: oneOf(true), bindLan: bool, port: v => typeof v === 'string' && /^\d{1,5}$/.test(v) && +v > 0 && +v <= 65535 })(v.data)))))
checks.set('winMain_update_download_update', v => v == null || shape({ downloadUrl: str, digest: optional(str) })(v))
for (const name of ['save_lyric_raw', 'save_lyric_edited']) checks.set('winMain_' + name, shape({ id: str, lyrics: obj }))
checks.set('winMain_save_music_url', shape({ id: str, url: str }))
checks.set('winMain_save_other_source', shape({ id: str, list: objects }))
checks.set('winMain_set_window_size', v => obj(v) && Object.keys(v).every(key => ['x', 'y', 'width', 'height'].includes(key) && finite(v[key]) && Math.abs(v[key]) <= 32768))
add('player_', 'list_get list_trash_get', empty)
add('player_', 'list_music_get list_music_get_list_ids', str)
add('player_', 'list_music_clear list_remove list_trash_restore list_trash_delete', strings)
add('player_', 'list_update list_music_update', objects)
checks.set('player_list_add', shape({ position: finite, listInfos: objects }))
checks.set('player_list_update_position', shape({ position: finite, ids: strings }))
checks.set('player_list_music_add', shape({ id: str, musicInfos: objects, addMusicLocationType: oneOf('top', 'bottom') }))
checks.set('player_list_music_move', shape({ fromId: str, toId: str, musicInfos: objects, addMusicLocationType: oneOf('top', 'bottom') }))
checks.set('player_list_music_remove', shape({ listId: str, ids: strings }))
checks.set('player_list_music_update_position', shape({ listId: str, position: finite, ids: strings }))
checks.set('player_list_music_overwrite', shape({ listId: str, musicInfos: objects }))
checks.set('player_list_music_check_exist', shape({ listId: str, musicInfoId: str }))
add('dislike_', 'get_dislike_music_infos clear_dislike_music_infos', empty)
add('dislike_', 'add_dislike_music_infos', objects)
add('dislike_', 'overwrite_dislike_music_infos', v => typeof v === 'string')
add('winLyric_', 'close get_config request_main_window_channel show_main_window', empty)
add('winLyric_', 'set_win_resizeable mouse_enter_leave', bool)
add('hotKey_', 'enable', bool)
add('hotKey_', 'status', empty)
checks.set('winLyric_set_win_bounds', shape({ x: finite, y: finite, w: finite, h: finite }))
const lyricAllowed = new Set(['common_get_app_setting', 'common_get_env_params', 'common_get_system_fonts', 'common_list_custom_fonts', 'common_read_custom_font', PLUGIN_IPC.list, PLUGIN_IPC.runtimeResult])
const userApiAllowed = new Set(['userApi_init', 'userApi_response', 'userApi_openDevTools', 'userApi_showUpdateAlert', 'userApi_getProxy'])
for (const name of userApiAllowed) known.add(name)
checks.set('userApi_init', v => shape({ status: bool, message: optional(str) })(v) && (v.status ? obj(v.data) : v.data == null))
checks.set('userApi_response', shape({ status: bool, message: optional(str), data: shape({ requestKey: str }) }))
checks.set('userApi_showUpdateAlert', shape({ data: shape({ log: str, updateUrl: str }) }))
checks.set('userApi_openDevTools', v => empty(v) || shape({ data: empty, status: empty, message: empty })(v))
checks.set('userApi_getProxy', empty)

const settingCheck = (value: any, lyric: boolean) => obj(value) && Object.entries(value).every(([key, val]) => {
  if (!Object.hasOwn(defaultSetting, key) || (lyric && !key.startsWith('desktopLyric.'))) return false
  const original = defaultSetting[key as keyof LX.AppSetting]
  if (key === 'desktopLyric.x' || key === 'desktopLyric.y') return val == null || finite(val)
  return original == null ? val == null || typeof val === 'string' : Array.isArray(original) ? Array.isArray(val) : typeof val === typeof original
})

export const assertIpcRequest = (event: SenderEvent, channel: string, params?: unknown, rest: unknown[] = []) => {
  const owner = owners.get(event.sender)
  if (!owner || event.sender.isDestroyed() || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || canonical(event.senderFrame.url) !== owner.url) fail('IPC_SENDER_DENIED', '此窗口无权调用该接口')
  if (!known.has(channel) || (owner.role === 'userApi' ? !userApiAllowed.has(channel) : channel.startsWith('userApi_')) || (owner.role === 'lyric' && !channel.startsWith('winLyric_') && !lyricAllowed.has(channel))) fail('IPC_CHANNEL_DENIED', '此窗口无权使用该功能')
  validateIpcValue([params, ...rest])
  let valid: boolean
  if (['common_set_app_setting', 'winMain_set_config', 'winLyric_set_config'].includes(channel)) valid = settingCheck(params, owner.role === 'lyric')
  else if (channel.startsWith('optional_plugins:')) {
    if ([PLUGIN_IPC.list, PLUGIN_IPC.refresh].includes(channel as any)) valid = empty(params) && rest.length === 0
    else if (channel === PLUGIN_IPC.import) valid = obj(params) && rest.length === 0
    else valid = isPluginId(params) && (channel === PLUGIN_IPC.setEnabled ? rest.length === 1 && bool(rest[0]) : channel === PLUGIN_IPC.runtimeResult ? str(rest[0]) && optional(str)(rest[1]) && rest.length <= 2 : channel === PLUGIN_IPC.install ? optional(oneOf('zip', 'lxplugin'))(rest[0]) && rest.length <= 1 : channel === PLUGIN_IPC.export ? rest.length === 1 && obj(rest[0]) : rest.length === 0)
  } else valid = rest.length === 0 && (checks.get(channel) ?? obj)(params)
  if (!valid) fail('IPC_ARGUMENT_INVALID', '接口参数格式或取值无效')
}
