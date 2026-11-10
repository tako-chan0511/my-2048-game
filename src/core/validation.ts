import { RULES_VERSION, SPECIAL_VALUES, type Board, type BoardSize, type Direction, type GameSettings, type GameState, type Position, type RngState, type SettingsIssue, type Tile } from './types.ts'
export const MAX_TILE_POWER = 128
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function keys(value: Record<string, unknown>, expected: readonly string[]) { return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)) }
export function integer(value: unknown, min: number, max: number): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max }
export function assertSeed(value: unknown): asserts value is number { if (!integer(value, 0, 0xffffffff)) throw new RangeError('Seed must be an unsigned 32-bit integer') }
export function assertRng(value: unknown): asserts value is RngState {
  if (!object(value) || !keys(value, ['algorithm', 'state']) || value.algorithm !== 'mulberry32-v1' || !integer(value.state, 0, 0xffffffff)) throw new RangeError('Invalid RNG state')
}
export function assertSize(value: unknown): asserts value is BoardSize { if (!integer(value, 3, 10)) throw new RangeError('Board size must be an integer from 3 to 10') }
export function assertDirection(value: unknown): asserts value is Direction { if (typeof value !== 'string' || !['up', 'right', 'down', 'left'].includes(value)) throw new RangeError('Invalid direction') }
export function assertProbability(value: unknown): asserts value is number { if (!integer(value, 0, 100)) throw new RangeError('Spawn probability must be an integer from 0 to 100') }
export function assertTile(value: unknown): asserts value is Tile {
  if (!object(value) || !keys(value, ['id', 'power']) || !integer(value.id, 1, Number.MAX_SAFE_INTEGER - 1) || !integer(value.power, 1, MAX_TILE_POWER)) throw new RangeError('Invalid tile')
}
export function assertBoard(value: unknown, expectedSize?: BoardSize): asserts value is Board {
  if (!Array.isArray(value)) throw new RangeError('Invalid board')
  const size = expectedSize ?? Math.sqrt(value.length)
  assertSize(size)
  if (value.length !== size * size) throw new RangeError('Board length does not match its size')
  const ids = new Set<number>()
  for (let i = 0; i < value.length; i++) {
    if (!Object.hasOwn(value, i)) throw new RangeError('Sparse boards are not supported')
    const tile: unknown = value[i]
    if (tile === null) continue
    assertTile(tile)
    if (ids.has(tile.id)) throw new RangeError('Tile IDs must be unique')
    ids.add(tile.id)
  }
}
export function assertNextTileId(board: Board, value: unknown): asserts value is number {
  const max = Math.max(0, ...board.map(tile => tile?.id ?? 0))
  if (!integer(value, max + 1, Number.MAX_SAFE_INTEGER)) throw new RangeError('Next tile ID must exceed all existing IDs')
}
export function settingsIssues(value: unknown): readonly SettingsIssue[] {
  if (!object(value)) return [{ field: 'settings', message: '設定の形式が正しくありません。' }]
  const issues: SettingsIssue[] = []
  if (!keys(value, ['size', 'target', 'initialTiles', 'spawn4Percent', 'undoLimit', 'mode', ...(Object.hasOwn(value, 'special') ? ['special'] : [])])) {
    issues.push({ field: 'settings', message: '設定に不足または不明な項目があります。' })
  }
  if (!integer(value.size, 3, 10)) issues.push({ field: 'size', message: '盤面サイズは3〜10の整数を選んでください。' })
  if (!integer(value.target, 128, 65536) || !Number.isInteger(Math.log2(value.target))) {
    issues.push({ field: 'target', message: '目標は128〜65536の指定された2の累乗から選んでください。' })
  }
  const maxTiles = integer(value.size, 3, 10) ? value.size * value.size : 100
  if (!integer(value.initialTiles, 1, maxTiles)) {
    issues.push({ field: 'initialTiles', message: `初期タイル枚数は1〜${maxTiles}の整数で指定してください。` })
  }
  if (!integer(value.spawn4Percent, 0, 100)) {
    issues.push({ field: 'spawn4Percent', message: '4の出現率は0〜100%の整数で指定してください。' })
  }
  if (value.undoLimit !== 'unlimited' && !integer(value.undoLimit, 0, 10)) issues.push({ field: 'undoLimit', message: 'Undoの設定値が正しくありません。' })
  if (!object(value.mode)) issues.push({ field: 'mode', message: 'モードを選択してください。' })
  else if (value.mode.kind === 'normal') {
    if (!keys(value.mode, ['kind'])) issues.push({ field: 'mode', message: '通常モードの設定形式が正しくありません。' })
  } else if (value.mode.kind === 'timed') {
    if (!keys(value.mode, ['kind', 'seconds']) || !integer(value.mode.seconds, 10, 3600)) issues.push({ field: 'timeSeconds', message: '制限時間は10〜3600秒の整数で指定してください。' })
  } else if (value.mode.kind === 'moves') {
    if (!keys(value.mode, ['kind', 'limit']) || !integer(value.mode.limit, 1, 100000)) issues.push({ field: 'moveLimit', message: '制限手数は1〜100000手の整数で指定してください。' })
  } else issues.push({ field: 'mode', message: '通常・時間制限・手数制限から選んでください。' })
  if (Object.hasOwn(value, 'special')) {
    const special = value.special
    if (!object(special) || !keys(special, ['enabled', 'interval', 'value', 'replacement'])) issues.push({ field: 'special', message: 'スペシャル設定の形式が正しくありません。' })
    else {
      if (typeof special.enabled !== 'boolean') issues.push({ field: 'specialEnabled', message: 'スペシャルモードはONまたはOFFを選んでください。' })
      if (!integer(special.interval, 1, 100)) issues.push({ field: 'specialInterval', message: 'スペシャル出現間隔は1〜100手の整数で指定してください。' })
      if (!SPECIAL_VALUES.some(value => value === special.value)) issues.push({ field: 'specialValue', message: 'スペシャル数字は8〜1024の指定された2の累乗から選んでください。' })
      if (special.replacement !== 'replace') issues.push({ field: 'special', message: 'スペシャル出現方式は通常タイルの置換のみ対応しています。' })
    }
  }
  return issues
}
export function assertSettings(value: unknown): asserts value is GameSettings {
  const issues = settingsIssues(value)
  if (issues.length) throw new RangeError(issues.map(issue => issue.message).join(' '))
}
export function boardSize(board: Board): BoardSize {
  assertBoard(board)
  return Math.sqrt(board.length) as BoardSize
}
export function assertPosition(value: unknown, expectedSize?: BoardSize): asserts value is Position {
  if (!object(value) || !keys(value, ['board', 'score', 'moveCount', 'rng', 'nextTileId'])) throw new RangeError('Invalid position')
  assertBoard(value.board, expectedSize); assertRng(value.rng); assertNextTileId(value.board, value.nextTileId)
  if (typeof value.score !== 'bigint' || value.score < 0n || value.score % 4n !== 0n || !integer(value.moveCount, 0, Number.MAX_SAFE_INTEGER)) throw new RangeError('Invalid score or move count')
}
export function assertGameState(value: unknown): asserts value is GameState {
  if (!object(value) || !keys(value, ['rulesVersion', 'initialSeed', 'settings', 'position', 'maxPowerEver', 'revision']) || value.rulesVersion !== RULES_VERSION) throw new RangeError('Invalid game state')
  assertSeed(value.initialSeed); assertSettings(value.settings); assertPosition(value.position, value.settings.size)
  const max = Math.max(0, ...value.position.board.map(tile => tile?.power ?? 0))
  if (!integer(value.maxPowerEver, max, MAX_TILE_POWER) || !integer(value.revision, 0, Number.MAX_SAFE_INTEGER)) throw new RangeError('Invalid game metadata')
}
