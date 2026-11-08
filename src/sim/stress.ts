import { EnemyType, TILE, TowerType } from '../config.ts'
import { Rng } from '../rng.ts'
import type { Game } from './game.ts'

/** Targets from the brief. */
export const STRESS_ENEMIES = 5000
export const STRESS_TOWERS = 100
export const STRESS_PROJECTILES = 1000

/** Stress enemies are tough so most survive, but towers still kill some. */
const STRESS_HP = 600
/** Towers fire this much faster so real shots make up most of the projectiles. */
const FIRE_RATE_MUL = 6
/**
 * Projectiles are topped up before the step and some hit during it, so aim
 * above the target to stay at or over 1,000 after every step.
 */
const PROJECTILE_TOP_UP = Math.round(STRESS_PROJECTILES * 1.15)
/** Same for enemies: towers kill some during the step, after the top-up. */
const ENEMY_TOP_UP = STRESS_ENEMIES + 50
/** Most enemies added per step while topping up (avoids a one-frame spike). */
const MAX_SPAWNS_PER_STEP = 400

/**
 * The stress scenario (ARCHITECTURE.md §7.2): keeps 5,000 enemies, 100 towers
 * and at least 1,000 projectiles alive at once, with unlimited lives.
 *
 * Runs inside the fixed step like everything else, so it is deterministic.
 * All 5 tower types and every enemy type join as features add them; for now
 * it uses Bolts and Grunts.
 */
export class StressController {
  private readonly rng = new Rng(0x5eed)
  private nextPath = 0

  /** Builds the towers on the buildable tiles closest to a path. */
  setup(g: Game): void {
    g.fireRateMul = FIRE_RATE_MUL
    for (const [tx, ty] of towerSites(g, STRESS_TOWERS)) g.towers.add(TowerType.Bolt, tx, ty, 0)
  }

  /** Call before each `game.step()`. */
  step(g: Game): void {
    // Unlimited lives: leaks are replaced by the top-up below.
    g.lives = 9999

    // Top up enemies, spread along the whole path so the field fills at once.
    let spawns = 0
    while (g.enemies.aliveCount < ENEMY_TOP_UP && spawns < MAX_SPAWNS_PER_STEP) {
      const pathId = this.nextPath
      this.nextPath = 1 - this.nextPath
      const p = g.paths[pathId]
      const s = g.spawnEnemy(EnemyType.Grunt, pathId, this.rng.range(p.spawnDist, p.endDist - TILE))
      if (s < 0) break
      g.enemies.hp[s] = g.enemies.maxHp[s] = STRESS_HP
      spawns++
    }

    // Top up projectiles with extra shots from random towers at random enemies.
    const e = g.enemies
    let guard = 0
    while (g.projectiles.count < PROJECTILE_TOP_UP && e.count > 0 && guard++ < 2000) {
      const i = this.rng.int(0, g.towers.count - 1)
      const s = e.active[this.rng.int(0, e.count - 1)]
      if (!e.alive[s]) continue
      g.fireProjectile(i, s)
    }
  }
}

/** The `n` buildable tiles nearest to a ground path, in a fixed order. */
export function towerSites(g: Game, n: number): [number, number][] {
  const sites: [number, number, number][] = []
  for (let ty = 0; ty < g.map.height; ty++) {
    for (let tx = 0; tx < g.map.width; tx++) {
      if (!g.map.isBuildable(tx, ty) || g.towers.at(tx, ty) >= 0) continue
      const cx = (tx + 0.5) * TILE
      const cy = (ty + 0.5) * TILE
      let best = Infinity
      for (const p of g.paths) {
        if (p.air) continue
        for (let i = 0; i < p.count; i += 4) best = Math.min(best, (p.x[i] - cx) ** 2 + (p.y[i] - cy) ** 2)
      }
      sites.push([tx, ty, best])
    }
  }
  sites.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0])
  return sites.slice(0, n).map(([tx, ty]) => [tx, ty])
}
