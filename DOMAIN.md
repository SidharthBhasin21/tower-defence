# Domain and scope

This file defines what the app is, which rules belong to the game, and where the work stops. Any agent or contributor working on the project must stay inside it. For technical decisions see [ARCHITECTURE.md](ARCHITECTURE.md); for hard engineering rules see [CLAUDE.md](CLAUDE.md).

If a task seems to need something outside this file, **stop and ask the user**. Don't widen the scope on your own.

---

## 1. What the app is

A **single-player tower defense game for desktop browsers**. It's a static web page that runs entirely on the player's machine with no server.

The player defends a base from **50 waves** of enemies. Enemies walk fixed paths toward the base, and the player places, upgrades and sells towers that fire automatically. The game should feel like a finished, polished game, not a tech demo. It must also meet strict performance targets under a stress load of 5,000 enemies, 100 towers and 1,000 projectiles.

---

## 2. Game rules

The game is defined by the rules below. Numbers marked *(tuned)* are starting values that balance testing may change. If one changes, update `config.ts` and this file in the same change.

### 2.1 The map

- **Size:** a fixed map of **40 × 24 tiles at 32 px each** (1280 × 768 world pixels). There's one map.
- **Tile kinds:**
  - Buildable ground.
  - Path, which can't be built on.
  - Scenery such as rocks, trees and water, which can't be built on either.
  - The base.
- **Three spawn portals:**
  - Two ground paths that merge before the base.
  - One air route, used only by flying enemies.
- **The base** sits at the end of every path.

### 2.2 Player resources

| Resource | Rule |
|---|---|
| **Lives** | Start at 20 *(tuned)*. An enemy reaching the base costs its leak damage. Reaching 0 ends the game. |
| **Gold** | Start at 200 *(tuned)*. Earned from kills, wave-clear bonuses and calling waves early. Spent on building and upgrading. |
| **Score** | Kill points (scaled by wave), plus wave-clear bonuses, early-call bonuses, and a bonus for lives left at the win. Best score is saved on the device. |

### 2.3 Towers (5 types, 4 levels each)

| Tower | Role | Hits air? | What makes it different |
|---|---|---|---|
| **Bolt** | Cheap fast single-target | Yes | High fire rate, low damage per shot, weak against armor |
| **Cannon** | Area damage | **No** | Slow shells that explode on landing; splash damage |
| **Frost** | Control | Yes | Pulses slow every enemy in range; low damage |
| **Arc** | Chain lightning | **No** | Hits instantly and jumps to several nearby enemies; armor counts for half |
| **Sniper** | Long-range burst | Yes | Very long range, huge hits, **ignores armor**, slow to reload |

- **Placement:** one tower per buildable tile, and only if the player can afford it.
- **Upgrades:** each tower goes from level 1 to 4 with three upgrades, and each costs more than the last. Upgrades raise damage, range and fire rate.
- **Selling:** refunds **70%** *(tuned)* of all the gold put into that tower.
- **Targeting modes**, switchable per tower:
  - **First:** the enemy closest to the base.
  - **Last.**
  - **Strongest:** the most current health.
  - **Closest:** the nearest to the tower.
- **Firing:** towers aim and fire on their own. The player never aims.

### 2.4 Enemies (7 types)

| Enemy | Movement | Trait | Leak damage |
|---|---|---|---|
| **Grunt** | Ground | Baseline | 1 |
| **Runner** | Ground | Fast, fragile | 1 |
| **Brute** | Ground | Slow, lots of health, **heavy armor** | 3 |
| **Swarmling** | Ground | Tiny and weak, arrives in large packs | 1 |
| **Mender** | Ground | Regularly **heals** nearby enemies | 2 |
| **Wisp** | **Air** | Takes the air route; Cannon and Arc can't hit it | 2 |
| **Warlord** | Ground | Boss on waves 10, 20, 30, 40 and 50; huge health; **splits into Runners** when killed | 10 *(tuned)* |

**Damage rules:**
- **Armor** takes a flat amount off every hit, but a hit always does at least 20% of its damage.
- **Slows** don't stack. The strongest active slow wins.

### 2.5 Waves and difficulty

- **50 waves.** Clearing wave 50 wins the game.
- **New enemy types arrive gradually:**
  - Grunts on wave 1.
  - Runners from about wave 3.
  - Swarmlings from about 5.
  - Brutes from about 7.
  - Wisps from about 9.
  - The first Warlord on 10.
  - Menders from about 12.
  - After that, waves mix enemy types.
- **Difficulty never decreases from one wave to the next.** Enemy health and counts rise along set curves, and later waves combine threats so the player has to build a mix of towers. Difficulty is measured as total threat, so boss waves are spikes that the following waves never fall below. See [ARCHITECTURE.md §4.5](ARCHITECTURE.md).
- **Wave timing:**
  - Wave 1 starts when the player presses **Next wave**.
  - After a wave finishes spawning, a countdown to the next one begins.
  - Calling the next wave early pays bonus gold, so waves can overlap.
- **The preview** of the next wave lists what's coming.

### 2.6 Game states

```
Title ──play──▶ Playing ◀──resume── Paused
                  │  ▲                ▲
                  │  └────pause───────┘
                  ├──lives = 0────────▶ Game over ──restart──▶ Playing
                  └──wave 50 cleared──▶ Victory   ──restart──▶ Playing
```

- **Restart** can be used from any state. It asks for confirmation while a game is in progress.
- **Game speed** can be **1×, 2× or 4×**, and pausing is separate from speed.

### 2.7 Stress mode

- **What it is:** a separate test scenario, opened with `?stress` or from the title screen. It isn't part of the campaign.
- **What it does:** it holds 5,000 enemies, 100 towers and at least 1,000 projectiles alive at once, with unlimited lives, and shows live performance stats.
- **Playability:** the game stays fully interactive the whole time.

---

## 3. In scope

- Everything in §2.
- **Feedback and polish:**
  - Placement preview (valid or invalid) and range circles.
  - Hit flashes, death particles, explosions and lightning beams.
  - Floating gold numbers, toasts for waves and bosses, health bars.
  - Smooth animation and a clear, readable HUD.
- **Sound:** sound effects synthesized in code, with a mute button.
- **Controls:** keyboard shortcuts, and panning and zooming the camera.
- **Saved data:** the high score and mute/speed settings, stored in `localStorage`.
- **Performance tools:** the perf overlay, the stress and benchmark modes, the benchmark script and its results.
- **Testing:** unit and simulation tests, plus a scripted bot used for balance testing.
- **Docs:** README.md, ARCHITECTURE.md and DOMAIN.md, kept up to date.

## 4. Out of scope (don't build these)

- **Online features:** backends, servers, APIs, accounts, logins, leaderboards, multiplayer, cloud saves.
- **Data leaving the machine:** analytics, telemetry, ads, payments, any network request at runtime.
- **External assets:** CDNs, web fonts, remote images, audio or music files. All art and sound are made in code.
- **More content:** more maps, a level editor, procedural maps, a campaign or story, unlockables, achievements, a tower tech tree beyond the 4 levels, hero units, spells or abilities. That's unless the user asks for it.
- **Save and load** of a game in progress.
- **Other platforms:** native or mobile app builds, PWA or offline installers, Electron. Touch only needs to work for basic taps.
- **Localization or translation.**
- **Imitating existing games:** no copying of an existing game's name, characters, art, maps or sound.
- **Server-side rendering, game frameworks, or rewriting the rendering approach.** See [ARCHITECTURE.md §1.5](ARCHITECTURE.md).

## 5. Rules for agents

1. **Stay in this folder.** Only edit files inside this project. Don't touch global config, other repositories or system settings.
2. **Ask first before:**
   - Adding, removing or upgrading a dependency. The approved list is in [ARCHITECTURE.md §1](ARCHITECTURE.md).
   - Changing [CLAUDE.md](CLAUDE.md), the game rules in §2, or the performance targets.
   - Deleting files you didn't create in this task.
   - Committing, pushing, or anything else that leaves the machine.
3. **Do only what the task asks.** If the user asks you to look, review or explain, don't edit. Name follow-up ideas instead of building them.
4. **Keep the docs in sync.** A change to architecture, rules or performance updates the matching doc (README, ARCHITECTURE or DOMAIN) in the same change.
5. **Back performance claims with measurements.** Never report numbers that weren't measured, and record the machine, browser and mode they came from.
6. **Keep the engine rules from [CLAUDE.md](CLAUDE.md):** one game loop, a fixed-step simulation, no allocation in the game loop, grid-based queries, and culling. If a change would break one, stop and ask instead of working around it.

## 6. Done means

| Requirement | How it's checked |
|---|---|
| Playable start to finish, offline | The bot clears all 50 waves in a test; manual playthrough of the build with the network off |
| 50 waves, harder over time | Wave tests (count, difficulty never decreasing) |
| ≥ 3 tower types and ≥ 4 enemy types that play differently | §2.3 and §2.4 are implemented, and the balance test shows a single-tower strategy fails |
| Placement, upgrade, sell, lives, gold, score, victory, game over | Sim tests and manual check |
| Pause, restart, speed control | Manual check, plus the determinism test for speed |
| Stress: 5,000 / 100 / 1,000 at p95 ≥ 45 FPS, < 5% of frames over 33 ms, still interactive | `npm run bench` results, recorded in the README |
| Memory flat over a full run | Heap samples from `?bot&speed=4&bench=full` (`npm run bench -- --full`), recorded in the README |
| Same behaviour on any refresh rate | Determinism test |
| README covers architecture, rendering, bottlenecks, optimizations, measurement | README review |
