# NEXUS COMMAND — Session 2 Handoff

> Read order for a fresh session: **this file** → `CLAUDE.md` (mission + v1 systems) → `docs/DESIGN_SPEC.md` / `docs/DESIGN_SPEC_v4.md` (design) → skim `src/sim/sim.ts`.
> Written at the end of Session 1 (2026‑06‑17). Everything below is live on `main`.

---

## 0. One‑paragraph orientation

NEXUS COMMAND is a Command & Conquer–style real‑time strategy game: **TypeScript + Phaser 3 (WebGL) + Vite**, runs in a browser, no backend. 6 regional‑coalition factions, 3 harvested resources (crystal/coolant/alloy) + power, a civilian‑society layer (population/happiness/settlements), government (leaders/elections/coups), and Command Relays for map control. **Win/lose = annihilation only** (last alliance standing / lose all buildings). Session 1 moved the project to Lane's own GitHub, fixed a game‑ending bug, shipped ~15 features, and made it playable on mobile.

---

## 1. Where everything lives (IMPORTANT — moved this session)

| | |
|---|---|
| **Repo (origin)** | `https://github.com/lradbill-ship-it/Nexus-Command` — **Lane's** account |
| **Old repo** | `grodoctor-tech/Nexus-Command` — the friend's original; kept only as the `grodoctor` git remote (reference). Do **not** push there. |
| **Live game** | **https://lradbill-ship-it.github.io/Nexus-Command/** (GitHub Pages, `gh-pages` branch) |
| **Local clone** | `/Users/Lane-DDABBER/Claude/Nexus-Command` |
| **Default branch** | `main` (work directly here — see conventions) |

The friend (grodoctor) **does not review** Lane's updates — this is Lane's project now. Commit straight to `main`.

---

## 2. Run / build / deploy

```bash
npm install                 # first time
npm run dev                 # vite dev server on :5173
npm run build               # tsc --noEmit && vite build  → dist/        (type-check gate)
npm run build:single        # tsc --noEmit && vite build --mode single → dist-single/index.html (everything inlined, the deploy artifact)
```

**Deploy = manual** (no CI). Build the single file and push it to `gh-pages`:

```bash
cd /Users/Lane-DDABBER/Claude/Nexus-Command
npm run build:single
WT=/tmp/nexus-ghpages
git fetch origin gh-pages
git worktree remove "$WT" --force 2>/dev/null; rm -rf "$WT"
git worktree add -B gh-pages "$WT" origin/gh-pages
cp dist-single/index.html "$WT/index.html"
git -C "$WT" add index.html
git -C "$WT" commit -m "Deploy: <what changed>"
git -C "$WT" push origin gh-pages          # live in ~30–60s
git worktree remove "$WT" --force
```

Standard per‑feature loop used in Session 1: edit → `npm run build:single` (verifies tsc) → commit to `main` → push → deploy as above.

**⚠️ VERIFY THE ACTUAL SINGLE‑FILE ARTIFACT BEFORE DEPLOY (learned Session 2):** the Vite **dev server** (HMR, split module graph) is NOT the same as the bundled `dist-single/index.html`. Test the real artifact: a `nexus-dist` entry in `launch.json` serves `dist-single/` on **:4173** (`python3 -m http.server 4173 --directory .../dist-single`) — `preview_start nexus-dist`, then check `preview_console_logs` (errors) + a screenshot (intro overlay renders) before pushing to gh‑pages. This caught nothing broken but closed the gap (we'd only been testing dev).

**⚠️ GitHub Pages propagation lag:** after pushing `gh-pages`, the live CDN serves the **old** file for ~1–2 min, then flips. A reported "live link isn't working" right after a deploy is almost always this stale window (confirm by polling `curl -s -o /dev/null -w '%{size_download}' <url>?cb=$RANDOM` until the byte size matches the new build). Tell Lane to hard‑refresh.

**Local verification preview:** there's a `nexus-dev` entry in `/Users/Lane-DDABBER/Claude/.claude/launch.json` (runs `npm run dev`, port 5173). ⚠️ See §7 — the headless preview can't run the game loop.

---

## 3. Conventions & decisions (don't relitigate)

- **Stay on Phaser 3.** Engine swaps were considered and rejected: the "can't verify headlessly" limit is the *preview sandbox*, not Phaser. Graphics ceiling = **assets** (use CC0 packs + Phaser shaders/particles); perf ceiling = **optimization** (culling done, unit caps, move sim to a Web Worker). Only reconsider for 3D (→ Godot).
- **Commit straight to `main`** + deploy. No PRs needed (no reviewer). (Session 1's PRs #11–#15 were on the old repo before the move.)
- **Verify with `tsc`/build + Lane's playtest.** WebGL + real‑time sim can't be observed in the headless preview (§7). Don't claim sim/visual behavior "works" from headless alone — say it's compile‑verified and ask Lane to confirm.
- **Keep `main` and the live `gh-pages` in sync** — deploy after meaningful changes.

---

## 4. What shipped in Session 1 (changelog, newest first)

All on `main` (`9500d41`) and deployed. Commits `736503a`→`9500d41`.

**Core bug fix**
- **Removed the Victory‑Point win condition entirely** — an enemy hitting the VP target ended the match as a *player loss while your base stood*, and the end screen lied ("your base was destroyed"). Now annihilation is the only win/lose. (This was the original "crashes and says I lost" report.) Relays kept as income+vision.

**QoL**
- Sell/delete structures (select → ✖ SELL or Delete/Backspace → 50% refund).
- Right‑click‑to‑cancel queued production (refund).
- Battlefield‑feed log moved out of the scrolling tab pane → always‑visible sidebar strip.
- Unit‑death SFX retuned (was a flat "fart"; now a crack+thump).

**Units / combat**
- **Stuck‑units fix** (twice): unified stuck detection + escalating dislodge that hops toward the goal; **Recon Drone made airborne** (`air:true`) so scouts/auto‑scout fly over terrain.
- **Scouts‑only auto‑explore** toggle (idle Recon Drones reveal the map).
- **Grid formations** for group moves (face the destination, nearest‑slot assigned).
- **Guard/escort order** — right‑click/tap a friendly unit (e.g. a harvester) with military selected → they follow + auto‑engage threats near it (leashed). `Unit.guard`.
- **Ballistic Missile (nuke) superweapon** — ability `N`, Cyber‑Ops‑gated, 4s flight → big AoE blast. `pendingStrikes`/`detonateNuke`.
- **Harrier Jet** (cheap fast air, 420/120) added; **Wraith Gunship** repriced 760→600.

**Map / world**
- **3× larger maps** (`MAP_SCALE=3` → 336²; anchor tables scaled) + **viewport culling** + bigger A* budget (8000→30000).
- Neutral **settlements**: more of them (7→14), bigger, owner‑coloured rings, **and economically active** (owned settlement pays per‑pop crystal income, `SETTLE_INCOME`).
- **Command Relays — "shoot‑it" capture:** neutral relays taken by presence; an **owned** relay must be **shot offline** (non‑owner military present + undefended drains its `hp`; at 0 → neutral → re‑take). Shelling a non‑enemy's relay → relations fall → war (the "attack a friend" decision). `Relay.hp/hpMax`, `RELAY_HP=600`.

**Mobile (the game now plays on a phone)**
- Touch controls: tap = select / (with a selection) command; one‑finger drag = pan; two‑finger pinch = zoom; minimap tap = jump.
- Mobile viewport (`user-scalable=no`, `touch-action:none`) + responsive `@media(max-width:760px)` (sidebar 168px, compact UI).
- Mobile layout fixes: **sticky DEPLOY** button, full‑screen intro overlay on phones, shrunk minimap so the feed isn't clipped.

---

## 5. Architecture map (key files)

The sim is engine‑independent and **never touches the DOM/renderer** — it talks to the UI/renderer through hooks (`setLogHook`, `setHintHook`, `setScorchHook`, `setEndHook`).

- **`src/sim/sim.ts`** (~1300 lines) — the whole simulation. Notable: `stepWorld(dt)` (per‑frame), `updateUnit` (order state machine: idle/move/amove/attack/**guard**, + repair behavior to come), `followPath`/`stepToward`/`setPath` (movement + **stuck/dislodge** logic), `updateHarvester`, `settlementTick`, `relayTick` (**shoot‑it** capture), `governmentTick`, `castAbility`/`tryAbility` (EMP/Hijack/**Nuke**), `issueOrder` (player commands incl. **formations** + **guard** + attack), `nearestHostile`/`fireAt`/`damage`/`destroy`, spatial grid (`rebuildUnitGrid`/`forNearbyUnits`).
- **`src/sim/constants.ts`** — `U` (units), `B` (buildings), `ABILITIES`, `COVERT`, `STYLES`/leaders, `FAC` (factions), `MAP_SCALE`/`MAPW`/`MAPH`, `BASE_INFO`/`NODE_SITES`/`RELAY_SITES` (×`MAP_SCALE`), `RELAY_INCOME`/`RELAY_HP`, terrain consts + `PASSABLE`.
- **`src/sim/state.ts`** — `GameState`, `createGame()`, `resetState()`, diplomacy helpers (`isWar`/`isAllied`/`addRel`), UI hooks.
- **`src/sim/types.ts`** — `Unit`, `Building`, `Relay`, `Settlement`, `GameState`, etc.
- **`src/sim/mapgen.ts`** — procedural map; places bases, resource fields, settlements, relays. `generateMap()`.
- **`src/sim/pathfind.ts`** — A* (`findPath`, pop budget 30000), `passable`/`tPassable`, `nearestPassableTile`.
- **`src/scene/BattleScene.ts`** — Phaser scene: render (sprite sync w/ **viewport culling**), **input** (`setupPointer` mouse + touch, `setupKeys`), minimap, `drawSettlements` (settlements + relays + the relay damage ring), `newMatch`, the `update(dt)` loop calling `stepWorld`.
- **`src/render/textures.ts`** — procedural sprites. `unitCanvas(type,team)` (per‑type else‑if; **unknown type → just a faction dot**), `barrelCanvas`, building textures, `buildAllTextures`.
- **`src/render/terrain.ts`** — terrain pre‑render + scorch.
- **`src/ui/sidebar.ts`** — all DOM UI: `makeUI` (build/fabricate/ability buttons from `buildOrder`/`unitOrder`/`ABILITIES`, `iconCanvas`), `refresh` (periodic sync, 130ms), `refreshSel`, `showEnd`, leader picker, diplomacy panel.
- **`src/audio.ts`** — WebAudio SFX (`sfx(type,x)`), positional.
- **`src/main.ts`** — boot, Phaser game, wires hooks, start/restart.
- **`index.html`** — single HTML: all CSS (incl. mobile `@media`), the topbar + C&C sidebar markup, intro/end overlays.

### How to add a new UNIT (pattern)
1. `U` entry in `constants.ts` (set `air:true` for fliers, `harvests:'...'` for harvesters, `dmg/range/rof` for combat).
2. Draw it: add an `else if (type === '...')` branch in `unitCanvas` (`textures.ts`).
3. Add to `unitOrder` + an `iconCanvas` branch in `sidebar.ts` (build‑menu button + icon).
4. (Optional) AI usage, behavior in `updateUnit`.

### How to add a new RESOURCE (for wood, see §6)
`ResourceKind` in `types.ts`; `game.<res>` in `createGame`; harvest pipeline in `updateHarvester` (`nearestNodePathable`/`nearestDepot` are resource‑typed); a HUD readout in `sidebar.ts`; spawn fields in `mapgen.ts`.

---

## 6. Pending work (start here in Session 2)

**✅ DONE in Session 2 (commit `97b311a`, on `main` + live) — the wood logistics loop:**

1. ✅ **Repair Rigs** — `U.repair` (`repair:true`, no weapon). Heals friendly **units AND buildings**, burning wood. Reuses the **guard order** (right‑click a friendly with a rig selected → escort + heal it) and **auto‑seeks the nearest wounded friendly when idle** (`nearestDamagedFriendly`, seek radius `REPAIR_SEEK` 360px). `updateRepair`/`healEntity` in sim. Tuning: `REPAIR_RATE` 34 hp/s, `WOOD_PER_HP` 0.05, `REPAIR_RANGE` 42px.
2. ✅ **Wood / tree‑clearing** — `U.logger` (`logs:true`, cargo 150) fells & **clears forest tiles** (`T_FOREST` → passable grass, which **opens new routes**) for the new **WOOD** resource. Delivers to a new **Lumber Mill** (`B.mill`, `accepts:'wood'`, free Logger on build) or the HQ. `updateLogger`/`nearestForest`/`clearForest` in sim; renderer surgically repaints cleared tiles (`clearForestAt` in `terrain.ts`, wired via `setClearForestHook`) + re‑bakes surviving neighbour trees. Tuning: `CHOP_TIME` 2.6s/tile, `WOOD_PER_TILE` 50. **The loop:** clear forests → wood → field repairs (the novel use Lane wanted).
3. ✅ **`isSupport(type)`** unifies the non‑combat checks (harvester/logger/repair): no desertion in a revolt, count as civilians at settlements, never take attack orders. WOOD topbar readout (`🪵`, `#9ec24f`) + green logger cargo bar.
   - **⚠️ Compile‑verified only — needs Lane's playtest** (per §7 the headless preview can't run the sim/render). Confirm: loggers find & fell forest and the cleared tile turns to passable grass on screen; wood accrues; Repair Rigs follow (guard) + heal and burn wood; idle rigs seek the wounded; the WOOD/cargo HUD reads right.
   - **AI is unchanged** — wood/repair is **player‑only** for now. A follow‑up could give the AI loggers/repair for parity (would need mill in `AI_SCRIPT` + logger/repair picks in `aiUpdate`).

   **Refinements (commit `944ea8a`, main + live):**
   - **Repair Rig auto‑search is map‑wide & continuous** — an idle rig scans the WHOLE map for any wounded friendly **unit OR building** (`nearestDamagedFriendly(u, Infinity)`, nearest‑wins) and goes to mend it. Build one and it keeps the whole army + base patched without micro.
   - **Harvester tunnelling** (harvesters ONLY) — a new `phasing()` movement mode (shared with fliers). When a harvester's pathing stalls (`followPath` stuck trigger) **or** a crystal field has no surface route at all (`nearestNodeAny` fallback), it **burrows straight through terrain** to its target and surfaces on arrival. While underground it's **untargetable** (skipped in `nearestHostile`), doesn't separate, and renders faded (alpha 0.3) with spoil dust. Fixes stuck harvesters & lets them mine walled‑off fields. `Unit.tunnelT`.

   **Subterranean Borer super‑unit (commit `f34caa7`, main + live):**
   - **Deep Bore Facility** (`B.drillbay`, 1200cr + 300 alloy) — the **hallmark** that gates it. **Subterranean Borer** (`U.borer`, **1500cr + 450 alloy**, hp 520, dmg 60 rail+splash) — `tunneler:true` makes it **phase through ANY terrain** always, and it's the **only** unit that can strike **underground** units (burrowing harvesters / other tunnelers) via the `canHitUnderground` exception in `nearestHostile`. It IS targetable itself (balance: the AI can shoot it).
   - Generic prereq system: `UnitDef.requires` + `hasBuilding()` — `trainUnit` refuses and the sidebar button disables until the prereq building is up. Reusable for future gated units.
   - **Player‑only** (AI doesn't build the facility or the Borer), like wood/repair.
   - **Also:** the Logger's tree‑felling SFX was removed (Lane) — `clearForest` is silent.
   - ⚠️ Compile‑verified only — playtest the burrow movement, the underground‑hunt, the gate, and confirm felling is now silent.

   **Underground‑targeting fix + water‑harvesting (commit `a77c6fc`, main + live):**
   - **Bug fixed:** non‑Borers could still hit burrowing/underground units (helicopters, turrets, splash). Now only a `tunneler` keeps an underground target — units & turrets **drop** a target that dives, and surface **splash** is shielded from buried units via `Shot.subsurface` (set when a tunneler fires). Acquisition was already gated.
   - **Coolant from water (Lane):** **Water Tower** (`B.watertower`, 450cr) unlocks **Coolant Tankers drawing coolant straight from rivers & lakes**. Each water tile holds coolant in `game.waterAmt` (Float32Array, 700/tile, set in `mapgen`); tankers drain it (mirrors the Logger's tile‑work via `nearestWaterTile`), and an **emptied tile DRIES to passable dirt** (`dryWater` → `dryWaterAt` repaint hook) so lakes drain shoreline‑inward and open crossings. The tower is also a coolant drop‑off (+4/s). `hasWaterTower()` gates it; **player‑only** (AI sticks to coolant nodes). Coolant nodes are also more plentiful now (richer caches + bigger central field). Tuning: `waterAmt` 700/tile, draw 62/s.

   **HEROES (roadmap #6 — commit `2ea703c`, main + live):** the full excavate‑a‑hero loop.
   - **Hero Vaults** (`game.vaults`, `Vault` type) — buried in mountain **rock**, placed in `mapgen` away from bases, one per archetype. Hidden until **surveyed**.
   - **Survey Hunter** (`U.hunter`, airborne, light weapon, `survey:true`, gated on `drillbay`) — its big `SURVEY_R` sense locates vaults (`vaultTick`); discovery clears local fog so the vault shows.
   - **Excavation** — right‑click a discovered vault with a **Borer** → `order:'dig'` → `excavate()` drills **pay‑as‑you‑drill** (`DIG_CR_RATE` 50 cr/s + `DIG_AL_RATE` 12 alloy/s over `DIG_TIME` 18s; stalls if you can't pay). At 100% it spawns the hero at a free spot.
   - **3 hero archetypes** (`hero:true`, golden crown render, never desert): **`titan`** (brawler, 1700hp + heavy cannon), **`siegelord`/Devastator** (artillery, 300 range, 95 dmg, big splash, fragile), **`warden`** (heal‑aura support via `auraHeal` 16 hp/s, `auraTick`). Excavated only — NOT in the build menu; map‑limited (3 vaults).
   - Render: `BattleScene.drawSettlements` draws discovered vaults (glow + dig ring) + minimap diamonds. Player‑only.
   - ⚠️ Compile‑verified only — playtest: Hunter reveals vaults, Borer digs & drains resources, each hero spawns and behaves (Warden aura heals, Devastator out‑ranges, Titan tanks).
   - **Tuning:** vault count (3, in `mapgen`), `DIG_TIME`/`DIG_CR_RATE`/`DIG_AL_RATE`, `SURVEY_R` (14 tiles), hero stats in `constants.ts`, `AURA_R` 130 / Warden `auraHeal` 16.

**~~#9 Naval / oceans~~ — SCRAPPED (Lane, 2026‑06‑18).** Do not build naval/sea units/ocean terrain. Removed from the roadmap.

**Continuous:**

4. **#10 Polish** — Lane wants it "much better looking & functioning." Biggest remaining visual win = **real CC0 art assets** (Kenney.nl / OpenGameArt) replacing the procedural canvas sprites, + Phaser lighting/particles.
   - ✅ **Polish pass 1 (commit `a77f55d`, main + live):** combat FX — explosion **embers** + slower outer **shockwave**, glowing **tracer heads** (new `ember`/`mote`/`shock` particle types in `spawnParts`/`drawFx`); cinematic **vignette** (`BattleScene.makeVignette`, camera‑fixed depth 10500); faint **ambient dust motes** (spawned in `update` within the worldView). HUD: topbar readouts in **legibility chips** + **fixed the mobile topbar overflow** (collided with the sidebar at ≤375px) — now `flex-wrap` + `min-height`, compacted chips on mobile.
   - **Preview note (updated):** this session the headless preview actually **did render the WebGL canvas** (terrain/HQ/units visible) alongside the DOM HUD — so UI/layout *is* screenshot‑verifiable here (used it to catch & fix the topbar overflow at 375px). Sim/combat behaviour still wants Lane's playtest.
   - ✅ **Hybrid art #1 — real CC0 ground textures (commit `a24d12f`, main + live):** Lane chose the **hybrid** route (real CC0 terrain + FX, richer procedural units). Pulled CC0 **ambientCG** textures (Grass001/Rock023/Ground003), downscaled to 256² → `src/assets/terrain/*.jpg`, **inlined via `?inline`** (single‑file build +~115KB, stays self‑contained; `src/vite-env.d.ts` declares the module). Loaded in `BattleScene.preload`, handed to `setTerrainTextures()` in `terrain.ts`, blended over the stylized base with an **'overlay' pass (alpha 0.8)** in `renderTerrain`. Verified in preview — adds real surface detail, keeps the art direction. `assets/CREDITS.md` records CC0 source. **Download+unzip+sips pipeline works in this sandbox** (curl ambientCG zip → unzip color map → `sips -Z 256`).
   - ✅ **Hybrid art #2 — real CC0 tree sprites (commit `8138f9a`, deploy `db1440a`, live):** Lane picked trees next. **Kenney Foliage Pack** (CC0, via archive.org) — conifer (foliagePack_004) + deciduous (foliagePack_010), downscaled to 96px → `src/assets/trees/*.png`, inlined `?inline` (`*.png?inline` declared in `vite-env.d.ts`). `setTreeTextures()` in `terrain.ts`; `paintTree` now `drawImage`s the sprite with per‑tree **flip + size variety** (driven by the `tone` field), falls back to procedural canopy if unloaded. Loaded in `BattleScene.preload`. **Single‑file artifact verified to boot+render via `nexus-dist`:4173** (not just dev). Couldn't frame a forest in preview (base clearing removes nearby forest; rest in fog) — Lane should glance at a forest in playtest.
   - **Hybrid art — still open (Lane to steer):** (a) real CC0 **explosion/smoke sprite sheets** on deaths — higher effort, hard to verify headlessly; (b) **richer unit/building sprites** (procedural; small at game zoom so low verifiability); (c) water shimmer. Download pipeline (curl ambientCG/archive.org → unzip → `sips`) is proven; `nexus-dist` artifact verification is now the pre‑deploy gate.

**✅ Missile & defense system (2026‑06‑19, main + live) — Lane's big batch:**
- **Missile Silo** (`B.silo`, 1400cr+400 alloy) now GATES missiles. Abilities use a generic `requires` building + `alloy` cost (`tryAbility`/`castAbility`): emp/hijack=`cyber`, nuke/thermo=`silo`.
- **Thermonuclear Missile** (`ABILITIES.thermo`, **9000cr + 2500 alloy**, 360s cd, key `B`): `THERMO_R` 440px colossal blast (`detonateThermo`, 7000 bld dmg) — flattens a clustered base → can erase a faction. 7s flight.
- **Iron Dome** (`B.idome`, 900cr+250 alloy): intercepts inbound ballistic/thermo missiles within `IDOME_R` 7 tiles, recharges `IDOME_CD` 9s. **Aegis Shield** (`U.aegis`, requires `idome`, no weapon, `shield:true`): mobile interceptor, `AEGIS_R` 5.5 tiles / 10s. `tryIntercept` in `processStrikes` knocks a missile down if a ready, non‑allied dome/aegis covers the impact. `pendingStrikes` carry `team`+`kind`; `pendingStrikeList()` exported for render.
- **AI lobs ballistic missiles** at rivals after t>540 (warlord more often) so the dome matters; **inbound‑missile warning reticles** render on in‑flight strikes (red=thermo, orange=ballistic); dome/aegis intercept‑radius rings on selection; `N`/`B` hotkeys.
- ⚠️ Compile + **artifact‑verified** (boots, gating correct); the interception/thermo‑wipe/AI‑missile *behaviour* needs Lane's playtest.
- **Tuning knobs:** thermo cost/`THERMO_R`, `NUKE_R`, `IDOME_R`/`IDOME_CD`, `AEGIS_R`/`AEGIS_CD`, AI launch rate (`dt*0.006` warlord / `0.003`).

**Smaller follow‑ups noted during Session 1:**
- Population/society layer "feels pointless" (Lane, round‑2 note #2) — deepen its function/interaction; relates to letting neutral populations grow into an emergent faction (note #3) and richer settlement absorption (note #7).
- Explicit per‑unit relay targeting (currently relays are auto‑assaulted by present non‑owner military, not click‑targeted).

---

## 7. Gotchas (learned the hard way in Session 1)

- **The headless preview pauses the game loop.** Phaser uses `requestAnimationFrame`, which throttles/pauses when the preview tab is backgrounded (`game.loop.frame` stays 0). So `create()`/`stepWorld` don't run → **you cannot observe unit movement, combat, map‑gen, or framerate headlessly**. What you CAN verify headlessly: `tsc`/build, DOM/UI layout, CSS (use `preview_resize`), console errors on load. Everything sim/render‑behavioral → **Lane playtests** (he's on desktop + mobile).
- **WebGL canvas won't screenshot meaningfully** in CI/preview (the original coder noted this too) — verify the sim via headless logic, not screenshots.
- **Switching git branches reverts the working tree** — always re‑Read a file (on the current branch) before editing, or the Edit will fail "modified since read."
- **zsh `PIPESTATUS` quirk** — `cmd | tail` then checking `${PIPESTATUS[0]}` doesn't work like bash. Use `cmd > log 2>&1; rc=$?` then inspect `$rc`.
- **Mobile layout**: the intro `.overlay` is `position:absolute` inside `#gameArea` (covers only the game column) — the mobile `@media` makes it `position:fixed` (full‑screen). DEPLOY/NEW‑BATTLEFIELD use `position:sticky` so they're reachable. Minimap is shrunk on mobile so the feed isn't clipped.

---

## 8. Balance / tuning knobs (need playtest feedback)

These are single numbers Lane may want tuned after playing:
- `RELAY_HP` (600) — how long it takes to shoot an owned relay offline; relay assault factor (1.5×) + regen (2%/s) in `relayTick`.
- `SETTLE_INCOME` (0.05 cr/pop/s) — settlement economy.
- `GUARD_FOLLOW` (70) / `GUARD_LEASH` (230) — escort behavior.
- Stuck thresholds in `followPath` (`stuckT>0.8`, dislodge on 2nd cycle).
- Harrier vs Wraith stats; nuke cost (2000) / cooldown (150s) / radius (`NUKE_R` 150).
- `MAP_SCALE` (3) — if the 3× map feels too big/empty or perf struggles in big late‑game battles, this is the dial (also revisit unit caps; AI army cap is 34).

---

## 9. Verification status of Session‑1 work

- **Playtest‑confirmed by Lane:** stuck‑units fix + auto‑scout work; mobile controls usable; DEPLOY reachable + feed visible after the mobile layout fix.
- **Compile‑verified only (need a real playtest):** nuke, formations, guard order, settlement income, 3× map *performance* (map‑gen render was confirmed, framerate in a big battle is not), relay shoot‑it feel, Harrier flight/combat, recon‑as‑air balance, touch *gestures* (tap‑command / pinch).
- Lane reported (post‑fix) that auto‑scout no longer sticks; general ground sticking improved but "tight terrain" remains the hard case for any pathfinder.

---

## 10. How Lane works (for the next session)
- Gives **broad vision in batches** — sift, prioritize, and push back with reasons; sequence big items rather than cramming.
- Wants **momentum** ("keep building") + each feature **shipped live** so he can playtest on his phone.
- Strongly protective of keeping this project **isolated** from his separate trading system (`lradbill-ship-it/Rainy-Day`, private) — never touch that repo or its preview servers.
