// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import App from '../src/App.vue'
import { EMPTY_CLOCK, type GameMode } from '../src/core/index.ts'
import { encodeGame } from '../src/services/gameCodec.ts'
import { GAME_STORAGE_KEY } from '../src/services/gameStorage.ts'
import { atGameOver, atGoal } from './session-fixtures.ts'
import { beforeGoal } from './mode-fixtures.ts'
const BASE = 1_000_000
if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function () {}
if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () {}
const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); vi.setSystemTime(BASE)
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open') })
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => { if (array instanceof Uint32Array) array[0] = 0; return array })
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  document.body.innerHTML = ''; document.body.style.overflow = ''
  vi.restoreAllMocks(); vi.useRealTimers()
})
function app() { const wrapper = mount(App, { attachTo: document.body }); wrappers.push(wrapper); return wrapper }
function unmount(wrapper: VueWrapper) { wrapper.unmount(); wrappers.splice(wrappers.indexOf(wrapper), 1) }
async function configure(wrapper: VueWrapper, kind: 'normal' | 'timed' | 'moves', value?: number | string) {
  await wrapper.get('#setting-mode').setValue(kind)
  if (kind === 'timed' && value !== undefined) await wrapper.get('#setting-seconds').setValue(String(value))
  if (kind === 'moves' && value !== undefined) await wrapper.get('#setting-moves').setValue(String(value))
  await wrapper.get('.settings-panel form').trigger('submit'); await nextTick()
}
async function left(wrapper: VueWrapper) { await wrapper.get('button[aria-label="左に移動"]').trigger('click') }
function saved() { return JSON.parse(localStorage.getItem(GAME_STORAGE_KEY)!) as { clock: { startedAtMs: number | null; deadlineMs: number | null }; game: { position: { moveCount: number; score: string; board: unknown }; settings: { mode: GameMode } } } }

describe('mode settings and current-state display', () => {
  it('defaults to normal, 300 seconds and 1000 moves without applying edits', async () => {
    const wrapper = app(); await left(wrapper)
    expect(wrapper.get('.applied-settings').text()).toContain('通常モード')
    await wrapper.get('#setting-mode').setValue('timed')
    expect((wrapper.get('#setting-seconds').element as HTMLInputElement).value).toBe('300')
    expect(wrapper.get('.applied-settings').text()).toContain('通常モード')
    expect(wrapper.get('.move-count').text()).toBe('1'); expect(wrapper.find('.time-remaining').exists()).toBe(false)
    await wrapper.get('#setting-mode').setValue('moves')
    expect((wrapper.get('#setting-moves').element as HTMLInputElement).value).toBe('1000')
    expect(saved().game.settings.mode).toEqual({ kind: 'normal' })
  })
  it.each([{ kind: 'timed' as const, value: 9 }, { kind: 'timed' as const, value: 3601 }, { kind: 'timed' as const, value: '' }, { kind: 'moves' as const, value: 0 }, { kind: 'moves' as const, value: 100001 }, { kind: 'moves' as const, value: 1.5 }])('rejects invalid $kind input $value and retains current game', async ({ kind, value }) => {
    const wrapper = app(); await left(wrapper); const before = localStorage.getItem(GAME_STORAGE_KEY)
    await configure(wrapper, kind, value)
    expect(wrapper.get('.settings-errors').text()).toContain('整数')
    expect(wrapper.get('.apply-settings').attributes()).toHaveProperty('disabled')
    expect(localStorage.getItem(GAME_STORAGE_KEY)).toBe(before)
    expect(wrapper.get('.move-count').text()).toBe('1'); expect(vi.getTimerCount()).toBe(0)
  })
  it.each([{ seconds: 10, label: '00:10' }, { seconds: 300, label: '05:00' }, { seconds: 3600, label: '60:00' }])('formats $seconds seconds as $label before starting', async ({ seconds, label }) => {
    const wrapper = app(); await configure(wrapper, 'timed', seconds)
    expect(wrapper.get('.time-remaining').text()).toBe(label)
    expect(wrapper.get('.limit-status').text()).toContain('有効な移動で開始')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('one display timer and authoritative deadlines', () => {
  it('never starts on no-op input and maintains one interval across moves and Undo', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval'), wrapper = app(); await configure(wrapper, 'timed', 10)
    await wrapper.get('button[aria-label="上に移動"]').trigger('click')
    expect(interval).not.toHaveBeenCalled(); expect(saved().clock.startedAtMs).toBeNull()
    await left(wrapper); expect(interval).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(1)
    const deadline = saved().clock.deadlineMs
    await wrapper.get('button[aria-label="下に移動"]').trigger('click'); await wrapper.get('.undo-button').trigger('click')
    expect(saved().clock.deadlineMs).toBe(deadline); expect(interval).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000); await nextTick(); expect(wrapper.get('.time-remaining').text()).toBe('00:09')
    await wrapper.get('.new-game').trigger('click'); expect(vi.getTimerCount()).toBe(0)
    expect(wrapper.get('.time-remaining').text()).toBe('00:10'); expect(saved().clock.startedAtMs).toBeNull()
    await left(wrapper); expect(vi.getTimerCount()).toBe(1); expect(interval).toHaveBeenCalledTimes(2)
    unmount(wrapper); expect(vi.getTimerCount()).toBe(0)
  })
  it('expires at the exact deadline without accepting a keyboard move', async () => {
    const wrapper = app(); await configure(wrapper, 'timed', 10); await left(wrapper)
    const position = saved().game.position
    vi.setSystemTime(BASE + 10000)
    await wrapper.get('.game-surface').trigger('keydown', { key: 'ArrowDown' })
    expect(saved().game.position).toEqual(position)
    expect(wrapper.get('dialog h2').text()).toBe('時間切れ')
    expect(wrapper.get('.time-remaining').text()).toBe('00:00')
    expect(wrapper.find('.dialog-undo').exists()).toBe(false); expect(vi.getTimerCount()).toBe(0)
    await wrapper.get('.dialog-view-board').trigger('click')
    expect(wrapper.get('.undo-button').attributes()).toHaveProperty('disabled')
    expect(wrapper.get('button[aria-label="左に移動"]').attributes()).toHaveProperty('disabled')
  })
  it('does not allow an Undo click when time expired between display ticks', async () => {
    const wrapper = app(); await configure(wrapper, 'timed', 10); await left(wrapper)
    expect(wrapper.get('.undo-button').attributes('disabled')).toBeUndefined()
    vi.setSystemTime(BASE + 10000)
    await wrapper.get('.undo-button').trigger('click')
    expect(wrapper.get('dialog h2').text()).toBe('時間切れ')
    expect(wrapper.get('.move-count').text()).toBe('1'); expect(wrapper.get('.undo-remaining').text()).toContain('使用0回')
  })
  it('uses fake time to advance seconds, warns in text, and stops once', async () => {
    const wrapper = app(); await configure(wrapper, 'timed', 10); await left(wrapper)
    expect(wrapper.get('.limit-status').text()).toContain('残りわずか')
    vi.advanceTimersByTime(9999); await nextTick()
    expect(wrapper.get('.time-remaining').text()).toBe('00:01'); expect(wrapper.find('dialog').exists()).toBe(false)
    vi.advanceTimersByTime(1); await nextTick()
    expect(wrapper.get('dialog h2').text()).toBe('時間切れ'); expect(vi.getTimerCount()).toBe(0)
    await wrapper.get('dialog').trigger('keydown', { key: 'Escape' }); await nextTick()
    vi.advanceTimersByTime(5000); await nextTick(); expect(wrapper.find('dialog').exists()).toBe(false)
  })
  it('keeps running during a goal popup and transitions to the expired result', async () => {
    const goal = atGoal(), timedGoal = { ...goal, game: { ...goal.game, settings: { ...goal.game.settings, mode: { kind: 'timed' as const, seconds: 10 } } }, clock: { startedAtMs: BASE, deadlineMs: BASE + 10000, lastObservedAtMs: BASE } }
    localStorage.setItem(GAME_STORAGE_KEY, encodeGame(timedGoal))
    const wrapper = app(); expect(wrapper.get('dialog h2').text()).toBe('128達成！おめでとう！')
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(10000); await nextTick()
    expect(wrapper.get('dialog h2').text()).toBe('128達成！おめでとう！')
    expect(wrapper.get('.dialog-continue').text()).toBe('結果を見る')
    expect(wrapper.get('#game-result-description').text()).toContain('時間切れ')
    await wrapper.get('.dialog-continue').trigger('click')
    expect(wrapper.get('dialog h2').text()).toBe('時間切れ'); expect(wrapper.find('.dialog-undo').exists()).toBe(false)
  })
  it('accounts for hidden and closed time, restores the same deadline and does not start a second interval', async () => {
    const wrapper = app(); await configure(wrapper, 'timed', 300); await left(wrapper)
    vi.setSystemTime(BASE + 200000)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange')); await nextTick()
    expect(wrapper.get('.time-remaining').text()).toBe('01:40'); expect(saved().clock.deadlineMs).toBe(BASE + 300000)
    expect(vi.getTimerCount()).toBe(1)
    unmount(wrapper); expect(vi.getTimerCount()).toBe(0)
    vi.setSystemTime(BASE + 300000)
    const restored = app()
    expect(restored.get('dialog h2').text()).toBe('時間切れ'); expect(vi.getTimerCount()).toBe(0)
    expect(restored.get('.restore-status').text()).toContain('復元しました')
    expect(restored.get('.undo-button').attributes()).toHaveProperty('disabled')
  })
  it('keeps focus inside the result if timeout removes the focused Undo action', async () => {
    const ended = atGameOver(), session = { ...ended, game: { ...ended.game, settings: { ...ended.game.settings, mode: { kind: 'timed' as const, seconds: 10 } } }, clock: { startedAtMs: BASE, deadlineMs: BASE + 10000, lastObservedAtMs: BASE } }
    localStorage.setItem(GAME_STORAGE_KEY, encodeGame(session))
    const wrapper = app()
    ;(wrapper.get('.dialog-undo').element as HTMLElement).focus()
    vi.advanceTimersByTime(10000); await nextTick()
    expect(wrapper.get('dialog h2').text()).toBe('時間切れ')
    expect(wrapper.find('.dialog-undo').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('.dialog-new-game').element)
  })
  it('removes page lifecycle listeners and intervals on unmount', async () => {
    const wrapper = app(); await configure(wrapper, 'timed', 10); await left(wrapper)
    const write = vi.spyOn(Storage.prototype, 'setItem')
    unmount(wrapper); const count = write.mock.calls.length
    document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); vi.advanceTimersByTime(10000)
    expect(write).toHaveBeenCalledTimes(count); expect(vi.getTimerCount()).toBe(0)
  })
})

describe('move limit, goals, Undo and record conditions in UI', () => {
  it('ends at one effective move, permits Undo and does not charge invalid input', async () => {
    const wrapper = app(); await configure(wrapper, 'moves', 1)
    expect(wrapper.get('.moves-remaining').text()).toBe('1')
    await wrapper.get('button[aria-label="上に移動"]').trigger('click')
    expect(wrapper.get('.moves-remaining').text()).toBe('1')
    await left(wrapper)
    expect(wrapper.get('.score').text()).toBe('4'); expect(wrapper.get('.moves-remaining').text()).toBe('0')
    expect(wrapper.get('dialog h2').text()).toBe('手数上限に到達')
    await wrapper.get('.dialog-undo').trigger('click'); await nextTick()
    expect(wrapper.find('dialog').exists()).toBe(false); expect(wrapper.get('.moves-remaining').text()).toBe('1')
    expect(wrapper.get('.undo-remaining').text()).toContain('使用1回')
    await left(wrapper); expect(wrapper.get('dialog h2').text()).toBe('手数上限に到達')
    expect(wrapper.get('.move-count').text()).toBe('1')
  })
  it('shows goal first when the winning move uses the last allowance', async () => {
    const goal = atGoal(), mode = { kind: 'moves' as const, limit: goal.game.position.moveCount }
    localStorage.setItem(GAME_STORAGE_KEY, encodeGame({ ...goal, game: { ...goal.game, settings: { ...goal.game.settings, mode } }, clock: EMPTY_CLOCK }))
    const wrapper = app()
    expect(wrapper.get('dialog h2').text()).toBe('128達成！おめでとう！')
    expect(wrapper.get('.dialog-continue').text()).toBe('結果を見る')
    await wrapper.get('.dialog-continue').trigger('click')
    expect(wrapper.get('dialog h2').text()).toBe('手数上限に到達')
    await wrapper.get('.dialog-undo').trigger('click')
    expect(wrapper.get('.moves-remaining').text()).toBe('1')
    const direction = beforeGoal(mode).direction, names = { left: '左', right: '右', up: '上', down: '下' }
    await wrapper.get(`button[aria-label="${names[direction]}に移動"]`).trigger('click')
    expect(wrapper.get('dialog h2').text()).toBe('手数上限に到達')
  })
  it('separates best records by mode and exact limit and restores its applied configuration', async () => {
    const wrapper = app(); await left(wrapper); expect(wrapper.get('.best-score').text()).toBe('4')
    await configure(wrapper, 'timed', 10); expect(wrapper.get('.best-score').text()).toBe('0'); await left(wrapper)
    await configure(wrapper, 'timed', 20); expect(wrapper.get('.best-score').text()).toBe('0'); await left(wrapper)
    await configure(wrapper, 'moves', 1000); expect(wrapper.get('.best-score').text()).toBe('0'); await left(wrapper)
    unmount(wrapper); const restored = app()
    expect(restored.get('.moves-remaining').text()).toBe('999')
    expect((restored.get('#setting-mode').element as HTMLSelectElement).value).toBe('moves')
    expect((restored.get('#setting-moves').element as HTMLInputElement).value).toBe('1000')
    expect(restored.get('.best-score').text()).toBe('4')
    await configure(restored, 'normal'); expect(restored.get('.best-score').text()).toBe('4')
  })
})
