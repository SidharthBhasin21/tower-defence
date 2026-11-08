import { AIM_TOLERANCE, DT, ENEMIES, MAP_H, MAP_W, MAX_ENEMY_RADIUS, RETARGET_STEPS, TILE, TOWERS } from '../config.ts'
import { Ev } from './events.ts'
import type { Game } from './game.ts'

const TAU = Math.PI * 2

export const TargetMode = {
  First: 0,
} as const

/**
 * Tower storage, dense structure of arrays (ARCHITECTURE.md §4.1).
 * The UI refers to towers by tile, via `byTile`, because indices move when a
 * tower is removed.
 */
export class TowerStore {
  readonly capacity: number
  readonly type: Uint8Array
  readonly level: Uint8Array
  readonly tx: Int16Array
  readonly ty: Int16Array
  /** Centre, in world px. */
  readonly x: Float32Array
  readonly y: Float32Array
  /** Seconds until the next shot. */
  readonly cooldown: Float32Array
  /** Turret angle now and at the previous step (radians), for interpolation. */
  readonly angle: Float32Array
  readonly prevAngle: Float32Array
  /** 1 right after firing, decaying to 0 (drawing only). */
  readonly recoil: Float32Array
  readonly targetMode: Uint8Array
  readonly targetSlot: Int32Array
  readonly targetGen: Uint32Array
  /** Steps until the target is re-picked. */
  readonly retarget: Int16Array
  /** Gold spent on this tower (build + upgrades), for selling. */
  readonly invested: Float32Array
  /** Tower index per tile, or -1. */
  readonly byTile: Int16Array
  count = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.type = new Uint8Array(capacity)
    this.level = new Uint8Array(capacity)
    this.tx = new Int16Array(capacity)
    this.ty = new Int16Array(capacity)
    this.x = new Float32Array(capacity)
    this.y = new Float32Array(capacity)
    this.cooldown = new Float32Array(capacity)
    this.angle = new Float32Array(capacity)
    this.prevAngle = new Float32Array(capacity)
    this.recoil = new Float32Array(capacity)
    this.targetMode = new Uint8Array(capacity)
    this.targetSlot = new Int32Array(capacity)
    this.targetGen = new Uint32Array(capacity)
    this.retarget = new Int16Array(capacity)
    this.invested = new Float32Array(capacity)
    this.byTile = new Int16Array(MAP_W * MAP_H).fill(-1)
  }

  at(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return -1
    return this.byTile[ty * MAP_W + tx]
  }

  /** Adds a tower; the caller has already checked the rules. Returns its index. */
  add(type: number, tx: number, ty: number, cost: number): number {
    const i = this.count++
    this.type[i] = type
    this.level[i] = 1
    this.tx[i] = tx
    this.ty[i] = ty
    this.x[i] = (tx + 0.5) * TILE
    this.y[i] = (ty + 0.5) * TILE
    this.cooldown[i] = 0
    // Face up the screen until there's something to aim at.
    this.angle[i] = this.prevAngle[i] = -Math.PI / 2
    this.recoil[i] = 0
    this.targetMode[i] = TargetMode.First
    this.targetSlot[i] = -1
    this.targetGen[i] = 0
    this.retarget[i] = 0
    this.invested[i] = cost
    this.byTile[ty * MAP_W + tx] = i
    return i
  }

  reset(): void {
    this.count = 0
    this.byTile.fill(-1)
  }
}

/** Phase 5 of the step: cooldowns, targeting, aiming and firing. */
export function stepTowers(g: Game): void {
  const t = g.towers
  const e = g.enemies
  for (let i = 0; i < t.count; i++) {
    const def = TOWERS[t.type[i]]
    t.prevAngle[i] = t.angle[i]
    if (t.cooldown[i] > 0) t.cooldown[i] -= DT
    if (t.recoil[i] > 0) t.recoil[i] = Math.max(0, t.recoil[i] - DT * 8)

    // Keep the current target unless it died, left range, or it's time to re-pick.
    let s = t.targetSlot[i]
    const valid = e.isAlive(s, t.targetGen[i]) && inRange(g, i, s, def.range)
    if (!valid || --t.retarget[i] <= 0) {
      s = acquire(g, i, def.range, def.hitsAir)
      t.targetSlot[i] = s
      t.targetGen[i] = s >= 0 ? e.generation[s] : 0
      t.retarget[i] = RETARGET_STEPS
    }
    if (s < 0) continue

    // Turn toward the target at a limited rate.
    const want = Math.atan2(e.y[s] - t.y[i], e.x[s] - t.x[i])
    let diff = want - t.angle[i]
    diff -= Math.round(diff / TAU) * TAU
    const maxTurn = def.turnRate * DT
    t.angle[i] += diff > maxTurn ? maxTurn : diff < -maxTurn ? -maxTurn : diff

    if (t.cooldown[i] <= 0 && Math.abs(diff) <= AIM_TOLERANCE) {
      t.cooldown[i] += 1 / (def.fireRate * g.fireRateMul)
      if (t.cooldown[i] < 0) t.cooldown[i] = 0
      t.recoil[i] = 1
      g.fireProjectile(i, s)
      g.events.push(Ev.Shot, t.type[i], i)
    }
  }
}

function inRange(g: Game, i: number, s: number, range: number): boolean {
  const e = g.enemies
  const r = range + ENEMIES[e.type[s]].radius
  const dx = e.x[s] - g.towers.x[i]
  const dy = e.y[s] - g.towers.y[i]
  return dx * dx + dy * dy <= r * r
}

/** Picks a target with the grid. "First" = the enemy closest to the base. */
function acquire(g: Game, i: number, range: number, hitsAir: boolean): number {
  const e = g.enemies
  const buf = g.queryBuf
  const n = g.grid.query(e, g.towers.x[i], g.towers.y[i], range + MAX_ENEMY_RADIUS, buf)
  let best = -1
  let bestRemaining = Infinity
  for (let k = 0; k < n; k++) {
    const s = buf[k]
    const def = ENEMIES[e.type[s]]
    if (def.air && !hitsAir) continue
    if (!inRange(g, i, s, range)) continue
    const remaining = g.paths[e.pathId[s]].endDist - e.dist[s]
    if (remaining < bestRemaining) {
      bestRemaining = remaining
      best = s
    }
  }
  return best
}
