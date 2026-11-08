import { DT, ENEMIES, LANE_MAX, MAX_ENEMIES, PATH_SAMPLE_STEP, START_LIVES } from '../config.ts'
import { Rng } from '../rng.ts'
import { EnemyPool } from './enemies.ts'
import { Ev, EventQueue } from './events.ts'
import { GameMap } from './map.ts'
import { SampledPath } from './path.ts'

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
  readonly events = new EventQueue()
  readonly rng: Rng
  private readonly seed: number

  /** Number of fixed steps taken since the game started. */
  tick = 0
  lives = START_LIVES

  constructor(seed = 1) {
    this.seed = seed
    this.rng = new Rng(seed)
    this.paths = this.map.paths.map((p) => new SampledPath(p))
  }

  /** Simulation time, in seconds. */
  get time(): number {
    return this.tick * DT
  }

  /** Puts a new enemy at the start of a path. Returns its slot, or -1 if the pool is full. */
  spawnEnemy(type: number, pathId: number): number {
    const def = ENEMIES[type]
    const path = this.paths[pathId]
    const e = this.enemies
    const s = e.alloc()
    if (s < 0) return -1
    e.type[s] = type
    e.pathId[s] = pathId
    e.dist[s] = path.spawnDist
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

  step(): void {
    this.tick++
    this.stepEnemies()
    this.enemies.flush()
  }

  reset(): void {
    this.tick = 0
    this.lives = START_LIVES
    this.rng.reseed(this.seed)
    this.enemies.reset()
    this.events.clear()
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
