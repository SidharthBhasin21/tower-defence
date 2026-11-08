# Architecture

This is the technical blueprint for the tower defense game. It defines the tools, module layout, data model, main loop, rendering pipeline and how performance is measured. Read it together with [CLAUDE.md](CLAUDE.md), which holds the non-negotiable rules, and [DOMAIN.md](DOMAIN.md), which defines what the app is and where the work stops.

If the code and this document disagree, fix one of them in the same change. Don't leave them out of sync.

---

## 1. Tools

### 1.1 Runtime (what ships to the player)

| Tool | Version | Used for |
|---|---|---|
| Browser platform (no framework) | Latest Chrome, Firefox, Safari | Runs the game |
| Canvas 2D API | built in | All world rendering: map, towers, enemies, projectiles, effects |
| OffscreenCanvas / `HTMLCanvasElement` | built in | Pre-rendered sprite atlas and static map background, made once at startup |
| DOM + CSS | built in | HUD, menus, tower panel, overlays (not drawn on the canvas) |
| Web Audio API | built in | Sound effects synthesized in code; no audio files |
| `requestAnimationFrame` | built in | The single game loop |
| `performance.now()` | built in | Frame timing and the profiler |
| `performance.memory` | Chrome only, optional | Heap sampling in benchmarks; skipped if missing |
| `localStorage` | built in | High score and settings only, always wrapped in try/catch |
| Typed arrays (`Float32Array`, `Int32Array`, `Uint8Array`, `Uint16Array`) | built in | Entity storage (structure of arrays) |

**The game has no runtime npm dependencies.** The production bundle is our own TypeScript only.

### 1.2 Build and language

| Tool | Version | Used for |
|---|---|---|
| Node.js | 22.x | Runs the tooling |
| npm | 10.x | Package manager (lockfile committed) |
| Vite | ^8.3.6 | Dev server with HMR, production bundling |
| TypeScript | ~7.0.2 | Type checking (`tsc` with `noEmit`; Vite does the compiling) |

### 1.3 Dev and quality tools (added when that work starts)

| Tool | Purpose | Status |
|---|---|---|
| Vitest | Unit and simulation tests behind `npm run test` | Added (feature 0) |
| playwright-core | Drives the installed Google Chrome in real time. `scripts/shot.mjs` checks the running game (state and a screenshot); later it runs the stress benchmark and full 50-wave run and saves results as JSON. Uses `channel: "chrome"`, so no browser download | Added (feature 2) |

### 1.4 npm scripts

| Script | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc` type check, then `vite build` into `dist/` |
| `npm run preview` | Serves the built `dist/` |
| `npm run test` | Vitest, run once |
| `npm run bench` | Builds, serves `dist/`, runs the stress and full-run benchmarks in Chrome, writes `bench/results/*.json` |

### 1.5 Tools we don't use

The tools below are excluded by decision. Adding any of them needs the user's approval first; see [DOMAIN.md](DOMAIN.md).

- **No UI or game frameworks:** no React, Vue, Svelte, Phaser, Three.js or Babylon. PixiJS is only a fallback if Canvas 2D measurably misses the frame-rate targets, and switching to it needs approval.
- **No physics engine and no ECS library.** The data layout is hand-written.
- **No CDNs, web fonts, remote images or audio, analytics or telemetry.** The game must run fully offline.
- **No backend, database or network calls at runtime.**
- **No Web Workers for now.** The simulation runs on the main thread and fits the budget. Revisit only if measurements say so.

---

## 2. Source layout

```
index.html              Canvas element and HUD markup
src/
  main.ts               Bootstrap: build systems, start the loop, route URL modes (?stress, ?bench)
  loop.ts               The ONE requestAnimationFrame loop: fixed-step accumulator and render call
  config.ts             All tunable data: tower, enemy and economy definitions, capacities
  rng.ts                Seeded PRNG (mulberry32); gameplay never calls Math.random
  sim/                  Pure game logic. Must not touch DOM, canvas or audio (runs in Node for tests)
    game.ts             Game state and step(); owns every system below
    map.ts              Tile grid, buildable mask, path definitions
    path.ts             Path sampling: arc-length lookup tables (x, y, normal, heading)
    enemies.ts          Enemy pool (SoA, slot + generation + dense active list)
    towers.ts           Tower storage, targeting, firing
    projectiles.ts      Projectile pool (dense SoA, swap-remove)
    grid.ts             Uniform spatial hash, rebuilt each step by counting sort
    waves.ts            Generates the 50 waves; runtime spawn scheduler
    fx.ts               Particles, beams, rings, floating text (visual-only pools)
    events.ts           Preallocated event ring: sim → client (sound, toasts, UI)
    demo.ts             TEMPORARY (features 2–4): trickle and burst Grunt spawns, replaced by waves
    stress.ts           Stress scenario controller
    bot.ts              Scripted player for balance tests and the full-run benchmark
  render/
    renderer.ts         Canvas 2D renderer: camera transform, culling, draw passes
    atlas.ts            Builds the sprite atlas at startup (all art drawn in code)
    background.ts       Pre-renders the static map to one offscreen canvas
    camera.ts           Pan, zoom, world↔screen conversion, view rectangle
  ui/
    debug.ts            TEMPORARY (features 2–8): lives and enemy readout, replaced by the HUD
    hud.ts              DOM HUD; writes only values that changed
    screens.ts          Title, pause, victory, game-over screens
    input.ts            Pointer and keyboard → command queue
  audio/
    sfx.ts              Web Audio synth with per-sound rate limiting
  perf/
    recorder.ts         Frame-time ring buffer, percentiles, heap samples
    overlay.ts          On-screen perf panel (toggle with `` ` ``)
tests/                  Vitest specs
scripts/shot.mjs        Opens the dev server in real Chrome, prints game state, saves a screenshot
scripts/bench.mjs       Benchmark runner (playwright-core and system Chrome)
bench/results/          Benchmark output (JSON)
README.md               Architecture, rendering, bottlenecks, optimizations, measurement
```

**Dev-only hook:** in dev builds `main.ts` puts `{ game, camera, renderer, demo, loop }` on `window.__td` for `scripts/shot.mjs` and console debugging. Production builds leave it out.

**Dependency direction:** `sim/` imports only `config.ts` and `rng.ts`. `render/`, `ui/`, `audio/` and `perf/` read the sim's state but never change it, except that input sends commands. Nothing in `sim/` imports from those folders.

---

## 3. Main loop and timing

- **One loop.** A single `requestAnimationFrame` callback in `loop.ts` drives everything. Entities never get their own timers, intervals, promises or animation loops.
- **Fixed timestep.**
  - The simulation advances in steps of `DT = 1/60 s`.
  - Each frame adds the real elapsed time, multiplied by the game speed (1×, 2× or 4×), to an accumulator, then runs as many steps as fit.
  - The real elapsed time is clamped to 100 ms, and a frame runs at most `MAX_STEPS_PER_FRAME`. That prevents a slowdown from feeding on itself after the tab was hidden or the machine stalled.
- **Interpolation.** Moving entities keep their previous position. The renderer blends between the previous and current position using `alpha = accumulator / DT`, so motion is smooth at 60, 120 or 144 Hz.
- **Refresh-rate independence.** Gameplay depends only on the number of steps, never on frame time. The same seed and the same commands give the same result on any display, and a test checks this.
- **Pause** stops adding to the accumulator. Rendering and input keep running, so the camera still moves and panels still open while paused.
- **Input.** Pointer and keyboard events push commands such as place, upgrade, sell, set target mode and next wave into a queue. The queue is drained at the start of the next step. Purely visual input (hover, camera) applies immediately.

---

## 4. Simulation

### 4.1 Data layout (structure of arrays)

| Pool | Capacity | Layout | How references work |
|---|---|---|---|
| Enemies | 8192 | Slots with a free list, a `generation` per slot, and a dense `active[]` list with each slot's position in it | Others hold `(slot, generation)`. A reference is stale if the generation doesn't match |
| Projectiles | 4096 | Dense arrays, swap-remove | Nothing references them |
| Towers | 256 | Dense arrays | UI references them by tile index |
| Particles | 4096 | Dense arrays, swap-remove | Visual only |
| Beams and rings | 512 | Dense arrays, swap-remove | Visual only |
| Floating text | 96 | Dense arrays; strings come from a startup cache of `"+0"`…`"+9999"` | Visual only |

- **Allocated once.** All arrays are created at startup. The game loop never creates objects, arrays, closures or strings.
- **Restart reuses memory.** It resets the counts and does not reallocate.

**Enemy fields:**
- Movement: `type`, `pathId`, `dist` (distance travelled along the path), `lane` (sideways offset), `speed`.
- Health: `hp`, `maxHp`, `armor`.
- Status: `slowMul`, `slowT`, `flashT`, `waveId`.
- Position: `x` and `y` (current), `px` and `py` (previous step), `heading`.
- Lifecycle: `alive`, `generation`.

**Deferred freeing.** A kill marks the enemy dead straight away, but its slot only goes back to the free list at the end of the step, so a slot is never reused within the step that freed it. Spawns made during a step, such as a boss splitting into minions, also wait until the end of the step.

### 4.2 Paths

- **Paths are lookup tables.** Waypoint lists in tile coordinates are turned into smooth curves with rounded corners. They are then resampled every 2 px into arrays of `x`, `y`, `nx`, `ny` (the sideways normal) and `heading` (one of 16 directions).
- **No pathfinding.** An enemy's position is a lookup by its `dist` along the path, plus `lane × normal`. No enemy runs pathfinding.
- **The map has three paths:** two ground paths that merge before the base, and one air path for flyers.

### 4.3 Spatial grid

- **The grid is rebuilt every step.** It is a uniform grid of 64 px cells covering the world plus a margin. A counting sort rebuilds it each step: count enemies per cell, take running totals, then fill one `Int32Array` of slots. That's O(n) time and allocates nothing.
- **Queries visit only nearby cells.** A query (circle centre and radius) visits only the cells the circle overlaps and skips dead slots.
- **The grid has several users:**
  - Tower targeting.
  - Projectile hits and splash damage.
  - Frost pulses.
  - Healer auras.
  - Lightning chains.
  - The renderer's culling (see §5).

### 4.4 Step order

Each step runs these phases in this order:

1. Apply the queued player commands.
2. Wave scheduler: spawn the enemies that are due.
3. Enemies: update status timers, move along the path, handle reaching the base (the player loses lives), healer pulses.
4. Rebuild the spatial grid.
5. Towers: count down cooldowns, pick targets with the grid, then fire. Firing either spawns a projectile or hits instantly (lightning and frost).
6. Projectiles: move and home in, check hits, apply damage and splash.
7. Kills: rewards, score and effects. Free the dead slots and add the delayed spawns.
8. Effects: advance particles, beams, rings and text.
9. Win and loss checks, wave-cleared bonus, between-wave countdown.

**Damage.** All damage goes through one `damage(slot, amount, flags)` function. It applies armor (with a floor) and the hit flash, and handles the kill.

### 4.5 Waves

- **Waves are generated, not hand-written.** `waves.ts` builds all 50 waves at startup from difficulty curves (health and count multipliers per wave) and a schedule for when each enemy type first appears.
- **Each wave is a list of spawn groups.** A group has `{ type, count, interval, delay, pathMask }`.
- **One scheduler spawns everything.** It ticks a fixed-capacity list of active groups, so waves called early can overlap.

### 4.6 Sim → client events

- The sim writes events into a preallocated integer ring buffer, for example kills, shots, leaks, wave starts and boss arrivals. Each event has a type and up to three values.
- The client reads the buffer once per frame to play sounds, show toasts and refresh the HUD. The sim never calls the client directly.

---

## 5. Rendering (Canvas 2D)

### 5.1 Setup

- **One `<canvas>`**, context `getContext("2d", { alpha: false })`, sized to the window × `devicePixelRatio` and re-sized when the window changes.
- **The camera** (pan and zoom from 0.5× to 2.5×) is applied once per frame with `setTransform`. Entities are drawn in world coordinates.
  - The minimum zoom drops below 0.5× when needed so the whole map always fits on small screens.
  - Until the player pans or zooms, the camera re-fits the map whenever the window is resized.
  - The view can go at most 96 world px past the map edge, and the map is centred on any axis where it's smaller than the view.

### 5.2 Assets made at startup

- **All art is drawn in code, so there are no image files.** The sprite atlas is one canvas that holds every sprite at 2× resolution:
  - Enemy sprites, 16 headings per type, each in normal, hit-flash and frozen variants.
  - Tower bases and turrets for each type and level.
  - Projectiles.
  - Particle dots.
  - Icons.
- **One source image.** Drawing every sprite with `drawImage(atlas, sx, sy, sw, sh, dx, dy, dw, dh)` from the same image lets the browser's GPU backend batch draw calls.
- **Static map background.** Terrain, paths and decorations are drawn once to an offscreen canvas. Each frame copies only the visible part, in a single `drawImage`.

### 5.3 Draw order (each frame)

1. The visible part of the background.
2. Animated scenery: spawn portals and the glow on the base.
3. Tower bases, then turrets. Turrets rotate with the canvas transform, which is affordable for at most 100 towers.
4. Ground enemies, using the pre-rotated sprite for the right heading.
5. Bosses.
6. Flyer shadows, then flyers.
7. Projectiles. Tracers of the same type are drawn as one combined path and one `stroke`.
8. Effects: lightning beams, frost and explosion rings, particles.
9. Health bars for damaged enemies. Bars are grouped into three colour bands (green, yellow, red); each band is one path of `rect()`s and one `fill`.
10. Floating text (capped).
11. World UI: selected tower range, placement preview (valid or invalid), hovered tile.

### 5.4 Culling

The goal is that drawing cost grows with what's on screen, not with everything that exists.

- **Enemies are found through the grid, not by scanning the full list.** The renderer walks only the grid cells that overlap the view (plus one cell of margin). It collects the visible slots into a preallocated `Int32Array`, and the draw passes then run over that list only.
- **Projectiles, particles and effects** get a cheap bounds check against the view rectangle.
- **The background** copy is clipped to the view.
- **The perf overlay** shows how many objects were drawn and how many exist.

### 5.5 Level of detail (only if measurements need it)

These are optional and depend on the zoom level:
- Leave out health bars at low zoom.
- Draw swarms as plain squares.
- Lower the particle budget when the pool is busy.

Any LOD added must be recorded in the README, with the measurement that justified it.

---

## 6. UI, input and audio

- **HUD and menus are DOM elements over the canvas.**
  - The HUD shows lives, gold, wave (x/50), score, enemies left, the next-wave preview and the countdown.
  - The build bar has a card per tower, each with its cost and hotkey, greyed out when unaffordable.
  - The selected-tower panel shows stats, upgrade and sell buttons with their prices, and the targeting mode.
  - The speed, pause, mute and restart buttons also live here.
  - `hud.ts` compares each value with its last shown value and writes only the ones that changed, using `textContent` and class toggles.
- **Screens:** title, how to play, pause, victory, game over (final score, stats, best score) and restart confirmation.
- **Controls:**

  | Input | Action |
  |---|---|
  | `1`–`5` | Choose a tower to build |
  | Left-click | Place or select |
  | Right-click / `Esc` | Cancel |
  | `U` | Upgrade |
  | `X` | Sell |
  | `T` | Cycle targeting mode |
  | `Space` | Next wave |
  | `P` | Pause |
  | `F` | Cycle speed |
  | `R` | Restart, after confirming |
  | `M` | Mute |
  | Mouse wheel, trackpad pinch, `+` / `-` | Zoom (wheel and pinch zoom at the cursor) |
  | Drag with any button (after 5 px, so clicks still work), or `WASD` / arrow keys | Pan |
  | `Home` | Fit the whole map |
  | `` ` `` | Perf overlay |
- **Audio:** small synthesized sounds created with Web Audio. Each sound has a rate limit so 5,000 enemies can't flood the audio graph. Audio starts on the first click or keypress, as browsers require.

---

## 7. Performance

### 7.1 Budget (Apple M1, Chrome, 60 Hz target)

| Phase | Budget |
|---|---|
| Simulation (one step, stress scenario) | ≤ 5 ms |
| Rendering | ≤ 10 ms |
| HUD and other work | ≤ 1 ms |
| Headroom | rest of 22 ms (the 45 FPS limit) |

### 7.2 Stress scenario (`?stress`)

- **Towers:** 100 placed at max level, a mix of every type.
- **Enemies:** the controller keeps 5,000 alive. It tops the count up each step, and leaked enemies go back to the start.
- **Projectiles:** the controller keeps at least 1,000 in flight. It uses a fire-rate multiplier on projectile towers and adds extra shots when the count drops below 1,000.
- **Lives:** unlimited.
- **Interaction:** the game stays fully playable, with panning, zooming, selecting and upgrading all working.
- **Proof:** the overlay shows live counts of each kind of object, so it's visible that the targets are met.

### 7.3 Measurement

- **The recorder** stores two times per frame in ring buffers that are allocated once: the time between `requestAnimationFrame` callbacks, and the CPU time spent on update and rendering.
- **It reports:**
  - p50, p95 and p99 frame time.
  - The share of frames above 33 ms.
  - FPS at the 95th percentile.
  - Average simulation and render cost.
  - The highest object counts.
- **Pass criteria:**
  - p95 frame interval ≤ 22.2 ms, which means at least 45 FPS for 95% of frames.
  - Fewer than 5% of frames above 33 ms.
- **Benchmark runs.** `?bench=stress` runs a warm-up followed by a fixed measurement window. `?bench=run` lets the bot play all 50 waves at top speed while recording heap samples. Each run puts its results on `window.__bench`.
- **`npm run bench`** drives both runs in system Chrome through playwright-core, then writes the JSON results and a summary for the README.
- **Memory check:** after warm-up, the heap during the full run must stay flat, with no upward trend from one wave to the next.

---

## 8. Testing (Vitest, Node, `sim/` only)

- **Pools:** allocate and free, reuse slots, stale generations are detected, and capacity is respected.
- **Grid:** query results match a brute-force check on random data.
- **Paths:** sample spacing is even, and the end of each path is reached.
- **Determinism:** the same seed and commands, stepped with frame times of 60 Hz, 144 Hz and random jitter, end in identical state.
- **Waves:** there are exactly 50, difficulty never drops from one wave to the next, and every enemy type appears.
- **Balance:** the reference bot wins all 50 waves, and a deliberately weak bot loses before wave 50.
- **Memory:** a full run never goes past a pool's capacity, and pool counts return to 0 after the game ends.

---

## 9. Persistence

- **`localStorage` holds only these keys:**
  - `td.best` (high score)
  - `td.settings` (mute, last speed)
- **No game state is saved.** A run always starts fresh.
- **Every read and write uses try/catch.** The game must work when storage is blocked.
