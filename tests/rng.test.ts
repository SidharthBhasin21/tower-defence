import { describe, expect, it } from 'vitest'
import { Rng } from '../src/rng.ts'

describe('Rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Rng(1234)
    const b = new Rng(1234)
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next())
  })

  it('produces different sequences for different seeds', () => {
    const a = new Rng(1)
    const b = new Rng(2)
    let same = 0
    for (let i = 0; i < 100; i++) if (a.next() === b.next()) same++
    expect(same).toBeLessThan(5)
  })

  it('stays in [0, 1) and is roughly uniform', () => {
    const r = new Rng(42)
    const buckets = new Array<number>(10).fill(0)
    const n = 100_000
    for (let i = 0; i < n; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      buckets[Math.floor(v * 10)]++
    }
    for (const count of buckets) expect(Math.abs(count - n / 10)).toBeLessThan(n / 100)
  })

  it('int() covers the inclusive range', () => {
    const r = new Rng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 6)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(6)
      seen.add(v)
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6])
  })

  it('reseed() restarts the sequence', () => {
    const r = new Rng(99)
    const first = r.next()
    r.next()
    r.reseed(99)
    expect(r.next()).toBe(first)
  })
})
