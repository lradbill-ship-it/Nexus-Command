# CLAUDE.md — Project Stratadug

> ⚡ **Session 4+ START HERE:** read **`docs/SESSION_4_HANDOFF.md`** first (then `docs/TODO.md`, the living backlog).
> It has the current state, the deploy process + gotchas, the full system inventory, the tuning knobs, and — important —
> **the workflow rule: at session start and after every task, present Lane the entire TODO as multiple‑choice
> cards (`AskUserQuestion`) and let him pick what's next.** Older per‑feature detail is in
> `docs/SESSION_3_HANDOFF.md` / `docs/SESSION_2_HANDOFF.md`; the notes below are the original v1 mission/spec.

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

## v4 Phase 5 — Objectives: Command Relays & Victory Points (IMPLEMENTED, branch `feature/v4-phase5-objectives`)

Final v4 phase — Lane's "missions" + decisive hour-length ending (DESIGN_SPEC_v4 §5). Emergent objectives (scripted
campaign deferred as a separate game mode — random-skirmish engine favours emergent).

- **Command Relays** (`Relay` type, `game.relays`): 4 strategic points (centre + 3 frontiers, `RELAY_SITES`),
  captured by presence (`relayTick`, ~7s, like settlements). A held relay accrues **Victory Points**
  (`VP_PER_RELAY`) + a crystal trickle (`RELAY_INCOME`) to its owner; grants vision.
- **VP victory** (`checkEnd` + `allianceVP`): first faction/alliance to `VP_TARGET` (2800) wins outright,
  alongside annihilation. Tuned so it rewards *sustained* map dominance (≈late-game), not an early grab.
- **AI contests relays**: the wave logic now sends ~45% of squads to capture the nearest un-owned relay.
- **Render/HUD**: pulsing owner-coloured relay beacons + capture rings (`drawSettlements`), minimap markers,
  topbar `★ RELAYS you/2800 · leader` readout. Intro mentions the VP win path.
- Verified headlessly: 4 neutral relays; presence-capture works; VP accrues; reaching target fires a VP win;
  AI fights over relays (in a passive-player sim Eastern Bloc held 2 and raced ahead). `tsc + vite` clean.
- **v4 SPEC FULLY BUILT** (Phases 1–5). Remaining = balance/playtest tuning + (optional) scripted campaign mode.

## v4 Phase 4b — Elections & coups (IMPLEMENTED, branch `feature/v4-phase4b-elections`)

Completes Phase 4 (government). Lane: elections/coups "balanced" — real player levers, uncertain outcomes.

- State: `game.platform` (doctrine you run on) / `electionT` / `campaign` / `coupT` per faction.
- **`governmentTick`**: each faction holds periodic elections (`resolveElection`) — approval = happiness +
  campaign + 6; a roll under approval keeps your **platform** doctrine, else the **opposition** doctrine is
  imposed (−happy). Sustained misery (`happy<22`) accrues `coupT`; a high enough timer triggers `triggerCoup`
  (forced random doctrine + brief happiness bump + snap election).
- **Player levers**: `setPlatform` (run on any of the 5 doctrines), `campaignRally` (220cr → +approval),
  `launchCoup` (needs Cyber Ops Center, 600cr, vs `covTarget`; success scales with target's unhappiness).
- **UI**: GOVERNMENT panel in OPS tab — next-election countdown, approval bar, platform picker, CAMPAIGN &
  INCITE-COUP buttons.
- Verified headlessly: miserable faction lost doctrine 13/14 elections, happy kept mandate 10/10; campaign
  raises approval; coup-by-misery & player-coup both flip doctrines. `tsc + vite` clean.
- **VERIFY NOTE**: after editing source, **restart the preview server** (don't just reload) before
  dynamic-import headless tests — Vite HMR `?t=` queries split the module graph (state vs sim/mapgen see
  different `game`), which shows up as empty nodes/buildings after `resetState`.
- **Next: Phase 5** — missions (emergent + scripted) + hour-length pacing (DESIGN_SPEC_v4 §5).

## v4 Phase 4a — Leader doctrines (IMPLEMENTED, branch `feature/v4-phase4a-leaders`)

Lane's item 9 (government), first slice — DESIGN_SPEC_v4 §4. 5 leader styles, chosen at game start.

- `LeaderStyle` + `STYLES` table (constants): **Militarist** (+combat −econ), **Industrialist** (+labor),
  **Populist** (+happy, cheap mobilise), **Technocrat** (−alloy cost, faster cyber), **Mercantile** (+income/trade).
  `game.leader` per faction; AI styles via `PERSONA_STYLE[persona]`.
- `styleMod(team)` applied across sim: combat (`fireAt`), crystal income (harvest deliver), `laborFactor`,
  `happyTarget`, alloy cost (`alloyCost()` in train/place/AI), conscript & settlement-recruit cost, trade flow
  (`stepWorld`), ability cooldowns (`castAbility`). `setLeader` / `getChosenLeader`.
- **Game-start picker**: intro overlay leader-doctrine chooser (5 cards); choice persists across restarts
  (`main.ts` re-applies on start/restart). LEADER readout in the SOCIETY panel.
- Verified headlessly: each style measurably shifts outcomes (militarist 13.2 vs mercantile 10.4 dmg;
  technocrat walker-alloy 204 vs 300; populist conscript 8 vs 15 pop & happy +14; industrialist labor 1.16). clean build.
- **Next: Phase 4b** — elections & coups (the dynamic politics that swing the style mid-match).

## v4 Phase 3b — Neutral settlements (IMPLEMENTED, branch `feature/v4-phase3b-settlements`)

Lane's item 7 (recruit / persuade / intimidate map population) — DESIGN_SPEC_v4 §3.2. Completes Phase 3.

- **Model**: `Settlement {x,y,pop,owner,capBy,capT,seed}` + `game.settlements`; `mapgen` scatters 7 neutral
  villages between bases. Each holds a civilian `pop` that joins whoever takes it.
- **`settlementTick`**: a settlement flips to the single uncontested faction with units within `SETTLE_R`
  (~6s presence); contested presence stalls it; empty cools it off. Capture grants `pop` to the owner.
  Troops-only takeover = **intimidate** (−6 happy, resentful); a paid claim = **recruit/persuade** (+6 happy).
- **`tryRecruit`** (player): right-click a settlement with a unit nearby + 160 crystals → instant peaceful claim.
  Right-click without funds/range falls through to a normal move (→ presence capture).
- Owned settlements grant vision (`computeVision`). Render: hut cluster + owner-colour flag + capture-progress
  ring (`BattleScene.drawSettlements`, depth −40), minimap markers.
- Verified headlessly: 7 neutral settlements; intimidate flips owner (+14 pop, −happy); paid recruit flips
  owner (+13 pop, −160 crystals, +happy). `tsc + vite` clean.
- **Note**: marching troops past a settlement intimidates it (−happy) — intentional occupation cost.
- **Next: Phase 4** — government / leaders / elections / coups (DESIGN_SPEC_v4 §4).

## v4 Phase 3a — Civilian population & society (IMPLEMENTED, branch `feature/v4-phase3a-population`)

Lane's item 10 (in-faction population) — DESIGN_SPEC_v4 §3. Population is FLAVOUR/ECONOMY + leverage, **never a win-con**.

- **State**: `game.pop` / `game.happy` (0..100) / `game.conscriptPenalty` per faction. Two new buildings:
  **Habitat Block** (`house:45`) and **Civic Market** (`civic:16` happiness). HQ seeds housing/civics.
- **`societyTick`** (sim): happiness drifts toward `happyTarget(team)` = f(housing headroom, prosperity, civics,
  war stress, recent conscription). Population grows toward `housingCap` when content; emigrates when overcrowded;
  flees under unrest.
- **Leverage**: `laborFactor(team)` (0.7 miserable … 1.2 utopia) multiplies harvest rate + build/queue speed —
  a thriving society out-produces a miserable one (low happiness = a *strike*). Applied in `updateHarvester`,
  `updateBuilding` (progress + foundry queueT).
- **Conscription**: `conscript(team)` turns 15 pop → a Rifle Trooper instantly (happiness cost). Player via
  `⤒ CONSCRIPT` button (SOCIETY panel) or `C` key; AI conscripts from surplus pop when short on crystals.
- **Revolt**: sustained misery (`happy<18`, scaled) makes army units desert (recoverable, never an instant loss).
- **UI**: SOCIETY panel in Base pane — POP n/cap, happiness bar (red→green), mood text, conscript button.
- Verified headlessly: pop grows to cap, labor 1.17 (happy) vs 0.7 (miserable), conscription works, desertion
  fires under collapse (army 13→6). `tsc + vite` clean.
- **Next: Phase 3b** — neutral map settlements (recruit/persuade/intimidate, item 7), then Phase 4 (government).

## v4 Phase 2b — 6 factions + larger map + scarier aircraft (IMPLEMENTED, branch `feature/v4-phase2b-factions`)

Lane round-2 answer #1 (6 factions, world regions) + larger maps + scarier aircraft (D₁).

- **6 regional coalitions** (`FAC`): American Federation (player/balanced), European Concord (merchant),
  Pan-African Union (industrial), Gulf Coalition (merchant), Eastern Bloc (warlord), Oceanic League (covert).
  Dignified coalition names; AI persona = gameplay archetype, NOT ethnic stereotype. New `industrial` persona
  (builder: +economy, wired into diplomacyTick/dipAlly/aiUpdate). `AIS`/`ALL_TEAMS` now 6; all `[1,2,3,4]`
  literals → `ALL_TEAMS`. 15 pairwise starting relations in `state.ts`.
- **Larger map**: `MAPW/MAPH` 84→112; 6 perimeter `BASE_INFO` anchors; `NODE_SITES` (0-5 per base, 6 centre,
  7-10 frontier); `HOME_RES` spreads 3 resources across 6 factions (2 each). mapgen places **crystal at every
  base** (currency stays viable) + rich home secondary + scarce off-secondaries.
- **Scarier aircraft**: dmg 14→24, hp 175→240, +splash 26, costlier (760 + 300 alloy).
- **PERF (important)**: the bigger map + 6 factions field hundreds of units; the old O(n²) `separation` &
  `nearestHostile` spiked frame time. Added a **uniform spatial grid** (`GCELL=64`, `rebuildUnitGrid`/
  `forNearbyUnits`) + **throttled target acquisition** (`Unit.acqT`, ~4×/s not per-frame). Headless: ~3.2 ms/step
  at 171 units (natural economy), game resolves with eliminations. Watch big late-game battles; may want unit caps.
- Intro overlay updated to 6 factions + 3 resources. Sidebar diplomacy/covert auto-scale via `AIS`.
- **Next: Phase 3** — population & society (DESIGN_SPEC_v4 §3).

## v4 Phase 2a — Alloy, the 3rd harvested resource (IMPLEMENTED, branch `feature/v4-phase2-alloy`)

Lane round-2 answer #2 ("3 resources, all harvested"). Mirrors the coolant pipeline.

- **Alloy** = 3rd `ResourceKind`; `game.alloy` stockpile (uncapped, like money). New **Alloy Hauler** unit
  (`harvests:'alloy'`) → **Alloy Smelter** depot (`accepts:'alloy'`, `freeUnit:'hauler'`).
- **Purpose:** secondary **build-cost** on advanced units (walker 300, artillery 350, aircraft 250) and
  buildings (flak 150, cyber 300) — `UnitDef.alloy`/`BuildingDef.alloy`. Gated + spent in `trainUnit`,
  `startPlacing`/`tryPlace`, and AI (script-build + unit-pick; alloy-starved AI falls back to basic `strike`).
- **Map:** alloy is **no faction's home** — scarce starter near each base, rich at centre + 2 frontier sites →
  always contested. Trade pacts flow alloy too (+5/s/partner). Regen can spawn any of the 3 kinds.
- Art/UI: alloy ore sprite, hauler + smelter art, sidebar buttons/icons, `⬡ ALLOY` HUD meter, alloy cost
  labels (`⬡N`), kind-tinted nodes/minimap/cargo (alloy = `#e0a155`). AI keeps haulers when it has a Smelter.
- Verified headlessly: 3 kinds spawn, alloy gating blocks/permits + spends correctly, haulers harvest,
  advanced units become a deliberate investment. `tsc + vite` clean.
- **Next: Phase 2b** — 6 regional factions + larger map + scarier aircraft (spec §6; roster proposed, awaiting a glance).

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
