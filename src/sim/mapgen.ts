import {
  TILE, MAPW, MAPH, idx, inMap, clamp,
  T_GRASS, T_DIRT, T_WATER, T_ROCK, T_FOREST, T_BRIDGE, T_ROAD, PASSABLE,
  BASE_INFO, NODE_SITES, HOME_RES,
} from './constants';
import { game } from './state';
import type { ResourceKind } from './types';

const OTHER: Record<ResourceKind, ResourceKind> = { crystal: 'coolant', coolant: 'crystal' };

/** Seeded-ish value-noise generator (fresh permutation each call). */
export function makeNoise() {
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const rnd = (x: number, y: number) => perm[(perm[x & 255] + y) & 255] / 255;
  const sm = (t: number) => t * t * (3 - 2 * t);
  function n2(x: number, y: number) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = rnd(xi, yi), b = rnd(xi + 1, yi), c = rnd(xi, yi + 1), d = rnd(xi + 1, yi + 1);
    const u = sm(xf), v = sm(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  return (x: number, y: number, oct = 3) => {
    let s = 0, amp = 1, f = 1, tot = 0;
    for (let o = 0; o < oct; o++) { s += n2(x * f, y * f) * amp; tot += amp; amp *= 0.5; f *= 2; }
    return s / tot;
  };
}

export const tPassable = (tx: number, ty: number) => inMap(tx, ty) && PASSABLE[game.terr[idx(tx, ty)]] === 1;

/** Carve a roughly-circular blob of one terrain type (used for lakes & glades). */
function blob(T: Uint8Array, cx: number, cy: number, r: number, t: number, n: (x: number, y: number) => number) {
  for (let y = cy - r - 1; y <= cy + r + 1; y++) for (let x = cx - r - 1; x <= cx + r + 1; x++) {
    if (!inMap(x, y)) continue;
    const wob = (n(x * 0.3, y * 0.3) - 0.5) * r * 0.9;   // organic, non-circular edge
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= (r + wob) * (r + wob)) T[idx(x, y)] = t;
  }
}

/** Place one resource field of `kind` around (cx,cy) in tile space. Shared by mapgen + live regen. */
export function spawnResourceField(kind: ResourceKind, cx: number, cy: number, count: number, amount: number, spread = 62) {
  for (let i = 0; i < count; i++) {
    let nx = cx * TILE, ny = cy * TILE, tries = 0;
    do {
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      nx = cx * TILE + Math.cos(a) * r; ny = cy * TILE + Math.sin(a) * r;
    } while (!tPassable(nx / TILE | 0, ny / TILE | 0) && ++tries < 20);
    game.nodes.push({
      kind, x: nx, y: ny, amount, max: amount,
      pulse: Math.random() * 6, shards: 2 + (Math.random() * 4 | 0),
    });
  }
}

/** Build a fresh battlefield into game.terr and populate trees, water, crystals. */
export function generateMap() {
  const T = game.terr;
  const nE = makeNoise(), nM = makeNoise(), nD = makeNoise(), nR = makeNoise();
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) {
    const e = nE(x * 0.055, y * 0.055), m = nM(x * 0.07, y * 0.07), d = nD(x * 0.11, y * 0.11);
    // ridge noise: |2v-1| inverted forms long connected rock spines, not blobs
    const ridge = 1 - Math.abs(2 * nR(x * 0.045, y * 0.045) - 1);
    let t = T_GRASS;
    if (e > 0.72 || ridge > 0.86) t = T_ROCK;          // peaks + ridge lines
    else if (m > 0.60) t = T_FOREST;                   // denser forest clumps
    else if (d > 0.66) t = T_DIRT;
    else if (e < 0.30 && d < 0.32) t = T_DIRT;          // low scrub basins
    T[idx(x, y)] = t;
  }
  // rivers (2-3 meandering walks across the map, variable width)
  const nRivers = 2 + (Math.random() < 0.6 ? 1 : 0);
  for (let r = 0; r < nRivers; r++) {
    const vert = Math.random() < 0.5;
    let x = vert ? 8 + Math.random() * (MAPW - 16) : 0;
    let y = vert ? 0 : 8 + Math.random() * (MAPH - 16);
    let drift = 0;
    while (vert ? y < MAPH : x < MAPW) {
      drift += (Math.random() - 0.5) * 1.0; drift = clamp(drift, -1.6, 1.6);
      if (vert) { x += drift; y += 1; } else { y += drift; x += 1; }
      const w = Math.random() < 0.22 ? 2 : 1;
      for (let oy = -w; oy <= w; oy++) for (let ox = -w; ox <= w; ox++) {
        const tx = Math.round(x) + ox, ty = Math.round(y) + oy;
        if (inMap(tx, ty) && ox * ox + oy * oy <= w * w) T[idx(tx, ty)] = T_WATER;
      }
    }
  }
  // lakes (1-3 organic ponds in the open field)
  const nLakes = 1 + (Math.random() * 3 | 0);
  for (let i = 0; i < nLakes; i++) {
    const lx = 16 + Math.random() * (MAPW - 32), ly = 16 + Math.random() * (MAPH - 32);
    blob(T, lx | 0, ly | 0, 3 + Math.random() * 4, T_WATER, nD);
  }
  // roads: each base -> center, each node site -> center (guarantees connectivity)
  const center = { x: 42, y: 42 };
  function carve(ax: number, ay: number, bx: number, by: number) {
    let x = ax, y = ay, guard = 0;
    while ((Math.abs(x - bx) > 1 || Math.abs(y - by) > 1) && guard++ < 500) {
      const dx = bx - x, dy = by - y;
      if (Math.abs(dx) > Math.abs(dy)) x += Math.sign(dx); else y += Math.sign(dy);
      for (let oy = 0; oy <= 1; oy++) for (let ox = 0; ox <= 1; ox++) {
        const tx = x + ox, ty = y + oy;
        if (!inMap(tx, ty)) continue;
        const i = idx(tx, ty);
        T[i] = T[i] === T_WATER ? T_BRIDGE : T_ROAD;
      }
    }
  }
  for (const f of [1, 2, 3, 4]) { const bi = BASE_INFO[f]; carve(bi.tx + 1, bi.ty + 1, center.x, center.y); }
  for (const s of NODE_SITES) carve(s.x, s.y, center.x, center.y);
  // clearings around bases & node sites
  function clear(cx: number, cy: number, r: number) {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (!inMap(x, y)) continue;
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r) continue;
      const i = idx(x, y);
      if (T[i] === T_ROCK || T[i] === T_FOREST || T[i] === T_WATER) T[i] = T_GRASS;
    }
  }
  for (const f of [1, 2, 3, 4]) { const bi = BASE_INFO[f]; clear(bi.tx + 1, bi.ty + 1, 9); }
  for (const s of NODE_SITES) clear(s.x, s.y, 4);
  clear(center.x, center.y, 6);
  // scattered single-tile boulders & dirt patches for visual texture (open grass only)
  for (let i = 0; i < 90; i++) {
    const x = 2 + (Math.random() * (MAPW - 4) | 0), y = 2 + (Math.random() * (MAPH - 4) | 0);
    const i0 = idx(x, y);
    if (T[i0] !== T_GRASS) continue;
    T[i0] = Math.random() < 0.4 ? T_ROCK : T_DIRT;
  }
  // map border = rock wall (2 tiles thick for a chunkier frame)
  for (let i = 0; i < MAPW; i++) { T[idx(i, 0)] = T_ROCK; T[idx(i, 1)] = T_ROCK; T[idx(i, MAPH - 1)] = T_ROCK; T[idx(i, MAPH - 2)] = T_ROCK; }
  for (let i = 0; i < MAPH; i++) { T[idx(0, i)] = T_ROCK; T[idx(1, i)] = T_ROCK; T[idx(MAPW - 1, i)] = T_ROCK; T[idx(MAPW - 2, i)] = T_ROCK; }
  // trees & water tile lists
  game.trees.length = 0; game.waterTiles.length = 0;
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) {
    const t = T[idx(x, y)];
    if (t === T_FOREST) {
      const pine = Math.random() < 0.45;
      game.trees.push({
        x: x * TILE + 8 + Math.random() * 16, y: y * TILE + 10 + Math.random() * 16,
        r: 9 + Math.random() * 5, pine, tone: Math.random(),
      });
    } else if (t === T_WATER) game.waterTiles.push({ x, y });
  }
  // resource fields — biased so each base is rich in its home resource and poor in
  // the other, the centre is contested-rich in both, and frontier sites alternate.
  game.nodes.length = 0;
  const jit = () => Math.random() * 3 - 1.5;
  for (let i = 0; i < 4; i++) {                                    // corner sites → bases 1..4
    const s = NODE_SITES[i], home = HOME_RES[i + 1], off = OTHER[home];
    spawnResourceField(home, s.x + jit(), s.y + jit(), 6, 3600, 64);            // rich home field
    const ox = s.x + (center.x - s.x) * 0.3, oy = s.y + (center.y - s.y) * 0.3;
    spawnResourceField(off, ox + jit(), oy + jit(), 2, 1300, 32);              // scarce off-resource starter
  }
  spawnResourceField('crystal', center.x - 2, center.y - 1, 7, 4200, 70);      // contested centre…
  spawnResourceField('coolant', center.x + 2, center.y + 1, 7, 4200, 70);      // …rich in both
  const mids: [number, ResourceKind][] = [[5, 'coolant'], [6, 'crystal'], [7, 'coolant'], [8, 'crystal']];
  for (const [i, kind] of mids) {                                  // frontier sites, alternating
    const s = NODE_SITES[i];
    spawnResourceField(kind, s.x + jit(), s.y + jit(), 5, 3200, 60);
  }
}
