# NEXUS COMMAND — Living TODO

> **This is the canonical backlog. Keep it updated EVERY task** — check items off when shipped, and add
> new ideas the moment they come up (it will grow as we go).
>
> 🔁 **WORKFLOW RULE (Lane's standing request):** at session start **and after every shipped task**,
> present Lane the **entire current TODO** and let him pick the next task via **multiple-choice cards**
> (the `AskUserQuestion` tool). Keep doing this as the list grows. The tool shows up to 4 cards at once,
> so: put the 3–4 best candidates on cards, and **always also paste the full list (below) in the message**
> so nothing is hidden — Lane can pick a card or name any other item. Then update this file.

Last updated: **2026‑06‑19** (end of Session 2).

---

## ▶ Up next — top candidates (curate to 3–5; these go on the cards first)
- [ ] **AI parity / counterplay** — the AI should build & use the Session‑2 systems (esp. **Iron Domes** + **Missile Silos**, so the player's thermonuke isn't an auto‑win; also wood/repair, water towers, borer/heroes). Today they're all player‑only.
- [ ] **Real CC0 audio** — swap the procedural SFX for real CC0 sound: explosions, weapons, UI, and an **inbound‑nuke klaxon**. Original hard‑requirement #5 ("PS5‑level sound"). Download pipeline is proven. ⚠ can't verify by ear headlessly.
- [ ] **Defensive structures** — walls / gates / sandbags to shape chokepoints and make base defense deliberate.
- [ ] **Society layer depth** — make population & settlements actually matter (round‑2 notes #2/#3/#7).

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
