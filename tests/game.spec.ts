import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, boardTotal, createGame, createRandomState, gameStatus, hasReachedTarget, isGameOver, moveGame, nextUint32, tileValue, type GameSettings, type RandomSampler } from '../src/core/index.ts'
import { directions, locked, stateFor, tiles, values } from './fixtures.ts'
const zeroSample: RandomSampler = rng => ({ value: 0, rng: nextUint32(rng).rng, draws: 1 })
describe('new game', () => {
  it('starts at 4×4, 2048, two tiles, 90/10 spawn, normal and future Undo default ten', () => {
    expect(DEFAULT_SETTINGS).toEqual({ size: 4, target: 2048, initialTiles: 2, spawn4Percent: 10, undoLimit: 10, mode: { kind: 'normal' } })
    const state = createGame(0)
    expect(state.position.board).toHaveLength(16); expect(state.position.board.filter(Boolean)).toHaveLength(2)
    expect(state.position.score).toBe(0n); expect(state.position.moveCount).toBe(0)
    expect(gameStatus(state)).toBe('playing'); expect(hasReachedTarget(state)).toBe(false)
  })
  it('matches the fixed seed-zero initial-board/RNG protocol', () => {
    const state = createGame(0)
    expect(values(state.position.board)).toEqual([0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(state.position.rng).toEqual(createRandomState(3031295956))
    expect(state.position.nextTileId).toBe(3)
  })
  it.each([0, 1, 42, 123456789, 0xffffffff])('reproduces a complete initial state for seed %i', seed => {
    expect(createGame(seed)).toEqual(createGame(seed))
    const board = createGame(seed).position.board
    expect(new Set(board.flatMap(tile => tile ? [tile.id] : [])).size).toBe(2)
    expect(board.every(tile => tile === null || [1, 2].includes(tile.power))).toBe(true)
  })
  it('clones settings and freezes all state-owned structures', () => {
    const settings: GameSettings = { ...DEFAULT_SETTINGS, mode: { kind: 'normal' } }, state = createGame(3, settings)
    expect(state.settings).not.toBe(settings); expect(state.settings.mode).not.toBe(settings.mode)
    for (const object of [state, state.position, state.position.board, state.position.rng, state.settings, state.settings.mode, ...state.position.board.filter(Boolean)]) expect(Object.isFrozen(object)).toBe(true)
  })
  it.each([
    { size: 2 }, { size: 11 }, { target: 1000 }, { initialTiles: 0 }, { initialTiles: 17 }, { initialTiles: 1.5 },
    { spawn4Percent: -1 }, { undoLimit: 11 }, { mode: { kind: 'timed', seconds: 9 } }, { mode: { kind: 'moves', limit: 0 } },
  ])('rejects unsupported or invalid settings %j', patch => {
    expect(() => createGame(1, { ...DEFAULT_SETTINGS, ...patch } as GameSettings)).toThrow(RangeError)
  })
})
describe('moves, scoring and replay', () => {
  it.each(directions)('moves %s and adds exactly one tile with one move counted', direction => {
    const numbers = Array<number>(16).fill(0); numbers[5] = 2
    const state = stateFor(numbers), result = moveGame(state, direction, zeroSample)
    expect(result.changed).toBe(true); expect(result.state.position.moveCount).toBe(1)
    expect(result.state.position.score).toBe(0n); expect(result.state.revision).toBe(1)
    expect(result.state.position.board.filter(Boolean)).toHaveLength(2)
    expect(result.spawned).not.toBeNull(); expect(result.randomDraws).toBe(2)
    expect(boardTotal(result.state.position.board) - boardTotal(state.position.board)).toBe(tileValue(result.spawned!.tile))
  })
  it('adds merge values as bigint and only one spawned tile', () => {
    const state = stateFor([2, 2, 2, 2, ...Array<number>(12).fill(0)], { score: 9007199254740996n, moveCount: 9 })
    const result = moveGame(state, 'left', zeroSample)
    expect(result.state.position.score).toBe(9007199254741004n)
    expect(result.state.position.moveCount).toBe(10); expect(result.scoreGain).toBe(8n)
    expect(result.state.position.board.filter(Boolean)).toHaveLength(3)
    expect(result.merges).toHaveLength(2); expect(result.spawned!.tile.id).toBe(19)
    expect(boardTotal(result.state.position.board)).toBe(10n)
  })
  it('leaves every state field, identity, IDs and RNG untouched on an invalid move', () => {
    const state = createGame(0), before = structuredClone(state), sample = vi.fn(zeroSample)
    const result = moveGame(state, 'up', sample)
    expect(result.changed).toBe(false); expect(result.state).toBe(state); expect(state).toEqual(before)
    expect(result.scoreGain).toBe(0n); expect(result.spawned).toBeNull(); expect(result.randomDraws).toBe(0)
    expect(result.justReachedTarget).toBe(false); expect(sample).not.toHaveBeenCalled()
  })
  it('restoring a saved Position reproduces board, score, IDs and RNG for a future Undo', () => {
    const initial = createGame(42), snapshot = structuredClone(initial.position)
    const first = moveGame(initial, 'left')
    const restored = { ...initial, position: snapshot }
    expect(moveGame(restored, 'left')).toEqual(first)
    expect(initial.position).toEqual(snapshot)
  })
  it.each([0, 1, 17, 42, 1234, 0xffffffff])('replays a long deterministic game for seed %i with mass and RNG invariants', seed => {
    let a = createGame(seed), b = createGame(seed)
    for (let i = 0; i < 160; i++) {
      const direction = directions[(i * 7 + Math.floor(i / 4)) % 4]!
      const old = a, result = moveGame(a, direction), replay = moveGame(b, direction)
      expect(result).toEqual(replay)
      expect(boardTotal(result.state.position.board) - boardTotal(old.position.board)).toBe(result.spawned ? tileValue(result.spawned.tile) : 0n)
      expect(result.state.position.moveCount).toBe(old.position.moveCount + Number(result.changed))
      expect(result.state.position.score).toBe(old.position.score + result.scoreGain)
      if (!result.changed) expect(result.state.position.rng).toBe(old.position.rng)
      a = result.state; b = replay.state
    }
  })
  it.each(['moveCount', 'revision'] as const)('rejects %s overflow before consuming RNG', field => {
    const initial = createGame(0), state = field === 'revision' ? { ...initial, revision: Number.MAX_SAFE_INTEGER } : { ...initial, position: { ...initial.position, moveCount: Number.MAX_SAFE_INTEGER } }
    const sample = vi.fn(zeroSample)
    expect(() => moveGame(state, 'left', sample)).toThrow(RangeError)
    expect(sample).not.toHaveBeenCalled()
  })
})
describe('target and game over', () => {
  it('reports the first 2048 merge and permits further moves', () => {
    const state = stateFor([1024, 1024, ...Array<number>(14).fill(0)])
    expect(hasReachedTarget(state)).toBe(false)
    const first = moveGame(state, 'left', zeroSample)
    expect(first.justReachedTarget).toBe(true); expect(hasReachedTarget(first.state)).toBe(true)
    const second = moveGame(first.state, 'down', zeroSample)
    expect(second.changed).toBe(true); expect(second.justReachedTarget).toBe(false); expect(hasReachedTarget(second.state)).toBe(true)
  })
  it('recognizes 4096 as already reaching the 2048 target', () => {
    expect(hasReachedTarget(stateFor([4096, ...Array<number>(15).fill(0)]))).toBe(true)
  })
  it('detects a full locked board and leaves it unchanged in every direction', () => {
    const state = stateFor(locked), sample = vi.fn(zeroSample)
    expect(isGameOver(state.position.board)).toBe(true); expect(gameStatus(state)).toBe('game-over')
    for (const direction of directions) expect(moveGame(state, direction, sample).state).toBe(state)
    expect(sample).not.toHaveBeenCalled()
  })
  it.each([0, 5, 15])('allows movement when cell %i is empty', index => {
    const board = [...tiles(locked)]; board[index] = null
    expect(isGameOver(board)).toBe(false)
  })
  it.each([{ a: 0, b: 1 }, { a: 0, b: 4 }, { a: 14, b: 15 }, { a: 11, b: 15 }])('allows full boards with an adjacent match $a / $b', ({ a, b }) => {
    const numbers = [...locked]; numbers[b] = numbers[a]!
    expect(isGameOver(tiles(numbers))).toBe(false)
  })
  it('does not treat row-end wraparound or diagonal matches as legal moves', () => {
    const numbers = Array.from({ length: 16 }, (_, i) => 2 ** (i + 1)); numbers[4] = numbers[3]!
    expect(isGameOver(tiles(numbers))).toBe(true)
    expect(isGameOver(tiles(locked))).toBe(true)
  })
  it('can reach target and game over on the same turn', () => {
    const state = stateFor([1024, 1024, 2, 4, 2, 4, 8, 16, 4, 2, 4, 2, 2, 4, 2, 4])
    const result = moveGame(state, 'left', zeroSample)
    expect(result.justReachedTarget).toBe(true); expect(hasReachedTarget(result.state)).toBe(true)
    expect(gameStatus(result.state)).toBe('game-over')
  })
  it('treats a synthetic empty board as having no possible move', () => {
    expect(isGameOver(tiles(Array<number>(16).fill(0)))).toBe(true)
  })
})
