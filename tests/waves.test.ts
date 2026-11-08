import { describe, expect, it } from 'vitest'
import {
  CLEAR_GOLD_BASE,
  CLEAR_GOLD_PER_WAVE,
  DT,
  ENEMIES,
  EnemyType,
  START_GOLD,
  START_LIVES,
  TowerType,
  WAVE_COUNT,
  WAVE_GAP,
  WIN_SCORE_PER_LIFE,
} from '../src/config.ts'
import { FixedStepper } from '../src/loop.ts'
import { Rng } from '../src/rng.ts'
import { Cmd } from '../src/sim/commands.ts'
import { Ev } from '../src/sim/events.ts'
import { Game, Phase } from '../src/sim/game.ts'
import { PATH_A, PATH_AIR, PATH_B, WAVES } from '../src/sim/waves.ts'

/** Kills every living enemy (a stand-in for a perfect defence). */
function killAll(g: Game): void {
  const e = g.enemies
  for (let k = 0; k < e.count; k++) {
    const s = e.active[k]
    if (e.alive[s]) g.damage(s, 1e9)
  }
}

/** Steps until the newest wave has spawned everything. */
function stepUntilSpawned(g: Game, limit = 20_000): void {
  for (let i = 0; i < limit && g.spawning > 0; i++) g.step()
}

describe('Wave generator', () => {
  it('builds exactly 50 waves, each with enemies', () => {
    expect(WAVES).toHaveLength(WAVE_COUNT)
    WAVES.forEach((w, i) => {
      expect(w.number).toBe(i + 1)
      expect(w.total).toBeGreaterThan(0)
      expect(w.groups.reduce((n, gr) => n + gr.count, 0)).toBe(w.total)
    })
  })

  it('never gets easier from one wave to the next', () => {
    for (let i = 1; i < WAVES.length; i++) {
      expect(WAVES[i].threat, `threat, wave ${i + 1}`).toBeGreaterThanOrEqual(WAVES[i - 1].threat)
      expect(WAVES[i].hpMul).toBeGreaterThan(WAVES[i - 1].hpMul)
    }
  })

  it('makes the last wave much harder than the first', () => {
    expect(WAVES[WAVE_COUNT - 1].threat / WAVES[0].threat).toBeGreaterThan(50)
    expect(WAVES[WAVE_COUNT - 1].total).toBeGreaterThan(WAVES[0].total * 5)
  })

  it('introduces enemy types on schedule, and every type appears', () => {
    const first = new Map<number, number>()
    for (const w of WAVES) for (const g of w.groups) if (!first.has(g.type)) first.set(g.type, w.number)
    expect(Object.fromEntries([...first].map(([t, w]) => [ENEMIES[t].name, w]))).toEqual({
      Grunt: 1,
      Runner: 3,
      Swarmling: 5,
      Brute: 7,
      Wisp: 9,
      Warlord: 10,
      Mender: 12,
    })
  })

  it('puts Warlords on waves 10, 20, 30, 40 and 50 only, more of them later', () => {
    const counts = WAVES.map((w) => w.groups.find((g) => g.type === EnemyType.Warlord)?.count ?? 0)
    WAVES.forEach((w, i) => expect(counts[i] > 0, `wave ${w.number}`).toBe(w.number % 10 === 0))
    expect(counts[49]).toBeGreaterThan(counts[9])
  })

  it('sends flyers only on the air route and ground enemies only on ground paths', () => {
    for (const w of WAVES)
      for (const g of w.groups) expect(g.pathMask).toBe(ENEMIES[g.type].air ? PATH_AIR : PATH_A | PATH_B)
  })
})

describe('Wave flow', () => {
  it('waits for the player before wave 1', () => {
    const g = new Game()
    for (let i = 0; i < 600; i++) g.step()
    expect(g.wave).toBe(0)
    expect(g.enemies.aliveCount).toBe(0)
    expect(g.countdown).toBe(-1)
  })

  it('spawns a whole wave with scaled health, tagged with its wave', () => {
    const g = new Game()
    g.callNextWave()
    expect(g.wave).toBe(1)
    stepUntilSpawned(g)
    expect(g.spawning).toBe(0)
    expect(g.enemies.aliveCount + (START_LIVES - g.lives)).toBe(WAVES[0].total)
    const s = g.enemies.active[0]
    expect(g.enemies.waveId[s]).toBe(0)
    expect(g.enemies.maxHp[s]).toBeCloseTo(ENEMIES[g.enemies.type[s]].hp * WAVES[0].hpMul)
  })

  it('counts down once a wave has spawned, then starts the next on its own', () => {
    const g = new Game()
    g.callNextWave()
    stepUntilSpawned(g)
    g.step()
    expect(g.countdown).toBeGreaterThan(0)
    const gap = Math.round(WAVE_GAP / DT)
    for (let i = 0; i < gap + 1 && g.wave === 1; i++) g.step()
    expect(g.wave).toBe(2)
    expect(g.countdown).toBe(-1)
  })

  it('refuses an early call while the current wave is still spawning', () => {
    const g = new Game()
    g.callNextWave()
    g.step()
    expect(g.spawning).toBeGreaterThan(0)
    expect(g.callNextWave()).toBe(false)
    expect(g.wave).toBe(1)
  })

  it('pays gold for the seconds skipped by an early call', () => {
    const g = new Game()
    g.callNextWave()
    stepUntilSpawned(g)
    g.step()
    killAll(g)
    g.step() // wave 1 clears here, paying its bonus
    const before = g.gold
    const secs = Math.ceil(g.countdown * DT)
    g.commands.push(Cmd.NextWave)
    g.step()
    expect(g.wave).toBe(2)
    expect(g.gold).toBe(before + secs)
    let early = -1
    g.events.drain((type, a, b) => {
      if (type === Ev.WaveStart && a === 2) early = b
    })
    expect(early).toBe(secs)
  })

  it('pays a bonus when every enemy of a wave is gone', () => {
    const g = new Game()
    g.callNextWave()
    stepUntilSpawned(g)
    killAll(g)
    const goldBefore = g.gold
    g.step()
    expect(g.cleared).toBe(1)
    expect(g.gold).toBe(goldBefore + CLEAR_GOLD_BASE + CLEAR_GOLD_PER_WAVE * 1)
  })

  it('lets called-early waves overlap', () => {
    const g = new Game()
    g.callNextWave()
    stepUntilSpawned(g)
    g.step()
    expect(g.callNextWave()).toBe(true)
    // Wave 1's enemies are still walking while wave 2 spawns.
    expect(g.enemies.aliveCount).toBeGreaterThan(0)
    expect(g.wave).toBe(2)
  })
})

describe('Game end', () => {
  it('is lost when lives reach 0, and the sim then stops', () => {
    const g = new Game()
    g.callNextWave()
    for (let i = 0; i < 200_000 && g.phase === Phase.Playing; i++) {
      if (g.canCallWave()) g.callNextWave()
      g.step()
    }
    expect(g.phase).toBe(Phase.Lost)
    expect(g.lives).toBe(0)
    const tick = g.tick
    g.step()
    expect(g.tick).toBe(tick)
  })

  it('is won by clearing all 50 waves, with a bonus for lives left', () => {
    const g = new Game()
    let victory = -1
    for (let i = 0; i < 400_000 && g.phase === Phase.Playing; i++) {
      if (g.canCallWave()) g.callNextWave()
      g.step()
      killAll(g)
      g.events.drain((type, a) => {
        if (type === Ev.Victory) victory = a
      })
    }
    expect(g.phase).toBe(Phase.Won)
    expect(g.cleared).toBe(WAVE_COUNT)
    expect(g.lives).toBe(START_LIVES)
    expect(victory).toBe(g.score)
    expect(g.score).toBeGreaterThan(START_LIVES * WIN_SCORE_PER_LIFE)
    expect(g.scheduler.dropped).toBe(0)
  })

  it('restart returns to wave 0 with fresh resources', () => {
    const g = new Game()
    g.callNextWave()
    for (let i = 0; i < 900; i++) g.step()
    g.reset()
    expect(g.phase).toBe(Phase.Playing)
    expect(g.wave).toBe(0)
    expect(g.cleared).toBe(0)
    expect(g.countdown).toBe(-1)
    expect(g.gold).toBe(START_GOLD)
    expect(g.scheduler.count).toBe(0)
    for (let i = 0; i < 300; i++) g.step()
    expect(g.enemies.aliveCount).toBe(0)
  })
})

describe('Determinism across refresh rates and speeds', () => {
  /**
   * Plays the same scripted game (towers, early calls) driven by real-time
   * frames of the given length at a game speed, and returns its final state.
   */
  function play(frameDt: () => number, speed: number, steps: number): number[] {
    const g = new Game(9)
    const stepper = new FixedStepper()
    stepper.speed = speed
    const sites: [number, number][] = [[3, 4], [8, 7], [14, 6], [9, 17], [23, 10], [29, 15]]
    while (g.tick < steps) {
      const n = stepper.advance(frameDt())
      for (let i = 0; i < n && g.tick < steps; i++) {
        // Commands keyed to the tick, as a player's input lands on a step.
        if (g.tick === 0) for (const [x, y] of sites.slice(0, 4)) g.commands.push(Cmd.Place, TowerType.Bolt, x, y)
        if (g.tick === 5) g.commands.push(Cmd.NextWave)
        if (g.tick === 1500) for (const [x, y] of sites.slice(4)) g.commands.push(Cmd.Place, TowerType.Bolt, x, y)
        if (g.tick % 900 === 0) g.commands.push(Cmd.NextWave)
        g.step()
      }
    }
    const e = g.enemies
    let sum = 0
    for (let k = 0; k < e.count; k++) sum += e.x[e.active[k]] + e.hp[e.active[k]]
    return [g.tick, g.wave, g.cleared, g.lives, g.gold, g.score, g.kills, e.aliveCount, g.projectiles.count, sum]
  }

  it('ends in identical state at 60 Hz, 144 Hz, jittery frames and 4× speed', () => {
    const steps = 6000
    const ref = play(() => 1 / 60, 1, steps)
    expect(ref[6]).toBeGreaterThan(0) // the towers really fought
    expect(play(() => 1 / 144, 1, steps)).toEqual(ref)
    const rng = new Rng(3)
    expect(play(() => rng.range(0.004, 0.05), 1, steps)).toEqual(ref)
    expect(play(() => 1 / 60, 4, steps)).toEqual(ref)
    expect(play(() => 1 / 144, 2, steps)).toEqual(ref)
  })
})
