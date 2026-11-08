import { describe, expect, it } from 'vitest'
import {
  EnemyType,
  MAX_LEVEL,
  SELL_REFUND,
  TOWERS,
  TowerType,
  towerStats,
  upgradeCost,
} from '../src/config.ts'
import { Cmd } from '../src/sim/commands.ts'
import { Ev } from '../src/sim/events.ts'
import { Game, UpgradeResult } from '../src/sim/game.ts'
import { TargetMode } from '../src/sim/towers.ts'

const SITE: [number, number] = [3, 4]

function events(g: Game): number[][] {
  const out: number[][] = []
  g.events.drain((t, a, b, c) => out.push([t, a, b, c]))
  return out
}

describe('Tower levels', () => {
  it('each upgrade costs more than the last, and raises damage, range and fire rate', () => {
    for (let type = 0; type < TOWERS.length; type++) {
      for (let lv = 1; lv < MAX_LEVEL; lv++) {
        const a = towerStats(type, lv)
        const b = towerStats(type, lv + 1)
        expect(b.damage, TOWERS[type].name).toBeGreaterThan(a.damage)
        expect(b.range).toBeGreaterThan(a.range)
        expect(b.fireRate).toBeGreaterThan(a.fireRate)
        if (lv > 1) expect(upgradeCost(type, lv)).toBeGreaterThan(upgradeCost(type, lv - 1))
      }
      expect(upgradeCost(type, MAX_LEVEL)).toBe(0)
    }
  })

  it('level 1 matches the base tower definition', () => {
    for (let type = 0; type < TOWERS.length; type++) {
      const s = towerStats(type, 1)
      expect(s.damage).toBe(TOWERS[type].damage)
      expect(s.range).toBe(TOWERS[type].range)
      expect(s.slow).toBe(TOWERS[type].slow)
      expect(s.chains).toBe(TOWERS[type].chains)
    }
  })

  it('Frost slows harder and Arc jumps further at higher levels', () => {
    expect(towerStats(TowerType.Frost, 4).slow).toBeLessThan(towerStats(TowerType.Frost, 1).slow)
    expect(towerStats(TowerType.Arc, 4).chains).toBeGreaterThan(towerStats(TowerType.Arc, 1).chains)
  })
})

describe('Upgrading', () => {
  it('charges the cost, raises the level and records the gold spent', () => {
    const g = new Game()
    g.gold = 1000
    const i = g.placeTower(TowerType.Bolt, ...SITE)
    const cost = upgradeCost(TowerType.Bolt, 1)
    events(g)
    g.commands.push(Cmd.Upgrade, ...SITE)
    g.step()
    expect(g.towers.level[i]).toBe(2)
    expect(g.gold).toBe(1000 - TOWERS[TowerType.Bolt].cost - cost)
    expect(g.towers.invested[i]).toBe(TOWERS[TowerType.Bolt].cost + cost)
    expect(events(g)).toContainEqual([Ev.Upgraded, TowerType.Bolt, 2, cost])
  })

  it('stops at level 4', () => {
    const g = new Game()
    g.gold = 10_000
    const i = g.placeTower(TowerType.Cannon, ...SITE)
    for (let k = 0; k < 3; k++) expect(g.upgradeTower(...SITE)).toBe(true)
    expect(g.towers.level[i]).toBe(MAX_LEVEL)
    expect(g.canUpgrade(...SITE)).toBe(UpgradeResult.MaxLevel)
    const gold = g.gold
    expect(g.upgradeTower(...SITE)).toBe(false)
    expect(g.gold).toBe(gold)
  })

  it('refuses without enough gold, and reports why', () => {
    const g = new Game()
    g.placeTower(TowerType.Bolt, ...SITE)
    g.gold = upgradeCost(TowerType.Bolt, 1) - 1
    events(g)
    expect(g.upgradeTower(...SITE)).toBe(false)
    expect(events(g)).toEqual([[Ev.UpgradeFailed, UpgradeResult.NoGold, 0, 0]])
    expect(g.canUpgrade(10, 10)).toBe(UpgradeResult.NoTower)
  })

  it('an upgraded tower hits harder', () => {
    const g = new Game()
    g.gold = 1000
    g.placeTower(TowerType.Sniper, ...SITE)
    g.upgradeTower(...SITE)
    const s = g.spawnEnemy(EnemyType.Brute, 0, 128)
    g.enemies.hp[s] = g.enemies.maxHp[s] = 10_000
    g.step()
    expect(10_000 - g.enemies.hp[s]).toBeCloseTo(towerStats(TowerType.Sniper, 2).damage)
  })
})

describe('Selling', () => {
  it('refunds 70% of everything spent, including upgrades, and frees the tile', () => {
    const g = new Game()
    g.gold = 1000
    g.placeTower(TowerType.Arc, ...SITE)
    g.upgradeTower(...SITE)
    const spent = TOWERS[TowerType.Arc].cost + upgradeCost(TowerType.Arc, 1)
    const before = g.gold
    events(g)
    g.commands.push(Cmd.Sell, ...SITE)
    g.step()
    const refund = Math.floor(spent * SELL_REFUND)
    expect(g.gold).toBe(before + refund)
    expect(g.towers.count).toBe(0)
    expect(g.towers.at(...SITE)).toBe(-1)
    expect(events(g)).toContainEqual([Ev.Sold, TowerType.Arc, refund, 0])
    expect(g.placeTower(TowerType.Bolt, ...SITE)).toBe(0) // the tile is buildable again
  })

  it('keeps the other towers intact when one in the middle is sold', () => {
    const g = new Game()
    g.gold = 1000
    const sites: [number, number][] = [[3, 4], [7, 6], [5, 7]]
    sites.forEach(([x, y], k) => g.placeTower(k, x, y))
    g.upgradeTower(5, 7)
    g.sellTower(3, 4)
    expect(g.towers.count).toBe(2)
    for (const [k, [x, y]] of [[1, sites[1]], [2, sites[2]]] as const) {
      const i = g.towers.at(x, y)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(g.towers.type[i]).toBe(k)
      expect(g.towers.tx[i]).toBe(x)
    }
    expect(g.towers.level[g.towers.at(5, 7)]).toBe(2)
  })

  it('does nothing on an empty tile', () => {
    const g = new Game()
    expect(g.sellTower(...SITE)).toBe(-1)
    expect(g.gold).toBe(200)
  })
})

describe('Targeting modes', () => {
  /** Three Grunts in a Bolt's range at different points along path 0, with different health. */
  function setup(): { g: Game; behind: number; middle: number; ahead: number } {
    const g = new Game()
    g.placeTower(TowerType.Bolt, ...SITE)
    const make = (d: number, hp: number): number => {
      const s = g.spawnEnemy(EnemyType.Grunt, 0, d)
      g.enemies.lane[s] = 0
      g.enemies.hp[s] = g.enemies.maxHp[s] = hp
      return s
    }
    const behind = make(60, 500)
    const middle = make(112, 300) // right beside the tower
    const ahead = make(170, 100)
    return { g, behind, middle, ahead }
  }

  const cases: [string, number, 'behind' | 'middle' | 'ahead'][] = [
    ['First picks the enemy closest to the base', TargetMode.First, 'ahead'],
    ['Last picks the enemy furthest from the base', TargetMode.Last, 'behind'],
    ['Strongest picks the most current health', TargetMode.Strongest, 'behind'],
    ['Closest picks the nearest to the tower', TargetMode.Closest, 'middle'],
  ]
  for (const [name, mode, want] of cases) {
    it(name, () => {
      const env = setup()
      env.g.commands.push(Cmd.SetTarget, ...SITE, mode)
      env.g.step()
      expect(env.g.towers.targetSlot[0]).toBe(env[want])
    })
  }

  it('Strongest follows current health, not max health', () => {
    const env = setup()
    env.g.enemies.hp[env.behind] = 50
    env.g.setTargetMode(...SITE, TargetMode.Strongest)
    env.g.step()
    expect(env.g.towers.targetSlot[0]).toBe(env.middle)
  })

  it('ignores invalid modes', () => {
    const g = new Game()
    g.placeTower(TowerType.Bolt, ...SITE)
    g.setTargetMode(...SITE, 9)
    expect(g.towers.targetMode[0]).toBe(TargetMode.First)
  })
})
