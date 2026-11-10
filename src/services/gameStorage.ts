import type { GameSettings, PlaySession } from '../core/index.ts'
import { decodeBests, decodeGame, encodeBests, encodeGame, settingsKey, HistoryStorageLimitError, type DecodedGame } from './gameCodec.ts'

export const GAME_STORAGE_KEY = 'my-2048-game:progress:v1'
export const BEST_STORAGE_KEY = 'my-2048-game:bests:v1'
export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const browserStorage: StoragePort = {
  getItem: key => globalThis.localStorage.getItem(key),
  setItem: (key, value) => globalThis.localStorage.setItem(key, value),
}
export interface SaveResult { readonly status: 'saved' | 'history-omitted' | 'failed'; readonly message: string }
export type LoadResult = { readonly status: 'restored'; readonly data: DecodedGame } | { readonly status: 'none' | 'invalid' | 'failed' }
function quota(error: unknown): boolean { return typeof error === 'object' && error !== null && 'name' in error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED') }
export function createGameStorage(port: StoragePort) {
  const bests = new Map<string, bigint>()
  let bestMessage = ''
  let bestDirty = false
  function loadBests() {
    try {
      const text = port.getItem(BEST_STORAGE_KEY)
      if (text !== null) {
        const result = decodeBests(text)
        result.entries.forEach((score, key) => bests.set(key, score))
        bestMessage = result.skipped ? '不正なベスト記録を除外し、有効な記録を読み込みました。' : ''
      }
    } catch { bestMessage = 'ベスト記録を読み込めませんでした。この画面では記録を保持して遊べます。' }
  }
  function loadGame(nowMs?: number): LoadResult {
    let text: string | null
    try { text = port.getItem(GAME_STORAGE_KEY) } catch { return { status: 'failed' } }
    if (text === null) return { status: 'none' }
    try { return { status: 'restored', data: decodeGame(text, nowMs) } } catch { return { status: 'invalid' } }
  }
  function saveGame(session: PlaySession): SaveResult {
    let full: string
    try { full = encodeGame(session) }
    catch (error) {
      // Validation and the proactive payload size limit have separate handling.
      try {
        const currentOnly = encodeGame(session, true)
        if (session.history.length && error instanceof HistoryStorageLimitError) {
          port.setItem(GAME_STORAGE_KEY, currentOnly)
          return { status: 'history-omitted', message: '現在の盤面を保存しましたが、Undo履歴は保存できませんでした。履歴はこの画面では維持され、再読み込み後は使えません。' }
        }
      } catch { /* Fall through to the normal failure report. */ }
      return { status: 'failed', message: '進行状態を保存できませんでした。ゲームは続けられますが、再読み込みすると進行が失われる可能性があります。' }
    }
    try { port.setItem(GAME_STORAGE_KEY, full); return { status: 'saved', message: '自動保存済み' } }
    catch (error) {
      if (quota(error) && session.history.length) {
        try {
          port.setItem(GAME_STORAGE_KEY, encodeGame(session, true))
          return { status: 'history-omitted', message: '保存容量が足りないため、現在の盤面だけを保存しました。Undo履歴はこの画面では維持されますが、再読み込み後は使えません。' }
        } catch { /* Current position also could not be saved. */ }
      }
      return { status: 'failed', message: '進行状態を保存できませんでした。ゲームは続けられますが、再読み込みすると進行が失われる可能性があります。' }
    }
  }
  function updateBest(settings: GameSettings, score: bigint): boolean {
    const key = settingsKey(settings), previous = bests.get(key) ?? 0n
    const improved = score > previous
    if (improved) { bests.set(key, score); bestDirty = true }
    if (bestDirty) {
      try { port.setItem(BEST_STORAGE_KEY, encodeBests(bests)); bestMessage = ''; bestDirty = false }
      catch { bestMessage = 'ベスト記録を保存できませんでした。この画面では保持されますが、再読み込み後は失われる可能性があります。' }
    }
    return improved
  }

  loadBests()
  return { loadGame, saveGame, updateBest, bestFor: (settings: GameSettings) => bests.get(settingsKey(settings)) ?? 0n, bestMessage: () => bestMessage }
}
