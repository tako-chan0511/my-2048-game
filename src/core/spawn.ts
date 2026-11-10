import type { Board, RandomDraw, RandomSampler, RngState, SpawnResult } from './types.ts'
import { allocateTile, copyBoard, increment } from './board.ts'
import { drawBelow, getRandomState } from './random.ts'
import { assertBoard, assertNextTileId, assertProbability, assertRng, integer } from './validation.ts'
function validDraw(draw: RandomDraw, bound: number) {
  if (!integer(draw.value, 0, bound - 1) || !integer(draw.draws, 1, Number.MAX_SAFE_INTEGER)) throw new RangeError('Invalid random sample')
  assertRng(draw.rng)
}
export function spawnTile(board: Board, rng: RngState, nextTileId: number, spawn4Percent = 10, sample: RandomSampler = drawBelow): SpawnResult {
  assertBoard(board); assertRng(rng); assertNextTileId(board, nextTileId); assertProbability(spawn4Percent)
  const empty: number[] = []
  board.forEach((tile, index) => { if (tile === null) empty.push(index) })
  if (!empty.length) return Object.freeze({ board, rng, nextTileId, spawned: null, draws: 0 })
  // Allocation is validated before asking the sampler to draw anything.
  const nextId = increment(nextTileId)
  const cell = sample(rng, empty.length); validDraw(cell, empty.length)
  const value = sample(cell.rng, 100); validDraw(value, 100)
  const tile = allocateTile(nextTileId, value.value < 100 - spawn4Percent ? 1 : 2)
  const index = empty[cell.value]!, output = [...board]; output[index] = tile
  return Object.freeze({ board: copyBoard(output), rng: getRandomState(value.rng), nextTileId: nextId, spawned: Object.freeze({ index, tile }), draws: cell.draws + value.draws })
}
