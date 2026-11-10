import { gameStatus, hasReachedTarget, moveGame } from './game.ts'
import { copyBoard, increment } from './board.ts'
import { getRandomState } from './random.ts'
import type { Direction, GameState, MoveResult, Position } from './types.ts'
import { integer } from './validation.ts'
export type GamePopup = 'goal' | 'game-over' | null
export type EndReason = 'stuck' | 'time-expired' | 'move-limit' | null
export interface SessionClock {
  readonly startedAtMs: number | null
  readonly deadlineMs: number | null
  readonly lastObservedAtMs: number | null
}
export interface SpecialTimeState {
  readonly charges: number
  readonly processedEvents: number
  readonly granted: number
  readonly used: number
}
export interface PlaySession {
  readonly specialTime?: SpecialTimeState
  readonly game: GameState
  readonly history: readonly Position[]
  readonly undoUsed: number
  readonly goalNotified: boolean
  readonly overNotifiedRevision: number | null
  readonly overNotifiedReason: EndReason
  readonly popup: GamePopup
  readonly clock: SessionClock
}
export const MAX_CLOCK_MS = 8_640_000_000_000_000
export const EMPTY_CLOCK: SessionClock = Object.freeze({ startedAtMs: null, deadlineMs: null, lastObservedAtMs: null })
export function assertClockTime(value: number): void {
  if (!integer(value, 0, MAX_CLOCK_MS)) throw new RangeError('Invalid clock time')
}
export function copyPosition(position: Position): Position {
  return Object.freeze({ ...position, board: copyBoard(position.board), rng: getRandomState(position.rng) })
}
function observedTime(session: PlaySession, nowMs?: number): number {
  if (nowMs !== undefined) assertClockTime(nowMs)
  return Math.max(nowMs ?? 0, session.clock.lastObservedAtMs ?? 0)
}
export function sessionEndReason(session: PlaySession, nowMs?: number): EndReason {
  const mode = session.game.settings.mode
  if (mode.kind === 'timed' && session.clock.deadlineMs !== null && observedTime(session, nowMs) >= session.clock.deadlineMs) return 'time-expired'
  if (mode.kind === 'moves' && session.game.position.moveCount >= mode.limit) return 'move-limit'
  return gameStatus(session.game) === 'game-over' ? 'stuck' : null
}
export function remainingTimeMs(session: PlaySession, nowMs?: number): number | null {
  const mode = session.game.settings.mode
  if (mode.kind !== 'timed') return null
  return session.clock.deadlineMs === null ? mode.seconds * 1000 : Math.max(0, session.clock.deadlineMs - observedTime(session, nowMs))
}
export function remainingMoves(session: PlaySession): number | null {
  const mode = session.game.settings.mode
  return mode.kind === 'moves' ? Math.max(0, mode.limit - session.game.position.moveCount) : null
}
export function undoRemaining(session: PlaySession): number | 'unlimited' {
  return session.game.settings.undoLimit === 'unlimited' ? 'unlimited' : Math.max(0, session.game.settings.undoLimit - session.undoUsed)
}
export function canUndoSession(session: PlaySession, reason: EndReason = sessionEndReason(session), nowMs?: number): boolean {
  const remaining = undoRemaining(session)
  return reason !== 'time-expired' && sessionEndReason(session, nowMs) !== 'time-expired' && session.popup !== 'goal' && session.history.length > 0
    && session.undoUsed < Number.MAX_SAFE_INTEGER && session.game.revision < Number.MAX_SAFE_INTEGER
    && (remaining === 'unlimited' || remaining > 0)
}
export function resolveSessionResult(session: PlaySession, nowMs?: number): PlaySession {
  const reason = sessionEndReason(session, nowMs)
  if (session.popup === 'goal' || !reason) return session
  if (session.overNotifiedRevision === session.game.revision && session.overNotifiedReason === reason) return session
  return Object.freeze({ ...session, popup: 'game-over', overNotifiedRevision: session.game.revision, overNotifiedReason: reason })
}
export function observeSession(session: PlaySession, nowMs?: number): PlaySession {
  if (session.game.settings.mode.kind === 'timed' && session.clock.startedAtMs !== null) {
    const observed = observedTime(session, nowMs)
    if (observed !== session.clock.lastObservedAtMs) session = Object.freeze({ ...session, clock: Object.freeze({ ...session.clock, lastObservedAtMs: observed }) })
  }
  return resolveSessionResult(session, nowMs)
}
export function createSession(game: GameState): PlaySession {
  return resolveSessionResult(Object.freeze({ game, history: Object.freeze([]), undoUsed: 0, goalNotified: false,
    ...(game.settings.specialTime?.enabled ? { specialTime: Object.freeze({ charges: 0, processedEvents: 0, granted: 0, used: 0 }) } : {}),
    overNotifiedRevision: null, overNotifiedReason: null, popup: null, clock: EMPTY_CLOCK }))
}
// Preserve the original API; consumers that render motion can observe the exact
// result of the one engine move. No second slide or RNG draw is performed.
export interface SessionMoveResult { readonly session: PlaySession; readonly move: MoveResult | null }
export function moveSession(session: PlaySession, direction: Direction, nowMs?: number): PlaySession {
  return moveSessionWithResult(session, direction, nowMs).session
}
export function moveSessionWithResult(session: PlaySession, direction: Direction, nowMs?: number): SessionMoveResult {
  session = observeSession(session, nowMs)
  if (session.popup || sessionEndReason(session, nowMs)) return { session, move: null }
  const result = moveGame(session.game, direction)
  if (!result.changed) return { session, move: null }
  let clock = session.clock
  if (session.game.settings.mode.kind === 'timed' && clock.startedAtMs === null) {
    const start = observedTime(session, nowMs), deadline = start + session.game.settings.mode.seconds * 1000
    assertClockTime(deadline)
    clock = Object.freeze({ startedAtMs: start, deadlineMs: deadline, lastObservedAtMs: start })
  }
  const remaining = undoRemaining(session)
  let history: readonly Position[] = remaining === 0 ? [] : [...session.history, session.game.position]
  if (remaining !== 'unlimited' && remaining > 0) history = history.slice(-remaining)
  const goal = result.justReachedTarget && !session.goalNotified
  let specialTime = session.specialTime
  const timeSettings = session.game.settings.specialTime
  if (timeSettings?.enabled && specialTime) {
    const event = Math.floor(result.state.position.moveCount / timeSettings.interval)
    if (event > specialTime.processedEvents) {
      const gain = specialTime.charges < timeSettings.maxCharges ? 1 : 0
      specialTime = Object.freeze({ ...specialTime, processedEvents: event, charges: specialTime.charges + gain, granted: specialTime.granted + gain })
    }
  }
  const next: PlaySession = Object.freeze({ ...session, ...(specialTime ? { specialTime } : {}), game: result.state, history: Object.freeze(history), clock,
    goalNotified: session.goalNotified || goal, popup: goal ? 'goal' : null })
  return { session: resolveSessionResult(next, nowMs), move: result }
}
export function undoSession(session: PlaySession, reason?: EndReason, nowMs?: number): PlaySession {
  session = observeSession(session, nowMs)
  if (!canUndoSession(session, reason, nowMs)) return session
  const game = Object.freeze({ ...session.game, position: session.history.at(-1)!, revision: increment(session.game.revision) })
  return Object.freeze({ ...session, game, history: Object.freeze(session.history.slice(0, -1)), undoUsed: increment(session.undoUsed), popup: null })
}
export function dismissSessionPopup(session: PlaySession, nowMs?: number): PlaySession {
  session = observeSession(session, nowMs)
  if (!session.popup) return session
  return resolveSessionResult(Object.freeze({ ...session, popup: null }), nowMs)
}
export function restoreSessionNotifications(session: PlaySession, nowMs?: number): PlaySession {
  const reason = sessionEndReason(session, nowMs)
  const popup = session.popup === 'goal' && hasReachedTarget(session.game) ? 'goal'
    : session.popup === 'game-over' && reason ? 'game-over' : null
  return observeSession(Object.freeze({ ...session, goalNotified: session.goalNotified || hasReachedTarget(session.game),
    overNotifiedRevision: popup === 'game-over' ? session.game.revision : session.overNotifiedRevision,
    overNotifiedReason: popup === 'game-over' ? reason : session.overNotifiedReason, popup }), nowMs)
}
