<template>
  <section ref="root" class="mini-player" :class="{ 'native-drag': nativeDrag && !setting['desktopLyric.isLock'], 'native-controls-hover': nativeControlsHover, 'has-recovery': showRecovery, 'lyrics-only': !setting['desktopLyric.showPlayer'], 'auto-hide-controls': setting['desktopLyric.autoHideControls'], 'options-open': optionsOpen }" data-mini-player>
    <header ref="header" class="mini-header mini-controls" data-mini-controls @pointerdown="dragWindow">
      <span class="mini-brand">LX-M <span>{{ $t('mini_player__title') }}</span></span>
      <div class="mini-window-buttons">
        <button type="button" :title="$t('mini_player__show_main')" :aria-label="$t('mini_player__show_main')" @click="showMainWindow">
          <svg viewBox="0 0 24 24"><path d="M9 4H4v16h16v-5M13 4h7v7M20 4 10 14" /></svg>
        </button>
        <button type="button" :class="{ active: setting['desktopLyric.isAlwaysOnTop'] }" :aria-pressed="setting['desktopLyric.isAlwaysOnTop']" :title="$t('mini_player__pin')" :aria-label="$t('mini_player__pin')" @click="updateSetting({ 'desktopLyric.isAlwaysOnTop': !setting['desktopLyric.isAlwaysOnTop'] })">
          <svg viewBox="0 0 24 24"><path d="m8 3 8 0-1 6 3 4v2H6v-2l3-4ZM12 15v6" /></svg>
        </button>
        <button v-if="!showRecovery" ref="optionsButton" type="button" :title="$t('mini_player__options')" :aria-label="$t('mini_player__options')" :aria-expanded="optionsOpen" aria-controls="mini-options" @click="optionsOpen = !optionsOpen">
          <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
        </button>
        <button type="button" :title="$t('desktop_lyric__close')" :aria-label="$t('desktop_lyric__close')" @click="updateSetting({ 'desktopLyric.enable': false })">
          <svg viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6" /></svg>
        </button>
      </div>
    </header>
    <template v-if="setting['desktopLyric.showPlayer']">
      <div class="mini-track" data-mini-track @pointerdown="dragWindow">
        <div class="mini-cover">
          <img v-if="miniPlayerCover && !coverFailed" :src="miniPlayerCover" :alt="$t('music_cover')" draggable="false" @error="coverFailed = true">
          <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13M9 9l11-2" /><ellipse cx="6" cy="18" rx="3" ry="2" /><ellipse cx="17" cy="16" rx="3" ry="2" /></svg>
        </div>
        <div class="mini-track-info">
          <h1 :title="miniPlayer.name">{{ miniPlayer.name || $t('mini_player__empty') }}</h1>
          <p :title="miniPlayer.singer">{{ miniPlayer.singer || $t('mini_player__choose_song') }}</p>
          <small v-if="miniPlayer.album" :title="miniPlayer.album">{{ miniPlayer.album }}</small>
        </div>
      </div>
      <div class="mini-playback mini-controls" data-mini-controls>
        <div class="mini-progress">
          <input
            type="range" min="0" :max="Math.max(1, miniPlayer.duration)" step="0.1" :value="seekPreview ?? miniPlayer.position"
            :aria-label="$t('mini_player__progress')" :aria-valuetext="formatTime(seekPreview ?? miniPlayer.position)" :disabled="!miniPlayer.id || miniPlayer.duration <= 0"
            @pointerdown="beginSeek" @input="previewSeek" @change="finishSeek" @pointercancel="cancelSeek" @keydown.esc="cancelSeek"
          >
          <div class="mini-times"><span>{{ formatTime(seekPreview ?? miniPlayer.position) }}</span><span>{{ formatTime(miniPlayer.duration) }}</span></div>
        </div>
        <div class="mini-transport">
          <div class="mini-song-buttons">
            <button type="button" :aria-label="$t('player__prev')" :title="$t('player__prev')" @click="command({ action: 'player_prev' })"><svg viewBox="0 0 24 24"><path d="M5 5v14M19 5l-10 7 10 7Z" /></svg></button>
            <button type="button" class="mini-play" :aria-label="$t(miniPlayer.isPlay ? 'player__pause' : 'player__play')" :title="$t(miniPlayer.isPlay ? 'player__pause' : 'player__play')" @click="command({ action: 'player_toggle_play' })">
              <svg v-if="miniPlayer.isPlay" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></svg>
              <svg v-else viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z" /></svg>
            </button>
            <button type="button" :aria-label="$t('player__next')" :title="$t('player__next')" @click="command({ action: 'player_next' })"><svg viewBox="0 0 24 24"><path d="M19 5v14M5 5l10 7-10 7Z" /></svg></button>
          </div>
          <div class="mini-volume">
            <button type="button" :aria-label="$t(miniPlayer.isMute ? 'mini_player__unmute' : 'mini_player__mute')" :title="$t(miniPlayer.isMute ? 'mini_player__unmute' : 'mini_player__mute')" @click="command({ action: 'player_mute' })">
              <svg viewBox="0 0 24 24"><path d="M11 4 5 9H2v6h3l6 5Z" /><path v-if="miniPlayer.isMute" d="m16 9 6 6m0-6-6 6" /><path v-else d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></svg>
            </button>
            <input type="range" min="0" max="1" step="0.01" :value="miniPlayer.volume" :aria-label="$t('mini_player__volume')" :aria-valuetext="`${Math.round(miniPlayer.volume * 100)}%`" @input="changeVolume">
          </div>
        </div>
      </div>
    </template>
    <transition name="mini-options">
      <div v-if="optionsOpen" id="mini-options" class="mini-options" role="dialog" :aria-label="$t('mini_player__options')" @keydown.esc.stop.prevent="closeOptions">
        <div class="mini-options-title"><strong>{{ $t('mini_player__options') }}</strong><button type="button" :aria-label="$t('close')" @click="closeOptions">×</button></div>
        <label><input type="checkbox" :checked="setting['desktopLyric.style.backgroundOpacity'] === 0" @change="setTransparent"><span>{{ $t('mini_player__transparent') }}</span></label>
        <label><input type="checkbox" :checked="setting['desktopLyric.autoHideControls']" @change="updateSetting({ 'desktopLyric.autoHideControls': $event.target.checked })"><span>{{ $t('mini_player__hide_controls') }}</span></label>
        <label><input type="checkbox" :checked="!setting['desktopLyric.showPlayer']" @change="updateSetting({ 'desktopLyric.showPlayer': !$event.target.checked })"><span>{{ $t('mini_player__lyrics_only') }}</span></label>
        <label class="mini-opacity-control">
          <span class="mini-opacity-heading"><span>{{ $t('mini_player__lyric_transparency') }}</span><span aria-hidden="true">{{ lyricTransparency }}%</span></span>
          <input
            type="range" min="0" max="100" step="1" :value="lyricTransparency"
            :aria-label="$t('mini_player__lyric_transparency')" :aria-valuetext="`${lyricTransparency}%`" aria-describedby="mini-opacity-tip"
            @input="changeLyricTransparency"
          >
          <span id="mini-opacity-tip" class="mini-opacity-tip">{{ $t('mini_player__lyric_transparency_tip') }}</span>
        </label>
        <p>{{ $t('mini_player__hide_tip') }}</p>
        <div class="mini-font-buttons">
          <button type="button" :aria-label="$t('desktop_lyric__font_decrease')" @click="changeFont(-1)">A−</button>
          <span>{{ $t('mini_player__lyric_size') }}</span>
          <button type="button" :aria-label="$t('desktop_lyric__font_increase')" @click="changeFont(1)">A＋</button>
          <button type="button" :title="$t('desktop_lyric__lock')" :aria-label="$t('desktop_lyric__lock')" @click="lockWindow"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4" /></svg></button>
        </div>
      </div>
    </transition>
    <p v-if="playerActionFailed" class="mini-error" role="status">{{ $t('mini_player__action_failed') }}</p>
  </section>
  <teleport to="#root">
    <button
      v-if="showRecovery" ref="optionsButton" type="button" class="mini-recovery" data-mini-recovery :style="recoveryStyle"
      :title="$t('mini_player__options')" :aria-label="$t('mini_player__options')" :aria-expanded="optionsOpen" aria-controls="mini-options"
      @click="optionsOpen = !optionsOpen"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
    </button>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { miniPlayer, miniPlayerCover, nativePointer, playerActionFailed, setting } from '@lyric/store/state'
import { updateSetting } from '@lyric/store/action'
import { sendDesktopLyricInfo } from '@lyric/core/mainWindowChannel'
import { setWindowBounds, showMainWindow } from '@lyric/utils/ipc'
import { MINI_PLAYER_UNLOCK_BUTTON } from '@common/miniPlayer'

const root = ref<HTMLElement>()
const header = ref<HTMLElement>()
const headerBounds = ref<DOMRect | null>(null)
const updateHeaderBounds = () => { headerBounds.value = header.value?.getBoundingClientRect() ?? null }
const headerObserver = new ResizeObserver(updateHeaderBounds)
const showRecovery = computed(() => !setting['desktopLyric.isLock'] && (setting['desktopLyric.autoHideControls'] || !setting['desktopLyric.showPlayer']))
const recoveryStyle = Object.fromEntries(Object.entries(MINI_PLAYER_UNLOCK_BUTTON).map(([key, value]) => [key, `${value}px`]))
const nativeControlsHover = computed(() => {
  const point = nativePointer.value
  if (!point || setting['desktopLyric.isLock']) return false
  if (setting['desktopLyric.showPlayer']) return true
  const { top, right, width, height } = MINI_PLAYER_UNLOCK_BUTTON
  const x = window.innerWidth - right - width
  if (showRecovery.value && point.x >= x && point.x < x + width && point.y >= top && point.y < top + height) return true
  const bounds = headerBounds.value
  return !!bounds && point.x >= bounds.left && point.x < bounds.right && point.y >= bounds.top && point.y < bounds.bottom
})
const optionsButton = ref<HTMLButtonElement>()
const optionsOpen = ref(false)
const coverFailed = ref(false)
const seekPreview = ref<number | null>(null)
// Let Windows move the window directly, without queuing pointer events over IPC.
const nativeDrag = window.os === 'windows'
let seekId: string | null = null
let seeking = false
let drag: { id: number, x: number, y: number, width: number, height: number } | null = null
let opaqueBackground = setting['desktopLyric.style.backgroundOpacity'] || 92

watch(miniPlayerCover, () => { coverFailed.value = false })
watch(() => setting['desktopLyric.showPlayer'], () => { void nextTick(updateHeaderBounds) })
watch(optionsOpen, async open => {
  if (!open) return
  await nextTick()
  root.value?.querySelector<HTMLInputElement>('#mini-options input')?.focus()
})
watch(() => setting['desktopLyric.isLock'], locked => { if (locked) { drag = null; optionsOpen.value = false } })
watch(() => miniPlayer.id, () => { seekPreview.value = null })
const formatTime = (value: number) => {
  const seconds = Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
const command = (request: LX.DesktopLyric.PlayerRequest) => {
  playerActionFailed.value = false
  sendDesktopLyricInfo(request)
}
const beginSeek = () => { seeking = true; seekId = miniPlayer.id }
const previewSeek = (event: Event) => {
  if (!seeking) beginSeek()
  seekPreview.value = Number((event.target as HTMLInputElement).value)
}
const cancelSeek = () => { seeking = false; seekId = null; seekPreview.value = null }
const finishSeek = (event: Event) => {
  const id = seeking ? seekId : miniPlayer.id
  if (id) command({ action: 'player_seek', data: { id, time: Number((event.target as HTMLInputElement).value) } })
  cancelSeek()
}
const changeVolume = (event: Event) => { command({ action: 'player_volume', data: Number((event.target as HTMLInputElement).value) }) }
const setTransparent = (event: Event) => {
  if ((event.target as HTMLInputElement).checked) {
    opaqueBackground = setting['desktopLyric.style.backgroundOpacity'] || 92
    updateSetting({ 'desktopLyric.style.backgroundOpacity': 0 })
  } else updateSetting({ 'desktopLyric.style.backgroundOpacity': opaqueBackground })
}
const changeFont = (step: number) => { updateSetting({ 'desktopLyric.style.fontSize': Math.max(10, Math.min(80, setting['desktopLyric.style.fontSize'] + step)) }) }
const lyricTransparency = computed(() => Math.round(100 - setting['desktopLyric.style.opacity']))
const changeLyricTransparency = (event: Event) => {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  updateSetting({ 'desktopLyric.style.opacity': 100 - Math.max(0, Math.min(100, Math.round(value))) })
}
const closeOptions = (event: Event) => {
  optionsOpen.value = false
  // Restore keyboard navigation without leaving pointer-closed controls focused.
  if (event instanceof KeyboardEvent || (event instanceof MouseEvent && event.detail === 0)) optionsButton.value?.focus()
}
const lockWindow = () => { optionsOpen.value = false; updateSetting({ 'desktopLyric.isLock': true }) }
const dragWindow = (event: PointerEvent) => {
  if (nativeDrag || event.button !== 0 || setting['desktopLyric.isLock'] || (event.target as Element).closest('button, input')) return
  drag = { id: event.pointerId, x: event.screenX, y: event.screenY, width: window.innerWidth, height: window.innerHeight }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  event.preventDefault()
}
const moveWindow = (event: PointerEvent) => {
  if (!drag || drag.id !== event.pointerId) return
  const x = event.screenX - drag.x
  const y = event.screenY - drag.y
  drag.x = event.screenX
  drag.y = event.screenY
  setWindowBounds({ x, y, w: drag.width, h: drag.height })
}
const endDrag = () => { drag = null }
const outsideClick = (event: PointerEvent) => {
  if (optionsOpen.value && !(event.target as Element).closest('#mini-options') && !optionsButton.value?.contains(event.target as Node)) optionsOpen.value = false
}
onMounted(() => {
  updateHeaderBounds()
  if (header.value) headerObserver.observe(header.value)
  document.addEventListener('pointerdown', outsideClick)
  document.addEventListener('pointermove', moveWindow)
  document.addEventListener('pointerup', endDrag)
  document.addEventListener('pointercancel', endDrag)
  window.addEventListener('blur', endDrag)
})
onBeforeUnmount(() => {
  headerObserver.disconnect()
  document.removeEventListener('pointerdown', outsideClick)
  document.removeEventListener('pointermove', moveWindow)
  document.removeEventListener('pointerup', endDrag)
  document.removeEventListener('pointercancel', endDrag)
  window.removeEventListener('blur', endDrag)
})
</script>

<style lang="less">
.mini-player {
  flex: none;
  color: #f5f7fa;
  font-size: 13px;
  padding: 8px 16px 0;
  --mini-accent: var(--color-primary, #56cc9b);

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 30px;
    height: 30px;
    padding: 5px;
    border: 0;
    border-radius: 8px;
    color: inherit;
    background: transparent;
    cursor: pointer;
    transition: background-color .18s ease, color .18s ease;
    &:hover { background: rgba(255,255,255,.14); }
    &:focus-visible { outline: 2px solid var(--mini-accent); outline-offset: 1px; }
    &.active { color: var(--mini-accent); }
  }
  svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  input[type='range'] { min-width: 0; height: 16px; margin: 0; accent-color: var(--mini-accent); cursor: pointer; }
  input:focus-visible { outline: 2px solid var(--mini-accent); outline-offset: 2px; }
}
.mini-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 30px; cursor: move; }
.native-drag {
  .mini-header, .mini-track { -webkit-app-region: drag; user-select: none; }
  .mini-window-buttons, .mini-options, button, input { -webkit-app-region: no-drag; }
  &.auto-hide-controls .mini-header, &.lyrics-only .mini-header { -webkit-app-region: no-drag; }
}
#main:hover .native-drag:not(.lyrics-only) .mini-header,
#root:has(.mini-recovery:hover, .mini-recovery:focus-visible) .native-drag .mini-header,
.native-drag.native-controls-hover .mini-header,
.native-drag:has(.mini-controls :focus-visible) .mini-header,
.native-drag.options-open .mini-header,
.native-drag.lyrics-only .mini-header:hover { -webkit-app-region: drag; }
.mini-brand { font-size: 11px; font-weight: 700; letter-spacing: .08em; color: var(--mini-accent); white-space: nowrap; pointer-events: none; span { margin-left: 6px; font-weight: 400; letter-spacing: 0; color: rgba(255,255,255,.6); } }
.mini-window-buttons { display: flex; gap: 2px; }
.mini-track { display: flex; align-items: center; gap: 14px; min-width: 0; padding: 12px 0 8px; cursor: move; }
.mini-cover { width: 70px; height: 70px; flex: none; display: flex; align-items: center; justify-content: center; border-radius: 14px; overflow: hidden; background: rgba(255,255,255,.1); box-shadow: 0 6px 18px rgba(0, 0, 0, .35), inset 0 0 0 1px rgba(255,255,255,.12); img { width: 100%; height: 100%; object-fit: cover; } svg { width: 32px; height: 32px; opacity: .6; } }
.mini-track-info { min-width: 0; h1, p, small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } h1 { font-size: 18px; line-height: 1.4; font-weight: 650; margin: 0 0 5px; } p { font-size: 13px; line-height: 1.4; margin: 0; opacity: .75; } small { display: block; font-size: 11px; margin-top: 4px; opacity: .5; } }
.mini-progress > input { width: 100%; }
.mini-times { display: flex; justify-content: space-between; font-size: 10px; opacity: .55; font-variant-numeric: tabular-nums; line-height: 1.4; }
.mini-transport { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 3px 0 8px; }
.mini-song-buttons { display: flex; align-items: center; gap: 8px; .mini-play { width: 38px; height: 38px; border-radius: 50%; color: #111820; background-image: linear-gradient(rgba(255, 255, 255, .22), rgba(255, 255, 255, 0)), var(--mini-accent); background-color: var(--mini-accent); box-shadow: 0 4px 16px rgba(0, 0, 0, .3); transition: filter .18s ease, transform .18s ease; &:hover { filter: brightness(1.1); transform: scale(1.04); background: var(--mini-accent); } &:active { transform: scale(.96); } } }
.mini-volume { display: flex; align-items: center; gap: 5px; input { width: 66px; } }
.mini-controls { transition: opacity .18s ease; }
.auto-hide-controls, .lyrics-only { .mini-controls { opacity: 0; pointer-events: none; } }
#main:hover .mini-player:not(.lyrics-only) .mini-controls,
#root:has(.mini-recovery:hover, .mini-recovery:focus-visible) .mini-controls,
.native-controls-hover .mini-controls,
.mini-player:has(.mini-controls :focus-visible) .mini-controls,
.options-open .mini-controls,
.lyrics-only .mini-header:hover { opacity: 1; pointer-events: auto; }
.lyrics-only {
  padding: 0;
  // Only the header itself wakes the controls; hovering lyrics must not cover them.
  .mini-header { position: absolute; top: 8px; left: 12px; right: 12px; z-index: 3; padding: 0 6px; border-radius: 8px; background: rgba(17,22,30,.88); pointer-events: auto; }
}
.has-recovery .mini-header { margin-right: 28px; }
.lock .mini-controls { visibility: hidden; pointer-events: none !important; }
.mini-options { position: absolute; top: 44px; right: 10px; left: 10px; z-index: 5; max-height: calc(100% - 54px); overflow-y: auto; box-sizing: border-box; padding: 12px 16px; background: rgba(28, 34, 43, .92); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,.15); border-radius: 14px; box-shadow: 0 8px 28px rgba(0,0,0,.3); label { display: flex; align-items: center; gap: 10px; padding: 7px 0; cursor: pointer; input { margin: 0; accent-color: var(--mini-accent); } } p { font-size: 11px; line-height: 1.5; opacity: .6; margin: 5px 0 8px; } }
.mini-options-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
.mini-options::-webkit-scrollbar { width: 6px; }
.mini-options::-webkit-scrollbar-thumb { border-radius: 3px; background: rgba(255,255,255,.25); }
.mini-options::-webkit-scrollbar-track { background: transparent; }
.mini-options label.mini-opacity-control { flex-direction: column; align-items: stretch; gap: 8px; margin-top: 5px; padding: 12px 0 8px; border-top: 1px solid rgba(255,255,255,.1); }
.mini-opacity-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-variant-numeric: tabular-nums; }
.mini-opacity-tip { font-size: 11px; line-height: 1.5; opacity: .6; }
.mini-font-buttons { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 5px; border-top: 1px solid rgba(255,255,255,.1); span { font-size: 12px; } }
.mini-options-enter-active, .mini-options-leave-active { transition: opacity .16s ease, transform .16s ease; }
.mini-options-enter-from, .mini-options-leave-to { opacity: 0; transform: translateY(-5px); }
.mini-error { position: absolute; bottom: 4px; left: 12px; right: 12px; z-index: 5; background: #402626; padding: 8px; border-radius: 6px; }
@media (max-width: 340px) { .mini-player { padding-left: 12px; padding-right: 12px; } .mini-brand span { display: none; } .mini-track { gap: 10px; } .mini-volume input { width: 55px; } }
@media (max-height: 240px) { .mini-track { padding-top: 6px; padding-bottom: 4px; } .mini-cover { width: 48px; height: 48px; border-radius: 8px; } .mini-track-info small { display: none; } .mini-track-info h1 { font-size: 15px; margin-bottom: 2px; } .mini-transport { padding-bottom: 0; } }
@media (prefers-reduced-motion: reduce) { .mini-player *, .mini-options-enter-active, .mini-options-leave-active { transition: none !important; } }
</style>
