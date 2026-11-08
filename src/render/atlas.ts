/** Atlas resolution, in canvas pixels per world pixel. */
export const ATLAS_SCALE = 3
const ATLAS_SIZE = 1024
/** Empty pixels kept around each frame so smoothing never bleeds neighbours in. */
const GUTTER = 2

/** A sprite's rectangle in the atlas, plus its size in world px. */
export interface Frame {
  readonly sx: number
  readonly sy: number
  readonly sw: number
  readonly sh: number
  /** Size when drawn, in world px; drawn centred on the entity. */
  readonly w: number
  readonly h: number
}

/**
 * Every sprite lives in this one canvas (ARCHITECTURE.md §5.2), so all
 * entity draws use the same source image and the browser can batch them.
 * Sprites are drawn in code at startup; there are no image files.
 */
export class Atlas {
  readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private x = 0
  private y = 0
  private shelf = 0

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = this.canvas.height = ATLAS_SIZE
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is not supported')
    this.ctx = ctx
  }

  /**
   * Adds a sprite `w` × `h` world px. `draw` runs with the origin at the
   * sprite's centre and units in world px.
   */
  add(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Frame {
    const sw = Math.ceil(w * ATLAS_SCALE)
    const sh = Math.ceil(h * ATLAS_SCALE)
    if (this.x + sw + GUTTER > ATLAS_SIZE) {
      this.x = 0
      this.y += this.shelf + GUTTER
      this.shelf = 0
    }
    if (this.y + sh > ATLAS_SIZE) throw new Error('Sprite atlas is full')
    const frame: Frame = { sx: this.x, sy: this.y, sw, sh, w, h }
    const ctx = this.ctx
    ctx.save()
    ctx.beginPath()
    ctx.rect(this.x, this.y, sw, sh)
    ctx.clip()
    ctx.translate(this.x + sw / 2, this.y + sh / 2)
    ctx.scale(ATLAS_SCALE, ATLAS_SCALE)
    draw(ctx)
    ctx.restore()
    this.x += sw + GUTTER
    this.shelf = Math.max(this.shelf, sh)
    return frame
  }
}
