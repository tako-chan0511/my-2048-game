// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import App from '../src/App.vue'
import GameBoard from '../src/components/GameBoard.vue'
import { use2048Game } from '../src/composables/use2048Game.ts'
import { createGame, moveGame, type Direction } from '../src/core/index.ts'
import { tiles, values } from './fixtures.ts'
afterEach(() => { vi.restoreAllMocks() })
function seedBrowser(seed = 0) {
  return vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => {
    if (array instanceof Uint32Array) array[0] = seed
    return array
  })
}
describe('game state composable', () => {
  it('updates shared score, moves and maximum after a button-equivalent move', () => {
    const game = use2048Game(() => 0)
    expect(game.score.value).toBe(0n); expect(game.moves.value).toBe(0)
    expect(game.move('left')).toBe(true)
    expect(game.score.value).toBe(4n); expect(game.moves.value).toBe(1); expect(game.maxTile.value).toBe(4n)
    expect(game.goalReached.value).toBe(false); expect(game.gameOver.value).toBe(false)
  })
  it('preserves the exact state on a non-changing move', () => {
    const game = use2048Game(() => 0), before = game.state.value
    expect(game.move('up')).toBe(false); expect(game.state.value).toBe(before)
  })
  it('starts a fresh independent game and resets score and counters', () => {
    let seed = 0
    const game = use2048Game(() => seed++)
    game.move('left'); expect(game.newGame()).toBe(true)
    expect(game.state.value).toEqual(createGame(1)); expect(game.moves.value).toBe(0); expect(game.score.value).toBe(0n)
  })
  it('keeps the current game on seed-source failure and allows retry', () => {
    let fail = false
    const game = use2048Game(() => { if (fail) throw new Error('unavailable'); return 0 })
    game.move('left'); const before = game.state.value
    fail = true; expect(game.newGame()).toBe(false); expect(game.state.value).toBe(before)
    expect(game.error.value).toContain('開始できません')
    fail = false; expect(game.newGame()).toBe(true); expect(game.error.value).toBe('')
  })
  it('handles an initial seed-source failure without presenting an invalid board', () => {
    const game = use2048Game(() => { throw new Error('unavailable') })
    expect(game.state.value).toBeNull(); expect(game.move('left')).toBe(false)
    expect(game.score.value).toBe(0n); expect(game.maxTile.value).toBe(0n)
    expect(game.gameOver.value).toBe(false); expect(game.goalReached.value).toBe(false)
  })
})
describe('basic screen', () => {
  it('shows exactly 16 accessible cells and two initial tiles', () => {
    seedBrowser()
    const wrapper = mount(App)
    expect(wrapper.findAll('[role="row"]')).toHaveLength(4)
    expect(wrapper.findAll('[role="cell"]')).toHaveLength(16)
    expect(wrapper.findAll('.tile')).toHaveLength(2)
    expect(wrapper.find('.score').text()).toBe('0'); expect(wrapper.find('.move-count').text()).toBe('0')
    expect(wrapper.get('[data-cell="1"]').attributes('aria-label')).toContain('1行2列、2')
    wrapper.unmount()
  })
  it('binds all direction buttons to the same core state updates', async () => {
    seedBrowser()
    const wrapper = mount(App)
    let expected = createGame(0)
    const inputs: readonly { direction: Direction; label: string }[] = [
      { direction: 'left', label: '左' }, { direction: 'up', label: '上' },
      { direction: 'right', label: '右' }, { direction: 'down', label: '下' },
    ]
    for (const { direction, label } of inputs) {
      expected = moveGame(expected, direction).state
      await wrapper.get(`button[aria-label="${label}に移動"]`).trigger('click')
      expect(wrapper.findAll('[role="cell"]').map(cell => Number(cell.attributes('data-power')) ? 2 ** Number(cell.attributes('data-power')) : 0)).toEqual(values(expected.position.board))
      expect(wrapper.get('.score').text()).toBe(expected.position.score.toLocaleString('ja-JP'))
      expect(wrapper.get('.move-count').text()).toBe(String(expected.position.moveCount))
    }
    wrapper.unmount()
  })
  it('does not change displayed tiles or counters after an invalid move', async () => {
    seedBrowser()
    const wrapper = mount(App), before = wrapper.get('.board').html()
    await wrapper.get('button[aria-label="上に移動"]').trigger('click')
    expect(wrapper.get('.board').html()).toBe(before)
    expect(wrapper.get('.score').text()).toBe('0'); expect(wrapper.get('.move-count').text()).toBe('0')
    wrapper.unmount()
  })
  it('resets the visible board, score and moves with a new game', async () => {
    const random = seedBrowser()
    const wrapper = mount(App)
    await wrapper.get('button[aria-label="左に移動"]').trigger('click')
    expect(wrapper.get('.score').text()).toBe('4')
    random.mockImplementation(array => { if (array instanceof Uint32Array) array[0] = 42; return array })
    await wrapper.get('.new-game').trigger('click')
    expect(wrapper.findAll('.tile')).toHaveLength(2)
    expect(wrapper.get('.score').text()).toBe('0'); expect(wrapper.get('.move-count').text()).toBe('0')
    expect(random).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
  it('renders a helpful retry message if browser randomness is unavailable', () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => { throw new Error('unavailable') })
    const wrapper = mount(App)
    expect(wrapper.find('.board').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('新しいゲーム')
    wrapper.unmount()
  })
  it('automatically saves game progress in STEP 4', async () => {
    seedBrowser()
    const get = vi.spyOn(Storage.prototype, 'getItem'), set = vi.spyOn(Storage.prototype, 'setItem')
    const wrapper = mount(App)
    await wrapper.get('button[aria-label="左に移動"]').trigger('click')
    expect(get).toHaveBeenCalled(); expect(set).toHaveBeenCalled()
    wrapper.unmount()
  })
  it('displays 65536 and exposes the full value for very large future tiles', () => {
    const board = [...tiles([65536, ...Array<number>(15).fill(0)])]; board[1] = { id: 2, power: 128 }
    const wrapper = mount(GameBoard, { props: { board } })
    expect(wrapper.get('[data-cell="0"]').text()).toBe('65536')
    expect(wrapper.get('[data-cell="1"]').text()).toBe('2^128')
    expect(wrapper.get('[data-cell="1"]').attributes('aria-label')).toContain((1n << 128n).toString())
    wrapper.unmount()
  })
})
