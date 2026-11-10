// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import App from '../src/App.vue'
import GameBoard from '../src/components/GameBoard.vue'
import { use2048Game } from '../src/composables/use2048Game.ts'
import { BOARD_SIZES, DEFAULT_SETTINGS, TARGETS, createGame, type GameState, type SettingsDraft } from '../src/core/index.ts'
import { createGame as realCreateGame } from '../src/core/game.ts'
import { customState, settingsFor } from './custom-fixtures.ts'
import { tiles } from './fixtures.ts'

vi.mock('../src/core/index.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/core/index.ts')>()
  return { ...actual, createGame: vi.fn(actual.createGame) }
})
if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function () {}
if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () {}
const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.mocked(createGame).mockImplementation(realCreateGame)
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open') })
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => { if (array instanceof Uint32Array) array[0] = 0; return array })
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  document.body.innerHTML = ''; document.body.style.overflow = ''
  vi.restoreAllMocks()
})
function app(initial?: GameState) {
  if (initial) vi.mocked(createGame).mockReturnValueOnce(initial)
  const wrapper = mount(App, { attachTo: document.body }); wrappers.push(wrapper); return wrapper
}
function setDraft(game: ReturnType<typeof use2048Game>, patch: Partial<SettingsDraft>) { game.draftSettings.value = { ...game.draftSettings.value, ...patch } }
async function submit(wrapper: VueWrapper) { await wrapper.get('.settings-panel form').trigger('submit'); await nextTick() }

describe('draft and applied settings state', () => {
  it('starts with the unchanged defaults in both places', () => {
    const game = use2048Game(() => 0)
    expect(game.state.value?.settings).toEqual(DEFAULT_SETTINGS)
    expect(game.draftSettings.value).toEqual({ size: 4, target: 2048, initialTiles: 2, spawn4Percent: 10, undoLimit: 10 })
  })
  it('does not change the active game, RNG or popup when any draft setting changes', () => {
    const game = use2048Game(() => 0)
    game.dispatchMove('left'); const before = game.state.value
    setDraft(game, { size: 10, target: 65536, initialTiles: 100, spawn4Percent: 100 })
    expect(game.state.value).toBe(before); expect(game.popup.value).toBeNull()
    expect(game.state.value?.position.moveCount).toBe(1)
  })
  it('applies all valid settings together and resets the Position only on apply', () => {
    let seed = 0
    const game = use2048Game(() => seed)
    game.dispatchMove('left'); setDraft(game, { size: 10, target: 65536, initialTiles: 100, spawn4Percent: 100 })
    seed = 42; expect(game.applySettings()).toBe(true)
    expect(game.state.value).toEqual(realCreateGame(42, settingsFor(10, { target: 65536, initialTiles: 100, spawn4Percent: 100 })))
    expect(game.score.value).toBe(0n); expect(game.moves.value).toBe(0); expect(game.goalReached.value).toBe(false)
    expect(game.maxTile.value).toBe(4n); expect(game.popup.value).toBeNull()
  })
  it.each([{ size: 2 }, { target: 1000 }, { initialTiles: 17 }, { spawn4Percent: 101 }, { spawn4Percent: '' }, { size: 3, initialTiles: 10 }])('keeps the active snapshot and does not even request a seed on invalid draft %j', patch => {
    const seed = vi.fn(() => 0), game = use2048Game(seed)
    game.dispatchMove('left'); const before = game.state.value, calls = seed.mock.calls.length
    setDraft(game, patch)
    expect(game.applySettings()).toBe(false); expect(game.state.value).toBe(before)
    expect(seed).toHaveBeenCalledTimes(calls); expect(game.settingsValidation.value.valid).toBe(false)
  })
  it('uses the applied configuration for regular restarts, preserving an incomplete future draft', () => {
    const game = use2048Game(() => 0)
    setDraft(game, { size: 6, target: 128, initialTiles: 1, spawn4Percent: 0 }); game.applySettings()
    const applied = game.state.value!.settings
    game.dispatchMove('left'); setDraft(game, { size: 3, initialTiles: 99, target: 65536 })
    expect(game.newGame()).toBe(true)
    expect(game.state.value!.settings).toEqual(applied)
    expect(game.draftSettings.value.initialTiles).toBe(99)
    expect(game.settingsValidation.value.valid).toBe(false)
  })
  it('keeps the snapshot and applied settings if seed creation fails during apply', () => {
    let fail = false
    const game = use2048Game(() => { if (fail) throw new Error('seed unavailable'); return 0 })
    game.dispatchMove('left'); const before = game.state.value
    setDraft(game, { size: 8, initialTiles: 64 }); fail = true
    expect(game.applySettings()).toBe(false); expect(game.state.value).toBe(before)
    expect(game.error.value).toContain('開始できません')
  })
  it('does not silently clamp initial tiles after shrinking the draft size', () => {
    const game = use2048Game(() => 0)
    setDraft(game, { initialTiles: 16 }); setDraft(game, { size: 3 })
    expect(game.draftSettings.value.initialTiles).toBe(16)
    expect(game.applySettings()).toBe(false); expect(game.state.value!.settings.size).toBe(4)
  })
  it('warns about a proven impossible goal but still allows that explicitly chosen score game', () => {
    const game = use2048Game(() => 0)
    setDraft(game, { size: 3, target: 65536 })
    const validation = game.settingsValidation.value
    expect(validation.valid).toBe(true)
    if (validation.valid) expect(validation.warnings.join('')).toContain('到達できません')
    expect(game.applySettings()).toBe(true)
    expect(game.state.value!.settings.size).toBe(3); expect(game.state.value!.settings.target).toBe(65536)
  })
  it('immediately reports a genuine initial deadlock at zero moves', () => {
    const game = use2048Game(() => 6)
    setDraft(game, { size: 3, target: 128, initialTiles: 9, spawn4Percent: 50 })
    expect(game.applySettings()).toBe(true)
    expect(game.popup.value).toBe('game-over'); expect(game.moves.value).toBe(0); expect(game.score.value).toBe(0n)
    const before = game.state.value
    game.dismissPopup(); expect(game.popup.value).toBeNull(); expect(game.dispatchMove('left')).toBe(false)
    expect(game.state.value).toBe(before)
    expect(game.newGame()).toBe(true); expect(game.popup.value).toBe('game-over')
  })
})

describe('settings card and responsive board rendering', () => {
  it('lists all sizes and targets and clearly separates editable and current settings', () => {
    const wrapper = app()
    expect(wrapper.get('.settings-panel h2').text()).toBe('次のゲームの設定')
    expect(wrapper.get('.settings-description').text()).toContain('編集中')
    expect(wrapper.findAll('#setting-size option').map(option => Number(option.attributes('value')))).toEqual([...BOARD_SIZES])
    expect(wrapper.findAll('#setting-target option').map(option => Number(option.attributes('value')))).toEqual([...TARGETS])
    expect(wrapper.get('.settings-badge').text()).toContain('4 × 4 · 目標 2048')
    expect(wrapper.get('.applied-settings').text()).toContain('初期2枚 · 2が90%／4が10%')
  })
  it('edits the entire form without touching the board and applies with its dedicated button', async () => {
    const wrapper = app(); await wrapper.get('button[aria-label="左に移動"]').trigger('click')
    const before = wrapper.get('.board').html()
    await wrapper.get('#setting-size').setValue('10'); await wrapper.get('#setting-target').setValue('65536')
    await wrapper.get('#setting-initial').setValue('100'); await wrapper.get('#setting-probability').setValue('100')
    expect(wrapper.get('.board').html()).toBe(before); expect(wrapper.get('.move-count').text()).toBe('1')
    expect(wrapper.get('.settings-badge').text()).toContain('4 × 4')
    await wrapper.get('.apply-settings').trigger('click'); await submit(wrapper)
    expect(wrapper.findAll('[role="cell"]')).toHaveLength(100)
    expect(wrapper.findAll('.tile')).toHaveLength(100)
    expect(wrapper.get('.score').text()).toBe('0'); expect(wrapper.get('.move-count').text()).toBe('0')
    expect(wrapper.get('.settings-badge').text()).toContain('10 × 10 · 目標 65536')
    expect(wrapper.get('.applied-settings').text()).toContain('初期100枚 · 2が0%／4が100%')
  })
  it.each(BOARD_SIZES)('applies size %i and renders N rows/columns and N² accessible cells', async size => {
    const wrapper = app()
    await wrapper.get('#setting-size').setValue(String(size)); await submit(wrapper)
    expect(wrapper.findAll('[role="row"]')).toHaveLength(size)
    expect(wrapper.findAll('[role="cell"]')).toHaveLength(size * size)
    expect(wrapper.get('.board').attributes('aria-rowcount')).toBe(String(size))
    expect(wrapper.get('.board').attributes('aria-colcount')).toBe(String(size))
    expect(wrapper.get('.board').attributes('aria-label')).toBe(`${size}行${size}列の2048盤面`)
    expect(wrapper.get('.board').attributes('style')).toContain(`--board-size: ${size}`)
    expect(wrapper.get(`[data-cell="${size * size - 1}"]`).attributes('aria-label')).toContain(`${size}行${size}列`)
  })
  it('shows Japanese validation errors and does not clamp a too-large initial count', async () => {
    const wrapper = app(), before = wrapper.get('.board').html()
    await wrapper.get('#setting-initial').setValue('16'); await wrapper.get('#setting-size').setValue('3')
    expect((wrapper.get('#setting-initial').element as HTMLInputElement).value).toBe('16')
    expect(wrapper.get('#setting-initial').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('.settings-errors').text()).toContain('1〜9')
    expect(wrapper.get('.apply-settings').attributes()).toHaveProperty('disabled')
    await submit(wrapper); expect(wrapper.get('.board').html()).toBe(before)
  })
  it.each(['', '-1', '101', '1.5'])('rejects probability input %s and keeps the game', async probability => {
    const wrapper = app(), before = wrapper.get('.board').html()
    await wrapper.get('#setting-probability').setValue(probability); await submit(wrapper)
    expect(wrapper.get('.board').html()).toBe(before)
    expect(wrapper.get('.settings-errors').text()).toContain('0〜100%の整数')
  })
  it.each([0, 10, 100])('shows complementary two/four probabilities for %i%%', async percent => {
    const wrapper = app()
    await wrapper.get('#setting-probability').setValue(String(percent))
    expect(wrapper.get('#probability-help').text()).toContain(`2の出現率：${100 - percent}%`)
    expect(wrapper.get('.applied-settings').text()).toContain('4が10%')
    await submit(wrapper)
    expect(wrapper.get('.applied-settings').text()).toContain(`4が${percent}%`)
  })
  it('shows unreachable-goal warning before applying, keeping the requested value intact', async () => {
    const wrapper = app(); await wrapper.get('#setting-size').setValue('3')
    expect(wrapper.get('.settings-warnings').text()).toContain('到達できません')
    expect((wrapper.get('#setting-target').element as HTMLSelectElement).value).toBe('2048')
    expect(wrapper.get('.settings-badge').text()).toContain('4 × 4')
    expect(wrapper.get('.apply-settings').attributes('disabled')).toBeUndefined()
    await submit(wrapper); expect(wrapper.get('.settings-badge').text()).toContain('3 × 3 · 目標 2048')
  })
  it('keeps keyboard editing in real settings inputs separate from game moves', async () => {
    const wrapper = app(), before = wrapper.get('.board').html()
    const input = wrapper.get('#setting-initial').element as HTMLInputElement; input.focus()
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    input.dispatchEvent(event); await nextTick()
    expect(event.defaultPrevented).toBe(false); expect(wrapper.get('.board').html()).toBe(before)
  })
  it('keeps applied settings when the ordinary new-game button is used during draft edits', async () => {
    const wrapper = app(); await wrapper.get('#setting-size').setValue('7'); await submit(wrapper)
    await wrapper.get('#setting-size').setValue('3'); await wrapper.get('#setting-initial').setValue('100')
    await wrapper.get('.new-game').trigger('click')
    expect(wrapper.get('.board').attributes('data-size')).toBe('7')
    expect((wrapper.get('#setting-initial').element as HTMLInputElement).value).toBe('100')
    expect(wrapper.find('.settings-errors').exists()).toBe(true)
  })
  it('provides exact values for abbreviated large tiles on a 10×10 board', () => {
    const wrapper = app(customState(10, Array<number>(100).fill(65536), 65536))
    expect(wrapper.get('[data-cell="0"]').text()).toBe('2^16')
    expect(wrapper.get('[data-cell="0"] .number').attributes('style')).toContain('--label-length: 4')
    expect(wrapper.get('[data-cell="0"]').attributes('title')).toBe('65536')
    expect(wrapper.get('[data-cell="0"]').attributes('aria-label')).toContain('65536')
    expect(wrapper.findAll('.tile-values li')).toHaveLength(100)
    expect(wrapper.get('.tile-values li').text()).toBe('1行1列：65,536')
  })
  it('does not consume arrow keys while inspecting the exact-number list', async () => {
    const wrapper = app(), event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    wrapper.get('.tile-values-list').element.dispatchEvent(event); await nextTick()
    expect(event.defaultPrevented).toBe(false); expect(wrapper.get('.move-count').text()).toBe('0')
  })
  it('can infer a non-default board size from its actual shape', () => {
    const wrapper = mount(GameBoard, { props: { board: tiles(Array<number>(9).fill(2)) } }); wrappers.push(wrapper)
    expect(wrapper.findAll('[role="row"]')).toHaveLength(3)
    expect(wrapper.get('.board').attributes('data-size')).toBe('3')
  })
})

describe('custom goal and immediate game-over dialogs', () => {
  it.each(TARGETS)('displays target %i in the goal popup and never repeats after continuing', async target => {
    const initial = customState(4, [target / 2, target / 2, ...Array<number>(14).fill(0)], target)
    const wrapper = app(initial)
    await wrapper.get('button[aria-label="左に移動"]').trigger('click')
    expect(wrapper.get('dialog h2').text()).toBe(`${target}達成！おめでとう！`)
    expect(wrapper.get('.result-max').text()).toBe(target.toLocaleString('ja-JP'))
    await wrapper.get('.dialog-continue').trigger('click'); await nextTick()
    await wrapper.get('.game-surface').trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(wrapper.get('.move-count').text()).toBe('2')
  })
  it('preserves the popup and active settings if applying a draft is attempted while modal', () => {
    const initial = customState(4, [64, 64, ...Array<number>(14).fill(0)], 128)
    vi.mocked(createGame).mockReturnValueOnce(initial)
    const game = use2048Game(() => 0); game.dispatchMove('left')
    const before = game.state.value
    setDraft(game, { size: 10, target: 65536 })
    expect(game.applySettings()).toBe(false); expect(game.state.value).toBe(before)
    expect(game.popup.value).toBe('goal')
  })
  it('uses the applied custom target for new games from the result dialog', async () => {
    const wrapper = app(customState(4, [64, 64, ...Array<number>(14).fill(0)], 128))
    await wrapper.get('#setting-target').setValue('65536')
    await wrapper.get('button[aria-label="左に移動"]').trigger('click')
    await wrapper.get('.dialog-new-game').trigger('click'); await nextTick()
    expect(wrapper.get('.settings-badge').text()).toContain('目標 128')
    expect((wrapper.get('#setting-target').element as HTMLSelectElement).value).toBe('65536')
    expect(wrapper.get('.move-count').text()).toBe('0'); expect(wrapper.find('dialog').exists()).toBe(false)
  })
  it('opens an initial-deadlock dialog at move zero and focuses the dialog rather than the inert board', async () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => { if (array instanceof Uint32Array) array[0] = 6; return array })
    const wrapper = app()
    await wrapper.get('#setting-size').setValue('3'); await wrapper.get('#setting-target').setValue('128')
    await wrapper.get('#setting-initial').setValue('9'); await wrapper.get('#setting-probability').setValue('50')
    expect(wrapper.get('.settings-warnings').text()).toContain('開始直後に手詰まり')
    await submit(wrapper)
    expect(wrapper.get('dialog h2').text()).toBe('ゲームオーバー')
    expect(wrapper.get('.result-moves').text()).toBe('0'); expect(wrapper.get('.result-score').text()).toBe('0')
    expect(document.activeElement).toBe(wrapper.get('.dialog-new-game').element)
    await wrapper.get('.dialog-view-board').trigger('click'); await nextTick()
    expect(wrapper.get('.game-surface').classes()).toContain('is-locked')
    const before = wrapper.get('.board').html()
    await wrapper.get('.game-surface').trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.get('.board').html()).toBe(before)
    await wrapper.get('.new-game').trigger('click'); await nextTick()
    expect(wrapper.get('dialog h2').text()).toBe('ゲームオーバー')
    expect(document.activeElement).toBe(wrapper.get('.dialog-new-game').element)
  })
})
