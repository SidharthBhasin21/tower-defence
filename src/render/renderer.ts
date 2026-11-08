import { DT, ENEMIES, MAX_ENEMIES, TILE, TOWERS, WORLD_H, WORLD_W } from '../config.ts'
import { PlaceResult, type Game } from '../sim/game.ts'
import type { Controls } from '../ui/controls.ts'
import { BG_SCALE, baseCentre, portalPositions, renderBackground } from './background.ts'
import type { Camera, Rect, Vec } from './camera.ts'
import { buildSprites, type Sprites } from './sprites.ts'

/** Colour drawn outside the map. */
const VOID = '#0b130e'
const TAU = Math.PI * 2
const DASH = [6, 5]
const NO_DASH: number[] = []
/** Health-bar colour bands, from healthy to nearly dead. */
const HP_COLOURS = ['#5fd35f', '#f2c744', '#ef5a4c']
const HP_BG = 'rgba(10, 14, 12, 0.85)'

/**
 * Canvas 2D renderer (ARCHITECTURE.md §5). Applies the camera once per frame
 * and draws in world coordinates. Draws only what the camera can see.
 */
export class Renderer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly camera: Camera
  private readonly game: Game
  private readonly controls: Controls
  private readonly background: HTMLCanvasElement
  private readonly portalGlow: HTMLCanvasElement
  private readonly baseGlow: HTMLCanvasElement
  private readonly hurtGlow: HTMLCanvasElement
  private readonly sprites: Sprites
  private readonly portals: readonly (readonly [number, number])[]
  private readonly base: readonly [number, number]
  private readonly view: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 }
  private readonly hover: Vec = { x: 0, y: 0 }
  /** Visible enemies this frame, with interpolated positions (allocated once). */
  private readonly visSlot = new Int32Array(MAX_ENEMIES)
  private readonly visX = new Float32Array(MAX_ENEMIES)
  private readonly visY = new Float32Array(MAX_ENEMIES)
  private visCount = 0
  private dpr = 1
  /** Camera transform for this frame: world px → device px. */
  private camS = 1
  private camOx = 0
  private camOy = 0
  /** Red flash on the base after a leak, fading from 1 to 0 in real time. */
  private baseFlash = 0
  /** Enemies drawn last frame (for the debug readout). */
  drawnEnemies = 0

  constructor(canvas: HTMLCanvasElement, camera: Camera, game: Game, controls: Controls) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Canvas 2D is not supported')
    this.canvas = canvas
    this.ctx = ctx
    this.camera = camera
    this.game = game
    this.controls = controls
    this.background = renderBackground(game.map)
    this.portalGlow = glowSprite(64, '190, 120, 255')
    this.baseGlow = glowSprite(96, '110, 220, 255')
    this.hurtGlow = glowSprite(96, '255, 70, 60')
    this.sprites = buildSprites()
    this.portals = portalPositions(game.map)
    this.base = baseCentre()
  }

  /** Matches the canvas backing store to the CSS size × device pixel ratio. */
  resize(cssW: number, cssH: number, dpr: number): void {
    this.dpr = dpr
    this.canvas.width = Math.max(1, Math.round(cssW * dpr))
    this.canvas.height = Math.max(1, Math.round(cssH * dpr))
    this.camera.setViewport(cssW, cssH)
  }

  /** Called when an enemy reaches the base. */
  flashBase(): void {
    this.baseFlash = 1
  }

  render(alpha: number, realDt: number): void {
    const { ctx, camera, dpr } = this
    // Sim time, interpolated: animations freeze when paused and scale with game speed.
    const t = (this.game.tick + alpha) * DT

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = VOID
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

    // Camera transform, applied once: world px → device px.
    this.camS = camera.zoom * dpr
    this.camOx = (camera.viewW / 2 - camera.x * camera.zoom) * dpr
    this.camOy = (camera.viewH / 2 - camera.y * camera.zoom) * dpr
    ctx.setTransform(this.camS, 0, 0, this.camS, this.camOx, this.camOy)
    const v = camera.viewRect(this.view)

    this.drawBackground(v)
    this.drawPortals(t, v)
    this.drawSelection()
    this.drawTowers(alpha, v)
    this.collectVisibleEnemies(alpha, t, v)
    // Enemies before the base, so they walk into it rather than over it.
    this.drawEnemies()
    this.drawBase(t, v)
    this.drawProjectiles(alpha, v)
    this.drawHealthBars()
    this.drawBuildPreview()
    this.baseFlash = Math.max(0, this.baseFlash - realDt * 2.5)
  }

  // ------------------------------------------------------------- towers

  private drawTowers(alpha: number, v: Rect): void {
    const ctx = this.ctx
    const t = this.game.towers
    const img = this.sprites.atlas.canvas
    const base = this.sprites.towerBase
    for (let i = 0; i < t.count; i++) {
      const x = t.x[i]
      const y = t.y[i]
      if (x + TILE < v.x0 || x - TILE > v.x1 || y + TILE < v.y0 || y - TILE > v.y1) continue
      ctx.drawImage(img, base.sx, base.sy, base.sw, base.sh, x - base.w / 2, y - base.h / 2, base.w, base.h)
    }
    // Turrets: one rotated transform each (at most a few hundred towers).
    const s = this.camS
    for (let i = 0; i < t.count; i++) {
      const x = t.x[i]
      const y = t.y[i]
      if (x + TILE < v.x0 || x - TILE > v.x1 || y + TILE < v.y0 || y - TILE > v.y1) continue
      const f = this.sprites.turret[t.type[i]]
      const a = lerpAngle(t.prevAngle[i], t.angle[i], alpha)
      const c = Math.cos(a) * s
      const sn = Math.sin(a) * s
      ctx.setTransform(c, sn, -sn, c, this.camOx + x * s, this.camOy + y * s)
      const kick = t.recoil[i] * 2.5
      ctx.drawImage(img, f.sx, f.sy, f.sw, f.sh, -f.w / 2 - kick, -f.h / 2, f.w, f.h)
    }
    ctx.setTransform(s, 0, 0, s, this.camOx, this.camOy)
  }

  // ------------------------------------------------------------ enemies

  /**
   * Walks only the grid cells overlapping the view (plus one cell of margin),
   * so the cost follows what's on screen rather than how many enemies exist.
   */
  private collectVisibleEnemies(alpha: number, t: number, v: Rect): void {
    const e = this.game.enemies
    const grid = this.game.grid
    const pad = grid.cellSize
    const c0 = grid.col(v.x0 - pad)
    const c1 = grid.col(v.x1 + pad)
    const r0 = grid.row(v.y0 - pad)
    const r1 = grid.row(v.y1 + pad)
    let n = 0
    for (let row = r0; row <= r1; row++) {
      const base = row * grid.cols
      const start = grid.cellStart[base + c0]
      const end = grid.cellStart[base + c1 + 1]
      // Cells in a row are contiguous in `items`, so one run covers the whole span.
      for (let i = start; i < end; i++) {
        const s = grid.items[i]
        if (!e.alive[s]) continue
        const r = ENEMIES[e.type[s]].radius + 6
        const x = e.px[s] + (e.x[s] - e.px[s]) * alpha
        // Small walking bob, phase-shifted per slot so the crowd doesn't move in lockstep.
        const y = e.py[s] + (e.y[s] - e.py[s]) * alpha - Math.abs(Math.sin(t * 9 + s * 1.7)) * 1.5
        if (x + r < v.x0 || x - r > v.x1 || y + r < v.y0 || y - r > v.y1) continue
        this.visSlot[n] = s
        this.visX[n] = x
        this.visY[n] = y
        n++
      }
    }
    this.visCount = n
    this.drawnEnemies = n
  }

  private drawEnemies(): void {
    const ctx = this.ctx
    const e = this.game.enemies
    const img = this.sprites.atlas.canvas
    const frames = this.sprites.enemy
    const flash = this.sprites.enemyFlash
    for (let k = 0; k < this.visCount; k++) {
      const s = this.visSlot[k]
      const f = e.flashT[s] > 0 ? flash[e.type[s]] : frames[e.type[s]]
      ctx.drawImage(img, f.sx, f.sy, f.sw, f.sh, this.visX[k] - f.w / 2, this.visY[k] - f.h / 2, f.w, f.h)
    }
  }

  /** Damaged enemies only. One path and one fill per colour band. */
  private drawHealthBars(): void {
    const ctx = this.ctx
    const e = this.game.enemies
    ctx.beginPath()
    let any = false
    for (let k = 0; k < this.visCount; k++) {
      const s = this.visSlot[k]
      if (e.hp[s] >= e.maxHp[s]) continue
      const r = ENEMIES[e.type[s]].radius
      ctx.rect(this.visX[k] - r - 1, this.visY[k] - r - 7, r * 2 + 2, 4)
      any = true
    }
    if (!any) return
    ctx.fillStyle = HP_BG
    ctx.fill()
    for (let band = 0; band < 3; band++) {
      ctx.beginPath()
      for (let k = 0; k < this.visCount; k++) {
        const s = this.visSlot[k]
        const frac = e.hp[s] / e.maxHp[s]
        if (frac >= 1 || hpBand(frac) !== band) continue
        const r = ENEMIES[e.type[s]].radius
        ctx.rect(this.visX[k] - r, this.visY[k] - r - 6, r * 2 * Math.max(0, frac), 2)
      }
      ctx.fillStyle = HP_COLOURS[band]
      ctx.fill()
    }
  }

  // -------------------------------------------------------- projectiles

  /** Bolt tracers: one glow stroke and one core stroke for all of them. */
  private drawProjectiles(alpha: number, v: Rect): void {
    const ctx = this.ctx
    const p = this.game.projectiles
    if (p.count === 0) return
    ctx.lineCap = 'round'
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath()
      for (let i = 0; i < p.count; i++) {
        const x = p.px[i] + (p.x[i] - p.px[i]) * alpha
        const y = p.py[i] + (p.y[i] - p.py[i]) * alpha
        if (x < v.x0 - 16 || x > v.x1 + 16 || y < v.y0 - 16 || y > v.y1 + 16) continue
        ctx.moveTo(x, y)
        ctx.lineTo(x - p.dx[i] * 9, y - p.dy[i] * 9)
      }
      if (pass === 0) {
        ctx.strokeStyle = 'rgba(120, 220, 255, 0.35)'
        ctx.lineWidth = 5
      } else {
        ctx.strokeStyle = '#effcff'
        ctx.lineWidth = 2
      }
      ctx.stroke()
    }
  }

  // ----------------------------------------------------------- overlays

  /** Range ring under the selected tower. */
  private drawSelection(): void {
    const i = this.controls.selectedTower()
    if (i < 0) return
    const t = this.game.towers
    this.drawRange(t.x[i], t.y[i], TOWERS[t.type[i]].range, true)
    const ctx = this.ctx
    ctx.strokeStyle = '#ffe28a'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(t.x[i] - 16, t.y[i] - 16, 32, 32, 8)
    ctx.stroke()
  }

  /** Ghost tower on the hovered tile while building: green if allowed, red if not. */
  private drawBuildPreview(): void {
    const type = this.controls.buildType
    if (type < 0 || !this.controls.hoverTile(this.hover)) return
    const tx = this.hover.x
    const ty = this.hover.y
    if (!this.game.map.inBounds(tx, ty)) return
    const ok = this.game.canPlace(type, tx, ty) === PlaceResult.Ok
    const ctx = this.ctx
    const x = (tx + 0.5) * TILE
    const y = (ty + 0.5) * TILE
    this.drawRange(x, y, TOWERS[type].range, ok)
    ctx.fillStyle = ok ? 'rgba(110, 230, 120, 0.28)' : 'rgba(240, 80, 70, 0.32)'
    ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE)
    ctx.globalAlpha = 0.6
    const img = this.sprites.atlas.canvas
    const b = this.sprites.towerBase
    const f = this.sprites.turret[type]
    ctx.drawImage(img, b.sx, b.sy, b.sw, b.sh, x - b.w / 2, y - b.h / 2, b.w, b.h)
    ctx.drawImage(img, f.sx, f.sy, f.sw, f.sh, x - f.w / 2, y - f.h / 2, f.w, f.h)
    ctx.globalAlpha = 1
  }

  private drawRange(x: number, y: number, r: number, ok: boolean): void {
    const ctx = this.ctx
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.fillStyle = ok ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 90, 80, 0.08)'
    ctx.fill()
    ctx.setLineDash(DASH)
    ctx.strokeStyle = ok ? 'rgba(255, 255, 255, 0.55)' : 'rgba(255, 120, 110, 0.6)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.setLineDash(NO_DASH)
  }

  /** Copies only the visible part of the pre-rendered map. */
  private drawBackground(v: Rect): void {
    const x0 = Math.max(0, Math.floor(v.x0))
    const y0 = Math.max(0, Math.floor(v.y0))
    const x1 = Math.min(WORLD_W, Math.ceil(v.x1))
    const y1 = Math.min(WORLD_H, Math.ceil(v.y1))
    if (x1 <= x0 || y1 <= y0) return
    const w = x1 - x0
    const h = y1 - y0
    this.ctx.drawImage(this.background, x0 * BG_SCALE, y0 * BG_SCALE, w * BG_SCALE, h * BG_SCALE, x0, y0, w, h)
  }

  private drawPortals(t: number, v: Rect): void {
    const ctx = this.ctx
    ctx.lineCap = 'round'
    for (let i = 0; i < this.portals.length; i++) {
      const [x, y] = this.portals[i]
      if (!visible(v, x, y, 48)) continue
      const pulse = 0.65 + 0.35 * Math.sin(t * 3 + i * 2)
      ctx.globalAlpha = pulse
      ctx.drawImage(this.portalGlow, x - 32, y - 32, 64, 64)
      ctx.globalAlpha = 1
      // Two counter-rotating arcs give the portal a swirl.
      ctx.lineWidth = 2.5
      ctx.strokeStyle = 'rgba(214, 170, 255, 0.9)'
      const a = t * 2.4 + i
      ctx.beginPath()
      ctx.arc(x, y, 8, a, a + 2.2)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(150, 90, 230, 0.9)'
      ctx.beginPath()
      ctx.arc(x, y, 5, -a * 1.4, -a * 1.4 + 2.6)
      ctx.stroke()
    }
  }

  /** The crystal core the player defends. */
  private drawBase(t: number, v: Rect): void {
    const [x, y] = this.base
    if (!visible(v, x, y, 80)) return
    const ctx = this.ctx
    const pulse = 0.75 + 0.25 * Math.sin(t * 2)
    ctx.globalAlpha = pulse
    ctx.drawImage(this.baseGlow, x - 48, y - 48, 96, 96)
    if (this.baseFlash > 0) {
      ctx.globalAlpha = this.baseFlash
      ctx.drawImage(this.hurtGlow, x - 64, y - 64, 128, 128)
    }
    ctx.globalAlpha = 1
    const bob = Math.sin(t * 1.6) * 1.5
    const top = y - 18 + bob
    const bottom = y + 12 + bob
    // Crystal: two facets for a simple lit look.
    ctx.fillStyle = '#3aa7d6'
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x - 11, y - 2 + bob)
    ctx.lineTo(x, bottom)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#8fe3ff'
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x + 11, y - 2 + bob)
    ctx.lineTo(x, bottom)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(230, 250, 255, 0.85)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
    ctx.stroke()
    // Orbiting motes.
    ctx.fillStyle = 'rgba(200, 245, 255, 0.9)'
    ctx.beginPath()
    for (let i = 0; i < 3; i++) {
      const a = t * 1.3 + (i * TAU) / 3
      const mx = x + Math.cos(a) * 20
      const my = y - 2 + Math.sin(a) * 8 + bob
      ctx.moveTo(mx + 2, my)
      ctx.arc(mx, my, 2, 0, TAU)
    }
    ctx.fill()
  }
}

function hpBand(frac: number): number {
  return frac > 0.6 ? 0 : frac > 0.3 ? 1 : 2
}

/** Interpolates between two angles along the shorter arc. */
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a
  d -= Math.round(d / TAU) * TAU
  return a + d * t
}

function visible(v: Rect, x: number, y: number, r: number): boolean {
  return x + r >= v.x0 && x - r <= v.x1 && y + r >= v.y0 && y - r <= v.y1
}

/** A soft radial glow, rendered once and reused every frame. */
function glowSprite(size: number, rgb: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size * 2
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(size, size, 0, size, size, size)
  grad.addColorStop(0, `rgba(${rgb}, 0.55)`)
  grad.addColorStop(0.4, `rgba(${rgb}, 0.22)`)
  grad.addColorStop(1, `rgba(${rgb}, 0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, size * 2, size * 2)
  return c
}
