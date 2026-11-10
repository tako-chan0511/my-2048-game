import type { Board, BoardSize, MoveResult, Tile } from '../core/index.ts'

// Ephemeral UI data only. Never part of the saved session or Undo snapshots.
export interface MovePresentation { readonly id: number; readonly before: Board; readonly result: MoveResult }
export interface VisualTile extends Tile {
  readonly from: number
  readonly to: number
  readonly special?: true
  readonly effect: 'move' | 'merge' | 'spawn' | 'still'
}
export interface TileAnimation {
  readonly id: number
  readonly sliding: readonly VisualTile[]
  readonly settled: readonly VisualTile[]
}
export const SLIDE_MS = 145
export const POP_MS = 120
export function buildTileAnimation(event: MovePresentation): TileAnimation | null {
  if (!event.result.changed) return null
  const sources = new Map(event.before.flatMap(tile => tile ? [[tile.id, tile] as const] : []))
  const merged = new Set(event.result.merges.map(merge => merge.tile.id))
  const sliding = event.result.motions.map(motion => ({
    ...sources.get(motion.sourceId)!, from: motion.from, to: motion.to, effect: 'move' as const,
  }))
  const settled = event.result.state.position.board.flatMap((tile, index): VisualTile[] => tile ? [{
    ...tile, from: index, to: index,
    ...(event.result.specialSpawned && tile.id === event.result.spawned?.tile.id ? { special: true as const } : {}),
    effect: merged.has(tile.id) ? 'merge' : tile.id === event.result.spawned?.tile.id ? 'spawn' : 'still',
  }] : [])
  return { id: event.id, sliding, settled }
}
export function tileCoordinates(tile: VisualTile, size: BoardSize) {
  const row = Math.floor(tile.to / size), col = tile.to % size
  const dx = tile.from % size - col, dy = Math.floor(tile.from / size) - row
  // Percentages are relative to the live grid; transform percentages are relative
  // to the tile. CSS uses the same gap/padding variables as the accessible grid.
  return {
    left: `calc(${col * 100 / size}% + ${col / size} * var(--board-gap))`,
    top: `calc(${row * 100 / size}% + ${row / size} * var(--board-gap))`,
    '--from-x': `calc(${dx * 100}% + ${dx} * var(--board-gap))`,
    '--from-y': `calc(${dy * 100}% + ${dy} * var(--board-gap))`,
  }
}
