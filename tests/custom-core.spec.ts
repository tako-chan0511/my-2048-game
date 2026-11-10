import { describe, expect, it, vi } from 'vitest'
import { BOARD_SIZES, DEFAULT_SETTINGS, TARGETS, boardSize, boardTotal, createGame, hasReachedTarget, isGameOver, moveGame, slideBoard, slideLine, theoreticalMaxTile, tileValue, validateSettings, type Board, type BoardSize, type GameSettings } from '../src/core/index.ts'
import { checkerboard, customState, reference, settingsFor } from './custom-fixtures.ts'
import { directions, tiles, values } from './fixtures.ts'

describe('N×N movement', () => {
  it.each(BOARD_SIZES.flatMap(size => directions.map(direction => ({ size, direction }))))('$size×$size merges towards $direction exactly once per source', ({ size, direction }) => {
    const numbers = Array<number>(size * size).fill(0)
    const indices = Array.from({ length: size }, (_, i) => direction === 'up' || direction === 'down' ? i * size + 1 : size + i)
    indices.forEach(index => { numbers[index] = 2 })
    const board = tiles(numbers), before = structuredClone(board)
    const result = slideBoard(board, direction, size * size + 1), expected = reference(numbers, size, direction)
    expect(values(result.board)).toEqual(expected.values); expect(result.scoreGain).toBe(expected.score)
    expect(result.scoreGain).toBe(BigInt(Math.floor(size / 2) * 4))
    expect(result.merges).toHaveLength(Math.floor(size / 2))
    expect(boardTotal(result.board)).toBe(boardTotal(board)); expect(board).toEqual(before)
    const ids = result.merges.flatMap(merge => [...merge.sourceIds]); expect(new Set(ids).size).toBe(ids.length)
  })
  it.each(BOARD_SIZES)('handles a line of length %i including odd unmerged tiles', size => {
    const result = slideLine(tiles(Array<number>(size).fill(2)), size + 1)
    expect(values(result.board)).toEqual([...Array<number>(Math.floor(size / 2)).fill(4), ...(size % 2 ? [2] : []), ...Array<number>(Math.floor(size / 2)).fill(0)])
    expect(result.scoreGain).toBe(BigInt(Math.floor(size / 2) * 4))
  })
  it.each(BOARD_SIZES)('matches an independent oracle for 16 fixed %i×%i boards in all directions', size => {
    let seed = 9127301
    for (let test = 0; test < 16; test++) {
      const numbers = Array.from({ length: size * size }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const power = seed % 6; return power ? 2 ** power : 0 })
      const board = tiles(numbers)
      for (const direction of directions) {
        const result = slideBoard(board, direction, size * size + 1), expected = reference(numbers, size, direction)
        expect(values(result.board)).toEqual(expected.values); expect(result.scoreGain).toBe(expected.score)
        expect(boardTotal(result.board)).toBe(boardTotal(board))
        const ids = result.board.flatMap(tile => tile ? [tile.id] : []); expect(new Set(ids).size).toBe(ids.length)
      }
    }
  })
  it.each(BOARD_SIZES)('locks a checkerboard of size %i without row wrapping or diagonal merges', size => {
    const board = tiles(checkerboard(size)), state = customState(size, checkerboard(size)), sample = vi.fn()
    expect(boardSize(board)).toBe(size); expect(isGameOver(board)).toBe(true)
    for (const direction of directions) expect(moveGame(state, direction, sample).state).toBe(state)
    expect(sample).not.toHaveBeenCalled()
  })
  it.each(BOARD_SIZES)('keeps a size %i board playable with a space or an adjacent pair at the last boundary', size => {
    const numbers = checkerboard(size); numbers[numbers.length - 1] = 0
    expect(isGameOver(tiles(numbers))).toBe(false)
    numbers[numbers.length - 1] = numbers[numbers.length - 2]!
    expect(isGameOver(tiles(numbers))).toBe(false)
    const column = checkerboard(size); column[column.length - 1] = column[column.length - 1 - size]!
    expect(isGameOver(tiles(column))).toBe(false)
  })
  it.each(BOARD_SIZES)('does not change RNG, score or IDs on an ineffective size %i move', size => {
    const numbers = Array<number>(size * size).fill(0); numbers[0] = 2
    const state = customState(size, numbers), sample = vi.fn()
    for (const direction of ['left', 'up'] as const) {
      const result = moveGame(state, direction, sample)
      expect(result.state).toBe(state); expect(result.randomDraws).toBe(0); expect(result.spawned).toBeNull()
    }
    expect(sample).not.toHaveBeenCalled()
  })
  it('rejects a GameState whose dimensions contradict its applied settings', () => {
    const state = createGame(0), sample = vi.fn()
    expect(() => moveGame({ ...state, settings: settingsFor(3) }, 'left', sample)).toThrow(RangeError)
    expect(sample).not.toHaveBeenCalled()
  })
  it.each([8, 10, 15, 17, 101, 121])('rejects malformed board length %i', length => {
    expect(() => boardSize(Array<null>(length).fill(null))).toThrow(RangeError)
  })
  it('rejects a sparse 10×10 board and duplicate IDs', () => {
    expect(() => slideBoard(Array(100) as Board, 'left', 101)).toThrow(RangeError)
    const board = [...createGame(0, settingsFor(10)).position.board]; board[0] = { id: 999, power: 1 }; board[1] = { id: 999, power: 1 }
    expect(() => slideBoard(board, 'left', 1000)).toThrow(RangeError)
  })
})

describe('initial tiles, probabilities and reproducibility', () => {
  it.each(BOARD_SIZES.flatMap(size => [1, size * size].flatMap(initialTiles => [0, 10, 100].map(spawn4Percent => ({ size, initialTiles, spawn4Percent })))) )('places $initialTiles distinct tiles on $size×$size at $spawn4Percent%', ({ size, initialTiles, spawn4Percent }) => {
    const settings = settingsFor(size, { initialTiles, spawn4Percent }), state = createGame(0, settings)
    expect(state.position.board).toHaveLength(size * size)
    const occupied = state.position.board.flatMap(tile => tile ? [tile] : [])
    expect(occupied).toHaveLength(initialTiles); expect(new Set(occupied.map(tile => tile.id)).size).toBe(initialTiles)
    expect(state.position.nextTileId).toBe(initialTiles + 1)
    expect(state.position.moveCount).toBe(0); expect(state.position.score).toBe(0n)
    if (spawn4Percent === 0) expect(occupied.every(tile => tile.power === 1)).toBe(true)
    if (spawn4Percent === 100) expect(occupied.every(tile => tile.power === 2)).toBe(true)
    expect(createGame(0, settings)).toEqual(state)
  })
  it.each(BOARD_SIZES)('replays full move/RNG sequences on size %i for four seeds', size => {
    for (const seed of [0, 1, 42, 0xffffffff]) {
      let a = createGame(seed, settingsFor(size)), b = createGame(seed, settingsFor(size))
      for (let i = 0; i < 40; i++) {
        const direction = directions[(i * 7 + Math.floor(i / 4)) % 4]!, result = moveGame(a, direction), replay = moveGame(b, direction)
        expect(result).toEqual(replay)
        expect(boardTotal(result.state.position.board) - boardTotal(a.position.board)).toBe(result.spawned ? tileValue(result.spawned.tile) : 0n)
        expect(result.state.position.moveCount).toBe(a.position.moveCount + Number(result.changed))
        a = result.state; b = replay.state
      }
    }
  })
  it.each([0, 10, 100])('keeps the two-draw spawn protocol at probability %i', spawn4Percent => {
    const states = BOARD_SIZES.map(size => createGame(0, settingsFor(size, { initialTiles: 1, spawn4Percent })))
    for (const state of states) expect(state.position.rng.state).toBe(3663131626)
  })
  it('can genuinely start locked with a fully populated fixed-seed 3×3 game', () => {
    const state = createGame(6, settingsFor(3, { initialTiles: 9, spawn4Percent: 50 }))
    expect(values(state.position.board)).toEqual([4, 2, 4, 2, 4, 2, 4, 2, 4])
    expect(isGameOver(state.position.board)).toBe(true)
  })
  it.each(TARGETS)('reaches target %i, emits the achievement once and allows continuation', target => {
    const numbers = [target / 2, target / 2, ...Array<number>(14).fill(0)]
    const state = customState(4, numbers, target)
    expect(hasReachedTarget(state)).toBe(false)
    const first = moveGame(state, 'left')
    expect(first.justReachedTarget).toBe(true); expect(hasReachedTarget(first.state)).toBe(true)
    expect(first.scoreGain).toBe(BigInt(target))
    const second = moveGame(first.state, 'down')
    expect(second.changed).toBe(true); expect(second.justReachedTarget).toBe(false)
    expect(hasReachedTarget(second.state)).toBe(true)
  })
})

describe('runtime settings validation and proven upper bound', () => {
  it.each([
    { size: 2 }, { size: 11 }, { size: 3.5 }, { size: '4' }, { size: NaN }, { size: Infinity },
    { target: 127 }, { target: 129 }, { target: 1000 }, { target: 131072 }, { target: '2048' },
    { initialTiles: 0 }, { initialTiles: 17 }, { initialTiles: -1 }, { initialTiles: 2.5 }, { initialTiles: '' },
    { spawn4Percent: -1 }, { spawn4Percent: 101 }, { spawn4Percent: 10.5 }, { spawn4Percent: NaN }, { spawn4Percent: '' },
    { undoLimit: 11 }, { mode: { kind: 'timed', seconds: 9 } }, { unexpected: true },
  ])('rejects malformed values without coercion %j', patch => {
    const raw = { ...DEFAULT_SETTINGS, ...patch }, result = validateSettings(raw)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.issues.length).toBeGreaterThan(0)
    expect(() => createGame(0, raw as GameSettings)).toThrow(RangeError)
  })
  it.each([null, {}, [], true])('rejects malformed settings object %j', raw => { expect(validateSettings(raw).valid).toBe(false) })
  it.each(BOARD_SIZES)('rejects more than size %i squared initial tiles', size => {
    const result = validateSettings(settingsFor(size, { initialTiles: size * size + 1 }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.issues.some(issue => issue.field === 'initialTiles')).toBe(true)
  })
  it.each([
    { size: 3, percent: 0, maximum: 512n }, { size: 3, percent: 1, maximum: 1024n },
    { size: 3, percent: 100, maximum: 1024n }, { size: 4, percent: 0, maximum: 65536n },
    { size: 10, percent: 100, maximum: 1n << 101n },
  ])('computes only a conservative upper bound for $size×$size, $percent%', ({ size, percent, maximum }) => {
    expect(theoreticalMaxTile(settingsFor(size as BoardSize, { spawn4Percent: percent }))).toBe(maximum)
  })
  it.each([{ spawn4Percent: 0, target: 1024 as const }, { spawn4Percent: 10, target: 2048 as const }])('warns for proven impossible 3×3 goals without modifying or forbidding the settings %j', patch => {
    const settings = settingsFor(3, patch), before = structuredClone(settings), result = validateSettings(settings)
    expect(result.valid).toBe(true)
    if (result.valid) { expect(result.settings).toEqual(before); expect(result.warnings.join('')).toContain('到達できません') }
    expect(createGame(0, settings).settings).toEqual(before)
  })
  it.each([{ size: 3, percent: 0, target: 512 }, { size: 3, percent: 100, target: 1024 }, { size: 4, percent: 0, target: 65536 }])('does not forbid an unproven difficult combination %j', ({ size, percent, target }) => {
    const result = validateSettings({ ...DEFAULT_SETTINGS, size, spawn4Percent: percent, target })
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.warnings).toEqual([])
  })
  it('explains initial deadlocks as a risk without guaranteeing that full boards fail', () => {
    const result = validateSettings(settingsFor(3, { initialTiles: 9, spawn4Percent: 50, target: 128 }))
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.warnings.join('')).toContain('開始直後に手詰まり')
    expect(isGameOver(createGame(0, settingsFor(3, { initialTiles: 9, spawn4Percent: 0 })).position.board)).toBe(false)
  })
})
