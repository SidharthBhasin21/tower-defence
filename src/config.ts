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

// ---- Camera ----

/** Zoom limits. The minimum is lowered further if needed to fit the whole map. */
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2.5
/** Screen-space padding kept around the map when fitting it to the view, in CSS px. */
export const FIT_PADDING = 24
/** Keyboard pan speed, in CSS px per second (independent of zoom). */
export const KEY_PAN_SPEED = 900
