# NEXUS COMMAND — Session 3 Handoff

> 🟢 **START HERE (first thing, every Session‑3 turn):**
> 1. Read **this file**, then **`docs/TODO.md`** (the living backlog).
> 2. **Present Lane the entire TODO as multiple‑choice cards** (`AskUserQuestion`) and let him pick the next task — see §0. Do NOT just start building; let him choose.
> 3. After each shipped task: update `docs/TODO.md`, then show the full list as cards again.
>
> Deeper per‑feature detail lives in `docs/SESSION_2_HANDOFF.md`. The original v1 mission/spec is in `CLAUDE.md`.
> Written at the end of Session 2 (2026‑06‑19). Everything below is live on `main` + the gh‑pages link.

---

## 0. 🔁 THE WORKFLOW RULE (Lane's standing request — do this every task)

**At session start and after every shipped task:** update `docs/TODO.md`, then present Lane the **entire current
todo list** and let him **pick the next task with multiple‑choice cards** (`AskUserQuestion`). Keep doing this as
the list grows, task by task.

- The card tool shows **max 4 options per question**. So: put the **3–4 best candidates on cards**, and **also paste
  the full TODO list in the message text** so nothing is hidden. Lane picks a card or names any other item.
- Treat the cards as a *picker*, not a survey — one question, "What should we tackle next?", recommended option first.
- This is a hard preference. Even if you think you know what's next, **ask via cards.**

---

## 1. One‑paragraph orientation

NEXUS COMMAND is a Command & Conquer–style real‑time strategy game: **TypeScript + Phaser 3 (WebGL) + Vite**, runs
in a browser, no backend, ships as a single self‑contained HTML. 6 regional‑coalition factions; **4 harvested inputs**
(crystal = currency, coolant, alloy, **wood**) + power; a civilian society layer (population/happiness/settlements);
government (leaders/elections/coups); Command Relays for map control; a subterranean layer (tunneling harvesters,
the Borer, hero vaults); a missile/defense layer (silos, thermonuke, Iron Dome); and **unit veterancy**.
**Win/lose = annihilation only.** It's deep — most systems are built; Session 3 is balance, AI parity, art/audio, and
new features off the backlog.

---

## 2. Where everything lives

| | |
|---|---|
| **Repo (origin)** | `https://github.com/lradbill-ship-it/Nexus-Command` — Lane's account. Commit straight to `main`. |
| **Live game** | **https://lradbill-ship-it.github.io/Nexus-Command/** (GitHub Pages, `gh-pages` branch) |
| **Local clone** | `/Users/Lane-DDABBER/Claude/Nexus-Command` |
| **Old repo** | `grodoctor-tech/Nexus-Command` (the friend's; kept only as the `grodoctor` remote — don't push there) |
| **Backlog** | `docs/TODO.md` (living) · **Session‑2 detail** `docs/SESSION_2_HANDOFF.md` · v1 spec `CLAUDE.md` |
| **⚠ DO NOT TOUCH** | Lane's **separate trading project** (`Rainy-Day` / the `invest-static` & `rainy*` preview servers / port 8097/8099). Keep Nexus isolated. |

---

## 3. Run / build / **DEPLOY** (read the gotchas — they bit us)

```bash
npm install
npm run dev            # vite dev server on :5173 (HMR)
npm run build:single   # tsc --noEmit && vite build --mode single → dist-single/index.html  (the deploy artifact)
```

**Deploy = manual, no CI.** Build the single file, copy onto `gh-pages`, push:
```bash
cd /Users/Lane-DDABBER/Claude/Nexus-Command
npm run build:single
WT=/tmp/nexus-ghpages
git fetch origin gh-pages -q
git worktree remove "$WT" --force 2>/dev/null; rm -rf "$WT"
git worktree add -B gh-pages "$WT" origin/gh-pages -q
cp dist-single/index.html "$WT/index.html"
git -C "$WT" add index.html && git -C "$WT" commit -q -m "Deploy: <what>"
git -C "$WT" push origin gh-pages
git worktree remove "$WT" --force
```

### ⚠ Verification gotchas (both learned the hard way in Session 2)
1. **Verify the actual single‑file artifact before deploy — the dev server is NOT the same.** Vite HMR has a split
   module graph and masked nothing‑yet, but *deploy what you tested*. There's a **`nexus-dist`** entry in
   `.claude/launch.json` that serves `dist-single/` on **:4173** (`python3 -m http.server 4173 --directory dist-single`).
   Workflow: `build:single` → `preview_start nexus-dist` (or reload it) → `preview_console_logs` (errors) + a
   `preview_screenshot` (intro renders) → THEN deploy. **The headless preview now renders the WebGL canvas** (terrain,
   units, HQ all visible) — so UI/layout/art *is* screenshot‑verifiable. Sim/combat *behaviour* (interception, kills,
   excavation) still needs Lane's playtest.
2. **GitHub Pages propagation lag:** after pushing `gh-pages`, the live CDN serves the **old** file for ~1–2 min, then
   flips. A "live link isn't working" right after a deploy is almost always this. Confirm by polling
   `curl -s -o /dev/null -w '%{size_download}' '<url>?cb=$RANDOM'` until the byte size matches the new build, and tell
   Lane to hard‑refresh.

**Asset pipeline (proven):** real CC0 assets download + integrate fine. `curl` a CC0 pack (ambientCG zips,
archive.org Kenney packs) → `unzip` → `sips -Z <px>` to downscale → put under `src/assets/...` → import with
**`?inline`** (base64‑embeds into the single file; declared in `src/vite-env.d.ts`) → load via `BattleScene.preload`.
Record sources in `src/assets/CREDITS.md`. Network egress works in this sandbox.

---

## 4. Conventions (don't relitigate)
- **Stay on Phaser 3.** Engine swaps were considered & rejected; graphics ceiling = assets, perf ceiling = optimization.
- **Commit straight to `main`** + deploy. No PRs (no reviewer).
- **Verify the single‑file artifact (§3) before deploy.** Compile‑clean + boots + no console errors is the gate; sim
  behaviour → Lane playtests.
- **New Session‑2 systems are PLAYER‑ONLY by default** (wood/repair, borer/heroes, water towers, missiles/domes). Giving
  the AI parity is a top backlog item — do it deliberately, not by accident.
- **Ask Lane before changing faction design, diplomacy rules, or pacing targets** (per `CLAUDE.md`).
- Keep `docs/TODO.md` current and run the **card‑picker workflow (§0)**.

---

## 5. Full system inventory (what's built, Sessions 1–2)

**Economy & world:** 6 factions; harvested crystal/coolant/alloy + the new **wood**; power; 3× larger maps
(`MAP_SCALE=3`); procedural terrain (rivers/lakes/rock/forest/roads) with **real CC0 ground textures + macro
light/shadow** and **real CC0 tree sprites**; crystal regen; **water harvesting** (Water Tower → tankers drain
rivers/lakes which **dry to dirt**); neutral **settlements** (recruit/persuade/intimidate, pay income); **Command
Relays** ("shoot‑it" capture, income+vision).

**Society & government:** population/happiness, conscription, desertion; leader doctrines; elections & coups.

**Units:** harvester/tanker/hauler/**logger**/**repair**/**aegis**, recon, **survey hunter** (auto‑hunts vaults),
infantry/rocket/strike/artillery/walker, harrier/aircraft, **borer**, and 3 excavated **heroes** (titan/devastator/warden).
**Veterancy:** kills → Veteran/Elite (+dmg/HP, chevrons). **Harvester tunneling** (phase through terrain).

**Buildings:** hq/power/refinery/foundry/turret/pump/**watertower**/smelter/**mill**/habitat/market/aaturret/**idome**/cyber/**silo**/**drillbay**.

**Combat & special:** turret aim + waves + fog + air layer; covert ops; EMP/Hijack; **Ballistic + Thermonuclear
missiles** (gated on the **Missile Silo**); **Iron Dome** building + **Aegis** mobile unit intercept incoming missiles;
**AI lobs missiles late‑game**; inbound‑missile warning reticles. **Subterranean Borer** (phases terrain, hits
underground units, excavates hero vaults). **Hero vaults** buried in mountains.

**UX:** restart, no edge‑scroll, WASD/minimap pan, control groups, sell/cancel, auto‑scout toggle, rally points,
mobile/touch controls + responsive layout (topbar wraps on phones), the C&C metal sidebar with build/fabricate/ability
tabs + diplomacy/government panels.

---

## 6. Architecture map (key files)
- **`src/sim/sim.ts`** (~1.8k lines) — the whole simulation: `stepWorld(dt)`, `updateUnit`/`updateBuilding`,
  movement (`followPath`/`stepToward`/`phasing`), `updateHarvester`/`updateLogger`/`updateRepair`,
  `settlementTick`/`relayTick`/`vaultTick`/`societyTick`/`governmentTick`, combat (`fireAt`/`damage`/`destroy`/
  `nearestHostile`), **veterancy** (`creditKill`/`promote`/`vetDmg`), **missiles** (`castAbility`/`processStrikes`/
  `detonateNuke`/`detonateThermo`/`tryIntercept`), `issueOrder`, `aiUpdate`, spatial grid. Renderer/UI via hooks
  (`setScorchHook`/`setEndHook`/`setClearForestHook`/`setDryWaterHook`).
- **`src/sim/constants.ts`** — `U`/`B`/`ABILITIES`/`COVERT`/`STYLES`/`FAC`, `MAP_SCALE`, anchors, tuning numbers, flags.
- **`src/sim/state.ts`** — `GameState`, `createGame`/`resetState`, diplomacy helpers.
- **`src/sim/types.ts`** — `Unit`/`Building`/`Relay`/`Settlement`/`Vault`/`Shot`/`GameState`.
- **`src/sim/mapgen.ts`** — procedural map + resource/settlement/relay/vault placement + water amounts.
- **`src/sim/pathfind.ts`** — A* (`findPath`, `passable`).
- **`src/scene/BattleScene.ts`** — Phaser scene: render/cull, input (mouse + touch), minimap, `drawSettlements`
  (settlements/relays/vaults), `drawOverlay` (selection/HP/chevrons/inbound reticles/dome rings), `makeVignette`,
  `preload` (CC0 assets), the `update(dt)` loop.
- **`src/render/textures.ts`** — procedural sprites (`unitCanvas`/`buildingCanvas`/`barrelCanvas`/icons).
- **`src/render/terrain.ts`** — terrain bake (`renderTerrain`, CC0 texture overlay + macro shading), `paintTree`
  (CC0 sprites), `clearForestAt`/`dryWaterAt` repaint hooks, `setTerrainTextures`/`setTreeTextures`.
- **`src/ui/sidebar.ts`** — all DOM UI: `makeUI`, `refresh` (130ms), `refreshSel`, build/unit/ability buttons + gating.
- **`src/audio.ts`** — WebAudio SFX. **`src/main.ts`** — boot. **`index.html`** — single HTML (CSS + markup).
- **`src/assets/`** — CC0 `terrain/*.jpg` + `trees/*.png` (inlined `?inline`); `CREDITS.md`.

How to add a UNIT / BUILDING / RESOURCE / gated unit/ability: see `docs/SESSION_2_HANDOFF.md` §5 + the `requires`
(building prereq) + `alloy` ability/unit fields and `hasBuilding()`.

---

## 7. Gotchas
- **Headless preview pauses sim only when backgrounded** — but in Session 2 the canvas DID render (terrain/units
  visible). Still: combat/sim *behaviour* (kills, interception, excavation, AI missiles) needs Lane's playtest.
- **Switching git branches reverts the working tree** — re‑Read a file before editing after a checkout.
- **zsh `PIPESTATUS`** differs from bash — use `cmd > log 2>&1; rc=$?`.
- **`cd` doesn't persist** reliably between Bash tool calls — prefix build commands with `cd .../Nexus-Command &&`.
- **Mobile topbar** wraps (`flex-wrap` + `min-height`) so it doesn't overflow into the sidebar at ≤375px.
- **Don't pass negative `t`** to ring/shock particles (breaks the radius/alpha math) — use separate particles instead.

---

## 8. Tuning knobs (single numbers Lane may want changed after playing)
- Missiles: `THERMO_R` 440 / cost 9000cr+2500 alloy / cd 360; `NUKE_R` 150; `IDOME_R` 7t / `IDOME_CD` 9s; `AEGIS_R`
  5.5t / 10s; AI launch rate (`dt*0.006` warlord, `0.003` else, after t>540).
- Veterancy: thresholds 2/5 kills; `vetDmg`/`vetHp` 1.2 / 1.5; elite self‑repair 4 hp/s.
- Defense: Sentinel Turret range 250 (sight 9); Flak range 285 (sight 10).
- Heroes/vaults: 3 vaults; `DIG_TIME` 18 / `DIG_CR_RATE` 50 / `DIG_AL_RATE` 12; `SURVEY_R` 14t; `AURA_R` 130.
- Wood/water/repair: `CHOP_TIME` 2.6 / `WOOD_PER_TILE` 50; `waterAmt` 700/tile; `REPAIR_RATE` 34 / `WOOD_PER_HP` 0.05.
- Map/perf: `MAP_SCALE` 3; AI army cap 34.

---

## 9. The backlog & how to drive it
`docs/TODO.md` is the living list. Top candidates right now: **AI parity (domes/silos so thermonuke has counterplay)**,
**real CC0 audio**, **defensive structures (walls/gates)**, **society‑layer depth**. But **don't pick for Lane** — run
the card‑picker workflow (§0) and let him choose, updating `docs/TODO.md` as you go.
