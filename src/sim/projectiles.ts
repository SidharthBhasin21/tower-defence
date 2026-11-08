import { DT, ENEMIES, MAX_ENEMY_RADIUS, ORPHAN_LIFE, PROJECTILE_RADIUS } from '../config.ts'
import type { Game } from './game.ts'

/**
 * Projectiles, dense structure of arrays with swap-remove
 * (ARCHITECTURE.md §4.1). Nothing holds a reference to a projectile, so
 * indices are free to move.
 */
export class ProjectilePool {
  readonly capacity: number
  readonly type: Uint8Array
  readonly x: Float32Array
  readonly y: Float32Array
  readonly px: Float32Array
  readonly py: Float32Array
  /** Unit direction of travel. */
  readonly dx: Float32Array
  readonly dy: Float32Array
  readonly speed: Float32Array
  readonly damage: Float32Array
  /** Target reference; the projectile homes while the target lives. */
  readonly targetSlot: Int32Array
  readonly targetGen: Uint32Array
  readonly life: Float32Array
  readonly hitsAir: Uint8Array
  /** Shells only: splash radius (0 for homing shots), landing point and total flight time. */
  readonly splash: Float32Array
  readonly gx: Float32Array
  readonly gy: Float32Array
  readonly flight: Float32Array
  count = 0
  /** Spawns refused because the pool was full. */
  dropped = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.type = new Uint8Array(capacity)
    this.x = new Float32Array(capacity)
    this.y = new Float32Array(capacity)
    this.px = new Float32Array(capacity)
    this.py = new Float32Array(capacity)
    this.dx = new Float32Array(capacity)
    this.dy = new Float32Array(capacity)
    this.speed = new Float32Array(capacity)
    this.damage = new Float32Array(capacity)
    this.targetSlot = new Int32Array(capacity)
    this.targetGen = new Uint32Array(capacity)
    this.life = new Float32Array(capacity)
    this.hitsAir = new Uint8Array(capacity)
    this.splash = new Float32Array(capacity)
    this.gx = new Float32Array(capacity)
    this.gy = new Float32Array(capacity)
    this.flight = new Float32Array(capacity)
  }

  /** Returns a new index, or -1 if the pool is full. */
  alloc(): number {
    if (this.count === this.capacity) {
      this.dropped++
      return -1
    }
    return this.count++
  }

  /** Removes index i by moving the last projectile into it. */
  remove(i: number): void {
    const j = --this.count
    if (i === j) return
    this.type[i] = this.type[j]
    this.x[i] = this.x[j]
    this.y[i] = this.y[j]
    this.px[i] = this.px[j]
    this.py[i] = this.py[j]
    this.dx[i] = this.dx[j]
    this.dy[i] = this.dy[j]
    this.speed[i] = this.speed[j]
    this.damage[i] = this.damage[j]
    this.targetSlot[i] = this.targetSlot[j]
    this.targetGen[i] = this.targetGen[j]
    this.life[i] = this.life[j]
    this.hitsAir[i] = this.hitsAir[j]
    this.splash[i] = this.splash[j]
    this.gx[i] = this.gx[j]
    this.gy[i] = this.gy[j]
    this.flight[i] = this.flight[j]
  }

  reset(): void {
    this.count = 0
    this.dropped = 0
  }
}

/**
 * Phase 6 of the step.
 *
 * - Homing shots (Bolt) chase a living target. If it dies first they fly
 *   straight on and hit whatever they touch, or fizzle.
 * - Shells (Cannon) fly to a fixed landing point, chosen when fired, and
 *   burst there with splash damage whether or not anything is still there.
 */
export function stepProjectiles(g: Game): void {
  const p = g.projectiles
  const e = g.enemies
  let i = 0
  while (i < p.count) {
    p.px[i] = p.x[i]
    p.py[i] = p.y[i]
    p.life[i] -= DT
    if (p.splash[i] > 0) {
      if (p.life[i] <= 0) {
        p.x[i] = p.gx[i]
        p.y[i] = p.gy[i]
        g.explode(p.x[i], p.y[i], p.splash[i], p.damage[i])
        p.remove(i)
      } else {
        p.x[i] += p.dx[i] * p.speed[i] * DT
        p.y[i] += p.dy[i] * p.speed[i] * DT
        i++
      }
      continue
    }
    const travel = p.speed[i] * DT
    const s = p.targetSlot[i]
    let hit = -1

    if (s >= 0 && e.isAlive(s, p.targetGen[i])) {
      const tx = e.x[s] - p.x[i]
      const ty = e.y[s] - p.y[i]
      const d = Math.hypot(tx, ty)
      if (d <= travel + ENEMIES[e.type[s]].radius) {
        hit = s
        p.x[i] = e.x[s]
        p.y[i] = e.y[s]
      } else {
        p.dx[i] = tx / d
        p.dy[i] = ty / d
        p.x[i] += p.dx[i] * travel
        p.y[i] += p.dy[i] * travel
      }
    } else {
      if (s >= 0) {
        // Target just died: keep flying briefly in case something else is in the way.
        p.targetSlot[i] = -1
        if (p.life[i] > ORPHAN_LIFE) p.life[i] = ORPHAN_LIFE
      }
      p.x[i] += p.dx[i] * travel
      p.y[i] += p.dy[i] * travel
      hit = touching(g, i)
    }

    if (hit >= 0) {
      g.damage(hit, p.damage[i])
      p.remove(i)
    } else if (p.life[i] <= 0) {
      p.remove(i)
    } else {
      i++
    }
  }
}

/** First living enemy overlapping a straight-flying projectile, or -1. */
function touching(g: Game, i: number): number {
  const p = g.projectiles
  const e = g.enemies
  const buf = g.queryBuf
  const reach = PROJECTILE_RADIUS + MAX_ENEMY_RADIUS
  const n = g.grid.query(e, p.x[i], p.y[i], reach, buf)
  for (let k = 0; k < n; k++) {
    const s = buf[k]
    const def = ENEMIES[e.type[s]]
    if (def.air && !p.hitsAir[i]) continue
    const r = def.radius + PROJECTILE_RADIUS
    const dx = e.x[s] - p.x[i]
    const dy = e.y[s] - p.y[i]
    if (dx * dx + dy * dy <= r * r) return s
  }
  return -1
}
