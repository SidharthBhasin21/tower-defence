import { DT, MAX_BEAMS, MAX_RINGS } from '../config.ts'

/**
 * Visual-only effect pools (ARCHITECTURE.md §4.1): beams and rings.
 *
 * The sim writes them when towers fire, because only it knows where a chain
 * jumped or where a shell burst. Nothing in gameplay reads them back. They
 * age in sim time (phase 8 of the step), so they freeze while paused and
 * speed up with the game. When a pool is full, new effects are dropped.
 */

export const BeamKind = {
  Arc: 0,
  Sniper: 1,
} as const

export const RingKind = {
  Frost: 0,
  Explosion: 1,
  /** A Mender's heal. */
  Heal: 2,
} as const

export class BeamPool {
  readonly kind = new Uint8Array(MAX_BEAMS)
  readonly x1 = new Float32Array(MAX_BEAMS)
  readonly y1 = new Float32Array(MAX_BEAMS)
  readonly x2 = new Float32Array(MAX_BEAMS)
  readonly y2 = new Float32Array(MAX_BEAMS)
  /** Seconds left, and the total, for fading. */
  readonly life = new Float32Array(MAX_BEAMS)
  readonly maxLife = new Float32Array(MAX_BEAMS)
  /** Varies each beam's lightning shape. */
  readonly seed = new Uint16Array(MAX_BEAMS)
  count = 0
  private nextSeed = 1

  add(kind: number, x1: number, y1: number, x2: number, y2: number, life: number): void {
    if (this.count === MAX_BEAMS) return
    const i = this.count++
    this.kind[i] = kind
    this.x1[i] = x1
    this.y1[i] = y1
    this.x2[i] = x2
    this.y2[i] = y2
    this.life[i] = this.maxLife[i] = life
    this.seed[i] = this.nextSeed = (this.nextSeed * 75 + 74) % 65537
  }

  step(): void {
    let i = 0
    while (i < this.count) {
      this.life[i] -= DT
      if (this.life[i] > 0) {
        i++
        continue
      }
      const j = --this.count
      this.kind[i] = this.kind[j]
      this.x1[i] = this.x1[j]
      this.y1[i] = this.y1[j]
      this.x2[i] = this.x2[j]
      this.y2[i] = this.y2[j]
      this.life[i] = this.life[j]
      this.maxLife[i] = this.maxLife[j]
      this.seed[i] = this.seed[j]
    }
  }

  reset(): void {
    this.count = 0
  }
}

export class RingPool {
  readonly kind = new Uint8Array(MAX_RINGS)
  readonly x = new Float32Array(MAX_RINGS)
  readonly y = new Float32Array(MAX_RINGS)
  /** Final radius; rings grow from a fraction of it. */
  readonly radius = new Float32Array(MAX_RINGS)
  readonly life = new Float32Array(MAX_RINGS)
  readonly maxLife = new Float32Array(MAX_RINGS)
  count = 0

  add(kind: number, x: number, y: number, radius: number, life: number): void {
    if (this.count === MAX_RINGS) return
    const i = this.count++
    this.kind[i] = kind
    this.x[i] = x
    this.y[i] = y
    this.radius[i] = radius
    this.life[i] = this.maxLife[i] = life
  }

  step(): void {
    let i = 0
    while (i < this.count) {
      this.life[i] -= DT
      if (this.life[i] > 0) {
        i++
        continue
      }
      const j = --this.count
      this.kind[i] = this.kind[j]
      this.x[i] = this.x[j]
      this.y[i] = this.y[j]
      this.radius[i] = this.radius[j]
      this.life[i] = this.life[j]
      this.maxLife[i] = this.maxLife[j]
    }
  }

  reset(): void {
    this.count = 0
  }
}
