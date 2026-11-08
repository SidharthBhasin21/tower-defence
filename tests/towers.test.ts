import { describe, expect, it } from 'vitest'
import { ENEMIES, EnemyType, MAX_TOWERS, SCORE_PER_BOUNTY, START_GOLD, TOWERS, TowerType } from '../src/config.ts'
import { Cmd } from '../src/sim/commands.ts'
import { Ev } from '../src/sim/events.ts'
import { Game, PlaceResult } from '../src/sim/game.ts'
import { Tile } from '../src/sim/map.ts'

const BOLT = TOWERS[TowerType.Bolt]
const GRUNT = ENEMIES[EnemyType.Grunt]

/** A buildable tile next to the first stretch of path 0, which runs along row 3. */
const NEAR_PATH: [number, number] = [3, 4]

function events(g: Game): number[][] {
  const out: number[][] = []
  g.events.drain((t, a, b, c) => out.push([t, a, b, c]))
  return out
}

describe('Building towers', () => {
  it('builds on open ground and charges the cost', () => {
    const g = new Game()
    expect(g.map.isBuildable(...NEAR_PATH)).toBe(true)
    expect(g.placeTower(TowerType.Bolt, ...NEAR_PATH)).toBe(0)
    expect(g.gold).toBe(START_GOLD - BOLT.cost)
    expect(g.towers.at(...NEAR_PATH)).toBe(0)
    expect(events(g)).toEqual([[Ev.TowerPlaced, TowerType.Bolt, ...NEAR_PATH]])
  })

  it('refuses paths, scenery, the base, off-map tiles and occupied tiles', () => {
    const g = new Game()
    const blocked = (kind: number): [number, number] => {
      for (let y = 0; y < g.map.height; y++) for (let x = 0; x < g.map.width; x++) if (g.map.kind(x, y) === kind) return [x, y]
      throw new Error('no tile of that kind')
    }
    expect(g.canPlace(TowerType.Bolt, ...blocked(Tile.Path))).toBe(PlaceResult.Blocked)
    expect(g.canPlace(TowerType.Bolt, ...blocked(Tile.Tree))).toBe(PlaceResult.Blocked)
    expect(g.canPlace(TowerType.Bolt, ...blocked(Tile.Water))).toBe(PlaceResult.Blocked)
    expect(g.canPlace(TowerType.Bolt, ...blocked(Tile.Base))).toBe(PlaceResult.Blocked)
    expect(g.canPlace(TowerType.Bolt, -1, 0)).toBe(PlaceResult.OutOfBounds)
    g.placeTower(TowerType.Bolt, ...NEAR_PATH)
    expect(g.canPlace(TowerType.Bolt, ...NEAR_PATH)).toBe(PlaceResult.Occupied)
    expect(g.gold).toBe(START_GOLD - BOLT.cost)
  })

  it('refuses when the player cannot afford it, and reports why', () => {
    const g = new Game()
    g.gold = BOLT.cost - 1
    expect(g.placeTower(TowerType.Bolt, ...NEAR_PATH)).toBe(-1)
    expect(g.gold).toBe(BOLT.cost - 1)
    expect(events(g)).toEqual([[Ev.PlaceFailed, PlaceResult.NoGold, ...NEAR_PATH]])
  })

  it('stops at the tower limit', () => {
    const g = new Game()
    g.gold = 1e9
    let built = 0
    for (let y = 0; y < g.map.height && built < MAX_TOWERS; y++)
      for (let x = 0; x < g.map.width && built < MAX_TOWERS; x++) if (g.placeTower(TowerType.Bolt, x, y) >= 0) built++
    if (built === MAX_TOWERS) {
      // Find any remaining buildable tile and check it's refused for the limit.
      for (let y = 0; y < g.map.height; y++)
        for (let x = 0; x < g.map.width; x++)
          if (g.map.isBuildable(x, y) && g.towers.at(x, y) < 0) {
            expect(g.canPlace(TowerType.Bolt, x, y)).toBe(PlaceResult.TooManyTowers)
            return
          }
    }
    expect(built).toBeLessThanOrEqual(MAX_TOWERS)
  })

  it('applies queued place commands on the next step only', () => {
    const g = new Game()
    g.commands.push(Cmd.Place, TowerType.Bolt, ...NEAR_PATH)
    expect(g.towers.count).toBe(0)
    g.step()
    expect(g.towers.count).toBe(1)
  })
})

describe('Combat', () => {
  it('a Bolt kills a passing Grunt and pays its bounty', () => {
    const g = new Game()
    g.placeTower(TowerType.Bolt, ...NEAR_PATH)
    const gold = g.gold
    const s = g.spawnEnemy(EnemyType.Grunt, 0)
    for (let i = 0; i < 600 && g.enemies.alive[s]; i++) g.step()
    expect(g.enemies.alive[s]).toBe(0)
    expect(g.kills).toBe(1)
    expect(g.gold).toBe(gold + GRUNT.bounty)
    expect(g.score).toBe(GRUNT.bounty * SCORE_PER_BOUNTY)
    expect(g.lives).toBe(20)
    const evs = events(g)
    expect(evs.filter((e) => e[0] === Ev.Shot).length).toBeGreaterThanOrEqual(Math.ceil(GRUNT.hp / BOLT.damage))
    expect(evs.filter((e) => e[0] === Ev.Kill)).toEqual([[Ev.Kill, EnemyType.Grunt, GRUNT.bounty, s]])
  })

  it('does not fire with nothing in range', () => {
    const g = new Game()
    g.placeTower(TowerType.Bolt, ...NEAR_PATH)
    for (let i = 0; i < 120; i++) g.step()
    expect(g.projectiles.count).toBe(0)
    expect(events(g).some((e) => e[0] === Ev.Shot)).toBe(false)
  })

  it('targets the enemy closest to the base', () => {
    const g = new Game()
    const i = g.placeTower(TowerType.Bolt, ...NEAR_PATH)
    const behind = g.spawnEnemy(EnemyType.Grunt, 0)
    const ahead = g.spawnEnemy(EnemyType.Grunt, 0)
    // Put both in range, with `ahead` further along the path.
    g.enemies.dist[behind] = 90
    g.enemies.dist[ahead] = 120
    g.step()
    expect(g.towers.targetSlot[i]).toBe(ahead)
  })

  it('fires no faster than its fire rate', () => {
    const g = new Game()
    g.placeTower(TowerType.Bolt, ...NEAR_PATH)
    g.gold = 0
    // A tough enemy that won't die, parked in range.
    const s = g.spawnEnemy(EnemyType.Grunt, 0)
    g.enemies.speed[s] = 0
    g.enemies.dist[s] = 110
    g.enemies.hp[s] = g.enemies.maxHp[s] = 1e9
    for (let i = 0; i < 600; i++) g.step()
    const shots = events(g).filter((e) => e[0] === Ev.Shot).length
    expect(shots).toBeLessThanOrEqual(Math.ceil(10 * BOLT.fireRate) + 1)
    expect(shots).toBeGreaterThanOrEqual(Math.floor(10 * BOLT.fireRate) - 1)
  })

  it('applies armor with a floor of 20% damage', () => {
    const g = new Game()
    const s = g.spawnEnemy(EnemyType.Grunt, 0)
    g.enemies.hp[s] = g.enemies.maxHp[s] = 100
    g.enemies.armor[s] = 5
    g.damage(s, 12)
    expect(g.enemies.hp[s]).toBe(93)
    g.enemies.armor[s] = 50
    g.damage(s, 10)
    expect(g.enemies.hp[s]).toBeCloseTo(91, 5)
  })

  it('removes projectiles whose target died, and frees the pool', () => {
    const g = new Game()
    g.placeTower(TowerType.Bolt, ...NEAR_PATH)
    g.spawnEnemy(EnemyType.Grunt, 0)
    for (let i = 0; i < 1200; i++) g.step()
    expect(g.enemies.aliveCount).toBe(0)
    expect(g.projectiles.count).toBe(0)
  })

  it('stays deterministic with towers and combat', () => {
    const run = (): number[] => {
      const g = new Game(5)
      g.placeTower(TowerType.Bolt, ...NEAR_PATH)
      g.placeTower(TowerType.Bolt, 4, 17)
      for (let i = 0; i < 4000; i++) {
        if (i % 40 === 0) g.spawnEnemy(EnemyType.Grunt, (i / 40) & 1)
        g.step()
      }
      return [g.lives, g.gold, g.score, g.kills, g.enemies.aliveCount, g.projectiles.count]
    }
    expect(run()).toEqual(run())
  })
})
