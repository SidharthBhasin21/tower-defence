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
  /** Sum of count × scaled health: the measure that never decreases. */
  readonly totalHp: number
}

interface RosterEntry {
  readonly type: number
  /** First wave the type can appear in. */
  readonly from: number
  /** Share of the wave's budget, relative to the other types present. */
  readonly weight: number
  /** Budget cost of one enemy, in Grunt-equivalents. */
  readonly unit: number
  /** Seconds between spawns at wave 1; shrinks with the wave number. */
  readonly interval: number
}

/**
 * Enemy types the generator may use. Feature 7 adds Runner (wave 3),
 * Swarmling (5), Brute (7), Wisp (9), Warlord (10, 20…50) and Mender (12).
 */
const ROSTER: readonly RosterEntry[] = [{ type: EnemyType.Grunt, from: 1, weight: 1, unit: 1, interval: 0.7 }]

/** Health multiplier for wave `w` (1-based): ×1 at wave 1, about ×14 at wave 50 (tuned). */
export function waveHpMul(w: number): number {
  const n = w - 1
  return 1 + 0.09 * n + 0.0035 * n * n
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

export function generateWaves(): WaveDef[] {
  const waves: WaveDef[] = []
  for (let w = 1; w <= WAVE_COUNT; w++) {
    const present = ROSTER.filter((r) => r.from <= w)
    const weights = present.reduce((sum, r) => sum + r.weight, 0)
    const budget = waveBudget(w)
    const hpMul = waveHpMul(w)
    const groups: SpawnGroup[] = []
    let total = 0
    let totalHp = 0
    present.forEach((r, k) => {
      const count = Math.max(1, Math.round((budget * r.weight) / weights / r.unit))
      const air = ENEMIES[r.type].air
      groups.push({
        type: r.type,
        count,
        interval: Math.max(1, Math.round((r.interval * intervalScale(w)) / DT)),
        delay: Math.round((k * GROUP_STAGGER) / DT),
        pathMask: air ? PATH_AIR : PATH_A | PATH_B,
      })
      total += count
      totalHp += count * ENEMIES[r.type].hp * hpMul
    })
    waves.push({ number: w, hpMul, groups, total, totalHp })
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
