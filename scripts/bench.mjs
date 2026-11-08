// Stress benchmark (ARCHITECTURE.md §7.3).
//
// Builds the production bundle, serves it with `vite preview`, and runs the
// stress scenario in the installed Google Chrome via playwright-core. Each
// scenario warms up for 3 s, then records every frame for --seconds. Results
// are written to bench/results/<scenario>.json and summarised on stdout.
//
//   npm run bench                         all scenarios, headed Chrome window
//   npm run bench -- --headless           no window (timings less representative)
//   npm run bench -- --seconds 30 --only fit,interactive
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const seconds = Number(opt('--seconds', '20'))
const only = opt('--only', '')
const headless = args.includes('--headless')
const PORT = 4173

const SCENARIOS = [
  { name: 'stress-fit', query: `?stress&bench=${seconds}`, about: 'Whole map in view: every object is drawn (worst case for rendering)' },
  { name: 'stress-zoom', query: `?stress&bench=${seconds}&zoom=2.5`, about: 'Zoomed in 2.5x at the map centre: culling skips off-screen objects' },
  {
    name: 'stress-interactive',
    query: `?stress&bench=${seconds}`,
    about: 'Whole map, while the script pans, zooms, selects towers and toggles build mode',
    interact: true,
  },
  {
    name: 'control-interactive',
    query: `?bench=${seconds}`,
    about: 'Control: the same scripted input on a near-empty game, to measure what the input harness itself costs',
    interact: true,
  },
].filter((s) => !only || only.split(',').some((o) => s.name.endsWith(o)))

console.log('Building production bundle…')
execSync('npm run build', { stdio: 'inherit' })

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' })
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && resolve())
  server.on('exit', (code) => reject(new Error(`vite preview exited with ${code}`)))
})

mkdirSync('bench/results', { recursive: true })
// Chrome's Energy Saver caps pages at 30 FPS on low battery, which would hide
// the game's real frame rate. Measure on mains power; this flag is a fallback.
const browser = await chromium.launch({
  channel: 'chrome',
  headless,
  args: ['--disable-features=BatterySaverModeAvailable'],
})
const summary = []
try {
  for (const sc of SCENARIOS) {
    console.log(`\n▶ ${sc.name}: ${sc.about}`)
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PORT}/${sc.query}`)
    await page.waitForFunction(() => window.__bench?.phase === 'measure', null, { timeout: 30000 })
    if (sc.interact) await interact(page, seconds * 1000)
    await page.waitForFunction(() => window.__bench?.phase === 'done', null, { timeout: seconds * 1000 + 30000, polling: 500 })
    const result = await page.evaluate(() => window.__bench.result)
    result.scenario = sc.name
    result.about = sc.about
    result.headless = headless
    result.machine = { cpu: cpus()[0]?.model, cores: cpus().length, chrome: browser.version() }
    result.errors = errors
    writeFileSync(`bench/results/${sc.name}.json`, JSON.stringify(result, null, 2) + '\n')
    const s = result.stats
    const pass = s.fpsAtP95 >= 45 && s.slowPct < 5
    summary.push({
      scenario: sc.name,
      pass: pass ? 'PASS' : 'FAIL',
      'avg fps': s.avgFps.toFixed(1),
      'p95 ms': s.p95.toFixed(2),
      'fps@p95': s.fpsAtP95.toFixed(1),
      '>33ms %': s.slowPct.toFixed(2),
      'sim ms': s.simAvg.toFixed(2),
      'render ms': s.renderAvg.toFixed(2),
      'min enemies': result.counts.minEnemies,
      'min proj': result.counts.minProjectiles,
      drawn: result.counts.avgDrawn,
      'input ms': s.inputEvents ? `${s.inputAvg.toFixed(1)} / ${s.inputMax.toFixed(1)}` : '-',
      'heap MB': result.heapMB ? `${result.heapMB.start}→${result.heapMB.end}` : '-',
    })
    await page.close()
  }
} finally {
  await browser.close()
  server.kill()
}
console.log('\nResults (frame interval = time between requestAnimationFrame callbacks; input ms = avg / max)')
console.table(summary)
writeFileSync('bench/results/summary.json', JSON.stringify(summary, null, 2) + '\n')

/** Keeps a player busy for `ms`: drag-pans, wheel zooms, tower clicks and build-mode toggles. */
async function interact(page, ms) {
  const end = Date.now() + ms - 500
  let k = 0
  while (Date.now() < end) {
    const x = 400 + ((k * 137) % 700)
    const y = 250 + ((k * 89) % 400)
    switch (k % 4) {
      case 0:
        await page.mouse.move(x, y)
        await page.mouse.down({ button: 'right' })
        await page.mouse.move(x + 120, y + 60, { steps: 8 })
        await page.mouse.up({ button: 'right' })
        break
      case 1:
        await page.mouse.move(x, y)
        await page.mouse.wheel(0, k % 8 < 4 ? -240 : 240)
        break
      case 2:
        await page.mouse.click(x, y)
        break
      case 3:
        await page.keyboard.press('Digit1')
        await page.mouse.move(x + 40, y + 40, { steps: 5 })
        await page.keyboard.press('Escape')
        break
    }
    k++
    await page.waitForTimeout(120)
  }
}
