export type RingHandler = (type: number, a: number, b: number, c: number) => void

const FIELDS = 4

/**
 * Fixed-capacity FIFO of small integer records `(type, a, b, c)`, backed by
 * one preallocated Int32Array. Used for sim → client events and for player
 * commands. Pushing to a full queue drops the record and counts it.
 */
export class IntRing {
  private readonly buf: Int32Array
  private readonly capacity: number
  private head = 0
  private size = 0
  /** Records dropped because the queue was full (should stay 0 in play). */
  dropped = 0

  constructor(capacity = 4096) {
    this.capacity = capacity
    this.buf = new Int32Array(capacity * FIELDS)
  }

  get length(): number {
    return this.size
  }

  protected pushRecord(type: number, a: number, b: number, c: number): void {
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

  /** Calls `fn` for every queued record in order, then empties the queue. */
  drain(fn: RingHandler): void {
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
