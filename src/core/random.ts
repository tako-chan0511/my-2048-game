import type { RandomDraw, RngState, Uint32Source } from './types.ts'
import { assertRng, assertSeed, integer } from './validation.ts'
const RANGE = 0x1_0000_0000
export const MAX_SAMPLE_DRAWS = 128
export function createRandomState(seed: number): RngState { assertSeed(seed); return Object.freeze({ algorithm: 'mulberry32-v1', state: seed }) }
export function restoreRandomState(raw: unknown): RngState { assertRng(raw); return Object.freeze({ algorithm: raw.algorithm, state: raw.state }) }
export function getRandomState(rng: RngState): RngState { return restoreRandomState(rng) }
export const nextUint32: Uint32Source = rng => {
  assertRng(rng)
  const state = (rng.state + 0x6d2b79f5) >>> 0
  let value = Math.imul(state ^ state >>> 15, state | 1)
  value ^= value + Math.imul(value ^ value >>> 7, value | 61)
  return { value: (value ^ value >>> 14) >>> 0, rng: Object.freeze({ algorithm: rng.algorithm, state }) }
}
// Rejection sampling avoids modulo bias. Even bound=1 consumes a draw. Bounds
// and the rejection limit are deterministic; no wall-clock budget is involved.
export function drawBelow(rng: RngState, bound: number, source: Uint32Source = nextUint32): RandomDraw {
  assertRng(rng)
  if (!integer(bound, 1, RANGE)) throw new RangeError('Invalid random bound')
  const limit = Math.floor(RANGE / bound) * bound
  let current = rng
  for (let draws = 1; draws <= MAX_SAMPLE_DRAWS; draws++) {
    const next = source(current)
    if (!integer(next.value, 0, RANGE - 1)) throw new RangeError('Random source returned a non-uint32 value')
    assertRng(next.rng); current = next.rng
    if (next.value < limit) return Object.freeze({ value: next.value % bound, rng: getRandomState(current), draws })
  }
  throw new RangeError('Random sampling limit exceeded')
}
