import type { Direction } from '../core/types.ts'

export const SWIPE_THRESHOLD = 24 // CSS pixels, independent of screen density.
export const SWIPE_DOMINANCE = 1.15

export function swipeDirection(dx: number, dy: number): Direction | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
  const x = Math.abs(dx), y = Math.abs(dy)
  if (Math.max(x, y) < SWIPE_THRESHOLD) return null
  // Ambiguous diagonals are ignored rather than choosing an accidental move.
  if (x >= y * SWIPE_DOMINANCE) return dx > 0 ? 'right' : 'left'
  if (y >= x * SWIPE_DOMINANCE) return dy > 0 ? 'down' : 'up'
  return null
}
