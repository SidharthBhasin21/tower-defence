/** Frame-time thresholds from the brief. */
export const FPS_TARGET = 45
export const TARGET_INTERVAL_MS = 1000 / FPS_TARGET
export const SLOW_FRAME_MS = 33

export interface FrameStats {
  frames: number
  /** Frame interval (time between requestAnimationFrame callbacks), in ms. */
  p50: number
  p95: number
  p99: number
  max: number
  /** Frames per second implied by the 95th-percentile interval. */
  fpsAtP95: number
  avgFps: number
  /** Share of frames slower than 33 ms, in percent. */
  slowPct: number
  /** Share of frames at or above 45 FPS, in percent. */
  at45Pct: number
  /** CPU time per frame, in ms. */
  simAvg: number
  simP95: number
  simMax: number
  renderAvg: number
  renderP95: number
  renderMax: number
  stepsAvg: number
  /** Input event → start of the next frame, in ms (0 if there was no input). */
  inputAvg: number
  inputMax: number
  inputEvents: number
}

/**
 * Records per-frame timings into ring buffers allocated once
 * (ARCHITECTURE.md §7.3). Recording allocates nothing; statistics copy into
 * preallocated scratch arrays and sort them, so they're computed only on demand.
 */
export class FrameRecorder {
  private readonly capacity: number
  private readonly interval: Float32Array
  private readonly sim: Float32Array
  private readonly render: Float32Array
  private readonly steps: Uint8Array
  private readonly input: Float32Array
  private readonly scratch: Float32Array
  /** Total frames recorded (the ring holds the most recent `capacity`). */
  private n = 0
  private inputN = 0
  /** Earliest input event not yet followed by a frame (ms), or -1. */
  private pendingInput = -1

  constructor(capacity = 1 << 15) {
    this.capacity = capacity
    this.interval = new Float32Array(capacity)
    this.sim = new Float32Array(capacity)
    this.render = new Float32Array(capacity)
    this.steps = new Uint8Array(capacity)
    this.input = new Float32Array(capacity)
    this.scratch = new Float32Array(capacity)
  }

  /** Starts timing input latency: call from capture-phase input listeners. */
  watchInput(target: Window): void {
    const note = (e: Event): void => {
      if (this.pendingInput < 0 || e.timeStamp < this.pendingInput) this.pendingInput = e.timeStamp
    }
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown']) {
      target.addEventListener(type, note, { capture: true, passive: true })
    }
  }

  record(intervalMs: number, simMs: number, renderMs: number, steps: number, now: number): void {
    const i = this.n % this.capacity
    this.interval[i] = intervalMs
    this.sim[i] = simMs
    this.render[i] = renderMs
    this.steps[i] = steps
    this.n++
    if (this.pendingInput >= 0) {
      // The frame that just ran is the first to reflect the input.
      this.input[this.inputN % this.capacity] = Math.max(0, now - this.pendingInput)
      this.inputN++
      this.pendingInput = -1
    }
  }

  reset(): void {
    this.n = 0
    this.inputN = 0
    this.pendingInput = -1
  }

  get frames(): number {
    return this.n
  }

  /** Statistics over the most recent `last` frames (default: everything kept). */
  stats(last = this.capacity): FrameStats {
    const count = Math.min(this.n, this.capacity, last)
    const inputCount = Math.min(this.inputN, this.capacity)
    const iv = this.window(this.interval, count, this.n)
    const p50 = pct(iv, 0.5)
    const p95 = pct(iv, 0.95)
    const p99 = pct(iv, 0.99)
    const max = count ? iv[count - 1] : 0
    let sum = 0
    let slow = 0
    let ok = 0
    for (let i = 0; i < count; i++) {
      sum += iv[i]
      if (iv[i] > SLOW_FRAME_MS) slow++
      if (iv[i] <= TARGET_INTERVAL_MS) ok++
    }
    const sim = summarize(this.window(this.sim, count, this.n))
    const render = summarize(this.window(this.render, count, this.n))
    let steps = 0
    for (let k = 0; k < count; k++) steps += this.steps[(this.n - 1 - k + this.capacity) % this.capacity]
    const inp = summarize(this.window(this.input, inputCount, this.inputN))
    return {
      frames: count,
      p50,
      p95,
      p99,
      max,
      fpsAtP95: p95 > 0 ? 1000 / p95 : 0,
      avgFps: sum > 0 ? (count * 1000) / sum : 0,
      slowPct: count ? (slow / count) * 100 : 0,
      at45Pct: count ? (ok / count) * 100 : 0,
      simAvg: sim.avg,
      simP95: sim.p95,
      simMax: sim.max,
      renderAvg: render.avg,
      renderP95: render.p95,
      renderMax: render.max,
      stepsAvg: count ? steps / count : 0,
      inputAvg: inp.avg,
      inputMax: inp.max,
      inputEvents: inputCount,
    }
  }

  /** Copies the latest `count` values of a ring into scratch, sorted ascending. */
  private window(src: Float32Array, count: number, total: number): Float32Array {
    const out = this.scratch.subarray(0, count)
    for (let k = 0; k < count; k++) out[k] = src[(total - 1 - k + this.capacity) % this.capacity]
    out.sort()
    return out
  }
}

/** Nearest-rank percentile of a sorted array. */
function pct(sorted: Float32Array, q: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]
}

function summarize(sorted: Float32Array): { avg: number; p95: number; max: number } {
  let sum = 0
  for (let i = 0; i < sorted.length; i++) sum += sorted[i]
  return {
    avg: sorted.length ? sum / sorted.length : 0,
    p95: pct(sorted, 0.95),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
  }
}
