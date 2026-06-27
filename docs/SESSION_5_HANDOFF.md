# NEXUS COMMAND — Session 5 Handoff

> 🟢 **START HERE (first thing, every Session‑5 turn):**
> 1. Read **this file**, then **`docs/TODO.md`** (the living backlog).
> 2. **Present Lane the entire TODO as multiple‑choice cards** (`AskUserQuestion`) and let him pick the next task — see §0. Don't just start building; let him choose.
> 3. After each shipped task: update `docs/TODO.md`, then show the full list as cards again.
>
> Older per‑feature detail: `docs/SESSION_4_HANDOFF.md`, `docs/SESSION_3_HANDOFF.md`, `docs/SESSION_2_HANDOFF.md`. Original v1 mission/spec: `CLAUDE.md`.
> Written at the end of **Session 4 (2026‑06‑27)**. Everything below is live on `main` + the gh‑pages link.

---

## 0. 🔁 THE WORKFLOW RULE (Lane's standing request — do this every task)

**At session start and after every shipped task:** update `docs/TODO.md`, then present Lane the **entire current
todo list** and let him **pick the next task with multiple‑choice cards** (`AskUserQuestion`). The card tool shows
**max 4 options** → put the 3–4 best candidates on cards (recommended first) and **also paste the full TODO in the
message** so nothing is hidden. One question: "What should we tackle next?"

- **Exception (seen all of Session 4):** when Lane says **"keep going" / "do it all" / "keep cranking" / "keep
  polishing,"** he's delegating — work through the backlog in **verifiable increments, shipping + deploying each**,
  without re‑asking per item. Still update `docs/TODO.md` after each. After a big delegated batch, it's good judgment
  to surface a brief checkpoint (esp. "you've got N unplaytested features — playtest?").
- **Ask‑first (per `CLAUDE.md`):** faction design, diplomacy rules, and **pacing/balance targets**. Don't blind‑tune
  balance — get Lane's playtest read first.

---

## 1. One‑paragraph orientation

NEXUS COMMAND is a Command & Conquer–style RTS: **TypeScript + Phaser 3 (WebGL) + Vite**, browser, single self‑
contained HTML, no backend. 6 regional‑coalition factions **+ a 7th that can emerge mid‑match (the Free Legion)**;
4 harvested inputs (crystal=currency, coolant, alloy, wood) + power; a civilian society layer (population/happiness/
settlements → uprisings → emergent faction); government (leaders/elections/coups); Command Relays; a subterranean
layer (tunneling, the Borer, hero vaults); a missile/defense layer (silos, thermonuke, **orbital ion strike**, Iron
Dome); walls/gates; veterancy; patrol; collector‑merge; **stealth (Spectre)**; **minefields**; **garrison**;
**ceasefires**. **Win/lose = annihilation only.** **The full feature backlog is essentially built — Session 5 is
primarily a PLAYTEST‑DRIVEN BALANCE PASS** (Lane has started playing and is reporting bugs/feel), plus optional combat
depth, polish, and the deferred Web‑Worker sim (FPS‑gated).

---

## 2. Where everything lives

| | |
|---|---|
| **Repo (origin)** | `https://github.com/lradbill-ship-it/Nexus-Command` — Lane's account. Commit straight to `main`. |
| **Live game** | **https://lradbill-ship-it.github.io/Nexus-Command/** (GitHub Pages, `gh-pages` branch) |
| **Local clone** | `/Users/Lane-DDABBER/Claude/Nexus-Command` |
| **Old repo** | `grodoctor-tech/Nexus-Command` (friend's; kept only as the `grodoctor` remote — never push there) |
| **Backlog / docs** | `docs/TODO.md` (living) · this file · `docs/SESSION_4_HANDOFF.md` · `SESSION_3/2_HANDOFF.md` · `CLAUDE.md` |
| **⚠ DO NOT TOUCH** | Lane's **separate trading project** (`/Users/Lane-DDABBER/Rainy-Day`; the `rainyday-readonly` server on port 8099). Keep Nexus isolated. |
| **Preview servers** | `nexus-dev` (vite dev :5173) · `nexus-dist` (serves `dist-single/` on :4173). **⚠ These live in the PROJECT‑ROOT `/Users/Lane-DDABBER/Claude/.claude/launch.json`** (the preview tool reads that one, NOT `Nexus-Command/.claude/`). If `preview_start('nexus-dev')` ever launches the trading server, the root launch.json lost the nexus entries — re‑add them (`bash -c "cd Nexus-Command && npm run dev"` / `… python3 -m http.server 4173 --directory dist-single`). |

---

## 3. Run / build / **DEPLOY** (read the gotchas)

```bash
cd /Users/Lane-DDABBER/Claude/Nexus-Command
npm install
npm run dev            # vite dev :5173 (HMR)
npm run build:single   # tsc --noEmit && vite build --mode single → dist-single/index.html (the deploy artifact)
```

**Deploy = manual, no CI.** The exact flow used ~15× in Session 4:
```bash
npm run build:single
cp dist-single/index.html /tmp/nexus-index.html
git checkout gh-pages && cp /tmp/nexus-index.html index.html
git add index.html && git commit -m "Deploy: <what>" && git push origin gh-pages
git checkout main
```
Then poll propagation: `curl -s -o /dev/null -w '%{size_download}' '<live-url>?cb=$RANDOM'` until it equals
`wc -c < dist-single/index.html` (CDN lag ~1–2 min; tell Lane to hard‑refresh).

### ⚠ Verification gotchas (the order: tsc clean → headless test → build:single → check artifact boots → deploy → confirm propagation)
1. **Headless sim tests use a standalone test page** (single module graph): write `src/dev_*_test.ts` (import `state`,
   `sim`, `mapgen`; `resetState()/resetSimLocals()/generateMap()/setupBases()/computeVision()`, run `stepWorld`, assert,
   stamp `window.__TESTOUT`), a tiny root `*_test.html` that imports it, navigate the **`nexus-dev`** preview to it via
   an **absolute URL** (`http://localhost:5173/x_test.html?cb=…` — the preview iframe sometimes drifts to a wrong
   origin), read `__TESTOUT`. **Delete the temp files after.** (~10 such tests in Session 4; all deleted.)
2. **The backgrounded headless preview pauses Phaser's RAF** → the scene never boots (`game.scene.scenes` empty), the
   sim won't tick on its own, canvas is black, CSS transitions don't run. So you can verify **logic + clean boot + DOM**,
   but **feel / FPS / render‑look are Lane's device playtest**. (This is why every FX/render change ships behind
   tsc‑clean + bundle‑clean + no‑console‑errors.)
3. **Verify the actual single‑file artifact before deploy** (dev ≠ bundle): build:single → `preview_start nexus-dist`
   → start a game (`#startBtn`), `preview_console_logs` level error (expect none).
4. **Test isolation:** the full sim runs in `stepWorld` (AI economy/training, `societyTick` pop drift) → don't assert
   exact deltas after long stepping. For capture/timed events, pre‑set the trigger near completion (e.g. `s.capT=0.99`)
   and step a few ticks; use entity‑LOCAL checks (`near(x,y,team)`), not global counts. For movement tests use
   `issueOrder` (real path) + AIR units (bypass terrain), not hand‑set `order/dest`.

**Asset pipeline (proven):** `curl` CC0 (ambientCG zips, Wikimedia PD audio, archive.org Kenney) → process → `src/assets/`
→ import `?inline` (declared in `src/vite-env.d.ts`) → load in `BattleScene.preload` (images) / `audio.ts` (sounds).
**Safari audio:** `afconvert -f m4af -d aac -b 64000 -c 1 in.ogg out.m4a` (Safari can't decode OGG in Web Audio).

---

## 4. Conventions (don't relitigate)
- **Stay on Phaser 3.** Engine swaps considered & rejected; graphics ceiling = assets, perf ceiling = optimization.
- **Commit straight to `main`** + deploy. No PRs.
- **Verify the single‑file artifact before deploy** (§3); *feel/FPS* → Lane playtests.
- **Optimize DESKTOP for real play; keep MOBILE demo‑able, not full‑parity.**
- **Give new systems to the AI too** (parity) — Session 4 did this for every new ability/unit (orbital, spectre,
  overcharge, minefield, garrison). Don't reintroduce "player‑only" systems by accident.
- **Collectors merge into a mega‑unit; combat units cannot.**
- **Ask Lane before changing faction design, diplomacy rules, or pacing/balance targets.** Run the card‑picker (§0).

---

## 5. Full system inventory (built through Session 4)

**Economy & world:** 6 factions; harvested crystal/coolant/alloy/wood + power; **3× maps** (`MAP_SCALE=3`); CC0
terrain textures + macro shading + CC0 trees (baked at reduced res for the iOS canvas cap); **animated water shimmer**;
crystal regen; water harvesting; neutral **settlements** (recruit/persuade/intimidate; first‑capture windfall);
**Command Relays** (shoot‑to‑capture; **right‑click to send troops to seize**, income+vision).

**Diplomacy & society:** pairwise relations, trade/alliance/gift/war; **SUE FOR PEACE / ceasefires** (player button +
proactive AI peace + a `dip.truce` that holds peace 90s) — the **Free Legion is negotiable**. Population/happiness,
conscription, desertion; leader doctrines; elections & coups; Free Militia uprisings → the **FREE LEGION** (emergent
team 7).

**Units:** harvester/tanker/hauler/logger/repair/aegis, recon, survey hunter, infantry/rocket/strike/artillery/walker,
harrier/aircraft, borer, 3 heroes, militia, **Spectre (cloaked stealth raider)**. Veterancy; tunneling; collector‑merge.

**Buildings:** hq/power/refinery/foundry/turret/wall/gate/palisade/pump/watertower/smelter/mill/habitat/market/aaturret/
idome/cyber/silo/drillbay. Team‑aware gates; continuous wall placement. **Buildings can be GARRISONED** by infantry
(defensive fire; eject when destroyed; press U to unload).

**Combat & special:** turret aim + scaling waves + fog + air layer; covert ops; EMP/Hijack; **Overcharge** (friendly
+dmg/+speed buff); Ballistic + Thermonuclear + **Orbital Ion Strike** (uninterceptable precision beam) missiles/strikes;
**Deploy Minefield** (hidden proximity mines); Iron Dome + Aegis intercept; AI uses the full kit; Subterranean Borer;
hero vaults. Patrol/area‑guard.

**UX/polish:** restart, no edge‑scroll, WASD/minimap pan (minimap has a camera‑viewport box), control groups, sell/
cancel, auto‑scout, rally points, pause + speed (1/2/3×), Controls/Legend help panel, mobile command drawer,
COMBINE/PATROL, **production‑queue badges + build‑progress bars + ability cooldown countdowns**, **command‑confirmation
order markers** (green move / red attack / cyan special), **click a feed alert → camera jumps to where it happened**.

**Audio:** WebAudio synth + real CC0/PD samples (explosion w/ randomized variety / nuke / victory, AAC, Safari‑safe).

---

## 6. Architecture map (key files)
- **`src/sim/sim.ts`** (~2.3k lines) — the simulation. `stepWorld(dt)` calls the tick subsystems (settlement/militia/
  relay/vault/government/autoScout/**stealth**/**mine**/strikes/society/diplomacy + per‑unit/building updates).
  Combat (`fireAt`/`damage`/`destroy`/`nearestHostile`), movement (`followPath`/`stepToward`/`setPath`, A* via
  `pathfind.ts`), `issueOrder` (the big right‑click router: attack / move / guard / **enter‑garrison** / dig / relay‑
  assault / settlement‑recruit, + drops `orderMark`), `castAbility`/`tryAbility` (incl. orbital/overcharge/minefield),
  `aiUpdate`+`aiTech`+`aiHero` (+ AI parity for every new system). Helpers: `cloaked`/`cloakedToPlayer` (stealth),
  `buffed` (overcharge), `garrisonable`/`enterGarrison`/`ejectGarrison`, `layMinefield`, `captureSettlement`,
  `dipPeace`/`proactivePeace`/`factionStrength`, `focusCamera` (feed‑jump). Renderer hooks: `setScorchHook`/`setEndHook`/
  `setClearForestHook`/`setDryWaterHook`/`setEmergeHook`/`setFocusHook`. Module‑level state resets in `resetSimLocals()`.
- **`src/sim/constants.ts`** — `U`/`B`/`ABILITIES`/`COVERT`/`STYLES`/`FAC`, mutable `AIS`/`ALL_TEAMS`+`EMERGENT_TEAM`,
  `MAP_SCALE`, anchors, tuning numbers, flags (incl. `UnitDef.stealth`). `ABILITIES` auto‑generates its sidebar buttons.
- **`src/sim/state.ts`** — `GameState`, `createGame`/`resetState`, diplomacy helpers (`dip.rel/alliance/trade/truce`),
  the UI hooks (`logMsg` now takes an optional `at` pos; `focusCamera`/`setFocusHook`). `game.mines` array.
- **`src/sim/types.ts`** — `Unit` (`revealT`/`buffUntil`/`enterT`/`guard:Unit|Building`/`order:…|'enter'`), `Building`
  (`garrison[]`), `Mine`, `Strike` (kind incl. `'orbital'`), `AIState` (`buffT`/`mineT`), `Particle` (`type:'order'`).
- **`src/sim/mapgen.ts`** · **`src/sim/pathfind.ts`** (`findPath(...,team)`, `passableFor`).
- **`src/scene/BattleScene.ts`** — Phaser scene: render/cull, input (keys incl. O/V/L/U), minimap, `drawOverlay`,
  `drawSettlements` (+ own‑mine markers), `drawWater` (shimmer), `drawFx` (incl. the `order` marker), `syncUnit`
  (stealth hide + overcharge tint), the throttled `update()` loop.
- **`src/render/textures.ts`** (sprites incl. `spectre`; `buildTeamTextures` for the emergent faction) ·
  **`src/render/terrain.ts`** (downscaled bake). **`src/ui/sidebar.ts`** (DOM UI: build/unit/ability/diplomacy panels,
  `dipPeace` button, queue badges, cooldown text, garrison occupancy). **`src/audio.ts`**. **`index.html`** (CSS + help).

**Adding things:** a UNIT = `U.x` + a sprite branch in `textures.ts` + `unitOrder` in `sidebar.ts` + AI pick (gate on
the team owning the prereq building) + render. An ABILITY = `ABILITIES.x` (auto‑wires the button) + `castAbility` branch
+ key in `BattleScene` + (if a strike) a `Strike` kind + a detonate fn + AI parity.

---

## 7. Gotchas (carry‑forward + new from Session 4)
- **NEVER `setPath` a ground unit to a solid/occupied tile (e.g. a building's centre).** A* explores the whole
  reachable map then fails; a repeating order makes it **thrash A* forever** → the Session‑4 perf storm. Target a
  passable spot beside it (`freeSpotNear`) and give failed‑approach orders a **timeout** (see the `'enter'` handler).
- **Cap any entity the AI spawns unbounded.** The AI lays minefields all match → `MINE_GLOBAL_CAP=240`. Watch for
  similar growth in anything new.
- **Preview tool reads the ROOT `.claude/launch.json`** (§2) — keep the nexus configs there.
- **iOS Safari canvas ≤ ~16.7MP / 4096px** — keep full‑map canvases downscaled (terrain bakes at `TERRAIN_RES`).
- **Mobile full‑height uses `dvh`, not `vh`.**
- **Never `terrainTex.refresh()` on a frequent event** (froze on every death) — scorch is decal sprites now.
- **`nearestHostile` filters by `isWar`, not `!isAllied`** — unaligned forces need explicit war relations.
- **`game.water` IS the coolant stockpile** (legacy name); coolant consumption is activity‑scaled in `waterOf`.
- **Switching git branches reverts the working tree** — re‑Read a file before editing after `git checkout`.
- **zsh:** prefix Bash with `cd .../Nexus-Command &&`; `wc -c` has leading spaces (`tr -d ' '`).

---

## 8. Tuning knobs — **Session 5's main job is turning these from Lane's playtest feel**
- **Sue‑for‑peace:** `TRUCE_TIME` 90 · `PEACE_COST` 400 · `PEACE_PROPOSE_CD` 25 · `TRUCE_FLOOR` −10 · `PEACE_THRESH` per persona.
- **Spectre (stealth):** `DETECT_R` 3·TILE · `REVEAL_LINGER` 1.6 · stats in `U.spectre` (cost 520+120 alloy, 120hp).
- **Orbital Ion Strike:** `ORBITAL_R` 95 · `ORBITAL_TRAVEL` 1.6 · detonate dmg 1500/2400 · cost 3500+400 alloy / cd 200.
- **Overcharge:** `OVERCHARGE_R` 150 · `OVERCHARGE_DUR` 9 · `OVERCHARGE_DMG` 1.4 · `OVERCHARGE_SPD` 1.35 · cost 600 / cd 75.
- **Minefield:** `MINE_COUNT` 8 · `MINE_SPREAD` 115 · `MINE_ARM` 1.5 · `MINE_TRIGGER` 30 · `MINE_R` 92 · dmg 240/120 · `MINE_GLOBAL_CAP` 240 · cost 700 / cd 90.
- **Garrison:** `GARRISON_CAP` 5 · `GARRISON_RANGE` 160 · `GARRISON_ROF` 0.7 · enter‑timeout 15s.
- **Settlements:** windfall = loot `pop×8` + `min(3,1+pop/14)` recruits **only from neutral**; `SETTLE_R` 4·TILE; `SETTLE_INCOME` 0.05/pop/s. Owner presence defends.
- **Free Legion (most‑likely tuning target):** `EMERGE_UPRISINGS` 3 · `UPRISING_POP` 26 · `UPRISING_TIME` 75 · `MILITIA_CAP` 32 · founding 3500cr+250 alloy + 5‑unit warband · relations −80 player/nearest.
- **Coolant:** `COOLANT_IDLE` 0.25; per‑unit `coolant` costs in `U`; building trickle.
- **Missiles/defense:** `THERMO_R` 440 · `NUKE_R` 150 · `IDOME_R` 7t/`IDOME_CD` 9 · `AEGIS_R` 5.5t; AI silo/dome thresholds + `missileT` cadence.
- **Veterancy:** thresholds 2/5 · `vetDmg`/`vetHp` 1.2/1.5. **Heroes/vaults:** 3 vaults · `DIG_TIME` 18 · `SURVEY_R` 14t · `AURA_R` 130.
- **Perf throttles:** fog/minimap 70ms · AI loop 0.33s · vision 0.066s · water shimmer 33ms · stealth 0.25s · mine 0.15s · terrain refresh 180ms. AI army cap 34. Mobile zoom 1.7.

---

## 9. The backlog & how to drive it (`docs/TODO.md` is the living list)
**The big build backlog is essentially done.** What remains:
- **🎯 PLAYTEST‑DRIVEN BALANCE PASS — the #1 priority.** Lane has started playing and is reporting issues (2 bugs
  found + fixed in Session 4). Best first move of Session 5: **ask what felt off, then turn the §8 knobs.** Likely
  targets: the new combat toys (Spectre / orbital / overcharge / minefield / garrison strength + cost), Free Legion
  timing/strength, coolant in big air pushes, AI missile/EMP cadence, hero strength. Ask‑first per `CLAUDE.md`.
- **More combat depth (optional, additive — Lane's been enjoying these):** transport/APC to carry infantry,
  deployable turret, repair‑reload, chrono‑freeze / carpet‑bomb superweapons.
- **Society‑layer depth (design‑first/ask‑first):** peaceful civilian recruitment & absorption via diplomacy (builds
  on sue‑for‑peace), deeper than the current pay/intimidate capture.
- **Polish (continuous):** richer unit/building sprites, more terrain/water treatment, UI animations.
- **More CC0 audio (by‑ear curation — Lane judges):** real weapon/UI samples; distinct explosion variants.
- **Web‑Worker sim (deferred):** the one big perf lever — only if late‑game FPS still bites on Lane's device **after**
  the Session‑4 garrison perf fix. Re‑confirm FPS first; HELD as of Session 4.

**Don't pick for Lane — run the card‑picker (§0). Lead Session 5 by surfacing that a playtest‑driven balance pass is
the highest‑value move now that the toolbox is full.**

---

## 10. Session 4 changelog (what shipped, newest first — 29 commits)
**Bug fixes from Lane's playtest:** `f692352` perf storm — stuck garrison units thrashing A* (AI pathed to solid centre)
+ 15s enter‑timeout + 240 mine cap + restored nexus launch.json · `3f2496a` settlement capture‑windfall farming exploit
(pop transferred not duplicated; windfall only from neutral; owner presence defends).
**Features/polish:** `b393fca` command‑confirmation order markers · `132ddc6` Garrison mechanic · `254a026` Deploy
Minefield · `1f11918` Overcharge buff ability · `9e6cbd0` UX polish (queue badges + cooldown countdowns) · `c8b2162`
Spectre stealth unit · `a64ada6` Orbital Ion Strike superweapon · `2af2e56` explosion audio variety · `713db02`
animated water shimmer · `9eb50ec` click‑feed‑to‑locate · `d934945` repair rigs mend buildings (explicit order) ·
`a4120bd` explicit relay targeting · `eb2ffc0` sue‑for‑peace / ceasefires. (Each tsc‑clean + headless‑verified +
deployed; AI parity on every new ability/unit.)

⚠ **All Session‑4 work is tsc‑clean + headless‑verified, but FEEL / balance / on‑device FPS are Lane's playtest call.**
The balance pass is the gating next step now that he's playing.
