# Tower Defence

A single-player tower defense game for desktop browsers. It runs entirely offline, with no server and no external assets. You defend a base against 50 waves by placing, upgrading and selling towers that fire automatically.

> **Status:** in development, being built feature by feature. Done so far: **feature 1 (loop, map and camera)**. The map draws, and the camera pans and zooms. There are no enemies or towers yet, so the game is not playable.

### Controls so far

| Input | Action |
|---|---|
| Drag (any mouse button) or `WASD` / arrow keys | Pan |
| Mouse wheel, trackpad pinch, `+` / `-` | Zoom |
| `Home` | Fit the whole map |

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
  - **Simulation** (`src/sim/`): pure logic with no browser APIs, so it runs in Node tests. It currently holds the map and the step counter.
  - **Rendering** (`src/render/`) reads the simulation and never changes it.
  - **Input** (`src/ui/`) moves the camera.
- **The map** (`src/sim/map.ts`):
  - 40 × 24 tiles of 32 px, stored as one `Uint8Array` of tile kinds.
  - Two ground paths merge before the base, and an air route crosses the map.
  - Trees and rocks are placed from a fixed seed, never on tiles next to a path, so the map is the same every run.

## Rendering approach

- **Canvas 2D** with `alpha: false`, sized to the window × `devicePixelRatio`.
- **The camera is applied once per frame:** one `setTransform` per frame, so everything is drawn in world coordinates.
- **The static map is pre-rendered once:** grass, grid, water, paths, the air route, portal pads, the base platform and scenery go into an offscreen canvas at 2× resolution. Each frame copies **only the visible part** with a single `drawImage`, so the cost doesn't grow with map detail.
- **Animated scenery is cheap:** the portal swirls and the crystal core are drawn each frame. Their glows are pre-rendered sprites faded with `globalAlpha`, so nothing like a gradient is created per frame. They're skipped when off screen.
- **Animations follow game time,** interpolated between steps, so they freeze when the game is paused and speed up at 2× and 4×.

*Still to come: the sprite sheet for entities, grid-based culling, and draw passes. See ARCHITECTURE.md §5.*

## Performance bottlenecks

*To be filled in from measurements (feature 4 onward).*

## Optimizations

*To be filled in as they're added.*

## How performance is measured

*To be filled in with the benchmark setup and results (features 4 and 12).*
