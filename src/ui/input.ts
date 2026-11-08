import { KEY_PAN_SPEED } from '../config.ts'
import type { Camera } from '../render/camera.ts'

/** Pointer travel, in CSS px, before a press counts as a drag instead of a click. */
const DRAG_THRESHOLD = 5

/** Pointer gestures that aren't camera moves, in CSS px relative to the canvas. */
export interface PointerHooks {
  /** Left button pressed and released without dragging. `shift` = keep building. */
  click(sx: number, sy: number, shift: boolean): void
  /** Right button pressed and released without dragging. */
  cancel(): void
  /** Pointer moved (or left the canvas, with NaN coordinates). */
  hover(sx: number, sy: number): void
}

/**
 * Camera controls. A press only becomes a drag-pan after DRAG_THRESHOLD px,
 * so short presses are delivered to `hooks` as clicks.
 *
 * - Drag with any mouse button: pan
 * - Wheel or trackpad pinch: zoom at the cursor
 * - WASD / arrow keys: pan; + / -: zoom; Home: fit the whole map
 */
export class CameraInput {
  private readonly camera: Camera
  private readonly el: HTMLElement
  /** Held pan keys: left, right, up, down. */
  private readonly held = new Uint8Array(4)
  private pointerId = -1
  private downX = 0
  private downY = 0
  private lastX = 0
  private lastY = 0
  private dragging = false
  private button = 0
  private readonly hooks: PointerHooks

  constructor(el: HTMLElement, camera: Camera, hooks: PointerHooks) {
    this.el = el
    this.camera = camera
    this.hooks = hooks
    el.addEventListener('pointerleave', () => this.hooks.hover(Number.NaN, Number.NaN))
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerup', this.onPointerUp)
    el.addEventListener('pointercancel', this.onPointerUp)
    el.addEventListener('wheel', this.onWheel, { passive: false })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', () => this.held.fill(0))
  }

  /** True while a drag-pan is in progress (used later to suppress clicks). */
  get isDragging(): boolean {
    return this.dragging
  }

  /** Applies held-key panning. Called once per rendered frame with real time. */
  update(realDt: number): void {
    const dx = this.held[1] - this.held[0]
    const dy = this.held[3] - this.held[2]
    if (dx === 0 && dy === 0) return
    const d = KEY_PAN_SPEED * realDt
    this.camera.panBy(-dx * d, -dy * d)
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.pointerId !== -1) return
    this.pointerId = e.pointerId
    this.downX = this.lastX = e.offsetX
    this.downY = this.lastY = e.offsetY
    this.dragging = false
    this.button = e.button
    this.el.setPointerCapture(e.pointerId)
    // Middle-click would otherwise start the browser's autoscroll.
    if (e.button === 1) e.preventDefault()
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    this.hooks.hover(e.offsetX, e.offsetY)
    if (e.pointerId !== this.pointerId) return
    if (!this.dragging) {
      const tx = e.offsetX - this.downX
      const ty = e.offsetY - this.downY
      if (tx * tx + ty * ty < DRAG_THRESHOLD * DRAG_THRESHOLD) return
      this.dragging = true
      this.el.style.cursor = 'grabbing'
    }
    this.camera.panBy(e.offsetX - this.lastX, e.offsetY - this.lastY)
    this.lastX = e.offsetX
    this.lastY = e.offsetY
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return
    if (!this.dragging && e.type === 'pointerup') {
      if (this.button === 0) this.hooks.click(e.offsetX, e.offsetY, e.shiftKey)
      else if (this.button === 2) this.hooks.cancel()
    }
    this.pointerId = -1
    this.dragging = false
    this.el.style.cursor = ''
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId)
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    // Trackpad pinch arrives as ctrl+wheel with small deltas; scale it up.
    const perUnit = e.ctrlKey ? 0.01 : 0.0015
    const lines = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1
    this.camera.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * lines * perUnit))
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const i = panKeyIndex(e.code)
    if (i >= 0) {
      this.held[i] = 1
      e.preventDefault()
      return
    }
    const cx = this.camera.viewW / 2
    const cy = this.camera.viewH / 2
    if (e.code === 'Equal' || e.code === 'NumpadAdd') this.camera.zoomAt(cx, cy, 1.2)
    else if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.camera.zoomAt(cx, cy, 1 / 1.2)
    else if (e.code === 'Home') this.camera.fit()
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const i = panKeyIndex(e.code)
    if (i >= 0) this.held[i] = 0
  }
}

function panKeyIndex(code: string): number {
  switch (code) {
    case 'KeyA':
    case 'ArrowLeft':
      return 0
    case 'KeyD':
    case 'ArrowRight':
      return 1
    case 'KeyW':
    case 'ArrowUp':
      return 2
    case 'KeyS':
    case 'ArrowDown':
      return 3
    default:
      return -1
  }
}
