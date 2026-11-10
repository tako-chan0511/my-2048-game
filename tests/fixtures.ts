import { createGame, type Board, type Direction, type GameState, type Position } from '../src/core/index.ts'
export function tiles(numbers: readonly number[]): Board {
  return numbers.map((value, index) => value === 0 ? null : { id: index + 1, power: Math.log2(value) })
}
export function values(board: Board): number[] { return board.map(tile => tile ? 2 ** tile.power : 0) }
export const empty = () => tiles(Array<number>(16).fill(0))
export function stateFor(numbers: readonly number[], position: Partial<Position> = {}, metadata: Partial<GameState> = {}): GameState {
  const base = createGame(0), board = tiles(numbers)
  return { ...base, maxPowerEver: Math.max(0, ...board.map(tile => tile?.power ?? 0)),
    position: { ...base.position, board, score: 0n, moveCount: 0, nextTileId: 17, ...position }, ...metadata }
}
export const locked = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2]
export const directions: readonly Direction[] = ['left', 'right', 'up', 'down']
// Independent stack oracle: mark each output once merged. Grid transforms put
// each direction into the same orientation; production uses indexed line scans.
export function referenceSlide(input: readonly number[], direction: Direction) {
  let grid = Array.from({ length: 4 }, (_, row) => input.slice(row * 4, row * 4 + 4))
  const vertical = direction === 'up' || direction === 'down'
  const reverse = direction === 'right' || direction === 'down'
  const transpose = (matrix: number[][]) => matrix[0]!.map((_, column) => matrix.map(row => row[column]!))
  if (vertical) grid = transpose(grid)
  if (reverse) grid = grid.map(row => [...row].reverse())
  let score = 0n
  grid = grid.map(row => {
    const stack: { value: number; merged: boolean }[] = []
    for (const value of row.filter(Boolean)) {
      const last = stack.at(-1)
      if (last && last.value === value && !last.merged) {
        last.value *= 2; last.merged = true; score += BigInt(last.value)
      } else stack.push({ value, merged: false })
    }
    return [...stack.map(item => item.value), ...Array<number>(4 - stack.length).fill(0)]
  })
  if (reverse) grid = grid.map(row => [...row].reverse())
  if (vertical) grid = transpose(grid)
  return { values: grid.flat(), score }
}
export function generatedBoards(count: number): number[][] {
  let state = 18273645
  return Array.from({ length: count }, () => Array.from({ length: 16 }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const power = state % 6
    return power === 0 ? 0 : 2 ** power
  }))
}
