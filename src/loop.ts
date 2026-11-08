import { DT, MAX_FRAME_DT, MAX_STEPS_PER_FRAME } from './config.ts'

/**
 * Fixed-timestep accumulator (ARCHITECTURE.md §3).
 *
 * Real elapsed time × game speed is added to an accumulator, and whole DT steps
 * are taken out of it. Gameplay therefore depends only on the number of steps,
 * never on the display's refresh rate. Pure logic with no browser APIs, so it
 * is unit-tested directly.
 */
export class FixedStepper {
  /** Unconsumed simulation time, in seconds (always in [0, DT) after advance). */
  accumulator = 0
  /** Steps per DT of real time: 1, 2 or 4. */
  speed = 1
  paused = false

  /** Adds a frame's real elapsed time and returns how many steps to run now. */
  advance(realDt: number): number {
    if (this.paused || !(realDt > 0)) return 0
    this.accumulator += Math.min(realDt, MAX_FRAME_DT) * this.speed
    let steps = Math.floor(this.accumulator / DT)
    if (steps > MAX_STEPS_PER_FRAME) {
      // Too far behind: run the cap and drop the backlog so a slow machine
      // slows the game down instead of falling further behind every frame.
      steps = MAX_STEPS_PER_FRAME
      this.accumulator = 0
    } else {
      this.accumulator -= steps * DT
      if (this.accumulator < 0) this.accumulator = 0
    }
    return steps
  }

  /** How far the render is between the last step and the next, in [0, 1). */
  get alpha(): number {
    return this.paused ? 0 : Math.min(this.accumulator / DT, 1)
  }

  reset(): void {
    this.accumulator = 0
  }
}

export interface LoopHooks {
  /** Runs one fixed simulation step. */
  step(): void
  /**
   * Draws a frame. `alpha` interpolates between the last two steps; `realDt`
   * is unscaled wall time since the previous frame (for camera and UI motion).
   */
  render(alpha: number, realDt: number, now: number): void
}

/**
 * The game's single requestAnimationFrame loop. Every system is driven from
 * here; nothing else in the app may schedule its own frame or timer loop.
 */
export class GameLoop {
  readonly stepper = new FixedStepper()
  private last = -1
  private running = false
  private readonly hooks: LoopHooks
  private readonly frame: (now: number) => void

  constructor(hooks: LoopHooks) {
    this.hooks = hooks
    // Bound once so the loop allocates nothing per frame.
    this.frame = (now: number) => this.tick(now)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.last = -1
    requestAnimationFrame(this.frame)
  }

  private tick(now: number): void {
    if (!this.running) return
    const realDt = this.last < 0 ? 0 : (now - this.last) / 1000
    this.last = now
    const steps = this.stepper.advance(realDt)
    for (let i = 0; i < steps; i++) this.hooks.step()
    this.hooks.render(this.stepper.alpha, Math.min(realDt, MAX_FRAME_DT), now)
    requestAnimationFrame(this.frame)
  }
}
