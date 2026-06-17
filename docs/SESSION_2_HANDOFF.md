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

**Immediately pending — promised to Lane, not yet built (from his last batch):**

1. **Repair units** — mobile rigs that heal friendly **units and buildings**. Plan: a new unit (e.g. `repair`) with no weapon; reuse the **guard order** (a repair rig "guarding" a unit follows + heals it) + auto‑seek the nearest damaged friendly when idle; heal HP/sec, cost a resource. Add `repair?:boolean` to `UnitDef`, a behavior branch in `updateUnit`, a `nearestDamagedFriendly` helper, sprite + icon.
2. **Wood / tree‑clearing + a novel wood use** — a **Logger** unit that harvests & **clears forest tiles** (`T_FOREST` → passable, which also opens new routes) for a new **wood** resource. **Planned novel use: wood is the field‑repair material** that fuels the repair rigs above (clear forests → wood → repairs) — ties the two asks into one logistics loop. (Alt ideas Lane floated: palisade walls, faster construction. Confirm with Lane before building.)

**Big remaining roadmap item:**

3. **#9 Naval / oceans** — the last item from Lane's original 10. Add ocean terrain on the big maps + sea units for **combat, transport, and harvesting (oil + fish as sea resources)**. Depends on the 3× maps (done). This is a large, multi‑part feature — scope it with Lane.

**Continuous:**

4. **#10 Polish** — Lane wants it "much better looking & functioning." Biggest visual win = **real CC0 art assets** (Kenney.nl / OpenGameArt) replacing the procedural canvas sprites, + Phaser lighting/particles. Lane has noted wanting UI polish interleaved with features.

**Smaller follow‑ups noted during Session 1:**
- Dedicated **Missile Silo** building (the nuke is currently gated on the Cyber Ops Center as a v1).
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
