import { describe, expect, it } from 'vitest'
import { LANE_MAX, PATH_SAMPLE_STEP, TILE } from '../src/config.ts'
import { PATHS } from '../src/sim/map.ts'
import { HEADINGS, SampledPath } from '../src/sim/path.ts'

const paths = PATHS.map((p) => new SampledPath(p))

describe('SampledPath', () => {
  it('starts at the first waypoint and ends at the last', () => {
    paths.forEach((p, i) => {
      const [fx, fy] = PATHS[i].points[0]
      const [lx, ly] = PATHS[i].points[PATHS[i].points.length - 1]
      expect(p.x[0]).toBeCloseTo((fx + 0.5) * TILE, 3)
      expect(p.y[0]).toBeCloseTo((fy + 0.5) * TILE, 3)
      expect(p.x[p.count - 1]).toBeCloseTo((lx + 0.5) * TILE, 3)
      expect(p.y[p.count - 1]).toBeCloseTo((ly + 0.5) * TILE, 3)
    })
  })

  it('spaces samples evenly along the curve', () => {
    for (const p of paths) {
      // Every gap except the final remainder is one step (curves shorten chords slightly).
      for (let i = 1; i < p.count - 1; i++) {
        const gap = Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1])
        expect(gap).toBeGreaterThan(PATH_SAMPLE_STEP * 0.95)
        expect(gap).toBeLessThanOrEqual(PATH_SAMPLE_STEP + 1e-3)
      }
      expect(p.count).toBe(Math.ceil(p.length / PATH_SAMPLE_STEP) + 1)
    }
  })

  it('has unit normals that never flip, so lane offsets stay continuous', () => {
    for (const p of paths) {
      for (let i = 0; i < p.count; i++) {
        expect(Math.hypot(p.nx[i], p.ny[i])).toBeCloseTo(1, 4)
        if (i > 0) expect(p.nx[i] * p.nx[i - 1] + p.ny[i] * p.ny[i - 1]).toBeGreaterThan(0.9)
      }
    }
  })

  it('keeps lane offsets inside the path corridor at corners', () => {
    // An enemy at the widest lane stays within half a tile of the centre polyline.
    const ground = paths.filter((p) => !p.air)
    for (const [k, p] of ground.entries()) {
      const pts = PATHS.filter((d) => d.kind === 'ground')[k].points.map(([x, y]) => [(x + 0.5) * TILE, (y + 0.5) * TILE])
      for (let i = 0; i < p.count; i += 3) {
        for (const lane of [-LANE_MAX, LANE_MAX]) {
          const x = p.x[i] + p.nx[i] * lane
          const y = p.y[i] + p.ny[i] * lane
          expect(distToPolyline(x, y, pts)).toBeLessThan(TILE / 2)
        }
      }
    }
  })

  it('gives headings in range, matching the first segment direction', () => {
    for (const p of paths) for (let i = 0; i < p.count; i++) expect(p.heading[i]).toBeLessThan(HEADINGS)
    // Both ground paths start heading +x (bucket 0).
    expect(paths[0].heading[0]).toBe(0)
    expect(paths[1].heading[0]).toBe(0)
  })

  it('spawns one tile in and ends before the path does', () => {
    for (const p of paths) {
      expect(p.spawnDist).toBe(TILE)
      expect(p.endDist).toBeLessThan(p.length)
      expect(p.endDist).toBeGreaterThan(p.spawnDist)
    }
  })

  it('clamps index lookups to valid pairs', () => {
    const p = paths[0]
    expect(p.index(-5)).toBe(0)
    expect(p.index(1e9)).toBe(p.count - 2)
  })
})

function distToPolyline(x: number, y: number, pts: number[][]): number {
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)))
  }
  return best
}
