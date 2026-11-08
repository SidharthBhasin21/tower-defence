# Tower Defence

A single-player tower defense game for desktop browsers. It runs entirely offline, with no server and no external assets. You defend a base against 50 waves by placing, upgrading and selling towers that fire automatically.

> **Status:** in development, being built feature by feature. Done so far: **feature 11 (balance)**. The game is playable from start to finish:
> - Five towers: Bolt, Cannon, Frost, Arc and Sniper, each attacking in its own way.
> - Seven enemies: Grunt, Runner, Swarmling, Brute (armored), Wisp (flies), Mender (heals) and the Warlord boss (splits into Runners).
> - Towers upgrade to level 4 and sell for 70% of what was spent on them. Each tower has a targeting mode (First, Last, Strongest or Closest), all set from a tower panel.
> - 50 waves with a countdown between them, plus a bonus for calling the next wave early.
> - Victory and game-over screens, with the best score kept on this device.
> - Pause, three game speeds, and restart.
> - A HUD (lives, gold, wave, score, enemies left, next-wave preview with a **Send now** button, pause/speed/sound/restart buttons), a build bar of tower cards, toasts, and a **How to play** screen.
> - Sound effects made in code (each tower, kills, explosions, leaks, building, upgrades, waves, bosses, win and loss), death bursts, sparks, floating gold numbers and screen shake.
>
> - Balanced with a scripted bot: a good mixed defence wins, while a weak defence or any single tower type loses. See [Balance](#balance).
>
> Still to come: feature 12, the final stress test, benchmarks and README.

### Controls so far

| Input | Action |
|---|---|
| Drag (any mouse button) or `WASD` / arrow keys | Pan |
| Mouse wheel, trackpad pinch, `+` / `-` | Zoom |
| `Home` | Fit the whole map |
| `1`–`5`, or click a card in the build bar | Build a Bolt (50), Cannon (90), Frost (70), Arc (110) or Sniper (140); click a tile to place it |
| Shift + click | Place and keep building |
| Click a tower | Select it: shows its range and the tower panel |
| `U` / `X` / `T` | With a tower selected: upgrade / sell / cycle targeting mode (or use the panel's buttons) |
| Right-click / `Esc` | Stop building, or deselect |
| `Space` | Start the next wave (early during the countdown pays bonus gold) |
| `P` | Pause or resume |
| `F` | Cycle game speed: 1×, 2×, 4× (remembered) |
| `R` | Restart (asks first while a game is in progress) |
| `M` | Mute or unmute (remembered) |
| `` ` `` (backtick) | Show or hide the performance overlay |

Add `?play` to the URL to skip the title screen. Open `/?stress` (or use the title screen's **Stress test** button) for the stress scenario: 5,000 enemies, 100 towers and 1,000+ projectiles at once. The game stays fully playable there.

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

```bash
npm run balance -- --margin --waves
```

`npm run balance` plays full 50-wave games with the scripted bot in Node (no browser, about 3 seconds) and prints how far each strategy gets. See [Balance](#balance).

`npm run build` type-checks the project and outputs a static site to `dist/`. Open it with `npm run preview`.

To check the running game in real Chrome (dev server must be running):

```bash
node scripts/shot.mjs http://localhost:5173/ --build "7,5;9,7;4,17" --hover 15,10 --wait 8000 --out shot.png
```

It builds towers on the listed tiles with real mouse clicks (`k@tx,ty` picks tower `k`; `--gold N` sets the gold first), leaves the build preview over another tile, then prints the game state (lives, gold, score, kills, towers, projectiles, enemies) and any console errors, and saves a screenshot. Some embedded preview panes don't deliver `requestAnimationFrame` callbacks, so the game looks frozen there. Use real Chrome or this script instead.

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
- **Step order** (`Game.step`): apply commands → wave scheduler spawns → move enemies → rebuild the grid → towers → projectiles → free dead enemies → wave bookkeeping (clear bonuses, countdown, win and loss).
- **Waves** (`src/sim/waves.ts`):
  - All 50 waves are generated once at startup from curves, not written by hand.
    - Health multiplier: `1 + 0.09n + 0.0075n²` (n = wave − 1), ×1 at wave 1 rising to about ×23 by wave 50.
    - Wave size: 10 Grunt-equivalents rising to about 100.
    - Spawn spacing: shrinks to 35%.
  - A roster says which wave each enemy type first appears in: Runner 3, Swarmling 5, Brute 7, Wisp 9, Warlord 10, Mender 12. Each type has a weight (its share of the wave) and a threat cost in Grunt-equivalents, and the budget is split by weight.
  - Warlords come on top of the budget on waves 10 and 20 (one), 30 and 40 (two) and 50 (three).
  - **Difficulty never drops:** a wave's *threat* (Σ count × threat cost × health multiplier) is never below the previous wave's. The wave after a boss carries the boss's threat forward as extra regular enemies, and rounding shortfalls are topped up with Grunts. A test checks this, the introduction schedule and the boss waves. Raw enemy count can dip when a few Brutes replace many Swarmlings.
  - Each wave is a list of spawn groups `{ type, count, interval, delay, pathMask }`. At runtime one scheduler ticks a fixed list of up to 64 active groups held in typed arrays, so waves called early simply overlap.
  - Every enemy carries its wave index. Per-wave counters of enemies "still to spawn" and "still in play" drive the clear bonus and the countdown, which starts once the newest wave has spawned.
  - Calling early pays 1 gold per second skipped.
- **Game states** (DOMAIN.md §2.6):
  - The simulation knows only **Playing**, **Won** and **Lost**. Once the game is won or lost, `step()` does nothing, so the field freezes behind the end screen.
  - Title, pause and the restart confirmation are client states: they stop the fixed stepper, but rendering and the camera keep running.
  - Restart resets the existing typed arrays instead of reallocating them.
- **Speed and determinism:** game speed is how many fixed steps fit in a frame, and the speed setting is saved on the device. A test plays the same scripted game (towers, early calls) at 60 Hz, 144 Hz, with jittery frame times, and at 2× and 4×, and checks that every run ends in identical state.
- **Towers** (`src/sim/towers.ts`):
  - Dense typed arrays, plus a per-tile lookup so the UI can refer to towers by tile.
  - A tower keeps its target until the target dies or leaves range, and re-picks at most every 6 steps (0.1 s). That bounds grid queries to about one per tower per 6 steps.
  - The **First** targeting mode picks the in-range enemy with the least path left.
  - Turrets turn at a limited speed and only fire once aimed within 0.3 rad, so shots visibly follow the turret.
- **Projectiles** (`src/sim/projectiles.ts`):
  - Dense typed arrays; removal moves the last projectile into the gap.
  - They home in on their target's slot and generation. If the target dies first, they fly on for at most 0.25 s, hitting anything they touch (found with the grid), then fizzle.
- **Damage** goes through one function (`Game.damage`):
  - Armor takes a flat amount off each hit, but a hit always does at least 20%.
  - Each tower has an armor mode: full (most towers), half (Arc) or ignored (Sniper).
  - It also triggers the hit flash and the kill rewards.
- **Five towers, four kinds of attack** (`src/sim/towers.ts`, numbers in `src/config.ts`):
  - **Bolt:** homing projectile; fast, cheap; hits air.
  - **Cannon:** a shell fired at where the target *will be*, found by walking the enemy's path ahead for the shell's flight time. It bursts on landing with splash that falls from 100% at the centre to 50% at the rim. Ground only.
  - **Frost:** no turret. A pulse damages and slows every enemy in range, air included. Slows don't stack: the strongest active slow wins.
  - **Arc:** no turret. Instant lightning that jumps up to 4 times to the nearest enemy not yet struck within 64 px, keeping 80% of the damage each jump. Armor counts half. Ground only.
  - **Sniper:** slow-turning rifle with 220 px range. Instant 130-damage hits that ignore armor, 0.35 shots a second; hits air.
  - All targeting and splash use the same spatial grid queries. A chain keeps its struck list in a small preallocated array.
- **Tower levels** (`src/config.ts`):
  - Each type has stats for levels 1–4, precomputed once into `TOWER_STATS[type][level − 1]`. The game loop just indexes that table.
  - Upgrades raise damage (×1.5, ×2.15, ×3), range (up to +25%) and fire rate (up to +35%). Frost also slows harder and longer, and Arc jumps 1–2 more times.
  - Upgrade costs are 0.75×, 1.15× and 1.7× the build cost, so each costs more than the last.
  - A tower remembers all the gold put into it; selling refunds 70% of that.
- **Upgrade, sell and targeting are commands,** like building, so they apply on a step boundary.
  - While paused, queued commands are applied once per frame without stepping, so you can manage towers in a paused game.
  - Selling removes a tower by moving the last tower into its slot and fixing the per-tile lookup.
- **Targeting modes** (`acquire` in `src/sim/towers.ts`): First (least path left), Last (most path left), Strongest (most *current* health) and Closest (nearest the tower). Each mode turns into a score where lower wins, so one loop over the grid query serves all four. Changing the mode makes the tower re-pick on the next step.
- **Seven enemies** (numbers in `src/config.ts`): Grunt, Runner (fast, fragile), Swarmling (tiny, in packs), Brute (slow, armor 6), Wisp (flies the air route, so Cannon and Arc can't hit it), Mender and the Warlord.
  - **Mender:** every 2.5 s it heals each hurt enemy within 72 px, itself included, by 10% of their max health. This runs right after the grid rebuild, so it's one grid query per Mender.
  - **Warlord:** when killed, it queues a split: 6 Runners, spaced along the path where it died, with that wave's health scaling. They're added after the step's frees, never mid-step. The split holds the wave open until those Runners are gone too.
- **Effects are written by the simulation** (`src/sim/fx.ts`):
  - Only the sim knows where a chain jumped or a shell burst, so it writes beams (lightning, sniper tracers) and rings (frost pulses, explosions, Mender heals) into two fixed pools of 512.
  - The pools age in game time, so effects freeze when paused. Gameplay never reads them.
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
- **Draw order:** background → portals → selection ring → tower bases → turrets (one rotated `setTransform` each) → ground enemies → Warlords → flyer shadows (one fill) → flyers → base → bolt tracers and cannon shells → rings and beams → health bars → build preview.
- **Tower levels** show as gold pips under each upgraded tower: one batched fill for all of them. The selection ring uses the tower's current level range.
- **Flyers** are drawn 12 px above their ground position with a gentle hover, so they read as airborne and pass over everything on the ground.
- **Batched strokes and fills:**
  - All bolt tracers are two strokes in total (a glow and a core).
  - All cannon shells are two fills: their ground shadows, then the shells, lifted along a parabolic arc computed from their flight time.
  - All lightning is one path stroked twice. Its jagged shape comes from a cheap hash, re-shaped every 4 steps so it flickers.
  - The few sniper tracers, frost rings and explosion rings fade individually with `globalAlpha`. All are culled against the view. Health bars, shown only for damaged enemies, are one fill for the backgrounds and one per colour band (green, yellow, red).
- **Hit flash:** each enemy sprite has a white-tinted copy in the atlas, swapped in for 0.08 s after a hit. There's no per-draw filter or compositing.
- **Build preview:** the hovered tile turns green or red depending on the same `canPlace` check the simulation uses, with a ghost tower and its range ring.
- **Leak feedback:** when an enemy reaches the base, a red glow flashes over it, the view shakes slightly and a low buzz plays.
- **Particles:** enemies burst into squares of their own colour when they die, shells throw fire, bolts spark on impact, and a Warlord's death is a big burst plus a stronger shake. Particles live in a 4,096-slot typed-array pool written by the sim (like beams and rings), so they freeze when paused and follow game speed. They shrink as they fade instead of using per-particle alpha, so all particles of one colour are a single path and a single `fill` (10 colours, so at most 10 fills).
- **Floating gold:** each kill shows "+N" rising from the enemy. 96 slots; when full the oldest is reused. The strings `"+0"`…`"+999"` are built once at startup, so drawing them creates no strings.
- **Flyers are hit where they're drawn:** bolts climb to a flyer's drawn height over the last 90 px of flight, sniper tracers end at the raised body, and flyer death bursts and gold numbers appear at that height too. (Before, bolts visibly hit a Wisp's shadow.)
- **Screen shake:** a decaying random offset added to the camera transform once per frame, for leaks, boss arrivals and Warlord deaths. Off in stress mode.

## Sound

All sounds are synthesized with Web Audio at runtime (`src/audio/sfx.ts`): short oscillator sweeps and filtered bursts from one shared second of noise, through a compressor so overlapping sounds don't clip. There are no audio files.

- **Driven by sim events.** The client already drains the event queue once per frame; shots, kills, explosions, leaks, builds, upgrades, sales, refused actions, wave start and clear, boss arrival, victory and defeat each map to a sound.
- **Rate-limited so a busy game can't flood the audio graph.** Each sound has a minimum gap between plays (45 ms for kill pops up to 1 s for the end jingles), and at most 6 new sounds start per frame. Web Audio nodes are objects, so each sound allocates a few; the limits keep that to a few dozen sounds a second at most, outside the simulation, and the stress benchmark below runs with sound on.
- **Small random detune** on every play so repeated shots don't sound mechanical; kill pops are pitched by enemy size.
- **Starts on the first click or key press,** as browsers require. Mute (`M` or the HUD button) is saved with the other settings.

## Balance

Balance is tested by playing, not by guessing. `src/sim/bot.ts` is a scripted player that uses the same actions a person does (build, upgrade, send the next wave). It runs the real simulation in Node, so a full 50-wave game takes well under a second.

**How the bot plays:**
- Before the game it scores every buildable tile for each tower type by how much path the tower would cover from there. The air route only counts for towers that hit air, and counts for less, since fewer enemies fly.
- It keeps its tower count at `3 + 0.6 × wave` (up to 40). Each new tower is the type furthest below its share of the mix (Bolt 3 : Cannon 2 : Frost 1 : Arc 2 : Sniper 2), on that type's best free tile. If that type isn't affordable yet it saves for it.
- Once it has enough towers it upgrades, lowest level first.
- It sends the next wave early only when the map is empty. It never sells and never changes targeting modes, so a person has tricks it doesn't.

**What "balanced" means here,** and the checks in `tests/balance.test.ts`:
1. The **reference bot** (the mix above) clears all 50 waves.
2. It has **some slack, but not much.** The *margin* is how much tower fire rate it can lose and still win, found by binary search (`npm run balance -- --margin`). The test checks that it wins at 80% fire rate and loses at 60%, and that it falls in the late game, not on the first boss.
3. A **weak player** (8 Bolts, never upgraded) loses.
4. **Every single-tower strategy loses,** so the player has to mix tower types (DOMAIN.md §5).

**Before tuning,** the game was far too easy and the Sniper was too strong. "Died on" is the newest wave in play when lives hit 0. Waves overlap, and a boss wave stays open while the next ones start on their timers, so it can be a few waves past the last one cleared.

| Strategy | Before: died on (cleared) | After: died on (cleared) | What got through, after |
|---|---|---|---|
| Reference bot | **Won**, 20/20 lives, **margin 2.22** | **Won**, 20/20 lives, **margin 1.44** | nothing |
| Weak bot | 13 (9) | 12 (9) | Wisps |
| Bolt only | 44 (42) | 33 (29) | Wisps, a Warlord |
| Cannon only | 11 (9) | 11 (9) | Wisps (can't hit air) |
| Frost only | 14 (9) | 11 (7) | Wisps, Brutes |
| Arc only | 11 (9) | 11 (9) | Wisps (can't hit air) |
| Sniper only | **Won**, 20/20 lives | 43 (39) | Runners, a Warlord |

A margin of 2.22 meant a strong player could lose more than half their firepower and still win, and the weakened bot failed on wave 13 rather than near the end. By wave 35 it had every tower at max level and gold piling up.

**What changed:**
- **Health curve:** the quadratic term went from `0.0035n²` to `0.0075n²`. Early waves barely change (wave 10 is ×2.4 instead of ×2.1), while the late game is much tougher: wave 50 enemies have about ×23 base health instead of ×14. Now the weakened reference bot's first failure is wave 50, so difficulty really does keep rising to the end.
- **Sniper:** range 270 → 220 px and fire rate 0.4 → 0.35 shots a second. On its own it now falls at wave 43, overrun by Runners. It's still the longest-range tower and the best boss killer.
- **Warlord leak:** 20 → 10 lives (DOMAIN.md §2.4, changed at the user's request). With 20 lives, one boss getting through ended the game outright; now it's a heavy blow but survivable. It doesn't change the bot results above, because none of those games were lost to a single boss leak.
- I tried a steeper curve (`0.012n²`) and the reference bot lost at wave 30, so the chosen value sits between "too easy" and "unwinnable for a strong player".

**What ends games:** mostly **Wisps**. They fly their own route, which Cannon and Arc can't hit, so a defence without air cover (Bolt, Frost or Sniper near the air route) falls soon after they arrive at wave 9. That's the main reason single-tower and careless builds lose, and the reason the mix matters.

The seed only changes where enemies walk within their lane, so all seeds give nearly the same result: balance doesn't depend on luck.

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
- **Particles batched by colour:** at most 10 fills for up to 4,096 particles, no per-particle alpha. Under `?stress` the pool holds 2,300–3,900 live particles (mostly bolt sparks) and the text pool is full, and render time stayed at about 3.7–3.9 ms per frame, the same as before particles existed.
- **No strings in the draw loop:** floating gold numbers come from a startup cache.
- **Rate-limited sound:** per-sound minimum gaps and 6 new sounds per frame at most.
- **Tight sprite frames:** the Grunt frame went from 30×30 to 24×24 world px, 36% fewer pixels filled per enemy.
- **DOM updates only on change:** the HUD keeps the last value it showed for each field and writes only what changed (`textContent` and class toggles). A quiet frame touches no DOM. The next-wave preview is rebuilt once per wave, and the perf overlay refreshes 4 times a second, not every frame. An A/B run of `?stress` with the HUD shown and hidden gave the same render time (3.5–3.6 ms vs 3.4–3.8 ms per frame).

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
| `stress-fit` | **PASS** | 59.9 | 17.6 ms | 56.8 | 0.17% | 1.00 ms | 3.92 ms | 5,094 | 1,103 | 5,145 | 5.7 → 5.2 MB |
| `stress-zoom` | **PASS** | 60.0 | 17.6 ms | 56.8 | 0.00% | 1.09 ms | 1.77 ms | 5,094 | 1,103 | 1,673 | 6.1 → 5.4 MB |
| `stress-interactive` | **PASS** | 59.4 | 17.6 ms | 56.8 | 0.25% | 1.01 ms | 3.70 ms | 5,092 | 1,103 | 4,944 | 6.0 → 6.7 MB |
| `control-interactive` | **PASS** | 59.6 | 17.6 ms | 56.8 | 0.17% | 0.02 ms | 0.12 ms | – | – | 0 | 5.1 → 5.3 MB |

*Measured after feature 10 (load average about 6), with the HUD, particles, floating text and sound on, and all 100 stress towers at **level 4**, the heaviest case: longest ranges and most chain jumps. Stress enemies have 1,800 health so most survive.*

**Background load matters.** A first run after feature 9, with the load average at 31 (another browser at 100% CPU plus Spotlight indexing), failed `stress-fit` and `stress-interactive`: 18% and 9% of frames over 33 ms. Its *simulation* time also more than doubled (2.8 ms vs 1.2 ms), and the HUD can't affect that, so the machine was the cause. An A/B check with the HUD shown and hidden confirmed it. The rerun above was taken at a load average of about 13 falling to 6. Final numbers for feature 12 will be taken on an idle machine.
- **Towers:** a mix of all five types (50 Bolt, 20 Cannon, 10 each of Frost, Arc and Sniper), with their shells, lightning, tracers and rings.
- **Towers at level 4** since feature 8.
- **Enemies:** a mix of all seven types (30% Grunt, 20% Runner, 24% Swarmling, 10% Brute, 10% Wisp, 5% Mender, 1% Warlord). That includes about 500 flyers, Mender heal pulses and Warlord splits.

Earlier runs with fewer types gave the same picture, within ±1 FPS.

What this shows:

- **Every scenario holds the display's 60 Hz** with the full load: at least 5,000 enemies, 100 towers and 1,100 projectiles in every frame. That leaves a wide margin over both targets (45 FPS at p95, under 5% of frames over 33 ms).
- **CPU use is about 4 ms of a 16.7 ms frame,** so there's room for the remaining towers, enemies and effects.
- **Culling works:** zoomed in, less than half the enemies are drawn and render time about halves (3.1 → 1.7 ms), while the simulation cost stays the same.
- **Input stays responsive under load.** Average input latency is 15.1 ms under stress against 17.2 ms in the control, so the difference is the harness, not the game.
- **Memory is flat:** the heap moves by about 1 MB or less over each run, with no growth.

Raw results are in `bench/results/`. The earlier battery runs were dropped because Chrome was capping them at 30 FPS.
