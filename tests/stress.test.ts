import { describe, expect, it } from 'vitest'
import { FrameRecorder } from '../src/perf/recorder.ts'
import { Game } from '../src/sim/game.ts'
import { STRESS_ENEMIES, STRESS_PROJECTILES, STRESS_TOWERS, StressController, towerSites } from '../src/sim/stress.ts'

describe('Stress scenario', () => {
  it('holds 5,000 enemies, 100 towers and 1,000 projectiles after every step', () => {
    const g = new Game()
    const stress = new StressController()
    stress.setup(g)
    expect(g.towers.count).toBe(STRESS_TOWERS)
    // Let it fill up, then check every step for a few seconds of game time.
    for (let i = 0; i < 30; i++) {
      stress.step(g)
      g.step()
    }
    let minEnemies = Infinity
    let minProjectiles = Infinity
    for (let i = 0; i < 300; i++) {
      stress.step(g)
      g.step()
      minEnemies = Math.min(minEnemies, g.enemies.aliveCount)
      minProjectiles = Math.min(minProjectiles, g.projectiles.count)
    }
    expect(minEnemies).toBeGreaterThanOrEqual(STRESS_ENEMIES)
    expect(minProjectiles).toBeGreaterThanOrEqual(STRESS_PROJECTILES)
    expect(g.kills).toBeGreaterThan(0) // towers really fight
    expect(g.projectiles.dropped).toBe(0)
  })

  it('places towers only on buildable tiles, all different', () => {
    const g = new Game()
    const sites = towerSites(g, STRESS_TOWERS)
    expect(sites).toHaveLength(STRESS_TOWERS)
    expect(new Set(sites.map(([x, y]) => `${x},${y}`)).size).toBe(STRESS_TOWERS)
    for (const [x, y] of sites) expect(g.map.isBuildable(x, y)).toBe(true)
  })
})

describe('FrameRecorder', () => {
  it('computes percentiles and slow-frame share', () => {
    const r = new FrameRecorder(1024)
    // 90 frames at 16.7 ms, 10 at 40 ms.
    for (let i = 0; i < 90; i++) r.record(16.7, 1, 2, 1, i)
    for (let i = 0; i < 10; i++) r.record(40, 1, 2, 1, i)
    const s = r.stats()
    expect(s.frames).toBe(100)
    expect(s.p50).toBeCloseTo(16.7, 3)
    expect(s.p95).toBe(40)
    expect(s.slowPct).toBeCloseTo(10, 5)
    expect(s.at45Pct).toBeCloseTo(90, 5)
    expect(s.simAvg).toBe(1)
    expect(s.renderAvg).toBe(2)
  })

  it('keeps only the most recent frames once the ring wraps', () => {
    const r = new FrameRecorder(64)
    for (let i = 0; i < 64; i++) r.record(50, 0, 0, 1, i)
    for (let i = 0; i < 64; i++) r.record(10, 0, 0, 1, i)
    const s = r.stats()
    expect(s.frames).toBe(64)
    expect(s.max).toBe(10)
    expect(r.stats(8).frames).toBe(8)
  })
})
