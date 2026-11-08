/**
 * Tunable constants. Gameplay numbers live here so balance changes touch one
 * file (see DOMAIN.md §2 for the rules these encode).
 */

// ---- Simulation timing (ARCHITECTURE.md §3) ----

/** Fixed simulation step, in seconds. */
export const DT = 1 / 60
/** Longest real frame time fed to the accumulator; longer gaps are dropped. */
export const MAX_FRAME_DT = 0.1
/** Upper bound on simulation steps run in one rendered frame. */
export const MAX_STEPS_PER_FRAME = 16
/** Selectable game speeds (steps per DT of real time). */
export const GAME_SPEEDS = [1, 2, 4] as const

// ---- World ----

/** Tile edge, in world pixels. */
export const TILE = 32
/** Map size, in tiles. */
export const MAP_W = 40
export const MAP_H = 24
/** Map size, in world pixels. */
export const WORLD_W = MAP_W * TILE
export const WORLD_H = MAP_H * TILE
/** Seed for map scenery placement, so the map is identical every run. */
export const MAP_SEED = 0x7d2a91

// ---- Paths ----

/** Spacing of path lookup samples, in world px. */
export const PATH_SAMPLE_STEP = 2
/** Corner rounding for ground paths, in world px (must exceed LANE_MAX). */
export const GROUND_CORNER_RADIUS = 16
/** Corner rounding for the air route, in world px. */
export const AIR_CORNER_RADIUS = 120
/** Max sideways offset of an enemy from the path centre line, in world px. */
export const LANE_MAX = 8
/** Enemies reach the base this far before the end of their path, in world px. */
export const BASE_REACH = 22

// ---- Player ----

export const START_LIVES = 20
export const START_GOLD = 200
/** Score per gold of kill bounty, before wave scaling. */
export const SCORE_PER_BOUNTY = 10
/** Kill score grows by this fraction per wave (wave 1 = ×1). */
export const SCORE_WAVE_SCALE = 0.05
/** Score per life left when the game is won. */
export const WIN_SCORE_PER_LIFE = 500

// ---- Waves (DOMAIN.md §2.5) ----

export const WAVE_COUNT = 50
/** Seconds between the last spawn of a wave and the next wave starting (tuned). */
export const WAVE_GAP = 20
/** Gold per second left on the countdown when the next wave is called early (tuned). */
export const EARLY_GOLD_PER_SEC = 1
/** Score per second left on the countdown when calling early. */
export const EARLY_SCORE_PER_SEC = 10
/** Wave-clear gold: base plus this much per wave number (tuned). */
export const CLEAR_GOLD_BASE = 20
export const CLEAR_GOLD_PER_WAVE = 2
/** Wave-clear score per wave number. */
export const CLEAR_SCORE_PER_WAVE = 100
/** Most spawn groups running at once (overlapping waves share this). */
export const MAX_SPAWN_GROUPS = 64

// ---- Combat ----

/** A hit always does at least this fraction of its damage, however high the armor. */
export const ARMOR_MIN_FRACTION = 0.2
/** Seconds an enemy flashes white after a hit. */
export const HIT_FLASH = 0.08

// ---- Spatial grid (ARCHITECTURE.md §4.3) ----

/** Grid cell edge, in world px. */
export const GRID_CELL = 64
/** Extra world space the grid covers past each map edge, in world px. */
export const GRID_MARGIN = 64

// ---- Towers (DOMAIN.md §2.3) ----

export const MAX_TOWERS = 256
/** Towers re-pick their target at most this often (in steps), or when it's lost. */
export const RETARGET_STEPS = 6
/** A turret fires only when aimed within this angle of its target, in radians. */
export const AIM_TOLERANCE = 0.3

export const TowerType = {
  Bolt: 0,
} as const
export type TowerTypeId = (typeof TowerType)[keyof typeof TowerType]

export interface TowerDef {
  readonly name: string
  /** Hotkey shown in the UI (1–5). */
  readonly key: string
  readonly cost: number
  /** Range from the tower centre, in world px. */
  readonly range: number
  /** Shots per second. */
  readonly fireRate: number
  readonly damage: number
  /** Projectile speed, in world px per second. */
  readonly projectileSpeed: number
  readonly hitsAir: boolean
  /** Turret turn speed, in radians per second. */
  readonly turnRate: number
}

/** Indexed by TowerType. Values are starting points (tuned). */
export const TOWERS: readonly TowerDef[] = [
  { name: 'Bolt', key: '1', cost: 50, range: 110, fireRate: 2.5, damage: 12, projectileSpeed: 560, hitsAir: true, turnRate: 14 },
]

// ---- Projectiles ----

export const MAX_PROJECTILES = 4096
/** Seconds a projectile may fly before it fizzles. */
export const PROJECTILE_LIFE = 1.5
/** Once its target is gone, a projectile flies on for at most this long, in seconds. */
export const ORPHAN_LIFE = 0.25
/** Extra hit radius for projectiles, in world px. */
export const PROJECTILE_RADIUS = 3

// ---- Enemies (DOMAIN.md §2.4) ----

/** Pool capacity (ARCHITECTURE.md §4.1). */
export const MAX_ENEMIES = 8192

export const EnemyType = {
  Grunt: 0,
} as const
export type EnemyTypeId = (typeof EnemyType)[keyof typeof EnemyType]

export interface EnemyDef {
  readonly name: string
  /** Base health before wave scaling. */
  readonly hp: number
  /** Movement speed, in world px per second. */
  readonly speed: number
  /** Flat damage reduction per hit. */
  readonly armor: number
  /** Gold for a kill. */
  readonly bounty: number
  /** Lives lost when it reaches the base. */
  readonly leak: number
  /** Body radius, in world px (drawing and hit tests). */
  readonly radius: number
  readonly air: boolean
}

/** Indexed by EnemyType. Values are starting points (tuned). */
export const ENEMIES: readonly EnemyDef[] = [
  { name: 'Grunt', hp: 40, speed: 44, armor: 0, bounty: 4, leak: 1, radius: 10, air: false },
]

/** Largest enemy radius; grid queries are widened by it so edge contact counts. */
export const MAX_ENEMY_RADIUS = Math.max(...ENEMIES.map((d) => d.radius))

// ---- Camera ----

/** Zoom limits. The minimum is lowered further if needed to fit the whole map. */
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2.5
/** Screen-space padding kept around the map when fitting it to the view, in CSS px. */
export const FIT_PADDING = 24
/** Keyboard pan speed, in CSS px per second (independent of zoom). */
export const KEY_PAN_SPEED = 900
