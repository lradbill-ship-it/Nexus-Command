import { TILE, MAPW, MAPH, idx, inMap, clamp, PASSABLE } from './constants';
import { game, isAllied } from './state';
import type { Vec } from './types';

export const tPassable = (tx: number, ty: number) => inMap(tx, ty) && PASSABLE[game.terr[idx(tx, ty)]] === 1;
export const passable = (tx: number, ty: number) => tPassable(tx, ty) && game.occupied[idx(tx, ty)] === 0;
/** Team-aware passability: an allied gate tile is walkable for that team; enemies see it (and all other
 *  occupied tiles) as blocked. team 0 = no allegiance ⇒ gates block (treated like walls). */
export const passableFor = (tx: number, ty: number, team: number) => {
  if (!tPassable(tx, ty)) return false;
  const i = idx(tx, ty);
  if (game.occupied[i] === 0) return true;
  const g = game.gate[i];
  return g !== 0 && isAllied(team, g);
};

export function nearestPassableTile(tx: number, ty: number): [number, number] | null {
  if (passable(tx, ty)) return [tx, ty];
  for (let r = 1; r <= 7; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    if (passable(tx + dx, ty + dy)) return [tx + dx, ty + dy];
  }
  return null;
}

const _g = new Float32Array(MAPW * MAPH);
const _came = new Int32Array(MAPW * MAPH);
const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.4], [1, -1, 1.4], [-1, 1, 1.4], [-1, -1, 1.4],
];

// Per-sim-step pathfinding budget: a full A* can cost several ms on the ×3 map, so if many units repath in
// the SAME tick (e.g. a squad assaulting a base, harvesters re-finding fields) the steps stack into a frame
// spike. We cap the number of searches per step; over-budget callers get null and simply keep their current
// path / retry next tick (units still move via straight-line steering), staggering the work across frames.
let pathCalls = 0, pathBudget = 6;
export function resetPathBudget(n = 6) { pathCalls = 0; pathBudget = n; }

/** A* on the tile grid, returns a smoothed world-space waypoint list (or null).
 *  `team` makes allied gates walkable for that team (enemies route around them). */
export function findPath(wx0: number, wy0: number, wx1: number, wy1: number, team = 0): Vec[] | null {
  if (pathCalls >= pathBudget) return null;   // over this tick's search budget → defer to a later tick
  pathCalls++;
  const pass = (x: number, y: number) => passableFor(x, y, team);
  const losClear = (ax: number, ay: number, bx: number, by: number) => {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 10);
    for (let i = 1; i <= steps; i++) {
      const x = ax + (bx - ax) * i / steps, y = ay + (by - ay) * i / steps;
      if (!pass(x / TILE | 0, y / TILE | 0)) return false;
    }
    return true;
  };
  let sx = clamp(wx0 / TILE | 0, 0, MAPW - 1), sy = clamp(wy0 / TILE | 0, 0, MAPH - 1);
  const tgt = nearestPassableTile(clamp(wx1 / TILE | 0, 0, MAPW - 1), clamp(wy1 / TILE | 0, 0, MAPH - 1));
  if (!tgt) return null;
  const [tx, ty] = tgt;
  if (sx === tx && sy === ty) return [{ x: wx1, y: wy1 }];
  if (!pass(sx, sy)) { const np = nearestPassableTile(sx, sy); if (np) { sx = np[0]; sy = np[1]; } }
  _g.fill(Infinity); _came.fill(-1);
  const start = idx(sx, sy), goal = idx(tx, ty);
  _g[start] = 0;
  // binary heap of [f, idx]
  const hf: number[] = [], hi: number[] = [];
  function push(f: number, i: number) {
    hf.push(f); hi.push(i); let c = hf.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1; if (hf[p] <= hf[c]) break;
      const tf = hf[p]; hf[p] = hf[c]; hf[c] = tf; const ti = hi[p]; hi[p] = hi[c]; hi[c] = ti; c = p;   // swap (no array alloc)
    }
  }
  function pop() {
    const i = hi[0]; const lf = hf.pop()!, li = hi.pop()!;
    if (hf.length) {
      hf[0] = lf; hi[0] = li; let c = 0;
      while (true) {
        const l = c * 2 + 1, r = l + 1; let m = c;
        if (l < hf.length && hf[l] < hf[m]) m = l;
        if (r < hf.length && hf[r] < hf[m]) m = r;
        if (m === c) break;
        const tf = hf[m]; hf[m] = hf[c]; hf[c] = tf; const ti = hi[m]; hi[m] = hi[c]; hi[c] = ti; c = m;   // swap (no array alloc)
      }
    }
    return i;
  }
  const H = (i: number) => { const x = i % MAPW, y = i / MAPW | 0; return Math.abs(x - tx) + Math.abs(y - ty); };
  push(H(start), start);
  let pops = 0, found = false;
  while (hf.length && pops++ < 14000) {   // node budget — enough for long ×3-map paths, but a failed search stays cheap
    const cur = pop();
    if (cur === goal) { found = true; break; }
    const cx = cur % MAPW, cy = cur / MAPW | 0, cg = _g[cur];
    for (const [dx, dy, c] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!pass(nx, ny)) continue;
      if (dx && dy && (!pass(cx + dx, cy) || !pass(cx, cy + dy))) continue;
      const ni = idx(nx, ny), ng = cg + c;
      if (ng < _g[ni]) { _g[ni] = ng; _came[ni] = cur; push(ng + H(ni), ni); }
    }
  }
  if (!found) return null;
  // reconstruct
  const pts: Vec[] = []; let cur = goal;
  while (cur !== -1 && cur !== start) { pts.push({ x: (cur % MAPW) * TILE + 16, y: (cur / MAPW | 0) * TILE + 16 }); cur = _came[cur]; }
  pts.reverse();
  pts.push({ x: wx1, y: wy1 });
  // smooth with line-of-sight skips
  const sm: Vec[] = []; let from: Vec = { x: wx0, y: wy0 }; let i = 0;
  while (i < pts.length) {
    let j = Math.min(pts.length - 1, i + 6);
    while (j > i && !losClear(from.x, from.y, pts[j].x, pts[j].y)) j--;
    sm.push(pts[j]); from = pts[j]; i = j + 1;
  }
  return sm;
}
