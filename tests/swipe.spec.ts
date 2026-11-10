import { describe, expect, it } from 'vitest'
import { SWIPE_DOMINANCE, SWIPE_THRESHOLD, swipeDirection } from '../src/input/swipe.ts'

describe('swipe direction in CSS pixels', () => {
  it.each([
    { dx: 100, dy: 12, direction: 'right' }, { dx: -100, dy: 12, direction: 'left' },
    { dx: 12, dy: 100, direction: 'down' }, { dx: 12, dy: -100, direction: 'up' },
    { dx: 24, dy: 0, direction: 'right' }, { dx: -24, dy: 0, direction: 'left' },
    { dx: 0, dy: 24, direction: 'down' }, { dx: 0, dy: -24, direction: 'up' },
  ])('$dx, $dy → $direction', ({ dx, dy, direction }) => {
    expect(swipeDirection(dx, dy)).toBe(direction)
  })
  it.each([[0, 0], [23.99, 0], [-23.99, 0], [0, 23.99], [0, -23.99], [17, 17], [90, 90], [-90, 90], [90, -90], [-90, -90]])('ignores a short or ambiguous gesture %j', (dx, dy) => {
    expect(swipeDirection(dx, dy)).toBeNull()
  })
  it('uses an explicit distance and dominance boundary', () => {
    expect(SWIPE_THRESHOLD).toBe(24)
    expect(swipeDirection(100 * SWIPE_DOMINANCE, 100)).toBe('right')
    expect(swipeDirection(100 * SWIPE_DOMINANCE - 0.01, 100)).toBeNull()
  })
  it.each([[NaN, 50], [50, NaN], [Infinity, 0], [0, -Infinity]])('rejects non-finite displacement %j', (dx, dy) => {
    expect(swipeDirection(dx, dy)).toBeNull()
  })
})
