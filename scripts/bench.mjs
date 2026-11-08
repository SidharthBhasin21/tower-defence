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
//   npm run bench -- --full               also the full 50-wave run (about 7 more minutes)
//   npm run bench -- --only full-run      just the full run
//
// The full run (?bot&speed=4&bench=full) has the reference bot play a whole
// normal game at 4× speed and measures every frame from start to finish. It
// also samples the JS heap each time a wave clears; the heap trend over the
// game (least-squares slope, MB per wave) must stay near zero.
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
const withFull = args.includes('--full') || only.includes('full')
/** The heap may drift by at most this much per wave over a full game. */
const MAX_HEAP_SLOPE = 0.05
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
  {
    name: 'full-run',
    query: '?bot&speed=4&bench=full',
    about: 'The reference bot plays all 50 waves of a normal game at 4x speed; every frame measured, heap sampled per wave',
    full: true,
  },
]
  .filter((s) => !s.full || withFull)
  .filter((s) => !only || only.split(',').some((o) => s.name.endsWith(o)))

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
  // Precise memory info: unquantized heap numbers for the per-wave memory check.
  args: ['--disable-features=BatterySaverModeAvailable', '--enable-precise-memory-info'],
})
const summary = []
try {
  for (const sc of SCENARIOS) {
    console.log(`\n▶ ${sc.name}: ${sc.about}`)
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    // Offline check (DOMAIN.md §4): everything must come from the local server.
    const external = []
    page.on('request', (r) => {
      const u = r.url()
      if (!u.startsWith(`http://localhost:${PORT}/`) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u)
    })
    await page.goto(`http://localhost:${PORT}/${sc.query}`)
    await page.waitForFunction(() => window.__bench?.phase === 'measure', null, { timeout: 30000 })
    if (sc.interact) await interact(page, seconds * 1000)
    const limit = sc.full ? 20 * 60_000 : seconds * 1000 + 30000
    await page.waitForFunction(() => window.__bench?.phase === 'done', null, { timeout: limit, polling: 1000 })
    const result = await page.evaluate(() => window.__bench.result)
    result.scenario = sc.name
    result.about = sc.about
    result.headless = headless
    result.machine = { cpu: cpus()[0]?.model, cores: cpus().length, chrome: browser.version() }
    result.errors = errors
    result.externalRequests = external
    if (external.length) console.log(`  ✗ ${external.length} requests left the machine: ${external.slice(0, 3).join(', ')}`)
    writeFileSync(`bench/results/${sc.name}.json`, JSON.stringify(result, null, 2) + '\n')
    const s = result.stats
    let pass = s.fpsAtP95 >= 45 && s.slowPct < 5 && external.length === 0 && errors.length === 0
    let memory = ''
    if (sc.full) {
      // Memory: the heap trend across waves, after the first few (JIT warm-up, first allocations).
      const pts = result.perWave.filter((w) => w.wave >= 5)
      const slope = heapSlope(pts)
      result.heapSlopeMBPerWave = +slope.toFixed(4)
      const won = result.outcome.phase === 'won'
      pass = pass && won && Math.abs(slope) <= MAX_HEAP_SLOPE
      const hs = pts.map((w) => w.heapMB)
      memory = `${Math.min(...hs).toFixed(1)}–${Math.max(...hs).toFixed(1)} MB, ${slope >= 0 ? '+' : ''}${slope.toFixed(3)} MB/wave`
      console.log(`  ${result.outcome.phase} on wave ${result.outcome.wave} with ${result.outcome.lives} lives, ${result.seconds} s real time; peaks: ${JSON.stringify(result.peaks)}`)
      console.log(`  heap per wave: ${memory}`)
      writeFileSync(`bench/results/${sc.name}.json`, JSON.stringify(result, null, 2) + '\n')
    }
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
      ...(memory ? { 'heap trend': memory } : {}),
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

/** Least-squares slope of heap MB against wave number. */
function heapSlope(pts) {
  const n = pts.length
  if (n < 2) return 0
  const mx = pts.reduce((a, p) => a + p.wave, 0) / n
  const my = pts.reduce((a, p) => a + p.heapMB, 0) / n
  let num = 0
  let den = 0
  for (const p of pts) {
    num += (p.wave - mx) * (p.heapMB - my)
    den += (p.wave - mx) ** 2
  }
  return den ? num / den : 0
}

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
