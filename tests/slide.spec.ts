import { describe, expect, it } from 'vitest'
import { boardTotal, slideBoard, slideLine, slideSelectedTile, type Board } from '../src/core/index.ts'
import { directions, generatedBoards, referenceSlide, tiles, values } from './fixtures.ts'
describe('line merges', () => {
  it.each([
    { input: [2, 2, 2, 2], output: [4, 4, 0, 0], score: 8n },
    { input: [4, 4, 8, 0], output: [8, 8, 0, 0], score: 8n },
    { input: [2, 2, 4, 0], output: [4, 4, 0, 0], score: 4n },
    { input: [2, 0, 2, 2], output: [4, 2, 0, 0], score: 4n },
    { input: [4, 0, 0, 0], output: [4, 0, 0, 0], score: 0n },
    { input: [0, 0, 0, 0], output: [0, 0, 0, 0], score: 0n },
    { input: [2, 2, 2, 0], output: [4, 2, 0, 0], score: 4n },
    { input: [0, 4, 4, 4], output: [8, 4, 0, 0], score: 8n },
    { input: [8, 4, 4, 8], output: [8, 8, 8, 0], score: 8n },
  ])('$input → $output; score $score', ({ input, output, score }) => {
    const original = tiles(input), before = structuredClone(original)
    const result = slideLine(original, 5)
    expect(values(result.board)).toEqual(output); expect(result.scoreGain).toBe(score)
    expect(original).toEqual(before)
    expect(result.changed).toBe(input.some((value, index) => value !== output[index]))
    expect(result.nextTileId).toBe(5 + result.merges.length)
  })
  it('gives each merged tile a fresh unique ID and uses each source only once', () => {
    const result = slideLine(tiles([2, 2, 2, 2]), 5)
    expect(result.board.map(tile => tile?.id ?? 0)).toEqual([5, 6, 0, 0])
    expect(result.merges.map(merge => merge.sourceIds)).toEqual([[1, 2], [3, 4]])
    expect(result.motions.map(motion => motion.sourceId).sort()).toEqual([1, 2, 3, 4])
    expect(result.motions.map(motion => motion.to)).toEqual([0, 0, 1, 1])
    expect(Object.isFrozen(result.motions[0])).toBe(true)
  })
  it('preserves the ID of a tile that only slides', () => {
    const result = slideLine(tiles([0, 0, 4, 0]), 5)
    expect(result.board[0]?.id).toBe(3); expect(result.nextTileId).toBe(5)
  })
  it('does not lose bigint score precision beyond Number.MAX_SAFE_INTEGER', () => {
    const board: Board = [{ id: 1, power: 53 }, { id: 2, power: 53 }, null, null]
    const result = slideLine(board, 3)
    expect(result.scoreGain).toBe(1n << 54n); expect(result.board[0]?.power).toBe(54)
  })
  it('returns the original board and empty events for no change', () => {
    const board = tiles([4, 2, 0, 0]), result = slideLine(board, 5)
    expect(result.board).toBe(board); expect(result.changed).toBe(false)
    expect(result.motions).toEqual([]); expect(result.merges).toEqual([]); expect(result.scoreGain).toBe(0n)
  })
  it.each([tiles([2, 0]), tiles([2, ...Array<number>(10).fill(0)]), Array(4), [{ id: 1, power: 1 }, { id: 1, power: 1 }, null, null]].map(board => ({ board })))('rejects malformed lines %#', ({ board }) => {
    expect(() => slideLine(board as Board, 10)).toThrow(RangeError)
  })
})
describe('board directions', () => {
  const input = [0, 0, 0, 0, 0, 2, 2, 0, 0, 4, 4, 0, 0, 0, 0, 0]
  it.each(directions)('slides and merges %s using an independent grid oracle', direction => {
    const expected = referenceSlide(input, direction), result = slideBoard(tiles(input), direction, 17)
    expect(values(result.board)).toEqual(expected.values); expect(result.scoreGain).toBe(expected.score)
    expect(result.changed).toBe(true)
  })
  it.each(directions)('merges a line of four twos towards %s exactly twice', direction => {
    const numbers = Array<number>(16).fill(0)
    const indices = direction === 'up' || direction === 'down' ? [1, 5, 9, 13] : [4, 5, 6, 7]
    indices.forEach(index => { numbers[index] = 2 })
    const result = slideBoard(tiles(numbers), direction, 17)
    expect(values(result.board)).toEqual(referenceSlide(numbers, direction).values)
    expect(result.scoreGain).toBe(8n); expect(result.merges).toHaveLength(2)
  })
  it.each(generatedBoards(64).map((numbers, seed) => ({ seed, numbers })))('matches reference movement, score, and mass on generated board $seed', ({ numbers }) => {
    const board = tiles(numbers), before = structuredClone(board)
    for (const direction of directions) {
      const expected = referenceSlide(numbers, direction), result = slideBoard(board, direction, 17)
      expect(values(result.board)).toEqual(expected.values); expect(result.scoreGain).toBe(expected.score)
      expect(boardTotal(result.board)).toBe(boardTotal(board))
      const ids = result.board.flatMap(tile => tile ? [tile.id] : [])
      expect(new Set(ids).size).toBe(ids.length)
      const used = result.merges.flatMap(merge => [...merge.sourceIds])
      expect(new Set(used).size).toBe(used.length)
    }
    expect(board).toEqual(before)
  })
  it('owns and freezes changed output tiles instead of sharing mutable caller objects', () => {
    const board = tiles([0, 2, ...Array<number>(14).fill(0)])
    const result = slideBoard(board, 'left', 17)
    expect(result.board[0]).not.toBe(board[1]); expect(Object.isFrozen(result.board[0])).toBe(true)
    expect(Object.isFrozen(result.board)).toBe(true)
  })
})
describe('selected tile movement', () => {
  it('moves only the selected tile until a different tile blocks it', () => {
    const board = tiles([2, 0, 4, ...Array<number>(13).fill(0)])
    const result = slideSelectedTile(board, 'right', 0, 17)
    expect(values(result.board).slice(0, 4)).toEqual([0, 2, 4, 0])
    expect(result.motions).toEqual([{ sourceId: 1, from: 0, to: 1, resultId: 1 }])
    expect(result.changed).toBe(true)
  })
  it('merges the selected tile with the first matching blocker and does not chain-merge', () => {
    const board = tiles([2, 2, 2, 4, ...Array<number>(12).fill(0)])
    const result = slideSelectedTile(board, 'right', 1, 17)
    expect(values(result.board).slice(0, 4)).toEqual([2, 0, 4, 4])
    expect(result.scoreGain).toBe(4n)
    expect(result.nextTileId).toBe(18)
    expect(result.merges.map(merge => merge.sourceIds)).toEqual([[2, 3]])
    expect(result.motions.map(motion => motion.sourceId)).toEqual([2, 3])
  })
  it('slides a tile through empty cells to the board edge without moving other tiles', () => {
    const board = tiles([0, 0, 0, 0, 0, 2, 0, 0, 4, ...Array<number>(7).fill(0)])
    const result = slideSelectedTile(board, 'up', 5, 17)
    expect(values(result.board).slice(0, 13)).toEqual([0, 2, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0])
  })
  it('keeps state and movement events unchanged when blocked or selecting an empty cell', () => {
    const blocked = tiles([2, 4, 0, 0, ...Array<number>(12).fill(0)])
    const noMove = slideSelectedTile(blocked, 'right', 0, 17)
    expect(noMove.board).toBe(blocked); expect(noMove.changed).toBe(false); expect(noMove.motions).toEqual([])
    const empty = slideSelectedTile(blocked, 'left', 2, 17)
    expect(empty.board).toBe(blocked); expect(empty.changed).toBe(false)
  })
  it('rejects an invalid selected cell', () => {
    expect(() => slideSelectedTile(tiles(Array<number>(16).fill(0)), 'left', 16, 1)).toThrow(RangeError)
  })
})
