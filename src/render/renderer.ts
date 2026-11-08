import { DT, ENEMIES, EnemyType, MAX_ENEMIES, SHELL_ARC, TILE, TOWERS, WORLD_H, WORLD_W, towerStats } from '../config.ts'
import { BeamKind, RingKind } from '../sim/fx.ts'
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
/** Flyers are drawn this far above their ground position, in world px. */
const AIR_LIFT = 12

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
  readonly sprites: Sprites
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
  /** Enemies drawn last frame (for the perf overlay and benchmark). */
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
    this.drawEffects(alpha, v)
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
    this.drawLevelPips(v)
  }

  /** Gold pips along the bottom of upgraded towers: one fill for all of them. */
  private drawLevelPips(v: Rect): void {
    const ctx = this.ctx
    const t = this.game.towers
    let any = false
    ctx.beginPath()
    for (let i = 0; i < t.count; i++) {
      const lv = t.level[i]
      if (lv < 2) continue
      const x = t.x[i]
      const y = t.y[i] + 12
      if (x + TILE < v.x0 || x - TILE > v.x1 || y + TILE < v.y0 || y - TILE > v.y1) continue
      for (let k = 0; k < lv; k++) {
        const px = x + (k - (lv - 1) / 2) * 5
        ctx.moveTo(px + 1.8, y)
        ctx.arc(px, y, 1.8, 0, TAU)
      }
      any = true
    }
    if (!any) return
    ctx.fillStyle = '#ffd864'
    ctx.strokeStyle = 'rgba(40, 28, 0, 0.8)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fill()
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
        const def = ENEMIES[e.type[s]]
        const r = def.radius + 6 + (def.air ? AIR_LIFT : 0)
        const x = e.px[s] + (e.x[s] - e.px[s]) * alpha
        // Small walking bob (or a slow hover for flyers), phase-shifted per slot so the crowd doesn't move in lockstep.
        const y =
          e.py[s] + (e.y[s] - e.py[s]) * alpha -
          (def.air ? AIR_LIFT + Math.sin(t * 3 + s * 1.7) * 2 : Math.abs(Math.sin(t * 9 + s * 1.7)) * 1.5)
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

  /**
   * Draw order (ARCHITECTURE.md §5.3): ground enemies, then bosses on top,
   * then flyer shadows (one fill) and flyers above everything on the ground.
   */
  private drawEnemies(): void {
    const ctx = this.ctx
    const e = this.game.enemies
    const img = this.sprites.atlas.canvas
    const frames = this.sprites.enemy
    const flash = this.sprites.enemyFlash
    let bosses = 0
    let flyers = 0
    for (let k = 0; k < this.visCount; k++) {
      const s = this.visSlot[k]
      const type = e.type[s]
      if (type === EnemyType.Warlord) {
        bosses++
        continue
      }
      if (ENEMIES[type].air) {
        flyers++
        continue
      }
      const f = e.flashT[s] > 0 ? flash[type] : frames[type]
      ctx.drawImage(img, f.sx, f.sy, f.sw, f.sh, this.visX[k] - f.w / 2, this.visY[k] - f.h / 2, f.w, f.h)
    }
    if (bosses > 0) {
      for (let k = 0; k < this.visCount; k++) {
        const s = this.visSlot[k]
        if (e.type[s] !== EnemyType.Warlord) continue
        const f = e.flashT[s] > 0 ? flash[EnemyType.Warlord] : frames[EnemyType.Warlord]
        ctx.drawImage(img, f.sx, f.sy, f.sw, f.sh, this.visX[k] - f.w / 2, this.visY[k] - f.h / 2, f.w, f.h)
      }
    }
    if (flyers === 0) return
    ctx.beginPath()
    for (let k = 0; k < this.visCount; k++) {
      const s = this.visSlot[k]
      const def = ENEMIES[e.type[s]]
      if (!def.air) continue
      const gy = this.visY[k] + AIR_LIFT + def.radius * 0.6
      ctx.moveTo(this.visX[k] + def.radius * 0.8, gy)
      ctx.ellipse(this.visX[k], gy, def.radius * 0.8, def.radius * 0.35, 0, 0, TAU)
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
    ctx.fill()
    for (let k = 0; k < this.visCount; k++) {
      const s = this.visSlot[k]
      const type = e.type[s]
      if (!ENEMIES[type].air) continue
      const f = e.flashT[s] > 0 ? flash[type] : frames[type]
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

  /**
   * Bolt tracers: one glow stroke and one core stroke for all of them. Cannon
   * shells: one fill for all shadows, one for all shells, raised on an arc.
   */
  private drawProjectiles(alpha: number, v: Rect): void {
    const ctx = this.ctx
    const p = this.game.projectiles
    if (p.count === 0) return
    let shells = 0
    ctx.lineCap = 'round'
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath()
      for (let i = 0; i < p.count; i++) {
        if (p.splash[i] > 0) {
          shells++
          continue
        }
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
    if (shells === 0) return
    // Pass 0: ground shadows. Pass 1: the shells, lifted by their arc.
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath()
      for (let i = 0; i < p.count; i++) {
        if (p.splash[i] === 0) continue
        const x = p.px[i] + (p.x[i] - p.px[i]) * alpha
        const y = p.py[i] + (p.y[i] - p.py[i]) * alpha
        if (x < v.x0 - 40 || x > v.x1 + 40 || y < v.y0 - 40 || y > v.y1 + 40) continue
        const u = Math.min(1, Math.max(0, 1 - (p.life[i] - alpha * DT) / p.flight[i]))
        if (pass === 0) {
          ctx.moveTo(x + 4, y)
          ctx.ellipse(x, y, 4, 2.2, 0, 0, TAU)
        } else {
          const z = 4 * SHELL_ARC * u * (1 - u)
          ctx.moveTo(x + 4.2, y - z)
          ctx.arc(x, y - z, 4.2, 0, TAU)
        }
      }
      ctx.fillStyle = pass === 0 ? 'rgba(0, 0, 0, 0.3)' : '#22242a'
      ctx.fill()
    }
  }

  // ------------------------------------------------------------ effects

  /**
   * Lightning, sniper tracers, frost pulses and explosions. Arc beams are all
   * one path (stroked twice); the few tracers and rings fade individually.
   */
  private drawEffects(alpha: number, v: Rect): void {
    const ctx = this.ctx
    const b = this.game.beams
    const r = this.game.rings
    const tick = this.game.tick
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // Rings first, so beams sit on top.
    for (let i = 0; i < r.count; i++) {
      const R = r.radius[i]
      if (r.x[i] + R < v.x0 || r.x[i] - R > v.x1 || r.y[i] + R < v.y0 || r.y[i] - R > v.y1) continue
      const left = Math.max(0, r.life[i] - alpha * DT) / r.maxLife[i]
      const u = 1 - left
      ctx.beginPath()
      if (r.kind[i] === RingKind.Heal) {
        ctx.arc(r.x[i], r.y[i], R * (0.3 + 0.7 * u), 0, TAU)
        ctx.globalAlpha = left
        ctx.fillStyle = 'rgba(110, 230, 120, 0.12)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(170, 255, 170, 0.8)'
        ctx.lineWidth = 1.5
        ctx.stroke()
      } else if (r.kind[i] === RingKind.Frost) {
        ctx.arc(r.x[i], r.y[i], R * (0.25 + 0.75 * u), 0, TAU)
        ctx.globalAlpha = left
        ctx.fillStyle = 'rgba(150, 215, 255, 0.12)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(200, 240, 255, 0.85)'
        ctx.lineWidth = 2
        ctx.stroke()
      } else {
        ctx.arc(r.x[i], r.y[i], R * (0.45 + 0.55 * Math.sqrt(u)), 0, TAU)
        ctx.globalAlpha = left * left
        ctx.fillStyle = 'rgba(255, 170, 70, 0.45)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(255, 225, 150, 0.9)'
        ctx.lineWidth = 2.5
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
    if (b.count === 0) return

    // Arc lightning: jagged lines, re-shaped every few steps so it flickers.
    const flick = tick >> 2
    for (let pass = 0; pass < 2; pass++) {
      let any = false
      ctx.beginPath()
      for (let i = 0; i < b.count; i++) {
        if (b.kind[i] !== BeamKind.Arc || !this.beamVisible(i, v)) continue
        any = true
        const x1 = b.x1[i]
        const y1 = b.y1[i]
        const dx = b.x2[i] - x1
        const dy = b.y2[i] - y1
        const len = Math.hypot(dx, dy) || 1
        const nx = -dy / len
        const ny = dx / len
        ctx.moveTo(x1, y1)
        for (let k = 1; k < 5; k++) {
          const j = (jitter(b.seed[i] + flick * 31 + k * 7) - 0.5) * Math.min(14, len * 0.3)
          ctx.lineTo(x1 + (dx * k) / 5 + nx * j, y1 + (dy * k) / 5 + ny * j)
        }
        ctx.lineTo(b.x2[i], b.y2[i])
      }
      if (!any) break
      ctx.strokeStyle = pass === 0 ? 'rgba(160, 130, 255, 0.45)' : '#f7f2ff'
      ctx.lineWidth = pass === 0 ? 5 : 1.6
      ctx.stroke()
    }

    // Sniper tracers fade out.
    for (let i = 0; i < b.count; i++) {
      if (b.kind[i] !== BeamKind.Sniper || !this.beamVisible(i, v)) continue
      const left = Math.max(0, b.life[i] - alpha * DT) / b.maxLife[i]
      ctx.globalAlpha = left
      ctx.beginPath()
      ctx.moveTo(b.x1[i], b.y1[i])
      ctx.lineTo(b.x2[i], b.y2[i])
      ctx.strokeStyle = 'rgba(255, 210, 140, 0.4)'
      ctx.lineWidth = 5
      ctx.stroke()
      ctx.strokeStyle = '#fff6e0'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  private beamVisible(i: number, v: Rect): boolean {
    const b = this.game.beams
    const x0 = Math.min(b.x1[i], b.x2[i])
    const x1 = Math.max(b.x1[i], b.x2[i])
    const y0 = Math.min(b.y1[i], b.y2[i])
    const y1 = Math.max(b.y1[i], b.y2[i])
    return !(x1 + 16 < v.x0 || x0 - 16 > v.x1 || y1 + 16 < v.y0 || y0 - 16 > v.y1)
  }

  // ----------------------------------------------------------- overlays

  /** Range ring under the selected tower. */
  private drawSelection(): void {
    const i = this.controls.selectedTower()
    if (i < 0) return
    const t = this.game.towers
    this.drawRange(t.x[i], t.y[i], towerStats(t.type[i], t.level[i]).range, true)
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

/** Cheap deterministic hash to [0, 1), for lightning shapes. */
function jitter(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
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
