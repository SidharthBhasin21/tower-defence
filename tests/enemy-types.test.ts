import { describe, expect, it } from 'vitest'
import {
  ENEMIES,
  EnemyType,
  MENDER_HEAL,
  MENDER_INTERVAL,
  MENDER_RADIUS,
  TOWERS,
  TowerType,
  WARLORD_SPLIT,
} from '../src/config.ts'
import { Ev } from '../src/sim/events.ts'
import { Game } from '../src/sim/game.ts'

/** Path 2 is the air route. */
const AIR = 2

function spawn(g: Game, type: number, d: number, path = 0): number {
  const s = g.spawnEnemy(type, path, d)
  g.enemies.lane[s] = 0
  return s
}

describe('Enemy roster', () => {
  it('has the 7 types from DOMAIN.md with their traits', () => {
    expect(ENEMIES.map((e) => e.name)).toEqual(['Grunt', 'Runner', 'Swarmling', 'Brute', 'Wisp', 'Mender', 'Warlord'])
    const by = (t: number) => ENEMIES[t]
    expect(by(EnemyType.Runner).speed).toBeGreaterThan(by(EnemyType.Grunt).speed * 1.5)
    expect(by(EnemyType.Runner).hp).toBeLessThan(by(EnemyType.Grunt).hp)
    expect(by(EnemyType.Swarmling).hp).toBeLessThan(by(EnemyType.Runner).hp)
    expect(by(EnemyType.Brute).armor).toBeGreaterThan(by(EnemyType.Grunt).armor)
    expect(by(EnemyType.Brute).speed).toBeLessThan(by(EnemyType.Grunt).speed)
    expect(ENEMIES.filter((e) => e.air).map((e) => e.name)).toEqual(['Wisp'])
    expect(by(EnemyType.Warlord).hp).toBeGreaterThan(by(EnemyType.Brute).hp * 5)
    expect(ENEMIES.map((e) => e.leak)).toEqual([1, 1, 1, 3, 2, 2, 20])
  })
})

describe('Brute armor', () => {
  it('shrugs off Bolts but not Snipers', () => {
    const g = new Game()
    const s = spawn(g, EnemyType.Brute, 128)
    const armor = ENEMIES[EnemyType.Brute].armor
    const hp = g.enemies.hp[s]
    g.damage(s, TOWERS[TowerType.Bolt].damage)
    expect(hp - g.enemies.hp[s]).toBeCloseTo(TOWERS[TowerType.Bolt].damage - armor)
    const hp2 = g.enemies.hp[s]
    g.damage(s, 50, 2) // ArmorMode.Ignore
    expect(hp2 - g.enemies.hp[s]).toBeCloseTo(50)
  })
})

describe('Wisp (air)', () => {
  it('flies the air route and is ignored by Cannon and Arc', () => {
    for (const type of [TowerType.Cannon, TowerType.Arc]) {
      const g = new Game()
      g.gold = 1000
      // Tile (21,4) sits right under the air route's first leg.
      const t = g.placeTower(type, 21, 4)
      expect(t).toBeGreaterThanOrEqual(0)
      const s = spawn(g, EnemyType.Wisp, 30, AIR)
      for (let i = 0; i < 600; i++) g.step()
      expect(g.enemies.hp[s], TOWERS[type].name).toBe(g.enemies.maxHp[s])
      expect(g.projectiles.count).toBe(0)
    }
  })

  it('is hit by towers that hit air', () => {
    for (const type of [TowerType.Bolt, TowerType.Frost, TowerType.Sniper]) {
      const g = new Game()
      g.gold = 1000
      g.placeTower(type, 21, 4)
      const s = spawn(g, EnemyType.Wisp, 30, AIR)
      let hurt = false
      for (let i = 0; i < 600 && !hurt; i++) {
        g.step()
        hurt = !g.enemies.alive[s] || g.enemies.hp[s] < g.enemies.maxHp[s]
      }
      expect(hurt, TOWERS[type].name).toBe(true)
    }
  })
})

describe('Mender', () => {
  it('heals hurt enemies nearby every few seconds, but not ones far away', () => {
    const g = new Game()
    spawn(g, EnemyType.Mender, 300)
    const near = spawn(g, EnemyType.Brute, 300 + MENDER_RADIUS / 2)
    const far = spawn(g, EnemyType.Brute, 300 + MENDER_RADIUS * 3)
    const e = g.enemies
    e.hp[near] = e.hp[far] = 50
    const steps = Math.ceil(MENDER_INTERVAL * 60) + 1
    for (let i = 0; i < steps; i++) g.step()
    expect(e.hp[near]).toBeCloseTo(50 + e.maxHp[near] * MENDER_HEAL)
    expect(e.hp[far]).toBe(50)
    expect(g.rings.count).toBeGreaterThan(0)
  })

  it('never heals above full health', () => {
    const g = new Game()
    const m = spawn(g, EnemyType.Mender, 300)
    g.enemies.hp[m] = g.enemies.maxHp[m] - 1
    for (let i = 0; i < 400; i++) g.step()
    expect(g.enemies.hp[m]).toBe(g.enemies.maxHp[m])
  })
})

describe('Warlord', () => {
  it('splits into Runners where it dies, after the step', () => {
    const g = new Game()
    const w = spawn(g, EnemyType.Warlord, 400)
    g.step()
    const d = g.enemies.dist[w]
    g.damage(w, 1e9)
    expect(g.enemies.aliveCount).toBe(0) // nothing appears mid-step
    g.step()
    const e = g.enemies
    expect(e.aliveCount).toBe(WARLORD_SPLIT)
    for (let k = 0; k < e.count; k++) {
      const s = e.active[k]
      expect(e.type[s]).toBe(EnemyType.Runner)
      expect(Math.abs(e.dist[s] - d)).toBeLessThan(40)
    }
    let split = 0
    g.events.drain((t, a) => {
      if (t === Ev.BossSplit) split = a
    })
    expect(split).toBe(WARLORD_SPLIT)
  })

  it('keeps its wave open until the Runners it releases are gone too', () => {
    const g = new Game()
    // Fast-forward to wave 10, clearing everything as it comes.
    const clear = (): void => {
      const e = g.enemies
      for (let k = 0; k < e.count; k++) if (e.alive[e.active[k]] && e.type[e.active[k]] !== EnemyType.Warlord) g.damage(e.active[k], 1e9)
    }
    while (g.wave < 10) {
      if (g.canCallWave()) g.callNextWave()
      g.step()
      clear()
    }
    let boss = -1
    for (let i = 0; i < 20_000 && boss < 0; i++) {
      g.step()
      clear()
      const e = g.enemies
      for (let k = 0; k < e.count; k++) if (e.type[e.active[k]] === EnemyType.Warlord && e.alive[e.active[k]]) boss = e.active[k]
    }
    expect(boss).toBeGreaterThanOrEqual(0)
    for (let i = 0; i < 20_000 && g.spawning > 0; i++) {
      g.step()
      clear()
    }
    const clearedBefore = g.cleared
    g.damage(boss, 1e9)
    g.step()
    expect(g.enemies.aliveCount).toBe(WARLORD_SPLIT)
    expect(g.cleared).toBe(clearedBefore) // Runners still out
    clear()
    g.step()
    expect(g.cleared).toBe(10)
  })
})
