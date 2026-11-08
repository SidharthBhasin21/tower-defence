import './style.css'
import { GAME_SPEEDS } from './config.ts'
import { GameLoop } from './loop.ts'
import { PerfOverlay } from './perf/overlay.ts'
import { FrameRecorder, type FrameStats } from './perf/recorder.ts'
import { Camera } from './render/camera.ts'
import { Renderer } from './render/renderer.ts'
import { Cmd } from './sim/commands.ts'
import { Ev } from './sim/events.ts'
import { Game, Phase, PlaceResult } from './sim/game.ts'
import { StressController } from './sim/stress.ts'
import { Controls } from './ui/controls.ts'
import { DebugReadout } from './ui/debug.ts'
import { CameraInput } from './ui/input.ts'
import { Screens } from './ui/screens.ts'
import { loadBest, loadSettings, saveBest, saveSettings } from './ui/storage.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#game')
const ui = document.querySelector<HTMLElement>('#ui')
if (!canvas || !ui) throw new Error('Missing #game canvas or #ui layer')

// ---- URL modes (ARCHITECTURE.md §7.2) ----
//   ?stress            stress scenario: 5,000 enemies, 100 towers, 1,000+ projectiles
//   &bench=<seconds>   measure for that long after a 3 s warm-up; results on window.__bench
//   &zoom=<factor>     start zoomed in at the map centre (to see culling at work)
//   ?play              skip the title screen (used by scripts/shot.mjs)
const params = new URLSearchParams(location.search)
const stressMode = params.has('stress')
const benchSeconds = Number(params.get('bench') ?? 0)
const startZoom = Number(params.get('zoom') ?? 0)
const skipTitle = stressMode || benchSeconds > 0 || params.has('play')

const game = new Game()
const camera = new Camera()
const controls = new Controls(game, camera)
const renderer = new Renderer(canvas, camera, game, controls)
const input = new CameraInput(canvas, camera, controls)
let stress = new StressController()
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

let frameNow = 0

// ---- Client state: title, pause, speed, restart (DOMAIN.md §2.6) ----

const settings = loadSettings()
let speedIndex = Math.min(Math.max(settings.speedIndex, 0), GAME_SPEEDS.length - 1)

/** Panels that stop the simulation while open (the game-over screens stop it via the sim phase). */
function syncPause(): void {
  const s = screens.current
  loop.stepper.paused = s === 'title' || s === 'pause' || s === 'confirm'
}

function setSpeed(i: number): void {
  speedIndex = i
  loop.stepper.speed = GAME_SPEEDS[i]
  settings.speedIndex = i
  saveSettings(settings)
}

/** True while a run is under way and would be lost by restarting. */
function inProgress(): boolean {
  return game.phase === Phase.Playing && game.wave > 0
}

function restartNow(): void {
  game.reset()
  loop.stepper.reset()
  controls.buildType = -1
  controls.selectedTile = -1
  if (stressMode) {
    stress = new StressController()
    stress.setup(game)
  }
  screens.hide()
  syncPause()
}

const screens = new Screens(ui, {
  play: () => {
    screens.hide()
    syncPause()
  },
  resume: () => {
    screens.hide()
    syncPause()
  },
  restart: () => {
    if (inProgress()) screens.show('confirm')
    else restartNow()
    syncPause()
  },
  restartNow,
  cancelConfirm: () => {
    screens.hide()
    syncPause()
  },
})

function togglePause(): void {
  if (screens.current === 'pause') screens.hide()
  else if (screens.current === null && game.phase === Phase.Playing) screens.show('pause')
  syncPause()
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
  const s = screens.current
  switch (e.code) {
    case 'Space':
    case 'Enter':
      e.preventDefault()
      if (s === 'title') {
        screens.hide()
        syncPause()
      } else if (s === null && e.code === 'Space') {
        game.commands.push(Cmd.NextWave)
      }
      break
    case 'KeyP':
      togglePause()
      break
    case 'Escape':
      if (s === 'pause' || s === 'confirm') {
        screens.hide()
        syncPause()
      }
      break
    case 'KeyF':
      setSpeed((speedIndex + 1) % GAME_SPEEDS.length)
      break
    case 'KeyR':
      if (s === 'confirm') restartNow()
      else if (s !== 'title') {
        if (inProgress()) screens.show('confirm')
        else restartNow()
        syncPause()
      }
      break
  }
})

/** Shows the end screen and records the best score. */
function endGame(won: boolean): void {
  controls.buildType = -1
  const newBest = !stressMode && saveBest(game.score)
  screens.show(won ? 'victory' : 'defeat', {
    score: game.score,
    best: loadBest(),
    newBest,
    wavesCleared: game.cleared,
    kills: game.kills,
    lives: game.lives,
  })
  syncPause()
}

/** Sim → client events, drained once per frame. Bound once; allocates nothing. */
function onEvent(type: number, a: number, b: number): void {
  if (type === Ev.Leak) {
    if (!stressMode) renderer.flashBase()
  } else if (type === Ev.PlaceFailed) {
    if (a === PlaceResult.NoGold) readout.flash('Not enough gold', frameNow)
    else if (a === PlaceResult.Occupied) readout.flash('There is already a tower there', frameNow)
    else if (a === PlaceResult.Blocked || a === PlaceResult.OutOfBounds) readout.flash("Can't build there", frameNow)
    else if (a === PlaceResult.TooManyTowers) readout.flash('Tower limit reached', frameNow)
  } else if (type === Ev.WaveStart) {
    readout.flash(b > 0 ? `Wave ${a} called early: +${b} gold` : `Wave ${a}`, frameNow, true)
  } else if (type === Ev.WaveCleared) {
    readout.flash(`Wave ${a} cleared: +${b} gold`, frameNow, true)
  } else if (type === Ev.BossSpawn) {
    readout.flash(`Wave ${a}: a Warlord approaches!`, frameNow)
  } else if (type === Ev.Victory) {
    endGame(true)
  } else if (type === Ev.Defeat) {
    endGame(false)
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
    game.step()
  },
  render: (alpha, realDt, now) => {
    frameNow = now
    game.events.drain(onEvent)
    input.update(realDt)
    renderer.render(alpha, realDt)
    readout.update(game, renderer.drawnEnemies, controls.buildType, GAME_SPEEDS[speedIndex], loop.stepper.paused, now)
    overlay.drawn = renderer.drawnEnemies
    overlay.update(now)
  },
  frameDone: (intervalMs, simMs, renderMs, steps, now) => {
    recorder.record(intervalMs, simMs, renderMs, steps, now)
    benchFrame(now)
  },
})
setSpeed(speedIndex)
if (!skipTitle) screens.show('title')
syncPause()
loop.start()

// Benchmark results are readable by scripts/bench.mjs, in production builds too.
if (benchSeconds > 0) Object.assign(window, { __bench: bench })

// Dev builds only: expose state for scripts/shot.mjs and console debugging.
if (import.meta.env.DEV) Object.assign(window, { __td: { game, camera, renderer, controls, screens, loop, recorder } })
