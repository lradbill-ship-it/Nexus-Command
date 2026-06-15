# CLAUDE.md — Project Stratadug

You are picking up an in-progress game project. Read this file, then `docs/DESIGN_SPEC.md`, then skim `playable/nexus-command-v2.html` (the current best playable build) before writing any code.

## Mission

Build **NEXUS COMMAND**: a real-time strategy game in the spirit of Command & Conquer (Red Alert Remastered is the visual benchmark — see DESIGN_SPEC) with a modern drones-and-cyber-warfare twist. The owner (Lane) plays on a Mac. Target quality: "as visually appealing as anything on a modern top-level graphics card/console" — interpret as: the best achievable with a real engine, real assets, WebGL rendering, and polished UX. The previous attempts were single-file hand-drawn `<canvas>` builds; they hit a quality ceiling. Your job is the real version.

## Hard requirements (owner's words, all six)

1. **Restart button** — in-game, regenerates a fresh battlefield without reloading hassle.
2. **No edge-scrolling drift** — the camera must NEVER move just because the cursor approaches a screen edge (it caused the map to shift when reaching for the sidebar). Pan via WASD/arrows, middle-mouse drag, and minimap click only. (Optional: edge-scroll as an off-by-default setting.)
3. **Looks like real C&C** — rich natural terrain (grass, forests, rock ridges, rivers with bridges, ore/crystal fields), detailed sprite-quality buildings and vehicles, real explosions. Not neon geometric shapes.
4. **Randomly generated maps** every match (the procedural generator in `wip-v3/p1-core.html` works and is worth porting).
5. **Modern stereo sound** — positional/panned SFX, layered impacts, ambient bed. "PS5 level," not chiptune beeps. The WebAudio engine in `wip-v3/p1-core.html` (noise-buffer impacts + StereoPannerNode + compressor) is a working starting point; replace or augment with real recorded SFX assets if available.
6. **Top-level visually, logically, and UX-wise** — A* pathfinding (working implementation in `wip-v3/p2-systems.js`), responsive controls, control groups, polished C&C-style sidebar.

## Recommended stack (your call, but justify deviations)

- **Phaser 3** (or PixiJS v8) with WebGL — sprite-based rendering is exactly the C&C look. Vite for dev/build. Plain TypeScript preferred.
- **Assets**: use CC0/free asset packs rather than hand-drawn canvas art. Good sources: Kenney.nl (RTS/topdown packs), OpenGameArt (CC0 filters). Keep an `assets/CREDITS.md`.
- Output should run in a browser on a Mac via `npm run dev` / static build. An Electron/Tauri wrapper is optional, not required.
- Keep it a fully offline, local game — no server.

## Game systems to carry over (all already implemented and tuned in `playable/nexus-command-v2.html` — port the logic, not the rendering)

- **4 factions**: NEXUS (player, teal), HELIX COMBINE (warlord, red), AURUM SYNDICATE (merchant, gold), VANTA CELL (covert, violet). Distinct AI personalities — see DESIGN_SPEC for behavior tables.
- **Economy**: harvesters gather from crystal fields → refinery/HQ; power production/consumption with half-speed penalty when negative; building construction over time; per-foundry unit queues; rally points.
- **Diplomacy**: pairwise relations (−100..100); WAR below −30; alliances (need relation thresholds by persona: warlord 75 / merchant 40 / covert 55) grant shared vision and drag allies into your wars; trade pacts (+9/s each side); gifts (+12 rel for 300); AI↔AI wars and alliances happen autonomously; destroying things and attacking neutrals tanks relations.
- **Covert ops** (require Cyber Ops Center, faction-targeted): Steal Data, Sabotage, Recon Sweep, Incite War — costs/cooldowns/success odds in DESIGN_SPEC. Failure = detection = relations hit. VANTA runs covert ops against everyone, including the player.
- **Cyber abilities**: EMP Pulse (AoE disable 8s), System Hijack (permanently steal a unit).
- **Combat**: turret-aim smoothing, waves that scale with time, fog of war (player + allies' vision), win = every surviving faction is you or your ally; lose = all your buildings destroyed.
- **Slow build-up pacing**: first AI attack ~2.5–3.5 min, escalating size/frequency.

## v4 Phase 1 — Multi-resource economy (IMPLEMENTED, branch `feature/v4-phase1-economy`)

First slice of the v4 "Living World" plan (`docs/DESIGN_SPEC_v4.md`). Green-lit by Lane.

- **Typed resources** (`types.ts ResourceNode{kind:'crystal'|'coolant'}`): `CrystalNode` generalized;
  `game.nodes` carry a `kind`. Harvesting is resource-typed throughout (`resOf`, `nearestNodePathable`,
  `nearestDepot` filter by kind; deliver crystal→`money`, coolant→`water`).
- **Coolant is now HARVESTED** (was passively generated in v3.1): new **Coolant Tanker** unit
  (`U.tanker`, `harvests:'coolant'`) draws from **coolant wells** → **Coolant Refinery** (the old
  `pump`/Coolant Plant, now `accepts:'coolant'`, `freeUnit:'tanker'`, small trickle). Building-completion
  free-unit is generic via `BuildingDef.freeUnit`. HQ accepts all resources.
- **Resource-biased spawns** (`mapgen.ts` + `constants.HOME_RES`): each base RICH in its home resource,
  ~0 in the other; contested centre rich in both; frontier sites alternate → forces explore/conquer.
  Verified: corner mass 21,600 home / 0 off. `spawnCrystalField`→`spawnResourceField(kind,...)`.
- **All resources tradeable** (`stepWorld`): trade pacts now flow coolant (+6/s per partner) as well as crystals.
- Art/UI: coolant-well sprite + tanker art (`textures.ts`), kind-tinted node sprites/minimap/cargo bars,
  tanker sidebar button/icon, resource-typed cargo readout. AI maintains tankers when it has a Coolant Refinery.
- Verified headlessly: typed harvest both resources, exact spawn bias, tankers deliver, overheat tension
  per team, full combat roster still fabricates. `tsc + vite` clean.
- **Next: Phase 2** (larger maps + 6 factions + scarier aircraft) per spec §9.

## v3.1 — Lane wishlist Tranche A+B (IMPLEMENTED, branch `feature/lane-wishlist-a-b`)

Addresses 6 of Lane's 11 requests. The other 5 (society/government layer: recruitable
civilians, in-faction population w/ happiness, government/coups/elections; the 2nd-resource
*economy* depth; longer-game pacing tuning) are **deferred pending a design conversation** —
they reshape the game from C&C-skirmish to nation-builder. Do NOT build them without Lane sign-off.

- **Complex maps** (`mapgen.ts`): 2–3 meandering rivers, organic lakes (`blob`), ridge-noise rock
  spines, denser forest clumps, scattered boulders/dirt, jittered crystal-field centers, 2-tile border.
- **Crystal regeneration** (`sim.ts regenCrystals`): living fields slowly regrow; new formations
  crystallize at random passable sites on a 70–120s cadence, capped at 60 active fields. Shared
  `spawnCrystalField()` lives in `mapgen.ts`.
- **Secondary resource = coolant/water** (`sim.ts waterStep/waterOf`, `game.water/overheat`): Coolant
  Plant (`pump`) + HQ produce it; walkers, artillery, gunships, flak consume it. Dry + in-deficit ⇒
  OVERHEAT ⇒ those weapons fire at half rate. HUD meter `#uiWater` (cyan→red when hot).
- **New units** (`constants.ts U`): `infantry` (cheap massable), `rocket` (AA+anti-armor infantry),
  `artillery` (long-range splash, fragile, needs coolant), `aircraft` (flying VTOL gunship).
- **Flight layer**: `air` units skip A*/terrain (`setPath`/`stepToward`), render at altitude `ALT`
  with a ground shadow + spinning rotor, draw above ground entities. Engagement rules in `sim.ts`:
  `isAir`/`canHitAir`/`eligibleTarget` — only `antiAir` shooters hit fliers; `airOnly` flak hits only fliers.
- **Air defense** (`constants.ts B`): `aaturret` Flak Cannon (airOnly). Rocket Trooper = mobile AA.
- **Building detail + unit polish** (`textures.ts`): lit window strips, panel seams, rivets; richer
  unit cores w/ faction halo; new art for all new units/buildings; animated HQ radar dish + rotor discs
  (`buildSpinners`, wired in `BattleScene` SpriteRec.dish/rotor/shadow).
- AI fields a combined-arms force (late-game guarantee in `aiUpdate`) + builds pumps/flak (`AI_SCRIPT`).
- Verified by driving the headless sim via Vite dev modules (WebGL canvas can't screenshot in CI preview):
  build clean, crystal regen fires, overheat triggers, flak kills aircraft, full roster fabricates.

## What exists in `wip-v3/` (the interrupted canvas rewrite — mine it for logic)

- `p1-core.html`: complete HTML/CSS C&C-style metal sidebar skin, stereo WebAudio engine, value-noise **procedural map generator** (rivers, bridges, forests, rock, roads carved to guarantee base/resource connectivity, border walls, crystal field placement).
- `p2-systems.js`: complete painted-terrain pre-renderer, **A\* pathfinding** (8-dir, corner-safe, LOS smoothing, stuck detection/repath), all entity/economy/combat/AI/diplomacy systems updated for terrain blocking.
- Part 3 (pseudo-3D painters, input, render pipeline, boot) was lost to an interruption — do NOT try to resurrect the canvas approach; rebuild rendering properly in the engine you choose.

## Process expectations

- Work in small verifiable increments; keep the game runnable at every commit.
- Commit history that tells a story; `README.md` updated with run instructions.
- Playtest pacing: a full skirmish should feel like classic C&C — slow eco start, mid-game skirmishes over bridges/center crystals, late-game pushes.
- Ask Lane before changing faction design, diplomacy rules, or pacing targets.
