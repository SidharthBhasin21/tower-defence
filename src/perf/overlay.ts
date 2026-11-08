import type { Game } from '../sim/game.ts'
import { FPS_TARGET, SLOW_FRAME_MS, type FrameRecorder } from './recorder.ts'

/** How often the panel refreshes, in ms (not every frame: DOM writes cost). */
const REFRESH_MS = 250
/** Frames summarised by the panel (about 2 s at 60 Hz). */
const WINDOW = 120

/**
 * On-screen performance panel (ARCHITECTURE.md §7.3). Toggle with the
 * backtick key. Shows frame-time percentiles against the targets, CPU time
 * split between simulation and rendering, and live object counts.
 */
export class PerfOverlay {
  private readonly el: HTMLElement
  private readonly recorder: FrameRecorder
  private readonly game: Game
  private visible: boolean
  private nextRefresh = 0
  drawn = 0

  constructor(parent: HTMLElement, recorder: FrameRecorder, game: Game, visible: boolean) {
    this.recorder = recorder
    this.game = game
    this.visible = visible
    this.el = document.createElement('div')
    this.el.style.cssText =
      'position:absolute;right:12px;bottom:12px;padding:8px 12px;border-radius:8px;min-width:260px;' +
      'background:rgba(6,10,8,0.82);font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;' +
      'color:#d8e6dc;white-space:pre;pointer-events:none'
    this.el.style.display = visible ? 'block' : 'none'
    parent.appendChild(this.el)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote' && !e.repeat) this.toggle()
    })
  }

  toggle(): void {
    this.visible = !this.visible
    this.el.style.display = this.visible ? 'block' : 'none'
    this.nextRefresh = 0
  }

  update(now: number): void {
    if (!this.visible || now < this.nextRefresh) return
    this.nextRefresh = now + REFRESH_MS
    const s = this.recorder.stats(WINDOW)
    const g = this.game
    const ok = s.fpsAtP95 >= FPS_TARGET && s.slowPct < 5
    this.el.style.borderLeft = `3px solid ${ok ? '#5fd35f' : '#ef5a4c'}`
    this.el.textContent =
      `FPS ${s.avgFps.toFixed(0).padStart(4)}   p95 ${s.fpsAtP95.toFixed(0)} fps\n` +
      `frame p50 ${f(s.p50)}  p95 ${f(s.p95)}  max ${f(s.max)} ms\n` +
      `>${SLOW_FRAME_MS}ms ${s.slowPct.toFixed(1)}%\n` +
      `sim    ${f(s.simAvg)} avg  ${f(s.simP95)} p95 ms  (${s.stepsAvg.toFixed(1)} steps)\n` +
      `render ${f(s.renderAvg)} avg  ${f(s.renderP95)} p95 ms\n` +
      `enemies ${g.enemies.aliveCount}  drawn ${this.drawn}\n` +
      `towers ${g.towers.count}  projectiles ${g.projectiles.count}`
  }
}

function f(ms: number): string {
  return ms.toFixed(1).padStart(5)
}
