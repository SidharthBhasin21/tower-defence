# Tower Defense

Stack: Vite + TypeScript, Canvas 2D (or PixiJS), no runtime deps on external services.

## Non-negotiable rules

- ONE requestAnimationFrame loop. No per-entity timers/loops.
- Fixed timestep simulation (e.g. 60Hz) with accumulator; render interpolates. Game speed = steps per frame.
- No allocations in the hot loop: typed arrays (SoA) + object pools.
- Spatial hash grid for targeting and collisions.
- Viewport culling in the renderer.
- Targets: 5000 enemies, 100 towers, 1000 projectiles at 45+ FPS (p95), <5% frames over 33ms.

## Docs

Keep README.md updated with every design decision (architecture, rendering, bottlenecks, optimizations, measurement).

## Commands

npm run dev | npm run build | npm run test
