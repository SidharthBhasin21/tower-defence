import './style.css'
import { GameLoop } from './loop.ts'
import { PerfOverlay } from './perf/overlay.ts'
import { FrameRecorder, type FrameStats } from './perf/recorder.ts'
import { Camera } from './render/camera.ts'
import { Renderer } from './render/renderer.ts'
import { DemoSpawner } from './sim/demo.ts'
import { Ev } from './sim/events.ts'
import { Game, PlaceResult } from './sim/game.ts'
import { StressController } from './sim/stress.ts'
import { Controls } from './ui/controls.ts'
import { DebugReadout } from './ui/debug.ts'
import { CameraInput } from './ui/input.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#game')
const ui = document.querySelector<HTMLElement>('#ui')
if (!canvas || !ui) throw new Error('Missing #game canvas or #ui layer')

// ---- URL modes (ARCHITECTURE.md §7.2) ----
//   ?stress            stress scenario: 5,000 enemies, 100 towers, 1,000+ projectiles
//   &bench=<seconds>   measure for that long after a 3 s warm-up; results on window.__bench
//   &zoom=<factor>     start zoomed in at the map centre (to see culling at work)
const params = new URLSearchParams(location.search)
const stressMode = params.has('stress')
const benchSeconds = Number(params.get('bench') ?? 0)
const startZoom = Number(params.get('zoom') ?? 0)

const game = new Game()
const camera = new Camera()
const controls = new Controls(game, camera)
const renderer = new Renderer(canvas, camera, game, controls)
const input = new CameraInput(canvas, camera, controls)
const demo = new DemoSpawner()
const stress = new StressController()
const readout = new DebugReadout(ui)
const recorder = new FrameRecorder()
recorder.watchInput(window)
const overlay = new PerfOverlay(ui, recorder, game, stressMode)

if (stressMode) stress.setup(game)

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
}
window.addEventListener('resize', resize)
resize()
camera.fit()
if (startZoom > 0) camera.zoomAt(camera.viewW / 2, camera.viewH / 2, startZoom / camera.zoom)

// Temporary until waves exist (feature 5): G spawns a burst of Grunts.
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyG' && !e.repeat && !e.metaKey && !e.ctrlKey) demo.requestBurst(50)
})

let frameNow = 0

/** Sim → client events, drained once per frame. Bound once; allocates nothing. */
function onEvent(type: number, a: number): void {
  if (type === Ev.Leak) {
    if (!stressMode) renderer.flashBase()
  } else if (type === Ev.PlaceFailed) {
    if (a === PlaceResult.NoGold) readout.flash('Not enough gold', frameNow)
    else if (a === PlaceResult.Occupied) readout.flash('There is already a tower there', frameNow)
    else if (a === PlaceResult.Blocked || a === PlaceResult.OutOfBounds) readout.flash("Can't build there", frameNow)
    else if (a === PlaceResult.TooManyTowers) readout.flash('Tower limit reached', frameNow)
  }
}

// ---- Benchmark (ARCHITECTURE.md §7.3) ----

interface BenchResult {
  mode: string
  seconds: number
  zoom: number
  viewport: [number, number, number]
  stats: FrameStats
  /** Lowest and average live counts seen at the end of a frame while measuring. */
  counts: { minEnemies: number; avgEnemies: number; minProjectiles: number; avgProjectiles: number; towers: number; avgDrawn: number }
  heapMB: { start: number; end: number; max: number } | null
  userAgent: string
}
const WARMUP_MS = 3000
const bench = {
  phase: benchSeconds > 0 ? 'warmup' : 'off',
  startAt: -1,
  endAt: -1,
  frames: 0,
  minEnemies: Infinity,
  sumEnemies: 0,
  minProjectiles: Infinity,
  sumProjectiles: 0,
  sumDrawn: 0,
  heapStart: 0,
  heapMax: 0,
  result: null as BenchResult | null,
}

function heapMB(): number {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
  return mem ? mem.usedJSHeapSize / 1048576 : 0
}

function benchFrame(now: number): void {
  if (bench.phase === 'off' || bench.phase === 'done') return
  if (bench.startAt < 0) bench.startAt = now + WARMUP_MS
  if (bench.phase === 'warmup') {
    if (now < bench.startAt) return
    bench.phase = 'measure'
    bench.endAt = now + benchSeconds * 1000
    bench.heapStart = bench.heapMax = heapMB()
    recorder.reset()
    return
  }
  bench.frames++
  const en = game.enemies.aliveCount
  const pr = game.projectiles.count
  bench.minEnemies = Math.min(bench.minEnemies, en)
  bench.sumEnemies += en
  bench.minProjectiles = Math.min(bench.minProjectiles, pr)
  bench.sumProjectiles += pr
  bench.sumDrawn += renderer.drawnEnemies
  if ((bench.frames & 31) === 0) bench.heapMax = Math.max(bench.heapMax, heapMB())
  if (now < bench.endAt) return
  bench.phase = 'done'
  const end = heapMB()
  bench.result = {
    mode: stressMode ? 'stress' : 'normal',
    seconds: benchSeconds,
    zoom: +camera.zoom.toFixed(3),
    viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
    stats: recorder.stats(),
    counts: {
      minEnemies: bench.minEnemies,
      avgEnemies: Math.round(bench.sumEnemies / bench.frames),
      minProjectiles: bench.minProjectiles,
      avgProjectiles: Math.round(bench.sumProjectiles / bench.frames),
      towers: game.towers.count,
      avgDrawn: Math.round(bench.sumDrawn / bench.frames),
    },
    heapMB: end > 0 ? { start: +bench.heapStart.toFixed(1), end: +end.toFixed(1), max: +Math.max(bench.heapMax, end).toFixed(1) } : null,
    userAgent: navigator.userAgent,
  }
}

// ---- The loop ----

const loop = new GameLoop({
  step: () => {
    if (stressMode) stress.step(game)
    else demo.step(game)
    game.step()
  },
  render: (alpha, realDt, now) => {
    frameNow = now
    game.events.drain(onEvent)
    input.update(realDt)
    renderer.render(alpha, realDt)
    readout.update(game, renderer.drawnEnemies, controls.buildType, now)
    overlay.drawn = renderer.drawnEnemies
    overlay.update(now)
  },
  frameDone: (intervalMs, simMs, renderMs, steps, now) => {
    recorder.record(intervalMs, simMs, renderMs, steps, now)
    benchFrame(now)
  },
})
loop.start()

// Benchmark results are readable by scripts/bench.mjs, in production builds too.
if (benchSeconds > 0) Object.assign(window, { __bench: bench })

// Dev builds only: expose state for scripts/shot.mjs and console debugging.
if (import.meta.env.DEV) Object.assign(window, { __td: { game, camera, renderer, controls, demo, loop, recorder } })
