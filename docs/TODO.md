# NEXUS COMMAND — Living TODO

> **This is the canonical backlog. Keep it updated EVERY task** — check items off when shipped, and add
> new ideas the moment they come up (it will grow as we go).
>
> 🔁 **WORKFLOW RULE (Lane's standing request):** at session start **and after every shipped task**,
> present Lane the **entire current TODO** and let him pick the next task via **multiple-choice cards**
> (the `AskUserQuestion` tool). Keep doing this as the list grows. The tool shows up to 4 cards at once,
> so: put the 3–4 best candidates on cards, and **always also paste the full list (below) in the message**
> so nothing is hidden — Lane can pick a card or name any other item. Then update this file.

Last updated: **2026‑06‑19** (Session 3 — perf + AI parity Phase 1&2 shipped; doing the full list).

---

## ▶ Up next — top candidates (curate to 3–5; these go on the cards first)
- [ ] **More CC0 audio (optional)** — real CC0 **explosions + nuke blast + victory jingle** now ship (see below). Could add real samples for **weapons/UI** too (kept procedural — they fire very fast) + more explosion variety. ⚠ I can't judge sound by ear — Lane curates; swapping a sample = drop a new file in `src/assets/audio/`. **Key enabler learned: `afconvert` on this Mac DOES decode OGG → so OGG CC0 sources can be transcoded to Safari‑safe AAC/M4A.**
- [ ] **Wood‑palisade walls** (optional) — a cheap **wood‑cost** wall/gate variant as a 2nd wood sink (Walls + team‑aware Gates already shipped).
- [ ] **Society layer depth** — make population & settlements actually matter (round‑2 notes #2/#3/#7).
- [ ] **Deeper perf — Web Worker sim** — if late‑game still bites on device, move the sim off the main thread (big architectural change; playtest‑gate it).

## Backlog — Features
- [ ] **Emergent factions** — neutral civilian populations coalesce into a NEW faction that can grow into a real threat (note #3).
- [ ] **Richer settlement absorption / civilian diplomacy** — recruit/adopt populations; absorbing faction gains their infrastructure + resources (note #7).
- [ ] **Explicit per‑unit relay targeting** — click‑target a Command Relay to assault it (currently auto‑assaulted by present military).
- [ ] **Scripted campaign / mission mode** — long‑deferred; the engine favors emergent skirmish, so this is a separate mode.
- [ ] More superweapons / abilities (orbital strike, chrono‑freeze, etc.) — optional.
- [ ] Garrisonable structures / repair‑reload / minelayer / stealth units — optional combat depth.

## Backlog — Art / Audio / Polish
- [ ] **Real CC0 explosion/smoke sprite sheets** on deaths (deferred; harder to verify headlessly than terrain).
- [ ] **Richer unit/building sprites** — procedural upgrade, or CC0 where it maps cleanly (units are small at game zoom → lower verifiability).
- [ ] **Water shimmer / texture pass** — apply the CC0 treatment to water + a moving sheen.
- [ ] UI polish / animations; a tech‑tree or help panel; on‑screen hotkey hints.

## Backlog — Balance & AI
- [ ] **AI parity pass** (also up top) — AI builds domes/silos/wood/repair/water/borer/heroes.
- [ ] **Tuning pass after playtests** — many Session‑2 features are compile‑only; balance once Lane plays.
- [ ] Veterancy tuning (kill thresholds 2/5; dmg/HP factors 1.2 / 1.5; elite self‑repair 4 hp/s).
- [ ] Game‑speed control / pause.

## ⚠ Needs Lane's playtest confirmation (shipped but compile‑verified only)
- [ ] **Missile system feel** — thermonuke base‑wipe, Iron Dome + Aegis interception, AI missile cadence, inbound reticles.
- [ ] **Veterancy** — promotions fire, chevrons render, bonuses feel right.
- [ ] **Hero loop** — Survey Hunter auto‑hunt finds vaults, Borer excavates, the 3 heroes behave (Warden aura heals, Devastator out‑ranges, Titan tanks).
- [ ] **Water harvesting** + dried tiles; coolant abundance.
- [ ] **Turrets/flak** — new range; turrets engaging ground war‑enemies (logic reviewed = sound).
- [ ] **Tree/terrain art** on a real device; late‑game framerate on the 3× maps.

---

## ✅ Shipped in Session 3 (newest first)
- **Real CC0 audio** — real **explosion** (unit/building death) + **nuke blast** + **victory** stinger now play from real public‑domain / CC0 samples (Wikimedia PD explosions + Kenney CC0 jingle), transcoded OGG→mono AAC/**M4A so Safari decodes them**, inlined for the single‑file build (+70KB). New sample‑loader in `audio.ts` (`loadSamples`/`playSample`) decodes on first audio init with **procedural fallback** if a sample isn't ready; nuke layers the sample over a synth sub‑bass. Defeat sting + weapons/UI/EMP/klaxon stay procedural. Verified: all 3 inline as `data:audio/mp4` and decode in‑browser to the right durations. ⚠ sound quality is Lane's ear to judge. Credits in `src/assets/CREDITS.md`.
- **FIX: black map on mobile (iOS)** — the ×3 map baked terrain to a single 10752²≈115MP canvas, which exceeds iOS Safari's ~16.7MP canvas cap → it came back blank/black (UI + units still drew). Now baked at a reduced resolution (`TERRAIN_RES`, ≈3464²=12MP, under the cap) via a persistent scale transform in `terrain.ts` (all drawing stays in world coords; scorch/clear-forest/dry-water hooks included), and the texture is upscaled to world size on display (LINEAR filter). Bonus: ~10× less terrain GPU memory + faster upload on every device. Verified canvas ≤ iOS limits + still renders correctly on desktop; Lane to confirm on iPhone.
- **AI parity — defensive + Hijack**: the AI now builds a **Water Tower**, fortifies its front with **Walls + a Blast Gate** (sparse so it never walls itself in — verified its units can still path out), and casts **System Hijack** to steal an enemy combat unit (pays the cost). With EMP (already shipped) the AI now uses the full cyber kit. Headless‑verified.
- **Blast Gates (team‑aware)** — a doorway in your wall line: your units + allies path through freely, enemies are blocked and route around (or smash it). Done properly via team‑aware pathfinding: new `passableFor(tx,ty,team)` + per‑tile `game.gate` owner grid; `findPath`, `unitBlocked`, movement & separation all thread the unit's team. An enemy gate reads as a wall to you. Verified headlessly (owner path 0‑tile deviation through the gate; enemy detours 7 tiles around).
- **Fortified Walls** — new cheap, tough 1×1 barrier building (`B.wall`, 70cr / 1200hp / no power). Impassable (units path around it automatically — buildings already block via `game.occupied`), sellable, crenellated sprite + sidebar icon. Funnel attackers into your turrets. (Gates + wood‑palisades remain — see Up next.)
- **Pause + game speed** — Space = pause/resume; `[` / `]` (or `-` / `+`) cycle 1×→2×→3×. Implemented as fixed sub‑steps per frame (stable movement/pathing, not one big dt). On‑screen badge + feed messages; resets on new match.
- **Inbound‑missile klaxon** — distinct air‑raid siren SFX (`sfx('klaxon')`) replaces the generic 'war' beep when a missile is inbound at the player. (Full CC0 sample pack still in Up next.)
- **AI parity Phase 2 — AI uses its whole toolbox**: `aiTech` now also builds **Lumber Mill** (→ Loggers + **Repair Rigs** for map‑wide field repair), **Cyber Ops Center**, and **Deep Bore Facility**; the AI trains **Repair Rigs**, **Survey Hunters**, and **Borers**; **hero parity** — AI Hunters survey vaults (per‑team `discBy`, no player fog leak) and idle Borers excavate them, so the AI fields heroes too; and the AI fires **EMP** from a Cyber Ops Center at enemy clusters (pays the cost). Verified headlessly (builds + trains + hero excavation→Titan + EMP all pass). ⚠ feel needs playtest. Leftovers: AI Water Tower + AI Hijack.
- **Performance pass 2 — smoothness**: throttled the **strategic AI loop** to ~3Hz (it re‑scanned every unit per faction every frame) and **player fog recompute** to ~15Hz, both fed accumulated dt so rates stay correct. Combat/targeting/movement stay per‑frame. (Web Worker sim deferred as the next lever if needed.)
- **Performance — Safari lag on the 3× maps**: the per‑frame **fog** and **minimap** passes (each touching all 336²=112,896 tiles every frame) were the bottleneck. Now: both throttled to ~14Hz (vision changes a few×/s, not 60×); fog reuses a persistent buffer with alpha‑only writes (no per‑frame `getImageData` allocation); minimap terrain is a cached ImageData blit instead of up to 112k `fillRect` calls/frame; overlay is viewport‑culled with cached faction colours. ⚠ FPS unmeasurable headlessly (Phaser pauses RAF when backgrounded) — Lane to confirm on device.
- **AI parity Phase 1 — missile/defense counterplay**: the AI now conditionally builds **Iron Domes** + **Missile Silos** (new `aiTech` pass, robust to timing — builds each once as money/alloy allow; warlords reach for the Silo first, others shield up first). AI missile launches are now **gated on owning a Silo**, cost money/alloy, respect a per‑AI cooldown, and escalate to **thermonuclear** when flush — so the player's nuke is no longer an auto‑win and the player's own Iron Dome earns its keep on defense. Verified headlessly (intercept + control + AI‑builds + AI‑launches all pass); ⚠ feel needs Lane's playtest.

## ✅ Shipped in Session 2 (newest first) — detail in `docs/SESSION_3_HANDOFF.md`
- Unit **veterancy** (kills → Veteran/Elite, +dmg/HP, chevrons).
- Survey Hunter **auto‑hunt**; **turret/flak range** buffs.
- **Missile & defense system**: Missile Silo, Thermonuclear Missile (faction‑killer), Iron Dome (building) + Aegis (mobile) interceptors, AI missile launches, inbound warnings.
- **Terrain** improvement (CC0 textures + macro light/shadow); real **CC0 trees**.
- **Underground‑targeting fix**; **water harvesting** + Water Tower + coolant buff.
- **Hero system** (vaults, Survey Hunter, Borer excavation, 3 heroes).
- **Subterranean Borer** + Deep Bore Facility; **harvester tunneling**.
- **Wood logistics**: Logger + Lumber Mill + Repair Rigs (map‑wide auto‑repair).
- **FX/atmosphere polish**: embers, tracers, vignette, motes; topbar chips + mobile topbar fix.
