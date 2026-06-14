# NEXUS COMMAND — Design Specification (Project Stratadug)

Visual benchmark: **Command & Conquer / Red Alert Remastered** — lush painted terrain (grass with yellow flower fields, pine/broadleaf forests, rock ridges, rivers crossed by bridges, golden ore fields), chunky readable buildings with depth and shadows, classic right-hand metal sidebar with radar + icon build grid.

Modern twist: drones, hover tanks, railgun walkers, cyber warfare, four-way diplomacy.

## 1. Factions

| # | Faction | Color | Persona | Behavior |
|---|---------|-------|---------|----------|
| 1 | NEXUS (player) | teal #3ec8b4 | — | — |
| 2 | HELIX COMBINE | red #e8483a | warlord | Relations drift toward −55 vs player / −28 vs others → war is inevitable. Earliest waves (~2.2 min), builds extra defense, extra starting army. Alliance threshold 75. |
| 3 | AURUM SYNDICATE | gold #e9a93d | merchant | Drifts toward +18/+14. Trades with anyone (threshold 0), allies at 40. +4/s passive income. Fights only if provoked. |
| 4 | VANTA CELL | violet #9b6fe8 | covert | Drifts toward ~0. Every 80–130s runs a covert op against the richest non-ally: 55% steal (22% of their cash, cap 500), else sabotage (30% damage to a random non-HQ building). 30% chance of detection (−12 relations). Alliance threshold 55. |

Starting relations: P↔HELIX −20, P↔AURUM +10, P↔VANTA 0, HELIX↔AURUM −12, HELIX↔VANTA −15, AURUM↔VANTA +5.

## 2. Diplomacy rules

- Relations clamp −100..100. **WAR** when ≤ −30 (and not allied). Alliance breaks if relations fall below 25 (−30 hit if player breaks it manually).
- Diplomacy tick every 5s: persona drift ±0.9 toward target; active trade pact +1; for each alliance pair, each partner drifts −2.2 vs the other's war enemies (allies get dragged into wars).
- AI↔AI auto-alliance at relations > 60. War declarations are announced in the feed with an alarm.
- Player actions: Gift (300 → +12), Trade pact (needs rel ≥ 10, merchant ≥ 0; +9/s each side; auto-void at war; +5 on signing, +1/tick warmth), Ally (threshold by persona; +10 on success; shared fog vision), Declare War (sets rel to ≤ −60).
- Aggression costs: destroying a unit −5, a building −16; explicitly ordering an attack on a neutral −10 (throttled, once per 10s per faction); EMPing neutrals −12; hijacking a neutral's unit −18.

## 3. Covert ops (need Cyber Ops Center; choose target faction)

| Op | Cost | CD | Success | Effect | On failure (detected) |
|----|------|----|---------|--------|----------------------|
| Steal Data | 250 | 45s | 70% | take min(600, 30% of target cash) | −20 relations |
| Sabotage | 500 | 75s | 65% | random non-HQ building −45% HP, offline 20s | −25 |
| Recon Sweep | 150 | 40s | 100% | reveal target base (r≈17 tiles) 15s | never detected |
| Incite War | 700 | 120s | 55% | target vs random other AI: −40 relations | −25 |

Cyber abilities: **EMP Pulse** (300, 60s cd, r≈130px, disables non-allied units & turrets 8s), **System Hijack** (600, 90s cd, permanently converts one visible enemy unit).

## 4. Buildings

| Type | Size | HP | Cost | Power | Build | Notes |
|------|------|----|------|-------|-------|-------|
| Command HQ | 3×3 | 1700 | — | +20 | — | accepts deliveries; radar dish, antenna |
| Power Plant | 2×2 | 430 | 300 | +50 | 8s | twin stacks, steam |
| Crystal Refinery | 3×2 | 700 | 600 | −10 | 12s | free harvester on completion; glowing intake |
| War Foundry | 3×2 | 900 | 500 | −15 | 12s | builds all units; bay door, progress bar |
| Sentinel Turret | 1×1 | 520 | 400 | −10 | 8s | dmg 13, range 188, rof 0.65, rotating cannon |
| Cyber Ops Center | 2×2 | 740 | 800 | −20 | 14s | unlocks abilities + covert ops; glass dome |

Negative net power → production and turret fire at 0.5×. Placement requires scouted, buildable ground within 10 tiles of an existing friendly building.

## 5. Units

| Type | Cost | HP | Speed | Range | Dmg | RoF | Build | Notes |
|------|------|----|-------|-------|-----|-----|-------|-------|
| Harvester | 400 | 310 | 74 | — | — | — | 10s | cargo 200, mines 62/s, visible gold load |
| Recon Drone | 150 | 78 | 140 | 96 | 4 | 0.4 | 6s | quadcopter, sight 9 |
| Hover Tank | 300 | 155 | 96 | 124 | 11 | 0.8 | 9s | independent turret aim |
| Railgun Walker | 700 | 440 | 56 | 182 | 48 | 2.2 | 16s | quad legs, bright rail tracer |

Turret/unit aim slews at ~5–7 rad/s; fire only when roughly on-target. Walker/turret shots have recoil flashes.

## 6. Map generation (working code in wip-v3/p1-core.html)

84×84 tiles (32px). Terrain: GRASS, DIRT, WATER, ROCK, FOREST, BRIDGE, ROAD — only grass/dirt/road/bridge passable; build only on grass/dirt/road. Value-noise biomes (rock >0.70 elevation, forest >0.635 moisture, dirt patches), 1–2 random-walk rivers, roads carved from each base corner and each crystal site to map center (water crossings become bridges → guaranteed connectivity and natural choke points), 9-tile clearings at the four corner bases, 4-tile clearings at the nine crystal sites (4 corner-adjacent, 1 big center, 4 edge-mid), rock border wall. Decoration: speckle, grass tufts, yellow flower fields, sandy river banks, faceted boulders, plank bridges, road wear.

## 7. Pacing & AI (per-AI script in code)

- Start: each AI has HQ + power + refinery + harvester + recon (warlord: +turret +2 tanks). Player: HQ + 2 recon + 1500 crystals (AIs 2200–2400).
- Scripted expansion at t≈20/60/100/135/210/310/390/500 (warlord −25s, merchant +30s), continuous training (army cap 26), harvester replacement, +6/s trickle after t>320.
- Waves only vs factions they're AT WAR with, targeting their most-hated enemy: first at 130–220s, size 2+⌈n×1.7⌉ capped 16, interval shrinking to ~50s.

## 8. UX requirements

- Camera: WASD/arrows, middle-drag, minimap click. **NO cursor-edge scrolling.**
- Drag-select, right-click contextual orders (move/attack/harvest/rally), T = attack-move, Esc cancels, control groups (1–9) desirable.
- C&C-style sidebar: credits LED readout, radar minimap with fog, selection panel, tabbed BASE/OPS/DIPLOMACY panes, icon buttons with cost + cooldown bars, battlefield event feed.
- Restart/new-map button always visible. Hints for invalid actions. Win = all survivors are you/allies; lose = zero player buildings.

## 9. Audio (working synth engine in wip-v3/p1-core.html)

Stereo panning by world X. Compressor on master. Noise-buffer-based impacts (lowpass-swept boom + sub-sine thump + highpass crack), bandpass shot cracks, railgun metallic zing, EMP riser, cash register on delivery, alliance chime, two-tone war alarm, low ambient wind bed. Throttle per-type (shots ≥45ms apart). Replace/augment with recorded assets in the engine build.

## 10. Owner feedback history (do not regress these)

1. v1: single AI enemy — owner liked gameplay, wanted more.
2. v2: +2 factions, alliances, trade, covert ops, particle/glow graphics pass.
3. v2 feedback: "doesn't look like Command & Conquer" (screenshot of RA Remastered provided); cursor-edge scrolling infuriating near the sidebar; wants random maps, restart button, real stereo audio, console-grade polish; explicitly open to a Claude Code rebuild.
4. v3 (canvas) was started to address all six points; rendering/input/boot portion was lost — the engine rebuild supersedes it.
