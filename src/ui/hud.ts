import { DT, ENEMIES, TOWERS, WAVE_COUNT } from '../config.ts'
import type { Frame } from '../render/atlas.ts'
import type { Sprites } from '../render/sprites.ts'
import type { Game } from '../sim/game.ts'
import { WAVES } from '../sim/waves.ts'

/** What the HUD's buttons ask the app to do. */
export interface HudActions {
  nextWave(): void
  togglePause(): void
  cycleSpeed(): void
  toggleMute(): void
  restart(): void
  build(type: number): void
}

/** Client state the HUD shows alongside the sim's. */
export interface HudState {
  speed: number
  paused: boolean
  muted: boolean
  building: number
}

export type ToastKind = 'info' | 'warn' | 'boss'

const TOAST_SLOTS = 4
const TOAST_MS = 2400

const ICON = {
  heart:
    '<svg viewBox="0 0 24 24"><path fill="#ff6b6b" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"/></svg>',
  coin:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#f2c14e"/><circle cx="12" cy="12" r="6.2" fill="none" stroke="#b8862a" stroke-width="1.6"/><path d="M12 8.5v7" stroke="#b8862a" stroke-width="1.8" stroke-linecap="round"/></svg>',
  wave:
    '<svg viewBox="0 0 24 24"><path d="M3 15c3-4 5-4 8 0s5 4 8 0" fill="none" stroke="#9fd8ff" stroke-width="2.2" stroke-linecap="round"/><path d="M3 9c3-4 5-4 8 0s5 4 8 0" fill="none" stroke="#5fa8d8" stroke-width="2.2" stroke-linecap="round"/></svg>',
  star:
    '<svg viewBox="0 0 24 24"><path fill="#ffd864" d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  skull:
    '<svg viewBox="0 0 24 24"><path fill="#e7d9d6" d="M12 3C7.6 3 4 6.3 4 10.5c0 2.6 1.4 4.6 3 5.6V19h2v-2h2v2h2v-2h2v2h2v-2.9c1.6-1 3-3 3-5.6C20 6.3 16.4 3 12 3z"/><circle cx="9" cy="11" r="1.8" fill="#3a2a28"/><circle cx="15" cy="11" r="1.8" fill="#3a2a28"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z" fill="currentColor"/></svg>',
  sound:
    '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  muted:
    '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  restart:
    '<svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 107-7H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 2L7 5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
}

const STYLE = `
.td-hud{position:absolute;inset:0;pointer-events:none;font:14px/1.3 system-ui,-apple-system,'Segoe UI',sans-serif;color:#eef4ef;
  --card:rgba(13,22,17,0.88);--line:#2f4a37}
.td-hud .bar{position:absolute;left:12px;right:12px;top:10px;display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap}
.td-hud .chip{pointer-events:auto;display:flex;align-items:center;gap:7px;height:40px;padding:0 13px;border-radius:12px;
  background:var(--card);border:1px solid var(--line);box-shadow:0 6px 18px rgba(0,0,0,0.3);font-weight:650;
  font-variant-numeric:tabular-nums}
.td-hud .chip svg{width:20px;height:20px}
.td-hud .chip small{font-weight:500;color:#9fb3a5;font-size:12px}
.td-hud .chip.low{border-color:#a3433c;background:rgba(80,20,18,0.9);animation:td-pulse 0.9s ease-in-out infinite alternate}
@keyframes td-pulse{to{box-shadow:0 0 0 3px rgba(255,90,80,0.35),0 6px 18px rgba(0,0,0,0.3)}}
.td-hud .grow{flex:1}
.td-hud .wavecard{pointer-events:auto;display:flex;align-items:center;gap:10px;min-height:40px;padding:4px 6px 4px 13px;border-radius:12px;
  background:var(--card);border:1px solid var(--line);box-shadow:0 6px 18px rgba(0,0,0,0.3)}
.td-hud .wavecard .ttl{font-weight:700;white-space:nowrap}
.td-hud .wavecard .boss{margin-left:6px;padding:1px 6px;border-radius:6px;background:#5e2a7a;color:#ffd6ff;font-size:11px;font-weight:700;letter-spacing:0.04em}
.td-hud .wavecard .grp{display:flex;gap:6px;flex-wrap:wrap;max-width:330px}
.td-hud .wavecard .g{display:flex;align-items:center;gap:2px;font-size:12px;font-weight:650;color:#d6e3d9;font-variant-numeric:tabular-nums}
.td-hud .wavecard .g canvas{width:18px;height:18px}
.td-hud .wavecard .when{font-size:12px;color:#9fb3a5;white-space:nowrap;font-variant-numeric:tabular-nums;min-width:58px;text-align:right}
.td-hud .btn{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;
  border-radius:9px;border:1px solid #4d7a5a;background:#2c5a3a;color:#fff;font:650 13px system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.td-hud .btn:hover:not(:disabled){background:#367048}
.td-hud .btn:disabled{opacity:0.4;cursor:default}
.td-hud .btn kbd{font:11px ui-monospace,monospace;opacity:0.65}
.td-hud .ctl{display:flex;gap:6px}
.td-hud .ctl .btn{width:40px;height:40px;padding:0;border-radius:12px;background:var(--card);border-color:var(--line);color:#dfe9e2}
.td-hud .ctl .btn:hover{background:#22352a}
.td-hud .ctl .btn svg{width:20px;height:20px}
.td-hud .ctl .btn.speed{font-weight:750;font-size:14px}
.td-hud .ctl .btn.on{color:#ffd864;border-color:#7a6a2c}
.td-hud .build{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:flex;gap:8px;padding:8px;border-radius:16px;
  background:var(--card);border:1px solid var(--line);box-shadow:0 8px 24px rgba(0,0,0,0.35);pointer-events:auto}
.td-hud .card{position:relative;width:78px;padding:6px 4px 5px;border-radius:11px;border:1px solid #344c3c;background:#1a2a20;
  display:flex;flex-direction:column;align-items:center;gap:1px;cursor:pointer;color:#eef4ef;font:inherit;transition:transform 0.08s}
.td-hud .card:hover{background:#22382a;transform:translateY(-2px)}
.td-hud .card canvas{width:38px;height:38px}
.td-hud .card .nm{font-size:12px;font-weight:650}
.td-hud .card .cost{display:flex;align-items:center;gap:3px;font-size:12px;font-weight:650;color:#f2c14e;font-variant-numeric:tabular-nums}
.td-hud .card .cost svg{width:12px;height:12px}
.td-hud .card .key{position:absolute;top:4px;left:6px;font:10px ui-monospace,monospace;color:#9fb3a5}
.td-hud .card.on{border-color:#ffd864;background:#2f3a1f;box-shadow:0 0 0 2px rgba(255,216,100,0.35)}
.td-hud .card.poor{opacity:0.45}
.td-hud .card.poor .cost{color:#ff8a80}
.td-hud .hint{position:absolute;left:50%;bottom:116px;transform:translateX(-50%);padding:5px 12px;border-radius:9px;
  background:rgba(13,22,17,0.82);font-size:12px;color:#c9d6cc;white-space:nowrap;display:none}
.td-hud .hint.on{display:block}
.td-hud .hint b{color:#ffd864}
.td-hud .toasts{position:absolute;left:50%;top:64px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px}
.td-hud .toast{padding:7px 16px;border-radius:10px;font-weight:650;font-size:14px;color:#fff;box-shadow:0 6px 18px rgba(0,0,0,0.35);
  opacity:0;transform:translateY(-6px);transition:opacity 0.18s,transform 0.18s;display:none}
.td-hud .toast.show{display:block}
.td-hud .toast.vis{opacity:1;transform:none}
.td-hud .toast.info{background:rgba(28,92,52,0.95)}
.td-hud .toast.warn{background:rgba(130,30,26,0.95)}
.td-hud .toast.boss{background:rgba(86,32,112,0.96);font-size:16px;padding:9px 20px;border:1px solid #c58cff}
`

/**
 * The in-game HUD (ARCHITECTURE.md §6), as DOM over the canvas.
 *
 * Built once. `update()` runs every frame but compares each value with the
 * one last shown and writes only what changed (`textContent` and class
 * toggles), so a quiet frame touches no DOM at all.
 */
export class Hud {
  readonly root: HTMLElement
  private readonly topBar: HTMLElement
  private readonly buildBar: HTMLElement
  private readonly lives: HTMLElement
  private readonly livesChip: HTMLElement
  private readonly gold: HTMLElement
  private readonly wave: HTMLElement
  private readonly score: HTMLElement
  private readonly enemies: HTMLElement
  private readonly waveTitle: HTMLElement
  private readonly waveGroups: HTMLElement
  private readonly waveWhen: HTMLElement
  private readonly sendBtn: HTMLButtonElement
  private readonly pauseBtn: HTMLButtonElement
  private readonly speedBtn: HTMLButtonElement
  private readonly muteBtn: HTMLButtonElement
  private readonly hint: HTMLElement
  private readonly cards: HTMLElement[] = []
  private readonly toasts: HTMLElement[] = []
  private readonly toastUntil = new Float64Array(TOAST_SLOTS)
  private nextToast = 0
  private readonly sprites: Sprites
  /** Last values shown, by field (NaN = never shown). */
  private readonly last = new Float64Array(16).fill(Number.NaN)
  private readonly lastCard = new Int8Array(TOWERS.length).fill(-1)

  constructor(parent: HTMLElement, sprites: Sprites, actions: HudActions) {
    this.sprites = sprites
    const style = document.createElement('style')
    style.textContent = STYLE
    document.head.append(style)

    this.root = el('div', 'td-hud')
    // ---- Top bar ----
    this.topBar = el('div', 'bar')
    const chip = (icon: string, title: string): [HTMLElement, HTMLElement] => {
      const c = el('div', 'chip')
      c.title = title
      c.innerHTML = icon
      const v = el('span')
      c.append(v)
      this.topBar.append(c)
      return [c, v]
    }
    ;[this.livesChip, this.lives] = chip(ICON.heart, 'Lives')
    this.gold = chip(ICON.coin, 'Gold')[1]
    this.wave = chip(ICON.wave, 'Wave')[1]
    this.score = chip(ICON.star, 'Score')[1]
    this.enemies = chip(ICON.skull, 'Enemies left in play and still to spawn')[1]
    this.topBar.append(el('div', 'grow'))

    const card = el('div', 'wavecard')
    this.waveTitle = el('div', 'ttl')
    this.waveGroups = el('div', 'grp')
    this.waveWhen = el('div', 'when')
    this.sendBtn = button('btn', '', () => actions.nextWave())
    card.append(this.waveTitle, this.waveGroups, this.waveWhen, this.sendBtn)
    this.topBar.append(card, el('div', 'grow'))

    const ctl = el('div', 'ctl')
    this.pauseBtn = button('btn', ICON.pause, () => actions.togglePause(), 'Pause (P)')
    this.speedBtn = button('btn speed', '1×', () => actions.cycleSpeed(), 'Game speed (F)')
    this.muteBtn = button('btn', ICON.sound, () => actions.toggleMute(), 'Sound (M)')
    const restart = button('btn', ICON.restart, () => actions.restart(), 'Restart (R)')
    ctl.append(this.pauseBtn, this.speedBtn, this.muteBtn, restart)
    this.topBar.append(ctl)

    // ---- Build bar ----
    this.buildBar = el('div', 'build')
    TOWERS.forEach((t, type) => {
      const c = document.createElement('button')
      c.className = 'card'
      c.title = `${t.name}: ${t.blurb}`
      const key = el('span', 'key')
      key.textContent = t.key
      const icon = this.towerIcon(type)
      const nm = el('span', 'nm')
      nm.textContent = t.name
      const cost = el('span', 'cost')
      cost.innerHTML = ICON.coin
      cost.append(String(t.cost))
      c.append(key, icon, nm, cost)
      c.addEventListener('click', () => actions.build(type))
      this.cards.push(c)
      this.buildBar.append(c)
    })

    // ---- Toasts (a few reused slots) ----
    const toasts = el('div', 'toasts')
    for (let k = 0; k < TOAST_SLOTS; k++) {
      const t = el('div', 'toast')
      this.toasts.push(t)
      toasts.append(t)
    }

    this.hint = el('div', 'hint')
    // Stop clicks on the HUD from reaching the canvas (no stray builds or selection changes).
    for (const e of [this.topBar, this.buildBar]) e.addEventListener('pointerdown', (ev) => ev.stopPropagation())
    this.root.append(this.topBar, toasts, this.hint, this.buildBar)
    parent.append(this.root)
  }

  /** Height the HUD covers at the top and bottom (CSS px), for the camera. */
  insets(): [number, number] {
    const top = this.topBar.getBoundingClientRect().bottom + 6
    const bottom = window.innerHeight - this.buildBar.getBoundingClientRect().top + 6
    return [top, bottom]
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none'
  }

  /** Shows a short message under the top bar. */
  toast(text: string, kind: ToastKind, now: number): void {
    const k = this.nextToast
    this.nextToast = (k + 1) % TOAST_SLOTS
    const t = this.toasts[k]
    t.textContent = text
    t.className = `toast show ${kind}`
    // Next frame: fade in (the class change above restarts the transition).
    requestAnimationFrame(() => t.classList.add('vis'))
    this.toastUntil[k] = now + (kind === 'boss' ? TOAST_MS * 1.5 : TOAST_MS)
  }

  update(g: Game, s: HudState, now: number): void {
    for (let k = 0; k < TOAST_SLOTS; k++) {
      if (this.toastUntil[k] && now > this.toastUntil[k]) {
        this.toastUntil[k] = 0
        this.toasts[k].className = 'toast'
      }
    }
    const l = this.last
    const gold = Math.floor(g.gold)
    if (l[0] !== g.lives) {
      l[0] = g.lives
      this.lives.textContent = String(g.lives)
      this.livesChip.classList.toggle('low', g.lives > 0 && g.lives <= 5)
    }
    if (l[1] !== gold) {
      l[1] = gold
      this.gold.textContent = String(gold)
    }
    if (l[2] !== g.wave) {
      l[2] = g.wave
      this.wave.innerHTML = `${g.wave}<small>/${WAVE_COUNT}</small>`
      this.showNextWave(g)
    }
    if (l[3] !== g.score) {
      l[3] = g.score
      this.score.textContent = g.score.toLocaleString('en-US')
    }
    const left = g.enemies.aliveCount + g.spawning
    if (l[4] !== left) {
      l[4] = left
      this.enemies.textContent = String(left)
    }
    // Wave timing and the send button.
    const secs = g.countdown >= 0 ? Math.ceil(g.countdown * DT) : -1
    const canCall = g.canCallWave() ? 1 : 0
    const bonus = g.earlyBonus()
    if (l[5] !== secs || l[6] !== canCall || l[7] !== bonus) {
      l[5] = secs
      l[6] = canCall
      l[7] = bonus
      if (g.wave >= WAVE_COUNT) this.waveWhen.textContent = left > 0 ? 'Final wave' : ''
      else if (g.wave === 0) this.waveWhen.textContent = 'Ready'
      else this.waveWhen.textContent = secs >= 0 ? `in ${secs}s` : 'Incoming…'
      this.sendBtn.disabled = canCall === 0
      this.sendBtn.style.display = g.wave >= WAVE_COUNT ? 'none' : ''
      this.sendBtn.innerHTML =
        g.wave === 0 ? 'Start <kbd>Space</kbd>' : bonus > 0 ? `Send now +${bonus}g <kbd>Space</kbd>` : 'Send now <kbd>Space</kbd>'
    }
    // Controls.
    const paused = s.paused ? 1 : 0
    if (l[8] !== paused) {
      l[8] = paused
      this.pauseBtn.innerHTML = s.paused ? ICON.play : ICON.pause
      this.pauseBtn.classList.toggle('on', s.paused)
    }
    if (l[9] !== s.speed) {
      l[9] = s.speed
      this.speedBtn.textContent = `${s.speed}×`
      this.speedBtn.classList.toggle('on', s.speed > 1)
    }
    const muted = s.muted ? 1 : 0
    if (l[10] !== muted) {
      l[10] = muted
      this.muteBtn.innerHTML = s.muted ? ICON.muted : ICON.sound
    }
    if (l[11] !== s.building) {
      l[11] = s.building
      this.hint.classList.toggle('on', s.building >= 0)
      if (s.building >= 0)
        this.hint.innerHTML = `Building <b>${TOWERS[s.building].name}</b>: click a tile · Shift-click to keep building · Esc to stop`
    }
    // Build cards: 0 = affordable, 1 = too expensive, 2 = being built.
    for (let t = 0; t < TOWERS.length; t++) {
      const state = s.building === t ? 2 : gold < TOWERS[t].cost ? 1 : 0
      if (this.lastCard[t] === state) continue
      this.lastCard[t] = state
      this.cards[t].classList.toggle('on', state === 2)
      this.cards[t].classList.toggle('poor', state === 1)
    }
  }

  /** Rebuilds the next-wave preview (once per wave, not per frame). */
  private showNextWave(g: Game): void {
    this.waveGroups.replaceChildren()
    if (g.wave >= WAVE_COUNT) {
      this.waveTitle.textContent = 'Last wave'
      return
    }
    const w = WAVES[g.wave]
    this.waveTitle.textContent = `Wave ${w.number}`
    if (w.boss) {
      const b = el('span', 'boss')
      b.textContent = 'BOSS'
      this.waveTitle.append(b)
    }
    for (const gr of w.groups) {
      const span = el('span', 'g')
      span.title = ENEMIES[gr.type].name
      span.append(this.frameIcon(this.sprites.enemy[gr.type], 18, 0), `${gr.count}`)
      this.waveGroups.append(span)
    }
  }

  private towerIcon(type: number): HTMLCanvasElement {
    const c = this.frameIcon(this.sprites.towerBase, 38, 0)
    const ctx = c.getContext('2d')
    if (!ctx) return c
    const f = this.sprites.turret[type]
    const scale = c.width / 38
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.translate(19, 19)
    ctx.rotate(-Math.PI / 2) // turrets face up in the bar
    ctx.drawImage(this.sprites.atlas.canvas, f.sx, f.sy, f.sw, f.sh, -f.w / 2, -f.h / 2, f.w, f.h)
    return c
  }

  /** A small canvas showing one atlas frame, centred, at device resolution. */
  private frameIcon(f: Frame, size: number, pad: number): HTMLCanvasElement {
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const c = document.createElement('canvas')
    c.width = c.height = Math.round(size * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return c
    const fit = (size - pad * 2) / Math.max(f.w, f.h)
    const s = Math.min(fit, 1.4) * dpr
    ctx.setTransform(s, 0, 0, s, (size * dpr) / 2, (size * dpr) / 2)
    ctx.drawImage(this.sprites.atlas.canvas, f.sx, f.sy, f.sw, f.sh, -f.w / 2, -f.h / 2, f.w, f.h)
    return c
  }
}

function el(tag: string, cls = ''): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  return e
}

function button(cls: string, html: string, onClick: () => void, title = ''): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = cls
  b.innerHTML = html
  if (title) b.title = title
  b.addEventListener('click', (e) => {
    onClick()
    ;(e.currentTarget as HTMLButtonElement).blur() // keep Space for "next wave", not "click again"
  })
  return b
}
