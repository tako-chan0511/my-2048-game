import { describe, expect, it } from 'vitest'
import {
  BOARD_SIZES, DEFAULT_SETTINGS, DEFAULT_SPECIAL, TIME_VALUES, createGame, createSession, moveSession, moveSessionWithResult,
  undoSession, dismissSessionPopup, editSessionTile, canUseSpecialTime, sessionEndReason, validateSettings,
  type PlaySession, type TimeValue,
} from '../src/core/index.ts'
import { advanceMoves, step, validDirection } from './special-fixtures.ts'
import { charged, emptyIndex, timeSettings } from './special-time-fixtures.ts'

describe('special time acquisition and non-rewindable budgets', () => {
  it.each([1, 10, 100])('earns on every %i valid moves', interval => {
    let session = createSession(createGame(42, timeSettings({ interval })))
    for (let i = 1; i <= interval + 1; i++) {
      session = step(session)
      expect(session.specialTime!.processedEvents).toBe(Math.floor(i / interval))
      expect(session.specialTime!.charges).toBe(Math.min(3, Math.floor(i / interval)))
    }
  })
  it('does not award or consume RNG on an invalid move', () => {
    const initial = createSession(createGame(0, timeSettings({ interval: 1 }, { size: 4 })))
    expect(moveSession(initial, 'up')).toBe(initial)
    expect(initial.specialTime!.charges).toBe(0)
  })
  it('records capped events and does not issue missed charges retroactively', () => {
    const capped = charged(5, { interval: 1, maxCharges: 2 })
    expect(capped.specialTime).toEqual({ charges: 2, processedEvents: 5, granted: 2, used: 0 })
    const edited = editSessionTile(capped, emptyIndex(capped), 128)
    expect(edited.specialTime).toEqual({ charges: 1, processedEvents: 5, granted: 2, used: 1 })
    expect(step(edited).specialTime).toEqual({ charges: 2, processedEvents: 6, granted: 3, used: 1 })
  })
  it('Undo 10→9→10 cannot acquire twice; the next new event at 20 still awards', () => {
    const at10 = charged(), d = validDirection(at10.history.length ? { ...at10.game, position: at10.history.at(-1)! } : at10.game)
    const at9 = undoSession(at10)
    expect(at9.game.position.moveCount).toBe(9); expect(at9.specialTime).toEqual(at10.specialTime)
    const replay = moveSession(at9, d)
    expect(replay.game.position.moveCount).toBe(10); expect(replay.specialTime!.charges).toBe(1)
    expect(advanceMoves(replay, 10).specialTime!.charges).toBe(2)
  })
  it('a capped event remains processed after Undo even after a charge becomes available', () => {
    const capped = charged(3, { interval: 1, maxCharges: 1 }), undone = undoSession(capped)
    expect(undone.specialTime).toEqual(capped.specialTime)
    const edited = editSessionTile(undone, emptyIndex(undone), 128)
    const replay = step(edited)
    expect(replay.game.position.moveCount).toBe(3); expect(replay.specialTime!.charges).toBe(0)
    expect(step(replay).specialTime!.charges).toBe(1)
  })
  it.each([0, 1, 10, 'unlimited'] as const)('edits preserve Undo budget %s and clear all prior history', undoLimit => {
    const before = charged(10, {}, { undoLimit }), edited = editSessionTile(before, emptyIndex(before), 128)
    expect(edited.undoUsed).toBe(before.undoUsed); expect(edited.history).toHaveLength(0)
    expect(undoSession(edited)).toBe(edited)
    const next = step(edited), undone = undoSession(next)
    if (undoLimit === 0) expect(undone.game.position).toEqual(next.game.position)
    else { expect(undone.game.position).toEqual(edited.game.position); expect(undone.specialTime).toEqual(next.specialTime) }
  })
  it('uses 32→128, then a normal-move Undo restores the edited tile and consumed charge', () => {
    const before = charged(10, {}, { special: { ...DEFAULT_SPECIAL, enabled: true } })
    const index = before.game.position.board.findIndex(t => t?.power === 5)
    expect(index).toBeGreaterThanOrEqual(0)
    const edited = editSessionTile(before, index, 128), after = step(edited), undone = undoSession(after)
    expect(edited.game.position.board[index]!.power).toBe(7)
    expect(undone.game.position).toEqual(edited.game.position)
    expect(undone.specialTime!.used).toBe(1); expect(undone.specialTime!.charges).toBe(0)
    expect(undoSession(undone)).toBe(undone)
  })
  it('special tile generation and special time award occur together without affecting each other', () => {
    const before = charged(9, {}, { special: { ...DEFAULT_SPECIAL, enabled: true } })
    const result = moveSessionWithResult(before, validDirection(before.game))
    expect(result.move!.specialSpawned).toBe(true); expect(result.move!.spawned!.tile.power).toBe(5)
    expect(result.session.specialTime!.charges).toBe(1)
    const edited = editSessionTile(result.session, emptyIndex(result.session), 128)
    expect(edited.game.position.moveCount).toBe(10)
    const at15 = advanceMoves(edited, 4), next = moveSessionWithResult(at15, validDirection(at15.game))
    expect(next.move!.specialSpawned).toBe(true)
  })
})

describe('atomic one-cell editing and normal tile behavior', () => {
  it.each(TIME_VALUES)('edits an empty cell to %i without RNG, score, moves or extra spawn', value => {
    const before = charged(), index = emptyIndex(before), result = editSessionTile(before, index, value)
    const a = before.game.position, b = result.game.position
    expect(b.board.filter(Boolean)).toHaveLength(a.board.filter(Boolean).length + 1)
    expect(b.board[index]).toEqual({ id: a.nextTileId, power: Math.log2(value) })
    expect(b.rng).toBe(a.rng); expect(b.score).toBe(a.score); expect(b.moveCount).toBe(a.moveCount)
    expect(b.nextTileId).toBe(a.nextTileId + 1)
    expect(b.board.filter((tile, i) => JSON.stringify(tile) !== JSON.stringify(a.board[i]))).toHaveLength(1)
    expect(result.specialTime!.charges).toBe(0)
  })
  it('reuses an occupied tile ID and records negative mass/potential for a decrease', () => {
    const before = charged(10, {}, { special: { ...DEFAULT_SPECIAL, enabled: true, value: 1024 } })
    const index = before.game.position.board.findIndex(t => t?.power === 10), old = before.game.position.board[index]!
    const result = editSessionTile(before, index, 2)
    expect(result.game.position.board[index]).toEqual({ id: old.id, power: 1 })
    expect(result.game.position.nextTileId).toBe(before.game.position.nextTileId)
    expect(result.game.editEffects!.massDelta).toBe(-1022n)
    expect(result.game.position.score).toBe(before.game.position.score)
  })
  it('same value, invalid index/value, OFF and zero balance are no-ops', () => {
    const before = charged(), index = before.game.position.board.findIndex(Boolean), value = 2 ** before.game.position.board[index]!.power as TimeValue
    expect(editSessionTile(before, index, value)).toBe(before)
    for (const i of [-1, 100, 1.5, NaN]) expect(editSessionTile(before, i, 128)).toBe(before)
    expect(editSessionTile(before, emptyIndex(before), 512 as TimeValue)).toBe(before)
    const off = createSession(createGame(42)), zero = createSession(createGame(42, timeSettings()))
    expect(editSessionTile(off, emptyIndex(off), 128)).toBe(off); expect(editSessionTile(zero, emptyIndex(zero), 128)).toBe(zero)
  })
  it('a repeated confirmation cannot consume a second charge', () => {
    const before = charged(20), index = emptyIndex(before), once = editSessionTile(before, index, 128)
    expect(once.specialTime!.charges).toBe(1); expect(editSessionTile(once, index, 128)).toBe(once)
  })
  it('rejects values excluded from the applied allowed-number rule', () => {
    const before = charged(1, { interval: 1, values: [2, 4] })
    expect(editSessionTile(before, emptyIndex(before), 128)).toBe(before)
  })
  it('edited values merge normally and only a subsequent merge earns points', () => {
    let session = charged(2, { interval: 1 })
    session = editSessionTile(session, 0, 128); session = editSessionTile(session, 1, 128)
    const score = session.game.position.score, next = moveSession(session, 'left')
    expect(next.game.position.score).toBeGreaterThanOrEqual(score + 256n)
    expect(next.game.position.board[0]!.power).toBe(8)
  })
  it.each(BOARD_SIZES)('edits and resumes on size %i', size => {
    const before = charged(1, { interval: 1 }, { size })
    const edited = editSessionTile(before, emptyIndex(before), 128)
    expect(edited.game.position.board).toHaveLength(size * size)
    expect(step(edited).game.position.moveCount).toBe(2)
  })
})

describe('special time mode and goal boundaries', () => {
  it('reaches the goal via edit and keeps the existing continue rule', () => {
    const before = charged(1, { interval: 1 }, { target: 128 }), edited = editSessionTile(before, emptyIndex(before), 128)
    expect(edited.popup).toBe('goal'); expect(edited.goalNotified).toBe(true)
    expect(canUseSpecialTime(edited)).toBe(false)
    expect(step(dismissSessionPopup(edited)).game.position.moveCount).toBe(2)
  })
  it('repairs a real stuck game through the game-over popup and resumes input', () => {
    let session = createSession(createGame(0, timeSettings({ interval: 1 }, { size: 3 })))
    for (let i = 0; i < 500 && !sessionEndReason(session); i++) session = moveSession(session, (['left', 'up', 'right', 'down'] as const)[i % 4]!)
    expect(sessionEndReason(session)).toBe('stuck'); expect(canUseSpecialTime(session)).toBe(true)
    const value = 2 ** session.game.position.board[1]!.power as TimeValue
    expect(TIME_VALUES).toContain(value)
    const repaired = editSessionTile(session, 0, value)
    expect(repaired.popup).toBeNull(); expect(sessionEndReason(repaired)).toBeNull()
    expect(moveSession(repaired, 'left').game.position.moveCount).toBe(session.game.position.moveCount + 1)
  })
  it('reevaluates game over after filling the last empty cell', () => {
    const base = charged(1, { interval: 1 }, { size: 3 })
    const board = [1, 2, 1, 2, 1, 2, 1, 2, 0].map((power, i) => power ? { id: i + 1, power } : null)
    const fixture: PlaySession = { ...base, game: { ...base.game, position: { ...base.game.position, board, nextTileId: 10 }, maxPowerEver: 2 } }
    const ended = editSessionTile(fixture, 8, 2)
    expect(sessionEndReason(ended)).toBe('stuck'); expect(ended.popup).toBe('game-over')
  })
  it('permits edits before the deadline and forbids them at and after it', () => {
    const before = charged(1, { interval: 1 }, { mode: { kind: 'timed', seconds: 10 } }), index = emptyIndex(before)
    const valid = editSessionTile(before, index, 128, 10999)
    expect(valid.specialTime!.used).toBe(1); expect(valid.clock.deadlineMs).toBe(11000)
    for (const now of [11000, 11001]) {
      const expired = editSessionTile(before, index, 128, now)
      expect(expired.game).toBe(before.game); expect(expired.specialTime).toBe(before.specialTime); expect(expired.popup).toBe('game-over')
      expect(undoSession(before, undefined, now).game).toBe(before.game)
    }
  })
  it('awards at the move limit but refuses editing until an allowed Undo reopens play', () => {
    const ended = charged(10, {}, { mode: { kind: 'moves', limit: 10 } })
    expect(ended.specialTime!.charges).toBe(1); expect(canUseSpecialTime(ended)).toBe(false)
    expect(editSessionTile(ended, emptyIndex(ended), 128)).toBe(ended)
    const resumed = undoSession(ended)
    expect(canUseSpecialTime(resumed)).toBe(true)
    const edited = editSessionTile(resumed, emptyIndex(resumed), 128)
    expect(edited.game.position.moveCount).toBe(9)
    const replay = step(edited)
    expect(replay.specialTime!.charges).toBe(0); expect(sessionEndReason(replay)).toBe('move-limit')
  })
})

describe('special time settings validation and legacy compatibility', () => {
  it.each([0, 101, -1, 1.5, NaN, '10', null])('rejects interval %j', interval => {
    expect(validateSettings({ ...timeSettings(), specialTime: { ...timeSettings().specialTime, interval } }).valid).toBe(false)
  })
  it.each([0, 11, 1.5, NaN, '3', null])('rejects maxCharges %j', maxCharges => {
    expect(validateSettings({ ...timeSettings(), specialTime: { ...timeSettings().specialTime, maxCharges } }).valid).toBe(false)
  })
  it.each([[], [2, 2], [3], [512], ['2'], null, Array(1), [2, 4, 8, 16, 32, 64, 128, 256, 512]])('rejects invalid allowed values %j', values => {
    expect(validateSettings({ ...timeSettings(), specialTime: { ...timeSettings().specialTime, values } }).valid).toBe(false)
  })
  it('canonicalizes a valid subset and freezes the rule', () => {
    const game = createGame(42, timeSettings({ values: [128, 2] }))
    expect(game.settings.specialTime!.values).toEqual([2, 128]); expect(Object.isFrozen(game.settings.specialTime!.values)).toBe(true)
  })
  it('OFF is identical in positions and RNG to the previous engine', () => {
    let a = createSession(createGame(42, { ...DEFAULT_SETTINGS, size: 10 }))
    let b = createSession(createGame(42, timeSettings({ enabled: false, interval: 1, values: [256] }, { target: 2048 })))
    for (let i = 0; i < 30; i++) {
      expect(b.game.position).toEqual(a.game.position); expect(b.specialTime).toBeUndefined()
      const direction = validDirection(a.game); a = moveSession(a, direction); b = moveSession(b, direction)
    }
  })
})
