import { describe, expect, it } from 'vitest'
import { DT, MAX_FRAME_DT, MAX_STEPS_PER_FRAME } from '../src/config.ts'
import { FixedStepper } from '../src/loop.ts'
import { Rng } from '../src/rng.ts'

/** Feeds `seconds` of real time in frames of the given length; returns total steps. */
function run(stepper: FixedStepper, seconds: number, frameDt: () => number): number {
  let t = 0
  let steps = 0
  while (t < seconds - 1e-9) {
    const dt = Math.min(frameDt(), seconds - t)
    t += dt
    steps += stepper.advance(dt)
  }
  return steps
}

describe('FixedStepper', () => {
  it('takes the same number of steps at 30, 60, 120 and 144 Hz', () => {
    const expected = Math.round(10 / DT)
    for (const hz of [30, 60, 120, 144]) {
      const steps = run(new FixedStepper(), 10, () => 1 / hz)
      expect(Math.abs(steps - expected), `${hz} Hz`).toBeLessThanOrEqual(1)
    }
  })

  it('takes the same number of steps with jittery frame times', () => {
    const rng = new Rng(5)
    const steps = run(new FixedStepper(), 10, () => rng.range(0.004, 0.05))
    expect(Math.abs(steps - Math.round(10 / DT))).toBeLessThanOrEqual(1)
  })

  it('scales steps with game speed', () => {
    for (const speed of [1, 2, 4]) {
      const s = new FixedStepper()
      s.speed = speed
      const steps = run(s, 5, () => 1 / 60)
      expect(Math.abs(steps - Math.round((5 * speed) / DT))).toBeLessThanOrEqual(1)
    }
  })

  it('takes no steps while paused and keeps no backlog', () => {
    const s = new FixedStepper()
    s.paused = true
    expect(run(s, 3, () => 1 / 60)).toBe(0)
    s.paused = false
    expect(s.advance(1 / 60)).toBe(1)
  })

  it('clamps long frames instead of catching up', () => {
    const s = new FixedStepper()
    // A 2-second hitch (e.g. a hidden tab) is clamped to MAX_FRAME_DT.
    expect(s.advance(2)).toBe(Math.floor(MAX_FRAME_DT / DT + 1e-9))
  })

  it('caps steps per frame and drops the backlog', () => {
    const s = new FixedStepper()
    s.speed = 4
    expect(s.advance(MAX_FRAME_DT)).toBe(MAX_STEPS_PER_FRAME)
    expect(s.accumulator).toBe(0)
  })

  it('keeps alpha in [0, 1)', () => {
    const s = new FixedStepper()
    const rng = new Rng(9)
    for (let i = 0; i < 1000; i++) {
      s.advance(rng.range(0.001, 0.03))
      expect(s.alpha).toBeGreaterThanOrEqual(0)
      expect(s.alpha).toBeLessThan(1)
    }
  })

  it('ignores zero, negative and NaN frame times', () => {
    const s = new FixedStepper()
    expect(s.advance(0)).toBe(0)
    expect(s.advance(-1)).toBe(0)
    expect(s.advance(Number.NaN)).toBe(0)
    expect(s.accumulator).toBe(0)
  })
})
