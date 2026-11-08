import { TILE, TOWERS } from '../config.ts'
import type { Camera, Vec } from '../render/camera.ts'
import { Cmd } from '../sim/commands.ts'
import { TARGET_MODE_COUNT } from '../sim/towers.ts'
import type { Game } from '../sim/game.ts'
import type { PointerHooks } from './input.ts'

/**
 * Player intent that isn't camera movement: build mode, hover and selection.
 * Gameplay changes go through the game's command queue; this class only holds
 * client-side UI state.
 *
 * - `1`: build a Bolt (toggle). Click a tile to build; Shift+click keeps building.
 * - Click a tower to select it; click empty ground to deselect.
 * - Right-click or `Esc`: leave build mode, or deselect.
 * - With a tower selected: `U` upgrade, `X` sell, `T` cycle targeting mode.
 */
export class Controls implements PointerHooks {
  /** Tower type being placed, or -1 when not building. */
  buildType = -1
  /** Selected tower, by tile index (y * width + x), or -1. */
  selectedTile = -1
  /** Pointer position over the canvas, in CSS px (NaN when outside). */
  private hoverSx = Number.NaN
  private hoverSy = Number.NaN
  private readonly world: Vec = { x: 0, y: 0 }
  private readonly game: Game
  private readonly camera: Camera

  constructor(game: Game, camera: Camera) {
    this.game = game
    this.camera = camera
    window.addEventListener('keydown', this.onKeyDown)
  }

  /** Tile under the pointer, or false when the pointer isn't over the canvas. */
  hoverTile(out: Vec): boolean {
    if (Number.isNaN(this.hoverSx)) return false
    this.camera.screenToWorld(this.hoverSx, this.hoverSy, this.world)
    out.x = Math.floor(this.world.x / TILE)
    out.y = Math.floor(this.world.y / TILE)
    return true
  }

  /** Index of the selected tower, or -1 (it may have been removed). */
  selectedTower(): number {
    if (this.selectedTile < 0) return -1
    const w = this.game.map.width
    const i = this.game.towers.at(this.selectedTile % w, Math.floor(this.selectedTile / w))
    if (i < 0) this.selectedTile = -1
    return i
  }

  startBuild(type: number): void {
    this.buildType = this.buildType === type ? -1 : type
    this.selectedTile = -1
  }

  // ---- PointerHooks ----

  click(sx: number, sy: number, shift: boolean): void {
    this.camera.screenToWorld(sx, sy, this.world)
    const tx = Math.floor(this.world.x / TILE)
    const ty = Math.floor(this.world.y / TILE)
    if (this.buildType >= 0) {
      this.game.commands.push(Cmd.Place, this.buildType, tx, ty)
      if (!shift) this.buildType = -1
      return
    }
    const onMap = this.game.map.inBounds(tx, ty)
    this.selectedTile = onMap && this.game.towers.at(tx, ty) >= 0 ? ty * this.game.map.width + tx : -1
  }

  cancel(): void {
    if (this.buildType >= 0) this.buildType = -1
    else this.selectedTile = -1
  }

  hover(sx: number, sy: number): void {
    this.hoverSx = sx
    this.hoverSy = sy
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
    if (e.code === 'Escape') {
      this.cancel()
      return
    }
    const i = this.selectedTower()
    if (i >= 0 && (e.code === 'KeyU' || e.code === 'KeyX' || e.code === 'KeyT')) {
      const t = this.game.towers
      const tx = t.tx[i]
      const ty = t.ty[i]
      if (e.code === 'KeyU') this.game.commands.push(Cmd.Upgrade, tx, ty)
      else if (e.code === 'KeyX') this.game.commands.push(Cmd.Sell, tx, ty)
      else this.game.commands.push(Cmd.SetTarget, tx, ty, (t.targetMode[i] + 1) % TARGET_MODE_COUNT)
      return
    }
    for (let t = 0; t < TOWERS.length; t++) {
      if (e.key === TOWERS[t].key) {
        this.startBuild(t)
        return
      }
    }
  }
}
