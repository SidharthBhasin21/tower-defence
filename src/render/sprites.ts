import { ENEMIES, EnemyType, TowerType } from '../config.ts'
import { Atlas, type Frame } from './atlas.ts'

const TAU = Math.PI * 2

export interface Sprites {
  readonly atlas: Atlas
  /** One frame per enemy type, indexed by EnemyType. */
  readonly enemy: readonly Frame[]
  /** White-tinted copies shown for a moment after a hit. */
  readonly enemyFlash: readonly Frame[]
  /** Stone platform shared by every tower. */
  readonly towerBase: Frame
  /** Turret per tower type, pointing along +x; drawn rotated. */
  readonly turret: readonly Frame[]
}

/**
 * Draws every sprite into the atlas once at startup. Shapes are kept simple
 * until feature 10 adds directional frames and polish.
 */
export function buildSprites(): Sprites {
  const atlas = new Atlas()
  const enemy: Frame[] = []
  const enemyFlash: Frame[] = []
  const grunt = (ctx: CanvasRenderingContext2D): void => drawGrunt(ctx, ENEMIES[EnemyType.Grunt].radius)
  // Frames are kept tight around the body and shadow: every transparent pixel
  // in a frame is still filled by the GPU, thousands of times per frame.
  enemy[EnemyType.Grunt] = atlas.add(24, 24, grunt)
  enemyFlash[EnemyType.Grunt] = atlas.add(24, 24, (ctx) => flashed(ctx, 24, 24, grunt))

  const towerBase = atlas.add(30, 30, drawTowerBase)
  const turret: Frame[] = []
  turret[TowerType.Bolt] = atlas.add(30, 30, drawBoltTurret)
  return { atlas, enemy, enemyFlash, towerBase, turret }
}

/** Draws a sprite, then washes its own pixels (not the background) toward white. */
function flashed(ctx: CanvasRenderingContext2D, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
  draw(ctx)
  ctx.globalCompositeOperation = 'source-atop'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)'
  ctx.fillRect(-w / 2, -h / 2, w, h)
  ctx.globalCompositeOperation = 'source-over'
}

function drawGrunt(ctx: CanvasRenderingContext2D, r: number): void {
  // Ground shadow.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
  ctx.beginPath()
  ctx.ellipse(1, r * 0.75, r * 0.95, r * 0.4, 0, 0, TAU)
  ctx.fill()
  // Body.
  ctx.fillStyle = '#6d1f1c'
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#d4483f'
  ctx.beginPath()
  ctx.arc(0, 0, r - 1.6, 0, TAU)
  ctx.fill()
  // Top-left highlight.
  ctx.fillStyle = 'rgba(255, 190, 170, 0.45)'
  ctx.beginPath()
  ctx.arc(-r * 0.32, -r * 0.38, r * 0.38, 0, TAU)
  ctx.fill()
  // Eyes.
  ctx.fillStyle = '#fff4e0'
  ctx.beginPath()
  ctx.arc(-r * 0.32, -r * 0.05, r * 0.24, 0, TAU)
  ctx.arc(r * 0.32, -r * 0.05, r * 0.24, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#1a0d0c'
  ctx.beginPath()
  ctx.arc(-r * 0.28, 0, r * 0.12, 0, TAU)
  ctx.arc(r * 0.36, 0, r * 0.12, 0, TAU)
  ctx.fill()
}

function drawTowerBase(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
  ctx.beginPath()
  ctx.roundRect(-13, -11, 28, 28, 7)
  ctx.fill()
  ctx.fillStyle = '#3d454d'
  ctx.beginPath()
  ctx.roundRect(-14, -14, 28, 28, 7)
  ctx.fill()
  ctx.fillStyle = '#69737d'
  ctx.beginPath()
  ctx.roundRect(-12, -12, 24, 24, 5)
  ctx.fill()
  ctx.fillStyle = '#545d66'
  ctx.beginPath()
  ctx.arc(0, 0, 9, 0, TAU)
  ctx.fill()
  // Corner rivets.
  ctx.fillStyle = '#8e98a1'
  ctx.beginPath()
  for (const [x, y] of [[-8.5, -8.5], [8.5, -8.5], [-8.5, 8.5], [8.5, 8.5]]) {
    ctx.moveTo(x + 1.4, y)
    ctx.arc(x, y, 1.4, 0, TAU)
  }
  ctx.fill()
}

/** A twin-rail bolt thrower, pointing along +x. */
function drawBoltTurret(ctx: CanvasRenderingContext2D): void {
  // Rails.
  ctx.fillStyle = '#1f3d57'
  ctx.fillRect(0, -4.5, 13, 3)
  ctx.fillRect(0, 1.5, 13, 3)
  ctx.fillStyle = '#7fd4ff'
  ctx.fillRect(8, -4, 5, 2)
  ctx.fillRect(8, 2, 5, 2)
  // Housing.
  ctx.fillStyle = '#1f3d57'
  ctx.beginPath()
  ctx.arc(0, 0, 7.5, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#3f7fb0'
  ctx.beginPath()
  ctx.arc(0, 0, 6, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#9fe2ff'
  ctx.beginPath()
  ctx.arc(-1.5, -1.8, 2.2, 0, TAU)
  ctx.fill()
}
