// Opens the running dev server in the installed Google Chrome (real time,
// real requestAnimationFrame), optionally runs a few actions, prints game
// state and saves a screenshot.
//
//   node scripts/shot.mjs [url] [--wait ms] [--keys Space,KeyF] [--build 7,5;8,5]
//                         [--hover tx,ty] [--gold n] [--size 1440x900] [--out file.png] [--headed]
//
// --build presses a tower key and Shift-clicks each tile (tile coords), like a
// player. Prefix a tile with "k@" to pick tower k (default 1): "2@7,6;3@5,7".
// --hover leaves the pointer over a tile in build mode, to show the preview.
// Pass a URL with ?play to skip the title screen.
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/'
const wait = Number(opt('--wait', '3000'))
const keys = opt('--keys', '').split(',').filter(Boolean)
const out = opt('--out', 'shot.png')
const tiles = (v) => (v ? v.split(';').map((p) => p.replace(/^\d@/, '').split(',').map(Number)) : [])
const builds = (opt('--build', '') || '').split(';').filter(Boolean).map((p) => {
  const m = p.match(/^(\d)@(.*)$/)
  return { key: m ? m[1] : '1', tile: (m ? m[2] : p).split(',').map(Number) }
})
const hoverTile = tiles(opt('--hover', ''))[0]

/** Screen position (CSS px) of a tile centre, via the game's camera. */
const tileToScreen = (tx, ty) =>
  page.evaluate(([tx, ty]) => {
    const out = { x: 0, y: 0 }
    window.__td.camera.worldToScreen((tx + 0.5) * 32, (ty + 0.5) * 32, out)
    return out
  }, [tx, ty])

const browser = await chromium.launch({ channel: 'chrome', headless: !args.includes('--headed') })
const [vw, vh] = opt('--size', '1440x900').split('x').map(Number)
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto(url)
await page.waitForTimeout(500)
const gold = opt('--gold', '')
if (gold) await page.evaluate((n) => { window.__td.game.gold = n }, Number(gold))
for (const k of keys) await page.keyboard.press(k)
for (const { key, tile: [tx, ty] } of builds) {
  await page.keyboard.press(`Digit${key}`)
  const p = await tileToScreen(tx, ty)
  await page.mouse.click(p.x, p.y)
}
if (hoverTile) {
  await page.keyboard.press('Digit1')
  const p = await tileToScreen(hoverTile[0], hoverTile[1])
  await page.mouse.move(p.x, p.y)
}
await page.waitForTimeout(wait)
const state = await page.evaluate(() => {
  const td = window.__td
  if (!td) return null
  const { game, renderer } = td
  return {
    tick: game.tick,
    simSeconds: +game.time.toFixed(2),
    lives: game.lives,
    gold: game.gold,
    score: game.score,
    kills: game.kills,
    towers: game.towers.count,
    projectiles: game.projectiles.count,
    enemies: game.enemies.aliveCount,
    wave: game.wave,
    cleared: game.cleared,
    countdown: game.countdown,
    phase: game.phase,
    screen: td.screens.current,
    drawn: renderer.drawnEnemies,
  }
})
await page.screenshot({ path: out })
console.log(JSON.stringify({ state, errors, screenshot: out }, null, 2))
await browser.close()
