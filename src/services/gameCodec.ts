import { boardTotal, copyPosition, sessionEndReason, EMPTY_CLOCK, MAX_CLOCK_MS, moveGame, restoreSessionNotifications, theoreticalMaxTile, type GameSettings, type GameState, type PlaySession, type Position, type SessionClock, type EndReason } from '../core/index.ts'
import { assertGameState, assertPosition, assertSettings, integer } from '../core/validation.ts'

export const SAVE_VERSION = 2
const BEST_VERSION = 1
export const MAX_STORAGE_CHARACTERS = 1_500_000
export const MAX_SERIALIZED_HISTORY_CELLS = 40_000
export class HistoryStorageLimitError extends RangeError {}
export interface DecodedGame { readonly session: PlaySession; readonly historyOmitted: boolean; readonly migratedFromV1: boolean }
export type BestEntries = ReadonlyMap<string, bigint>
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function exact(value: Record<string, unknown>, fields: readonly string[]) { return Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field)) }
function bad(): never { throw new RangeError('Invalid saved game') }
export function scoreString(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 64 || !/^(0|[1-9][0-9]*)$/.test(value)) return bad()
  const score = BigInt(value)
  if (score % 4n !== 0n) return bad()
  return score
}
function scoreBound(settings: GameSettings): bigint {
  const max = theoreticalMaxTile(settings), power = settings.size * settings.size + 1
  return max * BigInt(settings.size * settings.size * power)
}
export function settingsKey(settings: GameSettings): string {
  assertSettings(settings)
  const mode = settings.mode
  const modeKey = mode.kind === 'timed' ? ['timed', mode.seconds] : mode.kind === 'moves' ? ['moves', mode.limit] : ['normal']
  return JSON.stringify([1, settings.size, settings.target, settings.initialTiles, settings.spawn4Percent, settings.undoLimit, modeKey])
}
function settingsFromKey(key: string): GameSettings {
  if (key.length > 250) return bad()
  const raw: unknown = JSON.parse(key)
  if (!Array.isArray(raw) || raw.length !== 7 || raw[0] !== 1 || !Array.isArray(raw[6])) return bad()
  const keyMode = raw[6] as unknown[]
  const mode: unknown = keyMode[0] === 'normal' && keyMode.length === 1 ? { kind: 'normal' }
    : keyMode[0] === 'timed' && keyMode.length === 2 ? { kind: 'timed', seconds: keyMode[1] }
    : keyMode[0] === 'moves' && keyMode.length === 2 ? { kind: 'moves', limit: keyMode[1] } : null
  const settings: unknown = { size: raw[1], target: raw[2], initialTiles: raw[3], spawn4Percent: raw[4], undoLimit: raw[5], mode }
  assertSettings(settings)
  if (settingsKey(settings) !== key) return bad()
  return settings
}
function positionData(position: Position) {
  return { board: position.board.map(tile => tile ? { id: tile.id, power: tile.power } : null),
    score: position.score.toString(), moveCount: position.moveCount,
    rng: { algorithm: position.rng.algorithm, state: position.rng.state }, nextTileId: position.nextTileId }
}
function readPosition(raw: unknown, settings: GameSettings): Position {
  if (!object(raw) || !exact(raw, ['board', 'score', 'moveCount', 'rng', 'nextTileId'])) return bad()
  const position: unknown = { ...raw, score: scoreString(raw.score) }
  assertPosition(position, settings.size)
  const count = BigInt(settings.initialTiles) + BigInt(position.moveCount), mass = boardTotal(position.board)
  const minSpawn = settings.spawn4Percent === 100 ? 4n : 2n, maxSpawn = settings.spawn4Percent === 0 ? 2n : 4n
  if (mass < count * minSpawn || mass > count * maxSpawn) return bad()
  const occupied = position.board.filter(Boolean).length
  if (!occupied || BigInt(position.nextTileId) !== 2n * count - BigInt(occupied) + 1n) return bad()
  const potential = position.board.reduce((total, tile) => total + (tile ? (1n << BigInt(tile.power)) * BigInt(tile.power - 1) : 0n), 0n)
  // Each merge increases sum(value * (power - 1)) by its score gain.
  // Every spawned 4 contributes 4 to that sum without scoring; total mass and
  // spawn count recover exactly how many 4s have appeared on this branch.
  const fourCount = (mass - 2n * count) / 2n
  if (position.score !== potential - 4n * fourCount || position.score > scoreBound(settings)) return bad()
  return copyPosition(position)
}
function samePosition(a: Position, b: Position): boolean { return JSON.stringify(positionData(a)) === JSON.stringify(positionData(b)) }
function legalTransition(before: Position, after: Position, game: GameState): boolean {
  for (const direction of ['left', 'right', 'up', 'down'] as const) {
    const previous: GameState = { ...game, position: before, maxPowerEver: game.maxPowerEver, revision: 0 }
    const result = moveGame(previous, direction)
    if (result.changed && samePosition(result.state.position, after)) return true
  }
  return false
}
function readClock(raw: unknown, game: GameState): SessionClock {
  if (!object(raw) || !exact(raw, ['startedAtMs', 'deadlineMs', 'lastObservedAtMs'])) return bad()
  if (game.settings.mode.kind !== 'timed') {
    if (raw.startedAtMs !== null || raw.deadlineMs !== null || raw.lastObservedAtMs !== null) return bad()
    return EMPTY_CLOCK
  }
  if (raw.startedAtMs === null) {
    if (raw.deadlineMs !== null || raw.lastObservedAtMs !== null || game.revision !== 0) return bad()
    return EMPTY_CLOCK
  }
  if (!integer(raw.startedAtMs, 0, MAX_CLOCK_MS) || !integer(raw.deadlineMs, 0, MAX_CLOCK_MS) || !integer(raw.lastObservedAtMs, raw.startedAtMs, MAX_CLOCK_MS)
    || raw.deadlineMs !== raw.startedAtMs + game.settings.mode.seconds * 1000) return bad()
  return Object.freeze({ startedAtMs: raw.startedAtMs, deadlineMs: raw.deadlineMs, lastObservedAtMs: raw.lastObservedAtMs })
}
export function decodeGame(text: string, nowMs?: number): DecodedGame {
  if (text.length > MAX_STORAGE_CHARACTERS) return bad()
  const raw: unknown = JSON.parse(text)
  if (!object(raw) || (raw.version !== 1 && raw.version !== SAVE_VERSION)) return bad()
  const legacy = raw.version === 1
  const fields = ['version', 'game', 'history', 'undoUsed', 'goalNotified', 'overNotifiedRevision', 'popup', 'status', 'historyOmitted']
  if (!exact(raw, legacy ? fields : [...fields, 'clock', 'overNotifiedReason'])) return bad()
  if (!object(raw.game) || !exact(raw.game, ['rulesVersion', 'initialSeed', 'settings', 'position', 'maxPowerEver', 'revision'])) return bad()
  assertSettings(raw.game.settings)
  const position = readPosition(raw.game.position, raw.game.settings)
  const game: unknown = { ...raw.game, position }
  assertGameState(game)
  if (legacy && game.settings.mode.kind !== 'normal') return bad()
  if (game.settings.mode.kind === 'moves' && game.position.moveCount > game.settings.mode.limit) return bad()
  const clock = readClock(legacy ? EMPTY_CLOCK : raw.clock, game)
  const overReason = legacy ? (raw.overNotifiedRevision === null ? null : 'stuck') : raw.overNotifiedReason
  if (overReason !== null && overReason !== 'stuck' && overReason !== 'time-expired' && overReason !== 'move-limit') return bad()
  const upperPower = game.settings.size ** 2 + (game.settings.spawn4Percent === 0 ? 0 : 1)
  const everMassBound = BigInt(game.settings.initialTiles) + BigInt(game.revision)
  if (game.maxPowerEver > upperPower || (1n << BigInt(game.maxPowerEver)) > everMassBound * (game.settings.spawn4Percent === 0 ? 2n : 4n)) return bad()
  if (raw.goalNotified === true && game.maxPowerEver < Math.log2(game.settings.target)) return bad()
  if (game.revision < game.position.moveCount || !integer(raw.undoUsed, 0, Number.MAX_SAFE_INTEGER) || !Array.isArray(raw.history)) return bad()
  if (BigInt(game.revision) !== BigInt(game.position.moveCount) + 2n * BigInt(raw.undoUsed)) return bad()
  if (raw.history.length * game.settings.size ** 2 > MAX_SERIALIZED_HISTORY_CELLS) return bad()
  if (typeof raw.goalNotified !== 'boolean' || typeof raw.historyOmitted !== 'boolean' || (raw.status !== 'playing' && raw.status !== 'game-over')) return bad()
  if (raw.popup !== null && raw.popup !== 'goal' && raw.popup !== 'game-over') return bad()
  if (raw.overNotifiedRevision !== null && !integer(raw.overNotifiedRevision, 0, game.revision)) return bad()
  if (game.settings.undoLimit !== 'unlimited' && (raw.undoUsed > game.settings.undoLimit || raw.history.length > game.settings.undoLimit - raw.undoUsed)) return bad()
  if (raw.historyOmitted && raw.history.length) return bad()
  const history = raw.history.map((entry: unknown) => readPosition(entry, game.settings))
  for (let i = 0; i < history.length; i++) {
    const before = history[i]!, after = history[i + 1] ?? position
    if (before.moveCount + 1 !== after.moveCount || !legalTransition(before, after, game)) return bad()
  }
  const frozenGame = Object.freeze({ ...game, settings: Object.freeze({ ...game.settings, mode: Object.freeze({ ...game.settings.mode }) }) })
  return { session: restoreSessionNotifications(Object.freeze({ game: frozenGame, history: Object.freeze(history), undoUsed: raw.undoUsed,
    goalNotified: raw.goalNotified, overNotifiedRevision: raw.overNotifiedRevision, overNotifiedReason: overReason as EndReason, clock, popup: raw.popup }), nowMs), historyOmitted: raw.historyOmitted, migratedFromV1: legacy }
}
export function encodeGame(session: PlaySession, omitHistory = false): string {
  const { game } = session
  assertGameState(game)
  readClock(session.clock, game)
  if (game.settings.mode.kind === 'moves' && game.position.moveCount > game.settings.mode.limit) return bad()
  readPosition(positionData(game.position), game.settings)
  if (!omitHistory && session.history.length * game.settings.size ** 2 > MAX_SERIALIZED_HISTORY_CELLS) throw new HistoryStorageLimitError('History size limit')
  const text = JSON.stringify({ version: SAVE_VERSION, game: { ...game, position: positionData(game.position) },
    history: omitHistory ? [] : session.history.map(positionData), undoUsed: session.undoUsed,
    goalNotified: session.goalNotified, overNotifiedRevision: session.overNotifiedRevision, overNotifiedReason: session.overNotifiedReason, clock: session.clock, popup: session.popup,
    status: sessionEndReason(session) ? 'game-over' : 'playing', historyOmitted: omitHistory })
  if (text.length > MAX_STORAGE_CHARACTERS) throw new HistoryStorageLimitError('History size limit')
  // Runtime history comes only from the engine; full transition validation is
  // performed on reads, not repeated for every move of an unlimited game.
  return text
}
export function decodeBests(text: string): { entries: Map<string, bigint>; skipped: boolean } {
  if (text.length > MAX_STORAGE_CHARACTERS) return bad()
  const raw: unknown = JSON.parse(text)
  if (!object(raw) || !exact(raw, ['version', 'records']) || raw.version !== BEST_VERSION || !object(raw.records)) return bad()
  const entries = new Map<string, bigint>(); let skipped = false
  for (const [key, value] of Object.entries(raw.records)) {
    try {
      const settings = settingsFromKey(key), score = scoreString(value)
      if (score > scoreBound(settings)) return bad()
      entries.set(key, score)
    } catch { skipped = true }
  }
  return { entries, skipped }
}
export function encodeBests(entries: BestEntries): string {
  const text = JSON.stringify({ version: BEST_VERSION, records: Object.fromEntries([...entries].map(([key, score]) => [key, score.toString()])) })
  const result = decodeBests(text)
  if (result.skipped) return bad()
  return text
}
