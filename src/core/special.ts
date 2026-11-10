import type { GameSettings } from './types.ts'

export function isSpecialMove(settings: GameSettings, moveCount: number): boolean {
  return settings.special?.enabled === true && Number.isSafeInteger(moveCount) && moveCount > 0 && moveCount % settings.special.interval === 0
}
export function movesUntilSpecial(settings: GameSettings, moveCount: number): number | null {
  return settings.special?.enabled ? settings.special.interval - moveCount % settings.special.interval : null
}
export function maximumSpawnValue(settings: GameSettings): number {
  return settings.special?.enabled ? settings.special.value : settings.spawn4Percent === 0 ? 2 : 4
}
