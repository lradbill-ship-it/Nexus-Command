# NEXUS COMMAND — Session 4 Handoff

> 🟢 **START HERE (first thing, every Session‑4 turn):**
> 1. Read **this file**, then **`docs/TODO.md`** (the living backlog).
> 2. **Present Lane the entire TODO as multiple‑choice cards** (`AskUserQuestion`) and let him pick the next task — see §0. Do NOT just start building; let him choose.
> 3. After each shipped task: update `docs/TODO.md`, then show the full list as cards again.
>
> Older per‑feature detail: `docs/SESSION_3_HANDOFF.md` (Sessions 1–2 state) and `docs/SESSION_2_HANDOFF.md`. Original v1 mission/spec: `CLAUDE.md`.
> Written at the end of **Session 3 (2026‑06‑23)**. Everything below is live on `main` + the gh‑pages link.

---

## 0. 🔁 THE WORKFLOW RULE (Lane's standing request — do this every task)

**At session start and after every shipped task:** update `docs/TODO.md`, then present Lane the **entire current
todo list** and let him **pick the next task with multiple‑choice cards** (`AskUserQuestion`). Keep doing this as the
list grows, task by task.

- The card tool shows **max 4 options per question** → put the **3–4 best candidates on cards** (recommended first),
  and **also paste the full TODO list in the message text** so nothing is hidden. Lane picks a card or names anything.
- One question, "What should we tackle next?", not a survey. **This is a hard preference — ask via cards even when the next step seems obvious.**
- **Exception observed in Session 3:** when Lane says "keep going" / "do it all," he's delegating — work through the
  backlog in **verifiable increments, shipping + deploying each**, without re‑asking per item. Still update `docs/TODO.md`.

---

## 1. One‑paragraph orientation

NEXUS COMMAND is a Command & Conquer–style RTS: **TypeScript + Phaser 3 (WebGL) + Vite**, browser, no backend, ships
as one self‑contained HTML. 6 regional‑coalition factions **+ a 7th that can emerge mid‑match (the Free Legion)**;
4 harvested inputs (crystal = currency, coolant, alloy, wood) + power; a civilian society layer
(population/happiness/settlements, **uprisings → emergent faction**); government (leaders/elections/coups); Command
Relays; a subterranean layer (tunneling harvesters, the Borer, hero vaults); a missile/defense layer (silos,
thermonuke, Iron Dome); walls/gates; veterancy; **patrol orders**; **collector‑merging**. **Win/lose = annihilation
only.** The game is deep and the full feature backlog has essentially been built. **Session 4 is primarily BALANCE
TUNING from Lane's real playtests**, plus optional polish and the one deferred big lever (Web‑Worker sim, only if FPS
still bites).

---

## 2. Where everything lives

| | |
|---|---|
| **Repo (origin)** | `https://github.com/lradbill-ship-it/Nexus-Command` — Lane's account. Commit straight to `main`. |
| **Live game** | **https://lradbill-ship-it.github.io/Nexus-Command/** (GitHub Pages, `gh-pages` branch) |
| **Local clone** | `/Users/Lane-DDABBER/Claude/Nexus-Command` |
| **Old repo** | `grodoctor-tech/Nexus-Command` (friend's; kept only as the `grodoctor` remote — never push there) |
| **Backlog / docs** | `docs/TODO.md` (living) · this file · `docs/SESSION_3_HANDOFF.md` · `docs/SESSION_2_HANDOFF.md` · `CLAUDE.md` |
| **⚠ DO NOT TOUCH** | Lane's **separate trading project** (`Rainy-Day`; the `invest-static`/`rainy*` preview servers, ports 8097/8099). Keep Nexus isolated. |
| **Preview servers** (`.claude/launch.json`) | `nexus-dev` (vite dev :5173) · `nexus-dist` (serves `dist-single/` on :4173 — the real artifact) |

---

## 3. Run / build / **DEPLOY** (read the gotchas — they bit us repeatedly)

```bash
cd /Users/Lane-DDABBER/Claude/Nexus-Command
npm install
npm run dev            # vite dev :5173 (HMR)
npm run build:single   # tsc --noEmit && vite build --mode single → dist-single/index.html  (the deploy artifact)
```

**Deploy = manual, no CI.** Build the single file, copy onto `gh-pages`, push. The direct method used all of Session 3:
```bash
npm run build:single
cp dist-single/index.html /tmp/nexus-index.html
git checkout gh-pages
cp /tmp/nexus-index.html index.html
git add index.html && git commit -m "Deploy: <what>"
git push origin gh-pages
git checkout main
```
(A cleaner `git worktree` variant is in `SESSION_3_HANDOFF.md` §3 if you want to avoid switching the main tree.)

### ⚠ Verification gotchas — the order is: **tsc clean → headless verify → build:single → check artifact → deploy → confirm propagation**
1. **Headless sim tests MUST use a standalone test HTML page** (single module graph). Importing `sim`/`state`
   separately into the *running app page* (or via `import()` in `preview_eval` on the dev server) hits Vite's **HMR
   module split** → you get a *different* `game` singleton than the app, and tests give bogus results. Pattern that
   works: write `src/dev_*_test.ts` (imports `state`,`sim`,`mapgen`, does `resetState()/resetSimLocals()/generateMap()/
   setupBases()/computeVision()`, runs `stepWorld`, asserts, stamps `window.__TESTOUT`), a tiny root `*_test.html` that
   loads it, navigate the **`nexus-dev`** preview to it, read `__TESTOUT`. **Delete the temp files after.** (Many such
   tests in the Session‑3 history — none committed.)
2. **Verify the actual single‑file artifact before deploy** (dev ≠ bundle): `npm run build:single` → reload
   `nexus-dist` (:4173) → `preview_console_logs` (errors) + force a couple frames + screenshot. The headless canvas
   renders terrain/units, so UI/art/layout *is* screenshot‑verifiable; **sim/combat behaviour is NOT** (see gotcha 4).
3. **GitHub Pages propagation lag (~1–2 min):** right after pushing `gh-pages` the CDN serves the OLD file. Poll
   `curl -s -o /dev/null -w '%{size_download}' '<url>?cb=$RANDOM'` until it equals `wc -c < dist-single/index.html`
   (note: `wc` output has leading spaces — `tr -d ' '` before comparing). Then tell Lane to hard‑refresh. A "live link
   broken right after deploy" is almost always this.
4. **Headless preview pauses Phaser's RAF loop AND CSS transitions when backgrounded.** So: you can't measure FPS, the
   sim won't tick on its own (call `sc.update(performance.now(), 100)` a few times to force frames), and an animated
   drawer/slide will look "stuck" — verify transformed layout by reading computed style with `transition:none` + a
   reflow, not by waiting. Combat/sim *feel* always needs Lane's device playtest.

**Asset pipeline (proven):** `curl` a CC0 pack (ambientCG zips; **Wikimedia Commons** PD audio; **archive.org Kenney**
packs — note Kenney audio on archive.org is only music/voice, no combat SFX) → process → `src/assets/...` → import with
**`?inline`** (base64‑embeds; declared in `src/vite-env.d.ts`) → load in `BattleScene.preload` (images) or decode in
`audio.ts` (sounds). **Audio for Safari:** Safari can't decode OGG in Web Audio, but **`afconvert` on this Mac decodes
OGG → transcode to mono AAC/M4A** (`afconvert -f m4af -d aac -b 64000 -c 1 in.ogg out.m4a`). Record sources in
`src/assets/CREDITS.md`. Network egress works in this sandbox.

---

## 4. Conventions (don't relitigate)
- **Stay on Phaser 3.** Engine swaps considered & rejected; graphics ceiling = assets, perf ceiling = optimization.
- **Commit straight to `main`** + deploy. No PRs.
- **Verify the single‑file artifact (§3) before deploy.** tsc‑clean + boots + no console errors + headless‑logic test is
  the gate; *feel/FPS* → Lane playtests.
- **Optimize DESKTOP for real play; keep MOBILE demo‑able, not full‑parity.** (Lane plays on computer, demos on phone.)
- **Collectors can merge into a mega‑unit; combat units cannot** (a 20×‑HP mega‑tank would break splash/focus‑fire).
- **AI parity is DONE** (Session 3) — the AI uses domes/silos/missiles, wood/repair, water, borer/heroes, EMP/Hijack,
  builds a wall+gate front. Don't reintroduce "player‑only" systems by accident; give new systems to the AI too.
- **Ask Lane before changing faction design, diplomacy rules, or pacing targets** (per `CLAUDE.md`).
- Run the **card‑picker workflow (§0)**; keep `docs/TODO.md` current.

---

## 5. Full system inventory (built, Sessions 1–3)

**Economy & world:** 6 factions; harvested crystal/coolant/alloy/wood + power; **3× maps** (`MAP_SCALE=3`);
procedural terrain with **real CC0 ground textures + macro shading + CC0 tree sprites** (baked at **reduced
resolution** to fit mobile canvas limits — see §7); crystal regen; **water harvesting** (Water Tower → tankers drain
rivers/lakes which dry to dirt); neutral **settlements** (recruit/persuade/intimidate; **capture windfall** = loot +
recruits); **Command Relays** (shoot‑to‑capture, income+vision).

**Society & emergent faction:** population/happiness, conscription, desertion; leader doctrines; elections & coups;
**Free Militia uprisings** (ungoverned towns spawn team‑0 hostiles) that, after enough uprisings, **coalesce into the
FREE LEGION — a full 7th faction (team 7)** with its own base/economy/AI/diplomacy that you must destroy to win.

**Units:** harvester/tanker/hauler/logger/repair/aegis, recon, survey hunter, infantry/rocket/strike/artillery/walker,
harrier/aircraft, borer, 3 excavated heroes (titan/devastator/warden), **militia** (team‑0/Legion). **Veterancy**
(kills→Veteran/Elite). **Harvester tunneling.** **Collector‑merge** (stack N collectors → one mega that gathers ×N).

**Buildings:** hq/power/refinery/foundry/turret/**wall**/**gate**/**palisade**/pump/watertower/smelter/mill/habitat/
market/aaturret/idome/cyber/silo/drillbay. **Walls/Gates**: walls block; **gates are team‑aware** (allies pass,
enemies route around — via `passableFor` + a per‑tile `game.gate` owner grid). **Palisade** = cheap wood‑cost wall.
**Continuous placement** for wall/gate/palisade (stays armed → click a whole line).

**Combat & special:** turret aim + scaling waves + fog + air layer; covert ops; EMP/Hijack; Ballistic + Thermonuclear
missiles (silo‑gated); Iron Dome + Aegis intercept; AI lobs missiles + uses the full cyber kit; inbound reticles +
**air‑raid klaxon**; Subterranean Borer; hero vaults. **Patrol/area‑guard order** (hold a post, hunt any enemy in a
12‑tile zone, sentry‑style ignoring fog in‑zone).

**Performance:** fog + minimap throttled to ~14Hz (fog = reused buffer/alpha‑only; minimap = cached ImageData blit);
strategic AI loop throttled ~3Hz; player fog recompute ~15Hz; viewport‑culled sprites + overlay; cached faction
colours; **scorch = pooled decal sprites (NOT a terrain re‑bake)**; terrain texture downscaled (~12MP). **Coolant
consumption is activity‑scaled** (idle units sip ¼).

**Audio:** WebAudio synth + **real CC0/PD samples** for explosion / nuke blast / victory (AAC, Safari‑safe).

**UX:** restart, no edge‑scroll, WASD/minimap pan, **control groups**, sell/cancel, auto‑scout, rally points, **pause +
game speed (1×/2×/3×)**, **⌨ Controls/Legend help panel**, **mobile command drawer** (full‑screen map + 1.7× zoom),
COMBINE/PATROL buttons (mobile), the C&C metal sidebar with build/fabricate/ability tabs + diplomacy/government panels
(diplomacy UI auto‑extends to the emergent faction).

---

## 6. Architecture map (key files)
- **`src/sim/sim.ts`** (~1.9k lines) — the simulation: `stepWorld(dt)` (with throttle accumulators
  `aiAccum`/`visionAccum`/`militiaT`), `updateUnit`/`updateBuilding`, movement (`followPath`/`stepToward`/`phasing`,
  team‑aware `unitBlocked`), `updateHarvester` (scales by `u.stack`)/`updateLogger`/`updateRepair`, `settlementTick`
  (capture windfall + uprisings)/`relayTick`/`vaultTick`/`societyTick`/`governmentTick`/`militiaTick`, combat
  (`fireAt`/`damage`/`destroy`/`nearestHostile`), veterancy, missiles (`castAbility`/`processStrikes`/`tryIntercept`),
  **emergent faction** (`emergeFaction`/`initFactionState` + `addAITeam`/`resetTeams`), **`combineSelected`**,
  **patrol** (`armPatrol`/`patrolOrder`/`canPatrol` + the `'patrol'` order in `updateUnit`), `aiUpdate`+`aiTech`+`aiHero`,
  `waterOf` (activity‑scaled coolant). Renderer/UI via hooks: `setScorchHook`/`setEndHook`/`setClearForestHook`/
  `setDryWaterHook`/**`setEmergeHook`** (bakes the new faction's textures).
- **`src/sim/constants.ts`** — `U`/`B`/`ABILITIES`/`COVERT`/`STYLES`/`FAC` (incl. `0`=Free Militia, `7`=Free Legion),
  **mutable `AIS`/`ALL_TEAMS` + `EMERGENT_TEAM`/`resetTeams`/`addAITeam`**, `MAP_SCALE`, anchors, tuning numbers, flags.
- **`src/sim/state.ts`** — `GameState`, `createGame`/`resetState`, diplomacy helpers (`game.gate` grid added).
- **`src/sim/types.ts`** — `Unit` (now `stack`, `order:'patrol'`), `Building`, `Relay`, `Settlement` (`unrest`), `Vault`
  (`discBy`), `AIState` (`missileT`/`techT`/`empT`/`hijackT`), `GameState` (`paused`/`speed`/`gate`).
- **`src/sim/mapgen.ts`** — procedural map + resource/settlement/relay/vault placement + water amounts.
- **`src/sim/pathfind.ts`** — A* (`findPath(...,team)`), `passable`, **`passableFor(tx,ty,team)`** (gate‑aware).
- **`src/scene/BattleScene.ts`** — Phaser scene: render/cull, input (mouse+touch+keys), minimap (cached blit),
  `drawSettlements`/`drawOverlay` (selection/HP/chevrons/reticles/dome+patrol rings), `addScorch` (decal pool),
  `makeScorchTexture`/`makeVignette`, mobile zoom, the throttled `update()` loop.
- **`src/render/textures.ts`** — procedural sprites; **`buildTeamTextures(scene,team)`** (per‑team, used for the
  emergent faction) + `buildAllTextures`.
- **`src/render/terrain.ts`** — terrain bake at **`TERRAIN_RES`** (downscaled, `setTransform` so drawing stays
  world‑coord), `paintTree`, `clearForestAt`/`dryWaterAt`.
- **`src/ui/sidebar.ts`** — DOM UI: `makeUI`, `refresh` (130ms), `refreshSel`, `ensureDipUI` (lazy per‑faction
  diplomacy rows — handles team 7), `closeDrawer`, build/unit/ability buttons + gating, COMBINE/PATROL/help/drawer wiring.
- **`src/audio.ts`** — WebAudio SFX + sample loader (`loadSamples`/`playSample`, AAC). **`src/main.ts`** — boot.
  **`index.html`** — single HTML (CSS + markup; mobile drawer CSS, `dvh` heights, overlays, help/intro).
- **`src/assets/`** — CC0 `terrain/*.jpg`, `trees/*.png`, **`audio/*.m4a`** (all inlined `?inline`); `CREDITS.md`.

**Adding things:** a UNIT/BUILDING = add to `U`/`B` + a sprite branch in `textures.ts` + a `buildOrder`/`unitOrder`
entry + icon in `sidebar.ts` (+ `requires`/`alloy`/`wood` fields gate it). A RUNTIME FACTION = `addAITeam` +
`initFactionState` + set `BASE_INFO[t]` + `FAC[t]` + relations + fire the emerge hook to bake textures (see
`emergeFaction`).

---

## 7. Gotchas (carry‑forward + new from Session 3)
- **iOS Safari canvas limits (~16.7MP area / 4096px dim):** a full world‑size canvas (10752² ≈ 115MP) comes back
  **blank/black** on a real iPhone (was the "black map" bug). Keep any full‑map canvas downscaled — terrain bakes at
  `TERRAIN_RES`. Don't add new world‑size canvases without this.
- **Mobile full‑height layout uses `dvh`, not `vh`** — `100vh` sits behind the iOS toolbar and hid the bottom feed.
- **Never `terrainTex.refresh()` (full GPU re‑upload) on a frequent event** — it froze the game on every unit death.
  Scorch is now decal sprites; the only terrain re‑bakes left (forest‑clear/dried‑water) are throttled ~180ms.
- **`nearestHostile(...)` filters by `isWar`, not `!isAllied`** — an unaligned force needs explicit war relations
  (`setRel(t,f,-100)`), which is why team‑0 militia / team‑7 Legion set relations on spawn/emergence.
- **`game.water` IS the coolant stockpile** (legacy name). Coolant consumption is in `waterOf` and now activity‑scaled.
- **Switching git branches reverts the working tree** — re‑Read a file before editing after a `git checkout`.
- **zsh ≠ bash:** `PIPESTATUS` differs (use `cmd; rc=$?`); `cd` doesn't persist between Bash calls (prefix with
  `cd .../Nexus-Command &&`); `wc -c` output has leading spaces.
- **Don't pass negative `t`** to ring/shock particles (breaks radius/alpha math).

---

## 8. Tuning knobs (single numbers Lane may want changed after playing) — **Session 4's main job**
- **Coolant (NEW):** `COOLANT_IDLE` 0.25 (idle‑unit coolant fraction) in `waterOf`; per‑unit `coolant` costs in `U`
  (aircraft 6, walker 4, artillery 3, harrier 3, borer 4); `WATER_CAP` 600; building `water` trickle (hq 5, pump 6,
  watertower 4). If big air pushes still overheat, lower `COOLANT_IDLE` more, raise trickle, or cut `aircraft.coolant`.
- **Patrol (NEW):** `PATROL_R` 12·TILE (guard‑zone radius).
- **Collector‑merge (NEW):** stack scales cargo cap + fill rate + HP ×stack; render scale `1+min(0.9,(stack-1)*0.06)`.
- **Emergent faction (NEW):** `EMERGE_UPRISINGS` 3 (uprisings before the Legion forms); `UPRISING_POP` 26 /
  `UPRISING_TIME` 75s / `MILITIA_CAP` 32; founding money 3500 + alloy 250 + 5‑unit warband (`initFactionState`/
  `emergeFaction`); Legion relations −80 to player+nearest, −15 to the rest. **Most likely Session‑4 tuning target.**
- **Missiles:** `THERMO_R` 440 / cost 9000cr+2500 alloy / cd 360; `NUKE_R` 150; `IDOME_R` 7t / `IDOME_CD` 9s;
  `AEGIS_R` 5.5t / 10s; AI silo/dome build thresholds + `missileT` cadence in `aiUpdate`/`aiTech`.
- **Veterancy:** thresholds 2/5 kills; `vetDmg`/`vetHp` 1.2/1.5; elite self‑repair 4 hp/s.
- **Defense:** Sentinel Turret range 250 (sight 9); Flak range 285 (sight 10); wall hp 1200/cost 70; gate hp 1000/120;
  palisade hp 650/20cr+40wood.
- **Heroes/vaults:** 3 vaults; `DIG_TIME` 18 / `DIG_CR_RATE` 50 / `DIG_AL_RATE` 12; `SURVEY_R` 14t; `AURA_R` 130.
- **Perf throttles:** fog/minimap 70ms; AI loop 0.33s; vision 0.066s; terrain refresh 180ms. AI army cap 34. Mobile
  default zoom 1.7 (`scale.width<760`).

---

## 9. The backlog & how to drive it
`docs/TODO.md` is the living list. **The big‑ticket backlog is essentially built.** What remains (all in `docs/TODO.md`):
- **Balance tuning** — *the_ priority for Session 4, but it needs Lane's playtest data ("X felt too strong/weak"). Best
  first move of the session: ask him what he noticed, then turn the §8 knobs. Likely targets: when/how‑strong the Free
  Legion is; coolant during big air pushes; AI missile/EMP cadence; hero strength.
- **Deeper perf — Web‑Worker sim** — the one deferred big lever. Only worth the rewrite **if late‑game FPS still bites
  on Lane's device** after the Session‑3 perf fixes. Playtest‑gate it.
- **More CC0 audio (optional)** — weapons/UI samples + more explosion variety (pipeline proven; Lane curates by ear).
- **Negotiate‑with‑the‑Legion / deeper civilian diplomacy (optional)** — the Legion already appears in the diplomacy
  panel (gift/trade/ally/war work on it); a proactive "sue for peace" AI is the next step.
- **Optional:** auto‑merge surplus collectors; more superweapons; richer unit sprites; water shimmer; campaign mode.

**Don't pick for Lane** — run the card‑picker (§0). But lead Session 4 by surfacing that the build backlog is done and
**a playtest‑driven balance pass is the highest‑value next move.**

---

## 10. Session 3 changelog (what shipped, newest first)
`575d03f` coolant activity‑scaling + patrol order · `9cdb15e` collector‑merge (mega‑unit) · `8e51386` mobile command
drawer + zoom · `a43aebd` diplomacy UI handles emergent faction · `b2b32ad` continuous wall placement + Timber Palisade
· `444e8a2` Controls/Legend help panel · `e31371a` **full emergent faction (Free Legion, team 7)** · `ad85a00` mobile
feed fix (dvh) · `70f34b2` society depth (capture windfall + militia uprisings) · `3796f61` fix unit‑death freeze
(scorch decals) · `448806f` real CC0 audio (AAC) · `fb70971` fix black map on mobile (terrain canvas downscale) ·
`1fb5ac6` AI parity (water tower + wall/gate front + Hijack) · `d738b8e` team‑aware Blast Gate · `774e708` walls +
pause/speed + klaxon · `0fc52be` AI parity Phase 2 + perf smoothness · `c2747f1` Safari perf fix (throttle fog/minimap)
· `61ffdd8` AI parity Phase 1 (domes/silos/missiles).

⚠ **All Session‑3 work is tsc‑clean + headless‑verified, but the FEEL and on‑device FPS are still unconfirmed** — a real
playtest is the gating next step.
