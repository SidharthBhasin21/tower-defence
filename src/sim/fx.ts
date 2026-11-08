import { DT, MAX_BEAMS, MAX_PARTICLES, MAX_RINGS, MAX_TEXTS } from '../config.ts'

/**
 * Visual-only effect pools (ARCHITECTURE.md §4.1): beams, rings, particles
 * and floating text.
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

/**
 * Particle colours. 0–6 match the enemy types (each dies in its own colour);
 * the rest are for effects. The renderer owns the actual colour values.
 */
export const ParticleColor = {
  Fire: 7,
  Spark: 8,
  Gold: 9,
} as const
export const PARTICLE_COLORS = 10

/**
 * Small square sparks with velocity and drag. Their randomness comes from the
 * pool's own generator, so effects never change the gameplay random stream.
 */
export class ParticlePool {
  readonly x = new Float32Array(MAX_PARTICLES)
  readonly y = new Float32Array(MAX_PARTICLES)
  readonly px = new Float32Array(MAX_PARTICLES)
  readonly py = new Float32Array(MAX_PARTICLES)
  readonly vx = new Float32Array(MAX_PARTICLES)
  readonly vy = new Float32Array(MAX_PARTICLES)
  readonly size = new Float32Array(MAX_PARTICLES)
  readonly life = new Float32Array(MAX_PARTICLES)
  readonly maxLife = new Float32Array(MAX_PARTICLES)
  readonly color = new Uint8Array(MAX_PARTICLES)
  count = 0
  private seed = 1

  /** `n` particles flying out from (x, y) at up to `speed` px/s, living about `life` seconds. */
  burst(x: number, y: number, n: number, color: number, speed: number, life: number, size: number): void {
    for (let k = 0; k < n; k++) {
      if (this.count === MAX_PARTICLES) return
      const i = this.count++
      const a = this.rand() * Math.PI * 2
      const v = speed * (0.35 + 0.65 * this.rand())
      this.x[i] = this.px[i] = x
      this.y[i] = this.py[i] = y
      this.vx[i] = Math.cos(a) * v
      this.vy[i] = Math.sin(a) * v
      this.size[i] = size * (0.7 + 0.6 * this.rand())
      this.life[i] = this.maxLife[i] = life * (0.6 + 0.4 * this.rand())
      this.color[i] = color
    }
  }

  step(): void {
    const drag = 1 - 4 * DT
    let i = 0
    while (i < this.count) {
      this.life[i] -= DT
      if (this.life[i] > 0) {
        this.px[i] = this.x[i]
        this.py[i] = this.y[i]
        this.x[i] += this.vx[i] * DT
        this.y[i] += this.vy[i] * DT
        this.vx[i] *= drag
        this.vy[i] *= drag
        i++
        continue
      }
      const j = --this.count
      this.x[i] = this.x[j]
      this.y[i] = this.y[j]
      this.px[i] = this.px[j]
      this.py[i] = this.py[j]
      this.vx[i] = this.vx[j]
      this.vy[i] = this.vy[j]
      this.size[i] = this.size[j]
      this.life[i] = this.life[j]
      this.maxLife[i] = this.maxLife[j]
      this.color[i] = this.color[j]
    }
  }

  reset(): void {
    this.count = 0
    this.seed = 1
  }

  /** xorshift32, in [0, 1). */
  private rand(): number {
    let s = this.seed
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    this.seed = s >>> 0
    return this.seed / 4294967296
  }
}

/** Floating numbers ("+12" gold) that rise and fade. When full, the oldest is replaced. */
export class TextPool {
  readonly x = new Float32Array(MAX_TEXTS)
  readonly y = new Float32Array(MAX_TEXTS)
  readonly value = new Int32Array(MAX_TEXTS)
  readonly life = new Float32Array(MAX_TEXTS)
  readonly maxLife = new Float32Array(MAX_TEXTS)
  count = 0
  private next = 0

  add(x: number, y: number, value: number, life = 0.9): void {
    let i: number
    if (this.count < MAX_TEXTS) i = this.count++
    else {
      i = this.next
      this.next = (this.next + 1) % MAX_TEXTS
    }
    this.x[i] = x
    this.y[i] = y
    this.value[i] = value
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
      this.x[i] = this.x[j]
      this.y[i] = this.y[j]
      this.value[i] = this.value[j]
      this.life[i] = this.life[j]
      this.maxLife[i] = this.maxLife[j]
    }
    if (this.next >= this.count) this.next = 0
  }

  reset(): void {
    this.count = 0
    this.next = 0
  }
}
