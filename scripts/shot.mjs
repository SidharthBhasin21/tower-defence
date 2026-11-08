// Opens the running dev server in the installed Google Chrome (real time,
// real requestAnimationFrame), optionally runs a few actions, prints game
// state and saves a screenshot.
//
//   node scripts/shot.mjs [url] [--wait ms] [--keys KeyG,KeyG] [--out file.png] [--headed]
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

const browser = await chromium.launch({ channel: 'chrome', headless: !args.includes('--headed') })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto(url)
await page.waitForTimeout(500)
for (const k of keys) await page.keyboard.press(k)
await page.waitForTimeout(wait)
const state = await page.evaluate(() => {
  const td = window.__td
  if (!td) return null
  const { game, renderer } = td
  return {
    tick: game.tick,
    simSeconds: +game.time.toFixed(2),
    lives: game.lives,
    enemies: game.enemies.aliveCount,
    drawn: renderer.drawnEnemies,
  }
})
await page.screenshot({ path: out })
console.log(JSON.stringify({ state, errors, screenshot: out }, null, 2))
await browser.close()
