// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from '../src/App.vue'
import { use2048Game } from '../src/composables/use2048Game.ts'
import { SPECIAL_VALUES } from '../src/core/index.ts'
import { POP_MS, SLIDE_MS } from '../src/presentation/tiles.ts'
import { GAME_STORAGE_KEY } from '../src/services/gameStorage.ts'

const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => { if (array instanceof Uint32Array) array[0] = 0; return array })
  if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function () {}
  if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () {}
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open') })
})
afterEach(() => {
  wrappers.splice(0).forEach(w => w.unmount()); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''
})
function app() { const w = mount(App, { attachTo: document.body }); wrappers.push(w); return w }
async function enable(w: VueWrapper, interval = 1, value = 32) {
  await w.get('#setting-special').setValue('on')
  await w.get('#setting-special-interval').setValue(String(interval))
  await w.get('#setting-special-value').setValue(String(value))
  await w.get('.settings-panel form').trigger('submit')
}
async function left(w: VueWrapper) { await w.get('button[aria-label="左に移動"]').trigger('click') }
async function tick(ms: number) { vi.advanceTimersByTime(ms); await nextTick() }

describe('special mode settings and presentation', () => {
  it('defaults OFF, 5 and 32; disables dependent controls and retains independent probability', async () => {
    const w = app()
    expect((w.get('#setting-special').element as HTMLSelectElement).value).toBe('off')
    expect((w.get('#setting-special-interval').element as HTMLInputElement).value).toBe('5')
    expect((w.get('#setting-special-value').element as HTMLSelectElement).value).toBe('32')
    expect(w.get('#setting-special-interval').attributes()).toHaveProperty('disabled')
    expect(w.get('#setting-special-value').attributes()).toHaveProperty('disabled')
    expect(w.get('#setting-probability').attributes('disabled')).toBeUndefined()
    expect(w.findAll('#setting-special-value option').map(o => Number(o.attributes('value')))).toEqual([...SPECIAL_VALUES])
    expect(w.get('.applied-settings').text()).toContain('スペシャル：OFF')
    expect(w.find('.special-status').exists()).toBe(false)
    await w.get('#setting-special').setValue('on')
    expect(w.get('#setting-special-value').attributes('disabled')).toBeUndefined()
    expect(w.get('#setting-special-interval').attributes('disabled')).toBeUndefined()
  })
  it('edits special settings without changing the active game, then applies atomically', async () => {
    const w = app(); await left(w)
    const before = localStorage.getItem(GAME_STORAGE_KEY), board = w.get('.board').html()
    await w.get('#setting-special').setValue('on'); await w.get('#setting-special-interval').setValue('10'); await w.get('#setting-special-value').setValue('64')
    expect(w.get('.board').html()).toBe(board); expect(localStorage.getItem(GAME_STORAGE_KEY)).toBe(before)
    expect(w.get('.applied-settings').text()).toContain('スペシャル：OFF')
    await w.get('.settings-panel form').trigger('submit')
    expect(w.get('.applied-settings').text()).toContain('スペシャル：10手ごとに64')
    expect(w.get('.move-count').text()).toBe('0'); expect(w.get('.special-status').text()).toContain('あと10手')
    await w.get('#setting-special').setValue('off')
    expect(w.get('.applied-settings').text()).toContain('10手ごとに64')
    await w.get('.settings-panel form').trigger('submit')
    expect(w.get('.applied-settings').text()).toContain('スペシャル：OFF')
    expect(w.find('.special-status').exists()).toBe(false)
  })
  it.each(['', '0', '101', '1.5', '-5'])('shows a reason for invalid interval %s without changing the game', async input => {
    const w = app(), before = localStorage.getItem(GAME_STORAGE_KEY)
    await w.get('#setting-special').setValue('on'); await w.get('#setting-special-interval').setValue(input)
    expect(w.get('.settings-errors').text()).toContain('1〜100手の整数')
    expect(w.get('#setting-special-interval').attributes('aria-invalid')).toBe('true')
    await w.get('.settings-panel form').trigger('submit')
    expect(localStorage.getItem(GAME_STORAGE_KEY)).toBe(before)
  })
  it('does not request a seed or mutate state when an invalid special value is supplied', () => {
    const seed = vi.fn(() => 42), game = use2048Game(seed), before = game.state.value
    game.draftSettings.value.specialEnabled = true; game.draftSettings.value.specialValue = 12
    expect(game.applySettings()).toBe(false); expect(seed).toHaveBeenCalledTimes(1); expect(game.state.value).toBe(before)
  })
  it('shows 5, 2, next move, and 5 again; Undo restores the next-move countdown', () => {
    const game = use2048Game(() => 0)
    game.draftSettings.value = { ...game.draftSettings.value, specialEnabled: true, specialInterval: 5, size: 10 }
    game.applySettings(); expect(game.specialRemaining.value).toBe(5)
    for (const d of ['left', 'down', 'right'] as const) expect(game.dispatchMove(d)).toBe(true)
    expect(game.specialRemaining.value).toBe(2)
    expect(game.dispatchMove('up')).toBe(true); expect(game.specialRemaining.value).toBe(1)
    expect(game.dispatchMove('left')).toBe(true); expect(game.specialRemaining.value).toBe(5)
    expect(game.specialArrival.value).toBe(32)
    game.undo(); expect(game.specialRemaining.value).toBe(1); expect(game.specialArrival.value).toBeNull()
  })
  it('renders a purple-marked single spawn during the existing pop phase, then releases animation', async () => {
    const w = app(); await enable(w); await left(w)
    expect(w.get('.special-status').text()).toContain('次の有効移動で出現')
    expect(w.get('.special-arrival').text()).toContain('32が出現')
    expect(w.findAll('[role="cell"].is-special-spawn')).toHaveLength(1)
    expect(w.get('.board').attributes('data-animation')).toBe('slide')
    await tick(SLIDE_MS)
    expect(w.findAll('.effect-spawn.special-visual')).toHaveLength(1)
    expect(w.get('.effect-spawn.special-visual').text()).toContain('32')
    await tick(POP_MS)
    expect(w.get('.board').attributes('data-animation')).toBe('idle')
    expect(w.findAll('.visual-tile')).toHaveLength(0)
  })
  it('drops stale special marks and pending animation on Undo and new game, with exact replay', async () => {
    const w = app(); await enable(w); await left(w)
    const first = JSON.parse(localStorage.getItem(GAME_STORAGE_KEY)!).game.position
    await w.get('.undo-button').trigger('click')
    expect(w.find('.special-arrival').exists()).toBe(false); expect(w.find('.is-special-spawn').exists()).toBe(false)
    await tick(SLIDE_MS + POP_MS)
    await left(w)
    expect(JSON.parse(localStorage.getItem(GAME_STORAGE_KEY)!).game.position).toEqual(first)
    await w.get('.new-game').trigger('click'); await tick(SLIDE_MS + POP_MS)
    expect(w.find('.special-arrival').exists()).toBe(false); expect(w.find('.special-star').exists()).toBe(false)
    expect(w.get('.board').attributes('data-animation')).toBe('idle')
  })
  it('restores numeric tiles and applied settings without replaying special effects', async () => {
    const w = app(); await enable(w); await left(w)
    const saved = localStorage.getItem(GAME_STORAGE_KEY), cells = w.findAll('[role="cell"]').map(c => c.attributes('data-power'))
    expect(saved).not.toMatch(/specialSpawned|presentation|motions/)
    w.unmount(); wrappers.pop()
    const restored = app()
    expect(restored.findAll('[role="cell"]').map(c => c.attributes('data-power'))).toEqual(cells)
    expect(restored.get('.applied-settings').text()).toContain('1手ごとに32')
    expect(restored.find('.special-star').exists()).toBe(false); expect(restored.find('.special-arrival').exists()).toBe(false)
    expect(restored.get('.board').attributes('data-animation')).toBe('idle')
  })
  it('reduced-motion retains the special indication without timers or engine changes', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const w = app(); await enable(w); await left(w)
    expect(w.get('.board').attributes('data-reduced-motion')).toBe('true')
    expect(w.get('.board').attributes('data-animation')).toBe('idle')
    expect(w.findAll('.is-special-spawn')).toHaveLength(1)
    expect(w.get('.score').text()).toBe('4'); expect(w.get('.move-count').text()).toBe('1')
    expect(w.find('.visual-tile').exists()).toBe(false)
  })
})
