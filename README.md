# Tower Defence

A single-player tower defense game for desktop browsers. It runs entirely offline, with no server and no external assets. You defend a base against 50 waves by placing, upgrading and selling towers that fire automatically.

> **Status:** in development, being built feature by feature. Done so far: **feature 4 (performance check)** on top of feature 3 (first tower). This is the first playable version: build Bolt towers that shoot Grunts for gold and score. A temporary spawner and readout stand in for waves and the HUD, and there's no game over yet.

### Controls so far

| Input | Action |
|---|---|
| Drag (any mouse button) or `WASD` / arrow keys | Pan |
| Mouse wheel, trackpad pinch, `+` / `-` | Zoom |
| `Home` | Fit the whole map |
| `1` | Build a Bolt (50 gold); click a tile to place it |
| Shift + click | Place and keep building |
| Click a tower | Select it and show its range |
| Right-click / `Esc` | Stop building, or deselect |
| `G` | Spawn 50 Grunts (temporary, until waves arrive) |
| `` ` `` (backtick) | Show or hide the performance overlay |

Open `/?stress` for the stress scenario: 5,000 enemies, 100 towers and 1,000+ projectiles at once. The game stays fully playable there.

## Running it

Requires Node 22 and npm 10.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run test
```

```bash
npm run build
```

`npm run build` type-checks the project and outputs a static site to `dist/`. Open it with `npm run preview`.

To check the running game in real Chrome (dev server must be running):

```bash
node scripts/shot.mjs http://localhost:5173/ --build "7,5;9,7;4,17" --hover 15,10 --wait 8000 --out shot.png
```

It builds Bolts on the listed tiles with real mouse clicks, leaves the build preview over another tile, then prints the game state (lives, gold, score, kills, towers, projectiles, enemies) and any console errors, and saves a screenshot. Some embedded preview panes don't deliver `requestAnimationFrame` callbacks, so the game looks frozen there. Use real Chrome or this script instead.

## Project docs

- [DOMAIN.md](DOMAIN.md): what the game is, its rules, and what's in and out of scope.
- [ARCHITECTURE.md](ARCHITECTURE.md): tools, module layout, data model, loop, rendering and how performance is measured.
- [CLAUDE.md](CLAUDE.md): the engine rules that can't be broken.

## Architecture

*Being written as features land.* So far:

- **Stack:** Vite 8 and TypeScript 7, with strict type checking. The game has no runtime dependencies.
- **Randomness:** gameplay uses a seeded random number generator (`src/rng.ts`, mulberry32) instead of `Math.random`, so the same seed always replays the same run.
- **One loop, fixed steps** (`src/loop.ts`):
  - One `requestAnimationFrame` callback drives the whole app.
  - `FixedStepper` adds real elapsed time × game speed to an accumulator, then runs whole 1/60 s simulation steps.
  - Gameplay therefore depends only on the number of steps, never on the display's refresh rate. A test confirms 30, 60, 120 and 144 Hz and jittery frame times all give the same step count.
  - Frames longer than 100 ms are clamped, and one frame runs at most 16 steps. A slow machine slows the game down instead of falling further and further behind.
- **Separated layers:**
  - **Simulation** (`src/sim/`): pure logic with no browser APIs, so it runs in Node tests. It holds the map, sampled paths, enemies, towers, projectiles, the spatial grid, lives, gold and score.
  - **Rendering** (`src/render/`) reads the simulation and never changes it.
  - **Input** (`src/ui/`) moves the camera, and turns clicks into **commands** (`src/sim/commands.ts`). Commands go into a preallocated queue and are applied at the start of the next step, so gameplay only changes on step boundaries.
- **The map** (`src/sim/map.ts`):
  - 40 × 24 tiles of 32 px, stored as one `Uint8Array` of tile kinds.
  - Two ground paths merge before the base, and an air route crosses the map.
  - Trees and rocks are placed from a fixed seed, never on tiles next to a path, so the map is the same every run.
- **Paths are lookup tables** (`src/sim/path.ts`):
  - Waypoints are joined with rounded corners and resampled every 2 px into `Float32Array`s of position, sideways normal and one of 16 headings.
  - An enemy's position is a table lookup by distance travelled, plus its lane offset along the normal. No enemy ever runs pathfinding, so moving 5,000 enemies is a few multiply-adds each.
  - The normals change smoothly through corners, so enemies in outer lanes swing wide and inner ones cut close, without jumps.
- **Enemies are stored as a structure of arrays** (`src/sim/enemies.ts`):
  - One typed array per field, with capacity for 8,192 enemies, all allocated once.
  - Each enemy has a fixed slot and a generation counter, so other systems can keep a reference that detects when the enemy is gone.
  - A packed list of active slots keeps iteration fast, and removal is a swap with the last entry.
  - Freeing waits until the end of the step, so a slot is never reused in the same step it was freed.
- **Spatial grid** (`src/sim/grid.ts`):
  - A uniform grid of 64 px cells, rebuilt every step with a counting sort: count enemies per cell, take running totals, then write slots into one `Int32Array`. It's O(n) and allocates nothing.
  - A radius query only visits the cells the circle overlaps, and writes matches into a shared preallocated buffer.
  - Tower targeting and stray-projectile hits use it, and so does the renderer's culling.
- **Step order** (`Game.step`): apply commands → move enemies → rebuild the grid → towers → projectiles → free dead enemies.
- **Towers** (`src/sim/towers.ts`):
  - Dense typed arrays, plus a per-tile lookup so the UI can refer to towers by tile.
  - A tower keeps its target until the target dies or leaves range, and re-picks at most every 6 steps (0.1 s). That bounds grid queries to about one per tower per 6 steps.
  - The **First** targeting mode picks the in-range enemy with the least path left.
  - Turrets turn at a limited speed and only fire once aimed within 0.3 rad, so shots visibly follow the turret.
- **Projectiles** (`src/sim/projectiles.ts`):
  - Dense typed arrays; removal moves the last projectile into the gap.
  - They home in on their target's slot and generation. If the target dies first, they fly on for at most 0.25 s, hitting anything they touch (found with the grid), then fizzle.
- **Damage** goes through one function (`Game.damage`): armor takes a flat amount off each hit, a hit always does at least 20%, and it triggers the hit flash and kill rewards.
- **Sim → client events** (`src/sim/events.ts`): the simulation writes small integer records (such as "enemy reached the base") into a preallocated ring buffer. The client reads it once per frame for feedback. The simulation never calls rendering or audio code.

## Rendering approach

- **Canvas 2D** with `alpha: false`, sized to the window × `devicePixelRatio`.
- **The camera is applied once per frame:** one `setTransform` per frame, so everything is drawn in world coordinates.
- **The static map is pre-rendered once:** grass, grid, water, paths, the air route, portal pads, the base platform and scenery go into an offscreen canvas at 2× resolution. Each frame copies **only the visible part** with a single `drawImage`, so the cost doesn't grow with map detail.
- **Animated scenery is cheap:** the portal swirls and the crystal core are drawn each frame. Their glows are pre-rendered sprites faded with `globalAlpha`, so nothing like a gradient is created per frame. They're skipped when off screen.
- **Animations follow game time,** interpolated between steps, so they freeze when the game is paused and speed up at 2× and 4×.
- **One sprite atlas** (`src/render/atlas.ts`): every entity sprite is drawn in code at startup into one 3×-resolution canvas. All entity draws use that same source image, which lets the browser batch them.
- **Enemies are drawn interpolated:** each enemy is drawn between its previous and current step position with one `drawImage`, so movement is smooth at any refresh rate.
- **Culling through the grid:** the renderer walks only the grid cells overlapping the view, plus one cell of margin. A row of cells is one contiguous run in the grid's slot array, so each visible row is one loop. Visible enemies and their interpolated positions go into preallocated arrays that every later pass reuses. The cost follows what's on screen, not how many enemies exist.
- **Draw order:** background → portals → selection ring → tower bases → turrets (one rotated `setTransform` each) → enemies → base → bolt tracers → health bars → build preview.
- **Batched strokes and fills:** all bolt tracers are two strokes in total (a glow and a core). Health bars, shown only for damaged enemies, are one fill for the backgrounds and one per colour band (green, yellow, red).
- **Hit flash:** each enemy sprite has a white-tinted copy in the atlas, swapped in for 0.08 s after a hit. There's no per-draw filter or compositing.
- **Build preview:** the hovered tile turns green or red depending on the same `canPlace` check the simulation uses, with a ghost tower and its range ring.
- **Leak feedback:** when an enemy reaches the base, a red glow flashes over it and fades in real time.

*Still to come: directional sprites, particles and effects. See ARCHITECTURE.md §5.*

## Performance bottlenecks

Measured with the per-frame CPU split from the recorder below:

- **Simulation is cheap.** With 5,000 enemies, 100 towers and 1,000+ projectiles, one 1/60 s step takes about **0.7–1 ms** on an Apple M1. Enemy movement is a table lookup, the grid rebuild is linear, and targeting is bounded by the 0.1 s re-pick interval.
- **Rendering is the larger share,** at about **3 ms of JavaScript per frame** with the whole map visible. Most of that is the ~5,000 enemy `drawImage` calls and the ~1,000 tracer segments.
- **GPU fill is the next limit.** The canvas commands are executed by the GPU after the JavaScript returns, so the JavaScript time leaves this out. Zoomed in, each enemy sprite covers many more device pixels (about 120×120 at 2.5× zoom on a 2× screen), and transparent padding inside a sprite frame is still filled. That's why sprite frames are cropped tightly.
- **The machine's power state can cap the frame rate.** On battery at or below 20%, Chrome caps pages at 30 FPS. Even an empty page then measures 30 FPS. Benchmarks must run on mains power (see below).

## Optimizations

- **Typed-array storage** for enemies, projectiles and towers, allocated once. There's no per-frame garbage, and the heap stayed at about 4–5 MB through every stress run.
- **Path lookup tables** instead of per-enemy pathfinding.
- **A counting-sort spatial grid** for targeting, stray-projectile hits and culling.
- **Target stickiness:** towers re-query at most every 6 steps.
- **Grid-based culling:** the renderer only walks grid cells on screen, so cost follows what's visible.
- **One sprite atlas,** so every entity draw uses the same source image and Chrome can batch them.
- **Batched vector drawing:** all tracers are 2 strokes, and all health bars are 4 fills.
- **Tight sprite frames:** the Grunt frame went from 30×30 to 24×24 world px, 36% fewer pixels filled per enemy.
- **DOM updates only on change:** the temporary readout writes only when a number changes, and the perf overlay refreshes 4 times a second, not every frame.

## How performance is measured

- **Frame recorder** (`src/perf/recorder.ts`):
  - Every frame, the loop records the **frame interval** (time between `requestAnimationFrame` callbacks, which is what the player sees) and the **CPU time** spent in simulation and in rendering. They go into ring buffers allocated once.
  - It also records **input latency:** the time from a pointer or keyboard event to the start of the next frame.
  - From these it computes p50, p95 and p99 frame interval, FPS at the 95th percentile, the share of frames over 33 ms, and the share at or above 45 FPS.
- **Overlay:** press `` ` `` in game. It shows the last ~2 s of these numbers, plus live counts of enemies, drawn enemies, towers and projectiles. Its border is green when both targets are met.
- **Pass criteria:** p95 frame interval ≤ 22.2 ms (at least 45 FPS for 95% of frames) **and** fewer than 5% of frames over 33 ms.
- **`npm run bench`** (`scripts/bench.mjs`):
  - It builds the production bundle, serves it with `vite preview`, and opens it in the installed Google Chrome through playwright-core.
  - The viewport is 1440×900 at 2× pixel ratio.
  - Each scenario warms up for 3 s, then records every frame for 20 s.
  - It writes `bench/results/<scenario>.json` and prints a summary table.
  - The four scenarios:

    | Scenario | What it does |
    |---|---|
    | `stress-fit` | Whole map in view, so every object is drawn (the worst case for rendering) |
    | `stress-zoom` | Zoomed 2.5× at the centre, so culling skips off-screen objects |
    | `stress-interactive` | Whole map while the script pans, zooms, clicks towers and toggles build mode |
    | `control-interactive` | The same input on a near-empty game, to show what the input harness itself costs |
- **During each run, the script also records:**
  - the lowest enemy and projectile counts seen at the end of any frame, to prove the load was held the whole time;
  - JavaScript heap at the start, end and peak;
  - the CPU, Chrome version and viewport.
- **Run it on mains power with the Chrome window in front.** Low battery makes Chrome cap pages at 30 FPS. That also caps headless runs, and a launch flag doesn't lift it.

### Results

Apple M1 (8 cores), Chrome 157, headed window, 1440×900 at 2× pixel ratio, mains power. Each scenario: 3 s warm-up, then 20 s of measured frames.

| Scenario | Result | Avg FPS | p95 frame | FPS at p95 | Frames over 33 ms | Sim CPU | Render CPU | Min enemies | Min projectiles | Drawn | Heap start → end |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `stress-fit` | **PASS** | 59.9 | 17.6 ms | 56.8 | 0.17% | 0.89 ms | 3.30 ms | 5,041 | 1,101 | 5,048 | 4.5 → 4.0 MB |
| `stress-zoom` | **PASS** | 60.0 | 17.7 ms | 56.5 | 0.00% | 0.94 ms | 1.59 ms | 5,041 | 1,101 | 2,291 | 4.5 → 4.1 MB |
| `stress-interactive` | **PASS** | 59.8 | 17.7 ms | 56.5 | 0.25% | 1.05 ms | 3.03 ms | 5,041 | 1,101 | 4,287 | 4.3 → 4.8 MB |
| `control-interactive` | **PASS** | 60.0 | 17.6 ms | 56.8 | 0.00% | 0.03 ms | 0.16 ms | – | – | 22 | 4.7 → 4.8 MB |

What this shows:

- **Every scenario holds the display's 60 Hz** with the full load: at least 5,000 enemies, 100 towers and 1,100 projectiles in every frame. That leaves a wide margin over both targets (45 FPS at p95, under 5% of frames over 33 ms).
- **CPU use is about 4 ms of a 16.7 ms frame,** so there's room for the remaining towers, enemies and effects.
- **Culling works:** zoomed in, less than half the enemies are drawn and render time halves (3.3 → 1.6 ms), while the simulation cost stays the same.
- **Input stays responsive under load.** Average input latency is 15.2 ms under stress against 14.6 ms in the control, so the difference is the harness, not the game.
- **Memory is flat:** the heap moves by less than 1 MB over each run, with no growth.

Raw results are in `bench/results/`. The earlier battery runs were dropped because Chrome was capping them at 30 FPS.
