/**
 * Sound effects, synthesized with Web Audio (ARCHITECTURE.md §6). No audio
 * files: every sound is a few oscillators and filtered noise with a short
 * envelope.
 *
 * The game can fire hundreds of shots a second, so playback is limited:
 * - each sound has a minimum gap between plays (a second request inside the
 *   gap is dropped), and
 * - at most VOICES_PER_FRAME new sounds start in one frame.
 * That caps node creation at a few dozen per second however busy the game is.
 * Browsers only allow audio after a user gesture, so the context is created
 * on the first click or key press; earlier requests are ignored.
 */

export const Sound = {
  Bolt: 0,
  Cannon: 1,
  Frost: 2,
  Arc: 3,
  Sniper: 4,
  Explode: 5,
  Pop: 6,
  BossDie: 7,
  Leak: 8,
  Place: 9,
  Upgrade: 10,
  Sell: 11,
  Error: 12,
  WaveStart: 13,
  WaveClear: 14,
  BossSpawn: 15,
  Victory: 16,
  Defeat: 17,
} as const

/** Minimum gap between two plays of each sound, in ms (indexed by Sound). */
const MIN_GAP = [70, 110, 160, 90, 140, 90, 45, 300, 180, 60, 80, 80, 150, 400, 400, 800, 1000, 1000]
const VOICES_PER_FRAME = 6
const MASTER = 0.55

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private readonly lastAt = new Float64Array(MIN_GAP.length).fill(-1e9)
  private voices = 0
  private muted: boolean

  constructor(muted: boolean) {
    this.muted = muted
    const unlock = (): void => {
      this.init()
      if (this.ctx?.state === 'suspended') void this.ctx.resume()
      if (this.ctx?.state === 'running') {
        window.removeEventListener('pointerdown', unlock)
        window.removeEventListener('keydown', unlock)
      }
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
  }

  setMuted(on: boolean): void {
    this.muted = on
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0 : MASTER, this.ctx.currentTime, 0.02)
  }

  /** Call once per frame, before playing that frame's sounds. */
  frame(): void {
    this.voices = 0
  }

  /** Plays a sound. `pitch` scales its frequencies (1 = normal). */
  play(id: number, pitch = 1): void {
    const ctx = this.ctx
    if (!ctx || this.muted || ctx.state !== 'running' || this.voices >= VOICES_PER_FRAME) return
    const now = performance.now()
    if (now - this.lastAt[id] < MIN_GAP[id]) return
    this.lastAt[id] = now
    this.voices++
    const t = ctx.currentTime + 0.005
    // A little random detune so repeated sounds don't feel mechanical.
    const p = pitch * (0.96 + Math.random() * 0.08)
    switch (id) {
      case Sound.Bolt:
        this.tone('square', 1300 * p, 700 * p, t, 0.06, 0.05)
        break
      case Sound.Cannon:
        this.tone('sine', 160 * p, 55 * p, t, 0.16, 0.32)
        this.noise(t, 0.08, 0.12, 'lowpass', 900)
        break
      case Sound.Frost:
        this.tone('triangle', 1500 * p, 2100 * p, t, 0.18, 0.06)
        this.noise(t, 0.2, 0.05, 'highpass', 5000)
        break
      case Sound.Arc:
        this.tone('sawtooth', 220 * p, 120 * p, t, 0.1, 0.06)
        this.noise(t, 0.12, 0.1, 'bandpass', 2800, 3)
        break
      case Sound.Sniper:
        this.noise(t, 0.09, 0.22, 'highpass', 1800)
        this.tone('sine', 420 * p, 90 * p, t, 0.2, 0.18)
        break
      case Sound.Explode:
        this.noise(t, 0.35, 0.22, 'lowpass', 700)
        this.tone('sine', 90 * p, 40 * p, t, 0.3, 0.25)
        break
      case Sound.Pop:
        this.tone('sine', 520 * p, 260 * p, t, 0.07, 0.12)
        break
      case Sound.BossDie:
        this.noise(t, 1.1, 0.35, 'lowpass', 500)
        this.tone('sawtooth', 120, 30, t, 1, 0.18)
        this.tone('sine', 70, 28, t, 1.1, 0.35)
        break
      case Sound.Leak:
        this.tone('sawtooth', 130, 70, t, 0.35, 0.16)
        this.tone('square', 98, 60, t, 0.35, 0.06)
        break
      case Sound.Place:
        this.tone('triangle', 440, 440, t, 0.07, 0.16)
        this.tone('triangle', 660, 660, t + 0.06, 0.09, 0.16)
        break
      case Sound.Upgrade:
        this.notes([523, 659, 784, 1047], t, 0.06, 'triangle', 0.15)
        break
      case Sound.Sell:
        this.notes([988, 740, 587], t, 0.06, 'square', 0.06)
        break
      case Sound.Error:
        this.tone('square', 180, 160, t, 0.08, 0.08)
        this.tone('square', 150, 130, t + 0.1, 0.1, 0.08)
        break
      case Sound.WaveStart:
        this.tone('sawtooth', 196, 196, t, 0.22, 0.07)
        this.tone('sawtooth', 294, 294, t + 0.18, 0.35, 0.07)
        this.tone('sine', 98, 98, t, 0.55, 0.12)
        break
      case Sound.WaveClear:
        this.notes([659, 784, 988], t, 0.09, 'triangle', 0.14)
        break
      case Sound.BossSpawn:
        this.tone('sawtooth', 55, 82, t, 1.2, 0.14)
        this.tone('sawtooth', 58, 87, t, 1.2, 0.1)
        this.noise(t, 1.2, 0.08, 'lowpass', 300)
        break
      case Sound.Victory:
        this.notes([523, 659, 784, 1047, 784, 1047], t, 0.13, 'triangle', 0.16)
        break
      case Sound.Defeat:
        this.notes([392, 349, 311, 262], t, 0.22, 'sawtooth', 0.08)
        break
    }
  }

  private init(): void {
    if (this.ctx) return
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 6
    comp.connect(ctx.destination)
    const master = ctx.createGain()
    master.gain.value = this.muted ? 0 : MASTER
    master.connect(comp)
    // One second of white noise, shared by every noisy sound.
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    this.ctx = ctx
    this.master = master
    this.noiseBuf = buf
  }

  /** One oscillator sliding from f0 to f1, with a fast attack and exponential decay. */
  private tone(type: OscillatorType, f0: number, f1: number, t: number, dur: number, vol: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  /** Filtered noise burst. */
  private noise(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number, q = 0.7): void {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.noiseBuf) return
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(this.master)
    src.start(t, Math.random() * 0.5)
    src.stop(t + dur + 0.02)
  }

  /** A short run of notes. */
  private notes(freqs: number[], t: number, step: number, type: OscillatorType, vol: number): void {
    for (let k = 0; k < freqs.length; k++) this.tone(type, freqs[k], freqs[k], t + k * step, step * 2.2, vol)
  }
}
