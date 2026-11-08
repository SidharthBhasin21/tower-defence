import {
  AIM_TOLERANCE,
  towerStats,
  DT,
  ENEMIES,
  MAP_H,
  MAP_W,
  MAX_ENEMY_RADIUS,
  RETARGET_STEPS,
  TILE,
  TowerType,
  type TowerDef,
} from '../config.ts'
import { Ev } from './events.ts'
import { BeamKind, RingKind } from './fx.ts'
import type { Game } from './game.ts'

const TAU = Math.PI * 2

/** Which enemy in range a tower picks (DOMAIN.md §2.3). */
export const TargetMode = {
  /** Closest to the base. */
  First: 0,
  /** Furthest from the base. */
  Last: 1,
  /** Most current health. */
  Strongest: 2,
  /** Nearest to the tower. */
  Closest: 3,
} as const
export const TARGET_MODE_NAMES = ['First', 'Last', 'Strongest', 'Closest'] as const
export const TARGET_MODE_COUNT = 4

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

  /** Removes tower `i` by moving the last tower into its place. */
  remove(i: number): void {
    this.byTile[this.ty[i] * MAP_W + this.tx[i]] = -1
    const j = --this.count
    if (i === j) return
    this.type[i] = this.type[j]
    this.level[i] = this.level[j]
    this.tx[i] = this.tx[j]
    this.ty[i] = this.ty[j]
    this.x[i] = this.x[j]
    this.y[i] = this.y[j]
    this.cooldown[i] = this.cooldown[j]
    this.angle[i] = this.angle[j]
    this.prevAngle[i] = this.prevAngle[j]
    this.recoil[i] = this.recoil[j]
    this.targetMode[i] = this.targetMode[j]
    this.targetSlot[i] = this.targetSlot[j]
    this.targetGen[i] = this.targetGen[j]
    this.retarget[i] = this.retarget[j]
    this.invested[i] = this.invested[j]
    this.byTile[this.ty[i] * MAP_W + this.tx[i]] = i
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
    const def = towerStats(t.type[i], t.level[i])
    t.prevAngle[i] = t.angle[i]
    if (t.cooldown[i] > 0) t.cooldown[i] -= DT
    if (t.recoil[i] > 0) t.recoil[i] = Math.max(0, t.recoil[i] - DT * 8)

    // Keep the current target unless it died, left range, or it's time to re-pick.
    let s = t.targetSlot[i]
    const valid = e.isAlive(s, t.targetGen[i]) && inRange(g, i, s, def.range)
    if (!valid || --t.retarget[i] <= 0) {
      s = acquire(g, i, def.range, def.hitsAir, t.targetMode[i])
      t.targetSlot[i] = s
      t.targetGen[i] = s >= 0 ? e.generation[s] : 0
      t.retarget[i] = RETARGET_STEPS
    }
    if (s < 0) continue

    // Turn toward the target at a limited rate (towers with a turret only).
    let aimed = true
    if (def.turnRate > 0) {
      const want = Math.atan2(e.y[s] - t.y[i], e.x[s] - t.x[i])
      let diff = want - t.angle[i]
      diff -= Math.round(diff / TAU) * TAU
      const maxTurn = def.turnRate * DT
      t.angle[i] += diff > maxTurn ? maxTurn : diff < -maxTurn ? -maxTurn : diff
      aimed = Math.abs(diff) <= AIM_TOLERANCE
    }

    if (t.cooldown[i] <= 0 && aimed) {
      t.cooldown[i] += 1 / (def.fireRate * g.fireRateMul)
      if (t.cooldown[i] < 0) t.cooldown[i] = 0
      t.recoil[i] = 1
      fire(g, i, s, def)
      g.events.push(Ev.Shot, t.type[i], i)
    }
  }
}

/** One attack from tower `i` at enemy `s`, by tower type (DOMAIN.md §2.3). */
function fire(g: Game, i: number, s: number, def: TowerDef): void {
  const t = g.towers
  switch (t.type[i]) {
    case TowerType.Frost:
      frostPulse(g, i, def)
      break
    case TowerType.Arc:
      arcChain(g, i, s, def)
      break
    case TowerType.Sniper: {
      const a = t.angle[i]
      g.beams.add(BeamKind.Sniper, t.x[i] + Math.cos(a) * 15, t.y[i] + Math.sin(a) * 15, g.enemies.x[s], g.enemies.y[s], 0.22)
      g.damage(s, def.damage, def.armor)
      break
    }
    default:
      g.fireProjectile(i, s)
  }
}

/** Frost: damages and slows every enemy in range, air included. */
function frostPulse(g: Game, i: number, def: TowerDef): void {
  const t = g.towers
  const e = g.enemies
  const buf = g.queryBuf
  const n = g.grid.query(e, t.x[i], t.y[i], def.range + MAX_ENEMY_RADIUS, buf)
  for (let k = 0; k < n; k++) {
    const s = buf[k]
    if (!e.alive[s] || !inRange(g, i, s, def.range)) continue
    if (ENEMIES[e.type[s]].air && !def.hitsAir) continue
    g.slow(s, def.slow, def.slowTime)
    g.damage(s, def.damage, def.armor)
  }
  g.rings.add(RingKind.Frost, t.x[i], t.y[i], def.range, 0.45)
}

/** Enemies already struck by the current chain (reused; chains are short). */
const chainHit = new Int32Array(16)

/**
 * Arc: an instant bolt to the target, then jumps to the nearest enemy not yet
 * struck within `chainRange`, losing damage each jump. Ground only.
 */
function arcChain(g: Game, i: number, first: number, def: TowerDef): void {
  const e = g.enemies
  const buf = g.queryBuf
  let fromX = g.towers.x[i]
  let fromY = g.towers.y[i] - 8 // the coil's tip
  let cur = first
  let amount = def.damage
  const hops = Math.min(def.chains + 1, chainHit.length)
  for (let h = 0; h < hops; h++) {
    const x = e.x[cur]
    const y = e.y[cur]
    g.beams.add(BeamKind.Arc, fromX, fromY, x, y, 0.16)
    chainHit[h] = cur
    g.damage(cur, amount, def.armor)
    if (h === hops - 1) break
    // Nearest unstruck ground enemy within jump range.
    const n = g.grid.query(e, x, y, def.chainRange + MAX_ENEMY_RADIUS, buf)
    let next = -1
    let best = Infinity
    for (let k = 0; k < n; k++) {
      const s = buf[k]
      if (!e.alive[s] || ENEMIES[e.type[s]].air) continue
      let seen = false
      for (let m = 0; m <= h; m++) if (chainHit[m] === s) seen = true
      if (seen) continue
      const d = (e.x[s] - x) ** 2 + (e.y[s] - y) ** 2
      if (d < best && d <= def.chainRange * def.chainRange) {
        best = d
        next = s
      }
    }
    if (next < 0) break
    fromX = x
    fromY = y
    cur = next
    amount *= def.chainFalloff
  }
}

function inRange(g: Game, i: number, s: number, range: number): boolean {
  const e = g.enemies
  const r = range + ENEMIES[e.type[s]].radius
  const dx = e.x[s] - g.towers.x[i]
  const dy = e.y[s] - g.towers.y[i]
  return dx * dx + dy * dy <= r * r
}

/**
 * Picks a target with the grid, by the tower's mode. Every mode becomes
 * "lowest score wins", so one loop serves all four.
 */
function acquire(g: Game, i: number, range: number, hitsAir: boolean, mode: number): number {
  const e = g.enemies
  const buf = g.queryBuf
  const tx = g.towers.x[i]
  const ty = g.towers.y[i]
  const n = g.grid.query(e, tx, ty, range + MAX_ENEMY_RADIUS, buf)
  let best = -1
  let bestScore = Infinity
  for (let k = 0; k < n; k++) {
    const s = buf[k]
    if (!e.alive[s]) continue
    const def = ENEMIES[e.type[s]]
    if (def.air && !hitsAir) continue
    if (!inRange(g, i, s, range)) continue
    let score: number
    if (mode === TargetMode.Last) score = e.dist[s] - g.paths[e.pathId[s]].endDist // most path left
    else if (mode === TargetMode.Strongest) score = -e.hp[s]
    else if (mode === TargetMode.Closest) score = (e.x[s] - tx) ** 2 + (e.y[s] - ty) ** 2
    else score = g.paths[e.pathId[s]].endDist - e.dist[s] // First: least path left
    if (score < bestScore) {
      bestScore = score
      best = s
    }
  }
  return best
}
