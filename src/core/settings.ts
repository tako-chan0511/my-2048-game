import type { GameSettings, SettingsValidation } from './types.ts'
import { assertSettings, settingsIssues } from './validation.ts'

// Conservative bound: with M cells and largest possible spawn B, a tile can
// never exceed B * 2^(M-1). This does not promise that any lower tile is reachable
// on a geometric board, or under any particular seed. See docs/settings.md.
export function theoreticalMaxTile(settings: GameSettings): bigint {
  assertSettings(settings)
  const maximumSpawn = settings.spawn4Percent === 0 ? 2n : 4n
  return maximumSpawn << BigInt(settings.size * settings.size - 1)
}

export function validateSettings(raw: unknown): SettingsValidation {
  const issues = settingsIssues(raw)
  if (issues.length) return { valid: false, issues }
  assertSettings(raw)
  const settings: GameSettings = Object.freeze({ ...raw, mode: Object.freeze({ ...raw.mode }) })
  const warnings: string[] = []
  const maximum = theoreticalMaxTile(settings)
  if (BigInt(settings.target) > maximum) {
    warnings.push(`この設定では目標${settings.target}には到達できません。${settings.size}×${settings.size}・出現する最大数字${settings.spawn4Percent === 0 ? 2 : 4}では、タイルの理論上限は${maximum}です。目標を${maximum}以下にするか、盤面を大きくしてください。設定を変えずにスコアを目指して遊ぶこともできます。`)
  }
  if (settings.initialTiles === settings.size * settings.size) {
    warnings.push(settings.spawn4Percent > 0 && settings.spawn4Percent < 100
      ? '全マスを埋めて開始します。2と4の配置によっては、開始直後に手詰まりになります。'
      : '全マスを埋めて開始します。空きマスがないため、最初の移動には合体が必要です。')
  }
  return { valid: true, settings, warnings: Object.freeze(warnings) }
}
