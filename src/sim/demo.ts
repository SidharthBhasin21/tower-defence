import { EnemyType } from '../config.ts'
import type { Game } from './game.ts'

/** Steps between trickle spawns (about 0.5 s). */
const TRICKLE_INTERVAL = 30
/** Enemies spawned per step while a burst is draining. */
const BURST_PER_STEP = 5

/**
 * TEMPORARY (features 2–4): spawns Grunts so paths, movement and leaks can be
 * seen before waves exist. Replaced by the wave scheduler in feature 5.
 *
 * Runs inside the fixed step, so it is deterministic like the rest of the sim.
 */
export class DemoSpawner {
  private burst = 0
  private nextPath = 0

  /** Queues `n` extra Grunts, spawned a few per step across both ground paths. */
  requestBurst(n: number): void {
    this.burst += n
  }

  step(game: Game): void {
    if (game.tick % TRICKLE_INTERVAL === 0) this.spawn(game)
    for (let i = 0; i < BURST_PER_STEP && this.burst > 0; i++, this.burst--) this.spawn(game)
  }

  private spawn(game: Game): void {
    game.spawnEnemy(EnemyType.Grunt, this.nextPath)
    this.nextPath = 1 - this.nextPath
  }
}
