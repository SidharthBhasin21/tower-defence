/**
 * The only persistent data (ARCHITECTURE.md §9): the best score and a few
 * settings. Every access is wrapped so the game works when storage is blocked.
 */

const BEST_KEY = 'td.best'
const SETTINGS_KEY = 'td.settings'

export interface Settings {
  /** Index into GAME_SPEEDS. */
  speedIndex: number
  muted: boolean
}

export function loadBest(): number {
  try {
    const v = Number(localStorage.getItem(BEST_KEY))
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch {
    return 0
  }
}

/** Saves `score` if it beats the stored best. Returns true when it's a new best. */
export function saveBest(score: number): boolean {
  if (score <= loadBest()) return false
  try {
    localStorage.setItem(BEST_KEY, String(score))
  } catch {
    // Storage blocked: the best score just isn't kept.
  }
  return true
}

export function loadSettings(): Settings {
  const fallback: Settings = { speedIndex: 0, muted: false }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return fallback
    const v = JSON.parse(raw) as Partial<Settings>
    return {
      speedIndex: typeof v.speedIndex === 'number' ? v.speedIndex : 0,
      muted: v.muted === true,
    }
  } catch {
    return fallback
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // Storage blocked: settings last for this session only.
  }
}
