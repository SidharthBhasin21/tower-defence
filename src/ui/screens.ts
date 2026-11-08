import { ENEMIES, EnemyType, TOWERS, WAVE_COUNT } from '../config.ts'

/** One line per enemy for the help page (UI text only; stats live in config). */
const ENEMY_BLURB: Record<number, string> = {
  [EnemyType.Grunt]: 'The basic walker.',
  [EnemyType.Runner]: 'Fast and fragile.',
  [EnemyType.Swarmling]: 'Tiny, weak, and comes in crowds. Splash and chains shine.',
  [EnemyType.Brute]: 'Slow and armored. Bolts barely scratch it; Snipers ignore armor.',
  [EnemyType.Wisp]: 'Flies its own route. Only Bolt, Frost and Sniper can hit it.',
  [EnemyType.Mender]: 'Heals the enemies around it every few seconds. Kill it first.',
  [EnemyType.Warlord]: 'Boss on every 10th wave. Splits into Runners when it falls.',
}

/**
 * Full-screen panels over the game (ARCHITECTURE.md §6): title, how to play,
 * pause, restart confirmation, victory and game over. Panels are rebuilt only
 * when shown, never per frame.
 */

export type ScreenKind = 'title' | 'help' | 'pause' | 'confirm' | 'victory' | 'defeat'

export interface EndStats {
  score: number
  best: number
  newBest: boolean
  wavesCleared: number
  kills: number
  lives: number
}

export interface ScreenActions {
  play(): void
  resume(): void
  /** Restart, asking first when a game is in progress. */
  restart(): void
  /** Restart without asking (after confirming, or from an end screen). */
  restartNow(): void
  cancelConfirm(): void
  /** Best score so far, shown on the title. */
  best(): number
}

const STYLE = `
.td-screen{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:16px;
  background:radial-gradient(ellipse at center,rgba(8,16,11,0.55),rgba(4,8,6,0.82));pointer-events:auto;backdrop-filter:blur(3px)}
.td-screen.on{display:flex}
.td-card{width:min(460px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:30px 34px 26px;border-radius:18px;text-align:center;
  background:linear-gradient(180deg,#1b2c21,#132019);border:1px solid #35553f;box-shadow:0 24px 60px rgba(0,0,0,0.5);
  color:#eef4ef;font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;animation:td-in 0.18s ease-out}
.td-card.wide{width:min(620px,100%);text-align:left}
@keyframes td-in{from{opacity:0;transform:translateY(8px) scale(0.98)}}
.td-card h1{margin:0 0 4px;font-size:34px;letter-spacing:0.01em;text-align:center}
.td-card h1.win{color:#ffd864}
.td-card h1.lose{color:#ff8a80}
.td-card .sub{margin:0 0 6px;color:#a9bcae;text-align:center}
.td-card h3{margin:16px 0 6px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#8fb59b}
.td-card ul{margin:0;padding-left:18px;color:#cfdcd2;font-size:14px}
.td-card li{margin:2px 0}
.td-card .grid{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:14px;color:#cfdcd2}
.td-card .grid b{color:#eef4ef;white-space:nowrap}
.td-card .tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:18px 0 4px}
.td-card .tile{padding:10px 6px;border-radius:12px;background:rgba(0,0,0,0.22);border:1px solid #2c4433}
.td-card .tile .v{font-size:22px;font-weight:750;font-variant-numeric:tabular-nums}
.td-card .tile .k{font-size:12px;color:#9fb3a5}
.td-card .best{margin-top:10px;color:#ffd864;font-weight:650;text-align:center}
.td-card kbd{display:inline-block;min-width:20px;padding:0 5px;border-radius:5px;border:1px solid #4a6352;background:#0f1913;
  font:12px/18px ui-monospace,monospace;text-align:center;color:#dfe9e2}
.td-row{display:flex;gap:10px;justify-content:center;margin-top:22px;flex-wrap:wrap}
.td-btn{padding:10px 22px;border-radius:10px;border:1px solid #5a9a6a;background:#2f6b43;color:#fff;
  font:650 15px system-ui,sans-serif;cursor:pointer}
.td-btn:hover{background:#3a7f51}
.td-btn.alt{background:transparent;border-color:#4a5d50;color:#c9d6cc}
.td-btn.alt:hover{background:#22352a}
.td-btn.danger{background:#7a2e2a;border-color:#a3433c}
.td-btn.danger:hover{background:#8f3630}
`

export class Screens {
  private readonly root: HTMLElement
  private readonly card: HTMLElement
  private readonly actions: ScreenActions
  current: ScreenKind | null = null
  /** Where "Back" goes from the help page. */
  private helpFrom: ScreenKind = 'title'

  constructor(parent: HTMLElement, actions: ScreenActions) {
    this.actions = actions
    const style = document.createElement('style')
    style.textContent = STYLE
    document.head.append(style)
    this.root = document.createElement('div')
    this.root.className = 'td-screen'
    this.card = document.createElement('div')
    this.card.className = 'td-card'
    this.root.append(this.card)
    parent.append(this.root)
  }

  show(kind: ScreenKind, stats?: EndStats): void {
    if (kind === 'help' && this.current && this.current !== 'help') this.helpFrom = this.current
    this.current = kind
    this.card.replaceChildren()
    this.card.className = kind === 'help' ? 'td-card wide' : 'td-card'
    const a = this.actions
    switch (kind) {
      case 'title': {
        this.heading('Tower Defence')
        this.text(`Hold the base through ${WAVE_COUNT} waves. Build towers beside the paths; they aim and fire on their own.`, 'sub')
        const best = a.best()
        if (best > 0) this.line(`Best score ${best.toLocaleString('en-US')}`, 'best')
        this.buttons(['Play', a.play, ''], ['How to play', () => this.show('help'), 'alt'], ['Stress test', () => location.assign('?stress'), 'alt'])
        break
      }
      case 'help':
        this.help()
        this.buttons(['Back', () => this.show(this.helpFrom), ''])
        break
      case 'pause':
        this.heading('Paused')
        this.text('No game time passes. You can still build, upgrade and sell.', 'sub')
        this.buttons(['Resume', a.resume, ''], ['How to play', () => this.show('help'), 'alt'], ['Restart', a.restart, 'alt'])
        break
      case 'confirm':
        this.heading('Restart?')
        this.text('The current game will be lost.', 'sub')
        this.buttons(['Restart', a.restartNow, 'danger'], ['Keep playing', a.cancelConfirm, 'alt'])
        break
      case 'victory':
      case 'defeat':
        this.heading(kind === 'victory' ? 'Victory!' : 'Game over', kind === 'victory' ? 'win' : 'lose')
        this.text(kind === 'victory' ? `All ${WAVE_COUNT} waves held.` : 'The base has fallen.', 'sub')
        if (stats) this.endStats(stats)
        this.buttons(['Play again', a.restartNow, ''])
        break
    }
    this.root.classList.add('on')
  }

  /** Leaves the help page for the screen it was opened from. */
  back(): void {
    this.show(this.helpFrom)
  }

  hide(): void {
    this.current = null
    this.root.classList.remove('on')
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  }

  private help(): void {
    this.heading('How to play')
    this.section('Goal')
    this.list([
      `Enemies walk the paths to your base. Each one that gets through costs lives (bigger ones cost more).`,
      `Survive all ${WAVE_COUNT} waves to win. Lose every life and the game is over.`,
      'Kills pay gold. Clearing a wave pays a bonus, and calling the next wave early pays gold for the seconds you skip.',
    ])
    this.section('Towers')
    const towers = el('div', 'grid')
    for (const t of TOWERS) {
      const name = el('b')
      name.innerHTML = `<kbd>${t.key}</kbd> ${t.name} · ${t.cost}g`
      const blurb = el('span')
      blurb.textContent = t.blurb
      towers.append(name, blurb)
    }
    this.card.append(towers)
    this.list(['Click a tower to see its stats, upgrade it (up to level 4), change its target or sell it for 70% back.'])
    this.section('Enemies')
    const foes = el('div', 'grid')
    for (const [k, e] of ENEMIES.entries()) {
      const name = el('b')
      name.textContent = e.name
      const blurb = el('span')
      blurb.textContent = ENEMY_BLURB[k] ?? ''
      foes.append(name, blurb)
    }
    this.card.append(foes)
    this.section('Controls')
    const keys = el('div', 'grid')
    const rows: [string, string][] = [
      ['<kbd>1</kbd>–<kbd>5</kbd>', 'Pick a tower, then click a tile. Shift-click keeps building.'],
      ['<kbd>U</kbd> <kbd>X</kbd> <kbd>T</kbd>', 'Upgrade, sell or change the target of the selected tower'],
      ['<kbd>Space</kbd>', 'Start, or send the next wave now'],
      ['<kbd>P</kbd> <kbd>F</kbd> <kbd>M</kbd>', 'Pause, game speed (1×/2×/4×), sound'],
      ['<kbd>R</kbd> <kbd>Esc</kbd>', 'Restart, cancel'],
      ['Drag / wheel', 'Move and zoom the camera'],
      ['<kbd>`</kbd>', 'Performance overlay'],
    ]
    for (const [k, v] of rows) {
      const kb = el('b')
      kb.innerHTML = k
      const d = el('span')
      d.textContent = v
      keys.append(kb, d)
    }
    this.card.append(keys)
  }

  private heading(text: string, cls = ''): void {
    const h = el('h1', cls)
    h.textContent = text
    this.card.append(h)
  }

  private text(text: string, cls = ''): void {
    const p = el('p', cls)
    p.textContent = text
    this.card.append(p)
  }

  private line(text: string, cls: string): void {
    const d = el('div', cls)
    d.textContent = text
    this.card.append(d)
  }

  private section(text: string): void {
    const h = el('h3')
    h.textContent = text
    this.card.append(h)
  }

  private list(items: string[]): void {
    const ul = el('ul')
    for (const i of items) {
      const li = el('li')
      li.textContent = i
      ul.append(li)
    }
    this.card.append(ul)
  }

  private endStats(s: EndStats): void {
    const tiles = el('div', 'tiles')
    const tile = (v: string, k: string): void => {
      const t = el('div', 'tile')
      t.innerHTML = `<div class="v">${v}</div><div class="k">${k}</div>`
      tiles.append(t)
    }
    tile(s.score.toLocaleString('en-US'), 'Score')
    tile(`${s.wavesCleared}/${WAVE_COUNT}`, 'Waves cleared')
    tile(s.kills.toLocaleString('en-US'), s.lives > 0 ? `Kills · ${s.lives} lives left` : 'Kills')
    this.card.append(tiles)
    this.line(s.newBest ? '★ New best score!' : `Best ${s.best.toLocaleString('en-US')}`, 'best')
  }

  private buttons(...btns: [string, () => void, string][]): void {
    const row = el('div', 'td-row')
    for (const [label, fn, cls] of btns) {
      const btn = document.createElement('button')
      btn.className = `td-btn ${cls}`.trim()
      btn.textContent = label
      btn.addEventListener('click', fn)
      row.append(btn)
    }
    this.card.append(row)
  }
}

function el(tag: string, cls = ''): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  return e
}
