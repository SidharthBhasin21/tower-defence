import { IntRing } from './ring.ts'

/**
 * Player → sim commands (ARCHITECTURE.md §3). Input queues them; the game
 * applies them at the start of the next step, so gameplay changes only ever
 * happen on step boundaries and runs stay reproducible.
 */
export const Cmd = {
  /** Build a tower. a = tower type, b = tile x, c = tile y. */
  Place: 1,
  /** Start the next wave now (early calls pay a bonus). No arguments. */
  NextWave: 2,
} as const
export type CommandType = (typeof Cmd)[keyof typeof Cmd]

export class CommandQueue extends IntRing {
  push(type: CommandType, a = 0, b = 0, c = 0): void {
    this.pushRecord(type, a, b, c)
  }
}
