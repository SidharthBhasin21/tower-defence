import { AIR_CORNER_RADIUS, BASE_REACH, GROUND_CORNER_RADIUS, PATH_SAMPLE_STEP, TILE } from '../config.ts'
import type { PathDef } from './map.ts'

/** Number of heading buckets used for directional sprites. */
export const HEADINGS = 16

/**
 * A path turned into evenly spaced lookup samples (ARCHITECTURE.md §4.2).
 *
 * Waypoints are joined with rounded corners, then resampled every
 * PATH_SAMPLE_STEP px of arc length. An enemy's position is a table lookup by
 * its distance travelled, plus its lane offset along the normal, so no enemy
 * ever runs pathfinding.
 */
export class SampledPath {
  readonly air: boolean
  /** Total arc length, in world px. */
  readonly length: number
  readonly count: number
  readonly x: Float32Array
  readonly y: Float32Array
  /** Unit normal (left of the direction of travel). */
  readonly nx: Float32Array
  readonly ny: Float32Array
  /** Direction of travel, bucketed into HEADINGS steps (0 = +x, clockwise). */
  readonly heading: Uint8Array
  /** Where enemies appear: the portal on the first on-map tile. */
  readonly spawnDist: number
  /** Where enemies reach the base. */
  readonly endDist: number

  constructor(def: PathDef) {
    this.air = def.kind === 'air'
    const pts = def.points.map(([tx, ty]) => [(tx + 0.5) * TILE, (ty + 0.5) * TILE] as const)
    const dense = roundCorners(pts, this.air ? AIR_CORNER_RADIUS : GROUND_CORNER_RADIUS)
    const { xs, ys, length } = resample(dense, PATH_SAMPLE_STEP)
    this.length = length
    this.count = xs.length
    this.x = Float32Array.from(xs)
    this.y = Float32Array.from(ys)
    this.nx = new Float32Array(this.count)
    this.ny = new Float32Array(this.count)
    this.heading = new Uint8Array(this.count)
    for (let i = 0; i < this.count; i++) {
      const a = Math.max(0, i - 1)
      const b = Math.min(this.count - 1, i + 1)
      let tx = xs[b] - xs[a]
      let ty = ys[b] - ys[a]
      const len = Math.hypot(tx, ty) || 1
      tx /= len
      ty /= len
      this.nx[i] = ty
      this.ny[i] = -tx
      const h = Math.round((Math.atan2(ty, tx) / (Math.PI * 2)) * HEADINGS)
      this.heading[i] = ((h % HEADINGS) + HEADINGS) % HEADINGS
    }
    // Off-map waypoints are one tile out, so the portal is one tile in.
    this.spawnDist = TILE
    this.endDist = length - BASE_REACH
  }

  /** Sample index for a distance (clamped so i + 1 is always valid). */
  index(dist: number): number {
    const i = Math.floor(dist / PATH_SAMPLE_STEP)
    return i < 0 ? 0 : i > this.count - 2 ? this.count - 2 : i
  }
}

/**
 * Replaces each interior corner with a quadratic curve whose control point is
 * the corner, giving a continuous direction (and therefore continuous lane
 * offsets) through every turn. Returns a dense polyline.
 */
function roundCorners(pts: readonly (readonly [number, number])[], radius: number): [number, number][] {
  const out: [number, number][] = [[pts[0][0], pts[0][1]]]
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const [cx, cy] = pts[i + 1]
    const l1 = Math.hypot(bx - ax, by - ay)
    const l2 = Math.hypot(cx - bx, cy - by)
    const t = Math.min(radius, l1 / 2, l2 / 2)
    const p1x = bx - ((bx - ax) / l1) * t
    const p1y = by - ((by - ay) / l1) * t
    const p2x = bx + ((cx - bx) / l2) * t
    const p2y = by + ((cy - by) / l2) * t
    const steps = Math.max(4, Math.ceil(t / 2))
    for (let s = 0; s <= steps; s++) {
      const u = s / steps
      const v = 1 - u
      out.push([v * v * p1x + 2 * v * u * bx + u * u * p2x, v * v * p1y + 2 * v * u * by + u * u * p2y])
    }
  }
  const last = pts[pts.length - 1]
  out.push([last[0], last[1]])
  return out
}

/** Resamples a polyline at a fixed arc-length step; the last sample is the end point. */
function resample(pts: readonly [number, number][], step: number): { xs: number[]; ys: number[]; length: number } {
  const xs: number[] = [pts[0][0]]
  const ys: number[] = [pts[0][1]]
  let length = 0
  let next = step
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const seg = Math.hypot(bx - ax, by - ay)
    if (seg === 0) continue
    while (next <= length + seg) {
      const u = (next - length) / seg
      xs.push(ax + (bx - ax) * u)
      ys.push(ay + (by - ay) * u)
      next += step
    }
    length += seg
  }
  const [ex, ey] = pts[pts.length - 1]
  if (xs[xs.length - 1] !== ex || ys[ys.length - 1] !== ey) {
    xs.push(ex)
    ys.push(ey)
  }
  return { xs, ys, length }
}
