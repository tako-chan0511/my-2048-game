import { describe, expect, it } from 'vitest'
import { BOARD_SIZES, DEFAULT_SETTINGS, createGame, createSession, moveGame, moveSession, moveSessionWithResult, type Direction } from '../src/core/index.ts'
import { buildTileAnimation, tileCoordinates } from '../src/presentation/tiles.ts'
import { stateFor } from './fixtures.ts'

describe('engine-result-only presentation plan', () => {
  it.each(BOARD_SIZES.flatMap(size => (['up', 'down', 'left', 'right'] as const).map(direction => ({ size, direction }))))('$size × $size $direction uses the exact motion endpoints and IDs', ({ size, direction }) => {
    const game = createGame(3, { ...DEFAULT_SETTINGS, size })
    const result = moveGame(game, direction)
    expect(result.changed).toBe(true)
    const event = { id: 1, before: game.position.board, result }
    const before = JSON.stringify(result, (_, value: unknown) => typeof value === 'bigint' ? value.toString() : value)
    const plan = buildTileAnimation(event)!
    expect(plan.sliding).toHaveLength(result.motions.length)
    for (const motion of result.motions) {
      expect(plan.sliding.find(tile => tile.id === motion.sourceId)).toMatchObject({ id: motion.sourceId, from: motion.from, to: motion.to, power: game.position.board[motion.from]!.power })
    }
    expect(plan.settled.map(tile => tile.id).sort((a, b) => a - b)).toEqual(result.state.position.board.flatMap(tile => tile ? [tile.id] : []).sort((a, b) => a - b))
    expect(new Set(plan.sliding.map(tile => tile.id)).size).toBe(plan.sliding.length)
    expect(new Set(plan.settled.map(tile => tile.id)).size).toBe(plan.settled.length)
    expect(JSON.stringify(result, (_, value: unknown) => typeof value === 'bigint' ? value.toString() : value)).toBe(before)
    for (const tile of plan.settled) {
      const coordinates = tileCoordinates(tile, size)
      expect(coordinates.left).toContain('%')
      expect(coordinates.top).toContain('%')
      expect(coordinates['--from-x']).toBe('calc(0% + 0 * var(--board-gap))')
    }
  })
  it.each([
    [[2, 2, 2, 2], [4, 4], 8n], [[4, 4, 8, 0], [8], 8n], [[2, 2, 4, 0], [4], 4n],
  ] as const)('renders each merged output once for %j', (line, mergedValues, score) => {
    const game = stateFor([...line, ...Array<number>(12).fill(0)])
    const result = moveGame(game, 'left'), plan = buildTileAnimation({ id: 1, before: game.position.board, result })!
    expect(plan.settled.filter(tile => tile.effect === 'merge').map(tile => 2 ** tile.power)).toEqual(mergedValues)
    expect(plan.sliding.map(tile => tile.power)).toEqual(game.position.board.flatMap(tile => tile ? [tile.power] : []))
    expect(result.scoreGain).toBe(score)
    expect(plan.settled.filter(tile => tile.effect === 'spawn')).toHaveLength(1)
  })
  it.each(BOARD_SIZES)('handles a completely full %i × N board with simultaneous merges', size => {
    const game = createGame(0, { ...DEFAULT_SETTINGS, size, initialTiles: size * size, spawn4Percent: 0 })
    const result = moveGame(game, 'left'), plan = buildTileAnimation({ id: 1, before: game.position.board, result })!
    expect(plan.sliding).toHaveLength(size * size)
    expect(new Set(plan.sliding.map(tile => tile.id)).size).toBe(size * size)
    expect(plan.settled.filter(tile => tile.effect === 'merge')).toHaveLength(size * Math.floor(size / 2))
    expect(plan.settled.filter(tile => tile.effect === 'spawn')).toHaveLength(1)
    expect(new Set(plan.settled.map(tile => tile.id)).size).toBe(plan.settled.length)
  })
  it('does not animate a no-op or consume RNG while building a plan', () => {
    const game = createGame(0), result = moveGame(game, 'up')
    expect(buildTileAnimation({ id: 1, before: game.position.board, result })).toBeNull()
    expect(result.state).toBe(game)
    expect(result.randomDraws).toBe(0)
  })
  it.each(['left', 'right', 'up', 'down'] as Direction[])('observing the %s result preserves the original session API', direction => {
    const before = createSession(createGame(0))
    const actual = moveSessionWithResult(before, direction, 500)
    expect(actual.session).toEqual(moveSession(before, direction, 500))
    if (actual.move) expect(actual.move.state).toBe(actual.session.game)
  })
})
