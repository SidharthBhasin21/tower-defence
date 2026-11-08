import { describe, expect, it } from 'vitest'
import { DT, ENEMIES, EnemyType, MAX_ENEMIES, START_LIVES } from '../src/config.ts'
import { Cmd } from '../src/sim/commands.ts'
import { Ev } from '../src/sim/events.ts'
import { Game } from '../src/sim/game.ts'

const GRUNT = ENEMIES[EnemyType.Grunt]

describe('Game: enemies on paths', () => {
  it('spawns an enemy at its portal with no interpolation streak', () => {
    const g = new Game()
    const s = g.spawnEnemy(EnemyType.Grunt, 0)
    const e = g.enemies
    expect(s).toBeGreaterThanOrEqual(0)
    expect(e.dist[s]).toBe(g.paths[0].spawnDist)
    expect(e.px[s]).toBe(e.x[s])
    expect(e.py[s]).toBe(e.y[s])
    expect(e.hp[s]).toBe(GRUNT.hp)
  })

  it('moves at the defined speed and keeps the previous position', () => {
    const g = new Game()
    const s = g.spawnEnemy(EnemyType.Grunt, 0)
    const start = g.enemies.dist[s]
    for (let i = 0; i < 60; i++) g.step()
    expect(g.enemies.dist[s] - start).toBeCloseTo(GRUNT.speed, 1)
    const e = g.enemies
    expect(Math.hypot(e.x[s] - e.px[s], e.y[s] - e.py[s])).toBeCloseTo(GRUNT.speed * DT, 1)
  })

  it('costs lives when an enemy reaches the base, then frees it', () => {
    const g = new Game()
    const path = g.paths[1]
    g.spawnEnemy(EnemyType.Grunt, 1)
    const steps = Math.ceil((path.endDist - path.spawnDist) / (GRUNT.speed * DT)) + 2
    for (let i = 0; i < steps; i++) g.step()
    expect(g.lives).toBe(START_LIVES - GRUNT.leak)
    expect(g.enemies.aliveCount).toBe(0)
    expect(g.enemies.count).toBe(0)
    const seen: number[][] = []
    g.events.drain((t, a, b) => seen.push([t, a, b]))
    expect(seen).toEqual([[Ev.Leak, EnemyType.Grunt, GRUNT.leak]])
  })

  it('takes path length / speed to arrive on every ground path', () => {
    for (const pathId of [0, 1]) {
      const g = new Game()
      const p = g.paths[pathId]
      g.spawnEnemy(EnemyType.Grunt, pathId)
      const expected = Math.ceil((p.endDist - p.spawnDist) / (GRUNT.speed * DT))
      let steps = 0
      while (g.enemies.aliveCount > 0 && steps < 1e6) {
        g.step()
        steps++
      }
      expect(Math.abs(steps - expected)).toBeLessThanOrEqual(1)
    }
  })

  it('never lets lives drop below zero', () => {
    const g = new Game()
    for (let i = 0; i < START_LIVES + 10; i++) g.spawnEnemy(EnemyType.Grunt, 0)
    for (let i = 0; i < 10_000 && g.enemies.aliveCount > 0; i++) g.step()
    expect(g.lives).toBe(0)
  })

  it('refuses spawns when the pool is full', () => {
    const g = new Game()
    for (let i = 0; i < MAX_ENEMIES; i++) expect(g.spawnEnemy(EnemyType.Grunt, i & 1)).toBeGreaterThanOrEqual(0)
    expect(g.spawnEnemy(EnemyType.Grunt, 0)).toBe(-1)
  })

  it('is deterministic for the same seed', () => {
    const run = (): Float32Array => {
      const g = new Game(77)
      g.commands.push(Cmd.NextWave)
      for (let i = 0; i < 3000; i++) g.step()
      const e = g.enemies
      return Float32Array.from([g.lives, e.aliveCount, ...e.x.subarray(0, 200), ...e.lane.subarray(0, 200)])
    }
    expect(run()).toEqual(run())
  })

  it('reset restores a fresh game', () => {
    const g = new Game()
    g.spawnEnemy(EnemyType.Grunt, 0)
    for (let i = 0; i < 100; i++) g.step()
    g.reset()
    expect(g.tick).toBe(0)
    expect(g.lives).toBe(START_LIVES)
    expect(g.enemies.aliveCount).toBe(0)
    expect(g.events.length).toBe(0)
  })
})
