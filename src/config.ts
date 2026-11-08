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

// ---- Camera ----

/** Zoom limits. The minimum is lowered further if needed to fit the whole map. */
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2.5
/** Screen-space padding kept around the map when fitting it to the view, in CSS px. */
export const FIT_PADDING = 24
/** Keyboard pan speed, in CSS px per second (independent of zoom). */
export const KEY_PAN_SPEED = 900
