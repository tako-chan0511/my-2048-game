import { describe, expect, it, vi } from 'vitest'
import { boardTotal, createRandomState, nextUint32, spawnTile, tileValue, type RandomSampler, type RngState } from '../src/core/index.ts'
import { empty, locked, tiles } from './fixtures.ts'
function sampler(cell: number, coin: number): RandomSampler {
  let calls = 0
  return rng => ({ value: calls++ === 0 ? cell : coin, rng: nextUint32(rng).rng, draws: 1 })
}
describe('tile spawning', () => {
  it.each([{ coin: 0, value: 2n }, { coin: 89, value: 2n }, { coin: 90, value: 4n }, { coin: 99, value: 4n }])('uses the exact 90/10 boundary: $coin → $value', ({ coin, value }) => {
    const result = spawnTile(empty(), createRandomState(0), 17, 10, sampler(0, coin))
    expect(tileValue(result.spawned!.tile)).toBe(value); expect(result.draws).toBe(2)
  })
  it('has 90 two slots and 10 four slots across the complete probability domain', () => {
    const count = { two: 0, four: 0 }
    for (let coin = 0; coin < 100; coin++) {
      const result = spawnTile(empty(), createRandomState(0), 17, 10, sampler(0, coin))
      count[result.spawned!.tile.power === 1 ? 'two' : 'four']++
    }
    expect(count).toEqual({ two: 90, four: 10 })
  })
  it.each([0, 100])('keeps the same draw protocol even with four probability %i%%', percent => {
    const result = spawnTile(empty(), createRandomState(0), 17, percent, sampler(0, percent === 0 ? 99 : 0))
    expect(result.spawned!.tile.power).toBe(percent === 0 ? 1 : 2)
    expect(result.draws).toBe(2); expect(result.rng.state).toBe(3663131626)
  })
  it.each([0, 1, 2])('maps empty-cell rank %i in row-major order without overwriting tiles', rank => {
    const board = tiles(locked); const mutable = [...board]
    for (const index of [2, 7, 15]) mutable[index] = null
    const before = structuredClone(mutable), result = spawnTile(mutable, createRandomState(0), 17, 10, sampler(rank, 0))
    expect(result.spawned!.index).toBe([2, 7, 15][rank]); expect(result.spawned!.tile.id).toBe(17)
    expect(result.board.filter(Boolean)).toHaveLength(14); expect(result.nextTileId).toBe(18)
    expect(boardTotal(result.board) - boardTotal(mutable)).toBe(2n); expect(mutable).toEqual(before)
  })
  it('consumes both draws even when there is just one empty cell', () => {
    const board = [...tiles(locked)]; board[9] = null
    const sample = vi.fn(sampler(0, 99)), result = spawnTile(board, createRandomState(0), 17, 10, sample)
    expect(sample.mock.calls.map(call => call[1])).toEqual([1, 100])
    expect(result.draws).toBe(2); expect(result.spawned!.index).toBe(9)
    expect(result.board.filter(Boolean)).toHaveLength(16)
  })
  it('does not consume RNG or allocate IDs on a full board', () => {
    const board = tiles(locked), rng = createRandomState(0), sample = vi.fn(sampler(0, 0))
    const result = spawnTile(board, rng, 17, 10, sample)
    expect(sample).not.toHaveBeenCalled(); expect(result).toEqual({ board, rng, nextTileId: 17, spawned: null, draws: 0 })
    expect(result.board).toBe(board); expect(result.rng).toBe(rng)
  })
  it('includes rejection draws in consumption metadata', () => {
    const result = spawnTile(empty(), createRandomState(0), 17, 10, rng => ({ value: 0, rng: nextUint32(rng).rng, draws: 3 }))
    expect(result.draws).toBe(6)
  })
  it.each([-1, 101, 0.5, NaN])('rejects invalid probability %s before sampling', percent => {
    const sample = vi.fn(sampler(0, 0))
    expect(() => spawnTile(empty(), createRandomState(0), 17, percent, sample)).toThrow(RangeError)
    expect(sample).not.toHaveBeenCalled()
  })
  it.each([-1, 16, 0.5, NaN])('rejects invalid sampler cell %s', cell => {
    expect(() => spawnTile(empty(), createRandomState(0), 17, 10, sampler(cell, 0))).toThrow(RangeError)
  })
  it('rejects an invalid coin sample without changing board or RNG', () => {
    const board = empty(), rng = createRandomState(0), before = structuredClone(board)
    expect(() => spawnTile(board, rng, 17, 10, sampler(0, 100))).toThrow(RangeError)
    expect(board).toEqual(before); expect(rng.state).toBe(0)
  })
  it('rejects malformed RNG from a sampler', () => {
    expect(() => spawnTile(empty(), createRandomState(0), 17, 10, () => ({ value: 0, draws: 1, rng: { algorithm: 'bad', state: 0 } as unknown as RngState }))).toThrow(RangeError)
  })
  it('rejects ID exhaustion before sampling', () => {
    const sample = vi.fn(sampler(0, 0))
    expect(() => spawnTile(empty(), createRandomState(0), Number.MAX_SAFE_INTEGER, 10, sample)).toThrow(RangeError)
    expect(sample).not.toHaveBeenCalled()
  })
})
