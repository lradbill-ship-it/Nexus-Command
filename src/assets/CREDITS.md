# Asset Credits

## Terrain textures (CC0)
- `terrain/grass.jpg`, `terrain/rock.jpg`, `terrain/dirt.jpg`
- Source: **ambientCG** (https://ambientcg.com) — Grass001, Rock023, Ground003
- License: **CC0 1.0** (public domain). Downscaled to 256² and recompressed for the single-file build.

## Tree sprites (CC0)
- `trees/pine.png`, `trees/tree.png`
- Source: **Kenney Foliage Pack** (https://kenney.nl/assets/foliage-sprites) — foliagePack_004 (conifer), foliagePack_010 (deciduous)
- License: **CC0 1.0** (public domain). Downscaled to 96px tall for the single-file build.

## Audio samples (CC0 / Public Domain)
- `audio/explosion.m4a` (boom — unit & building death), `audio/blast.m4a` (nuke / big explosion)
  - Source: **Wikimedia Commons** — *Explosion-LS100155.ogg*, *Explosion 10.ogg*
  - License: **Public domain**. Transcoded OGG→mono AAC/M4A (~64 kbps) so Safari can decode them; inlined for the single-file build.
- `audio/victory.m4a` (match-won stinger)
  - Source: **Kenney Music Jingles** (https://kenney.nl/assets/music-jingles) — jingles_STEEL00
  - License: **CC0 1.0** (public domain). Transcoded OGG→mono AAC/M4A; inlined.
- Everything else (weapons, EMP, UI, klaxon, defeat sting, ambient bed) is synthesized at runtime via Web Audio (`src/audio.ts`).
