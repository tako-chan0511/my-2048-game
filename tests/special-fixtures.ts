import { DEFAULT_SETTINGS, DEFAULT_SPECIAL, SPECIAL_VALUES, dismissSessionPopup, moveSession, slideBoard, type Direction, type GameSettings, type GameState, type PlaySession } from '../src/core/index.ts'

export function specialSettings(interval = 5, value: typeof SPECIAL_VALUES[number] = 32): GameSettings {
  return { ...DEFAULT_SETTINGS, size: 10, target: 65536, special: { ...DEFAULT_SPECIAL, enabled: true, interval, value } }
}
export function validDirection(game: GameState, except?: Direction): Direction {
  const direction = (['left', 'up', 'right', 'down'] as const).find(d => d !== except && slideBoard(game.position.board, d, game.position.nextTileId).changed)
  if (!direction) throw new Error('No valid direction in fixture')
  return direction
}
export function step(session: PlaySession, now = 1000): PlaySession {
  return moveSession(session.popup ? dismissSessionPopup(session, now) : session, validDirection(session.game), now)
}
export function advanceMoves(session: PlaySession, count: number): PlaySession {
  for (let i = 0; i < count; i++) session = step(session)
  return session
}
