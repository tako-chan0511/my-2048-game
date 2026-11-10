import { copyBoard, highestPower, increment } from './board.ts'
import { hasReachedTarget } from './game.ts'
import { observeSession, resolveSessionResult, sessionEndReason, type PlaySession } from './session.ts'
import { assertGameState, integer } from './validation.ts'
import type { TimeValue } from './types.ts'

export function canUseSpecialTime(session: PlaySession, nowMs?: number): boolean {
  const reason = sessionEndReason(session, nowMs)
  return session.game.settings.specialTime?.enabled === true && (session.specialTime?.charges ?? 0) > 0
    && session.popup !== 'goal' && (reason === null || reason === 'stuck')
}
// Pure/atomic: failures never consume a charge, ID, RNG draw, or rollback entry.
export function editSessionTile(session: PlaySession, index: number, value: TimeValue, nowMs?: number): PlaySession {
  session = observeSession(session, nowMs)
  if (!canUseSpecialTime(session, nowMs)) return session
  const game = session.game, before = game.position, settings = game.settings.specialTime!
  if (!integer(index, 0, before.board.length - 1) || !settings.values.includes(value)) return session
  const old = before.board[index]!, power = Math.log2(value)
  if (old?.power === power) return session
  const tile = Object.freeze({ id: old?.id ?? before.nextTileId, power })
  const nextTileId = old ? before.nextTileId : increment(before.nextTileId)
  const board = [...before.board]; board[index] = tile
  const previous = game.editEffects ?? { edits: 0, emptyEdits: 0, massDelta: 0n, potentialDelta: 0n }
  const oldValue = old ? 1n << BigInt(old.power) : 0n
  const oldPotential = old ? oldValue * BigInt(old.power - 1) : 0n
  const editEffects = Object.freeze({ edits: increment(previous.edits), lastEditMove: before.moveCount, emptyEdits: previous.emptyEdits + (old ? 0 : 1),
    massDelta: previous.massDelta + BigInt(value) - oldValue,
    potentialDelta: previous.potentialDelta + BigInt(value) * BigInt(power - 1) - oldPotential })
  const nextGame = Object.freeze({ ...game, position: Object.freeze({ ...before, board: copyBoard(board), nextTileId }), editEffects,
    revision: increment(game.revision), maxPowerEver: Math.max(game.maxPowerEver, highestPower(board)) })
  assertGameState(nextGame)
  const goal = !session.goalNotified && hasReachedTarget(nextGame), time = session.specialTime!
  return resolveSessionResult(Object.freeze({ ...session, game: nextGame, history: Object.freeze([]),
    specialTime: Object.freeze({ ...time, charges: time.charges - 1, used: increment(time.used) }),
    goalNotified: session.goalNotified || goal, popup: goal ? 'goal' : null }), nowMs)
}
