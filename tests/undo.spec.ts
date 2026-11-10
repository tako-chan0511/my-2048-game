import { describe, expect, it } from 'vitest'
import { canUndoSession, dismissSessionPopup, hasReachedTarget, moveSession, sessionEndReason, undoRemaining, undoSession } from '../src/core/index.ts'
import { advance, atGameOver, atGoal, sessionFor } from './session-fixtures.ts'

describe('Undo session and monotonic metadata', () => {
  it.each([0, 1, 10, 'unlimited'] as const)('uses the configured total budget %s', limit => {
    let session = advance(sessionFor({ undoLimit: limit }), 24)
    const moves = session.game.position.moveCount
    let count = 0
    while (canUndoSession(session)) { session = undoSession(session); count++ }
    const expected = limit === 'unlimited' ? moves : Math.min(limit, moves)
    expect(count).toBe(expected); expect(session.undoUsed).toBe(expected)
    expect(session.game.position.moveCount).toBe(moves - expected)
    expect(undoSession(session)).toBe(session)
  })
  it('records only changed moves and keeps the exact original Position', () => {
    const initial = sessionFor(), noMove = moveSession(initial, 'up')
    expect(noMove).toBe(initial); expect(noMove.history).toEqual([])
    const moved = moveSession(initial, 'left')
    expect(moved.history).toHaveLength(1); expect(moved.history[0]).toBe(initial.game.position)
  })
  it('restores board, score, count, RNG and next tile ID exactly', () => {
    const before = advance(sessionFor(), 7), after = moveSession(before, 'left'), undone = undoSession(after)
    expect(after).not.toBe(before); expect(undone.game.position).toBe(before.game.position)
    expect(undone.undoUsed).toBe(1); expect(undone.game.revision).toBe(after.game.revision + 1)
    expect(undone.game.maxPowerEver).toBe(after.game.maxPowerEver)
  })
  it.each(['left', 'right', 'down'] as const)('reproduces the same spawned tile and IDs after Undo then %s', direction => {
    const original = sessionFor(), moved = moveSession(original, direction)
    const repeated = moveSession(undoSession(moved), direction)
    expect(repeated.game.position).toEqual(moved.game.position)
    expect(repeated.undoUsed).toBe(1); expect(repeated.game.revision).toBeGreaterThan(moved.game.revision)
  })
  it('never refunds Undo uses when replaying or undoing several times', () => {
    let session = advance(sessionFor({ undoLimit: 10 }), 20)
    for (let i = 1; i <= 10; i++) {
      session = undoSession(session); expect(session.undoUsed).toBe(i)
      expect(undoRemaining(session)).toBe(10 - i)
      if (i < 10) { session = moveSession(session, 'left'); expect(session.undoUsed).toBe(i) }
    }
    expect(canUndoSession(session)).toBe(false)
    const next = moveSession(session, 'right'); expect(next.history).toHaveLength(0)
  })
  it('keeps unlimited history beyond ten moves without silently pruning it', () => {
    const session = advance(sessionFor({ undoLimit: 'unlimited' }), 60)
    expect(session.history.length).toBeGreaterThan(10)
    expect(session.history).toHaveLength(session.game.position.moveCount)
    expect(undoRemaining(session)).toBe('unlimited')
  })
  it('bounds finite history by the remaining total budget', () => {
    const session = advance(sessionFor({ undoLimit: 1 }), 60)
    expect(session.history).toHaveLength(1)
    const undone = undoSession(session)
    expect(undone.history).toHaveLength(0); expect(undone.undoUsed).toBe(1)
    expect(moveSession(undone, 'left').history).toHaveLength(0)
  })
  it('keeps achieved and notified state after Undo, without celebrating again', () => {
    const goal = atGoal()
    expect(canUndoSession(goal)).toBe(false)
    const continued = dismissSessionPopup(goal), undone = undoSession(continued)
    expect(hasReachedTarget(undone.game)).toBe(true); expect(undone.goalNotified).toBe(true)
    expect(undone.game.maxPowerEver).toBe(goal.game.maxPowerEver)
    let next = undone
    for (const direction of ['left', 'up', 'right', 'down'] as const) next = moveSession(next, direction)
    expect(next.popup).not.toBe('goal')
  })
  it('allows Undo directly from a stuck popup and shows a new end event after replay', () => {
    const ended = atGameOver()
    expect(sessionEndReason(ended)).toBe('stuck'); expect(canUndoSession(ended)).toBe(true)
    const restored = undoSession(ended)
    expect(restored.popup).toBeNull(); expect(sessionEndReason(restored)).toBeNull()
    expect(restored.overNotifiedRevision).toBe(ended.overNotifiedRevision)
    let replay = restored
    for (const direction of ['left', 'right', 'up', 'down'] as const) {
      const candidate = moveSession(restored, direction)
      if (candidate.popup === 'game-over') { replay = candidate; break }
    }
    expect(replay.popup).toBe('game-over')
    expect(replay.overNotifiedRevision).toBeGreaterThan(ended.overNotifiedRevision!)
  })
  it('allows Undo after closing the end popup, without unlocking merely by closing it', () => {
    const closed = dismissSessionPopup(atGameOver())
    expect(sessionEndReason(closed)).toBe('stuck')
    expect(moveSession(closed, 'left')).toBe(closed)
    expect(sessionEndReason(undoSession(closed))).toBeNull()
  })
  it('forbids Undo for the future time-expired end reason', () => {
    const session = moveSession(sessionFor(), 'left')
    expect(canUndoSession(session, 'time-expired')).toBe(false)
    expect(undoSession(session, 'time-expired')).toBe(session)
  })
  it('permits Undo for a future move-limit end without rewinding external clocks', () => {
    const base = moveSession(sessionFor(), 'left')
    const session = { ...base, elapsedMs: 10000, deadlineMs: 12000 }
    const undone = undoSession(session, 'move-limit')
    expect(canUndoSession(session, 'move-limit')).toBe(true)
    expect(undone).toMatchObject({ elapsedMs: 10000, deadlineMs: 12000 })
    expect(undone.undoUsed).toBe(1)
  })
  it('does not mutate or alias mutable history during Undo', () => {
    const moved = moveSession(sessionFor(), 'left'), snapshot = structuredClone(moved)
    const undone = undoSession(moved)
    expect(moved).toEqual(snapshot); expect(Object.isFrozen(undone)).toBe(true)
    expect(Object.isFrozen(undone.history)).toBe(true)
  })
})
