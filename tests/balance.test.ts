import { describe, expect, it } from 'vitest'
import { TOWERS, WAVE_COUNT } from '../src/config.ts'
import { Bot, REFERENCE_PLAN, WEAK_PLAN, singleTowerPlan, type BotPlan } from '../src/sim/bot.ts'
import { Game, Phase } from '../src/sim/game.ts'

/**
 * Balance checks (DOMAIN.md §5, ARCHITECTURE.md §8): full 50-wave games
 * played by the scripted bot. `scripts/balance.mjs` prints the same games in
 * more detail.
 */
function play(plan: BotPlan, fireRateMul = 1): Game {
  const g = new Game(1)
  g.fireRateMul = fireRateMul
  const bot = new Bot(g, plan)
  for (let i = 0; i < 400_000 && g.phase === Phase.Playing; i++) {
    bot.step()
    g.step()
    g.events.clear()
  }
  return g
}

describe('Balance', () => {
  it('the reference bot clears all 50 waves', () => {
    const g = play(REFERENCE_PLAN)
    expect(g.phase).toBe(Phase.Won)
    expect(g.cleared).toBe(WAVE_COUNT)
  }, 30_000)

  it('leaves a strong player some slack, but not too much', () => {
    // Still wins with every tower firing 20% slower...
    expect(play(REFERENCE_PLAN, 0.8).phase).toBe(Phase.Won)
    // ...but at 60% speed the late waves are too much.
    const g = play(REFERENCE_PLAN, 0.6)
    expect(g.phase).toBe(Phase.Lost)
    expect(g.cleared).toBeGreaterThanOrEqual(20) // it falls late, not on the first boss
  }, 60_000)

  it('a weak player (a few Bolts, never upgraded) loses', () => {
    const g = play(WEAK_PLAN)
    expect(g.phase).toBe(Phase.Lost)
    expect(g.cleared).toBeLessThan(WAVE_COUNT)
  }, 30_000)

  for (let type = 0; type < TOWERS.length; type++) {
    it(`building only ${TOWERS[type].name} towers loses`, () => {
      expect(play(singleTowerPlan(type)).phase).toBe(Phase.Lost)
    }, 30_000)
  }
})
