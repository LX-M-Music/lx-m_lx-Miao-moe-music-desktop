declare namespace LX {
  namespace MiniPlayer {
    type Config = Pick<LX.AppSetting,
    'miniPlayer.enable' | 'miniPlayer.showBorder' | 'miniPlayer.autoHideControls' | 'miniPlayer.isLock' |
    'miniPlayer.isAlwaysOnTop' | 'miniPlayer.isAlwaysOnTopLoop' | 'miniPlayer.isShowTaskbar' |
    'miniPlayer.fullscreenHide' | 'miniPlayer.width' | 'miniPlayer.height' | 'miniPlayer.x' | 'miniPlayer.y' |
    'miniPlayer.isLockScreen' | 'miniPlayer.backgroundOpacity' | 'common.langId' | 'ui.lowPowerMode'>
    interface State {
      id: string | null
      name: string
      singer: string
      album: string
      isPlay: boolean
      position: number
      duration: number
      volume: number
      isMute: boolean
    }
    type Request = { action: 'get_player_state' | 'player_toggle_play' | 'player_prev' | 'player_next' | 'player_mute' }
    | { action: 'player_seek', data: { id: string, time: number } }
    | { action: 'player_volume', data: number }
    type Message = { action: 'set_player_state', data: State }
    | { action: 'set_player_cover', data: { id: string | null, url: string } }
    | { action: 'player_action_failed' }
    interface NewBounds { x: number, y: number, w: number, h: number }
  }
}
