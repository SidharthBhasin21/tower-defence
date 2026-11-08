import './style.css'
import { GameLoop } from './loop.ts'
import { Camera } from './render/camera.ts'
import { Renderer } from './render/renderer.ts'
import { Game } from './sim/game.ts'
import { CameraInput } from './ui/input.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#game')
if (!canvas) throw new Error('Missing #game canvas')

const game = new Game()
const camera = new Camera()
const renderer = new Renderer(canvas, camera, game)
const input = new CameraInput(canvas, camera)

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
}
window.addEventListener('resize', resize)
resize()
camera.fit()

const loop = new GameLoop({
  step: () => game.step(),
  render: (alpha, realDt) => {
    input.update(realDt)
    renderer.render(alpha)
  },
})
loop.start()
