import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS, EMPTY_CLOCK, createSession, createRandomState, canUndoSession, dismissSessionPopup, moveSession, observeSession, remainingMoves, remainingTimeMs,
  sessionEndReason, undoSession, validateSettings,
} from '../src/core/index.ts'
import { atGameOver, atGoal, sessionFor } from './session-fixtures.ts'
import { stateFor } from './fixtures.ts'
import { beforeGoal, timed } from './mode-fixtures.ts'

describe('three-mode runtime settings', () => {
  it.each([{ kind: 'normal' }, ...[10, 300, 3600].map(seconds => ({ kind: 'timed', seconds })), ...[1, 1000, 100000].map(limit => ({ kind: 'moves', limit }))])('accepts exact mode settings %j', mode => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, mode }).valid).toBe(true)
  })
  it.each([
    { kind: 'timed', seconds: 9 }, { kind: 'timed', seconds: 3601 }, { kind: 'timed', seconds: 10.5 }, { kind: 'timed', seconds: '10' },
    { kind: 'timed', seconds: NaN }, { kind: 'timed', seconds: Infinity }, { kind: 'timed' },
    { kind: 'moves', limit: 0 }, { kind: 'moves', limit: 100001 }, { kind: 'moves', limit: 1.5 }, { kind: 'moves', limit: '1' },
    { kind: 'moves', limit: NaN }, { kind: 'moves', limit: Infinity }, { kind: 'moves' },
    { kind: 'other' }, { kind: 'normal', seconds: 10 }, { kind: 'timed', seconds: 10, limit: 1 },
  ])('rejects malformed limits without substituting defaults %j', mode => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, mode }).valid).toBe(false)
  })
})

describe('deadline-based timed mode', () => {
  it('does not start for idle time or an invalid first move', () => {
    const initial = timed(), observed = observeSession(initial, 100000)
    expect(observed).toBe(initial); expect(remainingTimeMs(initial, 100000)).toBe(10000)
    const noOp = moveSession(initial, 'up', 200000)
    expect(noOp).toBe(initial); expect(noOp.clock).toBe(EMPTY_CLOCK)
    const first = moveSession(noOp, 'left', 250000)
    expect(first.clock).toEqual({ startedAtMs: 250000, deadlineMs: 260000, lastObservedAtMs: 250000 })
  })
  it('starts exactly once and never restarts when moving or Undoing back to zero', () => {
    const first = moveSession(timed(), 'left', 1000)
    const second = moveSession(first, 'down', 2000)
    expect(second.clock.startedAtMs).toBe(1000); expect(second.clock.deadlineMs).toBe(11000)
    const undone = undoSession(undoSession(second, undefined, 3000), undefined, 4000)
    expect(undone.game.position.moveCount).toBe(0); expect(undone.clock.deadlineMs).toBe(11000)
    const invalid = moveSession(undone, 'up', 5000)
    expect(invalid.game.position).toBe(undone.game.position); expect(invalid.history).toBe(undone.history)
    expect(invalid.clock.deadlineMs).toBe(11000); expect(remainingTimeMs(invalid)).toBe(6000)
    expect(moveSession(invalid, 'left', 6000).clock.deadlineMs).toBe(11000)
  })
  it.each([-1, 0, 1])('checks input at deadline %+i ms, before consuming RNG', offset => {
    const first = moveSession(timed(), 'left', 1000), next = moveSession(first, 'down', 11000 + offset)
    if (offset < 0) { expect(next.game.position.moveCount).toBe(2); expect(sessionEndReason(next)).toBeNull() }
    else {
      expect(next.game).toBe(first.game); expect(next.history).toBe(first.history)
      expect(next.game.position.rng).toBe(first.game.position.rng)
      expect(sessionEndReason(next)).toBe('time-expired'); expect(next.popup).toBe('game-over')
    }
  })
  it('forbids Undo at the deadline even without a prior timer tick', () => {
    const session = moveSession(timed(), 'left', 1000)
    expect(canUndoSession(session, undefined, 10999)).toBe(true)
    expect(canUndoSession(session, undefined, 11000)).toBe(false)
    const blocked = undoSession(session, undefined, 11000)
    expect(blocked.game).toBe(session.game); expect(blocked.undoUsed).toBe(0)
    expect(blocked.popup).toBe('game-over')
    expect(undoSession(session, 'move-limit', 11000).game).toBe(session.game)
  })
  it('calculates elapsed background/closed time without decrement counters', () => {
    const first = moveSession(timed(300), 'left', 1000)
    const later = observeSession(first, 121500)
    expect(remainingTimeMs(later)).toBe(179500); expect(later.clock.deadlineMs).toBe(301000)
    const expired = observeSession(later, 400000)
    expect(remainingTimeMs(expired)).toBe(0); expect(sessionEndReason(expired)).toBe('time-expired')
  })
  it('does not grant more time when wall time moves backwards', () => {
    const first = moveSession(timed(), 'left', 1000), later = observeSession(first, 5000)
    expect(remainingTimeMs(observeSession(later, 2000))).toBe(6000)
    const expired = observeSession(later, 11000)
    expect(sessionEndReason(observeSession(expired, 1000))).toBe('time-expired')
  })
  it('lets time expire during a stuck popup and disallows its Undo thereafter', () => {
    const base = atGameOver(), session = { ...base, game: { ...base.game, settings: { ...base.game.settings, mode: { kind: 'timed' as const, seconds: 10 } } }, clock: { startedAtMs: 0, deadlineMs: 10000, lastObservedAtMs: 9000 } }
    expect(sessionEndReason(session)).toBe('stuck'); expect(canUndoSession(session)).toBe(true)
    const expired = observeSession(session, 10000)
    expect(sessionEndReason(expired)).toBe('time-expired'); expect(canUndoSession(expired)).toBe(false)
    expect(expired.overNotifiedReason).toBe('time-expired')
    expect(dismissSessionPopup(expired, 10000).popup).toBeNull()
  })
  it('shows goal first if time expires while its notification is pending', () => {
    const fixture = beforeGoal({ kind: 'timed', seconds: 10 })
    const started = { ...fixture.session, clock: { startedAtMs: 0, deadlineMs: 10000, lastObservedAtMs: 9000 } }
    const goal = moveSession(started, fixture.direction, 9999)
    expect(goal.popup).toBe('goal'); expect(goal.goalNotified).toBe(true)
    const expired = observeSession(goal, 10000)
    expect(expired.popup).toBe('goal'); expect(sessionEndReason(expired)).toBe('time-expired')
    expect(dismissSessionPopup(expired, 10000).popup).toBe('game-over')
    expect(canUndoSession(dismissSessionPopup(expired, 10000))).toBe(false)
  })
  it('prioritizes time expiry after a simultaneous goal and stuck position', () => {
    const game = stateFor([1024, 1024, 2, 4, 2, 4, 8, 16, 4, 2, 4, 2, 2, 4, 2, 4], { rng: createRandomState(0) })
    const session = { ...createSession({ ...game, settings: { ...game.settings, mode: { kind: 'timed' as const, seconds: 10 } } }), clock: { startedAtMs: 0, deadlineMs: 10000, lastObservedAtMs: 9000 } }
    const goal = moveSession(session, 'left', 9999)
    expect(goal.popup).toBe('goal'); expect(sessionEndReason(goal)).toBe('stuck')
    const expired = observeSession(goal, 10000)
    expect(expired.popup).toBe('goal'); expect(sessionEndReason(expired)).toBe('time-expired')
    expect(canUndoSession(dismissSessionPopup(expired))).toBe(false)
  })
  it('never counts a would-be winning move received exactly at the deadline', () => {
    const fixture = beforeGoal({ kind: 'timed', seconds: 10 })
    const started = { ...fixture.session, clock: { startedAtMs: 0, deadlineMs: 10000, lastObservedAtMs: 9000 } }
    const rejected = moveSession(started, fixture.direction, 10000)
    expect(rejected.popup).toBe('game-over'); expect(rejected.goalNotified).toBe(false)
    expect(rejected.game).toBe(started.game)
  })
})

describe('move-limit and normal modes', () => {
  it('counts only changed moves, finalizes the last spawn and stops at equality', () => {
    const initial = sessionFor({ mode: { kind: 'moves', limit: 1 } })
    expect(moveSession(initial, 'up', 100)).toBe(initial); expect(remainingMoves(initial)).toBe(1)
    const last = moveSession(initial, 'left', 200)
    expect(last.game.position.moveCount).toBe(1); expect(last.game.position.board.filter(Boolean)).toHaveLength(2)
    expect(last.game.position.score).toBe(4n); expect(remainingMoves(last)).toBe(0)
    expect(sessionEndReason(last)).toBe('move-limit'); expect(last.popup).toBe('game-over')
    expect(moveSession(last, 'down', 300)).toBe(last)
    const closed = dismissSessionPopup(last)
    expect(moveSession(closed, 'down')).toBe(closed)
  })
  it('allows Undo from the limit and reproduces the same final move', () => {
    const first = moveSession(sessionFor({ mode: { kind: 'moves', limit: 1 } }), 'left')
    const undone = undoSession(first)
    expect(sessionEndReason(undone)).toBeNull(); expect(remainingMoves(undone)).toBe(1)
    expect(undone.undoUsed).toBe(1)
    const replay = moveSession(undone, 'left')
    expect(replay.game.position).toEqual(first.game.position); expect(replay.popup).toBe('game-over')
  })
  it('shows goal then move-limit when both happen on the same move', () => {
    const goal = atGoal(), limit = goal.game.position.moveCount, fixture = beforeGoal({ kind: 'moves', limit })
    const won = moveSession(fixture.session, fixture.direction)
    expect(won.popup).toBe('goal'); expect(sessionEndReason(won)).toBe('move-limit')
    const ended = dismissSessionPopup(won)
    expect(ended.popup).toBe('game-over'); expect(canUndoSession(ended)).toBe(true)
    const undone = undoSession(ended)
    expect(undone.goalNotified).toBe(true); expect(remainingMoves(undone)).toBe(1)
    expect(moveSession(undone, fixture.direction).popup).toBe('game-over')
  })
  it('keeps normal mode independent of time and move limits', () => {
    const session = moveSession(sessionFor(), 'left', 1000)
    expect(observeSession(session, 8000000000000000)).toBe(session)
    expect(remainingTimeMs(session)).toBeNull(); expect(remainingMoves(session)).toBeNull()
    expect(canUndoSession(session)).toBe(true)
  })
})
