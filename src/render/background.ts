import { TILE, WORLD_H, WORLD_W } from '../config.ts'
import { Rng } from '../rng.ts'
import { BASE_HALF, BASE_TILE, Tile, type GameMap } from '../sim/map.ts'

/** Background resolution, in canvas pixels per world pixel. */
export const BG_SCALE = 2

const C = {
  grass: [47, 90, 58] as const,
  grassDark: '#24452c',
  grassLight: 'rgba(160, 210, 120, 0.10)',
  grid: 'rgba(0, 0, 0, 0.10)',
  pathEdge: '#5c4a2c',
  path: '#b39662',
  pathLight: 'rgba(255, 240, 200, 0.10)',
  pathDark: 'rgba(60, 40, 20, 0.18)',
  air: 'rgba(170, 230, 255, 0.22)',
  water: '#2c6f8f',
  waterEdge: '#1d4a60',
  waterLight: 'rgba(200, 240, 255, 0.25)',
  shadow: 'rgba(0, 0, 0, 0.28)',
  tree: '#1f4d2a',
  treeMid: '#2e6b3a',
  treeLight: '#4b8f50',
  rock: '#7d8288',
  rockDark: '#585d63',
  rockLight: '#a3a9ae',
  baseStone: '#55606b',
  baseStoneDark: '#3a434c',
  portal: '#1b1027',
  portalRim: '#4a2f6b',
}

const tc = (t: number): number => (t + 0.5) * TILE

/**
 * Draws the static map once into an offscreen canvas (ARCHITECTURE.md §5.2).
 * Each frame the renderer copies only the visible part, in one drawImage.
 */
export function renderBackground(map: GameMap): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = WORLD_W * BG_SCALE
  canvas.height = WORLD_H * BG_SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not supported')
  ctx.scale(BG_SCALE, BG_SCALE)
  const rng = new Rng(0x51f0)

  drawGrass(ctx, map, rng)
  drawGrid(ctx, map)
  drawWater(ctx, map, rng)
  drawPaths(ctx, map, rng)
  drawAirRoute(ctx, map)
  drawPortals(ctx, map)
  drawBasePlatform(ctx)
  drawScenery(ctx, map, rng)
  return canvas
}

function drawGrass(ctx: CanvasRenderingContext2D, map: GameMap, rng: Rng): void {
  const [r, g, b] = C.grass
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const v = (map.variant[ty * map.width + tx] / 255 - 0.5) * 10
      ctx.fillStyle = `rgb(${r + v}, ${g + v * 1.4}, ${b + v})`
      ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE)
    }
  }
  // Soft darker patches break up the tile pattern.
  for (let i = 0; i < 40; i++) {
    const x = rng.range(0, WORLD_W)
    const y = rng.range(0, WORLD_H)
    const rad = rng.range(40, 110)
    const grad = ctx.createRadialGradient(x, y, 0, x, y, rad)
    grad.addColorStop(0, 'rgba(20, 45, 25, 0.22)')
    grad.addColorStop(1, 'rgba(20, 45, 25, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  // Grass tufts.
  ctx.strokeStyle = C.grassLight
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < 2600; i++) {
    const x = rng.range(0, WORLD_W)
    const y = rng.range(0, WORLD_H)
    ctx.moveTo(x, y)
    ctx.lineTo(x + rng.range(-1.5, 1.5), y - rng.range(2, 4))
  }
  ctx.stroke()
}

/** Faint lines on buildable tiles so placement spots are readable. */
function drawGrid(ctx: CanvasRenderingContext2D, map: GameMap): void {
  ctx.strokeStyle = C.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      if (map.kind(tx, ty) !== Tile.Ground) continue
      ctx.rect(tx * TILE + 0.5, ty * TILE + 0.5, TILE - 1, TILE - 1)
    }
  }
  ctx.stroke()
}

function drawWater(ctx: CanvasRenderingContext2D, map: GameMap, rng: Rng): void {
  ctx.fillStyle = C.waterEdge
  ctx.beginPath()
  forTiles(map, Tile.Water, (x, y) => roundRect(ctx, x - 2, y - 2, TILE + 4, TILE + 4, 10))
  ctx.fill()
  ctx.fillStyle = C.water
  ctx.beginPath()
  forTiles(map, Tile.Water, (x, y) => roundRect(ctx, x + 1, y + 1, TILE - 2, TILE - 2, 8))
  ctx.fill()
  // Fill seams between neighbouring water tiles.
  ctx.beginPath()
  forTiles(map, Tile.Water, (x, y, tx, ty) => {
    if (map.inBounds(tx + 1, ty) && map.kind(tx + 1, ty) === Tile.Water) ctx.rect(x + TILE - 4, y + 1, 8, TILE - 2)
    if (map.inBounds(tx, ty + 1) && map.kind(tx, ty + 1) === Tile.Water) ctx.rect(x + 1, y + TILE - 4, TILE - 2, 8)
  })
  ctx.fill()
  ctx.strokeStyle = C.waterLight
  ctx.lineWidth = 1.5
  ctx.beginPath()
  forTiles(map, Tile.Water, (x, y) => {
    for (let i = 0; i < 2; i++) {
      const rx = x + rng.range(6, TILE - 14)
      const ry = y + rng.range(8, TILE - 8)
      ctx.moveTo(rx, ry)
      ctx.quadraticCurveTo(rx + 4, ry - 3, rx + 8, ry)
    }
  })
  ctx.stroke()
}

function drawPaths(ctx: CanvasRenderingContext2D, map: GameMap, rng: Rng): void {
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const trace = (): void => {
    ctx.beginPath()
    for (const path of map.paths) {
      if (path.kind !== 'ground') continue
      path.points.forEach(([tx, ty], i) => {
        const x = tc(tx)
        const y = tc(ty)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
    }
  }
  trace()
  ctx.strokeStyle = C.pathEdge
  ctx.lineWidth = TILE + 4
  ctx.stroke()
  ctx.strokeStyle = C.path
  ctx.lineWidth = TILE - 4
  ctx.stroke()
  ctx.strokeStyle = C.pathLight
  ctx.lineWidth = TILE - 16
  ctx.stroke()

  // Pebbles and wheel ruts.
  ctx.fillStyle = C.pathDark
  ctx.beginPath()
  forTiles(map, Tile.Path, (x, y) => {
    for (let i = 0; i < 3; i++) {
      const px = x + rng.range(5, TILE - 5)
      const py = y + rng.range(5, TILE - 5)
      ctx.moveTo(px, py)
      ctx.arc(px, py, rng.range(0.8, 1.8), 0, Math.PI * 2)
    }
  })
  ctx.fill()
}

/** Dashed line showing where flyers travel. */
function drawAirRoute(ctx: CanvasRenderingContext2D, map: GameMap): void {
  ctx.save()
  ctx.strokeStyle = C.air
  ctx.lineWidth = 2
  ctx.setLineDash([6, 8])
  ctx.beginPath()
  for (const path of map.paths) {
    if (path.kind !== 'air') continue
    path.points.forEach(([tx, ty], i) => (i === 0 ? ctx.moveTo(tc(tx), tc(ty)) : ctx.lineTo(tc(tx), tc(ty))))
  }
  ctx.stroke()
  ctx.restore()
}

/** Dark pads where portals sit; their animated glow is drawn each frame. */
function drawPortals(ctx: CanvasRenderingContext2D, map: GameMap): void {
  for (const [x, y] of portalPositions(map)) {
    ctx.fillStyle = C.shadow
    ctx.beginPath()
    ctx.ellipse(x, y + 3, 17, 14, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = C.portalRim
    ctx.beginPath()
    ctx.arc(x, y, 15, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = C.portal
    ctx.beginPath()
    ctx.arc(x, y, 11, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawBasePlatform(ctx: CanvasRenderingContext2D): void {
  const x = tc(BASE_TILE[0])
  const y = tc(BASE_TILE[1])
  const half = (BASE_HALF + 0.5) * TILE
  ctx.fillStyle = C.shadow
  ctx.beginPath()
  roundRect(ctx, x - half + 2, y - half + 5, half * 2, half * 2, 14)
  ctx.fill()
  ctx.fillStyle = C.baseStoneDark
  ctx.beginPath()
  roundRect(ctx, x - half, y - half, half * 2, half * 2, 14)
  ctx.fill()
  ctx.fillStyle = C.baseStone
  ctx.beginPath()
  roundRect(ctx, x - half + 4, y - half + 4, half * 2 - 8, half * 2 - 8, 11)
  ctx.fill()
  // Flagstones.
  ctx.strokeStyle = C.baseStoneDark
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let i = 1; i < 3; i++) {
    const o = -half + (i * half * 2) / 3
    ctx.moveTo(x + o, y - half + 6)
    ctx.lineTo(x + o, y + half - 6)
    ctx.moveTo(x - half + 6, y + o)
    ctx.lineTo(x + half - 6, y + o)
  }
  ctx.stroke()
}

function drawScenery(ctx: CanvasRenderingContext2D, map: GameMap, rng: Rng): void {
  forEachTile(map, (tx, ty, kind) => {
    const x = tc(tx)
    const y = tc(ty)
    if (kind === Tile.Tree) drawTree(ctx, x + rng.range(-3, 3), y + rng.range(-3, 3), rng.range(10, 13))
    else if (kind === Tile.Rock) drawRock(ctx, x, y, rng)
  })
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = C.shadow
  ctx.beginPath()
  ctx.ellipse(x + 3, y + 5, r, r * 0.8, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = C.tree
  blob(ctx, x, y, r)
  ctx.fillStyle = C.treeMid
  blob(ctx, x - 1.5, y - 2, r * 0.75)
  ctx.fillStyle = C.treeLight
  blob(ctx, x - 3.5, y - 4.5, r * 0.35)
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.arc(x - r * 0.55, y + r * 0.2, r * 0.6, 0, Math.PI * 2)
  ctx.arc(x + r * 0.55, y + r * 0.25, r * 0.6, 0, Math.PI * 2)
  ctx.fill()
}

function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, rng: Rng): void {
  const n = 7
  const r = rng.range(8, 11)
  const pts: number[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const rr = r * rng.range(0.75, 1.1)
    pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8)
  }
  const poly = (dx: number, dy: number, s: number): void => {
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const px = x + (pts[i * 2] - x) * s + dx
      const py = y + (pts[i * 2 + 1] - y) * s + dy
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = C.shadow
  poly(2, 4, 1)
  ctx.fillStyle = C.rockDark
  poly(0, 0, 1)
  ctx.fillStyle = C.rock
  poly(-1, -1.5, 0.78)
  ctx.fillStyle = C.rockLight
  poly(-2.5, -3, 0.32)
}

/** World positions of every spawn portal: the first on-map tile of each path. */
export function portalPositions(map: GameMap): [number, number][] {
  return map.paths.map((p) => {
    const [ax, ay] = p.points[0]
    return [tc(Math.max(0, ax)), tc(Math.max(0, ay))]
  })
}

export function baseCentre(): [number, number] {
  return [tc(BASE_TILE[0]), tc(BASE_TILE[1])]
}

function forEachTile(map: GameMap, fn: (tx: number, ty: number, kind: number) => void): void {
  for (let ty = 0; ty < map.height; ty++) for (let tx = 0; tx < map.width; tx++) fn(tx, ty, map.kind(tx, ty))
}

/** Calls fn with the top-left world position of every tile of a kind. */
function forTiles(
  map: GameMap,
  kind: number,
  fn: (x: number, y: number, tx: number, ty: number) => void,
): void {
  forEachTile(map, (tx, ty, k) => {
    if (k === kind) fn(tx * TILE, ty * TILE, tx, ty)
  })
}

/** Adds a rounded rectangle to the current path (does not begin a new one). */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.roundRect(x, y, w, h, r)
}
