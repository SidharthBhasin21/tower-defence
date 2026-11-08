import { describe, expect, it } from 'vitest'
import { AIR_LIFT, DT, ENEMIES, EnemyType, MAX_PARTICLES, MAX_TEXTS, TowerType } from '../src/config.ts'
import { Ev } from '../src/sim/events.ts'
import { ParticleColor, ParticlePool, TextPool } from '../src/sim/fx.ts'
import { Game } from '../src/sim/game.ts'

describe('Particles', () => {
  it('move outwards, slow down and expire', () => {
    const p = new ParticlePool()
    p.burst(100, 100, 8, ParticleColor.Spark, 100, 0.5, 2)
    expect(p.count).toBe(8)
    for (let k = 0; k < 10; k++) p.step()
    for (let i = 0; i < p.count; i++) expect(Math.hypot(p.x[i] - 100, p.y[i] - 100)).toBeGreaterThan(0)
    for (let k = 0; k < Math.ceil(0.5 / DT) + 1; k++) p.step()
    expect(p.count).toBe(0)
  })

  it('drops new particles when the pool is full', () => {
    const p = new ParticlePool()
    p.burst(0, 0, MAX_PARTICLES + 50, 0, 10, 1, 1)
    expect(p.count).toBe(MAX_PARTICLES)
  })

  it('replay the same after a reset', () => {
    const p = new ParticlePool()
    p.burst(0, 0, 4, 0, 50, 1, 1)
    const first = Array.from(p.vx.subarray(0, 4))
    p.reset()
    p.burst(0, 0, 4, 0, 50, 1, 1)
    expect(Array.from(p.vx.subarray(0, 4))).toEqual(first)
  })
})

describe('Floating text', () => {
  it('replaces the oldest when full, and expires', () => {
    const t = new TextPool()
    for (let k = 0; k < MAX_TEXTS + 3; k++) t.add(0, 0, k)
    expect(t.count).toBe(MAX_TEXTS)
    expect(t.value[0]).toBe(MAX_TEXTS) // the first entries were overwritten
    for (let k = 0; k < Math.ceil(0.9 / DT) + 1; k++) t.step()
    expect(t.count).toBe(0)
  })
})

describe('Effects from the sim', () => {
  it('a kill bursts particles in the enemy colour and shows its gold', () => {
    const g = new Game()
    const s = g.spawnEnemy(EnemyType.Brute, 0, 200)
    g.damage(s, 1e9)
    expect(g.particles.count).toBeGreaterThan(0)
    expect(g.particles.color[0]).toBe(EnemyType.Brute)
    expect(g.texts.count).toBe(1)
    expect(g.texts.value[0]).toBe(ENEMIES[EnemyType.Brute].bounty)
  })

  it('a flyer dies at its drawn height', () => {
    const g = new Game()
    const s = g.spawnEnemy(EnemyType.Wisp, 2, 200)
    const y = g.enemies.y[s]
    g.damage(s, 1e9)
    expect(g.particles.y[0]).toBeCloseTo(y - AIR_LIFT)
  })

  it('a shell burst sends an Explode event and fire particles', () => {
    const g = new Game()
    g.explode(300, 300, 40, 10)
    expect(g.particles.color[0]).toBe(ParticleColor.Fire)
    let explode = 0
    g.events.drain((type) => {
      if (type === Ev.Explode) explode++
    })
    expect(explode).toBe(1)
  })

  it('effects never change the game: same result with the effect pools cleared every step', () => {
    const run = (clear: boolean): number[] => {
      const g = new Game(5)
      g.gold = 2000
      for (const [x, y] of [[3, 4], [8, 7], [14, 6], [9, 17]]) g.placeTower(TowerType.Cannon, x, y)
      g.placeTower(TowerType.Bolt, 5, 7)
      g.callNextWave()
      for (let k = 0; k < 4000; k++) {
        if (g.canCallWave()) g.callNextWave()
        g.step()
        if (clear) {
          g.particles.reset()
          g.texts.reset()
        }
      }
      return [g.tick, g.wave, g.lives, g.gold, g.score, g.kills, g.enemies.aliveCount]
    }
    const a = run(false)
    expect(a[5]).toBeGreaterThan(0)
    expect(run(true)).toEqual(a)
  })

  it('reset clears the effect pools', () => {
    const g = new Game()
    g.explode(300, 300, 40, 10)
    g.reset()
    expect(g.particles.count).toBe(0)
    expect(g.texts.count).toBe(0)
  })
})
