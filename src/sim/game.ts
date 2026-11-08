import { DT } from '../config.ts'
import { GameMap } from './map.ts'

/**
 * Root of the simulation. Owns all game state and advances it one fixed step
 * at a time. Must never touch the DOM, canvas or audio (ARCHITECTURE.md §2),
 * so it runs unchanged in Node tests.
 *
 * Feature 1 only has the map and the step counter; entity systems are added
 * by later features.
 */
export class Game {
  readonly map = new GameMap()
  /** Number of fixed steps taken since the game started. */
  tick = 0

  /** Simulation time, in seconds. */
  get time(): number {
    return this.tick * DT
  }

  step(): void {
    this.tick++
  }

  reset(): void {
    this.tick = 0
  }
}
