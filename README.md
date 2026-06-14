# NEXUS COMMAND

A real-time strategy game in the spirit of **Command & Conquer** — drones, hover tanks,
railgun walkers, cyber warfare, and four-way diplomacy on a freshly generated battlefield
every match.

This is the **WebGL engine rebuild** (Phaser 3 + Vite + TypeScript). It supersedes the
earlier single-file `<canvas>` prototypes (kept under `reference/` for logic mining). The
proven game simulation — economy, combat, A\* pathfinding, AI, diplomacy, covert ops — is
ported intact; rendering, input, camera, and audio are rebuilt properly on a real engine.

## Run it

```bash
npm install
npm run dev        # opens http://localhost:5173
```

Build a static bundle:

```bash
npm run build      # type-checks, then emits dist/
npm run preview    # serve the production build
```

Fully offline — no server, no accounts. Runs in any modern browser (built/tested on Mac & Windows).

## Controls

| Action | Input |
|--------|-------|
| Pan camera | **W A S D** / arrows, **middle-mouse drag**, or click the radar minimap |
| Zoom | mouse wheel |
| Select | left-click / drag a box |
| Move · Attack · Harvest · Rally | right-click (context-sensitive) |
| Attack-move | **T**, then click |
| Control groups | **Ctrl+1–9** to set, **1–9** to recall (**Shift+1–9** to add) |
| EMP Pulse · System Hijack | **E** · **H** (needs Cyber Ops Center) |
| Cancel placement / ability | right-click or **Esc** |
| Mute audio | **M** |
| New random map | **⟳ NEW MAP / RESTART** (top bar) |

> The camera **never** drifts from the screen edge — pan only with the inputs above.

## The six owner requirements

1. **Restart button** — top-bar `⟳ NEW MAP / RESTART` regenerates a fresh battlefield instantly.
2. **No edge-scroll drift** — there is no edge-scroll code at all; reach for the sidebar freely.
3. **Looks like real C&C** — painted natural terrain (grass, flower fields, forests, rock ridges,
   rivers with plank bridges, golden crystal fields) + chunky pseudo-3D, faction-trimmed
   buildings and vehicles + real explosions, scorch marks and smoke.
4. **Random maps** — value-noise biomes, 1–2 rivers, roads carved base→center for guaranteed
   connectivity and natural choke points, every match.
5. **Modern stereo sound** — WebAudio engine: positional `StereoPanner` per source, noise-buffer
   layered impacts, master compressor, ambient wind bed.
6. **Top-level logic/UX** — binary-heap A\* (8-dir, corner-safe, LOS-smoothed, stuck-repath),
   control groups, drag-select, polished C&C metal sidebar with radar, build grid, and event feed.

## Factions

| Faction | Color | Persona |
|---------|-------|---------|
| **NEXUS** (you) | teal | — |
| **HELIX COMBINE** | red | warlord — comes for you early, builds extra defense |
| **AURUM SYNDICATE** | gold | merchant — trades & allies readily, fights reluctantly |
| **VANTA CELL** | violet | covert — runs covert ops on everyone, including you |

See `docs/DESIGN_SPEC.md` for the full faction / diplomacy / covert-ops / pacing tables.

## Architecture

```
src/
  sim/            renderer-agnostic simulation (no DOM, no Phaser)
    constants.ts    grid, factions, building/unit/ability/covert defs
    types.ts        entity & state interfaces
    state.ts        live game + diplomacy state, relation helpers, reset
    mapgen.ts       value-noise procedural battlefield generator
    pathfind.ts     binary-heap A* with LOS smoothing
    sim.ts          entities, economy, combat, movement, AI, diplomacy, covert ops, world step
  render/
    terrain.ts      painted-terrain pre-renderer + baked trees + scorch
    textures.ts     pseudo-3D building/vehicle/crystal sprite-texture factory
  scene/
    BattleScene.ts  Phaser scene: camera, input, sprite lifecycle, FX, fog, minimap, loop
  ui/
    sidebar.ts      C&C metal sidebar (build/ops/diplomacy panes, feed, live refresh)
  audio.ts          stereo positional WebAudio engine
  main.ts           boot + wiring
```

The simulation is deliberately decoupled from rendering (it talks to the renderer/UI only
through small hooks), so the logic stays portable and testable.

## Credits

Art is procedurally generated at runtime (see `assets/CREDITS.md`). Engine: [Phaser 3](https://phaser.io).
