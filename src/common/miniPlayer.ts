// Share the recovery button's geometry with the native click-through region.
export const MINI_PLAYER_UNLOCK_BUTTON = { top: 8, right: 4, width: 30, height: 30 } as const

export type MiniPlayerPointer = { x: number, y: number } | null

export type MiniPlayerEdge = 'left' | 'right' | 'top' | null
export const MINI_PLAYER_EDGE_STRIP = 6
export const MINI_PLAYER_EDGE_ANIMATION_MS = 240
export interface MiniPlayerEdgeMotion {
  edge: MiniPlayerEdge
  phase: 'shown' | 'hiding' | 'hidden' | 'showing'
  duration: number
}
