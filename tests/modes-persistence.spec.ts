import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, canUndoSession, dismissSessionPopup, moveSession, observeSession, remainingTimeMs, sessionEndReason, undoSession } from '../src/core/index.ts'
import { use2048Game } from '../src/composables/use2048Game.ts'
import { SAVE_VERSION, decodeBests, decodeGame, encodeBests, encodeGame, settingsKey } from '../src/services/gameCodec.ts'
import { BEST_STORAGE_KEY, GAME_STORAGE_KEY } from '../src/services/gameStorage.ts'
import { advance, memoryStorage, sessionFor } from './session-fixtures.ts'
import { timed, v1Save } from './mode-fixtures.ts'

describe('v2 progress clocks and v1 migration', () => {
  it('preserves an unstarted timed game until the first effective move after restore', () => {
    const initial = timed(), restored = decodeGame(encodeGame(initial), 100000).session
    expect(restored.clock).toEqual(initial.clock)
    expect(remainingTimeMs(restored)).toBe(10000)
    const moved = moveSession(restored, 'left', 200000)
    expect(moved.clock.deadlineMs).toBe(210000)
  })
  it('preserves the fixed deadline across reload and Undo', () => {
    const moved = moveSession(timed(300), 'left', 1000)
    const restored = decodeGame(encodeGame(moved), 101000).session
    expect(restored.clock.deadlineMs).toBe(301000); expect(remainingTimeMs(restored)).toBe(200000)
    const undone = undoSession(restored, undefined, 102000)
    expect(undone.clock.deadlineMs).toBe(301000); expect(undone.game.position.moveCount).toBe(0)
    expect(decodeGame(encodeGame(undone), 201000).session.clock.deadlineMs).toBe(301000)
  })
  it.each([11000, 11001, 999999])('expires a saved game at restored time %i without trusting its playing flag', now => {
    const started = moveSession(timed(), 'left', 1000), expired = decodeGame(encodeGame(started), now).session
    expect(sessionEndReason(expired)).toBe('time-expired'); expect(expired.popup).toBe('game-over')
    expect(canUndoSession(expired)).toBe(false); expect(expired.game.position).toEqual(started.game.position)
  })
  it('cannot resurrect expired time by restoring at an earlier wall clock', () => {
    const expired = observeSession(moveSession(timed(), 'left', 1000), 11000)
    const restored = decodeGame(encodeGame(dismissSessionPopup(expired, 11000)), 2000).session
    expect(sessionEndReason(restored)).toBe('time-expired'); expect(restored.popup).toBeNull()
  })
  it.each([
    { startedAtMs: null, deadlineMs: 11000, lastObservedAtMs: null },
    { startedAtMs: 1000, deadlineMs: 12000, lastObservedAtMs: 1000 },
    { startedAtMs: 1000, deadlineMs: 11000, lastObservedAtMs: 999 },
    { startedAtMs: -1, deadlineMs: 9999, lastObservedAtMs: 1000 },
    { startedAtMs: 1000.5, deadlineMs: 11000.5, lastObservedAtMs: 1001 },
    { startedAtMs: 1000, deadlineMs: 11000, lastObservedAtMs: '1000' },
    { startedAtMs: null, deadlineMs: null, lastObservedAtMs: null },
  ])('rejects inconsistent clocks in an already played game %j', clock => {
    const raw = JSON.parse(encodeGame(moveSession(timed(), 'left', 1000))) as Record<string, unknown>
    raw.clock = clock
    expect(() => decodeGame(JSON.stringify(raw), 1000)).toThrow()
  })
  it('rejects a forged non-empty clock for normal mode', () => {
    const raw = JSON.parse(encodeGame(sessionFor())) as Record<string, unknown>
    raw.clock = { startedAtMs: 0, deadlineMs: 10000, lastObservedAtMs: 0 }
    expect(() => decodeGame(JSON.stringify(raw))).toThrow()
  })
  it('restores legacy STEP 4 history, Undo count and best keys without changing them', () => {
    const session = undoSession(advance(sessionFor(), 10)), old = v1Save(encodeGame(session))
    const result = decodeGame(old, 123456)
    expect(result.migratedFromV1).toBe(true); expect(result.session).toEqual(session)
    expect(JSON.parse(encodeGame(result.session)).version).toBe(SAVE_VERSION)
    expect(settingsKey(DEFAULT_SETTINGS)).toBe('[1,4,2048,2,10,10,["normal"]]')
  })
  it('migrates legacy progress in place and keeps valid STEP 4 best records', () => {
    const old = v1Save(encodeGame(moveSession(sessionFor(), 'left')))
    const best = encodeBests(new Map([[settingsKey(DEFAULT_SETTINGS), 16n]]))
    const port = memoryStorage({ [GAME_STORAGE_KEY]: old, [BEST_STORAGE_KEY]: best })
    const game = use2048Game(() => 42, port, () => 1000)
    expect(game.score.value).toBe(4n); expect(game.bestScore.value).toBe(16n)
    expect(JSON.parse(port.data.get(GAME_STORAGE_KEY)!).version).toBe(SAVE_VERSION)
    expect(port.data.get(BEST_STORAGE_KEY)).toBe(best)
  })
  it('does not infer a deadline from a legacy payload that claims timed mode', () => {
    const old = v1Save(encodeGame(moveSession(timed(), 'left', 1000)))
    expect(() => decodeGame(old, 2000)).toThrow()
  })
  it('persists a newly expired state on restoration', () => {
    const saved = moveSession(timed(), 'left', 1000), port = memoryStorage({ [GAME_STORAGE_KEY]: encodeGame(saved) })
    const game = use2048Game(() => 42, port, () => 11000)
    expect(game.endReason.value).toBe('time-expired'); expect(game.canUndo.value).toBe(false)
    expect(decodeGame(port.data.get(GAME_STORAGE_KEY)!).session.clock.lastObservedAtMs).toBe(11000)
  })
  it('restores move-limit ends and allows Undo without restoring extra move allowance', () => {
    const session = moveSession(sessionFor({ mode: { kind: 'moves', limit: 1 } }), 'left')
    const restored = decodeGame(encodeGame(session), 999999).session
    expect(sessionEndReason(restored)).toBe('move-limit')
    const undone = undoSession(restored)
    expect(undone.game.position.moveCount).toBe(0); expect(undone.undoUsed).toBe(1)
    expect(moveSession(undone, 'left').game.position).toEqual(session.game.position)
  })
})

describe('limit-specific best scores and injected-clock game state', () => {
  it('separates modes and each limit, preserving legacy normal records', () => {
    const settings = [DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, mode: { kind: 'timed' as const, seconds: 10 } }, { ...DEFAULT_SETTINGS, mode: { kind: 'timed' as const, seconds: 300 } }, { ...DEFAULT_SETTINGS, mode: { kind: 'moves' as const, limit: 1 } }, { ...DEFAULT_SETTINGS, mode: { kind: 'moves' as const, limit: 1000 } }]
    const entries = new Map(settings.map((s, i) => [settingsKey(s), BigInt((i + 1) * 4)]))
    expect(entries.size).toBe(5)
    const decoded = decodeBests(encodeBests(entries))
    settings.forEach((s, i) => expect(decoded.entries.get(settingsKey(s))).toBe(BigInt((i + 1) * 4)))
  })
  it('keeps a draft mode uncommitted and refuses invalid limits without changing the game', () => {
    let now = 1000
    const game = use2048Game(() => 0, memoryStorage(), () => now)
    game.dispatchMove('left'); const before = game.state.value
    game.draftSettings.value = { ...game.draftSettings.value, modeKind: 'timed', timeSeconds: 9 }
    expect(game.applySettings()).toBe(false); expect(game.state.value).toBe(before)
    game.draftSettings.value = { ...game.draftSettings.value, timeSeconds: 10 }
    expect(game.state.value).toBe(before); expect(game.applySettings()).toBe(true)
    expect(game.clockStarted.value).toBe(false); expect(game.timeLabel.value).toBe('00:10')
    now = 5000; expect(game.dispatchMove('up')).toBe(false); expect(game.clockStarted.value).toBe(false)
    expect(game.dispatchMove('left')).toBe(true); expect(game.clockRunning.value).toBe(true)
    now = 15000; expect(game.dispatchMove('down')).toBe(false)
    expect(game.endReason.value).toBe('time-expired'); expect(game.undo()).toBe(false)
  })
  it('enforces deadline Undo rejection with no display refresh between input events', () => {
    let now = 1000
    const game = use2048Game(() => 0, memoryStorage(), () => now)
    game.draftSettings.value = { ...game.draftSettings.value, modeKind: 'timed', timeSeconds: 10 }; game.applySettings()
    game.dispatchMove('left'); expect(game.canUndo.value).toBe(true)
    now = 11000; expect(game.undo()).toBe(false)
    expect(game.moves.value).toBe(1); expect(game.undoUsed.value).toBe(0); expect(game.popup.value).toBe('game-over')
  })
  it('reinitializes mode clocks and counts on an applied or ordinary new game', () => {
    let now = 1000
    const game = use2048Game(() => 0, memoryStorage(), () => now)
    game.draftSettings.value = { ...game.draftSettings.value, modeKind: 'timed', timeSeconds: 10 }; game.applySettings(); game.dispatchMove('left')
    now = 9000; game.newGame(); expect(game.clockStarted.value).toBe(false); expect(game.timeLabel.value).toBe('00:10')
    expect(game.moves.value).toBe(0); expect(game.undoUsed.value).toBe(0)
    game.draftSettings.value = { ...game.draftSettings.value, modeKind: 'moves', moveLimit: 1 }; game.applySettings(); game.dispatchMove('left')
    expect(game.endReason.value).toBe('move-limit'); expect(game.undo()).toBe(true); expect(game.movesLeft.value).toBe(1)
  })
})
