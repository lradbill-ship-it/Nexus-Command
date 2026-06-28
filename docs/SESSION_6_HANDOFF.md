# NEXUS COMMAND — Session 6 Handoff

> 🟢 **START HERE (first thing, every Session‑6 turn):**
> 1. Read **this file**, then **`docs/TODO.md`** (the living backlog).
> 2. **Present Lane the entire TODO as multiple‑choice cards** (`AskUserQuestion`) and let him pick the next task — see §0. Don't just start building.
> 3. After each shipped task: update `docs/TODO.md`, then show the full list as cards again.
>
> Older per‑feature detail: `docs/SESSION_5_HANDOFF.md` → `SESSION_4/3/2`. Original v1 mission/spec: `CLAUDE.md`.
> Written at the end of **Session 5 (2026‑06‑27/28)**. Everything below is live on `main` + the gh‑pages link.

---

## 0. 🔁 THE WORKFLOW RULE (Lane's standing request — do this every task)

**At session start and after every shipped task:** update `docs/TODO.md`, then present Lane the **entire current
todo list** and let him **pick the next task with multiple‑choice cards** (`AskUserQuestion`, max 4 options → put the
3–4 best candidates on cards, recommended first, AND paste the full TODO in the message). 

- **Exception — delegation:** when Lane says **"keep going" / "do it all" / "all of it" / "Cartman?" (his go‑ahead
  shorthand),** he's delegating — work through verifiable increments, **shipping + deploying each**, without re‑asking
  per item. Still update `docs/TODO.md` after each. Surface a brief checkpoint after a big batch.
- **Ask‑first (per `CLAUDE.md`):** faction design, diplomacy rules, pacing/balance targets.
- **CONTEXT BUDGET — don't assume it.** Session 5 the assistant over‑estimated usage and pushed to wrap early; Lane
  said "we're at 23%." **Ask Lane the real % before any wrap decision** rather than guessing from how much you've done.

---

## 1. One‑paragraph orientation

NEXUS COMMAND is a Command & Conquer–style RTS: **TypeScript + Phaser 3 (WebGL) + Vite**, browser, single self‑
contained HTML, no backend. 6 regional factions **+ a 7th that emerges mid‑match (the Free Legion)**; 4 harvested
inputs (crystal=currency, coolant, alloy, wood) + power; a civilian society layer (population/settlements/uprisings →
emergent faction) **now with peaceful Envoy diplomacy + town development**; government; Command Relays; a subterranean
layer (Borer, hero vaults); a missile/defense layer (silos, thermonuke, orbital, **carpet bomb**, Iron Dome,
**Shield Projector**); walls/gates; veterancy; patrol; collector‑merge; stealth; minefields; garrison; **APC transport**;
**deployable Sentry Pod**; **Chrono Freeze**; **special characters (Cartman/Kenny/Stan/Kyle)**; ceasefires. **Win/lose =
annihilation only (in skirmish).** **NEW: a whole CONQUEST CAMPAIGN metagame** (a world map you conquer region‑by‑region,
battles launched per territory, AI incursions, carry‑over War‑Tech upgrades). **The feature set is very deep — Session 6
is best driven by Lane's playtest** (balance + battlefield feel/FPS), plus optional polish/features.

---

## 2. Where everything lives

| | |
|---|---|
| **Repo (origin)** | `https://github.com/lradbill-ship-it/Nexus-Command` — Lane's account. Commit straight to `main`. |
| **Live game** | **https://lradbill-ship-it.github.io/Nexus-Command/** (GitHub Pages, `gh-pages` branch) |
| **Local clone** | `/Users/Lane-DDABBER/Claude/Nexus-Command` |
| **Backlog / docs** | `docs/TODO.md` (living) · this file · `docs/SESSION_5_HANDOFF.md` (+ 4/3/2) · `CLAUDE.md` |
| **⚠ DO NOT TOUCH** | Lane's separate trading project (`rainyday-readonly`, port 8099). Keep Nexus isolated. |
| **Preview servers** | `nexus-dev` (vite dev :5173) · `nexus-dist` (serves `dist-single/` :4173). **⚠ These live in the PROJECT‑ROOT `/Users/Lane-DDABBER/Claude/.claude/launch.json`** (the preview tool reads THAT one). If `preview_start('nexus-dev')` ever launches the trading server, re‑add the nexus entries there. |

`main` tip at wrap: **`75f6793`**. Live link in sync.

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
Then poll: `curl -s -o /dev/null -w '%{size_download}' '<live-url>?cb=$RANDOM'` until it equals
`wc -c < dist-single/index.html` (CDN lag ~1–2 min; tell Lane to hard‑refresh).

### ⚠ Verification workflow (order: tsc clean → headless test → build:single → check artifact boots → deploy → propagation)
1. **Headless sim tests = a standalone test page** (single module graph): write `src/dev_*_test.ts` (import `state`/
   `sim`/`mapgen`/`conquest`; reset/setup; run `stepWorld`/drive flow; assert; stamp `window.__TESTOUT`), a tiny root
   `*_test.html` that imports it, navigate the **`nexus-dev`** preview to an **absolute** `http://localhost:5173/x_test.html?cb=…`,
   read `__TESTOUT`. **Delete the temp files after** (Session 5 wrote ~6, all deleted).
2. **The backgrounded headless preview pauses Phaser's RAF** → the battle canvas is BLACK, UPTIME 00:00, scene never
   boots. So you can verify **logic + clean boot + DOM**, but **battlefield feel / FPS / render‑look are Lane's device
   call.** Every FX/render change ships behind tsc‑clean + bundle‑clean + no‑console‑errors.
3. **DOM is fully verifiable** — the sidebar/HUD/intro/help AND the **whole Conquest layer** (it's DOM/SVG, not Phaser).
   Drive it with `dispatchEvent(new MouseEvent('click'))` on `.terr[data-id]` nodes and **screenshot it.** (Screenshot
   verification caught a dropped CSS rule in Session 5 before it shipped — use it for UI polish.)
4. **Verify the actual single‑file artifact before deploy** (`preview_start nexus-dist` → `#startBtn` →
   `preview_console_logs` level error, expect none).

---

## 4. Conventions (don't relitigate)
- **Stay on Phaser 3.** Commit straight to `main` + deploy, no PRs. Verify the single‑file artifact before deploy.
- **Optimize DESKTOP for real play; keep MOBILE demo‑able, not full‑parity.**
- **Give new systems to the AI too** (parity) — every Session‑5 unit/ability/building/character is AI‑parity'd.
- **Ask Lane before changing faction design, diplomacy rules, or pacing/balance.** Run the card‑picker (§0).

---

## 5. Full system inventory (NEW in Session 5 in **bold**)

**Economy & world:** 6 factions; crystal/coolant/alloy/wood + power; 3× maps; CC0 terrain/trees; water shimmer;
settlements; Command Relays. **Civilian diplomacy: the ENVOY (unarmed) courts neutral towns via affinity → peaceful
annexation; owned towns DEVELOP through 3 tiers (invest crystals → richer yields: crystal→coolant→alloy + a local guard).**

**Diplomacy & society:** relations/trade/alliance/gift/war; sue‑for‑peace/ceasefires; population/happiness; leaders;
elections & coups; uprisings → the **Free Legion** (emergent team 7).

**Units:** harvester/tanker/hauler/logger/repair/aegis, recon, hunter, infantry/rocket/strike/artillery/walker,
harrier/aircraft, borer, 3 vault heroes, militia, spectre, **envoy**, **APC transport** (loads infantry, U to unload),
**Sentry Pod** (Y to deploy ⇄ turret), and **special characters Cartman / Kenny / Stan / Kyle** (one per faction,
Cyber‑gated). Veterancy; tunneling; collector‑merge.

**Buildings:** hq/power/refinery/foundry/turret/wall/gate/palisade/pump/watertower/smelter/mill/habitat/market/aaturret/
idome/cyber/silo/drillbay, **+ Shield Projector** (absorbs 50% of incoming damage to nearby allies from a recharging
reserve). Garrisonable buildings.

**Combat & special:** turrets + waves + fog + air; EMP/Hijack/Overcharge/Minefield; **Chrono Freeze** (freeze enemies
in a zone 6s); Ballistic/Thermonuclear/Orbital + **Carpet Bomb** (a line of uninterceptable blasts); Iron Dome + Aegis;
Borer; hero vaults; patrol. **Hit‑flash on damage + weightier death explosions.**

**🗺️ CONQUEST CAMPAIGN (the big new mode — `src/conquest.ts`, DOM/SVG):** intro "⚔ CONQUEST CAMPAIGN" button → a world
of 12 territories (player + 5 AI homes + neutrals, adjacency graph). Select an owned ★ territory → invade a bordering
region → launches the normal skirmish for it; win captures it. **AI incursions** force DEFENSE battles (lose → you lose
ground). **War‑Tech** (+1/win, +8%/level army HP & damage, persistent). +600cr/territory reinforcement. Persists to
localStorage. Win = own all 12. Celebratory victory/defeat screens.

**UX/polish:** restart, no edge‑scroll, pan/minimap, control groups, sell/cancel, auto‑scout, rally, pause+speed,
Controls/Legend help, mobile drawer, COMBINE/PATROL, queue badges/cooldowns, order markers, feed‑click‑to‑locate,
**glowing intro title + tactile buttons + glow‑up Conquest map**.

---

## 6. Architecture map (key files; NEW in **bold**)
- **`src/sim/sim.ts`** (~2.8k lines) — the sim. `stepWorld(dt)` → the tick subsystems (settlement/militia/relay/vault/
  government/autoScout/stealth/mine/**respawn**/strikes/society/diplomacy + per‑unit/building). Combat (`fireAt`/`damage`
  /`destroy`/`nearestHostile`), movement, `issueOrder` (the big right‑click router: attack/move/guard/enter‑garrison/
  **board‑transport**/dig/relay/settlement‑recruit/**envoy‑court**), `castAbility` (+ **chrono**/**carpet**), `aiUpdate`/
  `aiTech` (+ parity for every new system incl. **envoy/transport/sentrypod/shieldgen/special‑characters**). NEW helpers:
  `applyShield`, `chronoFreeze`, `launchCarpet`/`detonateCarpet`, `enterTransport`/`unloadTransport`, `toggleDeploy`,
  `authoritahTick` (Cartman), `rallyTick` (Stan), `respawnTick`/`queueRespawn` (Kenny), `setCampaignBuffs` (War‑Tech).
  **PERF: `rebuildUnitGrid` reuses cell arrays (no per‑frame alloc); `separation` is closure‑free.** Module state resets
  in `resetSimLocals()`.
- **`src/conquest.ts`** (NEW, self‑contained) — the Conquest metagame: world model, SVG render, battle hooks
  (`setLaunchBattle`/`onBattleEnd`/`isInCampaignBattle`), War‑Tech (`campaignTech`/`campaignTechMul`), persistence.
- **`src/main.ts`** — boot. Routes battle‑end to the campaign when a campaign battle is live; `setLaunchBattle` bridge
  applies the reinforcement bonus + `setCampaignBuffs(War‑Tech)` after `newMatch`; wires the CONQUEST button.
- **`src/sim/constants.ts`** — `U`/`B`/`ABILITIES`/`FAC`/`STYLES`, flags (incl. NEW `diplomat`/`transport`/`capacity`/
  `deployable`/`unique`/`authoritah`/`respawns`/`rallyAura`; `BuildingDef.shield`). `ABILITIES` auto‑wires its buttons.
- **`src/sim/types.ts`** — `Unit`/`Building` (NEW fields: `courtId`/`cargoUnits`/`authT`/`hitT`; `Building.fromPod`/
  `shieldE`/`hitT`; `Settlement.affinity`/`dev`), `AIState` (`envoyT`/`chronoT`), `Strike` kind `'carpet'`.
- **`src/scene/BattleScene.ts`** — Phaser scene: render/cull, input (keys incl. U/Y/Z/X), minimap, `drawOverlay`,
  `drawSettlements` (+ **shield‑field dome**), `drawFx`, `syncUnit` (**hit‑flash** + overcharge tint + stealth).
- **`src/render/textures.ts`** (sprites incl. envoy/transport/sentrypod/cartman/kenny/stan/kyle/shieldgen) ·
  **`src/ui/sidebar.ts`** (build/unit/ability lists + icons) · **`src/audio.ts`** · **`index.html`** (CSS + intro + help).

**Adding things:** UNIT = `U.x` (+ flags) + `textures.ts` sprite + `unitOrder` in `sidebar.ts` + AI pick + render.
ABILITY = `ABILITIES.x` (auto‑button) + `castAbility` branch + key in `BattleScene` + (strike) a `Strike` kind +
detonate + AI parity. CHARACTER = `U.x` (+ `unique`/`hero` + a signature flag) + behaviour tick + sprite + sidebar +
the AI special‑pick list. BUILDING = `B.x` + `buildOrder` + icon + sprite + (effect hook) + `aiTech` parity.

---

## 7. Gotchas (carry‑forward + new from Session 5)
- **PERF: never reallocate per‑frame** — the spatial grid reused its cell arrays (was ~15k allocs ×2/frame → GC stutter).
  Keep hot per‑frame loops allocation‑free (no closures in `separation`, no `new Array`/`Set` per frame).
- **NEVER `setPath` a ground unit to a solid/occupied tile** (building centre) — A* thrashes. Path to `freeSpotNear` +
  give failed‑approach orders a timeout (`'enter'`/`'board'` handlers).
- **Cap any entity the AI spawns unbounded** (mines: `MINE_GLOBAL_CAP` 240).
- **iOS Safari canvas ≤ ~16.7MP / 4096px**; mobile full‑height uses `dvh`; never `terrainTex.refresh()` on a frequent event.
- **`nearestHostile` filters by `isWar`, not `!isAllied`** — unaligned/special targeting needs explicit war relations.
- **`game.water` IS the coolant stockpile** (legacy name). **Switching git branches reverts the working tree** — re‑Read
  before editing after `git checkout`. **zsh:** prefix Bash with `cd .../Nexus-Command &&`; `wc -c` → `tr -d ' '`.
- **Unarmed units (envoy/transport/sentrypod) need their own `updateUnit` branch** — else the generic combat path calls
  `fireAt(d.dmg!)` → NaN. **`unique` characters: the train cap must also honour pending respawns** (Kenny).
- **Conquest is DOM** → fully testable/screenshot‑able. A standalone dev test page lacks `index.html`'s CSS, so
  panelBox content looks unstyled there — that's expected; it's styled in‑game.

---

## 8. Tuning knobs — **the main job of a balance pass**
- **Civilian diplomacy:** `AFFINITY_JOIN` 100 · `AFFINITY_COURT` 6.5 · `AFFINITY_DECAY` 2.0 · `DEV_MAX` 3 · `DEV_BASE` 0.05 · `DEV_ENVOY` 0.12 · `DEV_COST` 1.1 · `DEV_POP_CAP` 60.
- **Chrono Freeze:** `CHRONO_R` 200 · `CHRONO_DUR` 6 · cost 1500/cd 130. **Carpet Bomb:** `CARPET_COUNT` 7 · `CARPET_SPACING` 78 · `CARPET_R` 112 · cost 2600+200 alloy/cd 170.
- **APC Transport:** capacity 5 · cost 500. **Sentry Pod:** cost 360 → deploys a `turret`. **Shield Projector:** `SHIELD_R` 6·TILE · `SHIELD_ABSORB` 0.5 · `SHIELD_MAX` 1200 · `SHIELD_REGEN` 45 · cost 950+200 alloy.
- **Special characters:** Cartman `authoritah` 130 / `AUTHORITAH_CD` 13 / `_DUR` 3 / 660hp · Kenny `respawns` 18 / 90hp · Stan `rallyAura` 150 · Kyle `auraHeal` 14. All 1/faction, Cyber‑gated.
- **Conquest:** `BONUS_PER` 600 · `TECH_MAX` 6 · `TECH_STEP` 0.08 · AI incursion chance 0.55/turn · AI neutral‑grab 0.5/turn · 12 territories.
- **Carried from S4:** sue‑for‑peace, spectre, orbital, overcharge, minefield, garrison, settlements, Free Legion, coolant, missiles/defense, veterancy, heroes, perf throttles (fog/minimap 70ms · AI 0.33s · vision 0.066s) — see `docs/SESSION_5_HANDOFF.md` §8.

---

## 9. The backlog & how to drive it (`docs/TODO.md` is the living list)
**Session 5 shipped ~18 increments — an entire epic (Conquest, with incursions + War‑Tech) + 4 combat toys + Shield
Projector + civilian diplomacy + the South Park boys + a measured perf pass + a full verifiable‑UI polish sweep.**
What remains / best next moves:
- **🎯 PLAYTEST‑DRIVEN BALANCE + FEEL — the #1 move.** The toolbox is enormous and ALL of Session 5 is unplaytested.
  Ask Lane what felt off (special‑character strength, Conquest pacing/incursion frequency, War‑Tech snowball, Shield
  Projector balance, Chrono/Carpet cost) → turn the §8 knobs. Also **battlefield FPS on his device** (sim is now fast;
  render is the only unmeasured piece).
- **Conquest depth (slices):** defender‑tailored battles (the battle reflects the defending faction + territory
  strength); carry‑over unit veterancy (beyond credits/War‑Tech); mission‑objective variants per territory; map variety.
- **More combat depth / characters:** repair‑reload, cloak‑field, EMP‑grenade, Arc/Tesla tower; more special characters
  (Butters/Randy/Chef…) via the established pattern; a character team‑up synergy buff.
- **Polish (continuous):** battlefield visuals need LANE'S EYES (render is RAF‑gated headless) — have him direct it.
  More verifiable UI is largely done. Audio (by‑ear).
- **Web‑Worker sim:** 🛑 HELD — the sim is now very fast (perf pass), so this is unwarranted unless Lane's device FPS
  bites specifically on render.

**Don't pick for Lane — run the card‑picker (§0).** Lead Session 6 by surfacing that a playtest‑driven balance/feel
pass is the highest‑value move now that the toolbox is overflowing.

---

## 10. Session 5 changelog (newest first)
`75f6793`+`faccb37` Conquest victory/defeat screen polish · `7b9434f`+`7e9800c` UI chrome (title accent + tactile
buttons) · `c6d249f` weightier death explosions · `d6ce36e` combat hit‑flash + punchier impacts · `f606435` **PERF:
killed GC stutter spikes** (grid reuse + closure‑free separation) · `7b15a53` Conquest map glow‑up · `9a4b6f0` Conquest
War‑Tech carry‑over upgrades · `bc5717c` Conquest real stakes (AI incursions + defense) · `5a1a37b` **Conquest Campaign
(slice 1)** · `409ea25` Kenny/Stan/Kyle special characters · `0601918` Cartman · `2b1e1a8` Shield Projector · `df2c7be`
APC Transport + Sentry Pod · `3322746` Chrono Freeze + Carpet Bomb · `d0df3b4` civilian diplomacy (Envoy + affinity +
development). (Each tsc‑clean + headless/DOM‑verified + deployed; AI parity on every new system.)

⚠ **All Session‑5 work is tsc‑clean + headless/DOM‑verified + boots clean, but FEEL / balance / on‑device FPS are
Lane's playtest call.** A playtest‑driven balance/feel pass is the gating next step.
