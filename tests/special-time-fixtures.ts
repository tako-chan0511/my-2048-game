import { DEFAULT_SETTINGS, DEFAULT_SPECIAL_TIME, createGame, createSession, type GameSettings, type PlaySession, type SpecialTimeSettings } from '../src/core/index.ts'
import { advanceMoves } from './special-fixtures.ts'
export function timeSettings(patch: Partial<SpecialTimeSettings> = {}, other: Partial<GameSettings> = {}): GameSettings {
  return { ...DEFAULT_SETTINGS, size: 10, target: 65536, ...other, specialTime: { ...DEFAULT_SPECIAL_TIME, enabled: true, ...patch } }
}
export function charged(count = 10, patch: Partial<SpecialTimeSettings> = {}, other: Partial<GameSettings> = {}): PlaySession {
  return advanceMoves(createSession(createGame(42, timeSettings(patch, other))), count)
}
export function emptyIndex(session: PlaySession) { const i = session.game.position.board.indexOf(null); if (i < 0) throw new Error('Fixture has no empty cell'); return i }
