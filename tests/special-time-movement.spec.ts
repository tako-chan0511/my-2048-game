import { describe, expect, it } from 'vitest'
import { BOARD_SIZES, moveSpecialTimeTile, slideSelectedTile, undoSession, type PlaySession, type Direction } from '../src/core/index.ts'
import { decodeGame, encodeGame } from '../src/services/gameCodec.ts'
import { charged } from './special-time-fixtures.ts'
import { step } from './special-fixtures.ts'
function action(s: PlaySession, merge = false) {
  for (let index = 0; index < s.game.position.board.length; index++) for (const direction of ['left', 'right', 'up', 'down'] as const) {
    const result = slideSelectedTile(s.game.position.board, direction, index, s.game.position.nextTileId)
    if (result.changed && (!merge || result.merges.length)) return { index, direction, result }
  }
  throw new Error('No candidate')
}
describe('special time individual movement', () => {
  it.each(BOARD_SIZES)('moves just one tile on size %i and roundtrips the saved state', size => {
    const s = charged(1, { interval: 1 }, { size }), a = action(s), next = moveSpecialTimeTile(s, a.index, a.direction)
    expect(next.game.position.board).toEqual(a.result.board)
    expect(next.game.position.moveCount).toBe(s.game.position.moveCount)
    expect(next.game.position.rng).toEqual(s.game.position.rng)
    expect(next.specialTime!.charges).toBe(s.specialTime!.charges - 1)
    expect(next.history).toHaveLength(0)
    expect(decodeGame(encodeGame(next)).session).toEqual(next)
  })
  it('scores a single merge and retains RNG and valid ID accounting', () => {
    const s = charged(), a = action(s, true), next = moveSpecialTimeTile(s, a.index, a.direction)
    expect(next.game.position.score).toBe(s.game.position.score + a.result.scoreGain)
    expect(next.game.position.nextTileId).toBe(a.result.nextTileId)
    expect(decodeGame(encodeGame(next)).session).toEqual(next)
  })
  it('does not spend on an empty cell or a blocked direction', () => {
    const s = charged()
    expect(moveSpecialTimeTile(s, s.game.position.board.indexOf(null), 'left')).toBe(s)
    for (let i = 0; i < s.game.position.board.length; i++) for (const d of ['left', 'right', 'up', 'down'] as Direction[]) {
      if (!slideSelectedTile(s.game.position.board, d, i, s.game.position.nextTileId).changed) expect(moveSpecialTimeTile(s, i, d)).toBe(s)
    }
  })
  it('cannot move without credits, and subsequent normal Undo preserves the special action', () => {
    const s = charged(1, { interval: 1 }), a = action(s), edited = moveSpecialTimeTile(s, a.index, a.direction)
    expect(moveSpecialTimeTile(edited, a.index, a.direction)).toBe(edited)
    const undone = undoSession(step(edited))
    expect(undone.game.position).toEqual(edited.game.position)
    expect(undone.specialTime!.used).toBe(1)
  })
  it('blocks at the timed deadline and move limit', () => {
    const timed = charged(1, { interval: 1 }, { mode: { kind: 'timed', seconds: 10 } }), a = action(timed)
    const ended = moveSpecialTimeTile(timed, a.index, a.direction, timed.clock.deadlineMs!)
    expect(ended.game).toBe(timed.game)
    const limited = charged(1, { interval: 1 }, { mode: { kind: 'moves', limit: 1 } })
    expect(moveSpecialTimeTile(limited, 0, 'left').game).toBe(limited.game)
  })
})
