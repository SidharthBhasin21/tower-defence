import { GRID_CELL, GRID_MARGIN, WORLD_H, WORLD_W } from '../config.ts'
import type { EnemyPool } from './enemies.ts'

/**
 * Uniform spatial grid over the world (ARCHITECTURE.md §4.3), rebuilt every
 * step with a counting sort: count enemies per cell, prefix-sum the counts,
 * then scatter slots into one array. O(n), allocation-free.
 *
 * Cell c holds `items[cellStart[c] .. cellStart[c + 1])`. Positions outside
 * the covered area are clamped into the edge cells, so nothing is lost.
 */
export class SpatialGrid {
  readonly cellSize = GRID_CELL
  readonly originX = -GRID_MARGIN
  readonly originY = -GRID_MARGIN
  readonly cols = Math.ceil((WORLD_W + GRID_MARGIN * 2) / GRID_CELL)
  readonly rows = Math.ceil((WORLD_H + GRID_MARGIN * 2) / GRID_CELL)
  /** Start of each cell's run in `items`; one extra entry marks the end. */
  readonly cellStart: Int32Array
  /** Enemy slots, grouped by cell. */
  readonly items: Int32Array
  /** Number of slots in `items`. */
  size = 0
  private readonly cellCount: Int32Array
  /** Cell of each listed slot, saved by the counting pass for the scatter pass. */
  private readonly cellOf: Int32Array

  constructor(capacity: number) {
    const cells = this.cols * this.rows
    this.cellStart = new Int32Array(cells + 1)
    this.cellCount = new Int32Array(cells)
    this.items = new Int32Array(capacity)
    this.cellOf = new Int32Array(capacity)
  }

  col(x: number): number {
    const c = Math.floor((x - this.originX) / this.cellSize)
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c
  }

  row(y: number): number {
    const r = Math.floor((y - this.originY) / this.cellSize)
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r
  }

  /** Lists every living enemy by cell. Call once per step after enemies move. */
  rebuild(e: EnemyPool): void {
    const counts = this.cellCount
    counts.fill(0)
    const active = e.active
    for (let k = 0; k < e.count; k++) {
      const s = active[k]
      if (!e.alive[s]) continue
      const c = this.row(e.y[s]) * this.cols + this.col(e.x[s])
      this.cellOf[s] = c
      counts[c]++
    }
    // Prefix sum: cellStart[c] = items before cell c. Reuse counts as write cursors.
    const start = this.cellStart
    let sum = 0
    for (let c = 0; c < counts.length; c++) {
      start[c] = sum
      sum += counts[c]
      counts[c] = start[c]
    }
    start[counts.length] = sum
    this.size = sum
    for (let k = 0; k < e.count; k++) {
      const s = active[k]
      if (!e.alive[s]) continue
      this.items[counts[this.cellOf[s]]++] = s
    }
  }

  /**
   * Writes the slots of living enemies whose centre is within `r` of (x, y)
   * into `out`, and returns how many. `out` must hold the pool's capacity.
   */
  query(e: EnemyPool, x: number, y: number, r: number, out: Int32Array): number {
    const c0 = this.col(x - r)
    const c1 = this.col(x + r)
    const r0 = this.row(y - r)
    const r1 = this.row(y + r)
    const r2 = r * r
    let n = 0
    for (let row = r0; row <= r1; row++) {
      const base = row * this.cols
      for (let col = c0; col <= c1; col++) {
        const c = base + col
        for (let i = this.cellStart[c], end = this.cellStart[c + 1]; i < end; i++) {
          const s = this.items[i]
          if (!e.alive[s]) continue
          const dx = e.x[s] - x
          const dy = e.y[s] - y
          if (dx * dx + dy * dy <= r2) out[n++] = s
        }
      }
    }
    return n
  }
}
