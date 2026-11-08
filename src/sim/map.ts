import { MAP_H, MAP_SEED, MAP_W } from '../config.ts'
import { Rng } from '../rng.ts'

/**
 * The single game map (DOMAIN.md §2.1): a 40 × 24 tile grid with two ground
 * paths that merge before the base, and one air route for flyers.
 */

export const Tile = {
  Ground: 0,
  Path: 1,
  Rock: 2,
  Tree: 3,
  Water: 4,
  Base: 5,
} as const
export type TileKind = (typeof Tile)[keyof typeof Tile]

/** A path as waypoints in tile coordinates (tile centres). */
export interface PathDef {
  readonly kind: 'ground' | 'air'
  readonly points: readonly (readonly [number, number])[]
}

/** Base location: centre tile, and half-size of its square footprint. */
export const BASE_TILE = [37, 12] as const
export const BASE_HALF = 1

/** Shared final stretch of both ground paths, from the merge point to the base. */
const SHARED_TAIL: readonly (readonly [number, number])[] = [
  [20, 12],
  [27, 12],
  [27, 18],
  [33, 18],
  [33, 12],
  [37, 12],
]

/**
 * Ground paths are axis-aligned waypoint lists; air paths may be diagonal.
 * The first point of each path is off-map (x or y = -1), so enemies walk in
 * from the edge through a spawn portal.
 */
export const PATHS: readonly PathDef[] = [
  {
    kind: 'ground',
    points: [[-1, 3], [6, 3], [6, 9], [13, 9], [13, 4], [20, 4], ...SHARED_TAIL],
  },
  {
    kind: 'ground',
    points: [[-1, 20], [5, 20], [5, 15], [11, 15], [11, 21], [17, 21], [17, 15], [20, 15], ...SHARED_TAIL],
  },
  {
    kind: 'air',
    points: [[14, -1], [24, 6], [BASE_TILE[0], BASE_TILE[1]]],
  },
]

/** Fixed pond, as an inclusive tile rectangle [x0, y0, x1, y1]. */
const POND: readonly [number, number, number, number] = [30, 3, 33, 5]

export class GameMap {
  readonly width = MAP_W
  readonly height = MAP_H
  /** Tile kind per tile, row-major (index = y * width + x). */
  readonly tiles = new Uint8Array(MAP_W * MAP_H)
  /** Variation value per tile, used by the renderer for organic detail. */
  readonly variant = new Uint8Array(MAP_W * MAP_H)
  readonly paths = PATHS

  constructor(seed = MAP_SEED) {
    this.build(seed)
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height
  }

  kind(tx: number, ty: number): TileKind {
    return this.tiles[ty * this.width + tx] as TileKind
  }

  /** True if a tower may be placed on this tile (towers come in feature 3). */
  isBuildable(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.tiles[ty * this.width + tx] === Tile.Ground
  }

  private set(tx: number, ty: number, kind: TileKind): void {
    if (this.inBounds(tx, ty)) this.tiles[ty * this.width + tx] = kind
  }

  private build(seed: number): void {
    const rng = new Rng(seed)
    this.tiles.fill(Tile.Ground)
    for (let i = 0; i < this.variant.length; i++) this.variant[i] = rng.int(0, 255)

    // Ground paths: mark every tile along each axis-aligned segment.
    for (const path of this.paths) {
      if (path.kind !== 'ground') continue
      for (let i = 1; i < path.points.length; i++) {
        const [ax, ay] = path.points[i - 1]
        const [bx, by] = path.points[i]
        if (ax !== bx && ay !== by) throw new Error(`Ground path segment ${i} is not axis-aligned`)
        const sx = Math.sign(bx - ax)
        const sy = Math.sign(by - ay)
        for (let x = ax, y = ay; ; x += sx, y += sy) {
          this.set(x, y, Tile.Path)
          if (x === bx && y === by) break
        }
      }
    }

    // Base footprint.
    for (let dy = -BASE_HALF; dy <= BASE_HALF; dy++)
      for (let dx = -BASE_HALF; dx <= BASE_HALF; dx++) this.set(BASE_TILE[0] + dx, BASE_TILE[1] + dy, Tile.Base)

    // Pond.
    for (let y = POND[1]; y <= POND[3]; y++) for (let x = POND[0]; x <= POND[2]; x++) this.set(x, y, Tile.Water)

    // Scattered scenery on open ground. Tiles right next to a path stay clear
    // so the best tower spots are never blocked.
    for (let ty = 0; ty < this.height; ty++) {
      for (let tx = 0; tx < this.width; tx++) {
        if (this.kind(tx, ty) !== Tile.Ground) continue
        const roll = rng.next()
        if (this.nearPath(tx, ty)) continue
        if (roll < 0.045) this.set(tx, ty, Tile.Tree)
        else if (roll < 0.07) this.set(tx, ty, Tile.Rock)
      }
    }
  }

  /** True if any of the 8 neighbours is a path or base tile. */
  private nearPath(tx: number, ty: number): boolean {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx
        const y = ty + dy
        if (!this.inBounds(x, y)) continue
        const k = this.kind(x, y)
        if (k === Tile.Path || k === Tile.Base) return true
      }
    }
    return false
  }
}
