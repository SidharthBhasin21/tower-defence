import { describe, expect, it } from 'vitest'
import { MAP_H, MAP_W } from '../src/config.ts'
import { BASE_HALF, BASE_TILE, GameMap, Tile } from '../src/sim/map.ts'

describe('GameMap', () => {
  const map = new GameMap()

  it('has the documented size', () => {
    expect(map.width).toBe(MAP_W)
    expect(map.height).toBe(MAP_H)
  })

  it('is identical for the same seed', () => {
    expect(new GameMap().tiles).toEqual(map.tiles)
  })

  it('has two ground paths and one air path, all ending at the base', () => {
    expect(map.paths.filter((p) => p.kind === 'ground')).toHaveLength(2)
    expect(map.paths.filter((p) => p.kind === 'air')).toHaveLength(1)
    for (const p of map.paths) expect(p.points[p.points.length - 1]).toEqual([BASE_TILE[0], BASE_TILE[1]])
  })

  it('starts every path off the map edge', () => {
    for (const p of map.paths) {
      const [x, y] = p.points[0]
      expect(x < 0 || y < 0).toBe(true)
    }
  })

  it('marks a continuous run of path tiles along each ground path', () => {
    for (const p of map.paths) {
      if (p.kind !== 'ground') continue
      for (let i = 1; i < p.points.length; i++) {
        const [ax, ay] = p.points[i - 1]
        const [bx, by] = p.points[i]
        const sx = Math.sign(bx - ax)
        const sy = Math.sign(by - ay)
        for (let x = ax, y = ay; ; x += sx, y += sy) {
          if (map.inBounds(x, y)) expect([Tile.Path, Tile.Base]).toContain(map.kind(x, y))
          if (x === bx && y === by) break
        }
      }
    }
  })

  it('places the base footprint', () => {
    for (let dy = -BASE_HALF; dy <= BASE_HALF; dy++)
      for (let dx = -BASE_HALF; dx <= BASE_HALF; dx++) expect(map.kind(BASE_TILE[0] + dx, BASE_TILE[1] + dy)).toBe(Tile.Base)
  })

  it('keeps every tile next to a path free of scenery', () => {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.kind(x, y) !== Tile.Path) continue
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!map.inBounds(x + dx, y + dy)) continue
            expect([Tile.Rock, Tile.Tree]).not.toContain(map.kind(x + dx, y + dy))
          }
        }
      }
    }
  })

  it('has room for the 100-tower stress scenario', () => {
    let buildable = 0
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.isBuildable(x, y)) buildable++
    expect(buildable).toBeGreaterThanOrEqual(100)
  })

  it('does not allow building off the map, on paths or on scenery', () => {
    expect(map.isBuildable(-1, 0)).toBe(false)
    expect(map.isBuildable(MAP_W, 0)).toBe(false)
    expect(map.isBuildable(BASE_TILE[0], BASE_TILE[1])).toBe(false)
    expect(map.isBuildable(6, 3)).toBe(false) // a path tile
  })
})
