import { DEFAULT_SETTINGS, createGame, createSession, dismissSessionPopup, moveSession, type GameSettings, type PlaySession } from '../src/core/index.ts'
import type { StoragePort } from '../src/services/gameStorage.ts'
export function memoryStorage(initial: Record<string, string> = {}): StoragePort & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) } }
}
export function sessionFor(patch: Partial<GameSettings> = {}, seed = 0): PlaySession { return createSession(createGame(seed, { ...DEFAULT_SETTINGS, ...patch })) }
export const cycle = ['left', 'up', 'right', 'down'] as const
export function advance(session: PlaySession, inputs: number): PlaySession {
  for (let i = 0; i < inputs; i++) {
    if (session.popup === 'goal') session = dismissSessionPopup(session)
    session = moveSession(session, cycle[i % 4]!)
  }
  return session
}
export function atGoal(): PlaySession {
  let session = sessionFor({ target: 128 })
  for (let i = 0; i < 500; i++) {
    session = moveSession(session, cycle[i % 4]!)
    if (session.popup === 'goal') return session
  }
  throw new Error('Fixed goal fixture did not reach 128')
}
export function atGameOver(): PlaySession {
  let session = sessionFor()
  for (let i = 0; i < 500; i++) {
    session = moveSession(session, cycle[i % 4]!)
    if (session.popup === 'game-over') return session
  }
  throw new Error('Fixed end fixture did not finish')
}
