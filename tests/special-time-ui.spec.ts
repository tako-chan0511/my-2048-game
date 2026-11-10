// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from '../src/App.vue'
import { use2048Game } from '../src/composables/use2048Game.ts'
import { DEFAULT_SETTINGS, TIME_VALUES, createGame, createSession, moveSession, sessionEndReason } from '../src/core/index.ts'
import { encodeGame } from '../src/services/gameCodec.ts'
import { GAME_STORAGE_KEY } from '../src/services/gameStorage.ts'
import { SLIDE_MS, POP_MS } from '../src/presentation/tiles.ts'
import { memoryStorage } from './session-fixtures.ts'
import { charged, emptyIndex, timeSettings } from './special-time-fixtures.ts'

const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1000)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => { if (array instanceof Uint32Array) array[0] = 0; return array })
  if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function () {}
  if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () {}
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open') })
})
afterEach(() => {
  wrappers.splice(0).forEach(w => w.unmount()); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; document.body.style.overflow = ''
})
function app(session?: ReturnType<typeof charged>) {
  if (session) localStorage.setItem(GAME_STORAGE_KEY, encodeGame(session))
  const w = mount(App, { attachTo: document.body }); wrappers.push(w); return w
}
function raw() { return JSON.parse(localStorage.getItem(GAME_STORAGE_KEY)!) }
async function apply(w: VueWrapper) { await w.get('.settings-panel form').trigger('submit') }
async function start(w: VueWrapper) { await w.get('.special-time-start').trigger('click'); await nextTick() }
async function tick(ms: number) { vi.advanceTimersByTime(ms); await nextTick() }

describe('special time settings, preview and confirmation UI', () => {
  it('defaults OFF, 10, 3 and all eight numbers, with disabled dependencies', () => {
    const w = app()
    expect((w.get('#setting-time-enabled').element as HTMLSelectElement).value).toBe('off')
    expect((w.get('#setting-time-interval').element as HTMLInputElement).value).toBe('10')
    expect((w.get('#setting-time-max').element as HTMLInputElement).value).toBe('3')
    expect(w.get('#setting-time-interval').attributes()).toHaveProperty('disabled')
    expect(w.get('#setting-time-max').attributes()).toHaveProperty('disabled')
    expect(w.findAll('.time-value-checks input').every(e => (e.element as HTMLInputElement).checked)).toBe(true)
    expect(w.find('.special-time-panel').exists()).toBe(false)
    expect(w.get('.applied-settings').text()).toContain('スペシャルタイム：OFF')
  })
  it('edits independently from automatic special tiles and applies only on the dedicated action', async () => {
    const w = app(), before = raw()
    await w.get('#setting-time-enabled').setValue('on'); await w.get('#setting-time-interval').setValue('5'); await w.get('#setting-time-max').setValue('2')
    await w.get('.time-value-checks input[value="256"]').setValue(false)
    expect(raw()).toEqual(before); expect(w.find('.special-time-panel').exists()).toBe(false)
    await apply(w)
    expect(raw().game.settings.specialTime).toEqual({ enabled: true, interval: 5, maxCharges: 2, values: TIME_VALUES.filter(v => v !== 256) })
    expect(raw().game.settings.special.enabled).toBe(false)
    expect(w.get('.time-countdown').text()).toContain('あと5手'); expect(w.get('.time-charges').text()).toContain('0 / 2')
    expect(w.get('.special-time-start').attributes()).toHaveProperty('disabled')
  })
  it.each([['#setting-time-interval', '0'], ['#setting-time-interval', '101'], ['#setting-time-interval', '1.5'], ['#setting-time-max', '0'], ['#setting-time-max', '11'], ['#setting-time-max', '']])('rejects invalid %s=%s before requesting a game', async (selector, value) => {
    const w = app(), before = raw()
    await w.get('#setting-time-enabled').setValue('on'); await w.get(selector).setValue(value)
    expect(w.find('.settings-errors').exists()).toBe(true); expect(w.get('.apply-settings').attributes()).toHaveProperty('disabled')
    await apply(w); expect(raw()).toEqual(before)
  })
  it('rejects an empty allowed-number rule with a visible reason', async () => {
    const w = app(); await w.get('#setting-time-enabled').setValue('on')
    for (const input of w.findAll('.time-value-checks input')) await input.setValue(false)
    expect(w.get('.settings-errors').text()).toContain('1種類以上')
    expect(w.get('.apply-settings').attributes()).toHaveProperty('disabled')
  })
  it('previews an empty-cell change, confirms once and discards all older Undo history', async () => {
    const initial = charged(1, { interval: 1 }, { size: 4 }), w = app(initial), index = emptyIndex(initial), before = raw()
    await start(w)
    expect(w.get('.time-editor-title').text()).toContain('発動')
    expect(w.findAll('.cell-select')).toHaveLength(16)
    expect(w.get('.time-confirm').attributes()).toHaveProperty('disabled')
    await w.get(`[data-cell="${index}"] .cell-select`).trigger('click')
    await w.get('.time-number[data-value="128"]').trigger('click')
    expect(w.get('.time-preview').text()).toContain('空き → 128')
    expect(w.get(`[data-cell="${index}"]`).classes()).toContain('is-edit-selected')
    expect(raw().game).toEqual(before.game)
    await w.get('.time-confirm').trigger('click')
    const after = raw()
    expect(after.game.position.board[index].power).toBe(7); expect(after.specialTime.charges).toBe(0); expect(after.specialTime.used).toBe(1)
    expect(after.history).toHaveLength(0); expect(after.game.position.moveCount).toBe(before.game.position.moveCount)
    expect(after.game.position.score).toBe(before.game.position.score); expect(after.game.position.rng).toEqual(before.game.position.rng)
    expect(w.find('.time-editor').exists()).toBe(false); expect(w.get('.undo-button').attributes()).toHaveProperty('disabled')
  })
  it('makes the default 10-move award usable in the real App after its animation finishes', async () => {
    const w = app()
    await w.get('#setting-size').setValue('10')
    await w.get('#setting-time-enabled').setValue('on')
    expect(w.get('.time-settings-pending').text()).toContain('この設定で新しいゲーム')
    expect(w.find('.special-time-panel').exists()).toBe(false)
    await apply(w)
    expect(w.find('.time-settings-pending').exists()).toBe(false)
    expect(w.get('.time-use-help').text()).toContain('10回の有効移動')
    const directions = ['左', '上', '右', '下']
    for (let move = 1; move <= 20; move++) {
      const count = raw().game.position.moveCount
      for (const label of directions) {
        await w.get(`button[aria-label="${label}に移動"]`).trigger('click')
        if (raw().game.position.moveCount > count) break
      }
      expect(raw().game.position.moveCount).toBe(move)
      expect(raw().specialTime.charges).toBe(Math.floor(move / 10))
      expect(w.get('.special-time-start').attributes()).toHaveProperty('disabled')
      await tick(SLIDE_MS + POP_MS)
      if (move < 10) expect(w.get('.special-time-start').attributes()).toHaveProperty('disabled')
      else expect(w.get('.special-time-start').attributes('disabled')).toBeUndefined()
      if (move === 10) {
        expect(w.get('.time-charges').text()).toContain('1 / 3')
        await start(w)
        expect(w.findAll('.cell-select')).toHaveLength(100)
        await w.get('.time-cancel').trigger('click')
      }
    }
    expect(w.get('.time-charges').text()).toContain('2 / 3')
  })
  it('warns when an applied special-time interval is edited without starting a new game', async () => {
    const w = app(charged())
    expect(w.find('.time-settings-pending').exists()).toBe(false)
    await w.get('#setting-time-interval').setValue('5')
    expect(w.find('.time-settings-pending').exists()).toBe(true)
    expect(raw().game.settings.specialTime.interval).toBe(10)
    await apply(w)
    expect(w.find('.time-settings-pending').exists()).toBe(false)
    expect(raw().game.settings.specialTime.interval).toBe(5)
  })
  it('cancel preserves the board, history and right balance', async () => {
    const initial = charged(1, { interval: 1 }, { size: 4 }), w = app(initial), before = raw()
    await start(w); await w.get(`[data-cell="${emptyIndex(initial)}"] .cell-select`).trigger('click'); await w.get('.time-number[data-value="128"]').trigger('click')
    await w.get('.time-cancel').trigger('click')
    expect(raw()).toEqual(before); expect(w.find('.time-editor').exists()).toBe(false)
    expect(w.find('.cell-select').exists()).toBe(false)
  })
  it('disables confirmation when the selected value equals the current tile', async () => {
    const initial = charged(1, { interval: 1 }, { size: 4 }), w = app(initial), index = initial.game.position.board.findIndex(Boolean)
    await start(w); await w.get(`[data-cell="${index}"] .cell-select`).trigger('click')
    const value = 2 ** initial.game.position.board[index]!.power
    await w.get(`.time-number[data-value="${value}"]`).trigger('click')
    expect(w.get('.time-confirm').attributes()).toHaveProperty('disabled')
  })
  it('blocks normal keyboard, pointer moves and direction controls while editing', async () => {
    const w = app(charged(1, { interval: 1 }, { size: 4 })); await start(w)
    const before = raw()
    await w.get('.game-surface').trigger('keydown', { key: 'ArrowLeft' })
    const surface = w.get('.game-surface').element
    surface.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: 200, clientY: 200 }))
    surface.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: 20, clientY: 200 }))
    await nextTick()
    await w.get('button[aria-label="左に移動"]').trigger('click')
    expect(raw()).toEqual(before)
    expect(w.get('button[aria-label="左に移動"]').attributes()).toHaveProperty('disabled')
    expect(w.get('.undo-button').attributes()).toHaveProperty('disabled')
  })
  it('waits for the existing slide/pop to finish before allowing special time', async () => {
    const w = app(createSession(createGame(0, timeSettings({ interval: 1 }, { size: 4 }))))
    await w.get('button[aria-label="左に移動"]').trigger('click')
    expect(w.get('.board').attributes('data-animation')).toBe('slide')
    expect(w.get('.special-time-start').attributes()).toHaveProperty('disabled')
    await tick(SLIDE_MS); expect(w.get('.special-time-start').attributes()).toHaveProperty('disabled')
    await tick(POP_MS); expect(w.get('.special-time-start').attributes('disabled')).toBeUndefined()
    await start(w); expect(w.get('.board').attributes('data-animation')).toBe('idle')
  })
  it('new game resets rights/events and clears stale selection', async () => {
    const w = app(charged(1, { interval: 1 }, { size: 4 })); await start(w)
    await w.get('[data-cell="0"] .cell-select').trigger('click'); await w.get('.time-number[data-value="128"]').trigger('click')
    await w.get('.new-game').trigger('click')
    expect(w.find('.time-editor').exists()).toBe(false); expect(w.find('.is-edit-selected').exists()).toBe(false)
    expect(raw().specialTime).toEqual({ charges: 0, processedEvents: 0, granted: 0, used: 0 })
    expect(raw().game.position.moveCount).toBe(0)
  })
  it('reload restores spent rights and the board without old editing UI', async () => {
    const initial = charged(1, { interval: 1 }, { size: 4 }), w = app(initial)
    await start(w); await w.get(`[data-cell="${emptyIndex(initial)}"] .cell-select`).trigger('click'); await w.get('.time-number[data-value="128"]').trigger('click'); await w.get('.time-confirm').trigger('click')
    const saved = raw(); w.unmount(); wrappers.pop()
    const restored = app()
    expect(raw()).toEqual(saved); expect(restored.get('.time-charges').text()).toContain('0 / 3')
    expect(restored.find('.time-editor').exists()).toBe(false); expect(restored.find('.cell-select').exists()).toBe(false)
  })
  it('closes an unconfirmed edit at the deadline without spending the right or altering the board', async () => {
    const initial = charged(1, { interval: 1 }, { size: 4, mode: { kind: 'timed', seconds: 10 } }), w = app(initial)
    await start(w); await w.get(`[data-cell="${emptyIndex(initial)}"] .cell-select`).trigger('click'); await w.get('.time-number[data-value="128"]').trigger('click')
    await tick(10000)
    expect(w.find('.time-editor').exists()).toBe(false); expect(w.get('dialog h2').text()).toContain('時間切れ')
    expect(raw().specialTime.charges).toBe(1); expect(raw().game.position).toEqual(JSON.parse(encodeGame(initial)).game.position)
    expect(w.find('.dialog-special-time').exists()).toBe(false)
  })
  it('offers special time from a stuck-game dialog and clears the ended state after repair', async () => {
    let session = createSession(createGame(0, timeSettings({ interval: 1 }, { size: 3 })))
    for (let i = 0; i < 500 && !sessionEndReason(session); i++) session = moveSession(session, (['left', 'up', 'right', 'down'] as const)[i % 4]!)
    const w = app(session), value = 2 ** session.game.position.board[1]!.power
    await w.get('.dialog-special-time').trigger('click'); await nextTick()
    expect(w.find('dialog').exists()).toBe(false)
    await w.get('[data-cell="0"] .cell-select').trigger('click'); await w.get(`.time-number[data-value="${value}"]`).trigger('click'); await w.get('.time-confirm').trigger('click')
    expect(w.find('dialog').exists()).toBe(false); expect(w.get('.game-surface').classes()).not.toContain('is-locked')
  })
  it('does not offer special time after a move-limit ending despite the newly earned right', () => {
    const w = app(charged(1, { interval: 1 }, { size: 4, mode: { kind: 'moves', limit: 1 } }))
    expect(w.get('.time-charges').text()).toContain('1 / 3')
    expect(w.find('.dialog-special-time').exists()).toBe(false)
    expect(w.get('.special-time-start').attributes()).toHaveProperty('disabled')
  })
  it('reduced-motion keeps the edit workflow static with no animation dependency', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const w = app(charged(1, { interval: 1 }, { size: 4 })); await start(w)
    await w.get('[data-cell="0"] .cell-select').trigger('click'); await w.get('.time-number[data-value="128"]').trigger('click'); await w.get('.time-confirm').trigger('click')
    expect(w.get('.board').attributes('data-animation')).toBe('idle')
    expect(w.get('.board').attributes('data-reduced-motion')).toBe('true')
    expect(raw().specialTime.used).toBe(1)
  })
})

describe('special time composable guards', () => {
  it('prevents double confirmation, stale choices and ordinary moves during editing', () => {
    const session = charged(2, { interval: 1 }, { size: 4 }), port = memoryStorage({ [GAME_STORAGE_KEY]: encodeGame(session) }), game = use2048Game(() => 42, port)
    expect(game.beginTimeEditing()).toBe(true); game.selectTimeCell(emptyIndex(session)); game.selectTimeValue(128)
    expect(game.dispatchMove('left')).toBe(false); expect(game.undo()).toBe(false)
    expect(game.confirmTimeEdit()).toBe(true); expect(game.confirmTimeEdit()).toBe(false)
    expect(game.timeCharges.value).toBe(1)
    game.beginTimeEditing(); game.selectTimeCell(0); game.selectTimeValue(256); game.newGame()
    expect(game.confirmTimeEdit()).toBe(false); expect(game.timeEditing.value).toBe(false)
    expect(game.timeCharges.value).toBe(0)
  })
  it('refuses both beginning and confirming while the animation lock is active', () => {
    const session = charged(), port = memoryStorage({ [GAME_STORAGE_KEY]: encodeGame(session) }), game = use2048Game(() => 42, port)
    game.setAnimationActive(true); expect(game.beginTimeEditing()).toBe(false)
    game.setAnimationActive(false); expect(game.beginTimeEditing()).toBe(true)
    game.selectTimeCell(emptyIndex(session)); game.selectTimeValue(128); game.setAnimationActive(true)
    expect(game.confirmTimeEdit()).toBe(false); expect(game.timeCharges.value).toBe(1)
    game.setAnimationActive(false); expect(game.confirmTimeEdit()).toBe(true)
  })
  it('rechecks the deadline at confirmation even before the UI ticker observes it', () => {
    const session = charged(1, { interval: 1 }, { mode: { kind: 'timed', seconds: 10 } }), port = memoryStorage({ [GAME_STORAGE_KEY]: encodeGame(session) })
    let now = 1000
    const game = use2048Game(() => 42, port, () => now)
    game.beginTimeEditing(); game.selectTimeCell(emptyIndex(session)); game.selectTimeValue(128)
    now = 11000
    expect(game.confirmTimeEdit()).toBe(false); expect(game.timeEditing.value).toBe(false)
    expect(game.timeCharges.value).toBe(1); expect(game.endReason.value).toBe('time-expired')
    expect(game.state.value!.position).toEqual(session.game.position)
  })
  it('counts down to the next unseen event after Undo rather than promising a duplicate award', () => {
    const session = charged(), port = memoryStorage({ [GAME_STORAGE_KEY]: encodeGame(session) }), game = use2048Game(() => 42, port)
    expect(game.timeRemaining.value).toBe(10)
    game.undo(); expect(game.moves.value).toBe(9); expect(game.timeRemaining.value).toBe(11)
    expect(game.timeCharges.value).toBe(1)
  })
  it('refuses entry if the deadline passes between refreshing the clock and dismissing a popup', () => {
    const session = charged(1, { interval: 1 }, { mode: { kind: 'timed', seconds: 10 } }), port = memoryStorage({ [GAME_STORAGE_KEY]: encodeGame(session) })
    let clock: () => number = () => 1000
    const game = use2048Game(() => 42, port, () => clock())
    clock = vi.fn().mockReturnValueOnce(10999).mockReturnValue(11000)
    expect(game.beginTimeEditing()).toBe(false); expect(game.timeEditing.value).toBe(false)
    expect(game.timeCharges.value).toBe(1); expect(game.endReason.value).toBe('time-expired')
  })
  it('keeps special time absent for the legacy default state', () => {
    const game = use2048Game(() => 0)
    expect(game.state.value!.settings).toEqual(DEFAULT_SETTINGS)
    expect(game.beginTimeEditing()).toBe(false); expect(game.timeRemaining.value).toBeNull()
  })
})
