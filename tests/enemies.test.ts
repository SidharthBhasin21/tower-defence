import { describe, expect, it } from 'vitest'
import { Rng } from '../src/rng.ts'
import { EnemyPool } from '../src/sim/enemies.ts'

function activeSet(p: EnemyPool): number[] {
  return [...p.active.subarray(0, p.count)].sort((a, b) => a - b)
}

describe('EnemyPool', () => {
  it('allocates up to capacity, then returns -1', () => {
    const p = new EnemyPool(8)
    const slots = Array.from({ length: 8 }, () => p.alloc())
    expect(new Set(slots).size).toBe(8)
    expect(p.alloc()).toBe(-1)
    expect(p.aliveCount).toBe(8)
  })

  it('keeps a killed slot reserved until flush', () => {
    const p = new EnemyPool(4)
    const a = p.alloc()
    p.kill(a)
    expect(p.alive[a]).toBe(0)
    expect(p.aliveCount).toBe(0)
    expect(p.count).toBe(1) // still in the active list
    for (let i = 0; i < 3; i++) expect(p.alloc()).not.toBe(a)
    expect(p.alloc()).toBe(-1)
    p.flush()
    expect(p.alloc()).toBe(a)
  })

  it('detects stale references through the generation', () => {
    const p = new EnemyPool(4)
    const s = p.alloc()
    const gen = p.generation[s]
    expect(p.isAlive(s, gen)).toBe(true)
    p.kill(s)
    expect(p.isAlive(s, gen)).toBe(false)
    p.flush()
    const again = p.alloc()
    expect(again).toBe(s)
    expect(p.isAlive(s, gen)).toBe(false)
    expect(p.isAlive(s, p.generation[s])).toBe(true)
  })

  it('ignores double kills', () => {
    const p = new EnemyPool(4)
    const s = p.alloc()
    p.kill(s)
    p.kill(s)
    p.flush()
    expect(p.count).toBe(0)
    expect(p.aliveCount).toBe(0)
  })

  it('keeps the active list exactly equal to the living set under random churn', () => {
    const p = new EnemyPool(256)
    const rng = new Rng(3)
    const living = new Set<number>()
    for (let round = 0; round < 500; round++) {
      for (let i = rng.int(0, 10); i > 0; i--) {
        const s = p.alloc()
        if (s >= 0) living.add(s)
      }
      for (const s of [...living]) {
        if (rng.next() < 0.2) {
          p.kill(s)
          living.delete(s)
        }
      }
      p.flush()
      expect(activeSet(p)).toEqual([...living].sort((a, b) => a - b))
      expect(p.aliveCount).toBe(living.size)
    }
  })

  it('reset empties the pool without changing capacity', () => {
    const p = new EnemyPool(16)
    for (let i = 0; i < 10; i++) p.alloc()
    p.reset()
    expect(p.count).toBe(0)
    expect(p.aliveCount).toBe(0)
    for (let i = 0; i < 16; i++) expect(p.alloc()).toBeGreaterThanOrEqual(0)
    expect(p.alloc()).toBe(-1)
  })
})
