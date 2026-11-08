import { describe, expect, it } from 'vitest'
import { WORLD_H, WORLD_W } from '../src/config.ts'
import { Rng } from '../src/rng.ts'
import { EnemyPool } from '../src/sim/enemies.ts'
import { SpatialGrid } from '../src/sim/grid.ts'

function scatter(n: number, seed: number): EnemyPool {
  const pool = new EnemyPool(n + 16)
  const rng = new Rng(seed)
  for (let i = 0; i < n; i++) {
    const s = pool.alloc()
    // Include positions past the map edge, which clamp into edge cells.
    pool.x[s] = rng.range(-150, WORLD_W + 150)
    pool.y[s] = rng.range(-150, WORLD_H + 150)
  }
  return pool
}

function brute(pool: EnemyPool, x: number, y: number, r: number): number[] {
  const out: number[] = []
  for (let k = 0; k < pool.count; k++) {
    const s = pool.active[k]
    if (!pool.alive[s]) continue
    if ((pool.x[s] - x) ** 2 + (pool.y[s] - y) ** 2 <= r * r) out.push(s)
  }
  return out.sort((a, b) => a - b)
}

describe('SpatialGrid', () => {
  it('matches a brute-force search for random queries', () => {
    const pool = scatter(3000, 11)
    const grid = new SpatialGrid(pool.capacity)
    grid.rebuild(pool)
    const out = new Int32Array(pool.capacity)
    const rng = new Rng(12)
    for (let q = 0; q < 300; q++) {
      const x = rng.range(-100, WORLD_W + 100)
      const y = rng.range(-100, WORLD_H + 100)
      const r = rng.range(0, 400)
      const n = grid.query(pool, x, y, r, out)
      expect([...out.subarray(0, n)].sort((a, b) => a - b)).toEqual(brute(pool, x, y, r))
    }
  })

  it('lists every living enemy exactly once', () => {
    const pool = scatter(2000, 21)
    const grid = new SpatialGrid(pool.capacity)
    grid.rebuild(pool)
    expect(grid.size).toBe(2000)
    expect(new Set(grid.items.subarray(0, grid.size)).size).toBe(2000)
    expect(grid.cellStart[grid.cols * grid.rows]).toBe(2000)
  })

  it('skips enemies killed after the rebuild and drops them on the next one', () => {
    const pool = scatter(500, 31)
    const grid = new SpatialGrid(pool.capacity)
    grid.rebuild(pool)
    const out = new Int32Array(pool.capacity)
    const victim = pool.active[0]
    pool.kill(victim)
    const n = grid.query(pool, pool.x[victim], pool.y[victim], 1, out)
    expect([...out.subarray(0, n)]).not.toContain(victim)
    pool.flush()
    grid.rebuild(pool)
    expect(grid.size).toBe(499)
  })

  it('keeps each cell sorted into its own run', () => {
    const pool = scatter(1500, 41)
    const grid = new SpatialGrid(pool.capacity)
    grid.rebuild(pool)
    for (let c = 0; c < grid.cols * grid.rows; c++) {
      for (let i = grid.cellStart[c]; i < grid.cellStart[c + 1]; i++) {
        const s = grid.items[i]
        expect(grid.row(pool.y[s]) * grid.cols + grid.col(pool.x[s])).toBe(c)
      }
    }
  })
})
