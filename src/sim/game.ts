import {
  ARMOR_MIN_FRACTION,
  DT,
  ENEMIES,
  HIT_FLASH,
  LANE_MAX,
  MAX_ENEMIES,
  MAX_PROJECTILES,
  MAX_TOWERS,
  PATH_SAMPLE_STEP,
  PROJECTILE_LIFE,
  SCORE_PER_BOUNTY,
  START_GOLD,
  START_LIVES,
  TOWERS,
} from '../config.ts'
import { Rng } from '../rng.ts'
import { Cmd, CommandQueue } from './commands.ts'
import { EnemyPool } from './enemies.ts'
import { Ev, EventQueue } from './events.ts'
import { SpatialGrid } from './grid.ts'
import { GameMap } from './map.ts'
import { SampledPath } from './path.ts'
import { ProjectilePool, stepProjectiles } from './projectiles.ts'
import { TowerStore, stepTowers } from './towers.ts'

/** Why a build was or wasn't allowed. */
export const PlaceResult = {
  Ok: 0,
  OutOfBounds: 1,
  /** Path, scenery or base. */
  Blocked: 2,
  Occupied: 3,
  NoGold: 4,
  TooManyTowers: 5,
} as const
export type PlaceResultId = (typeof PlaceResult)[keyof typeof PlaceResult]

/**
 * Root of the simulation. Owns all game state and advances it one fixed step
 * at a time. Must never touch the DOM, canvas or audio (ARCHITECTURE.md §2),
 * so it runs unchanged in Node tests.
 */
export class Game {
  readonly map = new GameMap()
  /** Sampled lookup tables, indexed like map.paths. */
  readonly paths: readonly SampledPath[]
  readonly enemies = new EnemyPool(MAX_ENEMIES)
  readonly grid = new SpatialGrid(MAX_ENEMIES)
  readonly towers = new TowerStore(MAX_TOWERS)
  readonly projectiles = new ProjectilePool(MAX_PROJECTILES)
  readonly events = new EventQueue()
  readonly commands = new CommandQueue(256)
  /** Shared scratch buffer for grid queries (one query at a time). */
  readonly queryBuf = new Int32Array(MAX_ENEMIES)
  readonly rng: Rng
  private readonly seed: number

  /** Number of fixed steps taken since the game started. */
  tick = 0
  lives = START_LIVES
  gold = START_GOLD
  score = 0
  kills = 0
  /** Multiplies every tower's fire rate. 1 in play; raised by the stress scenario. */
  fireRateMul = 1

  constructor(seed = 1) {
    this.seed = seed
    this.rng = new Rng(seed)
    this.paths = this.map.paths.map((p) => new SampledPath(p))
  }

  /** Simulation time, in seconds. */
  get time(): number {
    return this.tick * DT
  }

  // ---------------------------------------------------------------- step

  /** Advances the game by one fixed step (ARCHITECTURE.md §4.4). */
  step(): void {
    this.tick++
    this.applyCommands()
    this.stepEnemies()
    this.grid.rebuild(this.enemies)
    stepTowers(this)
    stepProjectiles(this)
    this.enemies.flush()
  }

  reset(): void {
    this.tick = 0
    this.lives = START_LIVES
    this.gold = START_GOLD
    this.score = 0
    this.kills = 0
    this.fireRateMul = 1
    this.rng.reseed(this.seed)
    this.enemies.reset()
    this.towers.reset()
    this.projectiles.reset()
    this.grid.rebuild(this.enemies)
    this.events.clear()
    this.commands.clear()
  }

  // ------------------------------------------------------------ commands

  /** Applies queued player commands. Runs at the start of every step. */
  applyCommands(): void {
    this.commands.drain(this.onCommand)
  }

  /** Bound once so draining allocates nothing. */
  private readonly onCommand = (type: number, a: number, b: number, c: number): void => {
    if (type === Cmd.Place) this.placeTower(a, b, c)
  }

  // -------------------------------------------------------------- towers

  /** Checks whether a tower of `type` could be built on a tile right now. */
  canPlace(type: number, tx: number, ty: number): PlaceResultId {
    if (!this.map.inBounds(tx, ty)) return PlaceResult.OutOfBounds
    if (!this.map.isBuildable(tx, ty)) return PlaceResult.Blocked
    if (this.towers.at(tx, ty) >= 0) return PlaceResult.Occupied
    if (this.towers.count >= this.towers.capacity) return PlaceResult.TooManyTowers
    if (this.gold < TOWERS[type].cost) return PlaceResult.NoGold
    return PlaceResult.Ok
  }

  /** Builds a tower if the rules allow it. Returns the tower index, or -1. */
  placeTower(type: number, tx: number, ty: number): number {
    const why = this.canPlace(type, tx, ty)
    if (why !== PlaceResult.Ok) {
      this.events.push(Ev.PlaceFailed, why, tx, ty)
      return -1
    }
    const cost = TOWERS[type].cost
    this.gold -= cost
    const i = this.towers.add(type, tx, ty, cost)
    this.events.push(Ev.TowerPlaced, type, tx, ty)
    return i
  }

  /** Launches a projectile from tower `i` at enemy slot `s`. */
  fireProjectile(i: number, s: number): void {
    const t = this.towers
    const def = TOWERS[t.type[i]]
    const p = this.projectiles
    const k = p.alloc()
    if (k < 0) return
    const a = t.angle[i]
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    // Leave from the muzzle, not the tower centre.
    p.type[k] = t.type[i]
    p.x[k] = p.px[k] = t.x[i] + ca * 12
    p.y[k] = p.py[k] = t.y[i] + sa * 12
    p.dx[k] = ca
    p.dy[k] = sa
    p.speed[k] = def.projectileSpeed
    p.damage[k] = def.damage
    p.targetSlot[k] = s
    p.targetGen[k] = this.enemies.generation[s]
    p.life[k] = PROJECTILE_LIFE
    p.hitsAir[k] = def.hitsAir ? 1 : 0
  }

  // ------------------------------------------------------------- enemies

  /**
   * Puts a new enemy on a path, at its portal unless `dist` is given.
   * Returns its slot, or -1 if the pool is full.
   */
  spawnEnemy(type: number, pathId: number, dist = -1): number {
    const def = ENEMIES[type]
    const path = this.paths[pathId]
    const e = this.enemies
    const s = e.alloc()
    if (s < 0) return -1
    e.type[s] = type
    e.pathId[s] = pathId
    e.dist[s] = dist >= 0 ? dist : path.spawnDist
    e.lane[s] = path.air ? 0 : this.rng.range(-LANE_MAX, LANE_MAX)
    e.speed[s] = def.speed
    e.hp[s] = def.hp
    e.maxHp[s] = def.hp
    e.armor[s] = def.armor
    e.slowMul[s] = 1
    e.slowT[s] = 0
    e.flashT[s] = 0
    e.waveId[s] = -1
    this.placeEnemy(s)
    e.px[s] = e.x[s]
    e.py[s] = e.y[s]
    return s
  }

  /**
   * The single entry point for damage (ARCHITECTURE.md §4.4). Applies armor
   * with a floor, the hit flash, and the kill.
   */
  damage(s: number, amount: number): void {
    const e = this.enemies
    if (!e.alive[s]) return
    const dealt = Math.max(amount - e.armor[s], amount * ARMOR_MIN_FRACTION)
    e.hp[s] -= dealt
    e.flashT[s] = HIT_FLASH
    if (e.hp[s] <= 0) this.killEnemy(s)
  }

  private killEnemy(s: number): void {
    const type = this.enemies.type[s]
    const bounty = ENEMIES[type].bounty
    this.gold += bounty
    this.score += bounty * SCORE_PER_BOUNTY
    this.kills++
    this.events.push(Ev.Kill, type, bounty, s)
    this.enemies.kill(s)
  }

  /** Moves every enemy along its path and handles reaching the base. */
  private stepEnemies(): void {
    const e = this.enemies
    const active = e.active
    for (let k = 0; k < e.count; k++) {
      const s = active[k]
      if (!e.alive[s]) continue
      e.px[s] = e.x[s]
      e.py[s] = e.y[s]
      if (e.slowT[s] > 0) {
        e.slowT[s] -= DT
        if (e.slowT[s] <= 0) e.slowMul[s] = 1
      }
      if (e.flashT[s] > 0) e.flashT[s] -= DT
      const d = e.dist[s] + e.speed[s] * e.slowMul[s] * DT
      e.dist[s] = d
      if (d >= this.paths[e.pathId[s]].endDist) {
        this.leak(s)
        continue
      }
      this.placeEnemy(s)
    }
  }

  /** Sets x, y and heading from the path lookup table. */
  private placeEnemy(s: number): void {
    const e = this.enemies
    const p = this.paths[e.pathId[s]]
    const d = e.dist[s]
    const i = p.index(d)
    let f = (d - i * PATH_SAMPLE_STEP) / PATH_SAMPLE_STEP
    if (f > 1) f = 1
    const lane = e.lane[s]
    const nx = p.nx[i] + (p.nx[i + 1] - p.nx[i]) * f
    const ny = p.ny[i] + (p.ny[i + 1] - p.ny[i]) * f
    e.x[s] = p.x[i] + (p.x[i + 1] - p.x[i]) * f + nx * lane
    e.y[s] = p.y[i] + (p.y[i + 1] - p.y[i]) * f + ny * lane
    e.heading[s] = p.heading[i]
  }

  private leak(s: number): void {
    const type = this.enemies.type[s]
    const loss = Math.min(ENEMIES[type].leak, this.lives)
    this.lives -= loss
    this.events.push(Ev.Leak, type, loss)
    this.enemies.kill(s)
  }
}
