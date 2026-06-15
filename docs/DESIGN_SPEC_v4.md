# NEXUS COMMAND — v4 "Living World" Design Spec

**Status:** Draft for owner review. Direction green-lit by Lane on 2026-06-15.
**Supersedes nothing** — extends the shipped v3.1 build (branch `feature/lane-wishlist-a-b`, PR #2).
**Read order for the next dev:** `CLAUDE.md` → `docs/DESIGN_SPEC.md` (v1 systems) → this file.

---

## 0. Where this came from

Lane reviewed the v3.1 build and answered the open questions. His decisions (verbatim intent):

| Ref | Decision |
|---|---|
| **A** | Go the society/government direction **and** add maps, units, missions. Population is **flavor/economy, NOT a win condition** — but the player must be able to **use the population to their advantage**. |
| **B** | Target **~1-hour matches**, achieved by **adding more to do** (not by slowing the economy). |
| **C** | Keep coolant as a resource, but make it **harvested** with a **new type of harvester** (not passively generated). |
| **D₁** | Make **aircraft scarier**. |
| **D₂** | **Fight over all resources**; **all resources tradeable**; **spawns are rich in some resources and poor in others** → forces exploration & conquest. |
| **E** | **Larger maps with more factions.** |

**Owner gates now released by Lane:** faction design (more factions), pacing target (1 hr). Faction *count/identities*, mission *content*, and government *specifics* are still open — proposed defaults below, flagged ❓ for his confirmation.

---

## 1. Vision

A **C&C-style RTS with a light nation-builder spine.** You still win by military dominance (last alliance standing), but getting there now runs ~an hour and involves **a real economy you fight over**, **a civilian population you cultivate and exploit**, and **a government that buffs or destabilizes you**. The society layer adds depth and leverage, never a sudden "your civilians lost you the game" — combat stays the decider.

Three pillars: **Conquer the resources → Grow & exploit your people → Lead them well.**

---

## 2. Multi-resource economy (the foundation — build first)

Today: one harvested resource (Data Crystals) + Power (a grid utility) + v3.1 coolant (passively generated). v4 turns this into a **resource map you fight over.**

### 2.1 Resources
- **Data Crystals** — primary currency (buildings, units). *Harvested* (existing).
- **Coolant** — now a **harvested liquid** (per **C**), required to run/produce heavy units (walkers, artillery, gunships, flak) and advanced buildings. Overheat penalty stays.
- **Power** — unchanged grid utility (produced/consumed, not stockpiled, not traded).
- ❓ **Optional 3rd resource ("Alloy")** for top-tier units — keeps "rich/poor spawn" interesting with more texture. *Default: ship with 2 harvested resources (Crystals + Coolant); the system is written generically so a 3rd is a data change.*

### 2.2 Harvesting (generalize the existing pipeline)
- Refactor the harvester/refinery loop to be **resource-typed**, not crystal-specific:
  - `ResourceNode { kind: 'crystal' | 'coolant', amount, max, ... }` (generalize `CrystalNode`).
  - `Harvester` gains a `resource` it services; **Coolant Tanker** = new unit that mines coolant wells → **Coolant Refinery** drop-off.
  - **Migration from v3.1:** the `pump` "Coolant Plant" becomes the **Coolant Refinery** (drop-off + small trickle), and coolant comes mostly from **Coolant Wells** on the map. `waterStep` production shifts from buildings to harvested deliveries; overheat logic unchanged.
- Each refinery/HQ accepts its matching resource; rally + auto-return logic reused.

### 2.3 Resource-biased map (per **D₂**)
- `mapgen` places **per-resource node fields** with **spawn bias**: each starting corner is rich in one resource, poor in another (e.g., NEXUS corner crystal-rich/coolant-poor). **Contested central + frontier sites are rich in both** → you must expand and fight for a balanced economy. Drives exploration & conquest.
- Crystal regen (v3.1) generalizes to all harvested resources.

### 2.4 Trade (per **D₂**: "all resources tradeable")
- Extend diplomacy trade pacts into **resource trade**: pact specifies a per-second exchange (e.g., you send crystals, ally sends coolant), or one-off **buy/sell** with a faction at relation-dependent rates. Merchant faction gets the best rates. Enables specializing your economy and buying what your spawn lacks.

**Phase-1 deliverable:** typed resources, Coolant Tanker + wells + refinery migration, biased spawns, resource trade UI. Foundation for everything else.

---

## 3. Population & society (per **A** — flavor/economy + leverage, not a win-con)

### 3.1 Your civilian population
- Grows from **Residential/Civic buildings** (new: Habitat, and civic needs like Clinic/Market). Population is a **per-faction number** with a **happiness** score.
- **Happiness** rises with: resource surplus, met civic needs (housing, goods, security), low war stress; falls with: shortages, unmet needs, lost territory, heavy conscription.
- **Consequences (never an instant loss):**
  - High happiness → **economic bonus** (faster harvest/production).
  - Low happiness → **strikes** (production slows), then **revolt** (spawns hostile rioter units in your base) — disruptive, recoverable.

### 3.2 Using population to your advantage (the leverage Lane wants)
- **Labor** — population assigned as labor boosts harvest/build/production rates. Your people *are* an economic multiplier.
- **Conscription** — convert civilians → infantry instantly (cheap army surge) at a happiness cost.
- **Recruit neutral map population (item 7)** — neutral **settlements/villages** dot the map. Win them via:
  - **Recruit** (spend credits/gifts) → instant population + their local resources.
  - **Persuade** (diplomacy/relations) → they defect peacefully.
  - **Intimidate** (park military nearby) → they submit, but unhappy.
- Captured settlements expand your population base and deny it to rivals — another reason to **explore & conquer** (ties to **D₂**, **E**).

### 3.3 Open ❓
- Visual treatment of population (abstract counter vs visible civilians milling in base)? *Default: counter + a few ambient civilian sprites near civic buildings for life.*

---

## 4. Government & leadership (per **A**, item 9 — a buff/risk layer)

- **Leader + style** chosen at match start (and changeable via election/coup). Style = faction-wide modifier set, e.g.:
  - **Militarist** (+combat, −economy), **Industrialist** (+production/harvest), **Populist** (+happiness, cheaper recruiting), **Technocrat** (+research/advanced unlocks), **Mercantile** (+trade rates).
- **Elections** — periodic; **population happiness sways the result**; you can **campaign** (spend resources for influence) or **rig** (covert, risky). Losing an election can swap your style → you adapt.
- **Coups** — sustained low happiness or a rival's ambition can trigger a **coup attempt** (mini-event you defend against); you can also **launch coups vs AI** as a Cyber-Ops extension to flip their leader/destabilize them. Outcome changes leadership, never an instant game-over (per Lane).
- ❓ How much **player control vs randomness** in elections/coups, and frequency. *Default: elections every ~12–15 min; coups only when happiness is critically low or via enemy ops.*

---

## 5. Combat & content expansion (per **B**, **D₁**, item 5)

- **Aircraft scarier (D₁):** higher damage/HP and/or splash, **gated behind a dedicated Airbase + heavy coolant upkeep**, costlier and rarer. They should feel like a threat that demands AA, not a spammable workhorse.
- **Tech tiers** — advanced units/buildings gated behind research or tier buildings, so the **build-up genuinely takes longer** (supports the 1-hour target via *more to do*, not grind).
- **More units** — continue the roster (naval? heavy armor? combat engineers? — ❓ Lane's appetite).
- **Missions / objectives (per B & A's "missions"):** optional map objectives that fill the hour and reward expansion:
  - Capture & hold neutral settlements / central resource sites (victory points or economic bonuses).
  - Destroy map landmarks; defend events; escalating AI assault waves.
  - ❓ **Scripted campaign missions** vs **emergent skirmish objectives**? *Default: emergent skirmish objectives first (replayable, fits random maps); scripted campaign later.*

---

## 6. Factions & maps (per **E**)

- **Larger maps:** bump `MAPW/MAPH` (e.g., 84 → 120+), more node fields, more base anchors, longer pathing already supported by A*.
- **More factions — proposed 6** ❓ (add 2 to the current NEXUS/HELIX/AURUM/VANTA):
  - **VERDANT PACT** (green) — agrarian/population-focused; big happy populations, recruits cheaply.
  - **OBSIDIAN LEGION** (steel/orange) — industrial juggernaut; heavy armor & artillery, weak diplomacy.
  - *(Identities are placeholders — Lane to confirm count, names, vibes.)*
- Win condition stays "last alliance standing," with an **optional victory-point path** from objectives so an hour-long game can end decisively without total annihilation.

---

## 7. Pacing to ~1 hour (per B — via content, not grind)

Time is added by **systems to engage with**, not slower clicks: multi-resource logistics, expansion for biased resources, population/civic management, government cycles, tech tiers, map objectives. Economy *rates* stay snappy; there's simply more board to play.

---

## 8. Migration notes (v3.1 → v4)

- `CrystalNode` → generic `ResourceNode { kind }`; `game.nodes` typed.
- v3.1 `pump`/Coolant Plant (passive +water) → **Coolant Refinery** (harvest drop-off + trickle); add **Coolant Well** nodes + **Coolant Tanker** unit. `waterOf/waterStep` keep overheat math, change the production source.
- v3.1 coolant HUD meter stays; add a second harvested-resource readout.
- Diplomacy `trade` pacts gain a resource payload.
- `FAC`, `BASE_INFO`, `NODE_SITES` extended for 6 factions + larger map.

---

## 9. Phased build roadmap

Each phase ships runnable, committed, and headless-verified (same method as v3.1: drive the engine-independent sim via Vite dev modules; WebGL can't screenshot in CI preview).

1. **Phase 1 — Multi-resource economy** *(foundation, low ambiguity)*: typed resources, harvested coolant (Tanker + Wells + Refinery migration), resource-biased spawns, resource trade. **Recommended start.**
2. **Phase 2 — Maps & factions**: larger maps, 6 factions, aircraft scarier + Airbase gate. High variety, moderate risk.
3. **Phase 3 — Population & society**: civic buildings, happiness, labor/conscription leverage, neutral settlements (recruit/persuade/intimidate), strikes/revolt.
4. **Phase 4 — Government**: leaders/styles, elections, coups (player + vs-AI).
5. **Phase 5 — Missions, tech tiers & hour-pacing balance**: objectives, victory points, research gating; tune to ~60-min matches.
6. **Continuous** — art/polish for every new entity; sidebar/HUD for new systems.

---

## 10. Open questions for Lane (before/while building)

1. **Factions:** 6 confirmed? Names/identities for the 2 new ones — or give me a vibe and I'll design them.
2. **Resources:** two harvested (Crystals + Coolant), or add a third (Alloy) for top-tier units?
3. **Leader styles:** which archetypes appeal (Militarist / Industrialist / Populist / Technocrat / Mercantile / other)?
4. **Missions:** emergent skirmish objectives (capture/hold), scripted campaign, or both?
5. **Elections/coups:** how much should the player *control* vs how much is *political risk* outside their hands?
6. **More units:** any specific dream units (naval, super-units, engineers)?

None of these block **Phase 1** — the economy foundation is unambiguous and everything else builds on it.
