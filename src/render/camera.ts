import { FIT_PADDING, WORLD_H, WORLD_W, ZOOM_MAX, ZOOM_MIN } from '../config.ts'

/** Axis-aligned rectangle in world pixels; reused as an out-parameter. */
export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A 2D point; reused as an out-parameter so conversions allocate nothing. */
export interface Vec {
  x: number
  y: number
}

/** Extra world space the camera may show past the map edge, in world px. */
const EDGE_SLACK = 96

/**
 * 2D camera: a world-space centre and a zoom factor, mapped onto a viewport
 * measured in CSS pixels. Pure math, no DOM, so it is unit-tested directly.
 */
export class Camera {
  /** World point at the centre of the view. */
  x = WORLD_W / 2
  y = WORLD_H / 2
  /** CSS pixels per world pixel. */
  zoom = 1
  /** Viewport size, in CSS pixels. */
  viewW = 1
  viewH = 1
  /**
   * True until the player pans or zooms. While set, viewport changes re-fit
   * the whole map, so resizing the window before touching the camera keeps it framed.
   */
  autoFit = true
  /**
   * Screen space covered by the HUD at the top and bottom, in CSS px. Fitting
   * and clamping frame the map in the space between them.
   */
  insetTop = 0
  insetBottom = 0

  /** Sets the HUD insets and re-fits if the camera is still auto-fitting. */
  setInsets(top: number, bottom: number): void {
    this.insetTop = top
    this.insetBottom = bottom
    if (this.autoFit) this.fit()
    else this.clamp()
  }

  /** World-space offset from the view centre to the centre of the uncovered area (y). */
  private get insetShift(): number {
    return (this.insetTop - this.insetBottom) / 2 / this.zoom
  }

  /** Zoom at which the whole map fits the viewport (with padding). */
  get fitZoom(): number {
    const w = Math.max(1, this.viewW - FIT_PADDING * 2)
    const h = Math.max(1, this.viewH - this.insetTop - this.insetBottom - FIT_PADDING * 2)
    return Math.min(w / WORLD_W, h / WORLD_H)
  }

  /** Lowest allowed zoom: ZOOM_MIN, or lower if needed to see the whole map. */
  get minZoom(): number {
    return Math.min(ZOOM_MIN, this.fitZoom)
  }

  setViewport(cssW: number, cssH: number): void {
    this.viewW = Math.max(1, cssW)
    this.viewH = Math.max(1, cssH)
    if (this.autoFit) {
      this.fit()
      return
    }
    this.zoom = Math.min(Math.max(this.zoom, this.minZoom), ZOOM_MAX)
    this.clamp()
  }

  /** Centres the map and zooms so it all fits. */
  fit(): void {
    this.autoFit = true
    this.zoom = Math.min(Math.max(this.fitZoom, this.minZoom), ZOOM_MAX)
    this.x = WORLD_W / 2
    this.y = WORLD_H / 2 - this.insetShift
    this.clamp()
  }

  /** Pans by a screen-space delta in CSS px (drag right → world moves right). */
  panBy(dxCss: number, dyCss: number): void {
    this.autoFit = false
    this.x -= dxCss / this.zoom
    this.y -= dyCss / this.zoom
    this.clamp()
  }

  /** Multiplies zoom by `factor`, keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    this.autoFit = false
    const next = Math.min(Math.max(this.zoom * factor, this.minZoom), ZOOM_MAX)
    if (next === this.zoom) return
    // World point under the cursor before the zoom...
    const wx = this.x + (sx - this.viewW / 2) / this.zoom
    const wy = this.y + (sy - this.viewH / 2) / this.zoom
    this.zoom = next
    // ...stays under the cursor after it.
    this.x = wx - (sx - this.viewW / 2) / next
    this.y = wy - (sy - this.viewH / 2) / next
    this.clamp()
  }

  screenToWorld(sx: number, sy: number, out: Vec): Vec {
    out.x = this.x + (sx - this.viewW / 2) / this.zoom
    out.y = this.y + (sy - this.viewH / 2) / this.zoom
    return out
  }

  worldToScreen(wx: number, wy: number, out: Vec): Vec {
    out.x = (wx - this.x) * this.zoom + this.viewW / 2
    out.y = (wy - this.y) * this.zoom + this.viewH / 2
    return out
  }

  /** The world rectangle currently visible (not clipped to the map). */
  viewRect(out: Rect): Rect {
    const hw = this.viewW / 2 / this.zoom
    const hh = this.viewH / 2 / this.zoom
    out.x0 = this.x - hw
    out.y0 = this.y - hh
    out.x1 = this.x + hw
    out.y1 = this.y + hh
    return out
  }

  /**
   * Keeps the map on screen: on an axis where the view is larger than the map
   * the map is centred; otherwise the view may go past the edge by EDGE_SLACK.
   */
  clamp(): void {
    this.x = clampAxis(this.x, this.viewW / 2 / this.zoom, WORLD_W)
    // Clamp the centre of the uncovered area, not the raw view centre.
    const shift = this.insetShift
    const half = Math.max(1, this.viewH - this.insetTop - this.insetBottom) / 2 / this.zoom
    this.y = clampAxis(this.y + shift, half, WORLD_H) - shift
  }
}

function clampAxis(centre: number, half: number, size: number): number {
  const lo = half - EDGE_SLACK
  const hi = size - half + EDGE_SLACK
  if (lo >= hi) return size / 2
  return Math.min(Math.max(centre, lo), hi)
}
