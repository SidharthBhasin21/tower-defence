# Tower Defence

A single-player tower defense game for desktop browsers. It runs entirely offline, with no server and no external assets. You defend a base against 50 waves by placing, upgrading and selling towers that fire automatically.

> **Status:** in development, being built feature by feature. The project is at **feature 0 (groundwork)**: an empty canvas, strict TypeScript and a working test setup. The game is not playable yet.

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

*To be written as features land.* So far:

- **Stack:** Vite 8 and TypeScript 7, with strict type checking. The game has no runtime dependencies.
- **Randomness:** gameplay uses a seeded random number generator (`src/rng.ts`, mulberry32) instead of `Math.random`, so the same seed always replays the same run.

## Rendering approach

*To be written.* Plan: Canvas 2D, a sprite sheet generated at startup, a pre-rendered map background, and only drawing what's on screen. See ARCHITECTURE.md §5.

## Performance bottlenecks

*To be filled in from measurements (feature 4 onward).*

## Optimizations

*To be filled in as they're added.*

## How performance is measured

*To be filled in with the benchmark setup and results (features 4 and 12).*
