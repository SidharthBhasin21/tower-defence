import { DT, ENEMIES, EnemyType, MAX_SPAWN_GROUPS, WAVE_COUNT } from '../config.ts'
import type { Game } from './game.ts'

/**
 * Waves (ARCHITECTURE.md §4.5, DOMAIN.md §2.5).
 *
 * All 50 waves are generated once at startup from difficulty curves and a
 * roster that says when each enemy type first appears. At runtime one
 * scheduler with a fixed-capacity group list spawns everything, so waves
 * called early simply overlap.
 */

/** Path bits for `pathMask`: ground path A, ground path B, air route. */
export const PATH_A = 1
export const PATH_B = 2
export const PATH_AIR = 4

export interface SpawnGroup {
  readonly type: number
  readonly count: number
  /** Steps between spawns. */
  readonly interval: number
  /** Steps from the wave start to the first spawn. */
  readonly delay: number
  /** Paths to use (PATH_* bits); spawns rotate through the set bits. */
  readonly pathMask: number
}

export interface WaveDef {
  /** 1-based wave number. */
  readonly number: number
  /** Health multiplier for every enemy in the wave. */
  readonly hpMul: number
  readonly groups: readonly SpawnGroup[]
  /** Enemies in the wave. */
  readonly total: number
  /**
   * Difficulty: Σ count × threat unit × health multiplier, bosses included.
   * The generator guarantees it never decreases from one wave to the next.
   */
  readonly threat: number
  /** Sum of count × scaled base health. */
  readonly totalHp: number
  /** True on Warlord waves (10, 20 … 50). */
  readonly boss: boolean
}

interface RosterEntry {
  readonly type: number
  /** First wave the type can appear in. */
  readonly from: number
  /** Share of the wave's budget, relative to the other types present. */
  readonly weight: number
  /** Threat of one enemy, in Grunt-equivalents (budget cost). */
  readonly unit: number
  /** Seconds between spawns at wave 1; shrinks with the wave number. */
  readonly interval: number
}

/** When each enemy type first appears (DOMAIN.md §2.5) and its share of a wave (tuned). */
const ROSTER: readonly RosterEntry[] = [
  { type: EnemyType.Grunt, from: 1, weight: 3, unit: 1, interval: 0.7 },
  { type: EnemyType.Runner, from: 3, weight: 2, unit: 0.8, interval: 0.45 },
  { type: EnemyType.Swarmling, from: 5, weight: 1.5, unit: 0.3, interval: 0.16 },
  { type: EnemyType.Brute, from: 7, weight: 1.5, unit: 4, interval: 1.6 },
  { type: EnemyType.Wisp, from: 9, weight: 1.2, unit: 1.1, interval: 0.8 },
  { type: EnemyType.Mender, from: 12, weight: 0.8, unit: 2.5, interval: 1.8 },
]

/** Warlords: one on waves 10 and 20, two on 30 and 40, three on 50. Threat is on top of the budget. */
const BOSS_EVERY = 10
const BOSS_UNIT = 12
const BOSS_INTERVAL = 3
export function bossCount(w: number): number {
  return w % BOSS_EVERY === 0 ? 1 + Math.floor((w - BOSS_EVERY) / (2 * BOSS_EVERY)) : 0
}

/** Health multiplier for wave `w` (1-based): ×1 at wave 1, about ×23 at wave 50 (tuned in feature 11 with the bot, see README). */
export function waveHpMul(w: number): number {
  const n = w - 1
  return 1 + 0.09 * n + 0.0075 * n * n
}

/** Wave size in Grunt-equivalents: 10 at wave 1, about 100 at wave 50 (tuned). */
export function waveBudget(w: number): number {
  const n = w - 1
  return 10 + 1.5 * n + 0.007 * n * n
}

/** Spawn intervals shrink to 35% of their wave-1 value by the end. */
function intervalScale(w: number): number {
  return Math.max(0.35, 1 - 0.0135 * (w - 1))
}

const GROUP_STAGGER = 2 // seconds between groups of different types

/**
 * Builds the 50 waves. Each wave's budget is split across the roster types
 * present, by weight. Bosses come on top, and so that the wave after a boss
 * is never easier, the regular part of a wave is at least the previous
 * wave's whole threat; any shortfall from rounding is topped up with Grunts.
 */
export function generateWaves(): WaveDef[] {
  const waves: WaveDef[] = []
  let prevThreat = 0
  for (let w = 1; w <= WAVE_COUNT; w++) {
    const present = ROSTER.filter((r) => r.from <= w)
    const weights = present.reduce((sum, r) => sum + r.weight, 0)
    const hpMul = waveHpMul(w)
    const bosses = bossCount(w)
    // Regular budget, in Grunt-equivalents at this wave's health.
    const budget = Math.max(waveBudget(w), prevThreat / hpMul)
    const counts = present.map((r) => Math.max(1, Math.round((budget * r.weight) / weights / r.unit)))
    let units = present.reduce((sum, r, k) => sum + counts[k] * r.unit, 0)
    if (units < budget) {
      counts[0] += Math.ceil(budget - units) // Grunts, unit 1
      units = present.reduce((sum, r, k) => sum + counts[k] * r.unit, 0)
    }
    const groups: SpawnGroup[] = []
    let total = 0
    let totalHp = 0
    present.forEach((r, k) => {
      groups.push({
        type: r.type,
        count: counts[k],
        interval: Math.max(1, Math.round((r.interval * intervalScale(w)) / DT)),
        delay: Math.round((k * GROUP_STAGGER) / DT),
        pathMask: ENEMIES[r.type].air ? PATH_AIR : PATH_A | PATH_B,
      })
      total += counts[k]
      totalHp += counts[k] * ENEMIES[r.type].hp * hpMul
    })
    if (bosses > 0) {
      // The boss walks in behind the opening groups.
      groups.push({
        type: EnemyType.Warlord,
        count: bosses,
        interval: Math.round(BOSS_INTERVAL / DT),
        delay: Math.round(4 / DT),
        pathMask: PATH_A | PATH_B,
      })
      total += bosses
      totalHp += bosses * ENEMIES[EnemyType.Warlord].hp * hpMul
    }
    const threat = (units + bosses * BOSS_UNIT) * hpMul
    waves.push({ number: w, hpMul, groups, total, threat, totalHp, boss: bosses > 0 })
    prevThreat = threat
  }
  return waves
}

/** The campaign's waves, indexed from 0 (wave 1 is WAVES[0]). */
export const WAVES: readonly WaveDef[] = generateWaves()

/**
 * Runtime spawner: a fixed-capacity list of active spawn groups stored as
 * typed arrays. Groups are swap-removed when they finish.
 */
export class WaveScheduler {
  private readonly wave = new Int16Array(MAX_SPAWN_GROUPS)
  private readonly type = new Int16Array(MAX_SPAWN_GROUPS)
  private readonly left = new Int32Array(MAX_SPAWN_GROUPS)
  private readonly interval = new Int32Array(MAX_SPAWN_GROUPS)
  private readonly timer = new Int32Array(MAX_SPAWN_GROUPS)
  private readonly mask = new Uint8Array(MAX_SPAWN_GROUPS)
  /** Next path bit to try for this group. */
  private readonly cursor = new Uint8Array(MAX_SPAWN_GROUPS)
  count = 0
  /** Groups refused because the list was full (should stay 0). */
  dropped = 0

  /** Queues every group of wave index `wi` (0-based). Returns enemies queued. */
  start(wi: number): number {
    let queued = 0
    for (const gr of WAVES[wi].groups) {
      if (this.count === MAX_SPAWN_GROUPS) {
        this.dropped++
        continue
      }
      const k = this.count++
      this.wave[k] = wi
      this.type[k] = gr.type
      this.left[k] = gr.count
      this.interval[k] = gr.interval
      this.timer[k] = gr.delay
      this.mask[k] = gr.pathMask
      this.cursor[k] = 0
      queued += gr.count
    }
    return queued
  }

  /** Spawns whatever is due this step. */
  step(g: Game): void {
    let k = 0
    while (k < this.count) {
      if (this.timer[k] > 0) this.timer[k]--
      if (this.timer[k] === 0) {
        g.spawnFromWave(this.type[k], this.nextPath(k), this.wave[k])
        this.timer[k] = this.interval[k]
        if (--this.left[k] === 0) {
          this.remove(k)
          continue // the swapped-in group is processed at this index
        }
      }
      k++
    }
  }

  reset(): void {
    this.count = 0
    this.dropped = 0
  }

  /** Rotates through the set bits of the group's path mask. */
  private nextPath(k: number): number {
    const m = this.mask[k]
    let c = this.cursor[k]
    for (let i = 0; i < 3; i++) {
      const p = (c + i) % 3
      if (m & (1 << p)) {
        this.cursor[k] = (p + 1) % 3
        return p
      }
    }
    return 0
  }

  private remove(k: number): void {
    const last = --this.count
    if (k === last) return
    this.wave[k] = this.wave[last]
    this.type[k] = this.type[last]
    this.left[k] = this.left[last]
    this.interval[k] = this.interval[last]
    this.timer[k] = this.timer[last]
    this.mask[k] = this.mask[last]
    this.cursor[k] = this.cursor[last]
  }
}
