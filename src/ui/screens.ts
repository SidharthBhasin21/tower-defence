/**
 * Full-screen panels over the game (ARCHITECTURE.md §6): title, pause,
 * restart confirmation, victory and game over.
 *
 * Plain, functional versions; feature 9 restyles them with the HUD. Panels are
 * rebuilt only when shown, never per frame.
 */

export type ScreenKind = 'title' | 'pause' | 'confirm' | 'victory' | 'defeat'

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
}

const STYLE = `
.td-screen{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
  background:rgba(6,12,8,0.62);pointer-events:auto;backdrop-filter:blur(2px)}
.td-screen.on{display:flex}
.td-card{min-width:320px;max-width:440px;padding:28px 32px;border-radius:14px;text-align:center;
  background:#16241b;border:1px solid #2f4a37;box-shadow:0 18px 50px rgba(0,0,0,0.45)}
.td-card h1{margin:0 0 6px;font-size:30px;letter-spacing:0.02em}
.td-card p{margin:8px 0;color:#b8c8bc;line-height:1.5}
.td-card .stats{margin:14px 0;font:14px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e8efe9}
.td-card .best{color:#f2c95c;font-weight:600}
.td-card .keys{margin-top:14px;font-size:13px;color:#8fa596;line-height:1.7}
.td-row{display:flex;gap:10px;justify-content:center;margin-top:18px}
.td-btn{padding:9px 20px;border-radius:8px;border:1px solid #4d7a5a;background:#2c5a3a;color:#fff;
  font:600 15px system-ui,sans-serif;cursor:pointer}
.td-btn:hover{background:#367048}
.td-btn.alt{background:transparent;border-color:#4a5d50;color:#c9d6cc}
.td-btn.alt:hover{background:#22352a}
`

export class Screens {
  private readonly root: HTMLElement
  private readonly card: HTMLElement
  private readonly actions: ScreenActions
  current: ScreenKind | null = null

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
    this.current = kind
    this.card.replaceChildren()
    const a = this.actions
    switch (kind) {
      case 'title':
        this.heading('Tower Defence')
        this.text('Hold the base through 50 waves. Build towers beside the paths; they aim and fire on their own.')
        this.keys('1 build a tower · Space next wave · P pause · F speed · R restart · drag / wheel to move the camera')
        this.buttons(['Play', a.play], ['Stress test', () => location.assign('?stress')], true)
        break
      case 'pause':
        this.heading('Paused')
        this.buttons(['Resume', a.resume], ['Restart', a.restart])
        break
      case 'confirm':
        this.heading('Restart?')
        this.text('The current game will be lost.')
        this.buttons(['Restart', a.restartNow], ['Keep playing', a.cancelConfirm])
        break
      case 'victory':
      case 'defeat':
        this.heading(kind === 'victory' ? 'Victory!' : 'Game over')
        this.text(kind === 'victory' ? 'All 50 waves held.' : 'The base has fallen.')
        if (stats) this.endStats(stats)
        this.buttons(['Play again', a.restartNow])
        break
    }
    this.root.classList.add('on')
  }

  hide(): void {
    this.current = null
    this.root.classList.remove('on')
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  }

  private heading(text: string): void {
    const h = document.createElement('h1')
    h.textContent = text
    this.card.append(h)
  }

  private text(text: string): void {
    const p = document.createElement('p')
    p.textContent = text
    this.card.append(p)
  }

  private keys(text: string): void {
    const p = document.createElement('div')
    p.className = 'keys'
    p.textContent = text
    this.card.append(p)
  }

  private endStats(s: EndStats): void {
    const div = document.createElement('div')
    div.className = 'stats'
    div.textContent = `Score ${s.score}\nWaves cleared ${s.wavesCleared}/50\nKills ${s.kills}` + (s.lives > 0 ? `\nLives left ${s.lives}` : '')
    div.style.whiteSpace = 'pre'
    const best = document.createElement('div')
    best.className = 'best'
    best.textContent = s.newBest ? 'New best score!' : `Best ${s.best}`
    this.card.append(div, best)
  }

  private buttons(primary: [string, () => void], secondary?: [string, () => void], secondaryAlt = true): void {
    const row = document.createElement('div')
    row.className = 'td-row'
    for (const [i, b] of [primary, secondary].entries()) {
      if (!b) continue
      const btn = document.createElement('button')
      btn.className = i === 1 && secondaryAlt ? 'td-btn alt' : 'td-btn'
      btn.textContent = b[0]
      btn.addEventListener('click', b[1])
      row.append(btn)
    }
    this.card.append(row)
  }
}
