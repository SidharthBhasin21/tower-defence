import { IntRing } from './ring.ts'

/**
 * Sim → client events (ARCHITECTURE.md §4.6). The simulation pushes small
 * integer records; the client drains them once per frame to play sounds and
 * show feedback. The sim never calls client code directly.
 */
export const Ev = {
  /** An enemy reached the base. a = enemy type, b = lives lost. */
  Leak: 1,
  /** An enemy was killed. a = enemy type, b = gold earned, c = enemy slot. */
  Kill: 2,
  /** A tower was built. a = tower type, b = tile x, c = tile y. */
  TowerPlaced: 3,
  /** A build was refused. a = PlaceResult reason, b = tile x, c = tile y. */
  PlaceFailed: 4,
  /** A tower fired. a = tower type, b = tower index. */
  Shot: 5,
} as const
export type EventType = (typeof Ev)[keyof typeof Ev]

export class EventQueue extends IntRing {
  push(type: EventType, a = 0, b = 0, c = 0): void {
    this.pushRecord(type, a, b, c)
  }
}
