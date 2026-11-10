import { createSession, moveGame, highestPower, type GameMode, type PlaySession } from '../src/core/index.ts'
import { atGoal, sessionFor } from './session-fixtures.ts'
export const timed = (seconds = 10) => sessionFor({ mode: { kind: 'timed', seconds } })
export function beforeGoal(mode: GameMode): { session: PlaySession; direction: 'left' | 'right' | 'up' | 'down' } {
  const goal = atGoal(), position = goal.history.at(-1)!
  const game = { ...goal.game, position, settings: { ...goal.game.settings, mode }, maxPowerEver: highestPower(position.board), revision: position.moveCount }
  const direction = (['left', 'right', 'up', 'down'] as const).find(direction => JSON.stringify(moveGame(game, direction).state.position.board) === JSON.stringify(goal.game.position.board))!
  return { session: createSession(game), direction }
}
export function v1Save(text: string): string {
  const raw = JSON.parse(text) as Record<string, unknown>
  delete raw.clock; delete raw.overNotifiedReason; raw.version = 1
  return JSON.stringify(raw)
}
