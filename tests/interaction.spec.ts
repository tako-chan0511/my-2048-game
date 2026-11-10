// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import App from '../src/App.vue'
import GameBoard from '../src/components/GameBoard.vue'
import { use2048Game } from '../src/composables/use2048Game.ts'
import { createGame, createRandomState, moveGame, type Direction, type GameState } from '../src/core/index.ts'
import { createGame as realCreateGame } from '../src/core/game.ts'
import { stateFor, tiles, values } from './fixtures.ts'

vi.mock('../src/core/index.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/core/index.ts')>()
  return { ...actual, createGame: vi.fn(actual.createGame) }
})

// jsdom does not implement the browser's top layer; real dialogs and native
// inert/focus behavior are additionally checked with Chromium.
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
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})
function app(initial?: GameState) {
  if (initial) vi.mocked(createGame).mockReturnValueOnce(initial)
  const wrapper = mount(App, { attachTo: document.body })
  wrappers.push(wrapper)
  return wrapper
}
function pointer(target: EventTarget, type: string, options: PointerEventInit = {}) {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: 120, clientY: 120, ...options })
  target.dispatchEvent(event)
  return event
}
function swipe(wrapper: VueWrapper, dx: number, dy: number, pointerId = 1) {
  const surface = wrapper.get('.game-surface').element
  pointer(surface, 'pointerdown', { pointerId })
  pointer(surface, 'pointermove', { pointerId, clientX: 120 + dx, clientY: 120 + dy })
  pointer(surface, 'pointerup', { pointerId, clientX: 120 + dx, clientY: 120 + dy })
}
function readBoard(wrapper: VueWrapper) {
  return wrapper.findAll('[role="cell"]').map(cell => Number(cell.attributes('data-power')) ? 2 ** Number(cell.attributes('data-power')) : 0)
}
const win = () => stateFor([1024, 1024, ...Array<number>(14).fill(0)], { score: 64n, moveCount: 7 })
const end = () => stateFor([0, 4, 2, 4, 2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4], { score: 128n, moveCount: 18, rng: createRandomState(0) })
async function left(wrapper: VueWrapper) { await wrapper.get('button[aria-label="左に移動"]').trigger('click') }

describe('shared input dispatch', () => {
  it.each([
    { direction: 'left', key: 'ArrowLeft', label: '左', dx: -80, dy: 4 },
    { direction: 'right', key: 'ArrowRight', label: '右', dx: 80, dy: 4 },
    { direction: 'up', key: 'ArrowUp', label: '上', dx: 4, dy: -80 },
    { direction: 'down', key: 'ArrowDown', label: '下', dx: 4, dy: 80 },
  ] as const)('buttons, keys and swipes reproduce identical $direction states', async ({ direction, key, label, dx, dy }) => {
    const initial = stateFor([0, 0, 0, 0, 0, 2, 2, 0, 0, 4, 4, 0, 0, 0, 0, 0])
    const expected = moveGame(initial, direction).state
    for (const mode of ['button', 'key', 'swipe']) {
      const wrapper = app(initial)
      if (mode === 'button') await wrapper.get(`button[aria-label="${label}に移動"]`).trigger('click')
      else if (mode === 'key') {
        const surface = wrapper.get('.game-surface')
        ;(surface.element as HTMLElement).focus()
        await surface.trigger('keydown', { key })
      } else { swipe(wrapper, dx, dy); await nextTick() }
      expect(readBoard(wrapper)).toEqual(values(expected.position.board))
      expect(wrapper.get('.score').text()).toBe(expected.position.score.toLocaleString('ja-JP'))
      expect(wrapper.get('.move-count').text()).toBe('1')
      expect(wrapper.get('.max-tile').text()).toBe((2 ** Math.max(...expected.position.board.map(tile => tile?.power ?? 0))).toLocaleString('ja-JP'))
      wrapper.unmount(); wrappers.pop()
    }
  })
  it('retains the old move method only as an alias of dispatchMove', () => {
    const game = use2048Game(() => 0)
    expect(game.move).toBe(game.dispatchMove)
  })
  it('only handles arrow keys inside the game region', async () => {
    const wrapper = app(), before = readBoard(wrapper)
    const outside = document.createElement('button'); document.body.append(outside); outside.focus()
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    outside.dispatchEvent(event); await nextTick()
    expect(event.defaultPrevented).toBe(false); expect(readBoard(wrapper)).toEqual(before)
    const surface = wrapper.get('.game-surface').element as HTMLElement; surface.focus()
    const inside = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    surface.dispatchEvent(inside); await nextTick()
    expect(inside.defaultPrevented).toBe(true); expect(wrapper.get('.move-count').text()).toBe('1')
  })
  it.each(['input', 'textarea', 'select', 'contenteditable', 'textbox', 'combobox', 'spinbutton', 'slider'])('leaves %s keyboard editing and scrolling alone', async kind => {
    const wrapper = app(), field = document.createElement(['input', 'textarea', 'select'].includes(kind) ? kind : 'div')
    if (kind === 'contenteditable') field.setAttribute('contenteditable', 'true')
    else if (['textbox', 'combobox', 'spinbutton', 'slider'].includes(kind)) field.setAttribute('role', kind)
    wrapper.get('section[aria-label="2048ゲーム"]').element.append(field)
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    field.dispatchEvent(event); await nextTick()
    expect(event.defaultPrevented).toBe(false); expect(wrapper.get('.move-count').text()).toBe('0')
  })
  it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { isComposing: true }])('ignores modified or composing arrow input %j', async options => {
    const wrapper = app()
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true, ...options })
    wrapper.get('.game-surface').element.dispatchEvent(event); await nextTick()
    expect(event.defaultPrevented).toBe(false); expect(wrapper.get('.move-count').text()).toBe('0')
  })
  it('ignores unrelated and already-handled keys', async () => {
    const wrapper = app(), surface = wrapper.get('.game-surface').element
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }); event.preventDefault()
    surface.dispatchEvent(event)
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); surface.dispatchEvent(enter)
    await nextTick(); expect(enter.defaultPrevented).toBe(false); expect(wrapper.get('.move-count').text()).toBe('0')
  })
  it('consumes no repeated-key moves while preventing game-region scrolling', async () => {
    const wrapper = app(), surface = wrapper.get('.game-surface')
    await surface.trigger('keydown', { key: 'ArrowLeft' })
    const before = readBoard(wrapper)
    for (let i = 0; i < 20; i++) {
      const repeat = new KeyboardEvent('keydown', { key: 'ArrowDown', repeat: true, bubbles: true, cancelable: true })
      surface.element.dispatchEvent(repeat); expect(repeat.defaultPrevented).toBe(true)
    }
    await nextTick(); expect(wrapper.get('.move-count').text()).toBe('1'); expect(readBoard(wrapper)).toEqual(before)
    await surface.trigger('keydown', { key: 'ArrowDown', repeat: false })
    expect(wrapper.get('.move-count').text()).toBe('2')
  })
})

describe('Pointer Events swipe lifecycle', () => {
  it('moves only once on release, not on pointermove or later duplicate releases', async () => {
    const wrapper = app(), surface = wrapper.get('.game-surface').element
    pointer(surface, 'pointerdown')
    for (const x of [100, 80, 60, 30]) pointer(surface, 'pointermove', { clientX: x })
    await nextTick(); expect(wrapper.get('.move-count').text()).toBe('0')
    pointer(surface, 'pointerup', { clientX: 30 }); await nextTick()
    expect(wrapper.get('.move-count').text()).toBe('1')
    pointer(surface, 'pointerup', { clientX: 30 }); await nextTick()
    expect(wrapper.get('.move-count').text()).toBe('1')
  })
  it.each([{ dx: -23, dy: 0 }, { dx: -90, dy: 90 }, { dx: 0, dy: 0 }])('does not move for short, ambiguous or tap gestures %j', async ({ dx, dy }) => {
    const wrapper = app(); swipe(wrapper, dx, dy); await nextTick()
    expect(wrapper.get('.move-count').text()).toBe('0')
  })
  it('accepts the exact 24px swipe threshold', async () => {
    const wrapper = app(); swipe(wrapper, -24, 0); await nextTick()
    expect(wrapper.get('.move-count').text()).toBe('1')
  })
  it.each(['pointercancel', 'lostpointercapture'])('cancels %s without moving, then accepts a fresh gesture', async eventType => {
    const wrapper = app(), surface = wrapper.get('.game-surface').element
    pointer(surface, 'pointerdown'); pointer(surface, 'pointermove', { clientX: 30 })
    pointer(surface, eventType, { clientX: 30 }); pointer(surface, 'pointerup', { clientX: 30 })
    await nextTick(); expect(wrapper.get('.move-count').text()).toBe('0')
    swipe(wrapper, -80, 0, 2); await nextTick(); expect(wrapper.get('.move-count').text()).toBe('1')
  })
  it.each(['surface', 'outside'])('invalidates the entire gesture if a second finger lands on %s', async where => {
    const wrapper = app(), surface = wrapper.get('.game-surface').element
    pointer(surface, 'pointerdown'); pointer(surface, 'pointermove', { clientX: 30 })
    const target = where === 'surface' ? surface : document.body
    pointer(target, 'pointerdown', { pointerId: 2, isPrimary: false })
    pointer(surface, 'pointerup', { clientX: 30 }); pointer(target, 'pointerup', { pointerId: 2, isPrimary: false })
    await nextTick(); expect(wrapper.get('.move-count').text()).toBe('0')
    swipe(wrapper, -80, 0, 3); await nextTick(); expect(wrapper.get('.move-count').text()).toBe('1')
  })
  it('does not begin while another finger is already held outside the board', async () => {
    const wrapper = app()
    pointer(document.body, 'pointerdown', { pointerId: 5 })
    swipe(wrapper, -80, 0, 6); pointer(document.body, 'pointerup', { pointerId: 5 })
    await nextTick(); expect(wrapper.get('.move-count').text()).toBe('0')
  })
  it.each([{ isPrimary: false }, { button: 2 }])('rejects an invalid pointer start %j', async options => {
    const wrapper = app(), surface = wrapper.get('.game-surface').element
    pointer(surface, 'pointerdown', options); pointer(surface, 'pointerup', { clientX: 30 })
    await nextTick(); expect(wrapper.get('.move-count').text()).toBe('0')
  })
  it('captures and releases the pointer without requiring movement', async () => {
    const wrapper = app(), surface = wrapper.get('.game-surface').element as HTMLElement
    const capture = vi.fn(), release = vi.fn()
    Object.defineProperties(surface, { setPointerCapture: { value: capture }, hasPointerCapture: { value: () => true }, releasePointerCapture: { value: release } })
    pointer(surface, 'pointerdown'); pointer(surface, 'pointerup')
    await nextTick(); expect(capture).toHaveBeenCalledWith(1); expect(release).toHaveBeenCalledWith(1)
    expect(document.activeElement).toBe(surface); expect(wrapper.get('.move-count').text()).toBe('0')
  })
  it('tolerates capture failures and a release outside the board', async () => {
    const wrapper = app(), surface = wrapper.get('.game-surface').element
    Object.defineProperty(surface, 'setPointerCapture', { value() { throw new Error('capture failed') } })
    pointer(surface, 'pointerdown'); pointer(document.body, 'pointerup', { clientX: 30 })
    pointer(surface, 'pointerup', { clientX: 30 })
    await nextTick(); expect(wrapper.get('.move-count').text()).toBe('0')
  })
  it('cancels on window blur', async () => {
    const wrapper = app(), surface = wrapper.get('.game-surface').element
    pointer(surface, 'pointerdown'); window.dispatchEvent(new Event('blur'))
    pointer(surface, 'pointerup', { clientX: 30 }); await nextTick()
    expect(wrapper.get('.move-count').text()).toBe('0')
  })
  it('cancels a gesture when the document becomes hidden', async () => {
    const wrapper = app(), surface = wrapper.get('.game-surface').element
    pointer(surface, 'pointerdown')
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    pointer(surface, 'pointerup', { clientX: 30 }); await nextTick()
    expect(wrapper.get('.move-count').text()).toBe('0')
  })
  it('does not swipe if mouse buttons are no longer pressed', async () => {
    const wrapper = app(), surface = wrapper.get('.game-surface').element
    pointer(surface, 'pointerdown', { pointerType: 'mouse' })
    pointer(surface, 'pointermove', { pointerType: 'mouse', buttons: 0, clientX: 30 })
    pointer(surface, 'pointerup', { pointerType: 'mouse', clientX: 30 }); await nextTick()
    expect(wrapper.get('.move-count').text()).toBe('0')
  })
  it('discards an unfinished swipe when a button or key moves the board', async () => {
    const wrapper = app(), surface = wrapper.get('.game-surface').element
    pointer(surface, 'pointerdown'); await left(wrapper)
    pointer(surface, 'pointerup', { clientX: 30 }); await nextTick()
    expect(wrapper.get('.move-count').text()).toBe('1')
  })
  it('does not intercept gestures on the rest of the page', async () => {
    const wrapper = app(), rules = wrapper.get('.rules').element
    const down = pointer(rules, 'pointerdown'), up = pointer(rules, 'pointerup', { clientX: 30 })
    await nextTick(); expect(down.defaultPrevented).toBe(false); expect(up.defaultPrevented).toBe(false)
    expect(wrapper.get('.move-count').text()).toBe('0')
  })
})

describe('game popup state', () => {
  it('shows the goal once, pauses input, continues, and never reopens for that game', () => {
    const initial = win(); vi.mocked(createGame).mockReturnValueOnce(initial)
    const game = use2048Game(() => 0)
    expect(game.dispatchMove('left')).toBe(true); expect(game.popup.value).toBe('goal')
    expect(game.goalReached.value).toBe(true)
    const before = game.state.value
    expect(game.dispatchMove('down')).toBe(false); expect(game.state.value).toBe(before)
    game.dismissPopup(); expect(game.popup.value).toBeNull()
    expect(game.dispatchMove('down')).toBe(true); expect(game.popup.value).toBeNull()
    expect(game.goalReached.value).toBe(true)
  })
  it('closes the game-over popup without unlocking the ended game', () => {
    const initial = end(); vi.mocked(createGame).mockReturnValueOnce(initial)
    const game = use2048Game(() => 0)
    game.dispatchMove('left'); expect(game.popup.value).toBe('game-over')
    game.dismissPopup(); expect(game.popup.value).toBeNull(); expect(game.inputBlocked.value).toBe(true)
    const before = game.state.value
    for (const direction of ['up', 'down', 'left', 'right'] as Direction[]) expect(game.dispatchMove(direction)).toBe(false)
    expect(game.state.value).toBe(before); expect(game.gameOver.value).toBe(true)
  })
  it('celebrates and then shows game over if the same move does both', () => {
    const initial = stateFor([1024, 1024, 2, 4, 2, 4, 8, 16, 4, 2, 4, 2, 2, 4, 2, 4], { rng: createRandomState(0) })
    vi.mocked(createGame).mockReturnValueOnce(initial)
    const game = use2048Game(() => 0)
    game.dispatchMove('left'); expect(game.popup.value).toBe('goal'); expect(game.gameOver.value).toBe(true)
    game.dismissPopup(); expect(game.popup.value).toBe('game-over')
    game.dismissPopup(); expect(game.popup.value).toBeNull(); expect(game.dispatchMove('down')).toBe(false)
  })
  it('resets all game and popup state and RNG only after successful new-game creation', () => {
    const initial = win(); vi.mocked(createGame).mockReturnValueOnce(initial)
    let seed = 0
    const game = use2048Game(() => seed)
    game.dispatchMove('left'); expect(game.popup.value).toBe('goal')
    seed = 42; expect(game.newGame()).toBe(true)
    expect(game.state.value).toEqual(realCreateGame(42)); expect(game.popup.value).toBeNull()
    expect(game.goalReached.value).toBe(false); expect(game.gameOver.value).toBe(false)
    expect(game.moves.value).toBe(0); expect(game.score.value).toBe(0n)
    vi.mocked(createGame).mockReturnValueOnce(initial)
    game.newGame(); game.dispatchMove('left'); expect(game.popup.value).toBe('goal')
  })
  it('keeps the popup and finished snapshot if a new game cannot be created', () => {
    const initial = end(); vi.mocked(createGame).mockReturnValueOnce(initial)
    let fail = false
    const game = use2048Game(() => { if (fail) throw new Error('seed failed'); return 0 })
    game.dispatchMove('left'); const before = game.state.value
    fail = true; expect(game.newGame()).toBe(false)
    expect(game.popup.value).toBe('game-over'); expect(game.state.value).toBe(before)
    expect(game.error.value).toContain('開始できません')
  })
})

describe('accessible result dialogs', () => {
  it('shows goal title, bigint score, moves and maximum; moves focus inside', async () => {
    const wrapper = app(win()); await left(wrapper)
    expect(wrapper.get('dialog h2').text()).toBe('2048達成！おめでとう！')
    expect(wrapper.get('.result-score').text()).toBe('2,112')
    expect(wrapper.get('.result-moves').text()).toBe('8'); expect(wrapper.get('.result-max').text()).toBe('2,048')
    expect(document.activeElement).toBe(wrapper.get('.dialog-continue').element)
    expect(wrapper.get('dialog').attributes('aria-modal')).toBe('true')
    expect(wrapper.get('.page-content').attributes()).toHaveProperty('inert')
    expect(wrapper.get('.page-content button[aria-label="左に移動"]').attributes()).toHaveProperty('disabled')
  })
  it('continues and restores keyboard focus to the board', async () => {
    const wrapper = app(win()); await left(wrapper)
    await wrapper.get('.dialog-continue').trigger('click'); await nextTick()
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('.game-surface').element)
    await wrapper.get('.game-surface').trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.get('.move-count').text()).toBe('9'); expect(wrapper.find('dialog').exists()).toBe(false)
  })
  it('shows the final result, allows board viewing, and keeps controls disabled', async () => {
    const wrapper = app(end()); await left(wrapper)
    expect(wrapper.get('dialog h2').text()).toBe('ゲームオーバー')
    expect(wrapper.get('.result-score').text()).toBe('128')
    expect(wrapper.get('.result-moves').text()).toBe('19'); expect(wrapper.get('.result-max').text()).toBe('4')
    expect(document.activeElement).toBe(wrapper.get('.dialog-new-game').element)
    await wrapper.get('.dialog-view-board').trigger('click'); await nextTick()
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('.game-surface').element)
    const before = readBoard(wrapper)
    await wrapper.get('.game-surface').trigger('keydown', { key: 'ArrowDown' })
    swipe(wrapper, 0, 80); await nextTick()
    expect(readBoard(wrapper)).toEqual(before); expect(wrapper.get('.move-count').text()).toBe('19')
    expect(wrapper.findAll('.direction-pad button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
  })
  it.each(['goal', 'game-over'])('Esc dismisses %s with the same meaning as its close button', async kind => {
    const wrapper = app(kind === 'goal' ? win() : end()); await left(wrapper)
    await wrapper.get('dialog').trigger('keydown', { key: 'Escape' }); await nextTick()
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(wrapper.findAll('.direction-pad button').every(button => button.attributes('disabled') !== undefined)).toBe(kind === 'game-over')
  })
  it('handles the native dialog cancel event without the browser bypassing state', async () => {
    const wrapper = app(win()); await left(wrapper)
    const event = new Event('cancel', { cancelable: true }); wrapper.get('dialog').element.dispatchEvent(event)
    await nextTick(); expect(event.defaultPrevented).toBe(true); expect(wrapper.find('dialog').exists()).toBe(false)
  })
  it('locks background scrolling while open and restores the previous style on close', async () => {
    document.body.style.overflow = 'auto'
    const wrapper = app(win()); await left(wrapper)
    expect(document.body.style.overflow).toBe('hidden')
    await wrapper.get('.dialog-continue').trigger('click'); await nextTick()
    expect(document.body.style.overflow).toBe('auto')
    document.body.style.overflow = ''
  })
  it('wraps Tab and Shift+Tab within the dialog actions', async () => {
    const wrapper = app(win()); await left(wrapper)
    const first = wrapper.get('.dialog-continue').element as HTMLElement
    const last = wrapper.get('.dialog-new-game').element as HTMLElement
    last.focus(); await wrapper.get('dialog').trigger('keydown', { key: 'Tab' }); expect(document.activeElement).toBe(first)
    await wrapper.get('dialog').trigger('keydown', { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last)
  })
  it('rejects background buttons, keyboard and swipes while a popup is open', async () => {
    const wrapper = app(win()); await left(wrapper)
    const before = readBoard(wrapper), calls = vi.mocked(createGame).mock.calls.length
    await wrapper.get('.new-game').trigger('click')
    await wrapper.get('.game-surface').trigger('keydown', { key: 'ArrowDown' })
    swipe(wrapper, 0, 80); await nextTick()
    expect(readBoard(wrapper)).toEqual(before); expect(wrapper.get('.move-count').text()).toBe('8')
    expect(vi.mocked(createGame).mock.calls).toHaveLength(calls)
    expect(wrapper.find('dialog').exists()).toBe(true)
  })
  it.each(['goal', 'game-over'])('starts a fresh game from the %s popup with no stale result', async kind => {
    const wrapper = app(kind === 'goal' ? win() : end()); await left(wrapper)
    await wrapper.get('.dialog-new-game').trigger('click'); await nextTick()
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(wrapper.find('.page-content').attributes()).not.toHaveProperty('inert')
    expect(wrapper.findAll('.tile')).toHaveLength(2)
    expect(wrapper.get('.score').text()).toBe('0'); expect(wrapper.get('.move-count').text()).toBe('0')
    expect(wrapper.get('.max-tile').text()).toBe('2')
    expect(document.activeElement).toBe(wrapper.get('.game-surface').element)
    await left(wrapper); expect(wrapper.get('.move-count').text()).toBe('1')
  })
  it('keeps a failed new-game attempt inside the popup with a visible retry error', async () => {
    const wrapper = app(win()); await left(wrapper)
    const before = readBoard(wrapper)
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => { throw new Error('unavailable') })
    await wrapper.get('.dialog-new-game').trigger('click')
    expect(wrapper.get('dialog [role="alert"]').text()).toContain('開始できません')
    expect(readBoard(wrapper)).toEqual(before)
    expect(wrapper.find('dialog').exists()).toBe(true)
  })
  it('cancels a swipe begun in the previous game when starting a new game', async () => {
    const wrapper = app(), surface = wrapper.get('.game-surface').element
    pointer(surface, 'pointerdown'); await wrapper.get('.new-game').trigger('click')
    pointer(surface, 'pointerup', { clientX: 30 }); await nextTick()
    expect(wrapper.get('.move-count').text()).toBe('0')
  })
  it('keeps large tile digits and their textual accessible value', () => {
    const wrapper = mount(GameBoard, { props: { board: tiles([1024, 2048, 65536, ...Array<number>(13).fill(0)]) } })
    wrappers.push(wrapper)
    expect(wrapper.get('[data-cell="0"]').text()).toBe('1024')
    expect(wrapper.get('[data-cell="1"]').text()).toBe('2048')
    expect(wrapper.get('[data-cell="1"]').attributes('aria-label')).toContain('2048')
    expect(wrapper.get('[data-cell="2"]').text()).toBe('65536')
  })
})
