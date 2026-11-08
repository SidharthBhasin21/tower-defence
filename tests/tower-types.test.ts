import { describe, expect, it } from 'vitest'
import { ENEMIES, EnemyType, SPLASH_EDGE, TOWERS, TowerType } from '../src/config.ts'
import { BeamKind, RingKind } from '../src/sim/fx.ts'
import { Game } from '../src/sim/game.ts'

const GRUNT = ENEMIES[EnemyType.Grunt]
/** Buildable tile beside the first stretch of path 0 (which runs along row 3, y = 112). */
const SITE: [number, number] = [3, 4]

/** A Grunt on path 0, `d` px along it (x ≈ d − 16 on the first stretch), centred in its lane. */
function grunt(g: Game, d: number, hp = GRUNT.hp, armor = 0): number {
  const s = g.spawnEnemy(EnemyType.Grunt, 0, d)
  g.enemies.lane[s] = 0
  g.enemies.hp[s] = g.enemies.maxHp[s] = hp
  g.enemies.armor[s] = armor
  return s
}

function tower(g: Game, type: number): number {
  g.gold = 10_000
  return g.placeTower(type, ...SITE)
}

describe('Cannon', () => {
  it('bursts with splash: full damage at the centre, less toward the rim', () => {
    const g = new Game()
    const centre = grunt(g, 128, 1000)
    const near = grunt(g, 150, 1000)
    const far = grunt(g, 300, 1000)
    g.step() // build the grid
    const x = g.enemies.x[centre]
    const y = g.enemies.y[centre]
    g.explode(x, y, 44, 30)
    const lost = (s: number): number => 1000 - g.enemies.hp[s]
    expect(lost(centre)).toBeCloseTo(30)
    expect(lost(near)).toBeLessThan(30)
    expect(lost(near)).toBeGreaterThanOrEqual(30 * SPLASH_EDGE - 1e-6)
    expect(lost(far)).toBe(0)
    expect(g.rings.count).toBe(1)
    expect(g.rings.kind[0]).toBe(RingKind.Explosion)
  })

  it('leads a moving target so the shell lands where it will be', () => {
    const g = new Game()
    tower(g, TowerType.Cannon)
    const s = grunt(g, 60, 1000)
    let gx = Number.NaN
    let gy = Number.NaN
    for (let i = 0; i < 300; i++) {
      g.step()
      if (g.projectiles.count > 0 && Number.isNaN(gx)) {
        gx = g.projectiles.gx[0]
        gy = g.projectiles.gy[0]
      }
      if (!Number.isNaN(gx) && g.projectiles.count === 0) break
    }
    expect(Number.isNaN(gx)).toBe(false)
    expect(Math.hypot(g.enemies.x[s] - gx, g.enemies.y[s] - gy)).toBeLessThan(8)
    expect(g.enemies.hp[s]).toBeLessThan(1000)
  })
})

describe('Frost', () => {
  it('slows and chips every enemy in range with one pulse', () => {
    const g = new Game()
    tower(g, TowerType.Frost)
    const inRange = [grunt(g, 100), grunt(g, 128), grunt(g, 150)]
    const outside = grunt(g, 420)
    g.step()
    for (const s of inRange) {
      expect(g.enemies.slowMul[s]).toBe(TOWERS[TowerType.Frost].slow)
      expect(g.enemies.hp[s]).toBeCloseTo(GRUNT.hp - TOWERS[TowerType.Frost].damage)
    }
    expect(g.enemies.slowMul[outside]).toBe(1)
    expect(g.rings.kind[0]).toBe(RingKind.Frost)
  })

  it('slowed enemies move slower', () => {
    const g = new Game()
    const slowed = grunt(g, 128)
    const free = grunt(g, 300)
    g.slow(slowed, 0.5, 10)
    const a0 = g.enemies.dist[slowed]
    const b0 = g.enemies.dist[free]
    for (let i = 0; i < 60; i++) g.step()
    expect(g.enemies.dist[slowed] - a0).toBeCloseTo((g.enemies.dist[free] - b0) * 0.5, 3)
  })

  it('slows do not stack: the strongest active slow wins', () => {
    const g = new Game()
    const s = grunt(g, 128)
    const e = g.enemies
    g.slow(s, 0.5, 1)
    g.slow(s, 0.5, 1)
    expect(e.slowMul[s]).toBe(0.5) // not 0.25
    g.slow(s, 0.8, 5) // weaker: ignored while the stronger one runs
    expect(e.slowMul[s]).toBe(0.5)
    expect(e.slowT[s]).toBe(1)
    g.slow(s, 0.3, 0.5) // stronger: takes over
    expect(e.slowMul[s]).toBeCloseTo(0.3)
    for (let i = 0; i < 40; i++) g.step() // it wears off
    expect(e.slowMul[s]).toBe(1)
    g.slow(s, 0.8, 1) // nothing active: a weak slow applies
    expect(e.slowMul[s]).toBeCloseTo(0.8)
  })
})

describe('Arc', () => {
  it('chains to nearby enemies, losing damage each jump', () => {
    const g = new Game()
    tower(g, TowerType.Arc)
    const def = TOWERS[TowerType.Arc]
    const line = [100, 140, 180, 220, 260, 300].map((d) => grunt(g, d, 1000))
    g.step()
    const losses = line.map((s) => 1000 - g.enemies.hp[s]).filter((x) => x > 0).sort((a, b) => b - a)
    expect(losses).toHaveLength(def.chains + 1)
    losses.forEach((x, k) => expect(x).toBeCloseTo(def.damage * def.chainFalloff ** k, 3))
    expect(g.beams.count).toBe(def.chains + 1)
    expect(g.beams.kind[0]).toBe(BeamKind.Arc)
  })

  it('stops when no enemy is within jump range', () => {
    const g = new Game()
    tower(g, TowerType.Arc)
    const a = grunt(g, 128, 1000)
    const b = grunt(g, 128 + TOWERS[TowerType.Arc].chainRange + 40, 1000)
    g.step()
    // Whichever is struck first, the other is too far to jump to.
    const hit = [a, b].filter((s) => g.enemies.hp[s] < 1000)
    expect(hit).toHaveLength(1)
    expect(g.beams.count).toBe(1)
  })

  it('counts armor at half', () => {
    const g = new Game()
    tower(g, TowerType.Arc)
    const s = grunt(g, 128, 1000, 10)
    g.step()
    expect(1000 - g.enemies.hp[s]).toBeCloseTo(TOWERS[TowerType.Arc].damage - 5)
  })
})

describe('Sniper', () => {
  it('hits instantly for full damage, ignoring armor', () => {
    const g = new Game()
    tower(g, TowerType.Sniper)
    const s = grunt(g, 128, 1000, 50)
    g.step()
    expect(1000 - g.enemies.hp[s]).toBeCloseTo(TOWERS[TowerType.Sniper].damage)
    expect(g.projectiles.count).toBe(0)
    expect(g.beams.kind[0]).toBe(BeamKind.Sniper)
  })

  it('reaches much further than the other towers', () => {
    const others = TOWERS.filter((t) => t.name !== 'Sniper').map((t) => t.range)
    expect(TOWERS[TowerType.Sniper].range).toBeGreaterThan(Math.max(...others) * 1.6)
  })
})

describe('Every tower type', () => {
  it.each(TOWERS.map((t, i) => [t.name, i] as const))('%s damages passing Grunts', (name, type) => {
    const g = new Game()
    tower(g, type)
    const slots = [0, 1, 2, 3, 4, 5].map((k) => grunt(g, 40 + k * 24))
    let hurt = 0
    for (let i = 0; i < 1200; i++) {
      g.step()
      for (const s of slots) if (g.enemies.hp[s] < GRUNT.hp) hurt |= 1 << slots.indexOf(s)
    }
    expect(hurt).not.toBe(0)
    // Frost only chips; every other tower kills outright.
    if (name !== 'Frost') expect(g.kills).toBeGreaterThan(0)
  })

  it('has a distinct hotkey, a cost and a description', () => {
    expect(new Set(TOWERS.map((t) => t.key)).size).toBe(TOWERS.length)
    for (const t of TOWERS) {
      expect(t.cost).toBeGreaterThan(0)
      expect(t.blurb.length).toBeGreaterThan(10)
    }
  })

  it('effects expire and free their pools', () => {
    const g = new Game()
    tower(g, TowerType.Arc)
    const s = grunt(g, 128, 1000)
    g.step()
    expect(g.beams.count).toBeGreaterThan(0)
    g.damage(s, 1e9) // nothing left to shoot, so nothing refills the pool
    for (let i = 0; i < 30; i++) g.step()
    expect(g.beams.count).toBe(0)
    expect(g.rings.count).toBe(0)
  })
})
