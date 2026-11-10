import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, DEFAULT_SPECIAL, createGame, createSession, editSessionTile, undoSession, type GameMode } from '../src/core/index.ts'
import { decodeBests, decodeGame, encodeBests, encodeGame, settingsKey, SAVE_VERSION } from '../src/services/gameCodec.ts'
import { GAME_STORAGE_KEY, BEST_STORAGE_KEY, createGameStorage } from '../src/services/gameStorage.ts'
import { use2048Game } from '../src/composables/use2048Game.ts'
import { memoryStorage } from './session-fixtures.ts'
import { step, advanceMoves } from './special-fixtures.ts'
import { charged, emptyIndex, timeSettings } from './special-time-fixtures.ts'

const modes: GameMode[] = [{ kind: 'normal' }, { kind: 'timed', seconds: 10 }, { kind: 'moves', limit: 100 }]
function editedSession() { const s = charged(10); return editSessionTile(s, emptyIndex(s), 128) }

describe('special time persistence invariants and migration', () => {
  it.each(modes)('round trips an edited session and following move/Undo in $kind mode', mode => {
    const original = charged(10, {}, { mode }), edited = editSessionTile(original, emptyIndex(original), 128, 1000), next = step(edited)
    const restored = decodeGame(encodeGame(next), 1000).session
    expect(restored).toEqual(next)
    const undone = undoSession(restored, undefined, 1000)
    expect(undone.game.position).toEqual(edited.game.position); expect(undone.specialTime!.used).toBe(1)
    expect(undoSession(undone, undefined, 1000)).toBe(undone)
    expect(restored.clock.deadlineMs).toBe(next.clock.deadlineMs)
  })
  it('restores a processed event after Undo and never awards it twice after reload', () => {
    const before = undoSession(charged()), restored = decodeGame(encodeGame(before)).session
    expect(restored.game.position.moveCount).toBe(9); expect(restored.specialTime!.processedEvents).toBe(1)
    const replay = step(restored)
    expect(replay.specialTime!.charges).toBe(1)
    expect(advanceMoves(replay, 10).specialTime!.charges).toBe(2)
  })
  it('restores a skipped capped event, consumed charge and subsequent new event', () => {
    const capped = charged(5, { interval: 1, maxCharges: 1 }), undone = undoSession(capped)
    const edited = editSessionTile(undone, emptyIndex(undone), 128), restored = decodeGame(encodeGame(edited)).session
    expect(step(restored).specialTime!.charges).toBe(0)
    expect(step(step(restored)).specialTime!.charges).toBe(1)
  })
  it('round trips negative edit deltas and validates the following deterministic move', () => {
    const before = charged(10, {}, { special: { ...DEFAULT_SPECIAL, enabled: true, value: 1024 } })
    const index = before.game.position.board.findIndex(t => t?.power === 10), edited = editSessionTile(before, index, 2)
    const restored = decodeGame(encodeGame(edited)).session
    expect(restored.game.editEffects!.massDelta).toBe(-1022n)
    expect(step(restored)).toEqual(step(edited))
  })
  it('round trips repeated occupied/empty edits and merges with exact score/ID accounting', () => {
    let session = charged(8, { interval: 1, maxCharges: 10 })
    for (let i = 0; i < 8; i++) {
      session = editSessionTile(session, i % 3, i % 2 ? 4 : 128)
      session = step(session)
      expect(decodeGame(encodeGame(session)).session).toEqual(session)
    }
  })
  it.each([1, 2, 3])('migrates real-shape v%i sessions with old best records intact', version => {
    const oldSettings = { ...DEFAULT_SETTINGS, ...(version === 3 ? { special: { ...DEFAULT_SPECIAL, enabled: true } } : {}) }
    const old = advanceMoves(createSession(createGame(42, oldSettings)), 5), raw = JSON.parse(encodeGame(old))
    raw.version = version; delete raw.specialTime; delete raw.game.settings.specialTime
    if (version < 3) delete raw.game.settings.special
    if (version === 1) { delete raw.clock; delete raw.overNotifiedReason }
    const best = encodeBests(new Map([[settingsKey(oldSettings), 128n]])), port = memoryStorage({ [GAME_STORAGE_KEY]: JSON.stringify(raw), [BEST_STORAGE_KEY]: best })
    const game = use2048Game(() => 999, port, () => 1000)
    expect(game.state.value).toEqual(old.game); expect(game.timeSettings.value?.enabled ?? false).toBe(false)
    expect(game.bestScore.value).toBe(128n); expect(port.data.get(BEST_STORAGE_KEY)).toBe(best)
    expect(JSON.parse(port.data.get(GAME_STORAGE_KEY)!).version).toBe(SAVE_VERSION)
  })
  it.each([
    ['charges', -1], ['charges', 4], ['charges', 1.5], ['charges', '1'], ['processedEvents', 0], ['processedEvents', 99],
    ['granted', 0], ['granted', 2], ['used', -1], ['used', 1], ['extra', 1],
  ])('rejects forged acquisition state %s=%j', (field, value) => {
    const raw = JSON.parse(encodeGame(charged())); raw.specialTime[field] = value
    expect(() => decodeGame(JSON.stringify(raw))).toThrow()
  })
  it.each([
    ['edits', 0], ['edits', 2], ['emptyEdits', 99], ['lastEditMove', 11], ['lastEditMove', -1],
    ['massDelta', '1'], ['massDelta', '0128'], ['massDelta', 128], ['potentialDelta', '0'], ['potentialDelta', '-0'],
  ])('rejects forged edit accounting %s=%j', (field, value) => {
    const raw = JSON.parse(encodeGame(editedSession())); raw.game.editEffects[field] = value
    expect(() => decodeGame(JSON.stringify(raw))).toThrow()
  })
  it('rejects an impossible grant total below the first capacity-filling events', () => {
    const raw = JSON.parse(encodeGame(charged(5, { interval: 1 })))
    raw.specialTime.granted = 1; raw.specialTime.charges = 1
    expect(() => decodeGame(JSON.stringify(raw))).toThrow()
  })
  it('rejects a reintroduced history from before an edit even if net edit effects are zero', () => {
    const before = charged(20), index = before.game.position.board.findIndex(t => t?.power === 1)
    const a = editSessionTile(before, index, 128), b = editSessionTile(a, index, 2)
    expect(b.game.editEffects!.massDelta).toBe(0n)
    const raw = JSON.parse(encodeGame(b)); raw.history = JSON.parse(encodeGame(before)).history.slice(-1)
    expect(() => decodeGame(JSON.stringify(raw))).toThrow()
  })
  it('rejects special-time state when OFF, missing state when ON and unknown versions', () => {
    const off = JSON.parse(encodeGame(createSession(createGame(42)))); off.specialTime = { charges: 1, processedEvents: 1, granted: 1, used: 0 }
    expect(() => decodeGame(JSON.stringify(off))).toThrow()
    const on = JSON.parse(encodeGame(charged())); on.specialTime = null
    expect(() => decodeGame(JSON.stringify(on))).toThrow()
    on.version = 99; expect(() => decodeGame(JSON.stringify(on))).toThrow()
  })
  it('keeps edited bigint scores as decimal strings and restores the RNG after unlimited Undo', () => {
    const edited = editSessionTile(charged(10, {}, { undoLimit: 'unlimited' }), 0, 128), next = advanceMoves(edited, 20)
    const raw = JSON.parse(encodeGame(next)), restored = decodeGame(JSON.stringify(raw)).session
    expect(typeof raw.game.position.score).toBe('string'); expect(typeof restored.game.position.score).toBe('bigint')
    expect(step(undoSession(restored))).toEqual(step(undoSession(next)))
  })
  it('saves applied rules and resets the ephemeral selection on reload', () => {
    const port = memoryStorage(), session = charged(), store = createGameStorage(port)
    expect(store.saveGame(session).status).toBe('saved')
    const game = use2048Game(() => 999, port)
    game.draftSettings.value.timeInterval = 1
    expect(game.beginTimeEditing()).toBe(true); game.selectTimeCell(emptyIndex(session)); game.selectTimeValue(128)
    expect(game.confirmTimeEdit()).toBe(true)
    const restored = use2048Game(() => 999, port)
    expect(restored.timeCharges.value).toBe(0); expect(restored.timeEditing.value).toBe(false)
    expect(restored.draftSettings.value.timeInterval).toBe(10)
    expect(restored.state.value!.position).toEqual(game.state.value!.position)
  })
  it('continues editing and normal play when storage is denied', () => {
    const game = use2048Game(() => 42, { getItem: () => null, setItem() { throw new DOMException('Denied', 'SecurityError') } })
    game.draftSettings.value = { ...game.draftSettings.value, timeEnabled: true, timeInterval: 1 }
    game.applySettings(); game.dispatchMove('left')
    expect(game.beginTimeEditing()).toBe(true); game.selectTimeCell(0); game.selectTimeValue(128)
    expect(game.confirmTimeEdit()).toBe(true); expect(game.saveResult.value!.status).toBe('failed')
    expect(game.dispatchMove('right')).toBe(true)
  })
  it('falls back to current-only storage after edits without losing rights or RNG', () => {
    const session = advanceMoves(editedSession(), 5), port = memoryStorage(), write = port.setItem
    port.setItem = (key, text) => { if (JSON.parse(text).history.length) throw new DOMException('Full', 'QuotaExceededError'); write(key, text) }
    expect(createGameStorage(port).saveGame(session).status).toBe('history-omitted')
    const restored = decodeGame(port.data.get(GAME_STORAGE_KEY)!).session
    expect(restored.specialTime).toEqual(session.specialTime); expect(restored.game).toEqual(session.game)
    expect(step(restored).game.position).toEqual(step(session).game.position)
  })
  it('recovers from corrupted progress without losing valid special-time bests', () => {
    const settings = timeSettings(), best = encodeBests(new Map([[settingsKey(settings), 256n]]))
    const port = memoryStorage({ [GAME_STORAGE_KEY]: '{broken', [BEST_STORAGE_KEY]: best }), game = use2048Game(() => 42, port)
    expect(game.restoreMessage.value).toContain('不正'); expect(game.state.value!.settings).toEqual(DEFAULT_SETTINGS)
    expect(createGameStorage(port).bestFor(settings)).toBe(256n)
  })
})

describe('combined best score keys', () => {
  it('retains exact prior keys when special time is OFF regardless of draft values', () => {
    for (const special of [undefined, { ...DEFAULT_SPECIAL, enabled: true }]) {
      const old = { ...DEFAULT_SETTINGS, ...(special ? { special } : {}) }
      const off = { ...old, specialTime: { ...timeSettings().specialTime!, enabled: false, interval: 1, maxCharges: 10, values: [2] as const } }
      expect(settingsKey(off)).toBe(settingsKey(old))
    }
  })
  it('separates interval, cap, allowed values and automatic special tiles', () => {
    const variants = [timeSettings(), timeSettings({ interval: 5 }), timeSettings({ maxCharges: 5 }), timeSettings({ values: [2, 4] }),
      timeSettings({}, { special: { ...DEFAULT_SPECIAL, enabled: true } })]
    const port = memoryStorage(), repository = createGameStorage(port)
    variants.forEach((settings, i) => repository.updateBest(settings, BigInt(i + 1) * 128n))
    const restored = createGameStorage(port)
    variants.forEach((settings, i) => expect(restored.bestFor(settings)).toBe(BigInt(i + 1) * 128n))
    expect(decodeBests(port.data.get(BEST_STORAGE_KEY)!).entries.size).toBe(5)
  })
  it('compares allowed values as a set and preserves large cumulative edited-game bests', () => {
    expect(settingsKey(timeSettings({ values: [128, 2] }))).toBe(settingsKey(timeSettings({ values: [2, 128] })))
    const settings = timeSettings({}, { size: 3 }), score = 9007199254741000n
    expect(decodeBests(encodeBests(new Map([[settingsKey(settings), score]]))).entries.get(settingsKey(settings))).toBe(score)
  })
})
