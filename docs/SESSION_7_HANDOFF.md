# NEXUS COMMAND — Session 7 Handoff

> 🟢 **START HERE (first thing, every Session‑7 turn):**
> 1. Read **this file**, then **`docs/TODO.md`** (the living backlog).
> 2. **Present Lane the entire TODO as multiple‑choice cards** (`AskUserQuestion`) and let him pick the next task — see §0. Don't just start building.
> 3. After each shipped task: update `docs/TODO.md`, then show the full list as cards again.
>
> Older per‑feature detail: `docs/SESSION_6_HANDOFF.md` → `SESSION_5/4/3/2`. Original v1 mission/spec: `CLAUDE.md`.
> Written at the end of **Session 6 (2026‑06‑29/30)**. Everything below is live on `main` + the gh‑pages link.

---

## 0. 🔁 THE WORKFLOW RULE (Lane's standing request — do this every task)

**At session start and after every shipped task:** update `docs/TODO.md`, then present Lane the **entire current
todo list** and let him **pick the next task with multiple‑choice cards** (`AskUserQuestion`, max 4 options → put the
3–4 best candidates on cards, recommended first, AND paste the full TODO in the message).

- **Exception — delegation:** when Lane says **"keep going" / "do it all" / "all of it" / "Cartman?"**, he's delegating —
  work through verifiable increments, **shipping + deploying each**, without re‑asking per item. Surface a brief
  checkpoint after a big batch.
- **Ask‑first (per `CLAUDE.md`):** faction design, diplomacy rules, pacing/balance targets. (Lane steered the Star Wars
  character pivot in S6 — see §5.)
- **CONTEXT BUDGET — don't assume it.** Ask Lane the real % before any wrap decision rather than guessing.

---

## 1. One‑paragraph orientation

NEXUS COMMAND is a Command & Conquer–style RTS: **TypeScript + Phaser 3 (WebGL) + Vite**, browser, single self‑
contained HTML, no backend. 6 regional factions **+ the Free Legion** (emerges mid‑match); 4 harvested inputs
(crystal=currency, coolant, alloy, wood) + power; civilian society/settlements/Envoy diplomacy; government; Command
Relays; a subterranean layer (Borer, hero vaults); a missile/defense layer (silos, thermonuke, orbital, carpet, Iron
Dome, Shield Projector, **Arc Tower**); walls/gates; veterancy; patrol; collector‑merge; stealth; minefields; garrison;
APC transport; deployable Sentry Pod; Chrono Freeze; **special characters** (South Park: Cartman/Kenny/Stan/Kyle **+
the new Star Wars line: Jedi/Sith/Bounty Hunter/Droideka**); ceasefires; **a whole CONQUEST CAMPAIGN metagame**. Win/lose
= annihilation only (in skirmish). **Session 6 was dominated by a perf + pathfinding rescue (9 fixes) on top of 5 new
combat toys — Session 7 should start by confirming movement & FPS feel on Lane's machines, then return to features.**

---

## 2. Where everything lives

| | |
|---|---|
| **Repo (origin)** | `https://github.com/lradbill-ship-it/Nexus-Command` — Lane's account. Commit straight to `main`. |
| **Live game** | **https://lradbill-ship-it.github.io/Nexus-Command/** (GitHub Pages, `gh-pages` branch) |
| **Local clone** | `/Users/Lane-DDABBER/Claude/Nexus-Command` |
| **Backlog / docs** | `docs/TODO.md` (living) · this file · `docs/SESSION_6_HANDOFF.md` (+ 5/4/3/2) · `CLAUDE.md` |
| **⚠ DO NOT TOUCH** | Lane's separate trading project (`rainyday-readonly` :8099, `rainyday-s40` :8181). Keep Nexus isolated. |
| **Preview servers** | `nexus-dev` (vite dev :5173) · `nexus-dist` (serves `dist-single/` :4173) in the **PROJECT‑ROOT `/Users/Lane-DDABBER/Claude/.claude/launch.json`**. ⚠ If another chat holds those ports, add a temp entry on a free port (S6 used `nexus-test` :5180 / `nexus-dist-test` :4180 — REMOVED at wrap; re‑add if needed). |

`main` tip at wrap: **`617a5e1`**. Live link in sync.

---

## 3. Run / build / **DEPLOY** (the proven flow)

```bash
cd /Users/Lane-DDABBER/Claude/Nexus-Command
npm install
npm run dev            # vite dev :5173 (HMR)
npm run build:single   # tsc --noEmit && vite build --mode single → dist-single/index.html (the deploy artifact)
```
**Deploy = manual, no CI:**
```bash
npm run build:single
cp dist-single/index.html /tmp/nexus-index.html
git checkout gh-pages && cp /tmp/nexus-index.html index.html
git add index.html && git commit -m "Deploy: <what>" && git push origin gh-pages
git checkout main
```
Then poll `curl -s -o /dev/null -w '%{size_download}' '<live-url>?cb=$RANDOM'` until it equals `wc -c < dist-single/index.html` (CDN lag ~1–2 min, occasionally up to 3; tell Lane to hard‑refresh).

### ⚠ Verification workflow (order: tsc clean → headless test → build:single → check artifact boots → deploy → propagation)
1. **Headless sim/behavior tests = a standalone test page** (single module graph): write `src/dev_*_test.ts` (import
   `state`/`sim`/`mapgen`/`pathfind`; reset/setup; run `stepWorld`/drive flow; assert; stamp `window.__TESTOUT`), a tiny
   root `*_test.html`, navigate the dev preview to an **absolute** `http://localhost:<port>/x_test.html?cb=…`, read
   `__TESTOUT`. **Delete the temp files after.** (S6 used this heavily for the perf/pathing repros — it's the single
   most valuable tool: it pinpointed the 109ms heap alloc, the assault storm, the logger starvation, and the
   never‑repath bug by timing `stepWorld` and inspecting unit state.)
2. **The backgrounded headless preview pauses Phaser's RAF** → the battle canvas is BLACK, UPTIME 00:00, the FPS badge
   reads "—", scene never boots. So you can verify **logic + clean boot + DOM**, but **battlefield feel / FPS /
   render‑look are Lane's device call.**
3. **DOM is fully verifiable** — sidebar/HUD/intro/help AND the whole **Conquest layer** (DOM/SVG, not Phaser).
4. **Verify the actual single‑file artifact before deploy** (`preview_start nexus-dist` → `#startBtn` →
   `preview_console_logs` level error, expect none).

---

## 4. Conventions (don't relitigate)
- **Stay on Phaser 3.** Commit straight to `main` + deploy, no PRs. Verify the single‑file artifact before deploy.
- **Optimize DESKTOP for real play; keep MOBILE demo‑able, not full‑parity.**
- **Give new systems to the AI too** (parity) — every new unit/ability/building/character is AI‑parity'd.
- **Ask Lane before changing faction design, diplomacy rules, or pacing/balance.** Run the card‑picker (§0).

---

## 5. Session 6 — what shipped (the canonical log is `docs/TODO.md` §"Shipped in Session 6")

**A) 5 new combat toys (all AI‑parity'd, headless‑verified, live):**
- **Arc Tower** (`B.tesla`) — chain‑lightning anti‑swarm defensive building; `teslaZap` arcs through up to 4 ground
  enemies (falloff). New `'arc'` particle FX (jagged bolt, `Particle.x2/y2`). Knobs: `TESLA_JUMP` 120, `TESLA_FALLOFF` 0.72, `chain` 4.
- **🌟 STAR WARS CHARACTER LINE** (Lane's S6 pivot — **"Fresh SW characters only", South Park boys kept as‑is**), each
  Cyber‑gated/`unique`/`hero`, AI special‑pick parity, with a NEW mechanic:
  - **Jedi Knight** (`U.jedi`, `deflect` 0.5) — deflects incoming direct shots & reflects a bolt back (checked in `updateShots`); hard‑countered by splash.
  - **Sith Lord** (`U.sith`, `forceLightning` 4) — periodic Force‑Lightning chain that damages + stuns (`forceLightningTick`, reuses `'arc'` FX). Knobs: `FORCE_CD` 9, `FORCE_DUR` 2, `FORCE_DMG` 70.
  - **Bounty Hunter** (`U.bountyhunter`, `seekerSalvo` 4) — airborne jetpack merc; periodic salvo of homing seeker missiles (`seekerSalvoTick`). Knobs: `SEEKER_CD` 6, `SEEKER_DMG` 56, `SEEKER_SPLASH` 34.
  - **Droideka** (`U.droideka`, `selfShield` 750 + `Unit.shieldE`) — personal deflector that soaks damage 1:1 while STATIONARY, down while rolling, recharges out of fire (`applySelfShield`). Knobs: `SELF_SHIELD_REGEN` 70, `SELF_SHIELD_DELAY` 2.5.
  - **Open SW backlog:** Wookiee brawler, Astromech (repair/buff), Force‑pull/throw ability, character team‑up synergy.
  - **Pattern for a new character:** `U.x` (+ `unique`/`hero` + a signature flag) + behaviour tick in `updateUnit` + sprite (`textures.ts` `unitCanvas`) + sidebar (`unitOrder` + icon) + AI special‑pick list (`['cartman',…,'droideka']`) + help/`desc`.

**B) ⚡ Perf & pathfinding rescue (9 fixes — Lane's 2019 MacBook Pro playtests).** Full list in `docs/TODO.md`. The
load‑bearing ones to remember:
- **Fixed‑timestep accumulator** (`BattleScene.update`) — game now runs at real‑time pace at any FPS (was slow‑motion
  below 20fps); `MAX_CATCHUP` 12, `BUDGET_MS` 10 wall‑clock guard.
- **Allocation‑free A\* heap** (`pathfind.ts`) — was 109ms/search (array‑destructuring swaps → GC), now ~14ms.
- **Pathfinding budget by WORK, with graceful deferral + partial paths** — `resetPathBudget(60000)` pops/tick; over‑budget
  searches set `pathDeferred()` and the unit **HOLDS (`waitPath`) + retries** (never wedges); a search that can't reach
  the goal in `30000` nodes returns a **PARTIAL path** to its closest node (long hauls walked incrementally).
- **move/amove now RE‑PATHS** (was the big "hung up all over the place" bug — it computed one path and never recomputed).
  Same fix applied to transport/Aegis/Envoy.
- **Always‑on anti‑wedge + escalating stuck‑escape** (`updateUnit` + `followPath`): nudge any ground unit off an
  impassable tile every tick (covers Borer‑mined heroes spawned in rock); `nearestOpenTile` clearance dislodge → after
  ~3s stuck, **hard‑escape teleport** toward the goal. Nothing stays permanently trapped.
- **Particle hard‑cap** (300 / 90 in Low Detail) + **Low Detail (F)** + **adaptive quality** (auto‑Low‑Detail when FPS
  <40 sustained). `setLowDetail`, `adaptQuality`. **FPS readout sits top‑left.**

**⚠ Still to confirm with Lane (the gating Session‑7 step):** FPS on the **2019 laptop**, and that **movement feels
right** in real play (heroes/specials/groups across rock/trees/long hauls). Verified headlessly (24/24 cross mid‑range),
but feel/FPS are his call. The one case I'm least sure of: crossing a **river with no nearby bridge** — partial paths
greedily head toward the goal and can stall at that local‑minimum barrier; the hard‑escape mitigates but a screenshot +
heading would let us target it (e.g. a periodic full‑budget search when a unit is barrier‑stuck).

---

## 6. Architecture map (key files; touched in S6 in **bold**)
- **`src/sim/sim.ts`** (~2.9k lines) — the sim. `stepWorld(dt)` (now calls `resetPathBudget`), tick subsystems, combat
  (`fireAt`/`damage`/`destroy`/`nearestHostile`), **movement (`stepToward`/`followPath` — anti‑wedge + escalating
  stuck‑escape + `nearestOpenTile`/`tileClearance`)**, **`setPath` (graceful deferral + `waitPath`)**, `issueOrder`,
  `castAbility`, `updateUnit` (**move/amove now repaths; new character ticks: `forceLightningTick`/`seekerSalvoTick`,
  `applySelfShield`, `teslaZap`**), `updateHarvester`/`updateLogger` (`nearestForest`/`nearestNodePathable`),
  `aiTech`/`aiUpdate` (+ Arc Tower + the 4 SW chars in the special‑pick). **`setLowDetail`/`partCap`.** Module locals
  reset in `resetSimLocals()`.
- **`src/sim/pathfind.ts`** — A* (**allocation‑free heap; `pathPops`/`popBudget`/`pathDeferred` work‑budget; partial‑path
  fallback to the closest node**). `passable`/`passableFor`/`nearestPassableTile`.
- **`src/scene/BattleScene.ts`** — Phaser scene + **main loop (fixed‑timestep accumulator, FPS badge, adaptive quality,
  Low Detail/F)**; render/cull, input, minimap, `drawOverlay` (+ **Droideka shield dome**), `drawFx` (+ **`'arc'` bolt**),
  `drawWater`, `syncEntities`.
- **`src/sim/constants.ts`** — `U`/`B`/`ABILITIES`/`FAC`/`STYLES`, flags (+ NEW `chain`, `deflect`, `forceLightning`,
  `seekerSalvo`, `selfShield`). `B.tesla` + `U.jedi/sith/bountyhunter/droideka`.
- **`src/sim/types.ts`** — `Particle` (+ `x2`/`y2`), `Unit` (+ `shieldE`, `waitPath`).
- **`src/render/textures.ts`** (sprites incl. tesla/jedi/sith/bountyhunter/droideka) · **`src/ui/sidebar.ts`**
  (`buildOrder` + tesla, `unitOrder` + the 4 chars, icons) · `src/audio.ts` · **`index.html`** (CSS + intro + help; PERFORMANCE legend line).

---

## 7. Gotchas (carry‑forward + new from Session 6)
- **NEVER `setPath` a ground unit to a solid/occupied tile** — A* targets `nearestPassableTile` near it, fine; but the
  big lesson: **any move order MUST re‑path** (move/amove was the offender), or a unit that doesn't reach the goal in one
  search stalls forever.
- **PERF: never reallocate per‑frame / per‑search in hot loops** — the A* heap's array‑destructuring swaps caused a
  109ms GC stall. Keep pathfinding + the per‑frame loops allocation‑free.
- **Pathfinding is BUDGETED per tick** (`resetPathBudget`): over‑budget searches DEFER (unit holds via `waitPath`) — do
  NOT treat a deferred null like a genuine no‑path. Resource scans (`nearestForest`/`nearestNodePathable`) fire MANY
  cheap findPaths per search → the budget is by node‑pops, not call count, so they aren't starved.
- **The headless preview pauses Phaser RAF** → FPS badge "—", scene doesn't boot; battlefield feel/FPS = Lane's device.
- **iOS Safari canvas ≤ ~16.7MP / 4096px**; mobile uses `dvh`; never `terrainTex.refresh()` on a frequent event.
- **`nearestHostile` filters by `isWar`, not `!isAllied`**; **`game.water` IS the coolant stockpile** (legacy name);
  **switching git branches reverts the working tree** — re‑Read before editing after `git checkout`.
- **zsh:** prefix Bash with `cd /Users/Lane-DDABBER/Claude/Nexus-Command &&` (cwd can reset between calls; `npx tsc`
  failed once from the wrong dir). `wc -c` → `tr -d ' '`.

---

## 8. Tuning knobs (S6 additions; older knobs in `docs/SESSION_6_HANDOFF.md` §8)
- **Arc Tower:** `B.tesla` dmg 22 / range 200 / rof 1.5 / cost 650+180 alloy / power −25; `chain` 4, `TESLA_JUMP` 120, `TESLA_FALLOFF` 0.72.
- **Jedi:** `deflect` 0.5, reflect frac 0.6. **Sith:** `forceLightning` 4, `FORCE_CD` 9, `FORCE_RANGE` 190, `FORCE_JUMP` 135, `FORCE_DUR` 2, `FORCE_DMG` 70.
- **Bounty Hunter:** `seekerSalvo` 4, `SEEKER_CD` 6, `SEEKER_RANGE` 300, `SEEKER_DMG` 56, `SEEKER_SPLASH` 34, `SEEKER_SPEED` 300; air + antiAir + coolant 4.
- **Droideka:** `selfShield` 750, `SELF_SHIELD_REGEN` 70, `SELF_SHIELD_DELAY` 2.5.
- **Pathfinding/perf:** `resetPathBudget` 60000 pops/tick · node cap 30000 · `MAX_CATCHUP` 12 · `BUDGET_MS` 10 · partCap 300 / 90 (Low Detail) · adaptive: enable <40fps / restore >56fps · stuck hard‑escape after `unstick≥4` (~3s).

---

## 9. The backlog & best next moves (`docs/TODO.md` is the living list)
1. **🎯 CONFIRM MOVEMENT + FPS FEEL on Lane's machines — the gating Session‑7 step.** All of S6's pathing/perf is
   headless‑verified; Lane needs to confirm units move right (no hang‑ups) and the laptop FPS is acceptable. If a unit
   still hangs: screenshot + heading → likely a river/bridge local‑minimum (add a periodic full‑budget search when a
   unit is barrier‑stuck).
2. **🎮 PLAYTEST‑DRIVEN BALANCE** — the toolbox is huge & mostly unplaytested: the 5 new S6 toys (Arc Tower / Jedi
   deflect / Sith / Bounty Hunter / Droideka strength + cost), the South Park chars, Conquest pacing, Shield/Chrono/Carpet.
3. **More Star Wars characters / combat toys** (§5 open list) via the established pattern.
4. **Conquest depth** (defender‑tailored battles, carry‑over veterancy, mission variants, map variety).
5. **Battlefield visuals** (Lane‑directed — render is RAF‑gated headless) · **CC0 audio** (by‑ear).
6. **Web‑Worker sim** — 🛑 still HELD (sim is ~2ms/step; the S6 perf problems were pathfinding + render, now fixed).

**Don't pick for Lane — run the card‑picker (§0).** Lead Session 7 by getting his playtest read on movement/FPS first.

---

## 10. Session 6 changelog (newest first)
`617a5e1` move‑repath + partial paths + graceful deferral (fix "hung up everywhere") · `2569a14` robust anti‑stuck
(clearance dislodge + hard escape) · `5a0b21d` loggers idle + anti‑wedge (work‑budget) · `5933196` adaptive quality ·
`ede67e0` particle hard‑cap · `3907d53` per‑step path budget · `bafc20c` alloc‑free A* heap (2fps crater) · `abc891c`
FPS counter + Low Detail (F) · `123bc25` fixed‑timestep accumulator (slow‑mo fix) · `0a59e71` Droideka · `97ef6ba`
Bounty Hunter · `b530e67` Sith Lord · `0c17c90` Jedi Knight · `affb52f` Arc Tower. (Each tsc‑clean + headless/DOM‑verified
+ deployed; AI parity on every new system.)

⚠ **All Session‑6 work is tsc‑clean + headless/DOM‑verified + boots clean. FEEL / on‑device FPS / movement‑in‑real‑play
are Lane's playtest call — and confirming them is the gating Session‑7 step.**
