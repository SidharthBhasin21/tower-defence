// Plays full games with the scripted bot (src/sim/bot.ts) and prints how far
// each strategy gets. Runs the real simulation in Node, no browser.
//
//   node scripts/balance.mjs [--seeds 3] [--waves] [--margin]
//
// --waves also prints, for the reference bot, the lives lost and the gold in
// hand at the end of each wave (to see where the difficulty bites).
// --margin finds how much fire rate the reference bot can lose and still
// win: margin 1.44 means it still wins with every tower firing at
// 1/1.44 = 69% speed. It measures how much slack a strong player has.
// Node 22.18+ runs the TypeScript sources directly (type stripping).
import { Bot, REFERENCE_PLAN, WEAK_PLAN, singleTowerPlan } from '../src/sim/bot.ts'
import { ENEMIES, TOWERS } from '../src/config.ts'
import { Ev } from '../src/sim/events.ts'
import { Game, Phase } from '../src/sim/game.ts'

const args = process.argv.slice(2)
const seeds = Number(args[args.indexOf('--seeds') + 1] || 0) || 3
const showWaves = args.includes('--waves')
const showMargin = args.includes('--margin')
const MAX_STEPS = 400_000

export function play(plan, seed, fireMul = 1) {
  const g = new Game(seed)
  g.fireRateMul = fireMul
  const bot = new Bot(g, plan)
  const perWave = []
  /** Lives lost per enemy type, to see what actually ends a game. */
  const leaks = {}
  let livesAtStart = g.lives
  for (let i = 0; i < MAX_STEPS && g.phase === Phase.Playing; i++) {
    bot.step()
    g.step()
    g.events.drain((type, a, b) => {
      if (type === Ev.Leak) leaks[ENEMIES[a].name] = (leaks[ENEMIES[a].name] ?? 0) + b
      if (type === Ev.WaveCleared) {
        perWave[a - 1] = { lost: livesAtStart - g.lives, gold: Math.floor(g.gold) }
        livesAtStart = g.lives
      }
    })
  }
  const levels = [0, 0, 0, 0, 0]
  const counts = [0, 0, 0, 0, 0]
  for (let i = 0; i < g.towers.count; i++) {
    counts[g.towers.type[i]]++
    levels[g.towers.type[i]] += g.towers.level[i]
  }
  return {
    won: g.phase === Phase.Won,
    cleared: g.cleared,
    // The newest wave in play when the game ended (waves overlap, so it can be past the first uncleared one).
    diedOn: g.phase === Phase.Won ? 0 : g.wave,
    leaks: Object.entries(leaks).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', '),
    lives: g.lives,
    score: g.score,
    minutes: +(g.tick / 60 / 60).toFixed(1),
    towers: counts.map((c, t) => (c ? `${TOWERS[t].name} ${c}×L${(levels[t] / c).toFixed(1)}` : '')).filter(Boolean).join(', '),
    perWave,
  }
}

const plans = [
  ['reference', REFERENCE_PLAN],
  ['weak', WEAK_PLAN],
  ...TOWERS.map((t, i) => [`only ${t.name}`, singleTowerPlan(i)]),
]
const rows = []
for (const [name, plan] of plans) {
  for (let seed = 1; seed <= seeds; seed++) {
    const r = play(plan, seed)
    rows.push({ plan: name, seed, result: r.won ? 'WON' : 'lost', 'died on': r.diedOn || '-', cleared: r.cleared, lives: r.lives, 'lives lost to': r.leaks || '-', towers: r.towers })
    if (showWaves && name === 'reference' && seed === 1)
      console.log('reference, seed 1, per wave:', r.perWave.map((w, i) => `${i + 1}:-${w?.lost ?? '?'}/${w?.gold ?? '?'}g`).join(' '))
  }
}
console.table(rows)

if (showMargin) {
  for (let seed = 1; seed <= seeds; seed++) {
    // Binary search on the fire-rate multiplier the reference bot still wins with.
    let lo = 0.2
    let hi = 1
    if (!play(REFERENCE_PLAN, seed, 1).won) {
      console.log(`seed ${seed}: reference bot loses even at full strength`)
      continue
    }
    for (let k = 0; k < 7; k++) {
      const mid = (lo + hi) / 2
      if (play(REFERENCE_PLAN, seed, mid).won) hi = mid
      else lo = mid
    }
    const lost = play(REFERENCE_PLAN, seed, lo)
    console.log(`seed ${seed}: margin ${(1 / hi).toFixed(2)} (wins at ${(hi * 100).toFixed(0)}% fire rate; at ${(lo * 100).toFixed(0)}% it dies on wave ${lost.diedOn})`)
  }
}
