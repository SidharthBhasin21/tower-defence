import { DT, WORLD_H, WORLD_W } from '../config.ts'
import type { Game } from '../sim/game.ts'
import { BG_SCALE, baseCentre, portalPositions, renderBackground } from './background.ts'
import type { Camera, Rect } from './camera.ts'
import { buildSprites, type Sprites } from './sprites.ts'

/** Colour drawn outside the map. */
const VOID = '#0b130e'
const TAU = Math.PI * 2

/**
 * Canvas 2D renderer (ARCHITECTURE.md §5). Applies the camera once per frame
 * and draws in world coordinates. Draws only what the camera can see.
 */
export class Renderer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly camera: Camera
  private readonly game: Game
  private readonly background: HTMLCanvasElement
  private readonly portalGlow: HTMLCanvasElement
  private readonly baseGlow: HTMLCanvasElement
  private readonly hurtGlow: HTMLCanvasElement
  private readonly sprites: Sprites
  private readonly portals: readonly (readonly [number, number])[]
  private readonly base: readonly [number, number]
  private readonly view: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 }
  private dpr = 1
  /** Red flash on the base after a leak, fading from 1 to 0 in real time. */
  private baseFlash = 0
  /** Enemies drawn last frame (for the debug readout). */
  drawnEnemies = 0

  constructor(canvas: HTMLCanvasElement, camera: Camera, game: Game) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Canvas 2D is not supported')
    this.canvas = canvas
    this.ctx = ctx
    this.camera = camera
    this.game = game
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
    const s = camera.zoom * dpr
    ctx.setTransform(s, 0, 0, s, (camera.viewW / 2 - camera.x * camera.zoom) * dpr, (camera.viewH / 2 - camera.y * camera.zoom) * dpr)
    const v = camera.viewRect(this.view)

    this.drawBackground(v)
    this.drawPortals(t, v)
    // Enemies before the base, so they walk into it rather than over it.
    this.drawEnemies(alpha, t, v)
    this.drawBase(t, v)
    this.baseFlash = Math.max(0, this.baseFlash - realDt * 2.5)
  }

  /**
   * Ground enemies, interpolated between the last two steps.
   * Culled by bounds check for now; feature 3 switches to grid-based culling.
   */
  private drawEnemies(alpha: number, t: number, v: Rect): void {
    const ctx = this.ctx
    const e = this.game.enemies
    const img = this.sprites.atlas.canvas
    const frames = this.sprites.enemy
    const active = e.active
    let drawn = 0
    for (let k = 0; k < e.count; k++) {
      const s = active[k]
      if (!e.alive[s]) continue
      const f = frames[e.type[s]]
      const hw = f.w / 2
      const hh = f.h / 2
      const x = e.px[s] + (e.x[s] - e.px[s]) * alpha
      // Small walking bob, phase-shifted per slot so the crowd doesn't move in lockstep.
      const y = e.py[s] + (e.y[s] - e.py[s]) * alpha - Math.abs(Math.sin(t * 9 + s * 1.7)) * 1.5
      if (x + hw < v.x0 || x - hw > v.x1 || y + hh < v.y0 || y - hh > v.y1) continue
      ctx.drawImage(img, f.sx, f.sy, f.sw, f.sh, x - hw, y - hh, f.w, f.h)
      drawn++
    }
    this.drawnEnemies = drawn
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
