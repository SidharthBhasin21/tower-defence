import { TOWERS } from '../config.ts'
import type { Game } from '../sim/game.ts'

/**
 * TEMPORARY readout (features 2–8) until the real HUD arrives in feature 9.
 * Rebuilds its text only when something shown has changed.
 */
export class DebugReadout {
  private readonly el: HTMLElement
  private readonly msgEl: HTMLElement
  /** Values last shown; text is rebuilt only when one changes. */
  private readonly last = new Float64Array(8).fill(Number.NaN)
  private msgUntil = 0

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div')
    this.el.style.cssText =
      'position:absolute;right:12px;top:12px;padding:8px 12px;border-radius:8px;' +
      'background:rgba(8,14,10,0.78);font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;' +
      'color:#e8efe9;white-space:pre'
    this.msgEl = document.createElement('div')
    this.msgEl.style.cssText =
      'position:absolute;left:50%;top:16px;transform:translateX(-50%);padding:6px 14px;border-radius:8px;' +
      'background:rgba(120,24,20,0.9);font:600 14px system-ui,sans-serif;color:#fff;opacity:0;' +
      'transition:opacity 0.15s'
    parent.append(this.el, this.msgEl)
  }

  /** Shows a short warning in the top centre, e.g. "Not enough gold". */
  flash(text: string, now: number): void {
    this.msgEl.textContent = text
    this.msgEl.style.opacity = '1'
    this.msgUntil = now + 1400
  }

  update(game: Game, drawn: number, building: number, now: number): void {
    if (this.msgUntil && now > this.msgUntil) {
      this.msgEl.style.opacity = '0'
      this.msgUntil = 0
    }
    const gold = Math.floor(game.gold)
    const e = game.enemies.aliveCount
    const l = this.last
    if (
      l[0] === game.lives && l[1] === gold && l[2] === game.score && l[3] === e &&
      l[4] === drawn && l[5] === game.towers.count && l[6] === game.projectiles.count && l[7] === building
    )
      return
    l[0] = game.lives
    l[1] = gold
    l[2] = game.score
    l[3] = e
    l[4] = drawn
    l[5] = game.towers.count
    l[6] = game.projectiles.count
    l[7] = building
    const bolt = TOWERS[0]
    this.el.textContent =
      `Lives    ${game.lives}${game.lives === 0 ? '  (game over comes in feature 5)' : ''}\n` +
      `Gold     ${gold}\n` +
      `Score    ${game.score}\n` +
      `Enemies  ${e}  (drawn ${drawn})\n` +
      `Towers   ${game.towers.count}   Projectiles ${game.projectiles.count}\n` +
      (building >= 0
        ? `Building ${TOWERS[building].name}: click a tile (Shift = keep building, Esc = stop)`
        : `${bolt.key}        build ${bolt.name} (${bolt.cost}g)`) +
      '\nG        spawn 50 Grunts'
  }
}
