import { MAP_H, MAP_W, MAX_LEVEL, TILE, TOWERS, towerStats, upgradeCost } from '../config.ts'
import type { Game } from './game.ts'
import { Phase } from './game.ts'

/**
 * A scripted player (ARCHITECTURE.md §8), used by the balance tests and the
 * full-run benchmark. It plays through the same public actions a person
 * uses: build, upgrade and call the next wave.
 *
 * Strategy, in order of priority, every ACT_EVERY steps:
 * 1. Keep the number of towers at `towersFor(wave)`: build the type that is
 *    furthest below its share of `mix`, on the free tile where that type
 *    covers the most path. If that type isn't affordable yet, save for it.
 * 2. Otherwise upgrade: the lowest-level tower first, best-placed first.
 * 3. Call the next wave early only when the map is empty.
 *
 * Plans with different mixes and limits give the weak and single-tower
 * players the balance tests compare against.
 */
export interface BotPlan {
  /** Weight of each tower type in the build mix (index = TowerType). 0 = never build. */
  mix: readonly number[]
  /** Upgrade towers once the build target is met. */
  upgrades: boolean
  /** Never own more towers than this. */
  maxTowers: number
  /** Towers wanted at the start and per wave reached. */
  baseTowers: number
  towersPerWave: number
}

export const REFERENCE_PLAN: BotPlan = {
  mix: [3, 2, 1, 2, 2],
  upgrades: true,
  maxTowers: 40,
  baseTowers: 3,
  towersPerWave: 0.6,
}

/** A careless player: a handful of Bolts, never upgraded. */
export const WEAK_PLAN: BotPlan = {
  mix: [1, 0, 0, 0, 0],
  upgrades: false,
  maxTowers: 8,
  baseTowers: 3,
  towersPerWave: 0.5,
}

/** The reference plan restricted to one tower type. */
export function singleTowerPlan(type: number): BotPlan {
  const mix = [0, 0, 0, 0, 0]
  mix[type] = 1
  return { ...REFERENCE_PLAN, mix }
}

const ACT_EVERY = 15

export class Bot {
  private readonly g: Game
  private readonly plan: BotPlan
  /** Per tower type: buildable tiles, best coverage first. */
  private readonly sites: number[][] = []
  /** Per tile and type: how much path the type covers from there. */
  private readonly coverage: Float32Array[] = []
  private readonly mixTotal: number
  /** Towers owned per type (scratch, reused so deciding allocates nothing). */
  private readonly owned = new Int32Array(TOWERS.length)

  constructor(g: Game, plan: BotPlan) {
    this.g = g
    this.plan = plan
    this.mixTotal = plan.mix.reduce((a, b) => a + b, 0)
    for (let type = 0; type < TOWERS.length; type++) {
      const cov = siteCoverage(g, type)
      this.coverage.push(cov)
      const tiles: number[] = []
      for (let t = 0; t < cov.length; t++) if (cov[t] > 0) tiles.push(t)
      tiles.sort((a, b) => cov[b] - cov[a])
      this.sites.push(tiles)
    }
  }

  /** Call once per sim step, before `game.step()`. */
  step(): void {
    const g = this.g
    if (g.phase !== Phase.Playing || g.tick % ACT_EVERY !== 0) return
    if (g.wave === 0) {
      this.spend()
      g.callNextWave()
      return
    }
    this.spend()
    if (g.enemies.aliveCount === 0 && g.spawning === 0 && g.canCallWave()) g.callNextWave()
  }

  /** Builds or upgrades while gold allows. */
  private spend(): void {
    const g = this.g
    const p = this.plan
    for (let guard = 0; guard < 8; guard++) {
      const want = Math.min(p.maxTowers, Math.floor(p.baseTowers + p.towersPerWave * g.wave))
      if (g.towers.count < want) {
        const type = this.nextType()
        if (g.gold < TOWERS[type].cost) return // save up for it
        const tile = this.freeSite(type)
        if (tile < 0 || g.placeTower(type, tile % MAP_W, (tile / MAP_W) | 0) < 0) return
        continue
      }
      if (!p.upgrades) return
      const i = this.upgradeChoice()
      if (i < 0) return
      const t = g.towers
      if (g.gold < upgradeCost(t.type[i], t.level[i])) return
      g.upgradeTower(t.tx[i], t.ty[i])
    }
  }

  /** The type furthest below its share of the mix. */
  private nextType(): number {
    const g = this.g
    const owned = this.owned
    owned.fill(0)
    for (let i = 0; i < g.towers.count; i++) owned[g.towers.type[i]]++
    const total = g.towers.count + 1
    let best = -1
    let bestGap = -Infinity
    for (let type = 0; type < TOWERS.length; type++) {
      if (this.plan.mix[type] <= 0) continue
      const gap = (this.plan.mix[type] / this.mixTotal) * total - owned[type]
      if (gap > bestGap) {
        bestGap = gap
        best = type
      }
    }
    return best
  }

  private freeSite(type: number): number {
    const sites = this.sites[type]
    for (let k = 0; k < sites.length; k++) {
      const tile = sites[k]
      if (this.g.towers.at(tile % MAP_W, (tile / MAP_W) | 0) < 0) return tile
    }
    return -1
  }

  /** Lowest-level tower; among equals, the best placed. -1 if all are maxed. */
  private upgradeChoice(): number {
    const t = this.g.towers
    let best = -1
    let bestKey = Infinity
    for (let i = 0; i < t.count; i++) {
      if (t.level[i] >= MAX_LEVEL) continue
      const key = t.level[i] * 1e6 - this.coverage[t.type[i]][t.ty[i] * MAP_W + t.tx[i]]
      if (key < bestKey) {
        bestKey = key
        best = i
      }
    }
    return best
  }
}

/**
 * How much path a tower of `type` would cover from each buildable tile:
 * path samples within its level-1 range. Ground samples count once per
 * path through them (the shared tail carries both paths); air samples count
 * only for towers that hit air, at a weight for how few enemies fly.
 */
function siteCoverage(g: Game, type: number): Float32Array {
  const def = towerStats(type, 1)
  const out = new Float32Array(MAP_W * MAP_H)
  const r2 = def.range * def.range
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (!g.map.isBuildable(tx, ty)) continue
      const cx = (tx + 0.5) * TILE
      const cy = (ty + 0.5) * TILE
      let score = 0
      for (const path of g.paths) {
        if (path.air && !def.hitsAir) continue
        const w = path.air ? 0.35 : 1
        for (let k = 0; k < path.count; k++) {
          const dx = path.x[k] - cx
          const dy = path.y[k] - cy
          if (dx * dx + dy * dy <= r2) score += w
        }
      }
      out[ty * MAP_W + tx] = score
    }
  }
  return out
}
