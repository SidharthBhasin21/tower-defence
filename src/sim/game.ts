import {
  ARMOR_MIN_FRACTION,
  CLEAR_GOLD_BASE,
  CLEAR_GOLD_PER_WAVE,
  CLEAR_SCORE_PER_WAVE,
  DT,
  EARLY_GOLD_PER_SEC,
  EARLY_SCORE_PER_SEC,
  ENEMIES,
  HIT_FLASH,
  LANE_MAX,
  MAX_ENEMIES,
  MAX_PROJECTILES,
  MAX_TOWERS,
  PATH_SAMPLE_STEP,
  PROJECTILE_LIFE,
  SCORE_PER_BOUNTY,
  SCORE_WAVE_SCALE,
  START_GOLD,
  START_LIVES,
  TOWERS,
  WAVE_COUNT,
  WAVE_GAP,
  WIN_SCORE_PER_LIFE,
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
import { WAVES, WaveScheduler } from './waves.ts'

/** Where the run stands (DOMAIN.md §2.6). Title and Paused are client states, not sim ones. */
export const Phase = {
  Playing: 0,
  Won: 1,
  Lost: 2,
} as const
export type PhaseId = (typeof Phase)[keyof typeof Phase]

const WAVE_GAP_STEPS = Math.round(WAVE_GAP / DT)

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
  readonly scheduler = new WaveScheduler()
  readonly rng: Rng
  private readonly seed: number
  /** Per wave index: enemies not yet spawned, and enemies not yet gone (unspawned + alive). */
  private readonly waveToSpawn = new Int32Array(WAVE_COUNT)
  private readonly waveLeft = new Int32Array(WAVE_COUNT)

  /** Number of fixed steps taken since the game started. */
  tick = 0
  lives = START_LIVES
  gold = START_GOLD
  score = 0
  kills = 0
  /** Multiplies every tower's fire rate. 1 in play; raised by the stress scenario. */
  fireRateMul = 1
  phase: PhaseId = Phase.Playing
  /** Waves started so far (0 before the first; WAVE_COUNT once the last has started). */
  wave = 0
  /** Waves fully cleared. */
  cleared = 0
  /**
   * Steps until the next wave starts on its own, or -1 when no countdown is
   * running (before wave 1, while a wave is still spawning, or after the last).
   */
  countdown = -1

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
    if (this.phase !== Phase.Playing) return
    this.tick++
    this.applyCommands()
    this.scheduler.step(this)
    this.stepEnemies()
    this.grid.rebuild(this.enemies)
    stepTowers(this)
    stepProjectiles(this)
    this.enemies.flush()
    this.stepWaves()
  }

  reset(): void {
    this.tick = 0
    this.lives = START_LIVES
    this.gold = START_GOLD
    this.score = 0
    this.kills = 0
    this.fireRateMul = 1
    this.phase = Phase.Playing
    this.wave = 0
    this.cleared = 0
    this.countdown = -1
    this.waveToSpawn.fill(0)
    this.waveLeft.fill(0)
    this.scheduler.reset()
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
    else if (type === Cmd.NextWave) this.callNextWave()
  }

  // --------------------------------------------------------------- waves

  /** True when the player may start the next wave now. */
  canCallWave(): boolean {
    return this.phase === Phase.Playing && this.wave < WAVE_COUNT && (this.wave === 0 || this.countdown >= 0)
  }

  /** Gold the player would get for calling the next wave right now. */
  earlyBonus(): number {
    return this.wave > 0 && this.countdown > 0 ? Math.ceil(this.countdown * DT) * EARLY_GOLD_PER_SEC : 0
  }

  /**
   * Starts the next wave if allowed. Calling during the countdown pays gold
   * and score for the seconds skipped. Returns whether a wave started.
   */
  callNextWave(): boolean {
    if (!this.canCallWave()) return false
    const gold = this.earlyBonus()
    if (gold > 0) {
      this.gold += gold
      this.score += Math.ceil(this.countdown * DT) * EARLY_SCORE_PER_SEC
    }
    this.startWave(gold)
    return true
  }

  private startWave(earlyGold: number): void {
    const wi = this.wave++
    const queued = this.scheduler.start(wi)
    this.waveToSpawn[wi] = queued
    this.waveLeft[wi] = queued
    this.countdown = -1
    this.events.push(Ev.WaveStart, wi + 1, earlyGold)
  }

  /** Enemies of the newest wave still to spawn (for the HUD). */
  get spawning(): number {
    return this.wave > 0 ? this.waveToSpawn[this.wave - 1] : 0
  }

  /** Spawns one enemy for wave index `wi`, scaled for that wave. Called by the scheduler. */
  spawnFromWave(type: number, pathId: number, wi: number): void {
    this.waveToSpawn[wi]--
    const s = this.spawnEnemy(type, pathId)
    if (s < 0) {
      this.waveLeft[wi]-- // pool full: the enemy never existed
      return
    }
    const e = this.enemies
    e.hp[s] = e.maxHp[s] = ENEMIES[type].hp * WAVES[wi].hpMul
    e.waveId[s] = wi
  }

  /** An enemy left play by dying or leaking. */
  private enemyGone(s: number): void {
    const wi = this.enemies.waveId[s]
    if (wi >= 0) this.waveLeft[wi]--
  }

  /** Countdown, wave-clear bonuses, and the win and loss checks (step phase 9). */
  private stepWaves(): void {
    if (this.lives <= 0) {
      this.phase = Phase.Lost
      this.events.push(Ev.Defeat, this.score, this.cleared)
      return
    }
    // Waves clear in any order once every enemy in them is gone.
    for (let wi = this.cleared; wi < this.wave; wi++) {
      if (this.waveLeft[wi] !== 0) continue
      this.waveLeft[wi] = -1 // mark as paid
      const n = wi + 1
      const gold = CLEAR_GOLD_BASE + CLEAR_GOLD_PER_WAVE * n
      this.gold += gold
      this.score += CLEAR_SCORE_PER_WAVE * n
      this.events.push(Ev.WaveCleared, n, gold)
    }
    while (this.cleared < this.wave && this.waveLeft[this.cleared] === -1) this.cleared++
    if (this.cleared === WAVE_COUNT) {
      this.score += this.lives * WIN_SCORE_PER_LIFE
      this.phase = Phase.Won
      this.events.push(Ev.Victory, this.score)
      return
    }
    // Countdown to the next wave starts once the newest wave has fully spawned.
    if (this.wave === 0 || this.wave === WAVE_COUNT) return
    if (this.countdown < 0) {
      if (this.waveToSpawn[this.wave - 1] === 0) this.countdown = WAVE_GAP_STEPS
    } else if (--this.countdown <= 0) {
      this.startWave(0)
    }
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
    const wi = this.enemies.waveId[s]
    this.gold += bounty
    this.score += Math.round(bounty * SCORE_PER_BOUNTY * (1 + SCORE_WAVE_SCALE * Math.max(wi, 0)))
    this.kills++
    this.events.push(Ev.Kill, type, bounty, s)
    this.enemyGone(s)
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
    this.enemyGone(s)
    this.enemies.kill(s)
  }
}
