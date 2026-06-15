import {
  TILE, MAPW, MAPH, WORLD_W, WORLD_H, PLAYER, AIS, ALL_TEAMS, FAC, B, U, ABILITIES, COVERT,
  BASE_INFO, AI_SCRIPT, T_GRASS, T_DIRT, T_ROAD,
  idx, inMap, clamp, dist,
} from './constants';
import {
  game, dip, rk, getRel, setRel, addRel, isAllied, isWar, stateOf, logMsg, hint,
} from './state';
import type { Building, Unit, Entity, Vec, Particle } from './types';
import { findPath, passable } from './pathfind';
import { spawnResourceField } from './mapgen';
import { sfx } from '../audio';

// ── Renderer / UI hooks (sim never imports the renderer or DOM directly) ──────
let scorchHook: (x: number, y: number, r: number) => void = () => {};
export function setScorchHook(fn: (x: number, y: number, r: number) => void) { scorchHook = fn; }
let endHook: (win: boolean) => void = () => {};
export function setEndHook(fn: (win: boolean) => void) { endHook = fn; }

// Transient module locals — reset on each new match.
let nextId = 1;
let dipTickT = 0;
let lastStates: Record<string, string> = {};
let lastHintT = 0;
let crystalT = 55;   // first new formation seeds ~55s in
export function resetSimLocals() { nextId = 1; dipTickT = 0; lastStates = {}; lastHintT = 0; crystalT = 55; }

// ── Entities ─────────────────────────────────────────────────────────────────
export function footprintFree(type: string, tx: number, ty: number) {
  const d = B[type];
  for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) {
    if (!inMap(x, y) || game.occupied[idx(x, y)]) return false;
    const t = game.terr[idx(x, y)];
    if (!(t === T_GRASS || t === T_DIRT || t === T_ROAD)) return false;
    for (const n of game.nodes) {
      if (n.amount > 0 && Math.abs(n.x - (x * TILE + 16)) < 30 && Math.abs(n.y - (y * TILE + 16)) < 30) return false;
    }
  }
  return true;
}
export function addBuilding(type: string, tx: number, ty: number, team: number, instant: boolean): Building {
  const d = B[type];
  const b: Building = {
    id: nextId++, kind: 'b', type, team, tx, ty,
    x: (tx + d.w / 2) * TILE, y: (ty + d.h / 2) * TILE, w: d.w * TILE, h: d.h * TILE,
    hpMax: d.hp, hp: instant ? d.hp : 1, progress: instant ? 1 : 0,
    cooldown: 0, target: null, queue: [], queueT: 0, disabledUntil: 0, anim: Math.random() * 7, unloadFx: -9, aim: 0,
  };
  for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) game.occupied[idx(x, y)] = 1;
  game.buildings.push(b); return b;
}
function removeBuildingTiles(b: Building) {
  const d = B[b.type];
  for (let y = b.ty; y < b.ty + d.h; y++) for (let x = b.tx; x < b.tx + d.w; x++) game.occupied[idx(x, y)] = 0;
}
export function addUnit(type: string, x: number, y: number, team: number): Unit {
  const u: Unit = {
    id: nextId++, kind: 'u', type, team, x, y, hpMax: U[type].hp, hp: U[type].hp,
    order: 'idle', dest: null, target: null, path: null, repathT: 0, stuckT: 0, lx: x, ly: y,
    cooldown: 0, disabledUntil: 0, cargo: 0, hNode: null, hState: 'find',
    facing: Math.random() * 7, aim: Math.random() * 7, bob: Math.random() * 7,
    moving: false, trailT: 0, lastShot: -9,
  };
  game.units.push(u); return u;
}
function freeSpotNear(x: number, y: number): Vec {
  for (let r = 0; r < 12; r++) for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, px = x + Math.cos(a) * r * 20, py = y + Math.sin(a) * r * 20;
    if (passable(px / TILE | 0, py / TILE | 0)) return { x: px, y: py };
  }
  return { x, y };
}
function aiPlace(team: number, type: string, dx: number, dy: number, instant: boolean) {
  const bi = BASE_INFO[team];
  const tx = bi.tx + dx * bi.sx, ty = bi.ty + dy * bi.sy;
  for (let n = 0; n < 48; n++) {
    const ox = tx + (n % 7) - 3, oy = ty + ((n / 7) | 0) - 3;
    if (footprintFree(type, ox, oy)) { addBuilding(type, ox, oy, team, instant); return true; }
  }
  return false;
}
export function setupBases() {
  for (const team of [1, 2, 3, 4]) {
    const bi = BASE_INFO[team];
    addBuilding('hq', bi.tx, bi.ty, team, true);
    if (team === PLAYER) {
      let s = freeSpotNear((bi.tx + 4) * TILE, bi.ty * TILE); addUnit('recon', s.x, s.y, team);
      s = freeSpotNear((bi.tx + 1) * TILE, (bi.ty - 3) * TILE); addUnit('recon', s.x, s.y, team);
      continue;
    }
    aiPlace(team, 'power', -1, 4, true);
    aiPlace(team, 'refinery', 4, 1, true);
    let s = freeSpotNear((bi.tx + 3 * bi.sx + 1.5) * TILE, (bi.ty + 5 * bi.sy) * TILE);
    addUnit('harvester', s.x, s.y, team);
    s = freeSpotNear((bi.tx + 5 * bi.sx) * TILE, (bi.ty + 2 * bi.sy) * TILE);
    addUnit('recon', s.x, s.y, team);
    if (FAC[team].persona === 'warlord') {
      aiPlace(team, 'turret', 6, 3, true);
      s = freeSpotNear((bi.tx + 6 * bi.sx) * TILE, (bi.ty + 5 * bi.sy) * TILE); addUnit('strike', s.x, s.y, team);
      s = freeSpotNear((bi.tx + 4 * bi.sx) * TILE, (bi.ty + 6 * bi.sy) * TILE); addUnit('strike', s.x, s.y, team);
    }
    game.ai[team] = { builtIdx: 0, nextWave: 0, waveN: 0, covertT: 120 + Math.random() * 60 };
    game.ai[team].nextWave = FAC[team].persona === 'warlord' ? 130 + Math.random() * 40 : 180 + Math.random() * 60;
  }
}

// ── Fog of war ───────────────────────────────────────────────────────────────
export function computeVision() {
  game.visible.fill(0);
  const stamp = (ex: number, ey: number, sight: number) => {
    const cx = ex / TILE | 0, cy = ey / TILE | 0;
    for (let y = cy - sight; y <= cy + sight; y++) for (let x = cx - sight; x <= cx + sight; x++) {
      if (!inMap(x, y)) continue;
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= sight * sight) { game.visible[idx(x, y)] = 1; game.explored[idx(x, y)] = 1; }
    }
  };
  for (const b of game.buildings) if (isAllied(PLAYER, b.team)) stamp(b.x, b.y, B[b.type].sight);
  for (const u of game.units) if (isAllied(PLAYER, u.team)) stamp(u.x, u.y, U[u.type].sight);
  game.tempVision = game.tempVision.filter(v => v.until > game.t);
  for (const v of game.tempVision) stamp(v.x, v.y, v.r);
}
export const tileVisible = (x: number, y: number) =>
  game.visible[idx(clamp(x / TILE | 0, 0, MAPW - 1), clamp(y / TILE | 0, 0, MAPH - 1))] === 1;
export const canSee = (e: Entity) => isAllied(PLAYER, e.team) || tileVisible(e.x, e.y);

// ── Economy ──────────────────────────────────────────────────────────────────
export function powerOf(team: number) {
  let prod = 0, use = 0;
  for (const b of game.buildings) {
    if (b.team !== team || b.progress < 1) continue;
    const p = B[b.type].power; if (p > 0) prod += p; else use -= p;
  }
  return { prod, use, ok: prod >= use, factor: prod >= use ? 1 : 0.5 };
}
export function tradeIncome(team: number) {
  let n = 0; for (const f of [1, 2, 3, 4]) if (f !== team && dip.trade[rk(team, f)] && !game.eliminated[f]) n++;
  return n * 9;
}

// ── Coolant (secondary resource) ──────────────────────────────────────────────
// Pumps & the HQ produce coolant; walkers, artillery, gunships and flak consume
// it. When a team's reserve runs dry in deficit it OVERHEATS — those weapons fire
// at half rate until coolant is restored (build more Coolant Plants).
export const WATER_CAP = 600;
export function waterOf(team: number) {
  let prod = 0, cons = 0;
  for (const b of game.buildings) {
    if (b.team !== team || b.progress < 1) continue;
    prod += B[b.type].water || 0; cons += B[b.type].coolant || 0;
  }
  for (const u of game.units) if (u.team === team) cons += U[u.type].coolant || 0;
  return { prod, cons, net: prod - cons, stored: game.water[team] || 0 };
}
function waterStep(dt: number) {
  for (const team of ALL_TEAMS) {
    if (game.eliminated[team]) continue;
    const w = waterOf(team);
    game.water[team] = clamp((game.water[team] || 0) + w.net * dt, 0, WATER_CAP);
    const wasHot = game.overheat[team];
    game.overheat[team] = game.water[team] <= 0.5 && w.net < 0;
    if (game.overheat[team] && !wasHot && team === PLAYER) {
      logMsg('COOLANT DEPLETED — special weapons overheating at half rate', 'war'); sfx('war');
    }
  }
}

// ── Crystal regeneration ──────────────────────────────────────────────────────
// Living fields slowly regrow, and fresh formations crystallize at random sites
// over the course of a match so the economy never permanently dries up.
function farFromBuildings(wx: number, wy: number, tiles: number) {
  const d2 = (tiles * TILE) * (tiles * TILE);
  for (const b of game.buildings) { const dx = b.x - wx, dy = b.y - wy; if (dx * dx + dy * dy < d2) return false; }
  return true;
}
function regenCrystals(dt: number) {
  // slow regrowth of partially-mined fields (never past their original max)
  for (const n of game.nodes) if (n.amount > 0 && n.amount < n.max) n.amount = Math.min(n.max, n.amount + 9 * dt);
  // periodic brand-new formations, capped so the map can't flood with crystals
  crystalT -= dt;
  if (crystalT > 0) return;
  crystalT = 70 + Math.random() * 50;
  let active = 0; for (const n of game.nodes) if (n.amount > 0) active++;
  if (active >= 60) return;                            // map saturated with fields; skip this cycle
  for (let tries = 0; tries < 60; tries++) {
    const tx = 4 + (Math.random() * (MAPW - 8) | 0), ty = 4 + (Math.random() * (MAPH - 8) | 0);
    const wx = tx * TILE + 16, wy = ty * TILE + 16;
    if (!passable(tx, ty)) continue;
    if (!farFromBuildings(wx, wy, 6)) continue;
    if (game.nodes.some(n => n.amount > 0 && dist(n, { x: wx, y: wy }) < 5 * TILE)) continue;
    const kind = (['crystal', 'coolant', 'alloy'] as const)[Math.random() * 3 | 0];
    spawnResourceField(kind, tx, ty, 3 + (Math.random() * 3 | 0), 2400 + Math.random() * 1200, 46);
    logMsg('New ' + (kind === 'crystal' ? 'data-crystal' : kind) + ' formation detected on the grid', 'good');
    sfx('chime');
    return;
  }
}

// ── Combat ───────────────────────────────────────────────────────────────────
// Layer & engagement rules: fliers can only be hit by anti-air shooters; flak
// (airOnly) can only hit fliers; everything else fights on the ground.
export const isAir = (e: Entity) => e.kind === 'u' && !!U[(e as Unit).type].air;
function defOf(e: Entity) { return e.kind === 'b' ? B[(e as Building).type] : U[(e as Unit).type]; }
function canHitAir(e: Entity) { return !!defOf(e).antiAir; }
function canHitGround(e: Entity) { return !(e.kind === 'b' && (B[(e as Building).type].airOnly)); }
function eligibleTarget(shooter: Entity, target: Entity) {
  return isAir(target) ? canHitAir(shooter) : canHitGround(shooter);
}
// Overheated teams (coolant-dependent) fire their special weapons at half rate.
function rofMult(e: Entity) { return defOf(e).coolant && game.overheat[e.team] ? 2 : 1; }

function fireAt(src: Entity, target: Entity, dmg: number, rail: boolean, splash = 0) {
  game.shots.push({ x: src.x, y: src.y, target, dmg, team: src.team, speed: rail ? 940 : 560, col: FAC[src.team].col, rail, splash });
  src.lastShot = game.t;
  spawnParts('muzzle', src.x, src.y, 2, '255,235,180');
  sfx(rail ? 'rail' : 'shot', src.x);
}
function damage(e: Entity, amt: number, fromTeam: number) { e.hp -= amt; if (e.hp <= 0) destroy(e, fromTeam); }
function destroy(e: Entity, fromTeam: number) {
  if (e.dead) return; e.dead = true;
  const big = e.kind === 'b';
  spawnParts('fire', e.x, e.y, big ? 26 : 12, '255,160,60');
  spawnParts('debris', e.x, e.y, big ? 14 : 7, '120,120,128');
  spawnParts('smoke', e.x, e.y, big ? 12 : 5, '70,70,76');
  game.parts.push({ type: 'ring', x: e.x, y: e.y, t: 0, life: 0.7, big });
  game.parts.push({ type: 'flash', x: e.x, y: e.y, t: 0, life: 0.16, big });
  scorchHook(e.x, e.y, big ? Math.max((e as Building).w, (e as Building).h) * 0.6 : 15);
  game.shake = Math.min(11, game.shake + (big ? 7 : 2));
  sfx(big ? 'bigboom' : 'boom', e.x);
  if (big) {
    removeBuildingTiles(e as Building);
    game.buildings = game.buildings.filter(b => b !== e);
    logMsg((e.team === PLAYER ? 'Our ' : FAC[e.team].name + ' ') + B[(e as Building).type].name + ' destroyed', e.team === PLAYER ? 'war' : undefined);
  } else game.units = game.units.filter(u => u !== e);
  game.selection = game.selection.filter(s => s !== e);
  if (fromTeam && fromTeam !== e.team && !isAllied(fromTeam, e.team)) addRel(fromTeam, e.team, big ? -16 : -5);
  if (big) checkElimination(e.team);
}
function checkElimination(team: number) {
  if (game.eliminated[team]) return;
  if (!game.buildings.some(b => b.team === team)) {
    game.eliminated[team] = true;
    logMsg(FAC[team].name + ' has been wiped from the battlefield', 'war'); sfx('war');
  }
}
function nearestHostile(e: Entity, range: number, team: number, playerVisOnly: boolean): Entity | null {
  let best: Entity | null = null, bd = range;
  for (const u of game.units) {
    if (!isWar(team, u.team)) continue;
    if (!eligibleTarget(e, u)) continue;
    if (playerVisOnly && !tileVisible(u.x, u.y)) continue;
    const d = dist(e, u) - U[u.type].radius; if (d < bd) { bd = d; best = u; }
  }
  if (canHitGround(e)) for (const b of game.buildings) {   // flak (airOnly) ignores structures
    if (!isWar(team, b.team)) continue;
    if (playerVisOnly && !tileVisible(b.x, b.y)) continue;
    const d = dist(e, b) - Math.max(b.w, b.h) / 2; if (d < bd) { bd = d; best = b; }
  }
  return best;
}

// ── Movement: path following + local steering ────────────────────────────────
function unitBlocked(x: number, y: number) { return !passable(x / TILE | 0, y / TILE | 0); }
function stepToward(u: Unit, dx: number, dy: number, dt: number) {
  const sp = U[u.type].speed * dt, len = Math.hypot(dx, dy);
  if (len < 1) { u.moving = false; return true; }
  u.moving = true;
  const nx = u.x + dx / len * sp, ny = u.y + dy / len * sp;
  u.facing = Math.atan2(dy, dx);
  if (U[u.type].air) { u.x = nx; u.y = ny; }              // fliers ignore terrain entirely
  else if (!unitBlocked(nx, ny)) { u.x = nx; u.y = ny; }
  else if (!unitBlocked(nx, u.y)) { u.x = nx; }
  else if (!unitBlocked(u.x, ny)) { u.y = ny; }
  else { const px = u.x + (-dy / len) * sp, py = u.y + (dx / len) * sp; if (!unitBlocked(px, py)) { u.x = px; u.y = py; } }
  u.x = clamp(u.x, 12, WORLD_W - 12); u.y = clamp(u.y, 12, WORLD_H - 12);
  return len < sp * 1.5;
}
export function setPath(u: Unit, wx: number, wy: number) {
  u.path = U[u.type].air ? [{ x: wx, y: wy }] : findPath(u.x, u.y, wx, wy);   // fliers fly straight
  u.finalDest = { x: wx, y: wy };
  u.stuckT = 0;
}
function followPath(u: Unit, dt: number) {
  if (!u.path || !u.path.length) {
    if (u.finalDest) return stepToward(u, u.finalDest.x - u.x, u.finalDest.y - u.y, dt);
    return true;
  }
  const p = u.path[0];
  const arrived = stepToward(u, p.x - u.x, p.y - u.y, dt) || dist(u, p) < 13;
  if (arrived) { u.path.shift(); return u.path.length === 0 && dist(u, u.finalDest || p) < 16; }
  const moved = Math.hypot(u.x - u.lx, u.y - u.ly);
  if (moved < U[u.type].speed * dt * 0.25) u.stuckT += dt; else u.stuckT = 0;
  u.lx = u.x; u.ly = u.y;
  if (u.stuckT > 1.3 && u.finalDest) { u.stuckT = 0; setPath(u, u.finalDest.x, u.finalDest.y); }
  return false;
}
function separation() {
  const us = game.units;
  for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
    const a = us[i], b = us[j];
    if (U[a.type].air || U[b.type].air) continue;          // air & ground occupy separate layers
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    const min = U[a.type].radius + U[b.type].radius;
    if (d > 0 && d < min) {
      const push = (min - d) / 2, ux = dx / d, uy = dy / d;
      if (!unitBlocked(a.x - ux * push, a.y - uy * push)) { a.x -= ux * push; a.y -= uy * push; }
      if (!unitBlocked(b.x + ux * push, b.y + uy * push)) { b.x += ux * push; b.y += uy * push; }
    }
  }
}

// ── Harvesting (resource-typed: harvester=crystal, tanker=coolant) ────────────
const resOf = (u: Unit) => U[u.type].harvests!;
function nearestNodePathable(u: Unit) {
  const kind = resOf(u);
  const sorted = game.nodes.filter(n => n.amount > 0 && n.kind === kind).sort((a, b) => dist(u, a) - dist(u, b));
  for (let i = 0; i < Math.min(4, sorted.length); i++) {
    const p = findPath(u.x, u.y, sorted[i].x, sorted[i].y);
    if (p) return { node: sorted[i], path: p };
  }
  return null;
}
function nearestDepot(u: Unit): Building | null {
  const kind = resOf(u);
  let best: Building | null = null, bd = 1e9;
  for (const b of game.buildings) {
    if (b.team !== u.team || b.progress < 1) continue;
    if (b.type !== 'hq' && B[b.type].accepts !== kind) continue;   // HQ takes any resource
    const d = dist(u, b); if (d < bd) { bd = d; best = b; }
  }
  return best;
}
function updateHarvester(u: Unit, dt: number) {
  const cap = U[u.type].cargo!;
  const kind = resOf(u);
  if (u.hState === 'find') {
    const got = nearestNodePathable(u);
    if (got) { u.hNode = got.node; u.path = got.path; u.finalDest = { x: got.node.x, y: got.node.y }; u.hState = 'go'; }
    else u.hState = 'idlewait';
  }
  if (u.hState === 'idlewait') { if (game.t % 2 < dt) u.hState = 'find'; u.moving = false; return; }
  if (u.hState === 'go') {
    if (!u.hNode || u.hNode.amount <= 0) { u.hState = 'find'; return; }
    if (dist(u, u.hNode) < 28) { u.hState = 'mine'; u.path = null; }
    else followPath(u, dt);
  } else if (u.hState === 'mine') {
    u.moving = false;
    if (!u.hNode || u.hNode.amount <= 0) { u.hState = 'find'; return; }
    const take = Math.min(62 * dt, u.hNode.amount, cap - u.cargo);
    u.hNode.amount -= take; u.cargo += take;
    if (Math.random() < dt * 6) spawnParts('spark', u.hNode.x, u.hNode.y - 4, 1, kind === 'crystal' ? '255,220,120' : '150,220,235');
    if (u.cargo >= cap - 0.5) {
      u.hState = 'return';
      const dep = nearestDepot(u);
      if (dep) setPath(u, dep.x, dep.y + dep.h / 2 + 14);
    }
  } else if (u.hState === 'return') {
    const dep = nearestDepot(u);
    if (!dep) { u.hState = 'idlewait'; return; }
    if (dist(u, dep) < Math.max(dep.w, dep.h) / 2 + 26) {
      if (kind === 'crystal') game.money[u.team] += Math.round(u.cargo);
      else if (kind === 'coolant') game.water[u.team] = clamp((game.water[u.team] || 0) + u.cargo, 0, WATER_CAP);
      else game.alloy[u.team] = (game.alloy[u.team] || 0) + Math.round(u.cargo);
      u.cargo = 0; u.hState = 'find';
      dep.unloadFx = game.t; u.moving = false; u.path = null;
      if (u.team === PLAYER) sfx('cash', dep.x);
    } else followPath(u, dt);
  }
}

// ── Unit update ──────────────────────────────────────────────────────────────
function updateUnit(u: Unit, dt: number) {
  if (u.disabledUntil > game.t) { u.moving = false; return; }
  const d = U[u.type];
  u.cooldown = Math.max(0, u.cooldown - dt);
  // turret aim smoothing
  let want = u.facing;
  if (u.target && !u.target.dead) want = Math.atan2(u.target.y - u.y, u.target.x - u.x);
  const da = ((want - u.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  u.aim += clamp(da, -7 * dt, 7 * dt);
  if (U[u.type].harvests) {
    if (u.order === 'move' && u.dest) {
      if (followPath(u, dt)) { u.order = 'idle'; u.hState = 'find'; u.dest = null; }
      return;
    }
    updateHarvester(u, dt); return;
  }
  if (u.target && u.target.dead) u.target = null;
  if (u.order === 'attack' && u.target) {
    const tgt = u.target;
    const r = (d.range || 0) + (tgt.kind === 'b' ? Math.max((tgt as Building).w, (tgt as Building).h) / 2 : U[(tgt as Unit).type].radius);
    if (dist(u, tgt) <= r) {
      u.moving = false; u.path = null;
      u.facing = Math.atan2(tgt.y - u.y, tgt.x - u.x);
      if (u.cooldown <= 0 && Math.abs(da) < 0.5) { fireAt(u, tgt, d.dmg!, u.type === 'walker', d.splash || 0); u.cooldown = d.rof! * rofMult(u); }
    } else {
      u.repathT -= dt;
      if (!u.path || u.repathT <= 0) { u.repathT = 1.0; setPath(u, tgt.x, tgt.y); }
      followPath(u, dt);
    }
    return;
  }
  if ((u.order === 'move' || u.order === 'amove') && u.dest) {
    if (u.order === 'amove') {
      const t = nearestHostile(u, 210, u.team, u.team === PLAYER);
      if (t) { u.target = t; u.savedDest = u.dest; u.order = 'attack'; u.resume = 'amove'; return; }
    }
    if (followPath(u, dt)) { u.order = 'idle'; u.dest = null; u.path = null; }
    return;
  }
  if (u.order === 'idle') {
    u.moving = false;
    if (u.resume === 'amove' && u.savedDest) {
      u.order = 'amove'; u.dest = u.savedDest; setPath(u, u.dest.x, u.dest.y);
      u.resume = null; u.savedDest = null; return;
    }
    const t = nearestHostile(u, (d.range || 0) + 52, u.team, u.team === PLAYER);
    if (t) { u.target = t; u.order = 'attack'; }
  }
}
function postAttackCleanup(u: Unit) {
  if (u.order === 'attack' && (!u.target || u.target.dead)) { u.target = null; u.order = 'idle'; u.path = null; }
}

// ── Building update ──────────────────────────────────────────────────────────
function updateBuilding(b: Building, dt: number) {
  const d = B[b.type], pw = powerOf(b.team);
  b.anim += dt;
  if (b.progress < 1) {
    b.progress = Math.min(1, b.progress + dt / (d.buildTime || 1) * pw.factor);
    b.hp = Math.max(b.hp, d.hp * b.progress * 0.999);
    if (b.progress >= 1) {
      b.hp = d.hp;
      if (b.team === PLAYER) { logMsg(d.name + ' online', 'good'); sfx('place', b.x); }
      if (d.freeUnit) {
        const s = freeSpotNear(b.x, b.y + b.h);
        addUnit(d.freeUnit, s.x, s.y, b.team);
        if (b.team === PLAYER) logMsg(U[d.freeUnit].name + ' deployed', 'good');
      }
    }
    return;
  }
  if (b.disabledUntil > game.t) return;
  if (b.type === 'turret' || b.type === 'aaturret') {
    b.cooldown = Math.max(0, b.cooldown - dt);
    if (b.target && (b.target.dead || dist(b, b.target) > d.range! + 30 || !eligibleTarget(b, b.target))) b.target = null;
    if (!b.target) b.target = nearestHostile(b, d.range!, b.team, b.team === PLAYER);
    if (b.target) {
      const want = Math.atan2(b.target.y - b.y, b.target.x - b.x);
      const da = ((want - b.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      b.aim += clamp(da, -5 * dt, 5 * dt);
      if (b.cooldown <= 0 && Math.abs(da) < 0.4) { fireAt(b, b.target, d.dmg!, false); b.cooldown = d.rof! / pw.factor * rofMult(b); }
    } else b.aim += dt * 0.4;
  }
  if (b.type === 'power' && Math.random() < dt * 1.6)
    spawnParts('steam', b.x - b.w * 0.18, b.y - b.h / 2 - d.hgt, 1, '200,205,210');
  if (b.type === 'foundry' && b.queue.length) {
    b.queueT += dt * pw.factor;
    if (Math.random() < dt * 5) spawnParts('spark', b.x + (Math.random() * 30 - 15), b.y + 6, 1, '255,210,120');
    const ut = U[b.queue[0]];
    if (b.queueT >= ut.buildTime) {
      b.queueT = 0; const type = b.queue.shift()!;
      const s = freeSpotNear(b.x, b.y + b.h * 0.7 + 20);
      const nu = addUnit(type, s.x, s.y, b.team);
      if (b.team === PLAYER) logMsg(ut.name + ' fabricated', 'good');
      if (b.rally) { nu.order = 'move'; nu.dest = { ...b.rally }; setPath(nu, b.rally.x, b.rally.y); }
    }
  }
  if (b.hp < b.hpMax * 0.45 && Math.random() < dt * 2.4)
    spawnParts('smoke', b.x + (Math.random() * b.w - b.w / 2) * 0.5, b.y - b.h * 0.2, 1, '60,60,66');
}

// ── Shots & particles ────────────────────────────────────────────────────────
export function spawnParts(type: string, x: number, y: number, n: number, rgb: string) {
  if (game.parts.length > 520) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 7;
    const sp = type === 'fire' ? 50 + Math.random() * 190 : type === 'debris' ? 70 + Math.random() * 200 :
      type === 'smoke' ? 8 + Math.random() * 26 : type === 'steam' ? 6 + Math.random() * 14 : 20 + Math.random() * 70;
    const part: Particle = {
      type, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (type === 'debris' ? 60 : 0),
      t: 0,
      life: type === 'smoke' ? 1.3 + Math.random() * 0.9 : type === 'steam' ? 1.4 + Math.random() :
        type === 'debris' ? 0.6 + Math.random() * 0.5 : type === 'fire' ? 0.35 + Math.random() * 0.35 : 0.3 + Math.random() * 0.25,
      rgb, size: type === 'smoke' || type === 'steam' ? 5 + Math.random() * 8 : 1.5 + Math.random() * 2.5,
      grav: type === 'debris' ? 340 : 0,
    };
    game.parts.push(part);
  }
}
function updateShots(dt: number) {
  for (const s of game.shots) {
    if (!s.target || s.target.dead) { s.dead = true; continue; }
    const dx = s.target.x - s.x, dy = s.target.y - s.y, l = Math.hypot(dx, dy), step = s.speed * dt;
    if (l <= step) {
      const hx = s.target.x, hy = s.target.y;
      damage(s.target, s.dmg, s.team); s.dead = true;
      if (s.splash) {
        // area blast: falls off with distance, never friendly-fires the shooter's team
        for (const u of [...game.units]) {
          if (u.dead || u === s.target || isAllied(s.team, u.team)) continue;
          const dd = dist(u, { x: hx, y: hy });
          if (dd < s.splash) damage(u, s.dmg * (1 - dd / s.splash) * 0.7, s.team);
        }
        spawnParts('fire', hx, hy, 9, '255,150,55');
        game.parts.push({ type: 'ring', x: hx, y: hy, t: 0, life: 0.5, big: false });
        game.shake = Math.min(11, game.shake + 1.5);
      }
      spawnParts('spark', hx, hy, 3, '255,240,200');
    } else { s.x += dx / l * step; s.y += dy / l * step; }
  }
  game.shots = game.shots.filter(s => !s.dead);
  for (const p of game.parts) {
    p.t += dt;
    if (p.vx !== undefined) {
      p.x += p.vx * dt; p.y += p.vy! * dt;
      p.vx *= (1 - dt * 2.2); p.vy! *= (1 - dt * 2.2);
      if (p.grav) p.vy! += p.grav * dt;
      if (p.type === 'smoke' || p.type === 'steam') p.y -= 14 * dt;
    }
  }
  game.parts = game.parts.filter(p => p.t < p.life);
}

// ── Abilities & covert ───────────────────────────────────────────────────────
export function hasCyber() { return game.buildings.some(b => b.team === PLAYER && b.type === 'cyber' && b.progress >= 1); }
export function tryAbility(key: string) {
  if (game.over) return;
  if (!hasCyber()) { hint('Requires a Cyber Ops Center'); sfx('click'); return; }
  const a = ABILITIES[key];
  if (game.cooldowns[key] > 0) { hint(a.name + ' recharging'); return; }
  if (game.money[PLAYER] < a.cost) { hint('Insufficient crystals'); return; }
  game.armed = key; game.placing = null;
  hint(a.name + ': click a target');
}
export function castAbility(key: string, wx: number, wy: number) {
  if (key === 'amove') { issueOrder(wx, wy, true); game.armed = null; hint(''); return; }
  const a = ABILITIES[key];
  if (key === 'emp') {
    game.money[PLAYER] -= a.cost; game.cooldowns.emp = a.cd;
    game.parts.push({ type: 'emp', x: wx, y: wy, t: 0, life: 0.85 });
    sfx('emp', wx);
    let n = 0; const hitFac: Record<number, number> = {};
    for (const u of game.units) if (!isAllied(PLAYER, u.team) && dist(u, { x: wx, y: wy }) < 132) { u.disabledUntil = game.t + 8; n++; hitFac[u.team] = 1; }
    for (const b of game.buildings) if (!isAllied(PLAYER, b.team) && b.type === 'turret' && dist(b, { x: wx, y: wy }) < 132) { b.disabledUntil = game.t + 8; n++; hitFac[b.team] = 1; }
    for (const f in hitFac) if (!isWar(PLAYER, +f)) addRel(PLAYER, +f, -12);
    logMsg('EMP pulse — ' + n + ' systems offline', 'hot');
  } else if (key === 'hijack') {
    let best: Unit | null = null, bd = 42;
    for (const u of game.units) {
      if (isAllied(PLAYER, u.team)) continue;
      const dd = dist(u, { x: wx, y: wy }); if (dd < bd && tileVisible(u.x, u.y)) { bd = dd; best = u; }
    }
    if (!best) { hint('Hijack: click directly on an enemy unit'); return; }
    game.money[PLAYER] -= a.cost; game.cooldowns.hijack = a.cd;
    if (!isWar(PLAYER, best.team)) addRel(PLAYER, best.team, -18);
    best.team = PLAYER; best.order = 'idle'; best.target = null; best.hState = 'find'; best.hNode = null; best.path = null;
    game.parts.push({ type: 'emp', x: best.x, y: best.y, t: 0, life: 0.8 });
    sfx('emp', best.x);
    logMsg(U[best.type].name + ' hijacked — it\'s ours now', 'hot');
  }
  game.armed = null;
}
export function runCovert(key: string) {
  if (game.over) return;
  if (!hasCyber()) { hint('Covert ops require a Cyber Ops Center'); return; }
  const m = COVERT[key], tgt = game.covTarget;
  if (game.eliminated[tgt]) { hint('Target faction is gone'); return; }
  if (isAllied(PLAYER, tgt)) { hint('Cannot run ops against an ally'); return; }
  if (game.covCd[key] > 0) { hint(m.name + ' recharging'); return; }
  if (game.money[PLAYER] < m.cost) { hint('Insufficient crystals'); return; }
  game.money[PLAYER] -= m.cost; game.covCd[key] = m.cd;
  sfx('covert');
  const ok = Math.random() < m.chance, fname = FAC[tgt].name;
  if (key === 'steal') {
    if (ok) {
      const amt = Math.min(600, Math.max(150, game.money[tgt] * 0.3)) | 0;
      game.money[tgt] -= amt; game.money[PLAYER] += amt;
      logMsg('Covert: siphoned ' + amt + ' crystals from ' + fname, 'good'); sfx('cash');
    } else { addRel(PLAYER, tgt, -20); logMsg('Covert op DETECTED — ' + fname + ' relations −20', 'war'); sfx('war'); }
  } else if (key === 'sabotage') {
    const bl = game.buildings.filter(b => b.team === tgt && b.type !== 'hq');
    const pick = bl.length ? bl[Math.random() * bl.length | 0] : game.buildings.find(b => b.team === tgt);
    if (ok && pick) {
      pick.hp = Math.max(pick.hpMax * 0.08, pick.hp - pick.hpMax * 0.45);
      pick.disabledUntil = game.t + 20;
      spawnParts('fire', pick.x, pick.y, 14, '255,160,60');
      game.parts.push({ type: 'ring', x: pick.x, y: pick.y, t: 0, life: 0.7, big: true });
      sfx('boom', pick.x);
      logMsg('Covert: ' + fname + ' ' + B[pick.type].name + ' sabotaged', 'good');
    } else { addRel(PLAYER, tgt, -25); logMsg('Sabotage DETECTED — ' + fname + ' relations −25', 'war'); sfx('war'); }
  } else if (key === 'recon') {
    const hq = game.buildings.find(b => b.team === tgt && b.type === 'hq') || game.buildings.find(b => b.team === tgt);
    if (hq) { game.tempVision.push({ x: hq.x, y: hq.y, r: 17, until: game.t + 15 }); logMsg('Recon sweep over ' + fname + ' territory', 'good'); }
  } else if (key === 'incite') {
    const others = AIS.filter(f => f !== tgt && !game.eliminated[f]);
    if (ok && others.length) {
      const o = others[Math.random() * others.length | 0];
      addRel(tgt, o, -40);
      logMsg('Covert: forged intel — ' + fname + ' vs ' + FAC[o].name + ' relations collapse', 'good');
    } else { addRel(PLAYER, tgt, -25); logMsg('Incitement DETECTED — ' + fname + ' relations −25', 'war'); sfx('war'); }
  }
}

// ── Player diplomacy ─────────────────────────────────────────────────────────
export function dipGift(f: number) {
  if (game.money[PLAYER] < 300) { hint('Insufficient crystals'); return; }
  game.money[PLAYER] -= 300; addRel(PLAYER, f, 12);
  logMsg('Gift sent to ' + FAC[f].name + ' (+12 relations)', 'good'); sfx('chime');
}
export function dipTrade(f: number) {
  const k = rk(PLAYER, f);
  if (dip.trade[k]) { delete dip.trade[k]; logMsg('Trade pact with ' + FAC[f].name + ' cancelled'); return; }
  if (isWar(PLAYER, f)) { hint('Cannot trade during war'); return; }
  const need = FAC[f].persona === 'merchant' ? 0 : 10;
  if (getRel(PLAYER, f) < need) { hint(FAC[f].name + ' requires relations ≥ ' + need + ' to trade'); return; }
  dip.trade[k] = true; addRel(PLAYER, f, 5);
  logMsg('Trade pact signed with ' + FAC[f].name + ' (+9 crystals/s each)', 'good'); sfx('chime');
}
export function dipAlly(f: number) {
  const k = rk(PLAYER, f);
  if (dip.alliance[k]) {
    delete dip.alliance[k]; addRel(PLAYER, f, -30);
    logMsg('Alliance with ' + FAC[f].name + ' dissolved', 'war'); sfx('war'); return;
  }
  if (isWar(PLAYER, f)) { hint('They are at war with you'); return; }
  const need = ({ warlord: 75, merchant: 40, covert: 55 } as Record<string, number>)[FAC[f].persona];
  if (getRel(PLAYER, f) >= need) {
    dip.alliance[k] = true; delete dip.trade[k]; addRel(PLAYER, f, 10);
    logMsg('ALLIANCE forged with ' + FAC[f].name + ' — shared vision active', 'good'); sfx('chime');
  } else logMsg(FAC[f].name + ' declines. (Needs relations ≥ ' + need + ', now ' + Math.round(getRel(PLAYER, f)) + ')');
}
export function dipWar(f: number) {
  setRel(PLAYER, f, Math.min(getRel(PLAYER, f), -60));
  delete dip.alliance[rk(PLAYER, f)]; delete dip.trade[rk(PLAYER, f)];
  logMsg('WAR declared on ' + FAC[f].name, 'war'); sfx('war');
}

// ── World diplomacy & AI ─────────────────────────────────────────────────────
function diplomacyTick() {
  const targets: Record<string, { 1: number; def: number }> = {
    warlord: { 1: -55, def: -28 }, merchant: { 1: 18, def: 14 }, covert: { 1: -2, def: -2 },
  };
  for (const a of AIS) {
    if (game.eliminated[a]) continue;
    for (const b of [1, 2, 3, 4]) {
      if (b === a || game.eliminated[b]) continue;
      const tg2 = targets[FAC[a].persona];
      const want = (b === 1 ? tg2[1] : tg2.def), cur = getRel(a, b);
      if (Math.abs(cur - want) > 1) addRel(a, b, cur < want ? 0.9 : -0.9);
    }
  }
  for (const k in dip.trade) { const [a, b] = k.split('-').map(Number); addRel(a, b, 1); }
  for (const k in dip.alliance) {
    const [a, b] = k.split('-').map(Number);
    for (const c of [1, 2, 3, 4]) {
      if (c === a || c === b) continue;
      if (isWar(a, c)) addRel(b, c, -2.2);
      if (isWar(b, c)) addRel(a, c, -2.2);
    }
  }
  for (const k of Object.keys(dip.alliance)) {
    const [a, b] = k.split('-').map(Number);
    if (getRel(a, b) < 25) { delete dip.alliance[k]; logMsg('Alliance between ' + FAC[a].name + ' and ' + FAC[b].name + ' collapses', 'war'); }
  }
  for (const a of AIS) for (const b of AIS) {
    if (a >= b || game.eliminated[a] || game.eliminated[b]) continue;
    if (!dip.alliance[rk(a, b)] && getRel(a, b) > 60) {
      dip.alliance[rk(a, b)] = true;
      logMsg(FAC[a].name + ' and ' + FAC[b].name + ' have formed an alliance', 'hot');
    }
  }
  for (const a of [1, 2, 3, 4]) for (const b of [1, 2, 3, 4]) {
    if (a >= b) continue;
    const k = rk(a, b), st = stateOf(a, b);
    if (lastStates[k] && lastStates[k] !== 'WAR' && st === 'WAR') { logMsg('WAR: ' + FAC[a].name + ' ⚔ ' + FAC[b].name, 'war'); sfx('war'); }
    lastStates[k] = st;
  }
}
function aiUpdate(team: number, dt: number) {
  if (game.eliminated[team]) return;
  const ai = game.ai[team];
  const tShift = FAC[team].persona === 'warlord' ? -25 : (FAC[team].persona === 'merchant' ? 30 : 0);
  while (ai.builtIdx < AI_SCRIPT.length && game.t >= AI_SCRIPT[ai.builtIdx].t + tShift) {
    const step = AI_SCRIPT[ai.builtIdx]; ai.builtIdx++;
    const ba = B[step.type].alloy || 0;
    if (game.money[team] >= B[step.type].cost && ba <= (game.alloy[team] || 0)) {
      if (aiPlace(team, step.type, step.dx, step.dy, false)) { game.money[team] -= B[step.type].cost; game.alloy[team] -= ba; }
    }
  }
  if (game.t > 320) game.money[team] += 6 * dt;
  if (FAC[team].persona === 'merchant') game.money[team] += 4 * dt;
  const harv = game.units.filter(u => u.team === team && u.type === 'harvester').length;
  const tankers = game.units.filter(u => u.team === team && u.type === 'tanker').length;
  const haulers = game.units.filter(u => u.team === team && u.type === 'hauler').length;
  const hasCoolantDepot = game.buildings.some(b => b.team === team && b.type === 'pump' && b.progress >= 1);
  const hasAlloyDepot = game.buildings.some(b => b.team === team && b.type === 'smelter' && b.progress >= 1);
  const foundries = game.buildings.filter(b => b.team === team && b.type === 'foundry' && b.progress >= 1);
  if (foundries.length && foundries[0].queue.length === 0) {
    if (harv < 2 && game.money[team] > 700) { foundries[0].queue.push('harvester'); game.money[team] -= U.harvester.cost; }
    else if (hasCoolantDepot && tankers < 2 && game.money[team] > 800) { foundries[0].queue.push('tanker'); game.money[team] -= U.tanker.cost; }
    else if (hasAlloyDepot && haulers < 2 && game.money[team] > 800) { foundries[0].queue.push('hauler'); game.money[team] -= U.hauler.cost; }
  }
  const army = game.units.filter(u => u.team === team && !U[u.type].harvests);
  const countType = (t: string) => game.units.reduce((s, u) => s + (u.team === team && u.type === t ? 1 : 0), 0);
  if (foundries.length && game.money[team] > 900) {
    const f = foundries.find(fo => fo.queue.length < 2);
    if (f) {
      // late-game combined-arms: guarantee a standing core of advanced units…
      let pick: string | null = null;
      if (game.t > 300) {
        if (countType('aircraft') < 3) pick = 'aircraft';
        else if (countType('artillery') < 2) pick = 'artillery';
        else if (countType('walker') < 2) pick = 'walker';
        else if (countType('rocket') < 4) pick = 'rocket';
      }
      // …then fill out the line with a mixed pool up to the army cap
      if (!pick && army.length < 34) {
        const pool = game.t < 300
          ? ['infantry', 'infantry', 'recon', 'strike', 'strike']
          : ['strike', 'walker', 'rocket', 'infantry', 'artillery', 'aircraft'];
        pick = pool[Math.random() * pool.length | 0];
      }
      if (pick) {
        if ((U[pick].alloy || 0) > (game.alloy[team] || 0)) pick = 'strike';   // alloy-starved → basic armor
        if (game.money[team] >= U[pick].cost && (U[pick].alloy || 0) <= (game.alloy[team] || 0)) {
          f.queue.push(pick); game.money[team] -= U[pick].cost; game.alloy[team] -= (U[pick].alloy || 0);
        }
      }
    }
  }
  if (game.t >= ai.nextWave) {
    const enemies = [1, 2, 3, 4].filter(f => f !== team && !game.eliminated[f] && isWar(team, f) && game.buildings.some(b => b.team === f));
    if (enemies.length) {
      enemies.sort((a, b) => getRel(team, a) - getRel(team, b));
      const tgtTeam = enemies[0];
      ai.waveN++;
      const size = Math.min(16, 2 + Math.ceil(ai.waveN * 1.7));
      const squad = army.filter(u => u.order === 'idle').slice(0, size);
      const tBuilds = game.buildings.filter(b => b.team === tgtTeam);
      if (squad.length >= Math.min(3, size) && tBuilds.length) {
        const tb = tBuilds[Math.random() * tBuilds.length | 0];
        for (const u of squad) {
          u.order = 'amove'; u.dest = { x: tb.x + (Math.random() * 120 - 60), y: tb.y + (Math.random() * 120 - 60) };
          setPath(u, u.dest.x, u.dest.y);
        }
        if (tgtTeam === PLAYER || isAllied(PLAYER, tgtTeam)) { logMsg(FAC[team].name + ' strike force inbound — wave ' + ai.waveN, 'war'); sfx('war'); }
        else logMsg(FAC[team].name + ' launches an assault on ' + FAC[tgtTeam].name);
      }
    }
    ai.nextWave = game.t + Math.max(50, 115 - ai.waveN * 8) + Math.random() * 20;
  }
  if (FAC[team].persona === 'covert' && game.t >= ai.covertT) {
    ai.covertT = game.t + 80 + Math.random() * 50;
    const victims = [1, 2, 3, 4].filter(f => f !== team && !game.eliminated[f] && !isAllied(team, f));
    if (victims.length) {
      victims.sort((a, b) => game.money[b] - game.money[a]);
      const v = victims[0];
      if (Math.random() < 0.55) {
        const amt = Math.min(500, Math.max(100, game.money[v] * 0.22)) | 0;
        game.money[v] -= amt; game.money[team] += amt;
        if (v === PLAYER) { logMsg('VANTA CELL siphoned ' + amt + ' crystals from our network', 'war'); sfx('covert'); }
      } else {
        const bl = game.buildings.filter(b => b.team === v && b.type !== 'hq');
        if (bl.length) {
          const pick = bl[Math.random() * bl.length | 0];
          pick.hp = Math.max(pick.hpMax * 0.1, pick.hp - pick.hpMax * 0.3);
          if (v === PLAYER) { logMsg('VANTA CELL sabotaged our ' + B[pick.type].name, 'war'); sfx('war'); spawnParts('fire', pick.x, pick.y, 10, '255,160,60'); }
        }
      }
      if (Math.random() < 0.3) addRel(team, v, -12);
    }
  }
}

// ── Orders, placement, training (player intent) ──────────────────────────────
export function issueOrder(wx: number, wy: number, fromAmove: boolean) {
  const sel = game.selection.filter(s => s.kind === 'u') as Unit[];
  if (!sel.length) {
    const f = game.selection.find(s => s.kind === 'b' && (s as Building).type === 'foundry') as Building | undefined;
    if (f) { f.rally = { x: wx, y: wy }; hint('Rally point set'); }
    return;
  }
  let tgt: Entity | null = null;
  for (const u of game.units) {
    if (isAllied(PLAYER, u.team)) continue;
    if (tileVisible(u.x, u.y) && dist(u, { x: wx, y: wy }) < U[u.type].radius + 8) { tgt = u; break; }
  }
  if (!tgt) for (const b of game.buildings) {
    if (isAllied(PLAYER, b.team)) continue;
    if (tileVisible(b.x, b.y) && Math.abs(wx - b.x) < b.w / 2 && Math.abs(wy - b.y) < b.h / 2) { tgt = b; break; }
  }
  let node = null;
  for (const n of game.nodes) { if (n.amount > 0 && dist(n, { x: wx, y: wy }) < 26) { node = n; break; } }
  if (tgt && !isWar(PLAYER, tgt.team)) {
    const key = 'ag' + tgt.team;
    if (!game.aggroT[key] || game.t - game.aggroT[key] > 10) {
      game.aggroT[key] = game.t; addRel(PLAYER, tgt.team, -10);
      logMsg('Attacking ' + FAC[tgt.team].name + ' — relations −10', 'war');
    }
  }
  let i = 0;
  for (const u of sel) {
    const harvester = !!U[u.type].harvests;
    if (tgt && !harvester && eligibleTarget(u, tgt)) { u.order = 'attack'; u.target = tgt; setPath(u, tgt.x, tgt.y); }
    else if (node && harvester && node.kind === U[u.type].harvests) { u.hNode = node; u.hState = 'go'; u.order = 'idle'; setPath(u, node.x, node.y); }
    else {
      const a = (i / sel.length) * Math.PI * 2, r = i === 0 ? 0 : 14 + 8 * Math.sqrt(i);
      const dx = wx + Math.cos(a) * r, dy = wy + Math.sin(a) * r;
      u.dest = { x: dx, y: dy };
      u.order = fromAmove && !harvester ? 'amove' : 'move'; u.target = null;
      setPath(u, dx, dy);
    }
    i++;
  }
  sfx('click');
}
export function startPlacing(type: string) {
  if (game.money[PLAYER] < B[type].cost) { hint('Insufficient crystals'); return; }
  if ((B[type].alloy || 0) > (game.alloy[PLAYER] || 0)) { hint('Insufficient alloy'); return; }
  game.placing = type; game.armed = null;
  hint('Place ' + B[type].name + ' — right-click to cancel');
}
export function canPlaceHere(type: string, tx: number, ty: number) {
  if (!footprintFree(type, tx, ty)) return false;
  const d = B[type];
  for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) if (!game.explored[idx(x, y)]) return false;
  const cx = (tx + d.w / 2) * TILE, cy = (ty + d.h / 2) * TILE;
  return game.buildings.some(b => b.team === PLAYER && dist(b, { x: cx, y: cy }) < 10 * TILE);
}
export function tryPlace(wx: number, wy: number) {
  const type = game.placing!; const d = B[type];
  const tx = Math.round(wx / TILE - d.w / 2), ty = Math.round(wy / TILE - d.h / 2);
  if (!canPlaceHere(type, tx, ty)) { hint('Cannot deploy here — needs clear, scouted ground near your base'); return; }
  if (game.money[PLAYER] < d.cost) { hint('Insufficient crystals'); game.placing = null; return; }
  if ((d.alloy || 0) > (game.alloy[PLAYER] || 0)) { hint('Insufficient alloy'); game.placing = null; return; }
  game.money[PLAYER] -= d.cost; game.alloy[PLAYER] -= (d.alloy || 0);
  addBuilding(type, tx, ty, PLAYER, false);
  sfx('place', wx); game.placing = null; hint('');
}
export function trainUnit(t: string) {
  const fs = game.buildings.filter(b => b.team === PLAYER && b.type === 'foundry' && b.progress >= 1);
  if (!fs.length) { hint('Build a War Foundry first'); return; }
  if (game.money[PLAYER] < U[t].cost) { hint('Insufficient crystals'); return; }
  if ((U[t].alloy || 0) > (game.alloy[PLAYER] || 0)) { hint('Insufficient alloy — build an Alloy Smelter'); return; }
  fs.sort((a, b) => a.queue.length - b.queue.length);
  game.money[PLAYER] -= U[t].cost; game.alloy[PLAYER] -= (U[t].alloy || 0); fs[0].queue.push(t); sfx('click');
}

// ── Win / lose ───────────────────────────────────────────────────────────────
function checkEnd() {
  if (game.over) return;
  if (!game.buildings.some(b => b.team === PLAYER)) { endGame(false); return; }
  let win = true;
  for (const f of AIS) {
    if (game.eliminated[f]) continue;
    if (!isAllied(PLAYER, f) && game.buildings.some(b => b.team === f)) { win = false; break; }
  }
  if (win) endGame(true);
}
function endGame(win: boolean) {
  game.over = true; game.won = win;
  endHook(win);
}

// ── Per-frame world step (everything except camera/input/render) ─────────────
export function stepWorld(dt: number) {
  game.t += dt;
  game.shake = Math.max(0, game.shake - dt * 14);
  for (const k in game.cooldowns) game.cooldowns[k] = Math.max(0, game.cooldowns[k] - dt);
  for (const k in game.covCd) game.covCd[k] = Math.max(0, game.covCd[k] - dt);
  game.money[PLAYER] += tradeIncome(PLAYER) * dt;
  for (const f of AIS) if (!game.eliminated[f]) game.money[f] += tradeIncome(f) * dt;
  // coolant & alloy also flow across trade pacts (all resources are tradeable)
  for (const team of ALL_TEAMS) {
    if (game.eliminated[team]) continue;
    let partners = 0; for (const f of ALL_TEAMS) if (f !== team && dip.trade[rk(team, f)] && !game.eliminated[f]) partners++;
    if (partners) {
      game.water[team] = clamp((game.water[team] || 0) + partners * 6 * dt, 0, WATER_CAP);
      game.alloy[team] = (game.alloy[team] || 0) + partners * 5 * dt;
    }
  }
  for (const u of game.units) updateUnit(u, dt);
  for (const u of game.units) postAttackCleanup(u);
  separation();
  for (const b of game.buildings) updateBuilding(b, dt);
  updateShots(dt);
  for (const f of AIS) aiUpdate(f, dt);
  dipTickT += dt;
  if (dipTickT >= 5) { dipTickT = 0; diplomacyTick(); }
  regenCrystals(dt);
  waterStep(dt);
  computeVision();
  checkEnd();
}
