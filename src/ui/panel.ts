import { MAX_LEVEL, TOWERS, TowerType, towerStats, upgradeCost, type TowerDef } from '../config.ts'
import { Cmd } from '../sim/commands.ts'
import type { Game } from '../sim/game.ts'
import { TARGET_MODE_NAMES } from '../sim/towers.ts'
import type { Controls } from './controls.ts'

const STYLE = `
.td-panel{position:absolute;left:12px;bottom:12px;width:260px;padding:12px 14px;border-radius:12px;
  background:rgba(14,24,18,0.92);border:1px solid #2f4a37;color:#e8efe9;font:13px/1.45 system-ui,sans-serif;
  pointer-events:auto;box-shadow:0 10px 30px rgba(0,0,0,0.35);display:none}
.td-panel.on{display:block}
.td-panel h2{margin:0;font-size:17px;display:flex;justify-content:space-between;align-items:baseline}
.td-panel .lv{font-size:12px;color:#f2c95c;letter-spacing:2px}
.td-panel .blurb{margin:4px 0 8px;color:#9fb3a5;font-size:12px}
.td-panel table{width:100%;border-collapse:collapse;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
.td-panel td:last-child{text-align:right}
.td-panel .up{color:#8ee28e}
.td-panel .modes{display:flex;gap:4px;margin:8px 0}
.td-panel .modes button{flex:1;padding:4px 0;border-radius:6px;border:1px solid #3d5a46;background:transparent;
  color:#c9d6cc;font:600 11px system-ui,sans-serif;cursor:pointer}
.td-panel .modes button.on{background:#2c5a3a;color:#fff;border-color:#5f9a6e}
.td-panel .note{margin:8px 0;color:#9fb3a5;font-size:12px}
.td-panel .acts{display:flex;gap:6px;margin-top:4px}
.td-panel .acts button{flex:1;padding:7px 0;border-radius:8px;border:1px solid #4d7a5a;background:#2c5a3a;color:#fff;
  font:600 13px system-ui,sans-serif;cursor:pointer}
.td-panel .acts button:disabled{opacity:0.45;cursor:default}
.td-panel .acts button.sell{background:#5a2c2c;border-color:#8a4d4d}
.td-panel kbd{font:11px ui-monospace,monospace;opacity:0.7;margin-left:4px}
`

/**
 * Selected-tower panel (ARCHITECTURE.md §6): stats, the next level's gains,
 * targeting mode, upgrade and sell. Every change goes through the command
 * queue. The DOM is rebuilt only when something shown changes.
 */
export class TowerPanel {
  private readonly el: HTMLElement
  private readonly game: Game
  private readonly controls: Controls
  /** Tile, level, mode, affordability and refund last shown. */
  private readonly last = new Float64Array(5).fill(Number.NaN)

  constructor(parent: HTMLElement, game: Game, controls: Controls) {
    this.game = game
    this.controls = controls
    const style = document.createElement('style')
    style.textContent = STYLE
    document.head.append(style)
    this.el = document.createElement('div')
    this.el.className = 'td-panel'
    parent.append(this.el)
    // Keep pointer events on the panel from reaching the canvas handlers.
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation())
  }

  update(): void {
    const g = this.game
    const i = this.controls.selectedTower()
    const l = this.last
    if (i < 0) {
      if (l[0] !== -1) {
        l.fill(Number.NaN)
        l[0] = -1
        this.el.classList.remove('on')
      }
      return
    }
    const t = g.towers
    const tile = t.ty[i] * g.map.width + t.tx[i]
    const cost = upgradeCost(t.type[i], t.level[i])
    const canAfford = cost > 0 && g.gold >= cost ? 1 : 0
    const refund = g.sellValue(t.tx[i], t.ty[i])
    if (l[0] === tile && l[1] === t.level[i] && l[2] === t.targetMode[i] && l[3] === canAfford && l[4] === refund) return
    l[0] = tile
    l[1] = t.level[i]
    l[2] = t.targetMode[i]
    l[3] = canAfford
    l[4] = refund
    this.build(i, cost, canAfford === 1, refund)
    this.el.classList.add('on')
  }

  private build(i: number, cost: number, canAfford: boolean, refund: number): void {
    const g = this.game
    const t = g.towers
    const type = t.type[i]
    const level = t.level[i]
    const tx = t.tx[i]
    const ty = t.ty[i]
    const now = towerStats(type, level)
    const next = level < MAX_LEVEL ? towerStats(type, level + 1) : null
    const el = this.el
    el.replaceChildren()

    const h = document.createElement('h2')
    h.textContent = TOWERS[type].name
    const lv = document.createElement('span')
    lv.className = 'lv'
    lv.textContent = '●'.repeat(level) + '○'.repeat(MAX_LEVEL - level)
    lv.title = `Level ${level} of ${MAX_LEVEL}`
    h.append(lv)
    const blurb = document.createElement('div')
    blurb.className = 'blurb'
    blurb.textContent = TOWERS[type].blurb
    el.append(h, blurb)

    const table = document.createElement('table')
    for (const [label, a, b] of statRows(type, now, next)) {
      const tr = document.createElement('tr')
      const td1 = document.createElement('td')
      td1.textContent = label
      const td2 = document.createElement('td')
      td2.textContent = a
      if (b && b !== a) {
        const up = document.createElement('span')
        up.className = 'up'
        up.textContent = ` → ${b}`
        td2.append(up)
      }
      tr.append(td1, td2)
      table.append(tr)
    }
    el.append(table)

    if (type === TowerType.Frost) {
      const note = document.createElement('div')
      note.className = 'note'
      note.textContent = 'Pulses at everything in range, so it has no target mode.'
      el.append(note)
    } else {
      const modes = document.createElement('div')
      modes.className = 'modes'
      TARGET_MODE_NAMES.forEach((name, m) => {
        const b = document.createElement('button')
        b.textContent = name
        b.title = 'Targeting mode (T cycles)'
        if (m === t.targetMode[i]) b.className = 'on'
        b.addEventListener('click', () => g.commands.push(Cmd.SetTarget, tx, ty, m))
        modes.append(b)
      })
      el.append(modes)
    }

    const acts = document.createElement('div')
    acts.className = 'acts'
    const up = document.createElement('button')
    up.innerHTML = next ? `Upgrade ${cost}g<kbd>U</kbd>` : 'Max level'
    up.disabled = !next || !canAfford
    up.addEventListener('click', () => g.commands.push(Cmd.Upgrade, tx, ty))
    const sell = document.createElement('button')
    sell.className = 'sell'
    sell.innerHTML = `Sell +${refund}g<kbd>X</kbd>`
    sell.addEventListener('click', () => g.commands.push(Cmd.Sell, tx, ty))
    acts.append(up, sell)
    el.append(acts)
  }
}

/** Rows of [label, now, next level] for the panel. */
function statRows(type: number, now: TowerDef, next: TowerDef | null): [string, string, string | null][] {
  const f = (v: number, d = 0): string => v.toFixed(d)
  const rows: [string, string, string | null][] = [
    ['Damage', f(now.damage, now.damage < 10 ? 1 : 0), next && f(next.damage, next.damage < 10 ? 1 : 0)],
    ['Range', f(now.range), next && f(next.range)],
    ['Rate', `${f(now.fireRate, 2)}/s`, next && `${f(next.fireRate, 2)}/s`],
  ]
  if (type === TowerType.Cannon) rows.push(['Splash', f(now.splash), next && f(next.splash)])
  if (type === TowerType.Frost) {
    rows.push(['Slow', `${f((1 - now.slow) * 100)}%`, next && `${f((1 - next.slow) * 100)}%`])
    rows.push(['Slow time', `${f(now.slowTime, 1)}s`, next && `${f(next.slowTime, 1)}s`])
  }
  if (type === TowerType.Arc) rows.push(['Jumps', f(now.chains), next && f(next.chains)])
  rows.push(['Targets', now.hitsAir ? 'ground + air' : 'ground only', null])
  if (type === TowerType.Sniper) rows.push(['Armor', 'ignored', null])
  if (type === TowerType.Arc) rows.push(['Armor', 'counts half', null])
  return rows
}
