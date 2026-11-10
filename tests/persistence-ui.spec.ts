// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import App from '../src/App.vue'
import { use2048Game } from '../src/composables/use2048Game.ts'
import { DEFAULT_SETTINGS, dismissSessionPopup, moveSession, undoSession } from '../src/core/index.ts'
import { BEST_STORAGE_KEY, GAME_STORAGE_KEY } from '../src/services/gameStorage.ts'
import { decodeGame, encodeBests, encodeGame, settingsKey } from '../src/services/gameCodec.ts'
import { advance, atGameOver, atGoal, memoryStorage, sessionFor } from './session-fixtures.ts'

if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function () {}
if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () {}
const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open') })
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => { if (array instanceof Uint32Array) array[0] = 0; return array })
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  document.body.innerHTML = ''; document.body.style.overflow = ''
  vi.restoreAllMocks()
})
function app() { const wrapper = mount(App, { attachTo: document.body }); wrappers.push(wrapper); return wrapper }
function unmount(wrapper: VueWrapper) { wrapper.unmount(); wrappers.splice(wrappers.indexOf(wrapper), 1) }
function progress() { return decodeGame(localStorage.getItem(GAME_STORAGE_KEY)!).session }
async function left(wrapper: VueWrapper) { await wrapper.get('button[aria-label="左に移動"]').trigger('click') }
async function apply(wrapper: VueWrapper) { await wrapper.get('.settings-panel form').trigger('submit'); await nextTick() }

describe('persistent game-state integration', () => {
  it('restores a saved game without requesting a new random seed', () => {
    const port = memoryStorage(), game = use2048Game(() => 0, port)
    game.dispatchMove('left'); game.dispatchMove('down')
    const seed = vi.fn(() => 42), restored = use2048Game(seed, port)
    expect(seed).not.toHaveBeenCalled(); expect(restored.state.value).toEqual(game.state.value)
    expect(restored.restoreMessage.value).toContain('復元しました')
    game.dispatchMove('right'); restored.dispatchMove('right')
    expect(restored.state.value!.position).toEqual(game.state.value!.position)
  })
  it('persists Undo count and exact RNG, with the same spawn on the repeated move', () => {
    const port = memoryStorage(), game = use2048Game(() => 0, port)
    game.dispatchMove('left'); const after = game.state.value!.position
    expect(game.undo()).toBe(true); expect(game.undoUsed.value).toBe(1)
    const restored = use2048Game(() => 42, port)
    expect(restored.undoUsed.value).toBe(1); expect(restored.remainingUndo.value).toBe(9)
    expect(restored.canUndo.value).toBe(false)
    restored.dispatchMove('left'); expect(restored.state.value!.position).toEqual(after)
    expect(restored.bestScore.value).toBe(4n)
  })
  it('restores applied settings rather than uncommitted edits', () => {
    const port = memoryStorage(), game = use2048Game(() => 0, port)
    game.draftSettings.value = { size: 6, target: 128, initialTiles: 1, spawn4Percent: 100, undoLimit: 'unlimited' }
    game.applySettings(); game.dispatchMove('left')
    game.draftSettings.value = { size: 3, target: 65536, initialTiles: 100, spawn4Percent: '', undoLimit: 0 }
    const restored = use2048Game(() => 42, port)
    expect(restored.state.value!.settings.size).toBe(6)
    expect(restored.draftSettings.value).toEqual({ size: 6, target: 128, initialTiles: 1, spawn4Percent: 100, undoLimit: 'unlimited' })
  })
  it.each(['{corrupt', '{"version":99}', 'null'])('starts fresh on bad game data %s while preserving valid best data', bad => {
    const best = encodeBests(new Map([[settingsKey(DEFAULT_SETTINGS), 16n]]))
    const port = memoryStorage({ [GAME_STORAGE_KEY]: bad, [BEST_STORAGE_KEY]: best })
    const game = use2048Game(() => 0, port)
    expect(game.moves.value).toBe(0); expect(game.bestScore.value).toBe(16n)
    expect(game.restoreMessage.value).toContain('保存データが不正')
    expect(port.data.get(BEST_STORAGE_KEY)).toBe(best)
    expect(decodeGame(port.data.get(GAME_STORAGE_KEY)!).session.game.position.moveCount).toBe(0)
  })
  it('continues gameplay and Undo when all local storage access is denied', () => {
    const game = use2048Game(() => 0, { getItem() { throw new DOMException('Denied', 'SecurityError') }, setItem() { throw new DOMException('Denied', 'SecurityError') } })
    expect(game.state.value).not.toBeNull(); expect(game.saveResult.value!.status).toBe('failed')
    expect(game.dispatchMove('left')).toBe(true); expect(game.score.value).toBe(4n)
    expect(game.bestScore.value).toBe(4n); expect(game.undo()).toBe(true)
    expect(game.score.value).toBe(0n); expect(game.bestScore.value).toBe(4n)
  })
  it('shows omitted-history restoration explicitly while preserving current progress', () => {
    const saved = advance(sessionFor({ undoLimit: 'unlimited' }), 16)
    const port = memoryStorage({ [GAME_STORAGE_KEY]: encodeGame(saved, true) })
    const restored = use2048Game(() => 42, port)
    expect(restored.state.value!.position).toEqual(saved.game.position)
    expect(restored.historyLength.value).toBe(0); expect(restored.canUndo.value).toBe(false)
    expect(restored.restoreMessage.value).toContain('以前の履歴は使えません')
    expect(restored.saveResult.value!.status).toBe('history-omitted')
  })
  it('resets history and Undo uses on both regular and configured new games', () => {
    const game = use2048Game(() => 0, memoryStorage())
    game.dispatchMove('left'); game.undo(); expect(game.undoUsed.value).toBe(1)
    game.newGame(); expect(game.undoUsed.value).toBe(0); expect(game.historyLength.value).toBe(0)
    game.dispatchMove('left'); game.draftSettings.value = { ...game.draftSettings.value, undoLimit: 1 }; game.applySettings()
    expect(game.undoUsed.value).toBe(0); expect(game.historyLength.value).toBe(0); expect(game.remainingUndo.value).toBe(1)
  })
})

describe('Undo, best score and persistence UI', () => {
  it.each(['0', '1', '10', 'unlimited'])('applies Undo budget %s and reports remaining uses', async limit => {
    const wrapper = app()
    expect(wrapper.findAll('#setting-undo option')).toHaveLength(12)
    await wrapper.get('#setting-undo').setValue(limit); await apply(wrapper)
    await left(wrapper)
    expect(wrapper.get('.undo-remaining').text()).toContain(limit === 'unlimited' ? '無制限' : `${limit}回`)
    expect(wrapper.get('.undo-button').attributes('disabled') !== undefined).toBe(limit === '0')
    if (limit !== '0') {
      await wrapper.get('.undo-button').trigger('click'); await nextTick()
      expect(wrapper.get('.score').text()).toBe('0'); expect(wrapper.get('.max-tile').text()).toBe('2')
      expect(wrapper.get('.move-count').text()).toBe('0'); expect(wrapper.get('.undo-remaining').text()).toContain('使用1回')
      expect(progress().undoUsed).toBe(1)
    }
  })
  it('saves every valid action, skips no-op moves, restores and replays exactly', async () => {
    const seed = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const wrapper = app(), initial = localStorage.getItem(GAME_STORAGE_KEY)
    await wrapper.get('button[aria-label="上に移動"]').trigger('click')
    expect(localStorage.getItem(GAME_STORAGE_KEY)).toBe(initial)
    await left(wrapper); const after = progress().game.position
    expect(wrapper.get('.save-status').text()).toBe('自動保存済み')
    expect(wrapper.get('.best-score').text()).toBe('4')
    await wrapper.get('.undo-button').trigger('click')
    expect(wrapper.get('.best-score').text()).toBe('4')
    unmount(wrapper); const restored = app()
    expect(seed).toHaveBeenCalledTimes(1)
    expect(restored.get('.restore-status').text()).toContain('復元しました')
    expect(restored.get('.undo-remaining').text()).toContain('残り：9回 · 使用1回')
    await left(restored); expect(progress().game.position).toEqual(after)
  })
  it('keeps best records separated by Undo configuration and shows the previous condition again', async () => {
    const wrapper = app(); await left(wrapper)
    expect(wrapper.get('.best-score').text()).toBe('4')
    await wrapper.get('#setting-undo').setValue('0'); await apply(wrapper)
    expect(wrapper.get('.best-score').text()).toBe('0')
    await left(wrapper); expect(wrapper.get('.best-score').text()).toBe('4')
    await wrapper.get('#setting-undo').setValue('10'); await apply(wrapper)
    expect(wrapper.get('.best-score').text()).toBe('4')
    expect(Object.keys(JSON.parse(localStorage.getItem(BEST_STORAGE_KEY)!).records)).toHaveLength(2)
  })
  it('resets history and use counts without erasing the best on a new game', async () => {
    const wrapper = app(); await left(wrapper); await wrapper.get('.undo-button').trigger('click')
    await wrapper.get('.new-game').trigger('click')
    expect(progress().history).toEqual([]); expect(progress().undoUsed).toBe(0)
    expect(wrapper.get('.best-score').text()).toBe('4')
    expect(wrapper.get('.undo-button').attributes()).toHaveProperty('disabled')
    expect(wrapper.get('.undo-remaining').text()).toContain('残り：10回 · 使用0回')
  })
  it('preserves goal state and notification through Undo and reloading', async () => {
    const goal = atGoal(); localStorage.setItem(GAME_STORAGE_KEY, encodeGame(goal))
    const wrapper = app()
    expect(wrapper.get('dialog h2').text()).toBe('128達成！おめでとう！')
    const best = wrapper.get('.best-score').text()
    await wrapper.get('.dialog-continue').trigger('click'); await wrapper.get('.undo-button').trigger('click')
    expect(wrapper.get('.max-tile').text()).toBe('64')
    expect(wrapper.get('.game-status').text()).toContain('目標達成')
    expect(wrapper.get('.best-score').text()).toBe(best)
    expect(progress().goalNotified).toBe(true)
    unmount(wrapper); const restored = app()
    expect(restored.find('dialog').exists()).toBe(false)
    const undone = undoSession(dismissSessionPopup(goal))
    const direction = (['left', 'right', 'up', 'down'] as const).find(direction => JSON.stringify(moveSession(undone, direction).game.position.board) === JSON.stringify(goal.game.position.board))!
    const names = { left: '左', right: '右', up: '上', down: '下' }
    await restored.get(`button[aria-label="${names[direction]}に移動"]`).trigger('click')
    expect(restored.find('dialog').exists()).toBe(false)
    expect(progress().game.position).toEqual(goal.game.position)
    expect(progress().undoUsed).toBe(1)
  })
  it('restores a finished game and allows Undo directly inside its popup', async () => {
    const ended = atGameOver(); localStorage.setItem(GAME_STORAGE_KEY, encodeGame(ended))
    const wrapper = app()
    expect(wrapper.get('dialog h2').text()).toBe('ゲームオーバー')
    expect(wrapper.find('.dialog-undo').exists()).toBe(true)
    expect(wrapper.get('.undo-button').attributes()).toHaveProperty('disabled')
    await wrapper.get('.dialog-undo').trigger('click'); await nextTick()
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(wrapper.get('.move-count').text()).toBe(String(ended.game.position.moveCount - 1))
    expect(progress().game.position).toEqual(ended.history.at(-1))
    expect(progress().undoUsed).toBe(1)
    expect(document.activeElement).toBe(wrapper.get('.game-surface').element)
    expect(wrapper.get('button[aria-label="左に移動"]').attributes('disabled')).toBeUndefined()
  })
  it('keeps a closed, initially stuck game locked after restoring, with no Undo fabricated', async () => {
    const ended = dismissSessionPopup(sessionFor({ size: 3, initialTiles: 9, spawn4Percent: 50 }, 6))
    localStorage.setItem(GAME_STORAGE_KEY, encodeGame(ended))
    const wrapper = app()
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(wrapper.get('.undo-button').attributes()).toHaveProperty('disabled')
    expect(wrapper.get('button[aria-label="左に移動"]').attributes()).toHaveProperty('disabled')
    await wrapper.get('.game-surface').trigger('keydown', { key: 'ArrowLeft' })
    expect(progress().game.position.moveCount).toBe(0)
  })
  it('reports quota fallback, keeps unlimited history in memory and warns after reloading', async () => {
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === GAME_STORAGE_KEY && JSON.parse(value).history.length) throw new DOMException('Full', 'QuotaExceededError')
      original.call(this, key, value)
    })
    const wrapper = app(); await wrapper.get('#setting-undo').setValue('unlimited'); await apply(wrapper)
    await left(wrapper)
    expect(wrapper.get('.save-status').text()).toContain('Undo履歴はこの画面では維持')
    expect(wrapper.get('.undo-button').attributes('disabled')).toBeUndefined()
    expect(JSON.parse(localStorage.getItem(GAME_STORAGE_KEY)!).historyOmitted).toBe(true)
    unmount(wrapper); const restored = app()
    expect(restored.get('.restore-status').text()).toContain('以前の履歴は使えません')
    expect(restored.get('.undo-button').attributes()).toHaveProperty('disabled')
    expect(restored.get('.move-count').text()).toBe('1')
    expect(restored.get('.best-score').text()).toBe('4')
  })
  it('shows read/write errors without preventing button gameplay', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
    const wrapper = app(); await left(wrapper)
    expect(wrapper.get('.save-status').text()).toContain('保存できません')
    expect(wrapper.get('.best-storage-status').text()).toContain('保存できません')
    expect(wrapper.get('.score').text()).toBe('4')
    expect(wrapper.get('.best-score').text()).toBe('4')
    await wrapper.get('.undo-button').trigger('click')
    expect(wrapper.get('.score').text()).toBe('0')
  })
})
