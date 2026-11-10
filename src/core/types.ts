export type BoardSize = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
export type Direction = 'up' | 'right' | 'down' | 'left'
export type Target = 128 | 256 | 512 | 1024 | 2048 | 4096 | 8192 | 16384 | 32768 | 65536
export type UndoLimit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 'unlimited'
export type GameMode = { readonly kind: 'normal' } | { readonly kind: 'timed'; readonly seconds: number } | { readonly kind: 'moves'; readonly limit: number }
export const SPECIAL_VALUES = Object.freeze([8, 16, 32, 64, 128, 256, 512, 1024] as const)
export type SpecialValue = typeof SPECIAL_VALUES[number]
export interface SpecialSettings {
  readonly enabled: boolean
  readonly interval: number
  readonly value: SpecialValue
  readonly replacement: 'replace'
}
export const DEFAULT_SPECIAL: SpecialSettings = Object.freeze({ enabled: false, interval: 5, value: 32, replacement: 'replace' })
export interface GameSettings {
  readonly size: BoardSize
  readonly target: Target
  readonly initialTiles: number
  readonly spawn4Percent: number
  readonly undoLimit: UndoLimit
  readonly special?: SpecialSettings
  readonly mode: GameMode
}
export interface Tile { readonly id: number; readonly power: number }
export type Board = readonly (Tile | null)[]
export interface RngState { readonly algorithm: 'mulberry32-v1'; readonly state: number }
export interface Position {
  readonly board: Board
  readonly score: bigint
  readonly moveCount: number
  readonly rng: RngState
  readonly nextTileId: number
}
// Position is the rollback unit. Session metadata, budgets and future clocks
// live outside it and are never rewound by Undo.
export interface GameState {
  readonly rulesVersion: '2048-v1'
  readonly initialSeed: number
  readonly settings: GameSettings
  readonly position: Position
  readonly maxPowerEver: number
  readonly revision: number
}
export interface RandomDraw { readonly value: number; readonly rng: RngState; readonly draws: number }
export type Uint32Source = (rng: RngState) => { readonly value: number; readonly rng: RngState }
export type RandomSampler = (rng: RngState, bound: number) => RandomDraw
export interface TileMotion { readonly sourceId: number; readonly from: number; readonly to: number; readonly resultId: number }
export interface MergeEvent { readonly sourceIds: readonly [number, number]; readonly tile: Tile; readonly at: number }
export interface SlideResult {
  readonly board: Board
  readonly scoreGain: bigint
  readonly changed: boolean
  readonly nextTileId: number
  readonly motions: readonly TileMotion[]
  readonly merges: readonly MergeEvent[]
}
export interface SpawnedTile { readonly index: number; readonly tile: Tile }
export interface SpawnResult {
  readonly board: Board
  readonly rng: RngState
  readonly nextTileId: number
  readonly spawned: SpawnedTile | null
  readonly draws: number
}
export interface MoveResult {
  readonly state: GameState
  readonly changed: boolean
  readonly scoreGain: bigint
  readonly spawned: SpawnedTile | null
  readonly motions: readonly TileMotion[]
  readonly merges: readonly MergeEvent[]
  readonly justReachedTarget: boolean
  readonly randomDraws: number
  readonly specialSpawned?: true
}
export const RULES_VERSION = '2048-v1' as const
export const DEFAULT_SETTINGS: GameSettings = Object.freeze({
  size: 4, target: 2048, initialTiles: 2, spawn4Percent: 10,
  undoLimit: 10, mode: Object.freeze({ kind: 'normal' as const }),
})

export const BOARD_SIZES = Object.freeze([3, 4, 5, 6, 7, 8, 9, 10] as const)
export const TARGETS = Object.freeze([128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536] as const)
export interface SettingsDraft {
  size: number | string
  target: number | string
  initialTiles: number | string
  spawn4Percent: number | string
  undoLimit: number | string
  specialEnabled?: boolean
  specialInterval?: number | string
  specialValue?: number | string
  modeKind?: string
  timeSeconds?: number | string
  moveLimit?: number | string
}
export interface SettingsIssue { readonly field: keyof GameSettings | 'settings' | 'timeSeconds' | 'moveLimit' | 'specialEnabled' | 'specialInterval' | 'specialValue'; readonly message: string }
export type SettingsValidation =
  | { readonly valid: true; readonly settings: GameSettings; readonly warnings: readonly string[] }
  | { readonly valid: false; readonly issues: readonly SettingsIssue[] }
