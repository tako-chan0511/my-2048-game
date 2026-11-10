import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SPECIAL_VALUES, createGame, createSession, moveSession, undoSession, type GameMode, type Position } from '../src/core/index.ts'
import { decodeBests, decodeGame, encodeBests, encodeGame, SAVE_VERSION, settingsKey } from '../src/services/gameCodec.ts'
import { BEST_STORAGE_KEY, GAME_STORAGE_KEY, createGameStorage } from '../src/services/gameStorage.ts'
import { use2048Game } from '../src/composables/use2048Game.ts'
import { memoryStorage } from './session-fixtures.ts'
import { advanceMoves, specialSettings, step, validDirection } from './special-fixtures.ts'

const modes: GameMode[] = [{ kind: 'normal' }, { kind: 'timed', seconds: 10 }, { kind: 'moves', limit: 5 }]
describe('special session persistence and migration', () => {
  it.each(modes)('round trips history, RNG, IDs and special settings in $kind mode', mode => {
    const session = advanceMoves(createSession(createGame(42, { ...specialSettings(), mode })), 5)
    const text = encodeGame(session), restored = decodeGame(text, 1000).session
    expect(restored).toEqual(session)
    expect(JSON.parse(text).version).toBe(SAVE_VERSION)
    expect(typeof JSON.parse(text).game.position.score).toBe('string')
    const undone = undoSession(restored, undefined, 1001)
    expect(undone.game.position.moveCount).toBe(4)
    expect(step(undone, 1001).game.position).toEqual(session.game.position)
    expect(restored.clock.deadlineMs).toBe(session.clock.deadlineMs)
  })
  it.each(SPECIAL_VALUES)('validates actual mass and score with special %i before and after Undo', value => {
    const session = advanceMoves(createSession(createGame(93, specialSettings(1, value))), 20)
    expect(decodeGame(encodeGame(session)).session).toEqual(session)
    const undone = undoSession(session)
    expect(decodeGame(encodeGame(undone)).session).toEqual(undone)
    expect(step(decodeGame(encodeGame(undone)).session).game.position).toEqual(step(undone).game.position)
  })
  it.each(modes)('migrates v2 $kind sessions to OFF preserving position and deadline', mode => {
    const session = advanceMoves(createSession(createGame(42, { ...DEFAULT_SETTINGS, mode })), 3)
    const raw = JSON.parse(encodeGame(session)); raw.version = 2; delete raw.game.settings.special
    const port = memoryStorage({ [GAME_STORAGE_KEY]: JSON.stringify(raw) }), game = use2048Game(() => 999, port, () => 1000)
    expect(game.state.value).toEqual(session.game)
    expect(game.specialRemaining.value).toBeNull()
    const migrated = JSON.parse(port.data.get(GAME_STORAGE_KEY)!)
    expect(migrated.version).toBe(SAVE_VERSION); expect(migrated.game.settings.special.enabled).toBe(false)
    expect(migrated.clock).toEqual(raw.clock)
    expect(decodeGame(JSON.stringify(raw), 1000).migratedFromOlderVersion).toBe(true)
  })
  it('persists applied settings rather than edited settings', () => {
    const port = memoryStorage(), game = use2048Game(() => 42, port)
    game.draftSettings.value = { ...game.draftSettings.value, specialEnabled: true, specialInterval: 5, specialValue: 32 }
    expect(game.applySettings()).toBe(true)
    game.draftSettings.value.specialInterval = 1; game.draftSettings.value.specialValue = 1024
    game.dispatchMove(validDirection(game.state.value!))
    const restored = use2048Game(() => 99, port)
    expect(restored.state.value!.settings.special).toEqual(specialSettings().special)
    expect(restored.draftSettings.value.specialInterval).toBe(5); expect(restored.draftSettings.value.specialValue).toBe(32)
    expect(restored.presentation.value).toBeNull(); expect(restored.specialArrival.value).toBeNull()
  })
  it('preserves applied OFF interval/value on save while sharing the legacy best key', () => {
    const port = memoryStorage(), game = use2048Game(() => 42, port)
    game.draftSettings.value = { ...game.draftSettings.value, specialEnabled: false, specialInterval: 10, specialValue: 64 }
    expect(game.applySettings()).toBe(true)
    const restored = use2048Game(() => 99, port)
    expect(restored.draftSettings.value.specialEnabled).toBe(false)
    expect(restored.draftSettings.value.specialInterval).toBe(10); expect(restored.draftSettings.value.specialValue).toBe(64)
    expect(restored.specialRemaining.value).toBeNull()
    expect(settingsKey(restored.state.value!.settings)).toBe(settingsKey(DEFAULT_SETTINGS))
    expect(JSON.parse(port.data.get(GAME_STORAGE_KEY)!).game.settings.special).toEqual({ enabled: false, interval: 10, value: 64, replacement: 'replace' })
  })
  it('keeps a coherent special bigint score beyond Number.MAX_SAFE_INTEGER', () => {
    // One initial 4, then count-1 special 8s: total mass = 2^54 + 4.
    const count = 2 ** 51 + 1, base = createGame(0, { ...specialSettings(1, 8), initialTiles: 1, spawn4Percent: 100 })
    const board: Position['board'] = [{ id: 2 * count - 3, power: 54 }, { id: 2 * count - 2, power: 2 }, ...Array<null>(98).fill(null)]
    const score = (1n << 54n) * 51n
    const game = { ...base, position: { ...base.position, board, score, moveCount: count - 1, nextTileId: 2 * count - 1 }, revision: count - 1, maxPowerEver: 54 }
    const session = { ...createSession(game), goalNotified: true }
    expect(decodeGame(encodeGame(session)).session.game.position.score).toBe(score)
    expect(score).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER))
  })
  it.each([{ interval: 0 }, { interval: 101 }, { interval: 1.5 }, { value: 4 }, { value: 12 }, { value: '32' }, { enabled: 1 }, { replacement: 'extra' }])('rejects corrupted special settings %j without preventing play', patch => {
    const raw = JSON.parse(encodeGame(createSession(createGame(42, specialSettings()))))
    Object.assign(raw.game.settings.special, patch)
    const port = memoryStorage({ [GAME_STORAGE_KEY]: JSON.stringify(raw) }), game = use2048Game(() => 0, port)
    expect(game.restoreMessage.value).toContain('不正'); expect(game.state.value!.settings).toEqual(DEFAULT_SETTINGS)
    expect(game.dispatchMove('left')).toBe(true)
  })
  it.each(['{invalid', '{"version":99}', 'null'])('recovers from %s and keeps best records', text => {
    const settings = specialSettings(), port = memoryStorage({ [GAME_STORAGE_KEY]: text, [BEST_STORAGE_KEY]: encodeBests(new Map([[settingsKey(settings), 64n]])) })
    const game = use2048Game(() => 42, port)
    expect(game.state.value).not.toBeNull(); expect(createGameStorage(port).bestFor(settings)).toBe(64n)
  })
  it('does not trust a history entry whose RNG has been changed', () => {
    const raw = JSON.parse(encodeGame(advanceMoves(createSession(createGame(42, specialSettings())), 5)))
    raw.history[4].rng.state ^= 123
    expect(() => decodeGame(JSON.stringify(raw))).toThrow()
  })
  it('restores an expired special timed session without extending its deadline', () => {
    const session = step(createSession(createGame(42, { ...specialSettings(1), mode: { kind: 'timed', seconds: 10 } })))
    const restored = decodeGame(encodeGame(session), 11000).session
    expect(restored.clock.deadlineMs).toBe(11000); expect(restored.popup).toBe('game-over')
    expect(moveSession(restored, 'left', 11000).game.position).toEqual(session.game.position)
    expect(undoSession(restored, undefined, 11000).game.position).toEqual(session.game.position)
  })
  it('keeps playing and Undo in memory when storage is denied', () => {
    const game = use2048Game(() => 42, { getItem() { throw new DOMException('Denied', 'SecurityError') }, setItem() { throw new DOMException('Denied', 'SecurityError') } })
    game.draftSettings.value.specialEnabled = true; game.draftSettings.value.specialInterval = 1; expect(game.applySettings()).toBe(true)
    const before = game.state.value!.position
    expect(game.dispatchMove(validDirection(game.state.value!))).toBe(true); expect(game.specialArrival.value).toBe(32)
    expect(game.saveResult.value!.status).toBe('failed'); expect(game.undo()).toBe(true)
    expect(game.state.value!.position).toEqual(before)
  })
  it('falls back to current-only storage on quota exhaustion and keeps special RNG', () => {
    const session = advanceMoves(createSession(createGame(42, specialSettings())), 5), port = memoryStorage(), write = port.setItem
    port.setItem = (key, value) => { if (JSON.parse(value).history.length) throw new DOMException('Full', 'QuotaExceededError'); write(key, value) }
    const repository = createGameStorage(port)
    expect(repository.saveGame(session).status).toBe('history-omitted')
    const restored = decodeGame(port.data.get(GAME_STORAGE_KEY)!).session
    expect(restored.history).toHaveLength(0); expect(session.history).toHaveLength(5)
    expect(step(restored).game.position).toEqual(step(session).game.position)
  })
})

describe('special best score partitions', () => {
  it('preserves the exact legacy key and ignores OFF interval and value', () => {
    const legacy = '[1,4,2048,2,10,10,["normal"]]'
    expect(settingsKey(DEFAULT_SETTINGS)).toBe(legacy)
    expect(settingsKey({ ...DEFAULT_SETTINGS, special: { ...specialSettings(100, 1024).special!, enabled: false } })).toBe(legacy)
    const port = memoryStorage({ [BEST_STORAGE_KEY]: JSON.stringify({ version: 1, records: { [legacy]: '128' } }) })
    expect(createGameStorage(port).bestFor(DEFAULT_SETTINGS)).toBe(128n)
  })
  it('separates ON/OFF, interval and value, then round trips all records', () => {
    const settings = [DEFAULT_SETTINGS, specialSettings(), specialSettings(10), specialSettings(5, 64)], port = memoryStorage(), repository = createGameStorage(port)
    settings.forEach((setting, i) => repository.updateBest(setting, BigInt(i + 1) * 64n))
    const restored = createGameStorage(port)
    settings.forEach((setting, i) => expect(restored.bestFor(setting)).toBe(BigInt(i + 1) * 64n))
    expect(decodeBests(port.data.get(BEST_STORAGE_KEY)!).entries.size).toBe(4)
  })
  it('keeps valid legacy and special records when one special key is corrupt', () => {
    const key = settingsKey(specialSettings()), invalid = key.replace('"replace"', '"extra"')
    const result = decodeBests(JSON.stringify({ version: 1, records: { [key]: '32', [invalid]: '64', [settingsKey(DEFAULT_SETTINGS)]: '128' } }))
    expect(result.skipped).toBe(true); expect(result.entries.size).toBe(2)
    expect(result.entries.get(settingsKey(DEFAULT_SETTINGS))).toBe(128n)
  })
})
