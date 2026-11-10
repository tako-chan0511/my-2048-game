// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from '../src/App.vue'
import GameBoard from '../src/components/GameBoard.vue'
import { createGame, moveGame, DEFAULT_SETTINGS, type GameState } from '../src/core/index.ts'
import { use2048Game } from '../src/composables/use2048Game.ts'
import { POP_MS, SLIDE_MS, type MovePresentation } from '../src/presentation/tiles.ts'
import { beforeGoal } from './mode-fixtures.ts'
import { encodeGame } from '../src/services/gameCodec.ts'
import { stateFor } from './fixtures.ts'
const wrappers: VueWrapper[] = []
let media: MediaQueryList
let change: (() => void) | undefined
const GAME_KEY = 'my-2048-game:progress:v1'
beforeEach(() => {
  vi.useFakeTimers()
  media = { matches: false, addEventListener: vi.fn((_, listener) => { change = listener as () => void }), removeEventListener: vi.fn() } as unknown as MediaQueryList
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => { if (array instanceof Uint32Array) array[0] = 0; return array })
  if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function () {}
  if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () {}
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open') })
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.clearAllTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = ''; change = undefined
})
function board(initial = createGame(0)) {
  const wrapper = mount(GameBoard, { props: { board: initial.position.board, size: initial.settings.size } })
  wrappers.push(wrapper)
  return wrapper
}
function app() { const wrapper = mount(App, { attachTo: document.body }); wrappers.push(wrapper); return wrapper }
function event(game = createGame(0), id = 1): MovePresentation { return { id, before: game.position.board, result: moveGame(game, 'left') } }
async function show(wrapper: VueWrapper, e: MovePresentation) { await wrapper.setProps({ board: e.result.state.position.board, presentation: e }) }
async function advance(ms: number) { vi.advanceTimersByTime(ms); await nextTick() }
async function left(wrapper: VueWrapper) { await wrapper.get('button[aria-label="左に移動"]').trigger('click') }

describe('bounded tile animation lifecycle', () => {
  it('slides original IDs, pops one merge and one spawn, then releases the overlay', async () => {
    const wrapper = board(), e = event()
    await show(wrapper, e)
    expect(wrapper.attributes('data-animation')).toBe('slide')
    expect(wrapper.findAll('.visual-tile').map(tile => Number(tile.attributes('data-visual-id'))).sort()).toEqual([1, 2])
    expect(wrapper.get('.tile-animation-layer').attributes('aria-hidden')).toBe('true')
    expect(wrapper.findAll('[role="cell"]')).toHaveLength(16)
    expect(wrapper.get('[data-cell="0"]').attributes('aria-label')).toContain('4')
    await advance(SLIDE_MS)
    expect(wrapper.attributes('data-animation')).toBe('pop')
    expect(wrapper.findAll('.effect-merge')).toHaveLength(1); expect(wrapper.findAll('.effect-spawn')).toHaveLength(1)
    await advance(POP_MS)
    expect(wrapper.attributes('data-animation')).toBe('idle'); expect(wrapper.findAll('.visual-tile')).toHaveLength(0)
  })
  it('pops two simultaneous merges only once each', async () => {
    const initial = stateFor([2, 2, 2, 2, ...Array<number>(12).fill(0)]), wrapper = board(initial)
    await show(wrapper, event(initial)); await advance(SLIDE_MS)
    expect(wrapper.findAll('.effect-merge')).toHaveLength(2)
    expect(wrapper.findAll('.effect-merge').map(tile => tile.text())).toEqual(['4', '4'])
    expect(wrapper.findAll('.effect-spawn')).toHaveLength(1)
  })
  it('keeps initial/restored boards static and does not animate no-op moves', async () => {
    const timer = vi.spyOn(globalThis, 'setTimeout')
    const wrapper = app(), before = wrapper.get('.board').html()
    await wrapper.get('button[aria-label="上に移動"]').trigger('click')
    expect(wrapper.get('.board').html()).toBe(before)
    expect(wrapper.findAll('.visual-tile')).toHaveLength(0)
    expect(timer.mock.calls.filter(call => call[1] === SLIDE_MS || call[1] === POP_MS)).toHaveLength(0)
  })
  it('cancels old timers on rapid moves and never queues inputs', async () => {
    const wrapper = app()
    for (let i = 0; i < 20; i++) {
      await wrapper.get(`button[aria-label="${['左', '下', '右', '上'][i % 4]}に移動"]`).trigger('click')
      const ids = wrapper.findAll('.visual-tile').map(tile => tile.attributes('data-visual-id'))
      expect(new Set(ids).size).toBe(ids.length)
    }
    const finalBoard = wrapper.findAll('[role="cell"]').map(cell => cell.attributes('data-tile-id'))
    const persisted = localStorage.getItem(GAME_KEY)
    await advance(SLIDE_MS + POP_MS + 1000)
    expect(wrapper.findAll('[role="cell"]').map(cell => cell.attributes('data-tile-id'))).toEqual(finalBoard)
    expect(localStorage.getItem(GAME_KEY)).toBe(persisted)
    expect(wrapper.get('.board').attributes('data-animation')).toBe('idle')
  })
  it('rapid frames keep at most one outstanding presentation timer', async () => {
    let game = createGame(0)
    const wrapper = board(game)
    for (let i = 0; i < 20; i++) {
      const result = moveGame(game, (['left', 'down', 'right', 'up'] as const)[i % 4]!)
      await show(wrapper, { id: i + 1, before: game.position.board, result })
      game = result.state
      expect(vi.getTimerCount()).toBeLessThanOrEqual(1)
    }
    await advance(SLIDE_MS + POP_MS); expect(vi.getTimerCount()).toBe(0)
  })
  it('a replacement after an elapsed first phase survives the old completion time', async () => {
    const wrapper = board(), first = event()
    await show(wrapper, first); await advance(SLIDE_MS)
    const before = first.result.state, second = { id: 2, before: before.position.board, result: moveGame(before, 'down') }
    await show(wrapper, second)
    await advance(POP_MS)
    expect(wrapper.attributes('data-animation')).toBe('slide')
    expect(wrapper.findAll('.visual-tile').map(tile => Number(tile.attributes('data-visual-id'))).sort()).toEqual(second.before.flatMap(tile => tile ? [tile.id] : []).sort())
    await advance(SLIDE_MS + POP_MS)
    expect(wrapper.attributes('data-animation')).toBe('idle')
  })
  it('ignores arbitrary animation end/cancel events and never changes game results', async () => {
    const wrapper = app(); await left(wrapper)
    const saved = localStorage.getItem(GAME_KEY)
    await wrapper.get('.visual-tile').trigger('animationend')
    await wrapper.get('.visual-tile').trigger('animationcancel')
    expect(localStorage.getItem(GAME_KEY)).toBe(saved)
    expect(wrapper.get('.score').text()).toBe('4'); expect(wrapper.get('.move-count').text()).toBe('1')
  })
  it('Undo discards motion and spawn, while replay restores the exact RNG result', async () => {
    const wrapper = app(); await left(wrapper)
    const after = JSON.parse(localStorage.getItem(GAME_KEY)!) as { game: GameState }
    await wrapper.get('.undo-button').trigger('click')
    expect(wrapper.get('.board').attributes('data-animation')).toBe('idle')
    expect(wrapper.findAll('.effect-spawn')).toHaveLength(0)
    await advance(SLIDE_MS + POP_MS)
    expect(wrapper.get('.score').text()).toBe('0')
    await left(wrapper)
    const replay = JSON.parse(localStorage.getItem(GAME_KEY)!) as { game: GameState }
    expect(replay.game.position).toEqual(after.game.position)
  })
  it('a new game discards all prior frames even when tile IDs are reused', async () => {
    const wrapper = app(); await left(wrapper)
    await wrapper.get('.new-game').trigger('click'); await advance(SLIDE_MS + POP_MS)
    expect(wrapper.get('.board').attributes('data-animation')).toBe('idle')
    expect(wrapper.get('.move-count').text()).toBe('0'); expect(wrapper.findAll('.tile')).toHaveLength(2)
    await left(wrapper); expect(wrapper.get('.board').attributes('data-animation')).toBe('slide')
  })
  it('saves the committed position during motion and restores without replaying it', async () => {
    const wrapper = app(); await left(wrapper)
    expect(wrapper.get('.board').attributes('data-animation')).toBe('slide')
    const text = localStorage.getItem(GAME_KEY)!
    expect(text).not.toMatch(/presentation|animation|motions|merges/)
    const cells = wrapper.findAll('[role="cell"]').map(cell => cell.attributes('data-tile-id'))
    wrapper.unmount(); wrappers.pop()
    const restored = app()
    expect(restored.get('.board').attributes('data-animation')).toBe('idle')
    expect(restored.findAll('[role="cell"]').map(cell => cell.attributes('data-tile-id'))).toEqual(cells)
    expect(restored.get('.restore-status').text()).toContain('復元')
  })
  it('honors reduced motion at startup without adding presentation timers', async () => {
    Object.assign(media, { matches: true })
    const timer = vi.spyOn(globalThis, 'setTimeout')
    const wrapper = app(); await left(wrapper)
    expect(wrapper.get('.board').attributes('data-reduced-motion')).toBe('true')
    expect(wrapper.get('.board').attributes('data-animation')).toBe('idle')
    expect(timer.mock.calls.filter(call => call[1] === SLIDE_MS || call[1] === POP_MS)).toHaveLength(0)
    expect(wrapper.get('.score').text()).toBe('4')
  })
  it('changing motion preference cancels immediately without replaying an old frame', async () => {
    const wrapper = board(); await show(wrapper, event())
    Object.assign(media, { matches: true }); change!(); await nextTick()
    expect(wrapper.attributes('data-animation')).toBe('idle')
    Object.assign(media, { matches: false }); change!(); await nextTick()
    expect(wrapper.attributes('data-animation')).toBe('idle')
  })
  it('viewport resizing snaps to the exact committed board', async () => {
    const wrapper = board(); await show(wrapper, event())
    window.dispatchEvent(new Event('resize')); await nextTick(); await advance(SLIDE_MS + POP_MS)
    expect(wrapper.attributes('data-animation')).toBe('idle'); expect(wrapper.get('[data-cell="0"]').text()).toBe('4')
  })
  it('container resizing disconnects old motion safely and releases its observer', async () => {
    let notify: ResizeObserverCallback | undefined
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { notify = callback } observe() {} disconnect = disconnect })
    const wrapper = board(); await show(wrapper, event())
    const entry = (width: number) => [{ contentRect: { width } }] as ResizeObserverEntry[]
    notify!(entry(400), {} as ResizeObserver)
    expect(wrapper.attributes('data-animation')).toBe('slide')
    notify!(entry(260), {} as ResizeObserver); await nextTick()
    expect(wrapper.attributes('data-animation')).toBe('idle')
    wrapper.unmount(); wrappers.pop(); expect(disconnect).toHaveBeenCalledOnce()
  })
  it('hiding the tab cancels without replaying on visibility restoration', async () => {
    const wrapper = board(); await show(wrapper, event())
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange')); await nextTick()
    expect(wrapper.attributes('data-animation')).toBe('idle')
    hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange')); await nextTick()
    expect(wrapper.attributes('data-animation')).toBe('idle')
  })
  it('never starts a move while the page is hidden', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    const wrapper = board(); await show(wrapper, event())
    expect(wrapper.attributes('data-animation')).toBe('idle')
  })
  it('unmount removes pending work and external listeners', async () => {
    const wrapper = board(); await show(wrapper, event())
    expect(vi.getTimerCount()).toBe(1)
    wrapper.unmount(); wrappers.pop()
    expect(vi.getTimerCount()).toBe(0)
    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })
  it.each(['normal', 'moves', 'timed'] as const)('goal and %s limit results never wait for an animation callback', async kind => {
    const fixture = beforeGoal(kind === 'normal' ? { kind } : kind === 'timed' ? { kind, seconds: 10 } : { kind, limit: 1000 })
    let session = fixture.session
    if (kind === 'timed') session = { ...session, clock: { startedAtMs: Date.now(), deadlineMs: Date.now() + 10000, lastObservedAtMs: Date.now() } }
    if (kind === 'moves') session = { ...session, game: { ...session.game, settings: { ...session.game.settings, mode: { kind, limit: session.game.position.moveCount + 1 } } } }
    localStorage.setItem(GAME_KEY, encodeGame(session))
    const wrapper = app(), labels = { left: '左', right: '右', up: '上', down: '下' }
    await wrapper.get(`button[aria-label="${labels[fixture.direction]}に移動"]`).trigger('click')
    expect(wrapper.get('dialog h2').text()).toContain('達成！')
    expect(wrapper.get('.board').attributes('data-animation')).toBe('idle')
    expect(wrapper.get('.page-content').attributes()).toHaveProperty('inert')
    const before = localStorage.getItem(GAME_KEY)
    await left(wrapper); expect(localStorage.getItem(GAME_KEY)).toBe(before)
    await wrapper.get('.dialog-continue').trigger('click')
    expect(wrapper.get('.board').attributes('data-animation')).toBe('idle')
    if (kind === 'moves') expect(wrapper.get('dialog h2').text()).toBe('手数上限に到達')
    else expect(wrapper.find('dialog').exists()).toBe(false)
  })
  it('suspending and resuming a board never replays the most recent move', async () => {
    const wrapper = board(); await show(wrapper, event())
    await wrapper.setProps({ suspended: true }); await wrapper.setProps({ suspended: false })
    expect(wrapper.attributes('data-animation')).toBe('idle')
  })
  it('a size change during motion starts a fresh board with no stale overlay', async () => {
    const wrapper = board(); await show(wrapper, event())
    const next = createGame(0, { ...DEFAULT_SETTINGS, size: 10 })
    await wrapper.setProps({ board: next.position.board, size: 10, presentation: null })
    await advance(SLIDE_MS + POP_MS)
    expect(wrapper.findAll('[role="cell"]')).toHaveLength(100)
    expect(wrapper.attributes('data-animation')).toBe('idle')
  })
  it('presentation data is cleared on Undo/new game and never belongs to game state', () => {
    const game = use2048Game(() => 0)
    expect(game.presentation.value).toBeNull(); game.dispatchMove('left')
    expect(game.presentation.value!.result.state).toBe(game.state.value)
    game.undo(); expect(game.presentation.value).toBeNull()
    game.dispatchMove('left'); game.newGame(); expect(game.presentation.value).toBeNull()
  })
})
