# Asset Credits

## Current build — procedural art

All visual art in NEXUS COMMAND is **generated procedurally at runtime** — there are no
bundled image assets to credit yet:

- **Terrain** — value-noise biomes painted to a canvas texture (`src/render/terrain.ts`):
  grass with tonal/lighting variance, dirt, roads with wear, water with depth + sandy banks,
  faceted rock boulders, plank bridges, baked pseudo-3D pine/broadleaf trees, yellow flower fields.
- **Buildings & vehicles** — pseudo-3D sprite textures baked per faction at boot
  (`src/render/textures.ts`): extruded slabs with drop shadows, faction-color trim, and
  per-type rooftop detail (radar dish, cooling stacks, intake well, bay door, turret ring,
  data dome). Vehicles are top-down hulls with independently-aiming turrets/barrels.
- **Crystals, glow, explosions** — drawn from generated radial-glow and shard textures,
  composited additively in WebGL.

## Audio

Fully synthesized at runtime via the Web Audio API (`src/audio.ts`) — no recorded samples.

## Engine

- [Phaser 3](https://phaser.io) — MIT License.

## Adding real asset packs (future)

If/when we swap in sprite art, good CC0 sources are **Kenney.nl** (Top-down Tanks / RTS packs)
and **OpenGameArt** (CC0 filter). Drop files under `assets/`, load them in `BattleScene.preload`,
and record each pack here with its author, source URL, and license.
