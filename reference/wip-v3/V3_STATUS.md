# v3 (canvas rewrite) — status

Goal: address all six owner requirements inside one HTML file. Interrupted before completion.

DONE (in these two files, concatenate p1 + p2 conceptually):
- p1-core.html — C&C-style metal sidebar HTML/CSS, restart button, stereo WebAudio engine
  (noise-buffer impacts, StereoPannerNode positional pan, compressor, ambient bed),
  procedural map generator (rivers/bridges/forests/rock/roads with guaranteed connectivity,
  crystal field placement), all faction/diplomacy/covert definitions and state.
- p2-systems.js — painted terrain pre-renderer (banks, boulders, bridges, flowers, scorch),
  A* pathfinding (binary heap, 8-dir, corner-safe, LOS smoothing), entities, fog,
  economy, combat, path-following movement with stuck-repath, harvester brain,
  building/particle systems, abilities, covert ops, full AI + world diplomacy tick.

MISSING (was "part 3", lost to an interruption):
- Pseudo-3D building/unit painters, tree painter, sidebar icon generation,
  input handlers (NO edge scroll; middle-drag pan), placement, render pipeline
  (y-sorted painter's algorithm, water shimmer, fog, vignette), minimap, main loop, boot.

RECOMMENDATION: don't finish this. Port the map generator, A*, and audio engine into a
proper engine build (see ../CLAUDE.md). The game-logic systems are identical to the ones
already proven in ../playable/nexus-command-v2.html.
