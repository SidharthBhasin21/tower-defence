# Tower Defence

A single-player tower defense game for desktop browsers. It runs entirely offline, with no server and no external assets. You defend a base against 50 waves by placing, upgrading and selling towers that fire automatically.

> **Status:** in development, being built feature by feature. Done so far: **feature 2 (paths and enemies)**. Grunts walk both paths and cost lives when they reach the base. There are no towers yet, so the game is not playable. A temporary spawner and readout stand in for waves and the HUD.

### Controls so far

| Input | Action |
|---|---|
| Drag (any mouse button) or `WASD` / arrow keys | Pan |
| Mouse wheel, trackpad pinch, `+` / `-` | Zoom |
| `Home` | Fit the whole map |
| `G` | Spawn 50 Grunts (temporary, until waves arrive) |

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
node scripts/shot.mjs http://localhost:5173/ --keys KeyG --wait 8000 --out shot.png
```

It prints the game state (steps, lives, enemies) and any console errors, and saves a screenshot. Some embedded preview panes don't deliver `requestAnimationFrame` callbacks, so the game looks frozen there. Use real Chrome or this script instead.

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
  - **Simulation** (`src/sim/`): pure logic with no browser APIs, so it runs in Node tests. It holds the map, sampled paths, enemies, lives and an event queue.
  - **Rendering** (`src/render/`) reads the simulation and never changes it.
  - **Input** (`src/ui/`) moves the camera.
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
- **Sim → client events** (`src/sim/events.ts`): the simulation writes small integer records (such as "enemy reached the base") into a preallocated ring buffer. The client reads it once per frame for feedback. The simulation never calls rendering or audio code.

## Rendering approach

- **Canvas 2D** with `alpha: false`, sized to the window × `devicePixelRatio`.
- **The camera is applied once per frame:** one `setTransform` per frame, so everything is drawn in world coordinates.
- **The static map is pre-rendered once:** grass, grid, water, paths, the air route, portal pads, the base platform and scenery go into an offscreen canvas at 2× resolution. Each frame copies **only the visible part** with a single `drawImage`, so the cost doesn't grow with map detail.
- **Animated scenery is cheap:** the portal swirls and the crystal core are drawn each frame. Their glows are pre-rendered sprites faded with `globalAlpha`, so nothing like a gradient is created per frame. They're skipped when off screen.
- **Animations follow game time,** interpolated between steps, so they freeze when the game is paused and speed up at 2× and 4×.
- **One sprite atlas** (`src/render/atlas.ts`): every entity sprite is drawn in code at startup into one 3×-resolution canvas. All entity draws use that same source image, which lets the browser batch them.
- **Enemies are drawn interpolated:** each enemy is drawn between its previous and current step position with one `drawImage`, so movement is smooth at any refresh rate. Off-screen enemies are skipped with a bounds check; feature 3 replaces this with grid-based culling.
- **Leak feedback:** when an enemy reaches the base, a red glow flashes over it and fades in real time.

*Still to come: grid-based culling, directional sprites, and the full draw passes. See ARCHITECTURE.md §5.*

## Performance bottlenecks

*To be filled in from measurements (feature 4 onward).*

## Optimizations

*To be filled in as they're added.*

## How performance is measured

*To be filled in with the benchmark setup and results (features 4 and 12).*
