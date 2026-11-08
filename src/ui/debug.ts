import type { Game } from '../sim/game.ts'

/**
 * TEMPORARY readout (features 2–8) until the real HUD arrives in feature 9.
 * Writes to the DOM only when a value changes.
 */
export class DebugReadout {
  private readonly el: HTMLElement
  private lives = -1
  private enemies = -1
  private drawn = -1

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div')
    this.el.style.cssText =
      'position:absolute;left:12px;top:12px;padding:8px 12px;border-radius:8px;' +
      'background:rgba(8,14,10,0.75);font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;' +
      'color:#e8efe9;white-space:pre'
    parent.appendChild(this.el)
  }

  update(game: Game, drawn: number): void {
    const lives = game.lives
    const enemies = game.enemies.aliveCount
    if (lives === this.lives && enemies === this.enemies && drawn === this.drawn) return
    this.lives = lives
    this.enemies = enemies
    this.drawn = drawn
    this.el.textContent =
      `Lives    ${lives}${lives === 0 ? '  (game over comes in feature 5)' : ''}\n` +
      `Enemies  ${enemies}  (drawn ${drawn})\n` +
      'G        spawn 50 Grunts'
  }
}
