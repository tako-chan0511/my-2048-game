import { describe, expect, it } from 'vitest'
import { createRandomState, drawBelow, getRandomState, nextUint32, restoreRandomState, type RngState, type Uint32Source } from '../src/core/index.ts'
import { MAX_SAMPLE_DRAWS } from '../src/core/random.ts'
describe('seeded RNG', () => {
  it('matches the versioned Mulberry32 golden sequence including seed zero', () => {
    let rng = createRandomState(0)
    const output = []
    for (let i = 0; i < 5; i++) { const next = nextUint32(rng); output.push(next.value); rng = next.rng }
    expect(output).toEqual([1144304738, 1416247, 958946056, 627933444, 2007157716])
    expect(rng.state).toBe(567894473)
  })
  it.each([0, 1, 0xffffffff])('replays seed %i identically without mutating input', seed => {
    const rng = createRandomState(seed)
    expect(nextUint32(rng)).toEqual(nextUint32(createRandomState(seed)))
    expect(rng.state).toBe(seed)
    expect(Object.isFrozen(rng)).toBe(true)
  })
  it('restores a serializable RNG snapshot and reproduces all later samples', () => {
    const snapshot = getRandomState(nextUint32(createRandomState(42)).rng)
    const restored = restoreRandomState(JSON.parse(JSON.stringify(snapshot)))
    expect(restored).not.toBe(snapshot)
    let a = snapshot, b = restored
    for (let i = 0; i < 64; i++) { const x = drawBelow(a, 16 - i % 16), y = drawBelow(b, 16 - i % 16); expect(y).toEqual(x); a = x.rng; b = y.rng }
  })
  it.each([-1, 0x1_0000_0000, 0.5, NaN, Infinity])('rejects invalid seed %s', seed => {
    expect(() => createRandomState(seed)).toThrow(RangeError)
  })
  it.each([null, {}, { algorithm: 'old', state: 0 }, { algorithm: 'mulberry32-v1', state: -1 }, { algorithm: 'mulberry32-v1', state: 0, extra: true }])('rejects malformed RNG snapshot %j', raw => {
    expect(() => restoreRandomState(raw)).toThrow(RangeError)
  })
  it.each([0, -1, 1.5, NaN, 0x1_0000_0001])('rejects bound %s before consuming randomness', bound => {
    let calls = 0
    expect(() => drawBelow(createRandomState(0), bound, rng => { calls++; return nextUint32(rng) })).toThrow(RangeError)
    expect(calls).toBe(0)
  })
  it('consumes exactly one draw for a bound of one', () => {
    const initial = createRandomState(5), sampled = drawBelow(initial, 1)
    expect(sampled).toEqual({ value: 0, draws: 1, rng: nextUint32(initial).rng })
  })
  it('supports the full uint32 range', () => {
    const initial = createRandomState(17), next = nextUint32(initial)
    expect(drawBelow(initial, 0x1_0000_0000)).toEqual({ ...next, draws: 1 })
  })
  it('rejects values at the unbiased limit and counts all draws', () => {
    const samples = [0xffffffff, 0xfffffffa, 0xfffffff9]
    let i = 0
    const source: Uint32Source = rng => ({ value: samples[i++]!, rng: nextUint32(rng).rng })
    const result = drawBelow(createRandomState(0), 10, source)
    expect(result.value).toBe(9); expect(result.draws).toBe(3)
    expect(result.rng.state).toBe(1199730143)
  })
  it('bounds pathological rejection without changing the original state', () => {
    let calls = 0
    const rng = createRandomState(0)
    expect(() => drawBelow(rng, 10, current => { calls++; return { value: 0xffffffff, rng: nextUint32(current).rng } })).toThrow('sampling limit')
    expect(calls).toBe(MAX_SAMPLE_DRAWS); expect(rng.state).toBe(0)
  })
  it.each([-1, 0.5, 0x1_0000_0000, NaN])('rejects invalid source value %s', value => {
    expect(() => drawBelow(createRandomState(0), 10, rng => ({ value, rng }))).toThrow(RangeError)
  })
  it('rejects invalid RNG returned by an injected source', () => {
    expect(() => drawBelow(createRandomState(0), 10, () => ({ value: 0, rng: { algorithm: 'old', state: 1 } as unknown as RngState }))).toThrow(RangeError)
  })
})
