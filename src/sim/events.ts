/**
 * Sim → client event queue (ARCHITECTURE.md §4.6). The simulation pushes small
 * integer records; the client drains them once per frame to play sounds and
 * show feedback. Preallocated ring, so pushing allocates nothing.
 */
export const Ev = {
  /** An enemy reached the base. a = enemy type, b = lives lost. */
  Leak: 1,
} as const
export type EventType = (typeof Ev)[keyof typeof Ev]

export type EventHandler = (type: number, a: number, b: number, c: number) => void

const FIELDS = 4

export class EventQueue {
  private readonly buf: Int32Array
  private readonly capacity: number
  private head = 0
  private size = 0
  /** Events dropped because the queue was full (should stay 0 in play). */
  dropped = 0

  constructor(capacity = 4096) {
    this.capacity = capacity
    this.buf = new Int32Array(capacity * FIELDS)
  }

  get length(): number {
    return this.size
  }

  push(type: EventType, a = 0, b = 0, c = 0): void {
    if (this.size === this.capacity) {
      this.dropped++
      return
    }
    const o = ((this.head + this.size) % this.capacity) * FIELDS
    this.buf[o] = type
    this.buf[o + 1] = a
    this.buf[o + 2] = b
    this.buf[o + 3] = c
    this.size++
  }

  /** Calls `fn` for every queued event in order, then empties the queue. */
  drain(fn: EventHandler): void {
    while (this.size > 0) {
      const o = this.head * FIELDS
      this.head = (this.head + 1) % this.capacity
      this.size--
      fn(this.buf[o], this.buf[o + 1], this.buf[o + 2], this.buf[o + 3])
    }
  }

  clear(): void {
    this.head = 0
    this.size = 0
  }
}
