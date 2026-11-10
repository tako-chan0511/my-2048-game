import { DEFAULT_SETTINGS, RULES_VERSION, type Direction, type GameSettings, type GameState, type MoveResult, type Position, type RandomSampler } from './types.ts'
import { highestPower, increment, isGameOver } from './board.ts'
import { createRandomState, drawBelow } from './random.ts'
import { slideBoard } from './slide.ts'
import { spawnTile } from './spawn.ts'
import { assertGameState, assertSeed, assertSettings } from './validation.ts'
export function createGame(seed: number, settings: GameSettings = DEFAULT_SETTINGS): GameState {
  assertSeed(seed); assertSettings(settings)
  const applied: GameSettings = Object.freeze({ ...settings, mode: Object.freeze({ ...settings.mode }) })
  let current: Position = { board: Object.freeze(Array<null>(applied.size * applied.size).fill(null)), score: 0n, moveCount: 0, rng: createRandomState(seed), nextTileId: 1 }
  for (let i = 0; i < applied.initialTiles; i++) {
    const spawned = spawnTile(current.board, current.rng, current.nextTileId, applied.spawn4Percent)
    current = { ...current, board: spawned.board, rng: spawned.rng, nextTileId: spawned.nextTileId }
  }
  return Object.freeze({ rulesVersion: RULES_VERSION, initialSeed: seed, settings: applied, position: Object.freeze(current), maxPowerEver: highestPower(current.board), revision: 0 })
}
export function hasReachedTarget(state: GameState): boolean { return state.maxPowerEver >= Math.log2(state.settings.target) }
export function moveGame(state: GameState, direction: Direction, sample: RandomSampler = drawBelow): MoveResult {
  assertGameState(state)
  const before = state.position, slid = slideBoard(before.board, direction, before.nextTileId)
  if (!slid.changed) return Object.freeze({ state, changed: false, scoreGain: 0n, spawned: null, motions: Object.freeze([]), merges: Object.freeze([]), justReachedTarget: false, randomDraws: 0 })
  const moveCount = increment(before.moveCount), revision = increment(state.revision)
  const spawned = spawnTile(slid.board, before.rng, slid.nextTileId, state.settings.spawn4Percent, sample)
  if (!spawned.spawned) throw new Error('A changed move must leave space for exactly one new tile')
  const position: Position = Object.freeze({ board: spawned.board, score: before.score + slid.scoreGain, moveCount, rng: spawned.rng, nextTileId: spawned.nextTileId })
  const next: GameState = Object.freeze({ ...state, position, maxPowerEver: Math.max(state.maxPowerEver, highestPower(position.board)), revision })
  return Object.freeze({ state: next, changed: true, scoreGain: slid.scoreGain, spawned: spawned.spawned, motions: slid.motions, merges: slid.merges, justReachedTarget: !hasReachedTarget(state) && hasReachedTarget(next), randomDraws: spawned.draws })
}
export function gameStatus(state: GameState): 'playing' | 'game-over' { return isGameOver(state.position.board) ? 'game-over' : 'playing' }
