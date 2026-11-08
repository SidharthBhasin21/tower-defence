import './style.css'

// Feature 0: an empty canvas sized to the window and device pixel ratio.
// The game loop arrives in feature 1 (see ARCHITECTURE.md §3).

const canvas = document.querySelector<HTMLCanvasElement>('#game')
if (!canvas) throw new Error('Missing #game canvas')

const ctx = canvas.getContext('2d', { alpha: false })
if (!ctx) throw new Error('Canvas 2D is not supported')

function resize(): void {
  const dpr = window.devicePixelRatio || 1
  canvas!.width = Math.round(window.innerWidth * dpr)
  canvas!.height = Math.round(window.innerHeight * dpr)
  ctx!.fillStyle = '#0f1a14'
  ctx!.fillRect(0, 0, canvas!.width, canvas!.height)
}

window.addEventListener('resize', resize)
resize()
