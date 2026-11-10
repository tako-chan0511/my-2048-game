import { describe, expect, it, vi } from 'vitest'
import {
  BOARD_SIZES, DEFAULT_SETTINGS, DEFAULT_SPECIAL, SPECIAL_VALUES, createGame, createSession,
  dismissSessionPopup, moveGame, moveSession, moveSessionWithResult, undoSession, sessionEndReason,
  isSpecialMove, movesUntilSpecial, slideBoard, spawnSpecialTile, drawBelow, validateSettings,
} from '../src/core/index.ts'

import { specialSettings, validDirection, step, advanceMoves } from './special-fixtures.ts'

describe('special spawn rules and deterministic random consumption', () => {
  it.each([1, 5, 100])('replaces exactly one spawn at every %i valid moves', interval => {
    let game = createGame(42, specialSettings(interval))
    const limit = interval === 100 ? 101 : 15
    for (let i = 1; i <= limit; i++) {
      const direction = validDirection(game), slid = slideBoard(game.position.board, direction, game.position.nextTileId)
      const sample = vi.fn(drawBelow), result = moveGame(game, direction, sample)
      expect(result.state.position.moveCount).toBe(i)
      expect(result.specialSpawned === true).toBe(i % interval === 0)
      if (i % interval === 0) expect(result.spawned!.tile.power).toBe(5)
      if (i % interval !== 0) expect([1, 2]).toContain(result.spawned!.tile.power)
      expect(result.state.position.board.filter(Boolean)).toHaveLength(slid.board.filter(Boolean).length + 1)
      expect(result.state.position.score).toBe(game.position.score + slid.scoreGain)
      expect(result.state.position.nextTileId).toBe(slid.nextTileId + 1)
      expect(sample.mock.calls.map(call => call[1])).toEqual(i % interval === 0 ? [slid.board.filter(t => t === null).length] : [slid.board.filter(t => t === null).length, 100])
      game = result.state
    }
  })
  it('does not consume RNG or advance the interval on an invalid move', () => {
    const initial = createGame(0, { ...specialSettings(1), size: 4 }), sample = vi.fn(drawBelow)
    const result = moveGame(initial, 'up', sample)
    expect(result.state).toBe(initial); expect(result.randomDraws).toBe(0); expect(sample).not.toHaveBeenCalled()
    expect(movesUntilSpecial(result.state.settings, result.state.position.moveCount)).toBe(1)
  })
  it('initial tiles use ordinary numbers and the same RNG even with interval 1', () => {
    const normal = createGame(13), special = createGame(13, { ...DEFAULT_SETTINGS, special: specialSettings(1).special })
    expect(special.position).toEqual(normal.position)
    expect(special.position.board.every(tile => !tile || tile.power <= 2)).toBe(true)
  })
  it.each([0, 10, 100])('OFF preserves the complete legacy sequence with 4 rate %i', spawn4Percent => {
    let normal = createGame(17, { ...DEFAULT_SETTINGS, size: 10, spawn4Percent })
    let off = createGame(17, { ...normal.settings, special: { ...DEFAULT_SPECIAL, interval: 1, value: 1024 } })
    for (let i = 0; i < 50; i++) {
      expect(off.position).toEqual(normal.position)
      const d = validDirection(normal), a = moveGame(normal, d), b = moveGame(off, d)
      expect(b.randomDraws).toBe(a.randomDraws); expect(b.specialSpawned).toBeUndefined()
      normal = a.state; off = b.state
    }
  })
  it('reproduces each position for identical seed, settings and inputs', () => {
    let a = createGame(7654, specialSettings(3, 128)), b = createGame(7654, specialSettings(3, 128))
    for (let i = 0; i < 35; i++) {
      const d = validDirection(a)
      a = moveGame(a, d).state; b = moveGame(b, d).state
      expect(a).toEqual(b)
    }
  })
  it('does not sample or allocate on a full board', () => {
    const board = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, power: 1 })), sample = vi.fn(drawBelow)
    const result = spawnSpecialTile(board, createGame(1).position.rng, 10, 32, sample)
    expect(result.spawned).toBeNull(); expect(result.nextTileId).toBe(10); expect(result.draws).toBe(0); expect(sample).not.toHaveBeenCalled()
  })
  it('special numbers merge normally and only the merge earns score', () => {
    const base = createGame(42, specialSettings(1)), board = Array<null | { id: number; power: number }>(100).fill(null)
    board[0] = { id: 1, power: 5 }; board[1] = { id: 2, power: 5 }
    const result = moveGame({ ...base, position: { ...base.position, board, nextTileId: 3 }, maxPowerEver: 5 }, 'left')
    expect(result.scoreGain).toBe(64n); expect(result.state.position.score).toBe(64n)
    expect(result.spawned!.tile.power).toBe(5)
    expect(result.state.position.board.filter(Boolean).map(t => t!.power).sort()).toEqual([5, 6])
  })
  it.each(BOARD_SIZES)('supports special spawn and Undo on size %i boards', size => {
    const initial = createSession(createGame(42, { ...specialSettings(1), size }))
    const moved = step(initial), undone = undoSession(moved)
    expect(moved.game.position.moveCount).toBe(1); expect(undone.game.position).toEqual(initial.game.position)
    expect(step(undone).game.position).toEqual(moved.game.position)
  })
  it.each(SPECIAL_VALUES)('accepts and spawns allowed value %i', value => {
    const settings = specialSettings(1, value)
    expect(validateSettings(settings).valid).toBe(true)
    const game = createGame(42, settings), result = moveGame(game, validDirection(game))
    expect(2 ** result.spawned!.tile.power).toBe(value)
  })
  it.each([0, 101, -1, 1.5, NaN, Infinity, '5', null])('rejects interval %j', interval => {
    expect(validateSettings({ ...specialSettings(), special: { ...specialSettings().special, interval } }).valid).toBe(false)
  })
  it.each([2, 4, 12, 2048, '32', null, NaN])('rejects value %j', value => {
    expect(validateSettings({ ...specialSettings(), special: { ...specialSettings().special, value } }).valid).toBe(false)
  })
  it.each([{ enabled: 'on' }, { replacement: 'extra' }, { extra: 1 }, { interval: undefined }])('rejects malformed special settings %j', patch => {
    expect(validateSettings({ ...specialSettings(), special: { ...specialSettings().special, ...patch } }).valid).toBe(false)
  })
  it.each([0, 1, 3, 4, 5, 9, 10, 15, 100])('computes countdown at move %i', count => {
    expect(isSpecialMove(specialSettings(), count)).toBe(count > 0 && count % 5 === 0)
    expect(movesUntilSpecial(specialSettings(), count)).toBe(5 - count % 5)
    expect(movesUntilSpecial(DEFAULT_SETTINGS, count)).toBeNull()
  })
})

describe('special spawns across Undo and mode boundaries', () => {
  it('Undo from move 5 restores move 4, RNG and tile IDs for the identical replay', () => {
    const before = advanceMoves(createSession(createGame(42, specialSettings())), 4), d = validDirection(before.game)
    const first = moveSessionWithResult(before, d), undone = undoSession(first.session), replay = moveSessionWithResult(undone, d)
    expect(first.move!.specialSpawned).toBe(true); expect(undone.game.position).toEqual(before.game.position)
    expect(undone.undoUsed).toBe(1); expect(replay.session.undoUsed).toBe(1)
    expect(replay.move!.spawned).toEqual(first.move!.spawned)
    expect(replay.session.game.position).toEqual(first.session.game.position)
  })
  it('a different branch after Undo uses the restored RNG and its own empty cells', () => {
    const before = advanceMoves(createSession(createGame(42, specialSettings())), 4), d = validDirection(before.game), other = validDirection(before.game, d)
    const undone = undoSession(moveSession(before, d)), result = moveSessionWithResult(undone, other), expected = moveGame(before.game, other)
    expect(result.move!.specialSpawned).toBe(true); expect(result.move!.spawned).toEqual(expected.spawned)
    expect(result.session.game.position).toEqual(expected.state.position)
  })
  it.each([1, 'unlimited'] as const)('retains Undo budget %s independently from move count', undoLimit => {
    let session = advanceMoves(createSession(createGame(42, { ...specialSettings(1), undoLimit })), 2)
    session = undoSession(session); session = step(session)
    const next = undoSession(session)
    expect(next.undoUsed).toBe(undoLimit === 1 ? 1 : 2)
    expect(next.game.position.moveCount).toBe(undoLimit === 1 ? 2 : 1)
  })
  it('continues after reaching the goal in normal mode', () => {
    const session = step(createSession(createGame(42, { ...specialSettings(1, 128), target: 128 })))
    expect(session.popup).toBe('goal')
    expect(step(dismissSessionPopup(session)).game.position.moveCount).toBe(2)
  })
  it('commits special spawn before move-limit termination and reproduces it after Undo', () => {
    const before = advanceMoves(createSession(createGame(42, { ...specialSettings(), mode: { kind: 'moves', limit: 5 } })), 4)
    const d = validDirection(before.game), result = moveSessionWithResult(before, d)
    expect(result.move!.specialSpawned).toBe(true); expect(sessionEndReason(result.session)).toBe('move-limit')
    expect(result.session.popup).toBe('game-over')
    const undone = undoSession(result.session)
    expect(sessionEndReason(undone)).toBeNull(); expect(movesUntilSpecial(undone.game.settings, undone.game.position.moveCount)).toBe(1)
    expect(moveSession(undone, d).game.position).toEqual(result.session.game.position)
  })
  it('keeps the existing goal-first popup when goal and move limit coincide', () => {
    const session = step(createSession(createGame(42, { ...specialSettings(1, 128), target: 128, mode: { kind: 'moves', limit: 1 } })))
    expect(session.popup).toBe('goal'); expect(sessionEndReason(session)).toBe('move-limit')
    expect(dismissSessionPopup(session).popup).toBe('game-over')
  })
  it('allows a goal from a special spawn just before expiry, but refuses it at the deadline', () => {
    const initial = createSession(createGame(42, { ...specialSettings(2, 128), target: 128, mode: { kind: 'timed', seconds: 10 } }))
    const first = step(initial, 1000), direction = validDirection(first.game)
    const goal = moveSessionWithResult(first, direction, 10999)
    expect(goal.move!.specialSpawned).toBe(true); expect(goal.session.popup).toBe('goal')
    expect(goal.session.clock.deadlineMs).toBe(11000)
    expect(dismissSessionPopup(goal.session, 11000).popup).toBe('game-over')
    const expired = moveSessionWithResult(first, direction, 11000)
    expect(expired.move).toBeNull(); expect(expired.session.game.position.moveCount).toBe(1)
    expect(expired.session.goalNotified).toBe(false)
  })
  it('starts the timer only on a valid move and preserves the deadline through special spawns and Undo', () => {
    const initial = createSession(createGame(0, { ...specialSettings(1), size: 4, mode: { kind: 'timed', seconds: 10 } }))
    expect(moveSession(initial, 'up', 500).clock.startedAtMs).toBeNull()
    const first = moveSessionWithResult(initial, 'left', 1000)
    expect(first.move!.specialSpawned).toBe(true); expect(first.session.clock.deadlineMs).toBe(11000)
    const undone = undoSession(first.session, undefined, 2000)
    expect(undone.clock.deadlineMs).toBe(11000)
    const beforeDeadline = moveSessionWithResult(undone, 'left', 10999)
    expect(beforeDeadline.move!.specialSpawned).toBe(true); expect(beforeDeadline.session.clock.deadlineMs).toBe(11000)
    const expired = moveSessionWithResult(undone, 'left', 11000)
    expect(expired.move).toBeNull(); expect(expired.session.game.position).toEqual(undone.game.position)
    expect(undoSession(first.session, undefined, 11000).game.position).toEqual(first.session.game.position)
  })
})
