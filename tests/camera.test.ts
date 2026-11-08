import { describe, expect, it } from 'vitest'
import { WORLD_H, WORLD_W, ZOOM_MAX, ZOOM_MIN } from '../src/config.ts'
import { Camera, type Rect, type Vec } from '../src/render/camera.ts'

function camera(w = 1440, h = 900): Camera {
  const c = new Camera()
  c.setViewport(w, h)
  c.fit()
  return c
}

describe('Camera', () => {
  it('fits the whole map in view, centred', () => {
    const c = camera()
    const r = c.viewRect({ x0: 0, y0: 0, x1: 0, y1: 0 })
    expect(r.x0).toBeLessThanOrEqual(0)
    expect(r.y0).toBeLessThanOrEqual(0)
    expect(r.x1).toBeGreaterThanOrEqual(WORLD_W)
    expect(r.y1).toBeGreaterThanOrEqual(WORLD_H)
    expect(c.x).toBeCloseTo(WORLD_W / 2)
    expect(c.y).toBeCloseTo(WORLD_H / 2)
  })

  it('converts screen → world → screen without drift', () => {
    const c = camera()
    c.zoomAt(300, 200, 1.7)
    c.panBy(-120, 45)
    const w: Vec = { x: 0, y: 0 }
    const s: Vec = { x: 0, y: 0 }
    for (const [sx, sy] of [[0, 0], [700, 450], [1439, 899]]) {
      c.screenToWorld(sx, sy, w)
      c.worldToScreen(w.x, w.y, s)
      expect(s.x).toBeCloseTo(sx, 6)
      expect(s.y).toBeCloseTo(sy, 6)
    }
  })

  it('keeps the world point under the cursor fixed while zooming', () => {
    const c = camera()
    const before: Vec = { x: 0, y: 0 }
    const after: Vec = { x: 0, y: 0 }
    c.screenToWorld(500, 300, before)
    c.zoomAt(500, 300, 1.5)
    c.screenToWorld(500, 300, after)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('clamps zoom to its limits', () => {
    const c = camera()
    c.zoomAt(0, 0, 1000)
    expect(c.zoom).toBe(ZOOM_MAX)
    c.zoomAt(0, 0, 1 / 1e6)
    expect(c.zoom).toBe(c.minZoom)
    expect(c.minZoom).toBeLessThanOrEqual(ZOOM_MIN)
  })

  it('lowers the minimum zoom on small screens so the map still fits', () => {
    const c = camera(400, 300)
    expect(c.minZoom).toBeLessThan(ZOOM_MIN)
    const r = c.viewRect({ x0: 0, y0: 0, x1: 0, y1: 0 })
    expect(r.x1 - r.x0).toBeGreaterThanOrEqual(WORLD_W)
  })

  it('cannot be panned far off the map', () => {
    const c = camera()
    c.zoomAt(720, 450, 2)
    c.panBy(1e6, 1e6)
    const r: Rect = c.viewRect({ x0: 0, y0: 0, x1: 0, y1: 0 })
    // Some of the map is still in view.
    expect(r.x1).toBeGreaterThan(0)
    expect(r.y1).toBeGreaterThan(0)
    c.panBy(-1e7, -1e7)
    c.viewRect(r)
    expect(r.x0).toBeLessThan(WORLD_W)
    expect(r.y0).toBeLessThan(WORLD_H)
  })

  it('re-fits on resize until the player moves the camera', () => {
    const c = camera(800, 600)
    c.setViewport(1600, 1000)
    expect(c.zoom).toBeCloseTo(c.fitZoom)
    c.panBy(10, 0)
    const zoom = c.zoom
    c.setViewport(1000, 700)
    expect(c.zoom).toBe(zoom)
    c.fit()
    expect(c.autoFit).toBe(true)
  })
})
