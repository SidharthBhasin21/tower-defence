import './style.css'
import { GameLoop } from './loop.ts'
import { Camera } from './render/camera.ts'
import { Renderer } from './render/renderer.ts'
import { DemoSpawner } from './sim/demo.ts'
import { Ev } from './sim/events.ts'
import { Game } from './sim/game.ts'
import { DebugReadout } from './ui/debug.ts'
import { CameraInput } from './ui/input.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#game')
const ui = document.querySelector<HTMLElement>('#ui')
if (!canvas || !ui) throw new Error('Missing #game canvas or #ui layer')

const game = new Game()
const camera = new Camera()
const renderer = new Renderer(canvas, camera, game)
const input = new CameraInput(canvas, camera)
const demo = new DemoSpawner()
const readout = new DebugReadout(ui)

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
}
window.addEventListener('resize', resize)
resize()
camera.fit()

// Temporary until waves exist (feature 5): G spawns a burst of Grunts.
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyG' && !e.repeat && !e.metaKey && !e.ctrlKey) demo.requestBurst(50)
})

/** Sim → client events, drained once per frame. Bound once; allocates nothing. */
function onEvent(type: number): void {
  if (type === Ev.Leak) renderer.flashBase()
}

const loop = new GameLoop({
  step: () => {
    demo.step(game)
    game.step()
  },
  render: (alpha, realDt) => {
    game.events.drain(onEvent)
    input.update(realDt)
    renderer.render(alpha, realDt)
    readout.update(game, renderer.drawnEnemies)
  },
})
loop.start()

// Dev builds only: expose state for scripts/shot.mjs and console debugging.
if (import.meta.env.DEV) Object.assign(window, { __td: { game, camera, renderer, demo, loop } })
