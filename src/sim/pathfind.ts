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
// Generation stamp: instead of clearing the whole map (_g.fill/_came.fill = ~113k writes) on EVERY findPath —
// crippling in late game where economy scans fire dozens of short findPaths per tick — a cell counts as
// "unvisited" unless its _gen matches the current search. One counter bump replaces two full-array fills.
const _gen = new Int32Array(MAPW * MAPH);
let curGen = 0;
const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.4], [1, -1, 1.4], [-1, 1, 1.4], [-1, -1, 1.4],
];

// Per-sim-step pathfinding budget, measured in A* node-expansions ("pops"), NOT call count: a single full
// search is costly, a nearby one is cheap. Budgeting by work lets the economy/resource scans (which fire MANY
// short cheap findPaths per search) all run, while a storm of expensive searches in one tick is bounded.
// IMPORTANT: when the budget is spent, findPath sets `deferred` and returns null — callers must DISTINGUISH a
// deferral (retry next tick, hold position) from a genuine no-path (no route exists), so units never wedge.
let pathPops = 0, popBudget = 60000, deferred = false;
export let pathPopsLast = 0, reachedGoal = false;   // pathPopsLast: pops consumed last tick (TEMP profiling). reachedGoal: did the last findPath reach the goal (vs a partial path)?
// Starvation-escape valve: a chronically saturated budget can permanently strand later-processed units. A `force`
// search runs over-budget — but ONLY a few per tick (throttle) and with a SMALL node cap (cheap partial path),
// so it un-sticks starved units without the frame-time spike an unbounded forced search would cause.
let forceCredits = 8;
const FORCE_CAP = 6000;   // forced searches use a small node cap → cheap; the partial-path fallback still makes progress
export function resetPathBudget(n = 90000) { pathPopsLast = pathPops; pathPops = 0; popBudget = n; deferred = false; forceCredits = 8; }
/** True iff the most recent findPath returned null only because this tick's work budget was spent (retry-able). */
export function pathDeferred() { return deferred; }

/** A* on the tile grid, returns a smoothed world-space waypoint list (or null).
 *  `team` makes allied gates walkable for that team (enemies route around them). */
export function findPath(wx0: number, wy0: number, wx1: number, wy1: number, team = 0, force = false): Vec[] | null {
  if (force) { if (forceCredits <= 0) { deferred = true; return null; } forceCredits--; }   // throttled over-budget escape
  else if (pathPops >= popBudget) { deferred = true; return null; }                          // budget spent → defer (retry next tick)
  deferred = false;
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
  curGen++;   // bump the generation instead of clearing _g/_came across the whole map
  const start = idx(sx, sy), goal = idx(tx, ty);
  _g[start] = 0; _gen[start] = curGen; _came[start] = -1;
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
  let pops = 0, found = false, bestIdx = start, bestH = H(start);   // track the closest node reached (for partial paths)
  const nodeCap = force ? FORCE_CAP : 12000;   // per-search cap: lower ⇒ the tick budget serves MANY more units (partial paths + re-path walk long hauls), so a big army moving at once doesn't starve
  while (hf.length && pops++ < nodeCap) {   // per-search node cap — finds detours around barriers; long hauls fall back to a partial path
    const cur = pop();
    if (cur === goal) { found = true; break; }
    const h = H(cur); if (h < bestH) { bestH = h; bestIdx = cur; }
    const cx = cur % MAPW, cy = cur / MAPW | 0, cg = _g[cur];
    for (const [dx, dy, c] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!pass(nx, ny)) continue;
      if (dx && dy && (!pass(cx + dx, cy) || !pass(cx, cy + dy))) continue;
      const ni = idx(nx, ny), ng = cg + c;
      const gni = _gen[ni] === curGen ? _g[ni] : Infinity;   // unvisited-this-search ⇒ treat as Infinity
      if (ng < gni) { _g[ni] = ng; _gen[ni] = curGen; _came[ni] = cur; push(ng + H(ni), ni); }
    }
  }
  pathPops += pops; reachedGoal = found;   // charge this search's work to the tick budget; record whether we reached the goal
  // Goal not reached within budget → return a PARTIAL path to the closest node we got to, so the unit makes
  // real progress and re-paths from nearer (incrementally crosses arbitrarily long / huge-map distances).
  const endIdx = found ? goal : bestIdx;
  if (endIdx === start) return null;   // couldn't get any closer at all → genuinely no route
  const pts: Vec[] = []; let cur = endIdx;
  while (cur !== -1 && cur !== start) { pts.push({ x: (cur % MAPW) * TILE + 16, y: (cur / MAPW | 0) * TILE + 16 }); cur = _came[cur]; }
  pts.reverse();
  if (found) pts.push({ x: wx1, y: wy1 });   // only walk to the exact dest if we actually reached the goal tile
  if (!pts.length) return null;
  // smooth with line-of-sight skips
  const sm: Vec[] = []; let from: Vec = { x: wx0, y: wy0 }; let i = 0;
  while (i < pts.length) {
    let j = Math.min(pts.length - 1, i + 6);
    while (j > i && !losClear(from.x, from.y, pts[j].x, pts[j].y)) j--;
    sm.push(pts[j]); from = pts[j]; i = j + 1;
  }
  return sm;
}
