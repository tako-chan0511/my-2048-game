import { DEFAULT_SETTINGS, createGame, type BoardSize, type Direction, type GameSettings, type GameState, type Target } from '../src/core/index.ts'
import { tiles } from './fixtures.ts'
export const settingsFor = (size: BoardSize, patch: Partial<GameSettings> = {}): GameSettings => ({ ...DEFAULT_SETTINGS, size, ...patch })
export function customState(size: BoardSize, numbers: readonly number[], target: Target = 2048): GameState {
  const base = createGame(0, settingsFor(size, { target })), board = tiles(numbers)
  return { ...base, position: { ...base.position, board, nextTileId: size * size + 1 }, maxPowerEver: Math.max(0, ...board.map(tile => tile?.power ?? 0)) }
}
export function checkerboard(size: BoardSize): number[] {
  return Array.from({ length: size * size }, (_, index) => (Math.floor(index / size) + index % size) % 2 ? 4 : 2)
}
// Independent orientation transforms and a merged-flag stack, instead of the
// engine's directional index traversal and pairwise input scan.
export function reference(input: readonly number[], size: number, direction: Direction) {
  let grid = Array.from({ length: size }, (_, row) => input.slice(row * size, (row + 1) * size))
  const vertical = direction === 'up' || direction === 'down', reverse = direction === 'right' || direction === 'down'
  const transpose = (matrix: number[][]) => matrix[0]!.map((_, col) => matrix.map(row => row[col]!))
  if (vertical) grid = transpose(grid)
  if (reverse) grid = grid.map(row => [...row].reverse())
  let score = 0n
  grid = grid.map(row => {
    const stack: { value: number; merged: boolean }[] = []
    for (const value of row.filter(Boolean)) {
      const previous = stack.at(-1)
      if (previous && previous.value === value && !previous.merged) { previous.value *= 2; previous.merged = true; score += BigInt(previous.value) }
      else stack.push({ value, merged: false })
    }
    return [...stack.map(entry => entry.value), ...Array<number>(size - stack.length).fill(0)]
  })
  if (reverse) grid = grid.map(row => [...row].reverse())
  if (vertical) grid = transpose(grid)
  return { values: grid.flat(), score }
}
