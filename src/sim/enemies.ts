/**
 * Enemy storage as a structure of arrays (ARCHITECTURE.md §4.1).
 *
 * Enemies live in fixed slots so other systems can hold a stable reference
 * `(slot, generation)`. A dense `active` list of slots makes iteration cheap.
 * Freeing is deferred to `flush()` at the end of a step, so a slot is never
 * reused within the step that freed it. Everything is allocated once.
 */
export class EnemyPool {
  readonly capacity: number

  // ---- Per-slot fields ----
  readonly alive: Uint8Array
  /** Bumped every time the slot is freed; detects stale references. */
  readonly generation: Uint32Array
  readonly type: Uint8Array
  readonly pathId: Uint8Array
  /** Distance travelled along the path, in world px. */
  readonly dist: Float32Array
  /** Sideways offset from the path centre line, in world px. */
  readonly lane: Float32Array
  /** Base speed in world px per second (before slows). */
  readonly speed: Float32Array
  readonly hp: Float32Array
  readonly maxHp: Float32Array
  readonly armor: Float32Array
  /** Current slow multiplier (1 = not slowed) and seconds it has left. */
  readonly slowMul: Float32Array
  readonly slowT: Float32Array
  /** Seconds of hit flash left (drawing only). */
  readonly flashT: Float32Array
  readonly waveId: Int16Array
  /** Position now and at the previous step, for render interpolation. */
  readonly x: Float32Array
  readonly y: Float32Array
  readonly px: Float32Array
  readonly py: Float32Array
  readonly heading: Uint8Array

  // ---- Bookkeeping ----
  /** Slots in use, densely packed in [0, count). */
  readonly active: Int32Array
  /** Position of each slot in `active` (-1 when free). */
  private readonly activeIndex: Int32Array
  private readonly free: Int32Array
  private freeTop = 0
  private readonly pending: Int32Array
  private pendingCount = 0
  /** Number of slots in `active` (includes enemies killed this step until flush). */
  count = 0
  /** Number of living enemies. */
  aliveCount = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.alive = new Uint8Array(capacity)
    this.generation = new Uint32Array(capacity)
    this.type = new Uint8Array(capacity)
    this.pathId = new Uint8Array(capacity)
    this.dist = new Float32Array(capacity)
    this.lane = new Float32Array(capacity)
    this.speed = new Float32Array(capacity)
    this.hp = new Float32Array(capacity)
    this.maxHp = new Float32Array(capacity)
    this.armor = new Float32Array(capacity)
    this.slowMul = new Float32Array(capacity)
    this.slowT = new Float32Array(capacity)
    this.flashT = new Float32Array(capacity)
    this.waveId = new Int16Array(capacity)
    this.x = new Float32Array(capacity)
    this.y = new Float32Array(capacity)
    this.px = new Float32Array(capacity)
    this.py = new Float32Array(capacity)
    this.heading = new Uint8Array(capacity)
    this.active = new Int32Array(capacity)
    this.activeIndex = new Int32Array(capacity)
    this.free = new Int32Array(capacity)
    this.pending = new Int32Array(capacity)
    this.reset()
  }

  /** Empties the pool without reallocating. Generations keep counting up. */
  reset(): void {
    this.alive.fill(0)
    this.activeIndex.fill(-1)
    // Free stack pops low slots first, which keeps active data compact.
    for (let i = 0; i < this.capacity; i++) this.free[i] = this.capacity - 1 - i
    this.freeTop = this.capacity
    this.count = 0
    this.aliveCount = 0
    this.pendingCount = 0
  }

  /** Takes a free slot and marks it alive; returns -1 when the pool is full. */
  alloc(): number {
    if (this.freeTop === 0) return -1
    const s = this.free[--this.freeTop]
    this.alive[s] = 1
    this.activeIndex[s] = this.count
    this.active[this.count++] = s
    this.aliveCount++
    return s
  }

  /** Marks an enemy dead now; its slot is released at the next flush(). */
  kill(slot: number): void {
    if (!this.alive[slot]) return
    this.alive[slot] = 0
    this.aliveCount--
    this.pending[this.pendingCount++] = slot
  }

  /** True if the reference still points at the same living enemy. */
  isAlive(slot: number, generation: number): boolean {
    return slot >= 0 && this.alive[slot] === 1 && this.generation[slot] === generation
  }

  /** Releases slots killed this step. Call once at the end of every step. */
  flush(): void {
    for (let i = 0; i < this.pendingCount; i++) {
      const s = this.pending[i]
      // Swap-remove from the dense active list.
      const at = this.activeIndex[s]
      const lastSlot = this.active[--this.count]
      this.active[at] = lastSlot
      this.activeIndex[lastSlot] = at
      this.activeIndex[s] = -1
      this.generation[s] = (this.generation[s] + 1) >>> 0
      this.free[this.freeTop++] = s
    }
    this.pendingCount = 0
  }
}
