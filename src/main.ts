import './style.css'
import { Sfx, Sound } from './audio/sfx.ts'
import { DT, ENEMIES, EnemyType, GAME_SPEEDS } from './config.ts'
import { GameLoop } from './loop.ts'
import { PerfOverlay } from './perf/overlay.ts'
import { FrameRecorder, type FrameStats } from './perf/recorder.ts'
import { Camera } from './render/camera.ts'
import { Renderer } from './render/renderer.ts'
import { Cmd } from './sim/commands.ts'
import { Ev } from './sim/events.ts'
import { Game, Phase, PlaceResult, UpgradeResult } from './sim/game.ts'
import { Bot, REFERENCE_PLAN } from './sim/bot.ts'
import { StressController } from './sim/stress.ts'
import { Controls } from './ui/controls.ts'
import { Hud } from './ui/hud.ts'
import { CameraInput } from './ui/input.ts'
import { TowerPanel } from './ui/panel.ts'
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
//   ?bot               the reference bot plays a normal game (src/sim/bot.ts)
//   &speed=<1|2|4>     start at that game speed (not saved)
//   &bench=full        measure a whole game, start to end, with a heap sample per wave
const params = new URLSearchParams(location.search)
const stressMode = params.has('stress')
const botMode = params.has('bot')
const fullRun = params.get('bench') === 'full'
const benchSeconds = fullRun ? 0 : Number(params.get('bench') ?? 0)
const startZoom = Number(params.get('zoom') ?? 0)
const startSpeed = GAME_SPEEDS.indexOf(Number(params.get('speed')) as (typeof GAME_SPEEDS)[number])
const skipTitle = stressMode || botMode || benchSeconds > 0 || fullRun || params.has('play')

const game = new Game()
const camera = new Camera()
const controls = new Controls(game, camera)
const renderer = new Renderer(canvas, camera, game, controls)
const input = new CameraInput(canvas, camera, controls)
let stress = new StressController()
const bot = botMode ? new Bot(game, REFERENCE_PLAN) : null
const panel = new TowerPanel(ui, game, controls)
// A full run at 4× is about 6.5 minutes; give it room for 18 minutes of frames.
const recorder = new FrameRecorder(fullRun ? 1 << 16 : undefined)
recorder.watchInput(window)
const overlay = new PerfOverlay(ui, recorder, game, stressMode)

if (stressMode) stress.setup(game)

const hud = new Hud(ui, renderer.sprites, {
  nextWave: () => game.commands.push(Cmd.NextWave),
  togglePause: () => togglePause(),
  cycleSpeed: () => setSpeed((speedIndex + 1) % GAME_SPEEDS.length),
  toggleMute: () => toggleMute(),
  restart: () => askRestart(),
  build: (type) => controls.startBuild(type),
})
const hudState = { speed: 1, paused: false, muted: false, building: -1 }

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
  // Fit the map into the area the HUD bars leave uncovered.
  const [top, bottom] = hud.insets()
  camera.setInsets(top, bottom)
}
window.addEventListener('resize', resize)
resize()
camera.fit()
if (startZoom > 0) camera.zoomAt(camera.viewW / 2, camera.viewH / 2, startZoom / camera.zoom)

let frameNow = 0

// ---- Client state: title, pause, speed, restart (DOMAIN.md §2.6) ----

const settings = loadSettings()
const sfx = new Sfx(settings.muted)
let speedIndex = startSpeed >= 0 ? startSpeed : Math.min(Math.max(settings.speedIndex, 0), GAME_SPEEDS.length - 1)

/** Panels that stop the simulation while open (the game-over screens stop it via the sim phase). */
function syncPause(): void {
  const s = screens.current
  loop.stepper.paused = s === 'title' || s === 'help' || s === 'pause' || s === 'confirm'
}

function setSpeed(i: number): void {
  speedIndex = i
  loop.stepper.speed = GAME_SPEEDS[i]
  if (startSpeed >= 0) return // a URL speed is for this visit only
  settings.speedIndex = i
  saveSettings(settings)
}

function toggleMute(): void {
  settings.muted = !settings.muted
  sfx.setMuted(settings.muted)
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
  restart: () => askRestart(),
  restartNow,
  cancelConfirm: () => {
    screens.hide()
    syncPause()
  },
  best: () => loadBest(),
})

/** Restart, asking first when a game is in progress. */
function askRestart(): void {
  if (screens.current === 'title' || screens.current === 'help') return
  if (inProgress()) screens.show('confirm')
  else restartNow()
  syncPause()
}

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
      if (s === 'help') screens.back()
      else if (s === 'pause' || s === 'confirm') {
        screens.hide()
        syncPause()
      }
      break
    case 'KeyF':
      setSpeed((speedIndex + 1) % GAME_SPEEDS.length)
      break
    case 'KeyR':
      if (s === 'confirm') restartNow()
      else askRestart()
      break
    case 'KeyM':
      toggleMute()
      break
  }
})

/** Shows the end screen and records the best score. */
function endGame(won: boolean): void {
  controls.buildType = -1
  const newBest = !stressMode && !botMode && saveBest(game.score)
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
  if (type === Ev.Shot) {
    sfx.play(a) // Sound ids 0–4 are the tower types
  } else if (type === Ev.Kill) {
    if (a === EnemyType.Warlord) {
      sfx.play(Sound.BossDie)
      renderer.shake(7)
    } else sfx.play(Sound.Pop, Math.min(1.6, 12 / ENEMIES[a].radius))
  } else if (type === Ev.Explode) {
    sfx.play(Sound.Explode)
  } else if (type === Ev.Leak) {
    sfx.play(Sound.Leak)
    if (!stressMode) {
      renderer.flashBase()
      renderer.shake(2.5)
    }
  } else if (type === Ev.TowerPlaced) {
    sfx.play(Sound.Place)
  } else if (type === Ev.Upgraded) {
    sfx.play(Sound.Upgrade)
  } else if (type === Ev.PlaceFailed) {
    sfx.play(Sound.Error)
    if (a === PlaceResult.NoGold) hud.toast('Not enough gold', 'warn', frameNow)
    else if (a === PlaceResult.Occupied) hud.toast('There is already a tower there', 'warn', frameNow)
    else if (a === PlaceResult.Blocked || a === PlaceResult.OutOfBounds) hud.toast("Can't build there", 'warn', frameNow)
    else if (a === PlaceResult.TooManyTowers) hud.toast('Tower limit reached', 'warn', frameNow)
  } else if (type === Ev.WaveStart) {
    sfx.play(Sound.WaveStart)
    hud.toast(b > 0 ? `Wave ${a} called early: +${b} gold` : `Wave ${a}`, 'info', frameNow)
  } else if (type === Ev.WaveCleared) {
    sfx.play(Sound.WaveClear)
    hud.toast(`Wave ${a} cleared: +${b} gold`, 'info', frameNow)
  } else if (type === Ev.UpgradeFailed) {
    sfx.play(Sound.Error)
    if (a === UpgradeResult.NoGold) hud.toast('Not enough gold to upgrade', 'warn', frameNow)
    else if (a === UpgradeResult.MaxLevel) hud.toast('Already at max level', 'warn', frameNow)
  } else if (type === Ev.Sold) {
    sfx.play(Sound.Sell)
    hud.toast(`Sold for ${b} gold`, 'info', frameNow)
  } else if (type === Ev.BossSpawn) {
    sfx.play(Sound.BossSpawn)
    renderer.shake(3)
    hud.toast(`Wave ${a}: a Warlord approaches!`, 'boss', frameNow)
  } else if (type === Ev.Victory) {
    sfx.play(Sound.Victory)
    endGame(true)
  } else if (type === Ev.Defeat) {
    sfx.play(Sound.Defeat)
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
  /** Full runs only: how the game ended, and the heap and live counts as each wave cleared. */
  outcome?: { phase: string; wave: number; cleared: number; lives: number; score: number; gameMinutes: number }
  perWave?: { wave: number; heapMB: number; enemies: number; projectiles: number; particles: number }[]
  peaks?: { enemies: number; projectiles: number; particles: number }
  userAgent: string
}
const WARMUP_MS = 3000
const bench = {
  phase: benchSeconds > 0 || fullRun ? 'warmup' : 'off',
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
  lastCleared: 0,
  perWave: [] as NonNullable<BenchResult['perWave']>,
  peakEnemies: 0,
  peakProjectiles: 0,
  peakParticles: 0,
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
    bench.endAt = fullRun ? Infinity : now + benchSeconds * 1000
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
  if (fullRun) {
    bench.peakEnemies = Math.max(bench.peakEnemies, en)
    bench.peakProjectiles = Math.max(bench.peakProjectiles, pr)
    bench.peakParticles = Math.max(bench.peakParticles, game.particles.count)
    if (game.cleared !== bench.lastCleared) {
      bench.lastCleared = game.cleared
      bench.perWave.push({ wave: game.cleared, heapMB: +heapMB().toFixed(2), enemies: en, projectiles: pr, particles: game.particles.count })
    }
    if (game.phase === Phase.Playing) return
  } else if (now < bench.endAt) return
  bench.phase = 'done'
  const end = heapMB()
  bench.result = {
    mode: stressMode ? 'stress' : botMode ? 'bot' : 'normal',
    seconds: fullRun ? +((now - bench.startAt) / 1000).toFixed(1) : benchSeconds,
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
  if (fullRun) {
    bench.result.outcome = {
      phase: game.phase === Phase.Won ? 'won' : game.phase === Phase.Lost ? 'lost' : 'playing',
      wave: game.wave,
      cleared: game.cleared,
      lives: game.lives,
      score: game.score,
      gameMinutes: +((game.tick * DT) / 60).toFixed(1),
    }
    bench.result.perWave = bench.perWave
    bench.result.peaks = { enemies: bench.peakEnemies, projectiles: bench.peakProjectiles, particles: bench.peakParticles }
  }
}

// ---- The loop ----

const loop = new GameLoop({
  step: () => {
    if (stressMode) stress.step(game)
    bot?.step()
    game.step()
  },
  render: (alpha, realDt, now) => {
    frameNow = now
    // While paused, apply queued commands without stepping, so building,
    // upgrading and selling work in a paused game. No game time passes.
    if (loop.stepper.paused && game.phase === Phase.Playing) game.applyCommands()
    sfx.frame()
    game.events.drain(onEvent)
    input.update(realDt)
    renderer.render(alpha, realDt)
    hudState.speed = GAME_SPEEDS[speedIndex]
    hudState.paused = screens.current === 'pause'
    hudState.muted = settings.muted
    hudState.building = controls.buildType
    hud.update(game, hudState, now)
    panel.update()
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
if (benchSeconds > 0 || fullRun) Object.assign(window, { __bench: bench })

// Dev builds only: expose state for scripts/shot.mjs and console debugging.
if (import.meta.env.DEV) Object.assign(window, { __td: { game, camera, renderer, controls, screens, hud, sfx, loop, recorder } })
