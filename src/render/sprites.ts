import { ENEMIES, EnemyType } from '../config.ts'
import { Atlas, type Frame } from './atlas.ts'

const TAU = Math.PI * 2

export interface Sprites {
  readonly atlas: Atlas
  /** One frame per enemy type, indexed by EnemyType. */
  readonly enemy: readonly Frame[]
}

/**
 * Draws every sprite into the atlas once at startup. Shapes are kept simple
 * until feature 10 adds directional frames and polish.
 */
export function buildSprites(): Sprites {
  const atlas = new Atlas()
  const enemy: Frame[] = []
  enemy[EnemyType.Grunt] = atlas.add(30, 30, (ctx) => drawGrunt(ctx, ENEMIES[EnemyType.Grunt].radius))
  return { atlas, enemy }
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
