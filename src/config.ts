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
  Cannon: 1,
  Frost: 2,
  Arc: 3,
  Sniper: 4,
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
  /** Projectile speed, in world px per second; 0 = the attack lands instantly. */
  readonly projectileSpeed: number
  readonly hitsAir: boolean
  /** Turret turn speed, in radians per second; 0 = no turret to aim (fires all round). */
  readonly turnRate: number
  /** Splash radius around the impact, in world px (0 = single target). */
  readonly splash: number
  /** Speed multiplier applied by a hit (1 = no slow), and how long it lasts (s). */
  readonly slow: number
  readonly slowTime: number
  /** Extra enemies a hit jumps to, the jump range (px) and damage kept per jump. */
  readonly chains: number
  readonly chainRange: number
  readonly chainFalloff: number
  /** How armor applies to this tower's hits. */
  readonly armor: ArmorModeId
  /** One-line description for the UI. */
  readonly blurb: string
}

/** How a hit treats armor (DOMAIN.md §2.4). */
export const ArmorMode = {
  Full: 0,
  /** Arc: armor counts for half. */
  Half: 1,
  /** Sniper: armor is ignored. */
  Ignore: 2,
} as const
export type ArmorModeId = (typeof ArmorMode)[keyof typeof ArmorMode]

const NO_EXTRAS = { splash: 0, slow: 1, slowTime: 0, chains: 0, chainRange: 0, chainFalloff: 1, armor: ArmorMode.Full } as const

/** Indexed by TowerType. Values are starting points (tuned in feature 11). */
export const TOWERS: readonly TowerDef[] = [
  {
    ...NO_EXTRAS,
    name: 'Bolt', key: '1', cost: 50, range: 110, fireRate: 2.5, damage: 12, projectileSpeed: 560, hitsAir: true, turnRate: 14,
    blurb: 'Fast, cheap single shots. Hits air. Weak against armor.',
  },
  {
    ...NO_EXTRAS,
    name: 'Cannon', key: '2', cost: 90, range: 125, fireRate: 0.8, damage: 34, projectileSpeed: 270, hitsAir: false, turnRate: 6,
    splash: 44,
    blurb: 'Slow shells that burst on landing. Ground only.',
  },
  {
    ...NO_EXTRAS,
    name: 'Frost', key: '3', cost: 70, range: 90, fireRate: 1, damage: 4, projectileSpeed: 0, hitsAir: true, turnRate: 0,
    slow: 0.5, slowTime: 1.6,
    blurb: 'Pulses a slow on everything in range. Hits air.',
  },
  {
    ...NO_EXTRAS,
    name: 'Arc', key: '4', cost: 110, range: 100, fireRate: 1.1, damage: 26, projectileSpeed: 0, hitsAir: false, turnRate: 0,
    chains: 4, chainRange: 64, chainFalloff: 0.8, armor: ArmorMode.Half,
    blurb: 'Lightning that jumps between enemies. Ground only.',
  },
  {
    ...NO_EXTRAS,
    name: 'Sniper', key: '5', cost: 140, range: 270, fireRate: 0.4, damage: 130, projectileSpeed: 0, hitsAir: true, turnRate: 5,
    armor: ArmorMode.Ignore,
    blurb: 'Huge hits from far away. Ignores armor. Slow to reload.',
  },
]

// ---- Tower levels (DOMAIN.md §2.3) ----

export const MAX_LEVEL = 4
/** Gold back when selling, as a share of everything spent on the tower (tuned). */
export const SELL_REFUND = 0.7
/** Cost of upgrading to level 2, 3 and 4, as a multiple of the build cost: each costs more than the last (tuned). */
export const UPGRADE_COST = [0.75, 1.15, 1.7] as const

/** Per-level multipliers, index 0 = level 1 (tuned). */
const LEVEL_DAMAGE = [1, 1.5, 2.15, 3]
const LEVEL_RANGE = [1, 1.08, 1.16, 1.25]
const LEVEL_RATE = [1, 1.1, 1.22, 1.35]
const LEVEL_SPLASH = [1, 1.1, 1.2, 1.3]
/** Frost slows harder and longer; Arc chains further at levels 3 and 4. */
const LEVEL_SLOW = [0.5, 0.44, 0.38, 0.32]
const LEVEL_SLOW_TIME = [1, 1.1, 1.2, 1.3]
const LEVEL_CHAINS = [0, 0, 1, 2]

function levelStats(def: TowerDef, k: number): TowerDef {
  return {
    ...def,
    damage: def.damage * LEVEL_DAMAGE[k],
    range: Math.round(def.range * LEVEL_RANGE[k]),
    fireRate: def.fireRate * LEVEL_RATE[k],
    splash: def.splash * LEVEL_SPLASH[k],
    slow: def.slowTime > 0 ? LEVEL_SLOW[k] : 1,
    slowTime: def.slowTime * LEVEL_SLOW_TIME[k],
    chains: def.chains > 0 ? def.chains + LEVEL_CHAINS[k] : 0,
  }
}

/** Stats for every type at every level, built once: TOWER_STATS[type][level - 1]. */
export const TOWER_STATS: readonly (readonly TowerDef[])[] = TOWERS.map((def) =>
  Array.from({ length: MAX_LEVEL }, (_, k) => levelStats(def, k)),
)

/** A tower's stats at `level` (1–4). No allocation. */
export function towerStats(type: number, level: number): TowerDef {
  return TOWER_STATS[type][level - 1]
}

/** Gold to go from `level` to `level + 1`, or 0 at max level. */
export function upgradeCost(type: number, level: number): number {
  return level >= MAX_LEVEL ? 0 : Math.round(TOWERS[type].cost * UPGRADE_COST[level - 1])
}

// ---- Projectiles ----

export const MAX_PROJECTILES = 4096
/** Seconds a projectile may fly before it fizzles. */
export const PROJECTILE_LIFE = 1.5
/** Once its target is gone, a projectile flies on for at most this long, in seconds. */
export const ORPHAN_LIFE = 0.25
/** Extra hit radius for projectiles, in world px. */
export const PROJECTILE_RADIUS = 3
/** Damage at the edge of a splash, as a fraction of the centre's. */
export const SPLASH_EDGE = 0.5
/** Peak height of a cannon shell's arc, in world px (drawing only). */
export const SHELL_ARC = 26

// ---- Effects (ARCHITECTURE.md §4.1, visual only) ----

export const MAX_BEAMS = 512
export const MAX_RINGS = 512

// ---- Enemies (DOMAIN.md §2.4) ----

/** Pool capacity (ARCHITECTURE.md §4.1). */
export const MAX_ENEMIES = 8192

export const EnemyType = {
  Grunt: 0,
  Runner: 1,
  Swarmling: 2,
  Brute: 3,
  Wisp: 4,
  Mender: 5,
  Warlord: 6,
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

/** Indexed by EnemyType. Values are starting points (tuned in feature 11). */
export const ENEMIES: readonly EnemyDef[] = [
  { name: 'Grunt', hp: 40, speed: 44, armor: 0, bounty: 4, leak: 1, radius: 10, air: false },
  { name: 'Runner', hp: 26, speed: 82, armor: 0, bounty: 3, leak: 1, radius: 8, air: false },
  { name: 'Swarmling', hp: 12, speed: 58, armor: 0, bounty: 1, leak: 1, radius: 6, air: false },
  { name: 'Brute', hp: 170, speed: 28, armor: 6, bounty: 11, leak: 3, radius: 13, air: false },
  { name: 'Wisp', hp: 34, speed: 54, armor: 0, bounty: 5, leak: 2, radius: 9, air: true },
  { name: 'Mender', hp: 75, speed: 38, armor: 1, bounty: 8, leak: 2, radius: 10, air: false },
  { name: 'Warlord', hp: 1500, speed: 24, armor: 8, bounty: 120, leak: 20, radius: 18, air: false },
]

/** Mender: seconds between heals, heal radius (px) and share of max health restored to each enemy nearby. */
export const MENDER_INTERVAL = 2.5
export const MENDER_RADIUS = 72
export const MENDER_HEAL = 0.1
/** Warlord: Runners released when it dies, and how far apart along the path (px). */
export const WARLORD_SPLIT = 6
export const WARLORD_SPLIT_SPACING = 10

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
