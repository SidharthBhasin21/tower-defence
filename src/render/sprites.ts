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
  // Frames are kept tight around the body and shadow: every transparent pixel
  // in a frame is still filled by the GPU, thousands of times per frame.
  const add = (type: number, size: number, draw: (ctx: CanvasRenderingContext2D, r: number) => void): void => {
    const r = ENEMIES[type].radius
    const fn = (ctx: CanvasRenderingContext2D): void => draw(ctx, r)
    enemy[type] = atlas.add(size, size, fn)
    enemyFlash[type] = atlas.add(size, size, (ctx) => flashed(ctx, size, size, fn))
  }
  add(EnemyType.Grunt, 24, drawGrunt)
  add(EnemyType.Runner, 20, drawRunner)
  add(EnemyType.Swarmling, 14, drawSwarmling)
  add(EnemyType.Brute, 32, drawBrute)
  add(EnemyType.Wisp, 22, drawWisp) // flyer: its shadow is drawn separately on the ground
  add(EnemyType.Mender, 24, drawMender)
  add(EnemyType.Warlord, 44, drawWarlord)

  const towerBase = atlas.add(30, 30, drawTowerBase)
  const turret: Frame[] = []
  turret[TowerType.Bolt] = atlas.add(30, 30, drawBoltTurret)
  turret[TowerType.Cannon] = atlas.add(34, 30, drawCannonTurret)
  turret[TowerType.Frost] = atlas.add(30, 30, drawFrostTurret)
  turret[TowerType.Arc] = atlas.add(30, 30, drawArcTurret)
  turret[TowerType.Sniper] = atlas.add(40, 30, drawSniperTurret)
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

function shadow(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
  ctx.beginPath()
  ctx.ellipse(1, r * 0.75, r * 0.95, r * 0.4, 0, 0, TAU)
  ctx.fill()
}

/** Round body: dark rim, main colour, top-left highlight. */
function body(ctx: CanvasRenderingContext2D, r: number, rim: string, fill: string, shine: string): void {
  ctx.fillStyle = rim
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, TAU)
  ctx.fill()
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.arc(0, 0, r - Math.max(1.2, r * 0.16), 0, TAU)
  ctx.fill()
  ctx.fillStyle = shine
  ctx.beginPath()
  ctx.arc(-r * 0.32, -r * 0.38, r * 0.38, 0, TAU)
  ctx.fill()
}

function eyes(ctx: CanvasRenderingContext2D, r: number, white = '#fff4e0', pupil = '#1a0d0c'): void {
  ctx.fillStyle = white
  ctx.beginPath()
  ctx.arc(-r * 0.32, -r * 0.05, r * 0.24, 0, TAU)
  ctx.arc(r * 0.32, -r * 0.05, r * 0.24, 0, TAU)
  ctx.fill()
  ctx.fillStyle = pupil
  ctx.beginPath()
  ctx.arc(-r * 0.28, 0, r * 0.12, 0, TAU)
  ctx.arc(r * 0.36, 0, r * 0.12, 0, TAU)
  ctx.fill()
}

function drawGrunt(ctx: CanvasRenderingContext2D, r: number): void {
  shadow(ctx, r)
  body(ctx, r, '#6d1f1c', '#d4483f', 'rgba(255, 190, 170, 0.45)')
  eyes(ctx, r)
}

/** Lean and quick: amber, with swept-back ears. */
function drawRunner(ctx: CanvasRenderingContext2D, r: number): void {
  shadow(ctx, r)
  ctx.fillStyle = '#7a4a10'
  ctx.beginPath()
  ctx.moveTo(-r * 0.9, -r * 0.4)
  ctx.lineTo(-r * 1.25, -r * 1.05)
  ctx.lineTo(-r * 0.2, -r * 0.8)
  ctx.moveTo(r * 0.9, -r * 0.4)
  ctx.lineTo(r * 1.25, -r * 1.05)
  ctx.lineTo(r * 0.2, -r * 0.8)
  ctx.fill()
  body(ctx, r, '#7a4a10', '#f0a531', 'rgba(255, 236, 180, 0.5)')
  eyes(ctx, r)
}

/** Small, dark and numerous: a teal beetle. */
function drawSwarmling(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)'
  ctx.beginPath()
  ctx.ellipse(0.5, r * 0.7, r, r * 0.4, 0, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = '#123c3a'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (const sx of [-1, 1]) {
    ctx.moveTo(sx * r * 0.6, -r * 0.3)
    ctx.lineTo(sx * r * 1.1, -r * 0.6)
    ctx.moveTo(sx * r * 0.7, r * 0.3)
    ctx.lineTo(sx * r * 1.15, r * 0.55)
  }
  ctx.stroke()
  body(ctx, r, '#123c3a', '#2fa39a', 'rgba(190, 255, 245, 0.45)')
  ctx.fillStyle = '#e9fffb'
  ctx.beginPath()
  ctx.arc(-r * 0.3, -r * 0.1, r * 0.2, 0, TAU)
  ctx.arc(r * 0.3, -r * 0.1, r * 0.2, 0, TAU)
  ctx.fill()
}

/** Heavy and armored: steel plates over a dark body, small red eyes. */
function drawBrute(ctx: CanvasRenderingContext2D, r: number): void {
  shadow(ctx, r)
  body(ctx, r, '#2a2d33', '#5b616b', 'rgba(220, 230, 240, 0.35)')
  // Plates.
  ctx.strokeStyle = '#2a2d33'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.62, Math.PI * 1.1, Math.PI * 1.9)
  ctx.moveTo(-r * 0.75, r * 0.15)
  ctx.lineTo(r * 0.75, r * 0.15)
  ctx.stroke()
  ctx.fillStyle = '#a7aeb8'
  ctx.beginPath()
  for (const [x, y] of [[-0.55, 0.45], [0, 0.55], [0.55, 0.45]]) {
    ctx.moveTo(x * r + 1.4, y * r)
    ctx.arc(x * r, y * r, 1.4, 0, TAU)
  }
  ctx.fill()
  // Horns.
  ctx.fillStyle = '#e8dcc0'
  ctx.beginPath()
  ctx.moveTo(-r * 0.7, -r * 0.55)
  ctx.lineTo(-r * 1.05, -r * 1.1)
  ctx.lineTo(-r * 0.35, -r * 0.8)
  ctx.moveTo(r * 0.7, -r * 0.55)
  ctx.lineTo(r * 1.05, -r * 1.1)
  ctx.lineTo(r * 0.35, -r * 0.8)
  ctx.fill()
  ctx.fillStyle = '#ff5a4a'
  ctx.beginPath()
  ctx.arc(-r * 0.28, -r * 0.2, r * 0.11, 0, TAU)
  ctx.arc(r * 0.28, -r * 0.2, r * 0.11, 0, TAU)
  ctx.fill()
}

/** A floating spirit: pale glow, bright core and little wings. */
function drawWisp(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.fillStyle = 'rgba(150, 230, 255, 0.25)'
  ctx.beginPath()
  ctx.arc(0, 0, r * 1.15, 0, TAU)
  ctx.fill()
  ctx.fillStyle = 'rgba(210, 245, 255, 0.85)'
  ctx.beginPath()
  ctx.ellipse(-r * 0.75, -r * 0.1, r * 0.55, r * 0.28, -0.5, 0, TAU)
  ctx.ellipse(r * 0.75, -r * 0.1, r * 0.55, r * 0.28, 0.5, 0, TAU)
  ctx.fill()
  body(ctx, r * 0.72, '#3b8fb3', '#9fe4ff', 'rgba(255, 255, 255, 0.7)')
  eyes(ctx, r * 0.72, '#ffffff', '#1d4e66')
}

/** A healer: green, with a white cross. */
function drawMender(ctx: CanvasRenderingContext2D, r: number): void {
  shadow(ctx, r)
  body(ctx, r, '#1f5a2b', '#4fbf5f', 'rgba(220, 255, 220, 0.45)')
  ctx.fillStyle = '#f4fff4'
  ctx.fillRect(-r * 0.16, -r * 0.62, r * 0.32, r * 0.7)
  ctx.fillRect(-r * 0.4, -r * 0.43, r * 0.8, r * 0.32)
  ctx.fillStyle = '#10301a'
  ctx.beginPath()
  ctx.arc(-r * 0.3, r * 0.32, r * 0.11, 0, TAU)
  ctx.arc(r * 0.3, r * 0.32, r * 0.11, 0, TAU)
  ctx.fill()
}

/** The boss: big, dark violet, a gold crown and glowing eyes. */
function drawWarlord(ctx: CanvasRenderingContext2D, r: number): void {
  shadow(ctx, r)
  body(ctx, r, '#22102e', '#5e2a7a', 'rgba(220, 180, 255, 0.3)')
  ctx.strokeStyle = 'rgba(255, 210, 120, 0.55)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.8, 0, TAU)
  ctx.stroke()
  // Crown.
  ctx.fillStyle = '#f2c14e'
  ctx.beginPath()
  ctx.moveTo(-r * 0.55, -r * 0.45)
  for (let k = 0; k <= 4; k++) {
    const x = -r * 0.55 + (k * r * 1.1) / 4
    ctx.lineTo(x, k % 2 ? -r * 0.62 : -r * 0.98)
  }
  ctx.lineTo(r * 0.55, -r * 0.45)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#ff4d6d'
  ctx.beginPath()
  ctx.arc(0, -r * 0.6, r * 0.07, 0, TAU)
  ctx.fill()
  // Eyes.
  ctx.fillStyle = '#ffe066'
  ctx.beginPath()
  ctx.ellipse(-r * 0.3, -r * 0.05, r * 0.16, r * 0.1, 0.3, 0, TAU)
  ctx.ellipse(r * 0.3, -r * 0.05, r * 0.16, r * 0.1, -0.3, 0, TAU)
  ctx.fill()
  // Fangs.
  ctx.fillStyle = '#f5ecdc'
  ctx.beginPath()
  ctx.moveTo(-r * 0.25, r * 0.35)
  ctx.lineTo(-r * 0.15, r * 0.6)
  ctx.lineTo(-r * 0.05, r * 0.35)
  ctx.moveTo(r * 0.05, r * 0.35)
  ctx.lineTo(r * 0.15, r * 0.6)
  ctx.lineTo(r * 0.25, r * 0.35)
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

/** A stubby mortar barrel on a bronze housing, pointing along +x. */
function drawCannonTurret(ctx: CanvasRenderingContext2D): void {
  // Barrel.
  ctx.fillStyle = '#2b2c31'
  ctx.beginPath()
  ctx.roundRect(0, -4.5, 15, 9, 2)
  ctx.fill()
  ctx.fillStyle = '#4a4c54'
  ctx.fillRect(1, -3, 12, 2.5)
  ctx.fillStyle = '#1a1b1f'
  ctx.beginPath()
  ctx.roundRect(12.5, -5.5, 3.5, 11, 1.5)
  ctx.fill()
  // Housing.
  ctx.fillStyle = '#5a4630'
  ctx.beginPath()
  ctx.arc(0, 0, 8.5, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#9a7b4f'
  ctx.beginPath()
  ctx.arc(0, 0, 7, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#d9b77a'
  ctx.beginPath()
  ctx.arc(-2, -2.2, 2.6, 0, TAU)
  ctx.fill()
}

/** An ice crystal cluster; it has no turret to aim, so it's drawn upright. */
function drawFrostTurret(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#1d4a66'
  ctx.beginPath()
  ctx.arc(0, 0, 8.5, 0, TAU)
  ctx.fill()
  // Shards around a central crystal (the sprite is drawn rotated -90°, so +x is up).
  const shard = (a: number, len: number, w: number, fill: string): void => {
    const c = Math.cos(a)
    const s = Math.sin(a)
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.moveTo(c * len, s * len)
    ctx.lineTo(-s * w, c * w)
    ctx.lineTo(-c * 2, -s * 2)
    ctx.lineTo(s * w, -c * w)
    ctx.closePath()
    ctx.fill()
  }
  for (let k = 0; k < 6; k++) shard((k / 6) * TAU + 0.5, 11, 2.6, k % 2 ? '#7fcff5' : '#a8e4ff')
  shard(0, 13, 3.4, '#e6f8ff')
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(0, 0, 2.6, 0, TAU)
  ctx.fill()
}

/** A tesla coil seen from above: stacked rings and a bright tip. */
function drawArcTurret(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#2b2350'
  ctx.beginPath()
  ctx.arc(0, 0, 9.5, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = '#b79bff'
  ctx.lineWidth = 1.6
  for (const r of [8, 5.5]) {
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, TAU)
    ctx.stroke()
  }
  ctx.fillStyle = '#6a52c4'
  ctx.beginPath()
  ctx.arc(0, 0, 4, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#f6efff'
  ctx.beginPath()
  ctx.arc(0, 0, 2.4, 0, TAU)
  ctx.fill()
  // Four contact studs.
  ctx.fillStyle = '#ffe27a'
  ctx.beginPath()
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4
    ctx.moveTo(Math.cos(a) * 8 + 1.3, Math.sin(a) * 8)
    ctx.arc(Math.cos(a) * 8, Math.sin(a) * 8, 1.3, 0, TAU)
  }
  ctx.fill()
}

/** A long rifle with a scope, pointing along +x. */
function drawSniperTurret(ctx: CanvasRenderingContext2D): void {
  // Barrel.
  ctx.fillStyle = '#25291c'
  ctx.fillRect(0, -1.8, 19, 3.6)
  ctx.fillStyle = '#1a1d14'
  ctx.fillRect(17, -2.6, 3, 5.2)
  // Housing.
  ctx.fillStyle = '#3c4a28'
  ctx.beginPath()
  ctx.roundRect(-8, -6.5, 14, 13, 4)
  ctx.fill()
  ctx.fillStyle = '#6b7f45'
  ctx.beginPath()
  ctx.roundRect(-6.5, -5, 11, 10, 3)
  ctx.fill()
  // Scope.
  ctx.fillStyle = '#15180f'
  ctx.fillRect(-3, -1.4, 10, 2.8)
  ctx.fillStyle = '#ff6a5a'
  ctx.beginPath()
  ctx.arc(7, 0, 1.3, 0, TAU)
  ctx.fill()
}
