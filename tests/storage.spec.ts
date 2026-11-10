import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS, createGame, createSession, dismissSessionPopup, moveSession, undoSession,
  type GameState, type Position,
} from '../src/core/index.ts'
import { decodeBests, decodeGame, encodeBests, encodeGame, scoreString, settingsKey, MAX_SERIALIZED_HISTORY_CELLS } from '../src/services/gameCodec.ts'
import { BEST_STORAGE_KEY, GAME_STORAGE_KEY, createGameStorage } from '../src/services/gameStorage.ts'
import { advance, atGameOver, atGoal, memoryStorage, sessionFor } from './session-fixtures.ts'

function parsed(text: string): Record<string, unknown> { return JSON.parse(text) as Record<string, unknown> }
function tamper(session: ReturnType<typeof sessionFor>, change: (raw: Record<string, unknown>) => void) {
  const raw = parsed(encodeGame(session)); change(raw); return JSON.stringify(raw)
}
describe('versioned decimal bigint codec', () => {
  it('round-trips a real game including history, IDs and RNG', () => {
    const session = advance(sessionFor(), 16), text = encodeGame(session), decoded = decodeGame(text)
    expect(decoded.session).toEqual(session); expect(decoded.historyOmitted).toBe(false)
    const raw = parsed(text), game = raw.game as Record<string, unknown>, position = game.position as Record<string, unknown>
    expect(position.score).toBe(session.game.position.score.toString())
    expect(typeof position.score).toBe('string')
  })
  it('round-trips a coherent bigint score larger than Number.MAX_SAFE_INTEGER', () => {
    const base = createGame(0, { ...DEFAULT_SETTINGS, size: 10, initialTiles: 1, spawn4Percent: 100 })
    const count = 2 ** 51, board = Array<null | { id: number; power: number }>(100).fill(null)
    board[0] = { id: 2 * count - 1, power: 53 }
    const position: Position = { ...base.position, board, score: (1n << 53n) * 51n, moveCount: count - 1, nextTileId: 2 * count }
    const game: GameState = { ...base, position, revision: count - 1, maxPowerEver: 53 }
    const session = { ...createSession(game), goalNotified: true }
    const restored = decodeGame(encodeGame(session)).session
    expect(restored.game.position.score).toBe(position.score)
    expect(restored.game.position.score).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER))
  })
  it.each(['-4', '1', '1.0', '4e0', '04', '+4', '', 'NaN', 'Infinity', '4'.repeat(65), 4, null])('rejects noncanonical score %j', value => {
    expect(() => scoreString(value)).toThrow()
  })
  it('restores the exact following move, including the spawned tile', () => {
    const session = advance(sessionFor(), 11), restored = decodeGame(encodeGame(session)).session
    expect(moveSession(restored, 'down')).toEqual(moveSession(session, 'down'))
    const undone = undoSession(restored)
    expect(undone.game.position).toEqual(session.history.at(-1))
  })
  it('restores sticky goal notification after Undo and never repeats it', () => {
    const session = undoSession(dismissSessionPopup(atGoal())), restored = decodeGame(encodeGame(session)).session
    expect(restored.goalNotified).toBe(true); expect(restored.game.maxPowerEver).toBe(session.game.maxPowerEver)
    expect(moveSession(restored, 'down').popup).not.toBe('goal')
    expect(restored.undoUsed).toBe(1)
  })
  it('restores both a pending and a closed game-over popup', () => {
    const ended = atGameOver()
    expect(decodeGame(encodeGame(ended)).session.popup).toBe('game-over')
    expect(decodeGame(encodeGame(dismissSessionPopup(ended))).session.popup).toBeNull()
  })
  it('ignores a forged saved end flag and derives the board status again', () => {
    const playable = moveSession(sessionFor(), 'left')
    const text = tamper(playable, raw => { raw.status = 'game-over'; raw.popup = 'game-over' })
    expect(decodeGame(text).session.popup).toBeNull()
    const locked = atGameOver(), other = tamper(locked, raw => { raw.status = 'playing' })
    expect(decodeGame(other).session.popup).toBe('game-over')
  })
  it('accepts equivalent object-key ordering in valid payloads', () => {
    const session = advance(sessionFor(), 8), raw = parsed(encodeGame(session))
    const history = raw.history as Record<string, unknown>[]
    raw.history = history.map(item => Object.fromEntries(Object.entries(item).reverse()))
    expect(decodeGame(JSON.stringify(raw)).session).toEqual(session)
  })
  it.each([
    { name: 'unknown version', change: (r: Record<string, unknown>) => { r.version = 99 } },
    { name: 'unknown rules', change: (r: Record<string, unknown>) => { (r.game as Record<string, unknown>).rulesVersion = 'future' } },
    { name: 'negative Undo count', change: (r: Record<string, unknown>) => { r.undoUsed = -1 } },
    { name: 'excess Undo count', change: (r: Record<string, unknown>) => { r.undoUsed = 11 } },
    { name: 'wrong notification type', change: (r: Record<string, unknown>) => { r.goalNotified = 'true' } },
    { name: 'forged goal notification', change: (r: Record<string, unknown>) => { r.goalNotified = true } },
    { name: 'invalid popup', change: (r: Record<string, unknown>) => { r.popup = 'unknown' } },
    { name: 'wrong status type', change: (r: Record<string, unknown>) => { r.status = ['playing'] } },
    { name: 'refunded Undo counter', change: (r: Record<string, unknown>) => { r.undoUsed = 1 } },
    { name: 'invalid status', change: (r: Record<string, unknown>) => { r.status = 'time-expired' } },
    { name: 'omitted history contradiction', change: (r: Record<string, unknown>) => { r.historyOmitted = true } },
    { name: 'history type mismatch', change: (r: Record<string, unknown>) => { r.history = {} } },
    { name: 'future notification revision', change: (r: Record<string, unknown>) => { r.overNotifiedRevision = 1000 } },
  ])('rejects $name', ({ change }) => {
    expect(() => decodeGame(tamper(moveSession(sessionFor(), 'left'), change))).toThrow()
  })
  it.each([
    { name: 'duplicate ID', change: (p: Record<string, unknown>) => { const b = p.board as { id: number; power: number }[]; const used = b.filter(Boolean); used[1]!.id = used[0]!.id } },
    { name: 'invalid exponent', change: (p: Record<string, unknown>) => { (p.board as { power: number }[]).find(Boolean)!.power = 129 } },
    { name: 'fractional exponent', change: (p: Record<string, unknown>) => { (p.board as { power: number }[]).find(Boolean)!.power = 1.5 } },
    { name: 'next tile ID', change: (p: Record<string, unknown>) => { p.nextTileId = 999 } },
    { name: 'impossible mass', change: (p: Record<string, unknown>) => { (p.board as { power: number }[]).find(Boolean)!.power = 12 } },
    { name: 'negative count', change: (p: Record<string, unknown>) => { p.moveCount = -1 } },
    { name: 'score type', change: (p: Record<string, unknown>) => { p.score = 4 } },
    { name: 'impossible score', change: (p: Record<string, unknown>) => { p.score = '9999999999999999999999999999999999999999999999999999999999999996' } },
    { name: 'invalid RNG', change: (p: Record<string, unknown>) => { (p.rng as Record<string, unknown>).state = -1 } },
    { name: 'unknown RNG algorithm', change: (p: Record<string, unknown>) => { (p.rng as Record<string, unknown>).algorithm = 'other' } },
  ])('rejects position $name', ({ change }) => {
    expect(() => decodeGame(tamper(moveSession(sessionFor(), 'left'), raw => change((raw.game as Record<string, unknown>).position as Record<string, unknown>)))).toThrow()
  })
  it('rejects a plausible but wrong score even without saved history', () => {
    const raw = parsed(encodeGame(moveSession(sessionFor(), 'left'), true))
    ;((raw.game as Record<string, unknown>).position as Record<string, unknown>).score = '0'
    expect(() => decodeGame(JSON.stringify(raw))).toThrow()
  })
  it('rejects a nonzero starting score even on initial four tiles', () => {
    const raw = parsed(encodeGame(sessionFor({ initialTiles: 1, spawn4Percent: 100 })))
    ;((raw.game as Record<string, unknown>).position as Record<string, unknown>).score = '4'
    expect(() => decodeGame(JSON.stringify(raw))).toThrow()
  })
  it('rejects invalid history RNG even when the current position is valid', () => {
    const session = advance(sessionFor(), 8)
    const text = tamper(session, raw => { const history = raw.history as Record<string, unknown>[]; (history[0]!.rng as Record<string, unknown>).state = 123 })
    expect(() => decodeGame(text)).toThrow()
  })
  it.each(['{bad', 'null', '[]', '{}'])('rejects corrupt JSON or shape %s', text => { expect(() => decodeGame(text)).toThrow() })
})

describe('best record keys and safe storage', () => {
  it('separates every setting condition while excluding the initial seed', () => {
    const base = settingsKey(DEFAULT_SETTINGS)
    for (const patch of [{ size: 3 as const }, { target: 128 as const }, { initialTiles: 1 }, { spawn4Percent: 0 }, { undoLimit: 0 as const }, { undoLimit: 'unlimited' as const }]) expect(settingsKey({ ...DEFAULT_SETTINGS, ...patch })).not.toBe(base)
    expect(settingsKey(createGame(0).settings)).toBe(settingsKey(createGame(123).settings))
    expect(JSON.parse(base)[6]).toEqual(['normal'])
  })
  it('updates only larger scores and persists a decimal string', () => {
    const port = memoryStorage(), store = createGameStorage(port)
    expect(store.updateBest(DEFAULT_SETTINGS, 8n)).toBe(true)
    expect(store.updateBest(DEFAULT_SETTINGS, 4n)).toBe(false); expect(store.updateBest(DEFAULT_SETTINGS, 8n)).toBe(false)
    expect(store.bestFor(DEFAULT_SETTINGS)).toBe(8n)
    expect(JSON.parse(port.data.get(BEST_STORAGE_KEY)!).records[settingsKey(DEFAULT_SETTINGS)]).toBe('8')
    expect(createGameStorage(port).bestFor(DEFAULT_SETTINGS)).toBe(8n)
  })
  it('does not reduce the best after Undo or new-game scores', () => {
    const store = createGameStorage(memoryStorage())
    store.updateBest(DEFAULT_SETTINGS, 16n); store.updateBest(DEFAULT_SETTINGS, 0n)
    expect(store.bestFor(DEFAULT_SETTINGS)).toBe(16n)
  })
  it('retains valid best entries when another entry is malformed', () => {
    const key = settingsKey(DEFAULT_SETTINGS), text = JSON.stringify({ version: 1, records: { [key]: '12', invalid: '999', [settingsKey({ ...DEFAULT_SETTINGS, size: 3 })]: '-4' } })
    const decoded = decodeBests(text)
    expect(decoded.entries.get(key)).toBe(12n); expect(decoded.entries.size).toBe(1); expect(decoded.skipped).toBe(true)
  })
  it.each(['{', '{"version":99,"records":{}}', '{"version":1,"records":[]}'])('rejects malformed or unknown-version best payload %s', text => {
    expect(() => decodeBests(text)).toThrow()
  })
  it('round-trips a large valid best as bigint rather than Number', () => {
    const settings = { ...DEFAULT_SETTINGS, size: 10 as const }, score = 9007199254741000n
    const map = new Map([[settingsKey(settings), score]])
    expect(decodeBests(encodeBests(map)).entries.get(settingsKey(settings))).toBe(score)
  })
  it('continues in memory and retries dirty best records after a write rejection', () => {
    const port = memoryStorage(), write = port.setItem; let fail = true
    port.setItem = (key, value) => { if (fail) throw new DOMException('Denied', 'SecurityError'); write(key, value) }
    const store = createGameStorage(port)
    expect(store.updateBest(DEFAULT_SETTINGS, 12n)).toBe(true); expect(store.bestFor(DEFAULT_SETTINGS)).toBe(12n)
    expect(store.bestMessage()).toContain('保存できません')
    fail = false; expect(store.updateBest(DEFAULT_SETTINGS, 12n)).toBe(false)
    expect(store.bestMessage()).toBe(''); expect(createGameStorage(port).bestFor(DEFAULT_SETTINGS)).toBe(12n)
  })
  it('handles storage reads and writes being completely denied', () => {
    const store = createGameStorage({ getItem() { throw new DOMException('Denied', 'SecurityError') }, setItem() { throw new DOMException('Denied', 'SecurityError') } })
    expect(store.loadGame().status).toBe('failed'); expect(store.bestFor(DEFAULT_SETTINGS)).toBe(0n)
    expect(store.saveGame(sessionFor()).status).toBe('failed')
    expect(() => store.updateBest(DEFAULT_SETTINGS, 4n)).not.toThrow()
  })
  it('saves only current position on quota exhaustion, preserving in-memory unlimited history', () => {
    const session = advance(sessionFor({ undoLimit: 'unlimited' }), 16), before = session.history
    const port = memoryStorage(), write = port.setItem
    port.setItem = (key, value) => { if (key === GAME_STORAGE_KEY && (JSON.parse(value).history as unknown[]).length) throw new DOMException('Full', 'QuotaExceededError'); write(key, value) }
    const store = createGameStorage(port), result = store.saveGame(session)
    expect(result.status).toBe('history-omitted'); expect(result.message).toContain('再読み込み後は使えません')
    expect(session.history).toBe(before); expect(session.history.length).toBeGreaterThan(10)
    const loaded = store.loadGame()
    expect(loaded.status).toBe('restored')
    if (loaded.status === 'restored') { expect(loaded.data.historyOmitted).toBe(true); expect(loaded.data.session.game.position).toEqual(session.game.position); expect(loaded.data.session.history).toEqual([]) }
  })
  it('reports total quota failure without changing the active game', () => {
    const session = advance(sessionFor(), 4), before = structuredClone(session)
    const store = createGameStorage({ getItem: () => null, setItem() { throw new DOMException('Full', 'QuotaExceededError') } })
    expect(store.saveGame(session).status).toBe('failed'); expect(session).toEqual(before)
  })
  it('prioritizes the current board at the proactive unlimited-history budget and reports omission', () => {
    const session = advance(sessionFor({ size: 10, undoLimit: 'unlimited' }), Math.floor(MAX_SERIALIZED_HISTORY_CELLS / 100) + 10)
    expect(session.history.length * 100).toBeGreaterThan(MAX_SERIALIZED_HISTORY_CELLS)
    const port = memoryStorage(), result = createGameStorage(port).saveGame(session)
    expect(result.status).toBe('history-omitted'); expect(session.history.length).toBeGreaterThan(400)
    expect(decodeGame(port.data.get(GAME_STORAGE_KEY)!).session.game.position).toEqual(session.game.position)
  })
  it('does not overwrite an older valid save if neither write attempt succeeds', () => {
    const old = sessionFor(), port = memoryStorage({ [GAME_STORAGE_KEY]: encodeGame(old) })
    const set = vi.spyOn(port, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    const result = createGameStorage(port).saveGame(moveSession(old, 'left'))
    expect(result.status).toBe('failed'); expect(set).toHaveBeenCalledTimes(2)
    expect(decodeGame(port.data.get(GAME_STORAGE_KEY)!).session).toEqual(old)
  })
})
