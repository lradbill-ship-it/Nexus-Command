import {
  TILE, MAPW, MAPH, WORLD_W, WORLD_H, PLAYER, AIS, ALL_TEAMS, FAC, B, U, ABILITIES, COVERT,
  BASE_INFO, AI_SCRIPT, T_GRASS, T_DIRT, T_ROAD, T_FOREST, T_WATER, STYLES, PERSONA_STYLE,
  EMERGENT_TEAM, resetTeams, addAITeam,
  RELAY_INCOME, RELAY_HP,
  idx, inMap, clamp, dist,
} from './constants';
import type { LeaderStyle } from './constants';
import {
  game, dip, rk, getRel, setRel, addRel, isAllied, isWar, stateOf, logMsg, hint,
} from './state';
import type { Building, Unit, Entity, Vec, Particle, Settlement, Relay, ResourceNode, Vault, Landmark } from './types';
import { findPath, passable, passableFor, nearestPassableTile, resetPathBudget, pathDeferred } from './pathfind';
import { spawnResourceField } from './mapgen';
import { sfx } from '../audio';

// ── Renderer / UI hooks (sim never imports the renderer or DOM directly) ──────
let scorchHook: (x: number, y: number, r: number) => void = () => {};
export function setScorchHook(fn: (x: number, y: number, r: number) => void) { scorchHook = fn; }
let endHook: (win: boolean) => void = () => {};
export function setEndHook(fn: (win: boolean) => void) { endHook = fn; }
let clearForestHook: (tx: number, ty: number) => void = () => {};
export function setClearForestHook(fn: (tx: number, ty: number) => void) { clearForestHook = fn; }
let dryWaterHook: (tx: number, ty: number) => void = () => {};
export function setDryWaterHook(fn: (tx: number, ty: number) => void) { dryWaterHook = fn; }
let emergeHook: (team: number) => void = () => {};   // renderer bakes textures for a faction that emerges mid-match
export function setEmergeHook(fn: (team: number) => void) { emergeHook = fn; }

// Transient module locals — reset on each new match.
let nextId = 1;
let dipTickT = 0;
let lastStates: Record<string, string> = {};
let lastHintT = 0;
let crystalT = 55;   // first new formation seeds ~55s in
let autoScout = false;   // when on, idle Recon Drones auto-reveal the map (scouts-only auto-explore)
let autoScoutT = 0;      // throttle accumulator for auto-scout order assignment
let aiAccum = 0;         // throttle accumulator for the strategic AI pass (build/train/wave) — not needed at 60Hz
let visionAccum = 0;     // throttle accumulator for player fog-of-war recompute (~15Hz is imperceptible)
type Strike = { x: number; y: number; at: number; team: number; kind: 'nuke' | 'thermo' | 'orbital' | 'carpet' };
let pendingStrikes: Strike[] = [];   // in-flight missiles → detonate when game.t >= at (unless intercepted)
// ── Ceasefire / sue-for-peace state ──────────────────────────────────────────
let peaceCd: Record<string, number> = {};      // pair key → game.t until which the player can't re-propose peace (anti-spam)
let aiPeaceOffer: Record<number, number> = {}; // AI team → game.t until which it is standing-offering the player a free ceasefire
let lastPeaceLog: Record<number, number> = {}; // AI team → game.t of its last "sues for peace" feed line (throttle)
export function pendingStrikeList(): readonly Strike[] { return pendingStrikes; }
export function resetSimLocals() { nextId = 1; dipTickT = 0; lastStates = {}; lastHintT = 0; crystalT = 55; autoScout = false; autoScoutT = 0; aiAccum = 0; visionAccum = 0; militiaT = 0; uprisings = 0; legionFounded = false; pendingStrikes = []; lastWoodNag = -9; peaceCd = {}; aiPeaceOffer = {}; lastPeaceLog = {}; stealthT = 0; mineTrip = 0; respawnQueue = []; campaignDmgMul = 1; campaignHpMul = 1; }

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
  for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) { game.occupied[idx(x, y)] = 1; if (type === 'gate') game.gate[idx(x, y)] = team; }
  game.buildings.push(b); return b;
}
function removeBuildingTiles(b: Building) {
  const d = B[b.type];
  for (let y = b.ty; y < b.ty + d.h; y++) for (let x = b.tx; x < b.tx + d.w; x++) { game.occupied[idx(x, y)] = 0; game.gate[idx(x, y)] = 0; }
}
export function addUnit(type: string, x: number, y: number, team: number): Unit {
  const u: Unit = {
    id: nextId++, kind: 'u', type, team, x, y, hpMax: U[type].hp, hp: U[type].hp,
    order: 'idle', dest: null, target: null, path: null, repathT: 0, stuckT: 0, lx: x, ly: y,
    cooldown: 0, disabledUntil: 0, cargo: 0, hNode: null, hState: 'find',
    facing: Math.random() * 7, aim: Math.random() * 7, bob: Math.random() * 7,
    moving: false, trailT: 0, lastShot: -9,
  };
  if (team === PLAYER && campaignHpMul !== 1) { u.hpMax = Math.round(u.hpMax * campaignHpMul); u.hp = u.hpMax; }   // Conquest War-Tech: tougher campaign units
  game.units.push(u); return u;
}
// Conquest War-Tech: persistent player army upgrades applied per campaign battle (1 = none, set after newMatch).
let campaignDmgMul = 1, campaignHpMul = 1;
export function setCampaignBuffs(dmgMul: number, hpMul: number) { campaignDmgMul = dmgMul; campaignHpMul = hpMul; }
function freeSpotNear(x: number, y: number): Vec {
  for (let r = 0; r < 12; r++) for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, px = x + Math.cos(a) * r * 20, py = y + Math.sin(a) * r * 20;
    if (passable(px / TILE | 0, py / TILE | 0)) return { x: px, y: py };
  }
  return { x, y };
}
/** Flood-fill the passable region containing (tx,ty); returns min(reachable tiles, cap). Small = a walled-off pocket. */
function regionSize(tx: number, ty: number, cap: number): number {
  if (!passable(tx, ty)) return 0;
  const seen = new Set<number>([idx(tx, ty)]); const q = [idx(tx, ty)]; let n = 0;
  while (q.length && n < cap) {
    const c = q.pop()!; n++; const cx = c % MAPW, cy = c / MAPW | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
      const nx = cx + dx, ny = cy + dy; if (!inMap(nx, ny) || !passable(nx, ny)) continue;
      const ni = idx(nx, ny); if (seen.has(ni)) continue; seen.add(ni); q.push(ni);
    }
  }
  return n;
}
/** Nearest spot to (x,y) that sits in a LARGE connected open region — not a rock-locked pocket. For unearthing an
 *  excavated hero from a vault buried deep in a mountain so it can actually walk out onto the map. */
function reachableSpotNear(x: number, y: number): Vec {
  const ctx = x / TILE | 0, cty = y / TILE | 0;
  for (let r = 0; r < 28; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // ring shell
    const tx = ctx + dx, ty = cty + dy;
    if (!inMap(tx, ty) || !passable(tx, ty)) continue;
    if (regionSize(tx, ty, 200) >= 200) return { x: tx * TILE + 16, y: ty * TILE + 16 };   // connected to the open map
  }
  return freeSpotNear(x, y);   // whole area is enclosed → fall back (rare)
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
  resetTeams();                                    // drop any emergent faction from a previous match (back to the base 6)
  for (const team of ALL_TEAMS) {
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
    game.ai[team] = { builtIdx: 0, nextWave: 0, waveN: 0, covertT: 120 + Math.random() * 60, missileT: 480 + Math.random() * 120, techT: 0, empT: 300 + Math.random() * 120, hijackT: 380 + Math.random() * 140, buffT: 280 + Math.random() * 120, mineT: 320 + Math.random() * 120 };
    game.ai[team].nextWave = FAC[team].persona === 'warlord' ? 130 + Math.random() * 40 : 180 + Math.random() * 60;
  }
  for (const f of ALL_TEAMS) setRel(0, f, -100);   // the Free Militia (team 0) is at war with every faction
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
  for (const s of game.settlements) if (s.owner && isAllied(PLAYER, s.owner)) stamp(s.x, s.y, 5);
  for (const r of game.relays) if (r.owner && isAllied(PLAYER, r.owner)) stamp(r.x, r.y, 6);
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
  let n = 0; for (const f of ALL_TEAMS) if (f !== team && dip.trade[rk(team, f)] && !game.eliminated[f]) n++;
  return n * 9;
}

// ── Coolant (secondary resource) ──────────────────────────────────────────────
// Pumps & the HQ produce coolant; walkers, artillery, gunships and flak consume
// it. When a team's reserve runs dry in deficit it OVERHEATS — those weapons fire
// at half rate until coolant is restored (build more Coolant Plants).
export const WATER_CAP = 600;
const COOLANT_IDLE = 0.25;   // idle units only sip coolant — engines cool when not moving or firing
export function waterOf(team: number) {
  let prod = 0, cons = 0;
  for (const b of game.buildings) {
    if (b.team !== team || b.progress < 1) continue;
    prod += B[b.type].water || 0; cons += B[b.type].coolant || 0;
  }
  // Units consume FULL coolant only while active (moving or recently fired); stationed/idle units sip a
  // fraction. So a standing defensive force is cheap to keep — coolant is a cost of active combat & maneuver.
  for (const u of game.units) if (u.team === team) {
    const c = U[u.type].coolant || 0; if (!c) continue;
    const active = u.moving || (game.t - (u.lastShot ?? -9) < 3);
    cons += c * (active ? 1 : COOLANT_IDLE);
  }
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

// ── Society: civilian population & happiness (DESIGN_SPEC_v4 §3) ──────────────
// Population is FLAVOUR/ECONOMY + leverage, never a win condition. A happy,
// well-housed populace works faster (labor) and can be conscripted; an unhappy
// one strikes (slow economy) and, if neglected, revolts (citizens flee, troops desert).
export function housingCap(team: number) {
  let c = 0; for (const b of game.buildings) if (b.team === team && b.progress >= 1) c += B[b.type].house || 0;
  return c;
}
export function civicOf(team: number) {
  let c = 0; for (const b of game.buildings) if (b.team === team && b.progress >= 1) c += B[b.type].civic || 0;
  return c;
}
function warCount(team: number) {
  let n = 0; for (const f of ALL_TEAMS) if (f !== team && !game.eliminated[f] && isWar(team, f)) n++;
  return n;
}
/** Happiness target a faction is drifting toward, from housing, economy, civics & war stress. */
export function happyTarget(team: number) {
  const cap = housingCap(team), pop = game.pop[team] || 0;
  let t = 46;
  t += pop < cap ? 14 : -18;                         // room to grow vs overcrowding
  t += game.money[team] > 400 ? 10 : (game.money[team] < 80 ? -16 : 0);   // prosperity vs poverty
  t += Math.min(24, civicOf(team));                  // civic needs met (markets, HQ)
  t -= warCount(team) * 5;                            // the stress of war
  t -= game.conscriptPenalty[team] || 0;             // recent forced levies
  t += styleMod(team).happy ?? 0;                    // Populist leadership lifts spirits
  return clamp(t, 0, 100);
}
/** Labor multiplier on harvest & build speed — thriving societies out-produce miserable ones. */
export function laborFactor(team: number) {
  const h = game.happy[team] ?? 60;
  const base = clamp(0.7 + h / 100 * 0.5, 0.7, 1.2);  // 0.7 (revolt) … 1.2 (utopia)
  const pen = (game.pop[team] || 0) < 4 ? Math.min(base, 0.9) : base;   // a ghost town can't fully staff
  return pen * (styleMod(team).labor ?? 1);            // Industrialist leadership boosts output
}

// ── Government: active leader style & its faction-wide modifiers (§4) ─────────
export const styleMod = (team: number) => STYLES[game.leader[team] || 'industrialist'];
export function setLeader(team: number, style: LeaderStyle) { game.leader[team] = style; }
/** Discounted alloy cost for a unit/building def, given the team's leader (Technocrat = cheaper). */
export const alloyCost = (team: number, alloy: number | undefined) => Math.round((alloy || 0) * (styleMod(team).alloyDisc ?? 1));

// ── Elections & coups (§4 — "balanced": real levers, uncertain outcome) ──────
const STYLE_KEYS = Object.keys(STYLES) as LeaderStyle[];
const randStyleExcept = (s: LeaderStyle) => { const o = STYLE_KEYS.filter(k => k !== s); return o[Math.random() * o.length | 0]; };
function resolveElection(team: number) {
  const approval = clamp((game.happy[team] ?? 60) + (game.campaign[team] || 0) + 6, 0, 100);
  const plat = game.platform[team] || game.leader[team];
  if (Math.random() * 100 < approval) {                          // mandate → adopt the platform you ran on
    game.leader[team] = plat;
    if (team === PLAYER) { logMsg('ELECTION WON — ' + STYLES[plat].name + ' mandate (' + Math.round(approval) + '% approval)', 'good'); sfx('chime'); }
  } else {                                                        // voted out → opposition doctrine imposed
    const opp = randStyleExcept(plat);
    game.leader[team] = opp; game.platform[team] = opp;
    game.happy[team] = clamp((game.happy[team] ?? 60) - 6, 0, 100);
    if (team === PLAYER) { logMsg('ELECTION LOST — opposition installs the ' + STYLES[opp].name + ' doctrine', 'war'); sfx('war'); }
  }
  game.campaign[team] = 0;
  game.electionT[team] = game.t + 240 + Math.random() * 60;
}
function triggerCoup(team: number) {
  game.coupT[team] = 0;
  const opp = randStyleExcept(game.leader[team]);
  game.leader[team] = opp; game.platform[team] = opp;
  game.happy[team] = clamp((game.happy[team] ?? 60) + 16, 0, 100);  // a new regime briefly placates the street
  game.electionT[team] = game.t + 180;
  if (team === PLAYER) { logMsg('COUP — your government is overthrown; the ' + STYLES[opp].name + ' bloc seizes power', 'war'); sfx('war'); }
  else logMsg(FAC[team].name + ' is rocked by a coup — its ' + STYLES[opp].name + ' bloc takes power', 'hot');
}
function governmentTick(dt: number) {
  for (const team of ALL_TEAMS) {
    if (game.eliminated[team]) continue;
    game.campaign[team] = Math.max(0, (game.campaign[team] || 0) - 1.5 * dt);   // campaign buzz fades
    if (game.t >= (game.electionT[team] ?? 1e9)) resolveElection(team);
    const h = game.happy[team] ?? 60;                            // sustained misery → coup risk
    game.coupT[team] = h < 22 ? (game.coupT[team] || 0) + dt : Math.max(0, (game.coupT[team] || 0) - dt * 0.5);
    if ((game.coupT[team] || 0) > 40 && Math.random() < dt * 0.05) triggerCoup(team);
  }
}
export function setPlatform(style: LeaderStyle) { game.platform[PLAYER] = style; }
export function campaignRally() {
  const COST = 220;
  if (game.money[PLAYER] < COST) { hint('A campaign rally costs ' + COST + ' crystals'); return; }
  game.money[PLAYER] -= COST; game.campaign[PLAYER] = Math.min(45, (game.campaign[PLAYER] || 0) + 15);
  logMsg('Campaign rally held — election approval boosted', 'good'); sfx('chime');
}
/** Incite a coup against the current covert target (needs a Cyber Ops Center). */
export function launchCoup() {
  const tgt = game.covTarget;
  if (!hasCyber()) { hint('Inciting a coup needs a Cyber Ops Center'); return; }
  if (game.eliminated[tgt] || isAllied(PLAYER, tgt)) { hint('Choose a rival faction first'); return; }
  const COST = 600;
  if (game.money[PLAYER] < COST) { hint('Inciting a coup costs ' + COST + ' crystals'); return; }
  game.money[PLAYER] -= COST; sfx('covert');
  const chance = clamp(0.72 - (game.happy[tgt] ?? 60) / 200, 0.2, 0.72);   // unhappy regimes fall easier
  if (Math.random() < chance) { logMsg('Covert coup — ' + FAC[tgt].name + ' government toppled', 'good'); triggerCoup(tgt); }
  else { addRel(PLAYER, tgt, -22); logMsg('Coup plot against ' + FAC[tgt].name + ' EXPOSED — relations −22', 'war'); sfx('war'); }
}
export const nextElectionIn = () => Math.max(0, (game.electionT[PLAYER] ?? 0) - game.t);
export const approvalEst = () => clamp((game.happy[PLAYER] ?? 60) + (game.campaign[PLAYER] || 0) + 6, 0, 100);

function societyTick(dt: number) {
  for (const team of ALL_TEAMS) {
    if (game.eliminated[team]) continue;
    // happiness drifts toward its target
    const tgt = happyTarget(team);
    game.happy[team] = clamp((game.happy[team] ?? 60) + clamp(tgt - game.happy[team], -8 * dt, 8 * dt), 0, 100);
    game.conscriptPenalty[team] = Math.max(0, (game.conscriptPenalty[team] || 0) - 3 * dt);
    // population grows toward housing when content; emigrates when overcrowded or miserable
    const cap = housingCap(team), h = game.happy[team];
    let p = game.pop[team] || 0;
    if (h > 40 && p < cap) p += (0.6 + h / 100 * 1.4) * dt;        // births / immigration
    if (p > cap) p -= (p - cap) * 0.06 * dt;                        // overcrowding emigration
    if (h < 20) p -= (20 - h) * 0.05 * dt;                          // unrest: citizens flee
    game.pop[team] = Math.max(0, p);
    // revolt: sustained misery makes troops desert (recoverable, never an instant loss).
    // Probability scales with how miserable they are, so neglect compounds.
    if (h < 18 && Math.random() < dt * 0.14 * ((18 - h) / 18)) {
      const army = game.units.filter(u => u.team === team && !isSupport(u.type) && !U[u.type].hero);   // heroes never desert
      if (army.length > 3) {
        const u = army[Math.random() * army.length | 0]; destroy(u, 0);
        if (team === PLAYER) { logMsg('UNREST — a unit has deserted. Calm your population!', 'war'); sfx('war'); }
      }
    }
  }
}
/** Turn civilians into a soldier instantly — the population as a military reserve. */
export function conscript(team: number) {
  const COST = Math.max(6, Math.round(15 * (styleMod(team).recruitDisc ?? 1)));   // Populist mobilises cheaply
  if ((game.pop[team] || 0) < COST) { if (team === PLAYER) hint('Not enough population to conscript'); return; }
  const hq = game.buildings.find(b => b.team === team && b.type === 'hq') || game.buildings.find(b => b.team === team);
  if (!hq) return;
  game.pop[team] -= COST;
  game.conscriptPenalty[team] = Math.min(30, (game.conscriptPenalty[team] || 0) + 5);   // forced levy stings
  const s = freeSpotNear(hq.x, hq.y + hq.h * 0.6 + 18);
  addUnit('infantry', s.x, s.y, team);
  if (team === PLAYER) { logMsg('Conscripted a Rifle Trooper from the population', 'hot'); sfx('place', hq.x); }
}

// ── Neutral settlements: recruit / persuade / intimidate (DESIGN_SPEC_v4 §3.2) ─
const SETTLE_R = 4 * TILE;   // capture influence radius
const SETTLE_INCOME = 0.05;  // crystals/sec per population point an owned settlement yields (civilian economy)
// ── Civilian diplomacy: Envoys court neutral towns (peaceful annexation) & develop owned ones ──
const AFFINITY_JOIN = 100;   // goodwill at which a courted neutral town voluntarily joins the courting faction
const AFFINITY_COURT = 6.5;  // goodwill/sec a stationed Envoy builds (≈15s for one envoy; faster with several)
const AFFINITY_DECAY = 2.0;  // goodwill/sec a town loses toward a faction no longer courting it
const DEV_MAX = 3;           // development tiers an owned town can reach
const DEV_BASE = 0.05;       // tier-progress/sec for a peaceful, owned town (≈20s/tier on its own)
const DEV_ENVOY = 0.12;      // extra tier-progress/sec while one of the owner's Envoys is stationed there
const DEV_COST = 1.1;        // crystals/sec the owner invests while a town is developing ("developed for them")
const DEV_POP_CAP = 60;      // a fully-developed town grows its population toward this
function captureSettlement(s: Settlement, team: number, militaryOnly: boolean, peaceful = false) {
  const prev = s.owner;
  if (prev === team) return;                                     // already ours — nothing to do
  s.owner = team; s.capT = 0; s.capBy = 0; s.unrest = 0; s.affinity = {};   // capture resets any courtship
  if (prev) game.pop[prev] = Math.max(0, (game.pop[prev] || 0) - s.pop);   // population TRANSFERS (no longer duplicated each flip)
  game.pop[team] = (game.pop[team] || 0) + s.pop;                // its citizens join the new owner
  // intimidated (troops only) subjects resent it; recruited ones welcome it; a peacefully-courted town joins gladly
  game.happy[team] = clamp((game.happy[team] ?? 60) + (militaryOnly ? -6 : peaceful ? 12 : 6), 0, 100);
  if (peaceful && prev === 0) s.dev = Math.max(s.dev || 0, 0.4);  // a town won over by diplomacy starts part-developed (loyalty head-start)
  // conquest windfall — looted stores + citizens taking up arms — ONLY when LIBERATING a NEUTRAL town.
  // Seizing it from another faction grants no fresh loot/recruits, so factions can't ping-pong a contested town to farm it.
  if (prev === 0) {
    const loot = Math.round(s.pop * 8);
    game.money[team] = (game.money[team] || 0) + loot;
    const recruits = Math.min(3, 1 + (s.pop / 14 | 0));
    for (let i = 0; i < recruits; i++) { const sp = freeSpotNear(s.x, s.y); addUnit('infantry', sp.x, sp.y, team); }
    if (team === PLAYER) { logMsg((militaryOnly ? 'Intimidated' : peaceful ? 'Peacefully won over' : 'Won over') + ' a settlement — +' + s.pop + ' pop, +' + loot + ' crystals, ' + recruits + ' recruits', 'good', { x: s.x, y: s.y }); sfx('chime'); }
  } else {
    if (team === PLAYER) { logMsg((militaryOnly ? 'Seized' : 'Annexed') + ' a settlement — +' + s.pop + ' pop', 'good'); sfx('chime'); }
    else if (prev === PLAYER) { logMsg(FAC[team].name + ' has seized one of our settlements', 'war'); sfx('war'); }
  }
}
function settlementTick(dt: number) {
  for (const s of game.settlements) {
    const army: Record<number, number> = {}, civ: Record<number, number> = {}, envoy: Record<number, number> = {};
    forNearbyUnits(s.x, s.y, SETTLE_R, (u) => {
      if (dist(u, s) > SETTLE_R) return;
      if (U[u.type].diplomat) envoy[u.team] = (envoy[u.team] || 0) + 1;          // diplomats court (affinity), they don't presence-capture
      else if (isSupport(u.type)) civ[u.team] = (civ[u.team] || 0) + 1;
      else army[u.team] = (army[u.team] || 0) + 1;
    });
    const present = new Set<number>([...Object.keys(army), ...Object.keys(civ), ...Object.keys(envoy)].map(Number));
    const capForce = (t: number) => (army[t] || 0) + (civ[t] || 0);              // troops/workers flip a town by presence; lone envoys don't
    const challengers = [...present].filter(t => t !== s.owner && t !== 0 && capForce(t) > 0);   // militia (team 0) raid, they don't capture
    const ownerDefending = !!s.owner && capForce(s.owner) > 0;                   // the current owner has troops/workers on it → it's defended
    const enemyArmy = Object.keys(army).map(Number).filter(t => t !== s.owner && t !== 0);   // contesting military presence

    // ── Peaceful courtship: Envoys win over a NEUTRAL town's people over time ──
    s.affinity = s.affinity || {};
    let courtTeam = 0, joined = false;
    if (!s.owner) {
      const courting = Object.keys(envoy).map(Number).filter(t => t > 0);
      for (const t of Object.keys(s.affinity).map(Number)) {                     // decay goodwill for anyone no longer courting
        if (!courting.includes(t)) s.affinity[t] = Math.max(0, (s.affinity[t] || 0) - AFFINITY_DECAY * dt);
      }
      for (const t of courting) s.affinity[t] = Math.min(AFFINITY_JOIN, (s.affinity[t] || 0) + AFFINITY_COURT * dt);
      let bestAff = 0;                                                           // the leading courter (for the capture-ring readout)
      for (const t of courting) { const a = s.affinity[t] || 0; if (a > bestAff) { bestAff = a; courtTeam = t; } }
      // a fully-courted town joins peacefully — provided no rival's army is contesting it
      if (courtTeam && (s.affinity[courtTeam] || 0) >= AFFINITY_JOIN && enemyArmy.filter(t => t !== courtTeam).length === 0) {
        captureSettlement(s, courtTeam, false, true); joined = true;
      }
    }

    if (!joined) {
      if (challengers.length === 1 && !ownerDefending) {            // sole challenger, owner not defending → takeover
        const team = challengers[0];
        s.capBy = team; s.capT += dt / 6;                           // ~6s of presence to flip
        if (s.capT >= 1) captureSettlement(s, team, !civ[team] && !!army[team]);   // troops-only ⇒ intimidation
      } else if (!s.owner && courtTeam && challengers.length === 0) {
        s.capBy = courtTeam; s.capT = (s.affinity[courtTeam] || 0) / AFFINITY_JOIN;   // surface courtship in the capture ring
      } else if (challengers.length === 0) {
        s.capT = Math.max(0, s.capT - dt / 10); if (s.capT === 0) s.capBy = 0;    // unattended → cools off
      } else {
        s.capT = Math.max(0, s.capT - dt / 18);                     // contested → stalls
      }
    }

    // ── Owned town: scaled income + development (invest crystals → richer infrastructure) ──
    if (s.owner) {
      const tier = Math.floor(s.dev || 0);
      game.money[s.owner] += s.pop * SETTLE_INCOME * (1 + tier * 0.6) * dt;       // yields grow with development
      if (tier >= 2) game.water[s.owner] = (game.water[s.owner] || 0) + s.pop * 0.012 * dt;   // a developed town refines coolant
      if (tier >= 3) game.alloy[s.owner] = (game.alloy[s.owner] || 0) + s.pop * 0.006 * dt;   // …and works alloy
      const peaceful = enemyArmy.length === 0;
      if (peaceful && (s.dev || 0) < DEV_MAX && game.money[s.owner] > DEV_COST) {
        const before = Math.floor(s.dev || 0);
        s.dev = Math.min(DEV_MAX, (s.dev || 0) + (DEV_BASE + (envoy[s.owner] ? DEV_ENVOY : 0)) * dt);
        game.money[s.owner] -= DEV_COST * dt;                       // the investment ("must be developed for them")
        if (s.pop < DEV_POP_CAP) s.pop += ((DEV_POP_CAP - s.pop) * 0.02 + 0.03) * dt;   // a thriving town grows
        const after = Math.floor(s.dev);
        if (after > before) {                                       // reached a new development tier
          game.pop[s.owner] = (game.pop[s.owner] || 0) + 6;
          if (after >= 3) { const sp = freeSpotNear(s.x, s.y); addUnit('infantry', sp.x, sp.y, s.owner); }   // a fully-built town raises a local guard
          if (s.owner === PLAYER) { logMsg('A settlement advanced to development tier ' + after + ' — richer yields' + (after >= 3 ? ' & a local guard' : ''), 'good', { x: s.x, y: s.y }); sfx('chime'); }
        }
      }
    }
    // Civilian uprising: a large, ungoverned (neutral, uncontested) town foments unrest → an armed mob takes up arms
    if (!s.owner && s.pop >= UPRISING_POP && challengers.length === 0) {
      s.unrest = (s.unrest || 0) + dt;
      const militiaN = game.units.reduce((n, u) => n + (u.team === 0 ? 1 : 0), 0);
      if (s.unrest >= UPRISING_TIME && militiaN < MILITIA_CAP) {
        s.unrest = 0; uprisings++;
        const team = legionFounded ? EMERGENT_TEAM : 0;            // once organized, recruits join the Legion
        const n = 2 + (Math.random() * 3 | 0);
        for (let i = 0; i < n; i++) { const sp = freeSpotNear(s.x, s.y); const m = addUnit('militia', sp.x, sp.y, team); if (team === 0) orderMilitia(m); }
        s.pop = Math.max(8, s.pop - n * 3);                        // fighters leave the town
        const nearPlayer = game.buildings.some(b => isAllied(PLAYER, b.team) && dist(b, s) < 22 * TILE);
        if (nearPlayer) { logMsg('⚠ A FREE MILITIA has risen up from an ungoverned settlement nearby!', 'war', { x: s.x, y: s.y }); sfx('war'); }
        else logMsg('A Free Militia has risen up from an ungoverned settlement.', undefined, { x: s.x, y: s.y });
        if (!legionFounded && uprisings >= EMERGE_UPRISINGS) emergeFaction(s);   // sustained unrest coalesces into a real faction
      }
    } else if (s.unrest) s.unrest = Math.max(0, s.unrest - dt * 0.5);
  }
}
// ── Free Militia (team 0): unaligned hostiles spawned by ungoverned settlements ──────────────
const UPRISING_POP = 26;     // a neutral town this large with nobody governing it grows restless
const UPRISING_TIME = 75;    // seconds of neglect before it boils over into an armed mob
const MILITIA_CAP = 32;      // global cap on live militia so an uprising can't run away
const EMERGE_UPRISINGS = 3;  // after this many uprisings, the movement coalesces into the Free Legion (team 7)
let militiaT = 0;
let uprisings = 0;
let legionFounded = false;
function orderMilitia(u: Unit) {                                  // send a militiaman at the nearest faction structure
  let best: Building | null = null, bd = Infinity;
  for (const b of game.buildings) { const d = dist(u, b); if (d < bd) { bd = d; best = b; } }
  if (best) { u.order = 'amove'; u.dest = { x: best.x, y: best.y }; setPath(u, best.x, best.y); }
}
function militiaTick(dt: number) {
  militiaT += dt; if (militiaT < 1.5) return; militiaT = 0;       // idle militia periodically pick a new target to march on
  for (const u of game.units) if (u.team === 0 && u.order === 'idle') orderMilitia(u);
}

// ── Emergent faction: the uprisings coalesce into the FREE LEGION (team 7), a full faction ──────
/** Initialise every per-team state slice for a faction created mid-match (mirrors createGame's defaults). */
function initFactionState(T: number) {
  game.money[T] = 3500; game.water[T] = 60; game.alloy[T] = 250; game.wood[T] = 0;
  game.overheat[T] = false; game.pop[T] = 30; game.happy[T] = 58; game.conscriptPenalty[T] = 0;
  game.leader[T] = PERSONA_STYLE[FAC[T].persona]; game.platform[T] = game.leader[T];
  game.electionT[T] = game.t + 270; game.campaign[T] = 0; game.coupT[T] = 0; game.aggroT[T] = 0;
  game.eliminated[T] = false;
  game.ai[T] = { builtIdx: 0, nextWave: game.t + 45, waveN: 0, covertT: game.t + 140, missileT: game.t + 320, techT: 0, empT: game.t + 220, hijackT: game.t + 260, buffT: game.t + 200, mineT: game.t + 240 };
}
/** Found the Free Legion at an uprising's settlement: a stronghold, a starter economy, a warband, diplomacy. */
function emergeFaction(s: Settlement) {
  const T = EMERGENT_TEAM;
  legionFounded = true;
  addAITeam(T);
  initFactionState(T);
  const tx = clamp(s.x / TILE | 0, 2, MAPW - 4), ty = clamp(s.y / TILE | 0, 2, MAPH - 4);
  BASE_INFO[T] = { tx, ty, sx: 1, sy: 1 };                        // anchor so the AI's base-relative logic works
  s.owner = T; s.capT = 0; s.capBy = 0; s.unrest = 0;            // their birthplace becomes their seat
  // stronghold + starter economy near the settlement
  if (!aiPlace(T, 'hq', 0, 0, true)) addBuilding('hq', tx, ty, T, true);
  aiPlace(T, 'power', -2, 3, true);
  aiPlace(T, 'refinery', 3, 1, true);
  let sp = freeSpotNear((tx + 3) * TILE, (ty + 4) * TILE); addUnit('harvester', sp.x, sp.y, T);
  // every risen militiaman rallies to the Legion
  for (const u of game.units) if (u.team === 0) { u.team = T; u.order = 'idle'; u.target = null; u.path = null; }
  // a founding warband so the new faction is an immediate threat, not a pushover
  for (let i = 0; i < 5; i++) { sp = freeSpotNear((tx + (Math.random() * 6 - 3)) * TILE, (ty + 4 + Math.random() * 2) * TILE); addUnit(i < 3 ? 'strike' : 'rocket', sp.x, sp.y, T); }
  // diplomacy: at war with the player + the faction in whose territory it rose; tense (not war) with the rest
  let near = PLAYER, nd = Infinity;
  for (const f of [2, 3, 4, 5, 6]) { const b = game.buildings.find(bb => bb.team === f); if (b) { const d = dist(b, s); if (d < nd) { nd = d; near = f; } } }
  for (const f of ALL_TEAMS) { if (f === T) continue; setRel(T, f, (f === PLAYER || f === near) ? -80 : -15); }
  emergeHook(T);                                                  // renderer bakes team-7 textures before they render
  logMsg('⚠ THE FREE LEGION HAS RISEN — a faction forged from the uprisings now contests the map!', 'war', { x: s.x, y: s.y }); sfx('war');
  game.shake = Math.min(13, game.shake + 7);
}

// ── Command Relays — income + vision objective points (§5) ───────────────────
const RELAY_R = 4 * TILE;
function captureRelay(r: Relay, team: number) {
  const prev = r.owner;
  r.owner = team; r.capT = 0; r.capBy = 0;
  game.parts.push({ type: 'ring', x: r.x, y: r.y, t: 0, life: 0.7, big: true });
  if (team === PLAYER) { logMsg('Command Relay secured — bonus income & vision', 'good', { x: r.x, y: r.y }); sfx('chime'); }
  else if (prev === PLAYER) { logMsg(FAC[team].name + ' has seized a Command Relay from us', 'war', { x: r.x, y: r.y }); sfx('war'); }
  else if (isAllied(PLAYER, team)) logMsg(FAC[team].name + ' (ally) secured a Command Relay', 'good', { x: r.x, y: r.y });
}
function relayTick(dt: number) {
  for (const r of game.relays) {
    const present: Record<number, number> = {};
    let assault = 0; const attackers = new Set<number>();           // non-owner military firepower on an owned relay
    forNearbyUnits(r.x, r.y, RELAY_R, (u) => {
      if (dist(u, r) > RELAY_R) return;
      present[u.team] = (present[u.team] || 0) + 1;
      if (r.owner && u.team !== r.owner && (U[u.type].dmg || 0) > 0) { assault += U[u.type].dmg!; attackers.add(u.team); }
    });
    if (r.owner) {
      // an OWNED relay can't be flipped by presence — it must be shot offline first
      const defended = !!present[r.owner];
      if (assault > 0 && !defended) {                               // undefended + under fire → the hold breaks down
        r.hp -= assault * 1.5 * dt;
        for (const t of attackers) if (!isWar(t, r.owner)) addRel(t, r.owner, -3 * dt);   // shelling a non-enemy's relay sours relations → eventually war
        if (Math.random() < dt * 9) game.parts.push({ type: 'flash', x: r.x + (Math.random() * 22 - 11), y: r.y + (Math.random() * 22 - 11), t: 0, life: 0.16 });
        if (attackers.has(PLAYER) && game.t % 3 < dt) hint('Assaulting ' + FAC[r.owner].name + "'s relay — knock it offline to take it");
        if (r.hp <= 0) {                                            // knocked offline → reverts to neutral, then re-takeable by presence
          const prev = r.owner; r.owner = 0; r.hp = r.hpMax; r.capT = 0; r.capBy = 0;
          game.parts.push({ type: 'ring', x: r.x, y: r.y, t: 0, life: 0.7, big: true });
          if (prev === PLAYER) { logMsg('A Command Relay was knocked offline!', 'war'); sfx('war'); }
          else if (attackers.has(PLAYER)) { logMsg('Enemy relay knocked offline — move in to seize it', 'good'); sfx('chime'); }
        }
      } else if (r.hp < r.hpMax) {
        r.hp = Math.min(r.hpMax, r.hp + r.hpMax * 0.02 * dt);        // unthreatened (or defended) → the hold recovers
      }
      game.money[r.owner] += RELAY_INCOME * dt;                     // income + vision while held
    } else {
      // NEUTRAL relay → taken by presence (uncontested)
      const challengers = Object.keys(present).map(Number).filter(t => t !== 0);
      if (challengers.length === 1) {
        const team = challengers[0];
        r.capBy = team; r.capT += dt / 7;
        if (r.capT >= 1) captureRelay(r, team);
      } else if (Object.keys(present).length === 0) {
        r.capT = Math.max(0, r.capT - dt / 12); if (r.capT === 0) r.capBy = 0;
      } else {
        r.capT = Math.max(0, r.capT - dt / 20);                     // contested → stalls
      }
    }
  }
}
/** Player pays to instantly win over a settlement near their forces (the "recruit" path). */
export function tryRecruit(s: Settlement): boolean {
  const COST = Math.round(160 * (styleMod(PLAYER).recruitDisc ?? 1));
  if (s.owner === PLAYER) return false;
  const near = game.units.some(u => isAllied(PLAYER, u.team) && dist(u, s) < SETTLE_R + 20);
  if (!near) { hint('Move a unit next to the settlement to recruit it'); return false; }
  if (game.money[PLAYER] < COST) { hint('Recruiting costs ' + COST + ' crystals'); return false; }
  game.money[PLAYER] -= COST; captureSettlement(s, PLAYER, false);
  return true;
}

// ── Legendary Landmarks: ancient monoliths only a SPECIAL CHARACTER can claim ──
// A held monolith trickles resources to its owner AND radiates a bonus themed to the
// character that claimed it (slice of the "character quest" idea, on one shared mechanic).
const LANDMARK_R = 3 * TILE;       // a special character must stand this close to channel a claim
const LANDMARK_CLAIM = 5;          // seconds of channeling for a full claim
const LANDMARK_INCOME = 4;         // base crystal/sec trickle while held
const LANDMARK_ALLOY = 0.5;        // base alloy/sec trickle while held
const LANDMARK_WINDFALL = 600;     // one-time credit payoff on claiming
const LANDMARK_FX_R = 5 * TILE;    // radius of the attuned aura effect around a held monolith
const LANDMARK_HEAL = 16;          // hp/sec healed by a sanctuary/shrine monolith
const LANDMARK_DRAIN = 14;         // dmg/sec a dark-nexus monolith inflicts on nearby enemies

// Which character attunes the monolith to which effect, and its lore name (only `unique` chars qualify).
const LANDMARK_FX: Record<string, { kind: 'tax' | 'loot' | 'heal' | 'buff' | 'drain'; name: string }> = {
  cartman:      { kind: 'tax',   name: 'Cartmanland' },        // taxes it → double income + happiness
  bountyhunter: { kind: 'loot',  name: 'Bounty Cache' },       // loots it → double windfall + alloy stream
  kenny:        { kind: 'heal',  name: "Martyr's Shrine" },    // mends nearby allies
  kyle:         { kind: 'heal',  name: 'Sanctuary' },          // mends nearby allies
  stan:         { kind: 'buff',  name: 'Rally Banner' },       // +dmg/+speed to nearby allied combat
  jedi:         { kind: 'buff',  name: 'Light Nexus' },        // the Force strengthens nearby allies
  droideka:     { kind: 'buff',  name: 'Aegis Field' },        // deflector field hardens the line
  sith:         { kind: 'drain', name: 'Dark Nexus' },         // Force corruption sears nearby enemies
};
export const landmarkName = (attune: string) => LANDMARK_FX[attune]?.name ?? 'Legendary Landmark';

function claimLandmark(L: Landmark, team: number, type: string) {
  const prev = L.owner;
  L.owner = team; L.attune = type; L.capT = 0; L.capBy = 0;
  const fx = LANDMARK_FX[type] ?? { kind: 'tax' as const, name: 'Legendary Landmark' };
  game.money[team] += LANDMARK_WINDFALL * (fx.kind === 'loot' ? 2 : 1);
  if (fx.kind === 'loot') game.alloy[team] = (game.alloy[team] || 0) + 150;
  game.parts.push({ type: 'ring', x: L.x, y: L.y, t: 0, life: 0.8, big: true });
  spawnParts('mote', L.x, L.y, 10, '255,225,150');
  if (team === PLAYER) { logMsg(U[type].name + ' claimed a Legendary Landmark — ' + fx.name + ' active!', 'good', { x: L.x, y: L.y }); sfx('cash'); }
  else if (prev === PLAYER) { logMsg(FAC[team].name + ' seized one of our Legendary Landmarks', 'war', { x: L.x, y: L.y }); sfx('war'); }
  else if (isAllied(PLAYER, team)) logMsg(FAC[team].name + ' (ally) claimed a Legendary Landmark', 'good', { x: L.x, y: L.y });
}

/** Resource trickle + the character-themed aura, applied every tick to a held monolith. */
function applyLandmarkEffect(L: Landmark, dt: number) {
  const team = L.owner;
  const fx = LANDMARK_FX[L.attune] ?? { kind: 'tax' as const, name: '' };
  game.money[team] += LANDMARK_INCOME * (fx.kind === 'tax' ? 2 : 1) * dt;
  game.alloy[team] = (game.alloy[team] || 0) + LANDMARK_ALLOY * (fx.kind === 'loot' ? 2.4 : 1) * dt;
  if (fx.kind === 'tax') game.happy[team] = Math.min(100, (game.happy[team] || 0) + 1.2 * dt);   // Cartmanland keeps the faction giddy
  const r = LANDMARK_FX_R;
  if (fx.kind === 'heal') {
    forNearbyUnits(L.x, L.y, r, (o) => {
      if (o.dead || !isAllied(team, o.team) || o.team === 0 || o.hp >= o.hpMax || dist(o, L) > r) return;
      o.hp = Math.min(o.hpMax, o.hp + LANDMARK_HEAL * dt);
      if (Math.random() < dt * 1.2) spawnParts('spark', o.x + (Math.random() * 12 - 6), o.y - 6, 1, '150,235,160');
    });
  } else if (fx.kind === 'buff') {
    forNearbyUnits(L.x, L.y, r, (o) => {
      if (o.dead || !isAllied(team, o.team) || isSupport(o.type) || (U[o.type].dmg || 0) <= 0 || dist(o, L) > r) return;
      o.buffUntil = Math.max(o.buffUntil || 0, game.t + 0.6);   // reuses Overcharge's +dmg/+speed
    });
  } else if (fx.kind === 'drain') {
    forNearbyUnits(L.x, L.y, r, (o) => {
      if (o.dead || !isWar(team, o.team) || o.team === 0 || U[o.type].hero || dist(o, L) > r) return;
      damage(o, LANDMARK_DRAIN * dt, team);
      if (Math.random() < dt * 1.6) spawnParts('spark', o.x + (Math.random() * 12 - 6), o.y - 6, 1, '190,90,255');
    });
  }
}

function landmarkTick(dt: number) {
  for (const L of game.landmarks) {
    // Tally which teams have a SPECIAL CHARACTER (a `unique` unit) channeling here — ordinary units can't claim.
    const champs: Record<number, string> = {};
    forNearbyUnits(L.x, L.y, LANDMARK_R, (u) => {
      if (u.dead || !U[u.type].unique || dist(u, L) > LANDMARK_R) return;
      champs[u.team] = u.type;
    });
    const teams = Object.keys(champs).map(Number);
    if (L.owner) {
      applyLandmarkEffect(L, dt);
      const defended = teams.includes(L.owner);
      const challengers = teams.filter(t => !isAllied(t, L.owner));
      if (!defended && challengers.length === 1) {                 // a lone enemy champion can wrest it away
        const team = challengers[0];
        L.capBy = team; L.capT += dt / LANDMARK_CLAIM;
        if (L.capT >= 1) claimLandmark(L, team, champs[team]);
      } else { L.capT = Math.max(0, L.capT - dt / 8); if (L.capT === 0) L.capBy = 0; }
    } else {
      if (teams.length === 1) {                                    // a single team's champion claims an unowned monolith
        const team = teams[0];
        L.capBy = team; L.capT += dt / LANDMARK_CLAIM;
        if (L.capT >= 1) claimLandmark(L, team, champs[team]);
      } else if (teams.length === 0) {
        L.capT = Math.max(0, L.capT - dt / 12); if (L.capT === 0) L.capBy = 0;
      } else {
        L.capT = Math.max(0, L.capT - dt / 20);                    // multiple champions contest → stalls
      }
    }
  }
}

/** AI parity: divert an idle special character toward the nearest landmark it doesn't hold. */
function aiLandmark(team: number) {
  if (!game.landmarks.length) return;
  const champ = game.units.find(u => u.team === team && U[u.type].unique && !u.dead && (u.order === 'idle' || u.order === 'guard'));
  if (!champ) return;
  const tgt = game.landmarks
    .filter(L => L.owner !== team && !isAllied(team, L.owner))
    .sort((a, b) => dist(champ, a) - dist(champ, b))[0];
  if (tgt && dist(champ, tgt) > LANDMARK_R * 0.8) { champ.order = 'move'; champ.dest = { x: tgt.x, y: tgt.y }; champ.guard = null; champ.target = null; setPath(champ, tgt.x, tgt.y); }
}

// ── Hero Vaults: survey to find, Borer to excavate, unearth a hero (roadmap #6) ──
const SURVEY_R = 14 * TILE;   // a Survey Hunter senses buried vaults from this far
const STUMBLE_R = 2.5 * TILE; // any unit this close trips over one
const DIG_TIME = 18;          // seconds of drilling to unearth a hero
const DIG_CR_RATE = 50;       // crystals/sec spent while excavating ("resources")
const DIG_AL_RATE = 12;       // alloy/sec spent while excavating ("special equipment")
let lastDigNag = -9;
function vaultTick(dt: number) {
  for (const v of game.vaults) {
    if (!v.done && v.discBy === undefined) {                 // AI survey discovery — per-team knowledge, no player fog reveal
      forNearbyUnits(v.x, v.y, SURVEY_R, (u) => {
        if (!isAllied(PLAYER, u.team) && U[u.type].survey && dist(u, v) < SURVEY_R) v.discBy = u.team;
      });
    }
    if (v.discovered) continue;
    let found = false;
    forNearbyUnits(v.x, v.y, SURVEY_R, (u) => {
      if (!isAllied(PLAYER, u.team)) return;
      const dd = dist(u, v);
      if ((U[u.type].survey && dd < SURVEY_R) || dd < STUMBLE_R) found = true;
    });
    if (found) {
      v.discovered = true;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const tx = v.tx + dx, ty = v.ty + dy; if (inMap(tx, ty)) game.explored[idx(tx, ty)] = 1; }   // clear fog so the vault shows
      logMsg('Survey complete — a HERO VAULT detected in the highlands. Send a Borer to excavate.', 'good'); sfx('chime');
      game.parts.push({ type: 'ring', x: v.x, y: v.y, t: 0, life: 0.9, big: true });
    }
  }
}
/** A Borer drills a discovered vault, paying crystals + alloy as it goes; at 100% a hero rises. */
function excavate(v: Vault, team: number, dt: number) {
  if (v.done) return;
  v.digBy = team;
  const crNeed = DIG_CR_RATE * dt, alNeed = DIG_AL_RATE * dt;
  if (game.money[team] < crNeed || (game.alloy[team] || 0) < alNeed) {        // can't pay → drilling stalls
    if (team === PLAYER && game.t - lastDigNag > 6) { lastDigNag = game.t; hint('Excavation needs crystals + alloy to continue'); }
    return;
  }
  game.money[team] -= crNeed; game.alloy[team] -= alNeed;
  v.digT = Math.min(1, v.digT + dt / DIG_TIME);
  if (Math.random() < dt * 9) spawnParts('debris', v.x + (Math.random() * 22 - 11), v.y + (Math.random() * 22 - 11), 1, '150,132,92');
  if (v.digT >= 1 && !v.done) {
    v.done = true;
    const sp = reachableSpotNear(v.x, v.y);   // unearth on ground connected to the open map, not a rock-locked pocket
    addUnit(v.archetype, sp.x, sp.y, team);
    game.parts.push({ type: 'ring', x: v.x, y: v.y, t: 0, life: 1.1, big: true });
    game.parts.push({ type: 'flash', x: v.x, y: v.y, t: 0, life: 0.32, big: true });
    game.shake = Math.min(14, game.shake + 8);
    if (team === PLAYER) { logMsg('★ HERO UNEARTHED — the ' + U[v.archetype].name + ' joins your forces!', 'good'); sfx('bigboom', v.x); }
  }
}
/** Warden hero: a constant healing aura over nearby allied units (free — a hero's gift). */
const AURA_R = 130;
function auraTick(u: Unit, dt: number) {
  const rate = U[u.type].auraHeal! * dt;
  forNearbyUnits(u.x, u.y, AURA_R, (o) => {
    if (o === u || o.dead || !isAllied(u.team, o.team) || o.hp >= o.hpMax || dist(o, u) > AURA_R) return;
    o.hp = Math.min(o.hpMax, o.hp + rate);
    if (Math.random() < dt * 1.5) spawnParts('spark', o.x + (Math.random() * 14 - 7), o.y - 6, 1, '150,235,160');
  });
}

// ── Cartman: the "RESPECT MY AUTHORITAH" stun pulse ───────────────────────────
const AUTHORITAH_CD = 13;        // seconds between pulses
const AUTHORITAH_DUR = 3;        // seconds nearby enemies are stunned
const CARTMAN_QUIPS = ['RESPECT MY AUTHORITAAH!', 'You will respect my authoritah!', 'Whatever, I do what I want!', 'Screw you guys!', 'Stop being such a bunch of dildos!'];
function authoritahTick(u: Unit) {
  if ((u.authT ?? 0) > game.t) return;
  if (u.authT === undefined) { u.authT = game.t + AUTHORITAH_CD; return; }   // arm on first sight, don't fire instantly
  const r = U[u.type].authoritah!;
  let n = 0; const hitFac: Record<number, number> = {};
  for (const o of game.units) if (!isAllied(u.team, o.team) && o.team !== 0 && !U[o.type].hero && dist(o, u) < r) { o.disabledUntil = game.t + AUTHORITAH_DUR; o.moving = false; o.path = null; spawnParts('spark', o.x, o.y, 3, '255,210,90'); n++; hitFac[o.team] = 1; }
  u.authT = game.t + AUTHORITAH_CD;
  if (!n) return;
  game.parts.push({ type: 'ring', x: u.x, y: u.y, t: 0, life: 0.7, big: true });
  for (const f in hitFac) if (u.team === PLAYER && !isWar(PLAYER, +f)) addRel(PLAYER, +f, -8);   // bellowing at a non-enemy sours relations
  if (u.team === PLAYER || tileVisible(u.x, u.y)) { logMsg('🗣 Cartman: "' + CARTMAN_QUIPS[Math.random() * CARTMAN_QUIPS.length | 0] + '" — ' + n + ' stunned', u.team === PLAYER ? 'good' : 'war', { x: u.x, y: u.y }); sfx('emp', u.x); }
}

// ── Sith Lord: Force Lightning — a periodic chain that damages + briefly stuns several enemies ──
const FORCE_CD = 9;          // seconds between Force-Lightning casts
const FORCE_RANGE = 190;     // acquisition range for the first arc
const FORCE_JUMP = 135;      // max distance the lightning leaps to the next victim
const FORCE_DUR = 2;         // stun seconds applied to each chained enemy
const FORCE_DMG = 70;        // damage to the first victim (falls off per hop)
function forceLightningTick(u: Unit) {
  if ((u.authT ?? 0) > game.t) return;
  if (u.authT === undefined) { u.authT = game.t + FORCE_CD; return; }   // arm on first sight, don't fire instantly
  const first = nearestHostile(u, FORCE_RANGE, u.team, false);
  if (!first || first.kind !== 'u') { u.authT = game.t + 1; return; }    // nothing in range — re-check soon
  u.authT = game.t + FORCE_CD;
  const hit = new Set<Entity>(); let from: Entity = u, tgt: Entity | null = first, dmg = FORCE_DMG;
  for (let i = 0; i < (U[u.type].forceLightning || 1) && tgt; i++) {
    hit.add(tgt);
    game.parts.push({ type: 'arc', x: from.x, y: from.y, x2: tgt.x, y2: tgt.y, t: 0, life: 0.2, rgb: '200,180,255' });
    spawnParts('spark', tgt.x, tgt.y, 4, '210,180,255');
    if (tgt.kind === 'u') { (tgt as Unit).disabledUntil = game.t + FORCE_DUR; (tgt as Unit).moving = false; (tgt as Unit).path = null; }
    damage(tgt, dmg, u.team);
    from = tgt; dmg *= 0.7;
    let next: Entity | null = null, nd = FORCE_JUMP;
    forNearbyUnits(from.x, from.y, FORCE_JUMP, (o) => {
      if (o.dead || hit.has(o) || !isWar(u.team, o.team) || o.team === 0 || U[o.type].hero || isAir(o) || cloaked(o) || (o.tunnelT ?? 0) > 0) return;
      const dd = dist(from, o); if (dd < nd) { nd = dd; next = o; }
    });
    tgt = next;
  }
  if (u.team === PLAYER || tileVisible(u.x, u.y)) { logMsg('⚡ ' + FAC[u.team].name + ' Sith Lord unleashes Force Lightning', u.team === PLAYER ? 'good' : 'war', { x: u.x, y: u.y }); sfx('emp', u.x); }
}

// ── Bounty Hunter: periodic homing-seeker missile salvo at several nearby enemies ──
const SEEKER_CD = 6;         // seconds between salvos
const SEEKER_RANGE = 300;    // lock-on range
const SEEKER_DMG = 56;       // damage per seeker
const SEEKER_SPLASH = 34;    // small blast on each impact
const SEEKER_SPEED = 300;    // slow homing missile (vs hitscan blasters)
function seekerSalvoTick(u: Unit) {
  if ((u.authT ?? 0) > game.t) return;
  if (u.authT === undefined) { u.authT = game.t + SEEKER_CD; return; }   // arm on first sight
  const locks: Unit[] = [];
  forNearbyUnits(u.x, u.y, SEEKER_RANGE, (o) => {
    if (o.dead || !isWar(u.team, o.team) || o.team === 0 || cloaked(o) || (o.tunnelT ?? 0) > 0) return;
    locks.push(o);
  });
  if (!locks.length) { u.authT = game.t + 1; return; }
  u.authT = game.t + SEEKER_CD;
  locks.sort((a, b) => dist(u, a) - dist(u, b));
  const n = Math.min(U[u.type].seekerSalvo || 1, locks.length);
  for (let i = 0; i < n; i++) {
    game.shots.push({ x: u.x, y: u.y, target: locks[i], dmg: SEEKER_DMG, team: u.team, speed: SEEKER_SPEED, col: FAC[u.team].col, rail: false, splash: SEEKER_SPLASH, by: u });
  }
  spawnParts('smoke', u.x, u.y, 4, '150,150,156'); spawnParts('muzzle', u.x, u.y, 3, '255,210,150');
  sfx('rail', u.x);
}

// ── Stan: leadership rally aura (allied combat units near him hit harder & move faster) ──
function rallyTick(u: Unit) {
  const r = U[u.type].rallyAura!;
  forNearbyUnits(u.x, u.y, r, (o) => {
    if (o === u || o.dead || !isAllied(u.team, o.team) || isSupport(o.type) || (U[o.type].dmg || 0) <= 0 || dist(o, u) > r) return;
    o.buffUntil = Math.max(o.buffUntil || 0, game.t + 0.6);     // refreshed continuously while near Stan (reuses Overcharge's +dmg/+speed)
  });
}

// ── Kenny: dies easily but always comes back (respawns at the owner's HQ) ──────
const KENNY_QUIPS = ['Oh my God, they killed Kenny!', '…you bastards!'];
let respawnQueue: { team: number; type: string; at: number }[] = [];
function queueRespawn(u: Unit) {
  respawnQueue.push({ team: u.team, type: u.type, at: game.t + (U[u.type].respawns || 15) });
  if (u.team === PLAYER) { logMsg('🗣 "' + KENNY_QUIPS[0] + ' ' + KENNY_QUIPS[1] + '" — ' + U[u.type].name + ' will return', 'war'); sfx('war'); }
}
function respawnTick() {
  if (!respawnQueue.length) return;
  for (let i = respawnQueue.length - 1; i >= 0; i--) {
    const t = respawnQueue[i];
    if (game.t < t.at) continue;
    respawnQueue.splice(i, 1);
    if (game.eliminated[t.team]) continue;                       // no HQ left → he stays gone
    const hq = game.buildings.find(b => b.team === t.team && b.type === 'hq') || game.buildings.find(b => b.team === t.team);
    if (!hq) continue;
    const sp = freeSpotNear(hq.x, hq.y + hq.h * 0.6);
    addUnit(t.type, sp.x, sp.y, t.team);
    if (t.team === PLAYER) { logMsg(U[t.type].name + ' is back on the battlefield.', 'good', { x: sp.x, y: sp.y }); sfx('chime'); }
  }
}
/** True if a unique character of this type is alive OR pending respawn for the team (for the train cap). */
function uniqueLive(team: number, type: string) { return game.units.some(u => u.team === team && u.type === type) || respawnQueue.some(r => r.team === team && r.type === type); }

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
  dmg = dmg * (styleMod(src.team).combat ?? 1);          // Militarist hits harder, Mercantile/Populist softer
  if (src.team === PLAYER) dmg *= campaignDmgMul;        // Conquest War-Tech: persistent campaign damage upgrade
  const byUnit = src.kind === 'u' ? (src as Unit) : undefined;
  if (byUnit) dmg *= vetDmg(byUnit.vet || 0);            // veterans/elites hit harder
  if (byUnit && buffed(byUnit)) dmg *= OVERCHARGE_DMG;   // Overcharge combat stim
  const subsurface = src.kind === 'u' && !!U[(src as Unit).type].tunneler;
  game.shots.push({ x: src.x, y: src.y, target, dmg, team: src.team, speed: rail ? 940 : 560, col: FAC[src.team].col, rail, splash, subsurface, by: byUnit });
  src.lastShot = game.t;
  if (byUnit && U[byUnit.type].stealth) byUnit.revealT = game.t + REVEAL_LINGER;   // firing drops the cloak briefly
  spawnParts('muzzle', src.x, src.y, 2, '255,235,180');
  sfx(rail ? 'rail' : 'shot', src.x);
}
// ── Arc Tower: chain-lightning that jumps between clustered ground enemies ──
const TESLA_JUMP = 120;       // max distance a bolt arcs to the next target
const TESLA_FALLOFF = 0.72;   // damage retained per chain hop
/** Fire a chain-lightning zap from Arc Tower `b` starting at `first`, arcing through up to `def.chain` ground targets. */
function teslaZap(b: Building, first: Entity) {
  const d = B[b.type], hit = new Set<Entity>();
  let from: Entity = b, tgt: Entity | null = first, dmg = d.dmg!;
  for (let i = 0; i < (d.chain || 1) && tgt; i++) {
    hit.add(tgt);
    game.parts.push({ type: 'arc', x: from.x, y: from.y, x2: tgt.x, y2: tgt.y, t: 0, life: 0.16, rgb: '170,225,255' });
    spawnParts('spark', tgt.x, tgt.y, 4, '190,230,255');
    damage(tgt, dmg, b.team);
    from = tgt; dmg *= TESLA_FALLOFF;
    // hop to the nearest not-yet-hit hostile ground unit within arc range
    let next: Entity | null = null, nd = TESLA_JUMP;
    forNearbyUnits(from.x, from.y, TESLA_JUMP, (u) => {
      if (u.dead || hit.has(u) || !isWar(b.team, u.team) || isAir(u) || cloaked(u) || (u.tunnelT ?? 0) > 0) return;
      const dd = dist(from, u); if (dd < nd) { nd = dd; next = u; }
    });
    tgt = next;
  }
  game.shake = Math.min(11, game.shake + 1);
  sfx('rail', b.x);
}
// ── Shield Projector: a building field that absorbs part of incoming damage to nearby allies ──
const SHIELD_R = 6 * TILE;     // field radius
const SHIELD_ABSORB = 0.5;     // fraction of incoming damage the field soaks (while it has energy)
const SHIELD_MAX = 1200;       // absorb energy pool per projector
const SHIELD_REGEN = 45;       // energy/sec recharge
/** Soak part of `amt` for entity `e` from a ready friendly Shield Projector in range; drains its reserve. Returns the reduced damage. */
function applyShield(e: Entity, amt: number): number {
  if (e.kind === 'b' && (e as Building).type === 'shieldgen') return amt;   // a projector doesn't shield itself (no infinite tank)
  let best: Building | null = null;
  for (const b of game.buildings) {
    if (b.type !== 'shieldgen' || b.progress < 1 || (b.shieldE ?? 0) <= 0 || b.disabledUntil > game.t || !isAllied(b.team, e.team)) continue;
    if (dist(b, e) <= SHIELD_R) { best = b; break; }
  }
  if (!best) return amt;
  const soak = Math.min(amt * SHIELD_ABSORB, best.shieldE ?? 0);
  best.shieldE = (best.shieldE ?? 0) - soak;
  if (Math.random() < 0.25) game.parts.push({ type: 'spark', x: e.x, y: e.y, t: 0, life: 0.25, rgb: '150,210,255' });   // shimmer on absorb
  return amt - soak;
}
// Droideka personal deflector: while DEPLOYED (stationary) it soaks incoming damage 1:1 from its energy pool.
const SELF_SHIELD_REGEN = 70;    // energy/sec recharge once out of fire
const SELF_SHIELD_DELAY = 2.5;   // seconds without taking a hit before the shield recharges
function applySelfShield(u: Unit, amt: number): number {
  const max = U[u.type].selfShield; if (!max || u.moving) return amt;   // shield is down while rolling
  const e = u.shieldE ?? max; if (e <= 0) return amt;
  const soak = Math.min(amt, e); u.shieldE = e - soak;
  if (Math.random() < 0.3) game.parts.push({ type: 'spark', x: u.x, y: u.y, t: 0, life: 0.22, rgb: '130,205,255' });
  return amt - soak;
}
function damage(e: Entity, amt: number, fromTeam: number) {
  e.hitT = game.t;
  amt = applyShield(e, amt);
  if (e.kind === 'u' && U[(e as Unit).type].selfShield) amt = applySelfShield(e as Unit, amt);
  e.hp -= amt; if (e.hp <= 0) destroy(e, fromTeam);
}
function destroy(e: Entity, fromTeam: number) {
  if (e.dead) return; e.dead = true;
  const big = e.kind === 'b';
  spawnParts('spark', e.x, e.y, big ? 24 : 11, '255,238,190');                          // sharp initial burst → a crisper pop
  spawnParts('fire', e.x, e.y, big ? 32 : 15, '255,160,60');
  spawnParts('ember', e.x, e.y, big ? 26 : 13, '255,198,104');
  spawnParts('debris', e.x, e.y, big ? 16 : 8, '120,120,128');
  spawnParts('smoke', e.x, e.y, big ? 18 : 7, '70,70,76');
  game.parts.push({ type: 'ring', x: e.x, y: e.y, t: 0, life: 0.7, big });
  if (big) game.parts.push({ type: 'shock', x: e.x, y: e.y, t: 0, life: 0.85, big });   // slower outer shockwave
  game.parts.push({ type: 'flash', x: e.x, y: e.y, t: 0, life: big ? 0.3 : 0.2, big });  // brighter, longer core flash
  game.parts.push({ type: 'flash', x: e.x, y: e.y, t: 0, life: 0.12 });                  // hot white inner pop
  scorchHook(e.x, e.y, big ? Math.max((e as Building).w, (e as Building).h) * 0.6 : 15);
  game.shake = Math.min(11, game.shake + (big ? 7 : 2));
  sfx(big ? 'bigboom' : 'boom', e.x);
  if (big) {
    if ((e as Building).garrison?.length) ejectFrom(e as Building, true);   // occupants spill out wounded as it falls
    removeBuildingTiles(e as Building);
    game.buildings = game.buildings.filter(b => b !== e);
    logMsg((e.team === PLAYER ? 'Our ' : FAC[e.team].name + ' ') + B[(e as Building).type].name + ' destroyed', e.team === PLAYER ? 'war' : undefined);
  } else {
    if ((e as Unit).cargoUnits?.length) unloadTransport(e as Unit, true);   // a downed transport spills its passengers out wounded
    if (U[(e as Unit).type].respawns) queueRespawn(e as Unit);              // Kenny — schedule his return
    game.units = game.units.filter(u => u !== e);
  }
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

// ── Veterancy: units that rack up kills get promoted (more damage + tougher) ───
const VET_VETERAN = 2, VET_ELITE = 5;                     // kills to reach each rank
const vetDmg = (v: number) => v >= 2 ? 1.5 : v >= 1 ? 1.2 : 1;
const vetHp = (v: number) => v >= 2 ? 1.5 : v >= 1 ? 1.2 : 1;
function promote(u: Unit, lvl: number) {
  const base = U[u.type].hp, prev = vetHp(u.vet || 0);
  u.vet = lvl;
  u.hpMax = Math.round(base * vetHp(lvl));
  u.hp = Math.min(u.hpMax, u.hp + base * (vetHp(lvl) - prev) + base * 0.15);   // grow + a heal on promotion
  spawnParts('spark', u.x, u.y, 9, '255,222,120');
  game.parts.push({ type: 'ring', x: u.x, y: u.y, t: 0, life: 0.5, big: false });
  if (u.team === PLAYER) { logMsg(U[u.type].name + ' promoted — ' + (lvl >= 2 ? 'ELITE' : 'VETERAN'), 'good'); sfx('chime', u.x); }
}
function creditKill(killer: Unit) {
  if (killer.dead || U[killer.type].hero) return;        // heroes are already peerless
  killer.kills = (killer.kills || 0) + 1;
  const lvl = killer.kills >= VET_ELITE ? 2 : killer.kills >= VET_VETERAN ? 1 : 0;
  if (lvl > (killer.vet || 0)) promote(killer, lvl);
}
/** Sell the player's selected structure(s): refund half the invested cost, free the footprint. */
export function sellSelected() {
  if (game.over) return;
  const blds = game.selection.filter((s): s is Building => s.kind === 'b' && s.team === PLAYER && !s.dead);
  if (!blds.length) { hint('Select one of your structures to sell'); return; }
  let cr = 0, al = 0;
  for (const b of blds) {
    const d = B[b.type], frac = 0.5 * Math.min(1, b.progress);
    cr += Math.round(d.cost * frac);
    al += Math.round((d.alloy || 0) * frac);
    removeBuildingTiles(b);
    spawnParts('smoke', b.x, b.y, 8, '120,120,128');
    b.dead = true;
  }
  game.buildings = game.buildings.filter(b => !blds.includes(b));
  game.selection = game.selection.filter(s => !blds.includes(s as Building));
  game.money[PLAYER] += cr;
  game.alloy[PLAYER] = (game.alloy[PLAYER] || 0) + al;
  logMsg('Structure sold — refunded ' + cr + ' crystals' + (al ? ' + ' + al + ' alloy' : ''), 'good');
  sfx('place');
}
/** Merge the selected collector units (harvesters/tankers/haulers/loggers) of each type into one "mega"
 *  collector that gathers + carries ×stack — same economic output, ONE entity (saves resources + micro). */
export function combineSelected() {
  const isCollector = (t: string) => !!(U[t].harvests || U[t].logs);
  const sel = game.selection.filter((s): s is Unit => s.kind === 'u' && s.team === PLAYER && !s.dead && isCollector((s as Unit).type));
  if (sel.length < 2) { hint('Select 2+ collectors of the same type to combine'); return; }
  const byType: Record<string, Unit[]> = {};
  for (const u of sel) (byType[u.type] = byType[u.type] || []).push(u);
  const merged: Unit[] = []; let any = false;
  for (const type in byType) {
    const group = byType[type];
    if (group.length < 2) { merged.push(...group); continue; }
    any = true;
    const stack = group.reduce((s, u) => s + (u.stack || 1), 0);
    const keep = group[0];
    keep.stack = stack;
    keep.hpMax = U[type].hp * stack;
    keep.hp = Math.min(keep.hpMax, group.reduce((s, u) => s + u.hp, 0));
    keep.cargo = Math.min(U[type].cargo! * stack, group.reduce((s, u) => s + u.cargo, 0));
    keep.order = 'idle'; keep.dest = null; keep.path = null; keep.hState = 'find'; keep.hNode = null; keep.chopTx = undefined; keep.tunnelT = 0;
    const remove = new Set(group.slice(1));
    game.units = game.units.filter(u => !remove.has(u));
    merged.push(keep);
  }
  if (!any) { hint('Select 2+ of the SAME collector type to combine'); return; }
  game.selection = merged;
  logMsg('Collectors combined — ' + merged.filter(m => (m.stack || 1) > 1).map(m => '×' + m.stack + ' ' + U[m.type].name).join(', '), 'good');
  sfx('place');
}
// ── Spatial grid — keeps separation & target-acquisition near O(n) at scale ───
// (the 112² / 6-faction map can field hundreds of units; the old O(n²) scans
//  spiked frame time in big battles).
const GCELL = 64;
const GW = Math.ceil(WORLD_W / GCELL), GH = Math.ceil(WORLD_H / GCELL);
let unitGrid: Unit[][] = [];
let gridUsed: number[] = [];   // indices of non-empty cells last build → clear only these (not all ~15k cells)
function rebuildUnitGrid() {
  // PERF: allocate the cell arrays ONCE and reuse them every frame. Reallocating ~GW*GH (~15k on the 3× map)
  // arrays twice per frame was the dominant GC-pressure source (→ ~30ms stutter spikes). Now zero per-frame alloc.
  if (unitGrid.length !== GW * GH) { unitGrid = new Array(GW * GH); for (let i = 0; i < unitGrid.length; i++) unitGrid[i] = []; gridUsed = []; }
  else { for (let k = 0; k < gridUsed.length; k++) unitGrid[gridUsed[k]].length = 0; }
  gridUsed.length = 0;
  for (const u of game.units) {
    const gx = clamp(u.x / GCELL | 0, 0, GW - 1), gy = clamp(u.y / GCELL | 0, 0, GH - 1);
    const idx = gy * GW + gx, cell = unitGrid[idx];
    if (cell.length === 0) gridUsed.push(idx);
    cell.push(u);
  }
}
function forNearbyUnits(x: number, y: number, r: number, fn: (u: Unit) => void) {
  const cx = clamp(x / GCELL | 0, 0, GW - 1), cy = clamp(y / GCELL | 0, 0, GH - 1);
  const r0 = Math.ceil(r / GCELL);
  for (let gy = Math.max(0, cy - r0); gy <= Math.min(GH - 1, cy + r0); gy++)
    for (let gx = Math.max(0, cx - r0); gx <= Math.min(GW - 1, cx + r0); gx++)
      for (const u of unitGrid[gy * GW + gx]) fn(u);
}

function nearestHostile(e: Entity, range: number, team: number, playerVisOnly: boolean): Entity | null {
  let best: Entity | null = null, bd = range;
  const canHitUnderground = e.kind === 'u' && !!U[(e as Unit).type].tunneler;   // only a Borer reaches below ground
  forNearbyUnits(e.x, e.y, range, (u) => {
    if (!isWar(team, u.team)) return;
    if (cloaked(u)) return;                                   // a cloaked Spectre can't be acquired until it reveals
    if ((u.tunnelT ?? 0) > 0 && !canHitUnderground) return;   // burrowing units are underground — only a tunneler can target them
    if (!eligibleTarget(e, u)) return;
    if (playerVisOnly && !tileVisible(u.x, u.y)) return;
    const d = dist(e, u) - U[u.type].radius; if (d < bd) { bd = d; best = u; }
  });
  if (canHitGround(e)) for (const b of game.buildings) {   // flak (airOnly) ignores structures
    if (!isWar(team, b.team)) continue;
    if (playerVisOnly && !tileVisible(b.x, b.y)) continue;
    const d = dist(e, b) - Math.max(b.w, b.h) / 2; if (d < bd) { bd = d; best = b; }
  }
  return best;
}

// ── Movement: path following + local steering ────────────────────────────────
function unitBlocked(x: number, y: number, team = 0) { return !passableFor(x / TILE | 0, y / TILE | 0, team); }
// Phasing units ignore terrain entirely: fliers always, dedicated tunnelers (Borer) always,
// and harvesters while burrowing underground.
const phasing = (u: Unit) => !!U[u.type].air || !!U[u.type].tunneler || (u.tunnelT ?? 0) > 0;
function stepToward(u: Unit, dx: number, dy: number, dt: number) {
  const sp = U[u.type].speed * (buffed(u) ? OVERCHARGE_SPD : 1) * dt, len = Math.hypot(dx, dy);
  if (len < 1) { u.moving = false; return true; }
  u.moving = true;
  const nx = u.x + dx / len * sp, ny = u.y + dy / len * sp;
  u.facing = Math.atan2(dy, dx);
  const tm = u.team;
  if (phasing(u)) { u.x = nx; u.y = ny; }                 // fliers + burrowing harvesters ignore terrain entirely
  else if (!unitBlocked(nx, ny, tm)) { u.x = nx; u.y = ny; }
  else if (!unitBlocked(nx, u.y, tm)) { u.x = nx; }
  else if (!unitBlocked(u.x, ny, tm)) { u.y = ny; }
  else { const slx = u.x + (-dy / len) * sp, sly = u.y + (dx / len) * sp, srx = u.x + (dy / len) * sp, sry = u.y + (-dx / len) * sp; if (!unitBlocked(slx, sly, tm)) { u.x = slx; u.y = sly; } else if (!unitBlocked(srx, sry, tm)) { u.x = srx; u.y = sry; } }
  u.x = clamp(u.x, 12, WORLD_W - 12); u.y = clamp(u.y, 12, WORLD_H - 12);
  return len < sp * 1.5;
}
export function setPath(u: Unit, wx: number, wy: number) {
  if (!u.finalDest || u.finalDest.x !== wx || u.finalDest.y !== wy) u.unstick = 0;   // reset escalation only on a genuinely new destination
  u.finalDest = { x: wx, y: wy };
  u.stuckT = 0;
  if (U[u.type].air) { u.path = [{ x: wx, y: wy }]; u.waitPath = false; u.waitSince = undefined; return; }    // fliers fly straight
  const p = findPath(u.x, u.y, wx, wy, u.team);
  if (p) { u.path = p; u.waitPath = false; u.waitSince = undefined; }
  else if (pathDeferred()) {
    // budget spent this tick → HOLD (keep any old path) & retry shortly; never wedge. BUT a big active army can
    // chronically exhaust the tick budget and permanently strand later-processed units — so ANY unit starved
    // > ~1.2s FORCEs a search. The forced search is globally throttled (a few/tick, small node cap in pathfind.ts)
    // so this can't spike frame time or let the army hog it. (Gating this to support-only froze combat units +
    // heroes under a saturated budget — that was the "no ground unit moves except harvesters" bug.)
    if (u.waitPath && u.waitSince !== undefined && game.t - u.waitSince > 1.2) {
      const fp = findPath(u.x, u.y, wx, wy, u.team, true);
      if (fp) { u.path = fp; u.waitPath = false; u.waitSince = undefined; return; }
    }
    if (!u.waitPath) u.waitSince = game.t;
    u.waitPath = true; u.repathT = 0.04 + Math.random() * 0.12;
  }
  else { u.path = null; u.waitPath = false; u.waitSince = undefined; }                 // genuine no route exists → straight-line + stuck recovery
}
// How many orthogonal neighbours are open — a unit needs room to manoeuvre, not just a point-passable tile.
function tileClearance(tx: number, ty: number) {
  return (passable(tx + 1, ty) ? 1 : 0) + (passable(tx - 1, ty) ? 1 : 0) + (passable(tx, ty + 1) ? 1 : 0) + (passable(tx, ty - 1) ? 1 : 0);
}
/** Nearest passable tile with real CLEARANCE (≥3 open neighbours), optionally biased toward `ang`;
 *  falls back to any passable tile if no roomy one is within range. Used to dislodge units wedged in terrain. */
function nearestOpenTile(tx: number, ty: number, maxR: number, ang?: number): [number, number] | null {
  let best: [number, number] | null = null, bestScore = Infinity, fallback: [number, number] | null = null;
  for (let r = 0; r <= maxR; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = tx + dx, y = ty + dy;
    if (!passable(x, y)) continue;
    if (!fallback) fallback = [x, y];
    if (tileClearance(x, y) < 3) continue;
    let score = r - tileClearance(x, y) * 0.4;
    if (ang !== undefined) { const a = Math.atan2(dy, dx); score += Math.abs(((a - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.7; }
    if (score < bestScore) { bestScore = score; best = [x, y]; }
  }
  return best || fallback;
}
function followPath(u: Unit, dt: number) {
  // waiting for a pathfind that was deferred by this tick's budget → hold position; do NOT straight-line into
  // terrain (that was the "hung up all over the place" wedging). RE-REQUEST the path every tick so states that
  // set a path only once (harvester/logger 'return' delivery, guard, dig-approach) still recover + trigger the
  // starvation-escape — otherwise a deferred delivery path holds forever (loggers collected but never deposited).
  if (u.waitPath && (!u.path || !u.path.length)) { u.moving = false; if (u.finalDest) setPath(u, u.finalDest.x, u.finalDest.y); return false; }
  // escape if we ended up sitting on a blocked tile (e.g. a building was placed on us)
  if (!phasing(u) && unitBlocked(u.x, u.y, u.team)) {
    const np = nearestPassableTile(u.x / TILE | 0, u.y / TILE | 0);
    if (np) { u.x = np[0] * TILE + 16; u.y = np[1] * TILE + 16; }
  }
  let arrived = false;
  if (!u.path || !u.path.length) {
    arrived = u.finalDest ? stepToward(u, u.finalDest.x - u.x, u.finalDest.y - u.y, dt) : true;
  } else {
    const p = u.path[0];
    if (stepToward(u, p.x - u.x, p.y - u.y, dt) || dist(u, p) < 13) {
      u.path.shift();
      arrived = u.path.length === 0 && dist(u, u.finalDest || p) < 16;
    }
  }
  if (arrived) return true;
  // stuck detection — runs WITH or WITHOUT a path (the no-path straight-line case can wedge too)
  const moved = Math.hypot(u.x - u.lx, u.y - u.ly);
  if (moved < U[u.type].speed * dt * 0.25) u.stuckT += dt; else u.stuckT = 0;
  u.lx = u.x; u.ly = u.y;
  if (u.stuckT > 0.8 && u.finalDest) {
    u.stuckT = 0;
    if (U[u.type].harvests) {                              // harvesters burrow straight through the obstacle to their goal
      u.tunnelT = (u.tunnelT ?? 0) + 0.001;                // enter tunnel mode (cleared by updateHarvester on arrival)
      u.path = [{ x: u.finalDest.x, y: u.finalDest.y }];
      return false;
    }
    const aim = (u.path && u.path[0]) ? u.path[0] : u.finalDest;
    const ang = Math.atan2(aim.y - u.y, aim.x - u.x);
    const n = (u.unstick || 0) + 1; u.unstick = n;   // escalates across cycles (reset only on a new destination / real progress)
    if (n >= 4) {
      // sustained stuck (≈3s) in tight terrain → hard escape: jump to the nearest roomy tile toward the goal
      const esc = nearestOpenTile(u.x / TILE | 0, u.y / TILE | 0, 14, ang);
      if (esc) { u.x = esc[0] * TILE + 16; u.y = esc[1] * TILE + 16; }
      u.unstick = 0;
    } else if (n >= 2) {
      // wedged → hop toward the next waypoint onto OPEN ground (clearance, not just any passable tile)
      let placed = false;
      for (const hop of [2.2, 1.4, 3.2, 0.8]) {
        const t = nearestOpenTile((u.x + Math.cos(ang) * hop * TILE) / TILE | 0, (u.y + Math.sin(ang) * hop * TILE) / TILE | 0, 3, ang);
        if (t) { u.x = t[0] * TILE + 16; u.y = t[1] * TILE + 16; placed = true; break; }
      }
      if (!placed) { const t = nearestOpenTile(u.x / TILE | 0, u.y / TILE | 0, 4); if (t) { u.x = t[0] * TILE + 16; u.y = t[1] * TILE + 16; } }
    }
    setPath(u, u.finalDest.x, u.finalDest.y);
  }
  return false;
}
function separation() {
  rebuildUnitGrid();                                       // fresh buckets from post-movement positions
  // PERF: iterate the 3×3 cell neighbourhood inline (no per-unit closure → no allocation in this hot per-frame loop)
  for (const a of game.units) {
    if (phasing(a)) continue;                              // air & burrowing units occupy separate layers
    const ar = U[a.type].radius;
    const cx = clamp(a.x / GCELL | 0, 0, GW - 1), cy = clamp(a.y / GCELL | 0, 0, GH - 1);
    for (let gy = Math.max(0, cy - 1); gy <= Math.min(GH - 1, cy + 1); gy++)
      for (let gx = Math.max(0, cx - 1); gx <= Math.min(GW - 1, cx + 1); gx++) {
        const cell = unitGrid[gy * GW + gx];
        for (let k = 0; k < cell.length; k++) {
          const b = cell[k];
          if (a.id >= b.id || phasing(b)) continue;        // each ground pair resolved once
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
          const min = ar + U[b.type].radius;
          if (d > 0 && d < min) {
            const push = (min - d) / 2, ux = dx / d, uy = dy / d;
            if (!unitBlocked(a.x - ux * push, a.y - uy * push, a.team)) { a.x -= ux * push; a.y -= uy * push; }
            if (!unitBlocked(b.x + ux * push, b.y + uy * push, b.team)) { b.x += ux * push; b.y += uy * push; }
          }
        }
      }
  }
}

// Non-combat economy/support units (harvesters, loggers, repair rigs) — never
// desert in a revolt, count as civilians at settlements, and don't take attack orders.
export const isSupport = (type: string) => !!(U[type].harvests || U[type].logs || U[type].repair || U[type].shield || U[type].diplomat || U[type].transport || U[type].deployable);

// ── Garrison: infantry shelter inside a building → defensive fire; eject if it falls ──
const GARRISON_CAP = 5;          // occupants per building
const GARRISON_RANGE = 160;      // garrisoned building's defensive fire range
const GARRISON_ROF = 0.7;        // seconds between garrison volleys
const canGarrison = (type: string) => !!U[type].infantry;          // foot soldiers only
const garrisonable = (b: Building) => b.progress >= 1 && b.type !== 'wall' && b.type !== 'gate' && b.type !== 'palisade' && b.type !== 'turret' && b.type !== 'aaturret';
function enterGarrison(u: Unit, b: Building): boolean {
  if (!b.garrison) b.garrison = [];
  if (b.garrison.length >= GARRISON_CAP) return false;
  b.garrison.push({ type: u.type, hp: u.hp, vet: u.vet });
  game.units = game.units.filter(x => x !== u);
  game.selection = game.selection.filter(s => s !== u);
  return true;
}
/** Eject every occupant of a building as a (wounded) unit nearby — on manual unload or when the building falls. */
function ejectFrom(b: Building, hurt: boolean) {
  if (!b.garrison || !b.garrison.length) return;
  for (const g of b.garrison) {
    const s = freeSpotNear(b.x, b.y + b.h * 0.5);
    const u = addUnit(g.type, s.x, s.y, b.team);
    u.hp = hurt ? Math.max(1, Math.min(g.hp, u.hpMax) * 0.5) : Math.min(g.hp, u.hpMax);
    u.vet = g.vet || 0;
  }
  b.garrison = [];
}
export function ejectGarrison() {
  let n = 0;
  for (const s of game.selection) {
    if (s.kind === 'b' && (s as Building).team === PLAYER && (s as Building).garrison?.length) { n += (s as Building).garrison!.length; ejectFrom(s as Building, false); }
    else if (s.kind === 'u' && (s as Unit).team === PLAYER && (s as Unit).cargoUnits?.length) { n += (s as Unit).cargoUnits!.length; unloadTransport(s as Unit, false); }
  }
  if (n) { hint(n + ' troops disembarked'); sfx('click'); } else hint('Select a garrisoned building or a loaded transport to unload');
}
// ── Transport / APC: loads infantry, ferries them, unloads on command ─────────
function enterTransport(u: Unit, t: Unit): boolean {
  if (!t.cargoUnits) t.cargoUnits = [];
  if (t.cargoUnits.length >= (U[t.type].capacity || 5)) return false;
  t.cargoUnits.push({ type: u.type, hp: u.hp, vet: u.vet });
  game.units = game.units.filter(x => x !== u);
  game.selection = game.selection.filter(s => s !== u);
  return true;
}
/** Disembark every passenger of a transport beside it (wounded if the carrier was destroyed). */
function unloadTransport(t: Unit, hurt: boolean) {
  if (!t.cargoUnits || !t.cargoUnits.length) return;
  for (const g of t.cargoUnits) {
    const s = freeSpotNear(t.x, t.y + 18);
    const u = addUnit(g.type, s.x, s.y, t.team);
    u.hp = hurt ? Math.max(1, Math.min(g.hp, u.hpMax) * 0.5) : Math.min(g.hp, u.hpMax);
    u.vet = g.vet || 0;
  }
  t.cargoUnits = [];
}
// ── Deployable Sentry Pod: a mobile unit ⇄ a fixed Sentry Turret ──────────────
/** Deploy selected Sentry Pods into turrets, OR pack selected pod-turrets back into pods. Toggles on the selection. */
export function toggleDeploy() {
  if (game.over) return;
  const pods = game.selection.filter((s): s is Unit => s.kind === 'u' && s.team === PLAYER && !!U[s.type].deployable);
  const podTurrets = game.selection.filter((s): s is Building => s.kind === 'b' && s.team === PLAYER && !!s.fromPod);
  if (pods.length) {
    let n = 0;
    for (const p of pods) {
      const tx = Math.round(p.x / TILE - B.turret.w / 2), ty = Math.round(p.y / TILE - B.turret.h / 2);
      if (!footprintFree('turret', tx, ty)) continue;
      const b = addBuilding('turret', tx, ty, PLAYER, true); b.fromPod = true; b.hp = p.hp;
      game.units = game.units.filter(x => x !== p); game.selection = game.selection.filter(s => s !== p); n++;
    }
    if (n) { hint(n + ' Sentry Pod' + (n > 1 ? 's' : '') + ' deployed'); sfx('place'); } else hint('No clear ground to deploy here');
  } else if (podTurrets.length) {
    let n = 0;
    for (const b of podTurrets) {
      const sp = freeSpotNear(b.x, b.y + b.h * 0.6);
      const u = addUnit('sentrypod', sp.x, sp.y, PLAYER); u.hp = Math.min(u.hpMax, b.hp);
      removeBuildingTiles(b); game.buildings = game.buildings.filter(x => x !== b); game.selection = game.selection.filter(s => s !== b); n++;
    }
    if (n) { hint(n + ' turret' + (n > 1 ? 's' : '') + ' packed up'); sfx('click'); }
  } else hint('Select a Sentry Pod to deploy, or a deployed turret to pack up');
}

// ── Stealth (Spectre): cloaked & untargetable until it fires or an enemy gets close ──
const DETECT_R = 3 * TILE;       // an enemy within this range spots a cloaked unit
const REVEAL_LINGER = 1.6;       // seconds a stealth unit stays revealed after firing / being spotted
let stealthT = 0;
/** True while a stealth unit's cloak is up (not recently revealed) → enemies can't see or target it. */
export const cloaked = (u: Unit) => !!U[u.type].stealth && (u.revealT ?? 0) <= game.t;
/** Hidden from the human player's view? (an enemy stealth unit currently cloaked). */
export const cloakedToPlayer = (u: Unit) => cloaked(u) && !isAllied(PLAYER, u.team);

// ── Overcharge (combat stim): a timed +dmg / +speed buff on your units ────────
const OVERCHARGE_R = 150;       // buff radius around the cast point
const OVERCHARGE_DUR = 9;       // seconds the stim lasts
const OVERCHARGE_DMG = 1.4;     // damage multiplier while buffed
const OVERCHARGE_SPD = 1.35;    // movement-speed multiplier while buffed
export const buffed = (u: Unit) => (u.buffUntil ?? 0) > game.t;

function stealthTick(dt: number) {
  stealthT += dt; if (stealthT < 0.25) return; stealthT = 0;
  for (const u of game.units) {
    if (!U[u.type].stealth || u.dead) continue;
    let seen = false;
    forNearbyUnits(u.x, u.y, DETECT_R, (o) => { if (!seen && isWar(u.team, o.team) && dist(u, o) < DETECT_R) seen = true; });
    if (!seen) for (const b of game.buildings) { if (b.progress >= 1 && isWar(u.team, b.team) && dist(u, b) < DETECT_R) { seen = true; break; } }
    if (seen) u.revealT = game.t + REVEAL_LINGER;
  }
}

// ── Harvesting (resource-typed: harvester=crystal, tanker=coolant) ────────────
const resOf = (u: Unit) => U[u.type].harvests!;
function nearestNodePathable(u: Unit) {
  const kind = resOf(u);
  const sorted = game.nodes.filter(n => n.amount > 0 && n.kind === kind).sort((a, b) => dist(u, a) - dist(u, b));
  for (let i = 0; i < Math.min(4, sorted.length); i++) {
    const p = findPath(u.x, u.y, sorted[i].x, sorted[i].y, u.team);
    if (p) return { node: sorted[i], path: p };
  }
  return null;
}
// ── Coolant from water features (requires a Water Tower) ──────────────────────
export function hasWaterTower(team: number) { return game.buildings.some(b => b.team === team && b.type === 'watertower' && b.progress >= 1); }
/** Nearest drainable water tile (with a passable approach the tanker can reach) — mirrors the Logger's forest scan. */
function nearestWaterTile(u: Unit): { tx: number; ty: number; approach: Vec; path: Vec[]; d: number } | null {
  const utx = u.x / TILE | 0, uty = u.y / TILE | 0, R = 40;
  const cand: { tx: number; ty: number; d: number }[] = [];
  for (let ty = Math.max(1, uty - R); ty <= Math.min(MAPH - 2, uty + R); ty++)
    for (let tx = Math.max(1, utx - R); tx <= Math.min(MAPW - 2, utx + R); tx++) {
      if (game.terr[idx(tx, ty)] !== T_WATER || game.waterAmt[idx(tx, ty)] <= 0) continue;
      if (!(passable(tx + 1, ty) || passable(tx - 1, ty) || passable(tx, ty + 1) || passable(tx, ty - 1))) continue;
      cand.push({ tx, ty, d: (tx - utx) * (tx - utx) + (ty - uty) * (ty - uty) });
    }
  cand.sort((a, b) => a.d - b.d);
  for (let i = 0; i < Math.min(6, cand.length); i++) {
    const { tx, ty } = cand[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      if (!passable(tx + dx, ty + dy)) continue;
      const ax = (tx + dx) * TILE + 16, ay = (ty + dy) * TILE + 16;
      const p = findPath(u.x, u.y, ax, ay, u.team);
      if (p) return { tx, ty, approach: { x: ax, y: ay }, path: p, d: Math.hypot((tx + 0.5) * TILE - u.x, (ty + 0.5) * TILE - u.y) };
    }
  }
  return null;
}
/** A water tile, drained dry, becomes passable dirt — opening new crossings. */
function dryWater(tx: number, ty: number) {
  if (game.terr[idx(tx, ty)] !== T_WATER) return;
  game.terr[idx(tx, ty)] = T_DIRT;
  game.waterAmt[idx(tx, ty)] = 0;
  game.waterTiles = game.waterTiles.filter(w => !(w.x === tx && w.y === ty));
  spawnParts('steam', tx * TILE + 16, ty * TILE + 16, 3, '170,210,225');
  dryWaterHook(tx, ty);
}
/** Nearest field of the right kind by straight distance, ignoring whether a surface route exists (for tunnelling). */
function nearestNodeAny(u: Unit): ResourceNode | null {
  const kind = resOf(u);
  let best: ResourceNode | null = null, bd = Infinity;
  for (const n of game.nodes) {
    if (n.amount <= 0 || n.kind !== kind) continue;
    const d = (n.x - u.x) * (n.x - u.x) + (n.y - u.y) * (n.y - u.y); if (d < bd) { bd = d; best = n; }
  }
  return best;
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
  const stack = u.stack || 1;                   // a merged "mega" collector carries + gathers ×stack (acts as N units, 1 entity)
  const cap = U[u.type].cargo! * stack;
  const kind = resOf(u);
  if (u.hState === 'find') {
    u.tunnelT = 0; u.chopTx = undefined; u.hNode = null;    // surface & clear last leg's target
    const got = nearestNodePathable(u);
    const water = (kind === 'coolant' && hasWaterTower(u.team)) ? nearestWaterTile(u) : null;   // tankers tap water once a tower's up
    const nodeD = got ? Math.hypot(got.node.x - u.x, got.node.y - u.y) : Infinity;
    if (water && water.d <= nodeD) { u.chopTx = water.tx; u.chopTy = water.ty; u.path = water.path; u.finalDest = { ...water.approach }; u.hState = 'go'; }
    else if (got) { u.hNode = got.node; u.path = got.path; u.finalDest = { x: got.node.x, y: got.node.y }; u.hState = 'go'; }
    else {
      const n = nearestNodeAny(u);                          // no surface route to any field → burrow straight to the nearest
      if (n) { u.hNode = n; u.finalDest = { x: n.x, y: n.y }; u.path = [{ x: n.x, y: n.y }]; u.tunnelT = 0.001; u.hState = 'go'; }
      else u.hState = 'idlewait';
    }
  }
  if (u.hState === 'idlewait') { if (game.t % 2 < dt) u.hState = 'find'; u.moving = false; return; }
  if (u.hState === 'go') {
    if (u.chopTx !== undefined) {                            // heading to a water tile
      if (game.waterAmt[idx(u.chopTx, u.chopTy!)] <= 0) { u.hState = 'find'; return; }
      const wx = u.chopTx * TILE + 16, wy = u.chopTy! * TILE + 16;
      if (dist(u, { x: wx, y: wy }) < TILE * 1.4) { u.hState = 'mine'; u.path = null; u.facing = Math.atan2(wy - u.y, wx - u.x); }
      else followPath(u, dt);
    } else {
      if (!u.hNode || u.hNode.amount <= 0) { u.hState = 'find'; return; }
      if (dist(u, u.hNode) < 28) { u.hState = 'mine'; u.path = null; u.tunnelT = 0; }   // surfaced at the field
      else followPath(u, dt);
    }
  } else if (u.hState === 'mine') {
    u.moving = false;
    const toDepot = () => { u.hState = 'return'; const dep = nearestDepot(u); if (dep) setPath(u, dep.x, dep.y + dep.h / 2 + 14); };
    if (u.chopTx !== undefined) {                            // draining a water feature → coolant
      const i = idx(u.chopTx, u.chopTy!);
      if (game.waterAmt[i] <= 0) { dryWater(u.chopTx, u.chopTy!); u.chopTx = undefined; if (u.cargo > 0) toDepot(); else u.hState = 'find'; return; }
      const take = Math.min(62 * stack * laborFactor(u.team) * dt, game.waterAmt[i], cap - u.cargo);
      game.waterAmt[i] -= take; u.cargo += take;
      if (Math.random() < dt * 6) spawnParts('spark', u.chopTx * TILE + 16, u.chopTy! * TILE + 12, 1, '150,220,235');
      if (game.waterAmt[i] <= 0) { dryWater(u.chopTx, u.chopTy!); u.chopTx = undefined; }
      if (u.cargo >= cap - 0.5) { u.chopTx = undefined; toDepot(); }
      else if (u.chopTx === undefined) u.hState = 'find';
      return;
    }
    if (!u.hNode || u.hNode.amount <= 0) { u.hState = 'find'; return; }
    const take = Math.min(62 * stack * laborFactor(u.team) * dt, u.hNode.amount, cap - u.cargo);
    u.hNode.amount -= take; u.cargo += take;
    if (Math.random() < dt * 6) spawnParts('spark', u.hNode.x, u.hNode.y - 4, 1, kind === 'crystal' ? '255,220,120' : '150,220,235');
    if (u.cargo >= cap - 0.5) toDepot();
  } else if (u.hState === 'return') {
    const dep = nearestDepot(u);
    if (!dep) { u.hState = 'idlewait'; return; }
    if (dist(u, dep) < Math.max(dep.w, dep.h) / 2 + 26) {
      if (kind === 'crystal') game.money[u.team] += Math.round(u.cargo * (styleMod(u.team).econ ?? 1));
      else if (kind === 'coolant') game.water[u.team] = clamp((game.water[u.team] || 0) + u.cargo, 0, WATER_CAP);
      else game.alloy[u.team] = (game.alloy[u.team] || 0) + Math.round(u.cargo);
      u.cargo = 0; u.hState = 'find'; u.tunnelT = 0;        // surfaced at the depot
      dep.unloadFx = game.t; u.moving = false; u.path = null;
      if (u.team === PLAYER) sfx('cash', dep.x);
    } else followPath(u, dt);
  }
  if ((u.tunnelT ?? 0) > 0 && Math.random() < dt * 9) spawnParts('debris', u.x, u.y + 5, 1, '120,92,56');   // burrow spoil
}

// ── Logging: a Logger fells & clears forest tiles for wood (opens new ground) ──
const CHOP_TIME = 2.6;        // seconds to fell one forest tile (before labor factor)
const WOOD_PER_TILE = 50;     // wood gathered per cleared forest tile
/** Fell a forest tile: it becomes passable grass, its trees vanish, the renderer repaints it. */
function clearForest(tx: number, ty: number) {
  if (game.terr[idx(tx, ty)] !== T_FOREST) return;
  game.terr[idx(tx, ty)] = T_GRASS;                                  // now passable — routes open up
  game.trees = game.trees.filter(t => !((t.x / TILE | 0) === tx && (t.y / TILE | 0) === ty));
  const wx = tx * TILE + 16, wy = ty * TILE + 16;
  spawnParts('debris', wx, wy, 6, '120,92,52');
  game.parts.push({ type: 'ring', x: wx, y: wy, t: 0, life: 0.4, big: false });
  clearForestHook(tx, ty);                                           // repaint the cleared patch (silent — no chop SFX)
}
/** Nearest fellable forest tile (with a passable approach) the logger can path to. */
function nearestForest(u: Unit): { tx: number; ty: number; approach: Vec; path: Vec[] } | null {
  const utx = u.x / TILE | 0, uty = u.y / TILE | 0, R = 34;
  const cand: { tx: number; ty: number; d: number }[] = [];
  for (let ty = Math.max(1, uty - R); ty <= Math.min(MAPH - 2, uty + R); ty++)
    for (let tx = Math.max(1, utx - R); tx <= Math.min(MAPW - 2, utx + R); tx++) {
      if (game.terr[idx(tx, ty)] !== T_FOREST) continue;
      if (!(passable(tx + 1, ty) || passable(tx - 1, ty) || passable(tx, ty + 1) || passable(tx, ty - 1))) continue;
      cand.push({ tx, ty, d: (tx - utx) * (tx - utx) + (ty - uty) * (ty - uty) });
    }
  cand.sort((a, b) => a.d - b.d);
  let anyDeferred = false;
  for (let i = 0; i < Math.min(6, cand.length); i++) {
    const { tx, ty } = cand[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      if (!passable(tx + dx, ty + dy)) continue;
      const ax = (tx + dx) * TILE + 16, ay = (ty + dy) * TILE + 16;
      const p = findPath(u.x, u.y, ax, ay, u.team);
      if (p) return { tx, ty, approach: { x: ax, y: ay }, path: p };
      if (pathDeferred()) anyDeferred = true;
    }
  }
  // Budget-starvation fallback: all reachable candidates deferred (a busy army drained the tick budget) → loggers
  // have no tunnel escape like harvesters, so force ONE throttled search to the nearest candidate rather than idle.
  if (anyDeferred && cand.length) {
    const { tx, ty } = cand[0];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      if (!passable(tx + dx, ty + dy)) continue;
      const ax = (tx + dx) * TILE + 16, ay = (ty + dy) * TILE + 16;
      const p = findPath(u.x, u.y, ax, ay, u.team, true);
      if (p) return { tx, ty, approach: { x: ax, y: ay }, path: p };
    }
  }
  return null;
}
function nearestWoodDepot(u: Unit): Building | null {
  let best: Building | null = null, bd = 1e9;
  for (const b of game.buildings) {
    if (b.team !== u.team || b.progress < 1) continue;
    if (b.type !== 'hq' && B[b.type].accepts !== 'wood') continue;   // HQ takes any resource; Lumber Mill is the dedicated drop
    const d = dist(u, b); if (d < bd) { bd = d; best = b; }
  }
  return best;
}
function updateLogger(u: Unit, dt: number) {
  const cap = U[u.type].cargo!;
  if (u.hState === 'find') {
    const got = nearestForest(u);
    if (got) { u.chopTx = got.tx; u.chopTy = got.ty; u.path = got.path; u.finalDest = { ...got.approach }; u.chopT = 0; u.hState = 'go'; }
    else if (u.cargo > 0) u.hState = 'return';
    else u.hState = 'idlewait';
  }
  if (u.hState === 'idlewait') { if (game.t % 2 < dt) u.hState = 'find'; u.moving = false; return; }
  if (u.hState === 'go') {
    if (u.chopTx === undefined || game.terr[idx(u.chopTx, u.chopTy!)] !== T_FOREST) { u.hState = 'find'; return; }
    const fx = u.chopTx * TILE + 16, fy = u.chopTy! * TILE + 16;
    if (dist(u, { x: fx, y: fy }) < TILE * 1.4) { u.hState = 'mine'; u.path = null; u.chopT = 0; u.facing = Math.atan2(fy - u.y, fx - u.x); }
    else followPath(u, dt);
  } else if (u.hState === 'mine') {
    u.moving = false;
    if (u.chopTx === undefined || game.terr[idx(u.chopTx, u.chopTy!)] !== T_FOREST) { u.hState = 'find'; return; }
    u.chopT = (u.chopT || 0) + dt * laborFactor(u.team);
    if (Math.random() < dt * 5) spawnParts('debris', u.chopTx * TILE + 16, u.chopTy! * TILE + 16, 1, '150,116,70');
    if ((u.chopT || 0) >= CHOP_TIME) {
      clearForest(u.chopTx, u.chopTy!);
      u.cargo = Math.min(cap, u.cargo + WOOD_PER_TILE);
      u.chopT = 0; u.chopTx = undefined;
      u.hState = u.cargo >= cap - 0.5 ? 'return' : 'find';
      if (u.hState === 'return') { const dep = nearestWoodDepot(u); if (dep) setPath(u, dep.x, dep.y + dep.h / 2 + 14); }
    }
  } else if (u.hState === 'return') {
    const dep = nearestWoodDepot(u);
    if (!dep) { u.hState = 'idlewait'; return; }
    if (dist(u, dep) < Math.max(dep.w, dep.h) / 2 + 26) {
      game.wood[u.team] = (game.wood[u.team] || 0) + Math.round(u.cargo);
      u.cargo = 0; u.hState = 'find'; dep.unloadFx = game.t; u.moving = false; u.path = null;
      if (u.team === PLAYER) sfx('cash', dep.x);
    } else followPath(u, dt);
  }
}

// ── Repair rigs: mobile menders that heal friendly units & buildings, burning wood ──
const REPAIR_RANGE = 42;      // how close the rig must be to mend a target
const REPAIR_RATE = 34;       // hp/sec restored
const WOOD_PER_HP = 0.05;     // wood consumed per hp restored
const sizeOf = (e: Entity) => e.kind === 'b' ? Math.max((e as Building).w, (e as Building).h) / 2 : U[(e as Unit).type].radius;
let lastWoodNag = -9;
/** Nearest wounded friendly (unit OR building) within `range` px — pass Infinity for map-wide auto-repair. */
function nearestDamagedFriendly(u: Unit, range: number): Entity | null {
  let best: Entity | null = null, bd = range * range;
  for (const o of game.units) {
    if (o === u || o.dead || U[o.type].air || !isAllied(u.team, o.team) || o.hp >= o.hpMax) continue;
    const d = (o.x - u.x) * (o.x - u.x) + (o.y - u.y) * (o.y - u.y); if (d < bd) { bd = d; best = o; }
  }
  for (const b of game.buildings) {
    if (b.dead || b.progress < 1 || b.hp >= b.hpMax || !isAllied(u.team, b.team)) continue;
    const d = (b.x - u.x) * (b.x - u.x) + (b.y - u.y) * (b.y - u.y); if (d < bd) { bd = d; best = b; }
  }
  return best;
}
/** Mend a target if in reach and the team has wood. Returns true while actively mending. */
function healEntity(u: Unit, e: Entity, dt: number): boolean {
  if (e.dead || e.hp >= e.hpMax) return false;
  if (dist(u, e) - sizeOf(e) > REPAIR_RANGE) return false;
  const wood = game.wood[u.team] || 0;
  if (wood <= 0) {
    if (u.team === PLAYER && game.t - lastWoodNag > 6) { lastWoodNag = game.t; hint('Repair Rigs need WOOD — build a Lumber Mill & log the forests'); }
    return false;
  }
  const heal = Math.min(REPAIR_RATE * dt, e.hpMax - e.hp, wood / WOOD_PER_HP);
  if (heal <= 0) return false;
  e.hp += heal; game.wood[u.team] = Math.max(0, wood - heal * WOOD_PER_HP);
  u.moving = false; u.facing = Math.atan2(e.y - u.y, e.x - u.x);
  if (Math.random() < dt * 9) spawnParts('spark', e.x + (Math.random() * 18 - 9), e.y + (Math.random() * 18 - 9), 1, '150,235,160');
  return true;
}
function updateRepair(u: Unit, dt: number) {
  if (u.order === 'guard') {
    const g = u.guard;
    if (!g || g.dead) { u.order = 'idle'; u.guard = null; u.path = null; }
    else {
      const tgt: Entity | null = g.hp < g.hpMax ? g : nearestDamagedFriendly(u, 160);
      if (tgt && dist(u, tgt) - sizeOf(tgt) <= REPAIR_RANGE) { u.path = null; healEntity(u, tgt, dt); }
      else if (dist(u, g) > GUARD_FOLLOW) { u.repathT -= dt; if (!u.path || u.repathT <= 0) { u.repathT = 0.5; setPath(u, g.x, g.y); } followPath(u, dt); }
      else if (tgt) { u.repathT -= dt; if (!u.path || u.repathT <= 0) { u.repathT = 0.5; setPath(u, tgt.x, tgt.y); } followPath(u, dt); }
      else { u.moving = false; u.path = null; }
      return;
    }
  }
  if ((u.order === 'move' || u.order === 'amove') && u.dest) {
    if (followPath(u, dt)) { u.order = 'idle'; u.dest = null; u.path = null; }
    return;
  }
  // idle → continuously auto-search the whole map for any wounded unit OR building and go mend it
  if (u.order === 'idle') {
    if (!u.target || u.target.dead || u.target.hp >= u.target.hpMax) {
      u.target = null;
      u.acqT = (u.acqT || 0) - dt;
      if (u.acqT <= 0) { u.acqT = 0.5; u.target = nearestDamagedFriendly(u, Infinity); }
    }
    const tgt = u.target;
    if (tgt) {
      if (dist(u, tgt) - sizeOf(tgt) <= REPAIR_RANGE) { u.path = null; healEntity(u, tgt, dt); }
      else { u.repathT -= dt; if (!u.path || u.repathT <= 0) { u.repathT = 0.6; setPath(u, tgt.x, tgt.y); } followPath(u, dt); }
    } else { u.moving = false; u.path = null; }
  }
}

// ── Unit update ──────────────────────────────────────────────────────────────
const GUARD_FOLLOW = 70;    // how close an escort stays to the unit it guards
const GUARD_LEASH = 230;    // how far an escort chases a threat from the guarded unit before disengaging
const PATROL_R = 12 * TILE; // patrol/area-guard radius — engage any enemy entering this zone (far past weapon range)
function updateUnit(u: Unit, dt: number) {
  // General anti-wedge: any ground unit sitting on an impassable tile (an excavated hero unearthed in rock, a
  // unit a building was dropped on, one shoved into terrain by separation) is nudged to the nearest open tile
  // every tick — so nothing can stay permanently stuck in terrain, even while idle.
  if (!phasing(u) && unitBlocked(u.x, u.y, u.team)) {
    const np = nearestPassableTile(u.x / TILE | 0, u.y / TILE | 0);
    if (np) { u.x = np[0] * TILE + 16; u.y = np[1] * TILE + 16; }
  }
  if (u.disabledUntil > game.t) { u.moving = false; return; }
  const d = U[u.type];
  u.cooldown = Math.max(0, u.cooldown - dt);
  if (U[u.type].tunneler && u.moving && Math.random() < dt * 7) spawnParts('debris', u.x, u.y + 6, 1, '120,100,72');   // burrow spoil trail
  if (U[u.type].auraHeal) auraTick(u, dt);                              // Warden hero — constant heal aura
  if (U[u.type].authoritah) authoritahTick(u);                          // Cartman — periodic "RESPECT MY AUTHORITAH" stun
  if (U[u.type].forceLightning) forceLightningTick(u);                  // Sith Lord — periodic Force-Lightning chain (damage + stun)
  if (U[u.type].seekerSalvo) seekerSalvoTick(u);                        // Bounty Hunter — periodic homing-seeker missile salvo
  if (U[u.type].selfShield && game.t - (u.hitT ?? -9) > SELF_SHIELD_DELAY)   // Droideka — recharge the deflector when out of fire
    u.shieldE = Math.min(U[u.type].selfShield!, (u.shieldE ?? U[u.type].selfShield!) + SELF_SHIELD_REGEN * dt);
  if (U[u.type].rallyAura) rallyTick(u);                                // Stan — leadership rally aura (+dmg/+speed to nearby allies)
  if ((u.vet || 0) >= 2 && u.hp < u.hpMax) u.hp = Math.min(u.hpMax, u.hp + 4 * dt);   // Elite units self-repair slowly
  // turret aim smoothing
  let want = u.facing;
  if (u.target && !u.target.dead) want = Math.atan2(u.target.y - u.y, u.target.x - u.x);
  const da = ((want - u.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  u.aim += clamp(da, -7 * dt, 7 * dt);
  if (U[u.type].harvests) {
    if (u.order === 'move' && u.dest) {
      // A manual move must RE-PATH (budget-deferred searches & consumed/partial paths) — otherwise a harvester
      // whose path deferred under a busy path budget holds forever or trails a stale harvest path (the "new
      // harvesters won't move where I click" bug). Same fix the combat movers already have.
      u.repathT -= dt;
      if (u.waitPath || !u.path || u.path.length === 0 || u.repathT <= 0) { u.repathT = 0.8; setPath(u, u.dest.x, u.dest.y); }
      if (followPath(u, dt)) { u.order = 'idle'; u.hState = 'find'; u.dest = null; u.path = null; u.waitPath = false; }
      return;
    }
    updateHarvester(u, dt); return;
  }
  if (U[u.type].logs) {
    if (u.order === 'move' && u.dest) {
      u.repathT -= dt;
      if (u.waitPath || !u.path || u.path.length === 0 || u.repathT <= 0) { u.repathT = 0.8; setPath(u, u.dest.x, u.dest.y); }
      if (followPath(u, dt)) { u.order = 'idle'; u.hState = 'find'; u.dest = null; u.path = null; u.waitPath = false; }
      return;
    }
    updateLogger(u, dt); return;
  }
  if (U[u.type].repair) { updateRepair(u, dt); return; }
  if (U[u.type].shield) {                                               // Aegis — mobile missile interceptor (no weapon); cooldown ticks above
    if ((u.order === 'move' || u.order === 'amove') && u.dest) {
      u.repathT -= dt; if (!u.path || u.path.length === 0 || u.repathT <= 0) { u.repathT = 0.8; setPath(u, u.dest.x, u.dest.y); }
      if (followPath(u, dt)) { u.order = 'idle'; u.dest = null; u.path = null; u.waitPath = false; }
    } else u.moving = false;
    return;
  }
  if (U[u.type].diplomat) {                                             // Envoy — unarmed; courts a settlement or just moves (never engages)
    if (u.order === 'court') {
      const s = game.settlements.find(x => x.id === u.courtId);
      // Park as soon as we're inside the courting influence radius (settlementTick counts an envoy anywhere within
      // SETTLE_R), and approach a REACHABLE spot beside the town (u.dest = freeSpotNear), not the settlement CENTRE.
      // The old code chased the centre with SETTLE_R-14 tolerance, so envoys that couldn't reach it thrashed
      // followPath + stuck-recovery (nearestOpenTile scans) every tick forever — a hard FPS sink per envoy.
      if (!s) { u.order = 'idle'; u.courtId = undefined; u.path = null; u.enterT = undefined; }
      else if (dist(u, s) <= SETTLE_R) { u.moving = false; u.path = null; u.enterT = undefined; }   // within influence → court in place (park, zero work)
      else {
        if (u.enterT === undefined) u.enterT = game.t;                        // start the approach clock
        if (game.t - (u.enterT || game.t) > 20) { u.order = 'idle'; u.courtId = undefined; u.path = null; u.enterT = undefined; u.recourtT = game.t + 30; }   // can't reach in 20s → give up + cool down (don't instantly re-court the same unreachable town → no thrash loop)
        else { const d2 = u.dest || s; u.repathT -= dt; if (u.repathT <= 0) { u.repathT = 0.6; setPath(u, d2.x, d2.y); } followPath(u, dt); }   // throttle re-path to 0.6s even with no path → an envoy chasing an unreachable town can't spam 30k-node searches every tick
      }
      return;
    }
    if ((u.order === 'move' || u.order === 'amove') && u.dest) {
      u.repathT -= dt; if (!u.path || u.path.length === 0 || u.repathT <= 0) { u.repathT = 0.8; setPath(u, u.dest.x, u.dest.y); }
      if (followPath(u, dt)) { u.order = 'idle'; u.dest = null; u.path = null; u.waitPath = false; }
    } else u.moving = false;
    return;
  }
  if (U[u.type].transport || U[u.type].deployable) {                   // APC / Sentry Pod — unarmed mover (no targeting)
    if ((u.order === 'move' || u.order === 'amove') && u.dest) {
      u.repathT -= dt; if (!u.path || u.path.length === 0 || u.repathT <= 0) { u.repathT = 0.8; setPath(u, u.dest.x, u.dest.y); }
      if (followPath(u, dt)) { u.order = 'idle'; u.dest = null; u.path = null; u.waitPath = false; }
    } else u.moving = false;
    return;
  }
  // drop a target that's dead — or that dived underground (only a tunneler can keep hitting it)
  if (u.target && (u.target.dead || (u.target.kind === 'u' && ((u.target as Unit).tunnelT ?? 0) > 0 && !U[u.type].tunneler))) u.target = null;
  if (u.order === 'dig') {                                              // Borer excavating a Hero Vault
    const v = game.vaults.find(x => x.id === u.digVault);
    if (!v || v.done) { u.order = 'idle'; u.digVault = undefined; u.path = null; }
    else if (dist(u, v) > 34) { u.repathT -= dt; if (!u.path || u.repathT <= 0) { u.repathT = 0.6; setPath(u, v.x, v.y); } followPath(u, dt); }
    else { u.moving = false; u.path = null; u.facing += dt * 2.5; excavate(v, u.team, dt); if (v.done) { u.order = 'idle'; u.digVault = undefined; } }
    return;
  }
  if (u.order === 'enter') {                                            // infantry moving to garrison a building
    const b = u.guard as Building | null;
    if (!b || b.dead || !garrisonable(b) || (b.garrison?.length || 0) >= GARRISON_CAP) { u.order = 'idle'; u.guard = null; u.path = null; }
    else if (dist(u, b) - Math.max(b.w, b.h) / 2 <= 22) { enterGarrison(u, b); return; }   // arrived → board (unit removed)
    else if (game.t - (u.enterT ?? game.t) > 15) { u.order = 'idle'; u.guard = null; u.path = null; }   // can't reach in time → give up (never thrash A* forever)
    else { const d2 = u.dest || b; u.repathT -= dt; if (!u.path || u.repathT <= 0) { u.repathT = 0.5; setPath(u, d2.x, d2.y); } followPath(u, dt); return; }   // approach a passable spot beside it (the centre is solid)
    return;
  }
  if (u.order === 'board') {                                            // infantry moving to board a transport
    const t = u.guard as Unit | null;
    if (!t || t.dead || !U[t.type]?.transport || (t.cargoUnits?.length || 0) >= (U[t.type].capacity || 5)) { u.order = 'idle'; u.guard = null; u.path = null; }
    else if (dist(u, t) <= U[t.type].radius + U[u.type].radius + 12) { enterTransport(u, t); return; }   // arrived → load (unit removed)
    else if (game.t - (u.enterT ?? game.t) > 15) { u.order = 'idle'; u.guard = null; u.path = null; }    // can't reach in time → give up
    else { u.repathT -= dt; if (!u.path || u.repathT <= 0) { u.repathT = 0.5; setPath(u, t.x, t.y); } followPath(u, dt); return; }
    return;
  }
  if (u.order === 'guard') {
    const g = u.guard;
    if (!g || g.dead) { u.order = 'idle'; u.guard = null; u.path = null; }
    else {
      if (!u.target) {                                       // acquire a hostile near the guarded unit
        u.acqT = (u.acqT || 0) - dt;
        if (u.acqT <= 0) { u.acqT = 0.3; const t = nearestHostile(u, 200, u.team, u.team === PLAYER); if (t && dist(t, g) < GUARD_LEASH) u.target = t; }
      }
      if (u.target && dist(u.target, g) > GUARD_LEASH) u.target = null;   // threat strayed too far from the guarded unit
      if (u.target) {
        const tgt = u.target;
        const r = (d.range || 0) + (tgt.kind === 'b' ? Math.max((tgt as Building).w, (tgt as Building).h) / 2 : U[(tgt as Unit).type].radius);
        if (dist(u, tgt) <= r) {
          u.moving = false; u.path = null; u.facing = Math.atan2(tgt.y - u.y, tgt.x - u.x);
          if (u.cooldown <= 0 && Math.abs(da) < 0.5) { fireAt(u, tgt, d.dmg!, u.type === 'walker' || u.type === 'borer', d.splash || 0); u.cooldown = d.rof! * rofMult(u); }
        } else { u.repathT -= dt; if (!u.path || u.repathT <= 0) { u.repathT = 0.7; setPath(u, tgt.x, tgt.y); } followPath(u, dt); }
      } else if (dist(u, g) > GUARD_FOLLOW) {                 // no threat → stay close to the guarded unit
        u.repathT -= dt; if (!u.path || u.repathT <= 0) { u.repathT = 0.5; setPath(u, g.x, g.y); } followPath(u, dt);
      } else { u.moving = false; u.path = null; }
      return;
    }
  }
  if (u.order === 'patrol' && u.dest) {
    const c = u.dest;                                          // the post being guarded
    if (!u.target || u.target.dead) {                         // scan the whole patrolled area (far past weapon range)
      u.target = null; u.acqT = (u.acqT || 0) - dt;
      if (u.acqT <= 0) { u.acqT = 0.3; const t = nearestHostile(u, PATROL_R, u.team, false); if (t && dist(t, c) < PATROL_R) u.target = t; }   // a sentry senses intruders in its whole zone (ignores fog)
    }
    if (u.target && dist(u.target, c) > PATROL_R) u.target = null;   // threat left the zone → disengage, return to post
    if (u.target) {
      const tgt = u.target;
      const r = (d.range || 0) + (tgt.kind === 'b' ? Math.max((tgt as Building).w, (tgt as Building).h) / 2 : U[(tgt as Unit).type].radius);
      if (dist(u, tgt) <= r) { u.moving = false; u.path = null; u.facing = Math.atan2(tgt.y - u.y, tgt.x - u.x); if (u.cooldown <= 0 && Math.abs(da) < 0.5) { fireAt(u, tgt, d.dmg!, u.type === 'walker' || u.type === 'borer', d.splash || 0); u.cooldown = d.rof! * rofMult(u); } }
      else { u.repathT -= dt; if (!u.path || u.repathT <= 0) { u.repathT = 0.6; setPath(u, tgt.x, tgt.y); } followPath(u, dt); }
    } else if (dist(u, c) > GUARD_FOLLOW) {                    // no threat → march back to the post
      u.repathT -= dt; if (!u.path || u.repathT <= 0) { u.repathT = 0.5; setPath(u, c.x, c.y); } followPath(u, dt);
    } else { u.moving = false; u.path = null; }
    return;
  }
  if (u.order === 'attack' && u.target) {
    const tgt = u.target;
    const r = (d.range || 0) + (tgt.kind === 'b' ? Math.max((tgt as Building).w, (tgt as Building).h) / 2 : U[(tgt as Unit).type].radius);
    if (dist(u, tgt) <= r) {
      u.moving = false; u.path = null;
      u.facing = Math.atan2(tgt.y - u.y, tgt.x - u.x);
      if (u.cooldown <= 0 && Math.abs(da) < 0.5) { fireAt(u, tgt, d.dmg!, u.type === 'walker' || u.type === 'borer', d.splash || 0); u.cooldown = d.rof! * rofMult(u); }
    } else {
      u.repathT -= dt;
      if (!u.path || u.repathT <= 0) { u.repathT = 1.0; setPath(u, tgt.x, tgt.y); }
      followPath(u, dt);
    }
    return;
  }
  if ((u.order === 'move' || u.order === 'amove') && u.dest) {
    if (u.order === 'amove') {
      u.acqT = (u.acqT || 0) - dt;                         // throttle target scans (~4×/s, not per-frame)
      if (u.acqT <= 0) {
        u.acqT = 0.25;
        const t = nearestHostile(u, 210, u.team, u.team === PLAYER);
        if (t) { u.target = t; u.savedDest = u.dest; u.order = 'attack'; u.resume = 'amove'; return; }
      }
    }
    // Repath periodically and whenever the current (possibly PARTIAL) path is consumed, so long hauls across
    // the big map are walked incrementally to the goal instead of stalling once the first path runs out.
    u.repathT -= dt;
    if (!u.path || u.path.length === 0 || u.repathT <= 0) { u.repathT = 0.8; setPath(u, u.dest.x, u.dest.y); }
    if (followPath(u, dt)) { u.order = 'idle'; u.dest = null; u.path = null; u.waitPath = false; }
    return;
  }
  if (u.order === 'idle') {
    u.moving = false;
    if (u.resume === 'amove' && u.savedDest) {
      u.order = 'amove'; u.dest = u.savedDest; setPath(u, u.dest.x, u.dest.y);
      u.resume = null; u.savedDest = null; return;
    }
    u.acqT = (u.acqT || 0) - dt;                           // throttle idle target scans
    if (u.acqT <= 0) {
      u.acqT = 0.3;
      const t = nearestHostile(u, (d.range || 0) + 52, u.team, u.team === PLAYER);
      if (t) { u.target = t; u.order = 'attack'; }
    }
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
    b.progress = Math.min(1, b.progress + dt / (d.buildTime || 1) * pw.factor * laborFactor(b.team));
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
  if (b.type === 'idome') b.cooldown = Math.max(0, b.cooldown - dt);   // Iron Dome interceptor recharge
  if (b.type === 'shieldgen') b.shieldE = Math.min(SHIELD_MAX, (b.shieldE ?? SHIELD_MAX) + SHIELD_REGEN * dt * pw.factor);   // Shield Projector reserve recharges (scaled by power)
  if (b.type === 'turret' || b.type === 'aaturret' || b.type === 'tesla') {
    b.cooldown = Math.max(0, b.cooldown - dt);
    if (b.target && (b.target.dead || dist(b, b.target) > d.range! + 30 || !eligibleTarget(b, b.target) || (b.target.kind === 'u' && ((b.target as Unit).tunnelT ?? 0) > 0))) b.target = null;   // turrets can't hit the underground
    if (!b.target) b.target = nearestHostile(b, d.range!, b.team, b.team === PLAYER);
    if (b.target) {
      const want = Math.atan2(b.target.y - b.y, b.target.x - b.x);
      const da = ((want - b.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      b.aim += clamp(da, -5 * dt, 5 * dt);
      // Arc Tower zaps instantly (no barrel to traverse); turrets must finish aiming.
      if (b.cooldown <= 0 && (b.type === 'tesla' || Math.abs(da) < 0.4)) {
        if (b.type === 'tesla') teslaZap(b, b.target); else fireAt(b, b.target, d.dmg!, false);
        b.cooldown = d.rof! / pw.factor * rofMult(b);
      }
    } else b.aim += dt * 0.4;
  }
  // garrisoned infantry lay down defensive fire from inside the structure
  if (b.garrison && b.garrison.length) {
    b.cooldown = Math.max(0, b.cooldown - dt);
    if (b.target && (b.target.dead || dist(b, b.target) > GARRISON_RANGE + 30 || !isWar(b.team, b.target.team) || (b.target.kind === 'u' && ((b.target as Unit).tunnelT ?? 0) > 0))) b.target = null;
    if (!b.target) b.target = nearestHostile(b, GARRISON_RANGE, b.team, b.team === PLAYER);
    if (b.target && b.cooldown <= 0) {
      const dmg = b.garrison.reduce((s, o) => s + (U[o.type].dmg || 0), 0);   // every occupant adds a barrel
      fireAt(b, b.target, dmg, false); b.cooldown = GARRISON_ROF;
    }
  }
  if (b.type === 'power' && Math.random() < dt * 1.6)
    spawnParts('steam', b.x - b.w * 0.18, b.y - b.h / 2 - d.hgt, 1, '200,205,210');
  if (b.type === 'foundry' && b.queue.length) {
    b.queueT += dt * pw.factor * laborFactor(b.team);
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
// Particles are redrawn as vector graphics every frame, so the live count is a real render cost in big
// battles. Cap it (lower in Low Detail mode, which a weak GPU can toggle with F).
let lowDetail = false;
export function setLowDetail(v: boolean) { lowDetail = v; }
const partCap = () => lowDetail ? 90 : 300;
export function spawnParts(type: string, x: number, y: number, n: number, rgb: string) {
  if (game.parts.length > partCap()) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 7;
    const sp = type === 'fire' ? 50 + Math.random() * 190 : type === 'debris' ? 70 + Math.random() * 200 :
      type === 'ember' ? 60 + Math.random() * 230 : type === 'mote' ? 4 + Math.random() * 10 :
      type === 'smoke' ? 8 + Math.random() * 26 : type === 'steam' ? 6 + Math.random() * 14 : 20 + Math.random() * 70;
    const part: Particle = {
      type, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (type === 'debris' || type === 'ember' ? 70 : 0),
      t: 0,
      life: type === 'smoke' ? 1.3 + Math.random() * 0.9 : type === 'steam' ? 1.4 + Math.random() :
        type === 'debris' ? 0.6 + Math.random() * 0.5 : type === 'fire' ? 0.35 + Math.random() * 0.35 :
        type === 'ember' ? 0.55 + Math.random() * 0.7 : type === 'mote' ? 3.5 + Math.random() * 3 : 0.3 + Math.random() * 0.25,
      rgb, size: type === 'smoke' || type === 'steam' ? 5 + Math.random() * 8 : type === 'mote' ? 0.8 + Math.random() * 1.2 : 1.5 + Math.random() * 2.5,
      grav: type === 'debris' ? 340 : type === 'ember' ? 210 : 0,
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
      // Jedi saber deflect: a chance to negate an incoming direct shot and bounce a bolt back at the shooter.
      const tu = s.target.kind === 'u' ? s.target as Unit : null;
      if (tu && !tu.dead && Math.random() < (U[tu.type].deflect ?? 0)) {
        s.dead = true;
        spawnParts('spark', tu.x, tu.y, 6, '150,205,255');
        game.parts.push({ type: 'flash', x: tu.x, y: tu.y, t: 0, life: 0.1 });
        sfx('rail', tu.x);
        if (s.by && !s.by.dead && isWar(tu.team, s.by.team)) {   // reflect the bolt back at the firer
          game.shots.push({ x: tu.x, y: tu.y, target: s.by, dmg: s.dmg * 0.6, team: tu.team, speed: 760, col: FAC[tu.team].col, rail: true, splash: 0, by: tu });
        }
        continue;
      }
      const wasAlive = !s.target.dead, victim = s.target;
      damage(s.target, s.dmg, s.team); s.dead = true;
      if (wasAlive && victim.dead && s.by && !s.by.dead && s.by.team !== victim.team) creditKill(s.by);   // veterancy
      if (s.splash) {
        // area blast: falls off with distance, never friendly-fires the shooter's team
        for (const u of [...game.units]) {
          if (u.dead || u === s.target || isAllied(s.team, u.team)) continue;
          if ((u.tunnelT ?? 0) > 0 && !s.subsurface) continue;        // underground units are shielded from surface blasts
          const dd = dist(u, { x: hx, y: hy });
          if (dd < s.splash) damage(u, s.dmg * (1 - dd / s.splash) * 0.7, s.team);
        }
        spawnParts('fire', hx, hy, 9, '255,150,55');
        game.parts.push({ type: 'ring', x: hx, y: hy, t: 0, life: 0.5, big: false });
        game.shake = Math.min(11, game.shake + 1.5);
      }
      spawnParts('spark', hx, hy, 4, '255,240,200');
      game.parts.push({ type: 'flash', x: hx, y: hy, t: 0, life: 0.08 });   // a crisp impact pop for punchier hits
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
  const cap = partCap();   // hard cap incl. the direct pushes (rings/flashes/arcs) that bypass spawnParts → drop the oldest
  if (game.parts.length > cap) game.parts.splice(0, game.parts.length - cap);
}

// ── Abilities & covert ───────────────────────────────────────────────────────
export function hasCyber() { return game.buildings.some(b => b.team === PLAYER && b.type === 'cyber' && b.progress >= 1); }
export function hasBuilding(type: string) { return game.buildings.some(b => b.team === PLAYER && b.type === type && b.progress >= 1); }
export function tryAbility(key: string) {
  if (game.over) return;
  const a = ABILITIES[key];
  const req = a.requires || 'cyber';
  if (!hasBuilding(req)) { hint('Requires a ' + B[req].name); sfx('click'); return; }
  if (game.cooldowns[key] > 0) { hint(a.name + ' recharging'); return; }
  if (game.money[PLAYER] < a.cost) { hint('Insufficient crystals'); return; }
  if ((a.alloy || 0) > (game.alloy[PLAYER] || 0)) { hint('Insufficient alloy'); return; }
  game.armed = key; game.placing = null;
  hint(a.name + ': click a target');
}
export function castAbility(key: string, wx: number, wy: number) {
  if (key === 'amove') { issueOrder(wx, wy, true); game.armed = null; hint(''); return; }
  if (key === 'patrol') { patrolOrder(wx, wy); game.armed = null; return; }
  const a = ABILITIES[key];
  if (key === 'emp') {
    game.money[PLAYER] -= a.cost; game.cooldowns.emp = a.cd * (styleMod(PLAYER).cdMul ?? 1);
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
    game.money[PLAYER] -= a.cost; game.cooldowns.hijack = a.cd * (styleMod(PLAYER).cdMul ?? 1);
    if (!isWar(PLAYER, best.team)) addRel(PLAYER, best.team, -18);
    best.team = PLAYER; best.order = 'idle'; best.target = null; best.hState = 'find'; best.hNode = null; best.path = null;
    game.parts.push({ type: 'emp', x: best.x, y: best.y, t: 0, life: 0.8 });
    sfx('emp', best.x);
    logMsg(U[best.type].name + ' hijacked — it\'s ours now', 'hot');
  } else if (key === 'overcharge') {
    game.money[PLAYER] -= a.cost; game.cooldowns.overcharge = a.cd * (styleMod(PLAYER).cdMul ?? 1);
    game.parts.push({ type: 'ring', x: wx, y: wy, t: 0, life: 0.8, big: true });
    let n = 0;
    for (const u of game.units) if (isAllied(PLAYER, u.team) && !isSupport(u.type) && dist(u, { x: wx, y: wy }) < OVERCHARGE_R) { u.buffUntil = game.t + OVERCHARGE_DUR; n++; spawnParts('spark', u.x, u.y, 4, '255,205,90'); }
    sfx('chime', wx);
    logMsg(n ? '⚡ Overcharge — ' + n + ' units stimmed (+dmg & +speed, 9s)' : 'Overcharge — no combat units in range', 'hot');
  } else if (key === 'minefield') {
    game.money[PLAYER] -= a.cost; game.cooldowns.minefield = a.cd * (styleMod(PLAYER).cdMul ?? 1);
    layMinefield(wx, wy, PLAYER);
    spawnParts('debris', wx, wy, 8, '90,86,70');
    sfx('place', wx);
    logMsg('Minefield deployed — ' + MINE_COUNT + ' mines armed', 'good');
  } else if (key === 'nuke') {
    game.money[PLAYER] -= a.cost; game.cooldowns.nuke = a.cd * (styleMod(PLAYER).cdMul ?? 1);
    pendingStrikes.push({ x: wx, y: wy, at: game.t + NUKE_TRAVEL, team: PLAYER, kind: 'nuke' });
    sfx('rail', wx);
    logMsg('☢ Ballistic missile launched — impact in ' + NUKE_TRAVEL + 's', 'war');
  } else if (key === 'thermo') {
    game.money[PLAYER] -= a.cost; game.alloy[PLAYER] = (game.alloy[PLAYER] || 0) - (a.alloy || 0);
    game.cooldowns.thermo = a.cd * (styleMod(PLAYER).cdMul ?? 1);
    pendingStrikes.push({ x: wx, y: wy, at: game.t + THERMO_TRAVEL, team: PLAYER, kind: 'thermo' });
    sfx('rail', wx); game.shake = Math.min(9, game.shake + 5);
    logMsg('☢☢ THERMONUCLEAR LAUNCH — impact in ' + THERMO_TRAVEL + 's. May the targets be clustered.', 'war');
  } else if (key === 'orbital') {
    game.money[PLAYER] -= a.cost; game.alloy[PLAYER] = (game.alloy[PLAYER] || 0) - (a.alloy || 0);
    game.cooldowns.orbital = a.cd * (styleMod(PLAYER).cdMul ?? 1);
    pendingStrikes.push({ x: wx, y: wy, at: game.t + ORBITAL_TRAVEL, team: PLAYER, kind: 'orbital' });
    spawnParts('spark', wx, wy, 10, '150,225,255');                                 // targeting laser paints the spot
    sfx('rail', wx);
    logMsg('⚡ ORBITAL ION STRIKE designated — beam fires in ' + ORBITAL_TRAVEL + 's (no intercepting this one)', 'war');
  } else if (key === 'chrono') {
    game.money[PLAYER] -= a.cost; game.cooldowns.chrono = a.cd * (styleMod(PLAYER).cdMul ?? 1);
    const n = chronoFreeze(wx, wy, PLAYER);
    sfx('emp', wx);
    logMsg(n ? '❄ Chrono Freeze — ' + n + ' enemy units frozen for ' + CHRONO_DUR + 's' : 'Chrono Freeze — no enemies in range', 'hot');
  } else if (key === 'carpet') {
    game.money[PLAYER] -= a.cost; game.alloy[PLAYER] = (game.alloy[PLAYER] || 0) - (a.alloy || 0);
    game.cooldowns.carpet = a.cd * (styleMod(PLAYER).cdMul ?? 1);
    const from = game.buildings.find(b => b.team === PLAYER && b.type === 'hq') || game.buildings.find(b => b.team === PLAYER);
    launchCarpet(wx, wy, PLAYER, from ? from.x : wx - 400, from ? from.y : wy);
    sfx('rail', wx);
    logMsg('✈ CARPET BOMB run inbound — a line of blasts in ' + NUKE_TRAVEL + 's', 'war');
  }
  game.armed = null;
}
const CHRONO_R = 200;        // chrono-freeze zone radius (px)
const CHRONO_DUR = 6;        // seconds enemy units stay frozen
/** Freeze all of byTeam's enemies' units within CHRONO_R around (x,y) for CHRONO_DUR seconds. Returns count. */
function chronoFreeze(x: number, y: number, byTeam: number): number {
  game.parts.push({ type: 'ring', x, y, t: 0, life: 0.9, big: true });
  game.parts.push({ type: 'emp', x, y, t: 0, life: 0.9 });
  let n = 0; const hitFac: Record<number, number> = {};
  for (const u of game.units) if (!isAllied(byTeam, u.team) && u.team !== 0 && dist(u, { x, y }) < CHRONO_R) { u.disabledUntil = game.t + CHRONO_DUR; u.moving = false; u.path = null; spawnParts('spark', u.x, u.y, 3, '150,220,255'); n++; hitFac[u.team] = 1; }
  for (const f in hitFac) if (byTeam === PLAYER && !isWar(PLAYER, +f)) addRel(PLAYER, +f, -12);   // freezing a non-enemy's army is a hostile act
  return n;
}
const CARPET_COUNT = 7;      // blasts dropped along the run
const CARPET_SPACING = 78;   // px between successive blasts
const CARPET_R = 112;        // each blast's radius
/** Queue a strafing line of blasts across (tx,ty), oriented along the bomber's approach (from fx,fy). */
function launchCarpet(tx: number, ty: number, team: number, fx: number, fy: number) {
  let dx = tx - fx, dy = ty - fy; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
  const startK = -(CARPET_COUNT - 1) / 2;
  for (let i = 0; i < CARPET_COUNT; i++) {
    const k = startK + i;
    pendingStrikes.push({ x: tx + dx * k * CARPET_SPACING, y: ty + dy * k * CARPET_SPACING, at: game.t + NUKE_TRAVEL + i * 0.18, team, kind: 'carpet' });
  }
}
function detonateCarpet(x: number, y: number, byTeam: number) {
  detonate(x, y, byTeam, CARPET_R, 520, 440);
  spawnParts('fire', x, y, 28, '255,170,70'); spawnParts('smoke', x, y, 16, '78,76,80'); spawnParts('debris', x, y, 12, '120,120,128');
  game.parts.push({ type: 'ring', x, y, t: 0, life: 0.7, big: false });
  game.parts.push({ type: 'flash', x, y, t: 0, life: 0.2, big: false });
  scorchHook(x, y, CARPET_R * 0.6); game.shake = Math.min(14, game.shake + 4); sfx('boom', x);
}
const NUKE_TRAVEL = 4;       // seconds from launch to impact
const NUKE_R = 150;          // ballistic blast radius (px)
const THERMO_TRAVEL = 7;     // thermonuclear flight time (longer — react / intercept window)
const THERMO_R = 440;        // thermonuclear blast radius (px) — covers a clustered base → faction-killer
const ORBITAL_TRAVEL = 1.6;  // orbital ion beam — short telegraph, then fires (no missile to intercept)
const ORBITAL_R = 95;        // ion strike blast radius (px) — small & surgical vs the missiles' wide AoE
// ── Iron Dome interception ────────────────────────────────────────────────────
const IDOME_R = 7 * TILE;    // Iron Dome building intercept radius
const IDOME_CD = 9;          // seconds to recharge an interceptor
const AEGIS_R = 5.5 * TILE;  // mobile Aegis intercept radius
const AEGIS_CD = 10;
function interceptFX(s: Strike, bx: number, by: number) {
  spawnParts('muzzle', bx, by, 7, '150,220,255');                              // battery launches an interceptor
  game.parts.push({ type: 'ring', x: s.x, y: s.y, t: 0, life: 0.5, big: false });
  game.parts.push({ type: 'flash', x: s.x, y: s.y, t: 0, life: 0.16, big: false });
  spawnParts('spark', s.x, s.y, 14, '160,225,255'); spawnParts('fire', s.x, s.y, 5, '255,225,160');
  sfx('boom', s.x);
}
/** A ready, non-allied Iron Dome (building) or Aegis (unit) covering the impact knocks the missile down. */
function tryIntercept(s: Strike): boolean {
  for (const b of game.buildings) {
    if (b.type !== 'idome' || b.progress < 1 || b.cooldown > 0 || isAllied(b.team, s.team)) continue;
    if (dist(b, s) <= IDOME_R) {
      b.cooldown = IDOME_CD; interceptFX(s, b.x, b.y);
      if (isAllied(PLAYER, b.team)) { logMsg('🛡 Iron Dome INTERCEPTED an inbound ' + (s.kind === 'thermo' ? 'THERMONUCLEAR' : 'ballistic') + ' missile', 'good'); sfx('chime'); }
      else if (s.team === PLAYER) logMsg('Our missile was intercepted by ' + FAC[b.team].name + ' defenses', 'war');
      return true;
    }
  }
  for (const u of game.units) {
    if (!U[u.type].shield || u.dead || u.cooldown > 0 || isAllied(u.team, s.team)) continue;
    if (dist(u, s) <= AEGIS_R) {
      u.cooldown = AEGIS_CD; interceptFX(s, u.x, u.y);
      if (isAllied(PLAYER, u.team)) { logMsg('🛡 Aegis Shield INTERCEPTED an inbound ' + (s.kind === 'thermo' ? 'THERMONUCLEAR' : 'ballistic') + ' missile', 'good'); sfx('chime'); }
      else if (s.team === PLAYER) logMsg('Our missile was intercepted by ' + FAC[u.team].name + ' defenses', 'war');
      return true;
    }
  }
  return false;
}
function detonate(x: number, y: number, byTeam: number, r: number, uDmg: number, bDmg: number) {
  for (const u of [...game.units]) { const d = dist(u, { x, y }); if (d < r) damage(u, uDmg * (1 - d / r) + uDmg * 0.18, byTeam); }
  for (const b of [...game.buildings]) { const d = dist(b, { x, y }); if (d < r) damage(b, bDmg * (1 - d / r) + bDmg * 0.22, byTeam); }
}
function detonateNuke(x: number, y: number, byTeam: number) {
  detonate(x, y, byTeam, NUKE_R, 1180, 1700);
  spawnParts('fire', x, y, 64, '255,170,70'); spawnParts('ember', x, y, 30, '255,200,110'); spawnParts('smoke', x, y, 44, '80,80,86'); spawnParts('debris', x, y, 30, '120,120,128');
  game.parts.push({ type: 'ring', x, y, t: 0, life: 1.3, big: true });
  game.parts.push({ type: 'shock', x, y, t: 0, life: 1.0, big: true });
  game.parts.push({ type: 'flash', x, y, t: 0, life: 0.35, big: true });
  scorchHook(x, y, NUKE_R * 0.7); game.shake = Math.min(22, game.shake + 18); sfx('bigboom', x);
  logMsg(byTeam === PLAYER ? '☢ Missile detonation' : '☢ ' + FAC[byTeam].name + ' missile detonation', 'war');
}
function detonateThermo(x: number, y: number, byTeam: number) {
  detonate(x, y, byTeam, THERMO_R, 4200, 7000);                                 // colossal — flattens a clustered base
  spawnParts('fire', x, y, 140, '255,180,80'); spawnParts('ember', x, y, 80, '255,210,120'); spawnParts('smoke', x, y, 120, '70,68,72'); spawnParts('debris', x, y, 70, '120,120,128');
  game.parts.push({ type: 'ring', x, y, t: 0, life: 1.8, big: true });
  game.parts.push({ type: 'shock', x, y, t: 0, life: 1.3, big: true });
  game.parts.push({ type: 'shock', x, y, t: 0, life: 1.9, big: true });        // second, slower shockwave
  game.parts.push({ type: 'flash', x, y, t: 0, life: 0.6, big: true });
  scorchHook(x, y, THERMO_R * 0.6); game.shake = Math.min(40, game.shake + 36); sfx('bigboom', x);
  logMsg('☢☢ THERMONUCLEAR DETONATION — ' + (byTeam === PLAYER ? 'target erased' : FAC[byTeam].name + ' unleashes a thermonuke'), 'war');
}
function detonateOrbital(x: number, y: number, byTeam: number) {
  detonate(x, y, byTeam, ORBITAL_R, 1500, 2400);                                // small radius, brutal on whatever's under it
  // a searing vertical ion column + a tight ground burst
  for (let i = 0; i < 7; i++) game.parts.push({ type: 'flash', x, y: y - i * 26, t: 0, life: 0.3 + i * 0.02, big: false });
  spawnParts('spark', x, y, 40, '170,235,255'); spawnParts('ember', x, y, 22, '150,220,255'); spawnParts('smoke', x, y, 28, '70,74,82');
  game.parts.push({ type: 'ring', x, y, t: 0, life: 0.9, big: true });
  game.parts.push({ type: 'shock', x, y, t: 0, life: 0.7, big: false });
  game.parts.push({ type: 'flash', x, y, t: 0, life: 0.3, big: true });
  scorchHook(x, y, ORBITAL_R * 0.7); game.shake = Math.min(16, game.shake + 11); sfx('bigboom', x);
  logMsg(byTeam === PLAYER ? '⚡ Orbital ion strike — target vaporized' : '⚡ ' + FAC[byTeam].name + ' calls down an orbital ion strike', 'war');
}
// ── Proximity mines (Deploy Minefield ability) ───────────────────────────────
const MINE_COUNT = 8;        // mines scattered per cast
const MINE_SPREAD = 115;     // radius they scatter within
const MINE_ARM = 1.5;        // arming delay before a mine is live
const MINE_TRIGGER = 30;     // an enemy this close trips it
const MINE_R = 92;           // blast radius
let mineTrip = 0;
const MINE_GLOBAL_CAP = 240;  // hard cap on live mines (AI lays them over a long match) — drop the oldest past this
function layMinefield(x: number, y: number, team: number) {
  for (let i = 0; i < MINE_COUNT; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * MINE_SPREAD;
    const mx = clamp(x + Math.cos(a) * r, TILE, WORLD_W - TILE), my = clamp(y + Math.sin(a) * r, TILE, WORLD_H - TILE);
    game.mines.push({ id: nextId++, x: mx, y: my, team, armAt: game.t + MINE_ARM });
  }
  if (game.mines.length > MINE_GLOBAL_CAP) game.mines.splice(0, game.mines.length - MINE_GLOBAL_CAP);
}
function mineTick(dt: number) {
  mineTrip += dt; if (mineTrip < 0.15) return; mineTrip = 0;     // ~7Hz proximity scan
  if (!game.mines.length) return;
  for (let i = game.mines.length - 1; i >= 0; i--) {
    const m = game.mines[i];
    if (game.t < m.armAt) continue;
    let trip = false;
    forNearbyUnits(m.x, m.y, MINE_TRIGGER, (u) => { if (!trip && isWar(m.team, u.team) && (u.tunnelT ?? 0) <= 0 && dist(u, m) < MINE_TRIGGER) trip = true; });
    if (trip) {
      game.mines.splice(i, 1);
      detonate(m.x, m.y, m.team, MINE_R, 240, 120);             // anti-personnel: brutal on units, light on structures
      spawnParts('fire', m.x, m.y, 16, '255,170,70'); spawnParts('debris', m.x, m.y, 10, '110,110,118'); spawnParts('smoke', m.x, m.y, 8, '70,70,76');
      game.parts.push({ type: 'ring', x: m.x, y: m.y, t: 0, life: 0.5, big: false });
      game.parts.push({ type: 'flash', x: m.x, y: m.y, t: 0, life: 0.14, big: false });
      scorchHook(m.x, m.y, 22); game.shake = Math.min(8, game.shake + 3); sfx('boom', m.x);
      if (isAllied(PLAYER, m.team)) logMsg('Mine detonated — chokepoint holds', 'good');
      else if (tileVisible(m.x, m.y)) logMsg('⚠ We hit a ' + FAC[m.team].name + ' minefield!', 'war', { x: m.x, y: m.y });
    }
  }
}
function processStrikes() {
  if (!pendingStrikes.length) return;
  const due = pendingStrikes.filter(s => s.at <= game.t);
  if (!due.length) return;
  pendingStrikes = pendingStrikes.filter(s => s.at > game.t);
  for (const s of due) {
    if (s.kind !== 'orbital' && s.kind !== 'carpet' && tryIntercept(s)) continue;   // orbital = beam, carpet = spread bombs → nothing to shoot down
    if (s.kind === 'thermo') detonateThermo(s.x, s.y, s.team);
    else if (s.kind === 'orbital') detonateOrbital(s.x, s.y, s.team);
    else if (s.kind === 'carpet') detonateCarpet(s.x, s.y, s.team);
    else detonateNuke(s.x, s.y, s.team);
  }
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
  const need = ({ warlord: 75, merchant: 40, covert: 55, industrial: 45 } as Record<string, number>)[FAC[f].persona];
  if (getRel(PLAYER, f) >= need) {
    dip.alliance[k] = true; delete dip.trade[k]; addRel(PLAYER, f, 10);
    logMsg('ALLIANCE forged with ' + FAC[f].name + ' — shared vision active', 'good'); sfx('chime');
  } else logMsg(FAC[f].name + ' declines. (Needs relations ≥ ' + need + ', now ' + Math.round(getRel(PLAYER, f)) + ')');
}
export function dipWar(f: number) {
  setRel(PLAYER, f, Math.min(getRel(PLAYER, f), -60));
  delete dip.alliance[rk(PLAYER, f)]; delete dip.trade[rk(PLAYER, f)]; delete dip.truce[rk(PLAYER, f)];
  logMsg('WAR declared on ' + FAC[f].name, 'war'); sfx('war');
}

// ── Sue for peace / ceasefires ───────────────────────────────────────────────
const TRUCE_TIME = 90;       // a signed ceasefire holds relations out of war for this long (then drift can reignite it)
const PEACE_COST = 400;      // crystals offered as reparations when the player initiates a ceasefire
const PEACE_PROPOSE_CD = 25; // seconds before the player can re-propose after a rebuff (anti-spam)
const TRUCE_FLOOR = -10;     // relations a ceasefire settles at (above the −30 war line)
// How desperate a faction must be (its strength as a fraction of its strongest enemy's) before it
// will SUE for peace on its own — warlords are stubborn, merchants/builders pragmatic.
const PEACE_THRESH: Record<string, number> = { warlord: 0.35, covert: 0.5, industrial: 0.6, merchant: 0.62, player: 0.5 };
/** Rough military weight of a faction: buildings count double, combat units once (support/heroes aside). */
function factionStrength(team: number) {
  let s = 0;
  for (const b of game.buildings) if (b.team === team && !game.eliminated[team]) s += 2;
  for (const u of game.units) if (u.team === team && !isSupport(u.type)) s += 1;
  return s;
}
function signCeasefire(a: number, b: number, viaOffer: boolean) {
  setRel(a, b, TRUCE_FLOOR);
  dip.truce[rk(a, b)] = game.t + TRUCE_TIME;
  delete aiPeaceOffer[a === PLAYER ? b : a];
  const other = a === PLAYER ? b : (b === PLAYER ? a : b);
  if (a === PLAYER || b === PLAYER) {
    logMsg('☮ CEASEFIRE with ' + FAC[other].name + (viaOffer ? ' — their peace offer accepted' : ' — the guns fall silent'), 'good');
    sfx('chime');
  } else logMsg(FAC[a].name + ' and ' + FAC[b].name + ' agree to a ceasefire');
}
/** Player sues the faction f for peace. Free + automatic if they're already offering; else a paid bid the
 *  target weighs by how the war is going for it and its persona (warlords resist unless badly beaten). */
export function dipPeace(f: number) {
  if (!isWar(PLAYER, f)) { hint('Not at war with ' + FAC[f].name); return; }
  if (aiPeaceOffer[f] > game.t) { signCeasefire(PLAYER, f, true); return; }   // they offered → accept for free
  const k = rk(PLAYER, f);
  if ((peaceCd[k] || 0) > game.t) { hint(FAC[f].name + ' won’t hear another overture yet'); return; }
  if (game.money[PLAYER] < PEACE_COST) { hint('Need ' + PEACE_COST + ' crystals for reparations'); return; }
  const ps = factionStrength(PLAYER), fs = factionStrength(f);
  let chance = ({ warlord: 0.30, merchant: 0.80, covert: 0.55, industrial: 0.65, player: 0.5 } as Record<string, number>)[FAC[f].persona] ?? 0.5;
  if (fs < ps * 0.7) chance += 0.45;        // they're losing → keen to stop the bleeding
  else if (fs > ps * 1.4) chance -= 0.35;   // they're winning → why would they?
  chance = clamp(chance, 0.05, 0.95);
  if (Math.random() < chance) {
    game.money[PLAYER] -= PEACE_COST;       // reparations paid only on a deal
    signCeasefire(PLAYER, f, false);
  } else {
    addRel(PLAYER, f, 3);                    // the gesture earns a little goodwill even when rebuffed
    peaceCd[k] = game.t + PEACE_PROPOSE_CD;
    logMsg(FAC[f].name + ' rebuffs your overture — the war goes on', 'war');
  }
}
export const hasPeaceOffer = (f: number) => (aiPeaceOffer[f] || 0) > game.t;
/** Proactive AI peace: a faction losing its war badly de-escalates. AI↔AI auto-resolves to a ceasefire;
 *  AI→player surfaces a standing offer the player can accept (it never auto-ends the player's war). */
function proactivePeace() {
  for (const a of ALL_TEAMS) for (const b of ALL_TEAMS) {
    if (a >= b || game.eliminated[a] || game.eliminated[b]) continue;
    if (!isWar(a, b)) continue;
    const k = rk(a, b);
    if ((dip.truce[k] || 0) > game.t) continue;             // already under a ceasefire
    const sa = factionStrength(a), sb = factionStrength(b);
    const weak = sa <= sb ? a : b, strong = weak === a ? b : a;
    const ws = Math.min(sa, sb), ss = Math.max(sa, sb);
    if (ss < 6 || ws >= ss * (PEACE_THRESH[FAC[weak].persona] ?? 0.5)) continue;   // not desperate enough yet
    if (weak === PLAYER) continue;                          // the player decides their own wars
    if (strong === PLAYER) {
      // the AI sues the human — stand up a free offer + a throttled feed line, but don't force the war to end
      aiPeaceOffer[weak] = game.t + 30;
      if ((lastPeaceLog[weak] || -99) + 40 < game.t) { lastPeaceLog[weak] = game.t; logMsg('☮ ' + FAC[weak].name + ' sues for peace — accept in the Diplomacy panel', 'good'); }
    } else {
      // two AIs — the loser de-escalates; when it climbs out of war they sign a ceasefire
      addRel(a, b, 5);
      if (!isWar(a, b)) signCeasefire(a, b, false);
    }
  }
}

// ── World diplomacy & AI ─────────────────────────────────────────────────────
function diplomacyTick() {
  const targets: Record<string, { 1: number; def: number }> = {
    warlord: { 1: -55, def: -28 }, merchant: { 1: 18, def: 14 }, covert: { 1: -2, def: -2 },
    industrial: { 1: 6, def: 8 },   // a builder: wary of no one, mildly cooperative
  };
  for (const a of AIS) {
    if (game.eliminated[a]) continue;
    for (const b of ALL_TEAMS) {
      if (b === a || game.eliminated[b]) continue;
      if ((dip.truce[rk(a, b)] || 0) > game.t) { if (getRel(a, b) < TRUCE_FLOOR) setRel(a, b, TRUCE_FLOOR); continue; }   // a ceasefire freezes the drift
      const tg2 = targets[FAC[a].persona];
      const want = (b === 1 ? tg2[1] : tg2.def), cur = getRel(a, b);
      if (Math.abs(cur - want) > 1) addRel(a, b, cur < want ? 0.9 : -0.9);
    }
  }
  for (const k in dip.trade) { const [a, b] = k.split('-').map(Number); addRel(a, b, 1); }
  for (const k in dip.alliance) {
    const [a, b] = k.split('-').map(Number);
    for (const c of ALL_TEAMS) {
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
  for (const k in dip.truce) {                                  // a live ceasefire holds relations off the war line
    if (dip.truce[k] <= game.t) { delete dip.truce[k]; continue; }
    if ((dip.rel[k] ?? 0) < TRUCE_FLOOR) dip.rel[k] = TRUCE_FLOOR;
  }
  proactivePeace();                                             // losing factions de-escalate / sue for peace
  for (const a of ALL_TEAMS) for (const b of ALL_TEAMS) {
    if (a >= b) continue;
    const k = rk(a, b), st = stateOf(a, b);
    if (lastStates[k] && lastStates[k] !== 'WAR' && st === 'WAR') { logMsg('WAR: ' + FAC[a].name + ' ⚔ ' + FAC[b].name, 'war'); sfx('war'); }
    lastStates[k] = st;
  }
}
/** Conditional advanced-build pass — fields the Session-2 tech (Iron Dome, Missile Silo, …) when the
 *  AI's economy can support it. Robust to timing unlike the fixed AI_SCRIPT: it builds each once, as
 *  money + alloy allow, so the player's missiles meet domes and the AI can threaten back. */
function aiTech(team: number) {
  const ai = game.ai[team];
  if (game.t < ai.techT) return;
  ai.techT = game.t + 6 + Math.random() * 5;
  const count = (t: string) => game.buildings.filter(b => b.team === team && b.type === t).length;
  const place = (t: string, dx: number, dy: number, moneyBuf: number): boolean => {
    const ba = alloyCost(team, B[t].alloy);
    if (game.money[team] < B[t].cost + moneyBuf || ba > (game.alloy[team] || 0)) return false;
    if (!aiPlace(team, t, dx, dy, false)) return false;
    game.money[team] -= B[t].cost; game.alloy[team] -= ba; return true;
  };
  // Alloy-free builds (no Smelter needed): wood economy, water draw, and a fortified front.
  if (game.t > 200 && !count('mill') && place('mill', -6, 8, 700)) return;          // wood → Repair Rigs
  if (game.t > 250 && !count('watertower') && place('watertower', -3, 7, 800)) return;
  // a short rampart of Walls + a Blast Gate toward the front (its own units pass the gate; sparse → no self-trap)
  if (game.t > 230 && count('wall') < 4 && place('wall', 4 + count('wall') * 2, 11, 350)) return;
  if (game.t > 250 && !count('gate') && place('gate', 8, 11, 500)) return;
  if (!game.buildings.some(b => b.team === team && b.type === 'smelter')) return;   // alloy-gated tech below needs a Smelter
  // Warlords reach for the offensive Silo first; everyone else shields up with an Iron Dome first.
  if (FAC[team].persona === 'warlord') {
    if (game.t > 360 && !count('silo') && place('silo', 7, 4, 900)) return;
    if (game.t > 300 && !count('idome') && place('idome', 5, 6, 600)) return;
  } else {
    if (game.t > 300 && !count('idome') && place('idome', 5, 6, 600)) return;
    if (game.t > 420 && !count('silo') && place('silo', 7, 4, 1100)) return;
  }
  if (game.t > 320 && count('tesla') < 2 && place('tesla', 5 + count('tesla') * 3, 10, 700)) return;  // chain-lightning anti-swarm defense
  if (game.t > 380 && !count('shieldgen') && place('shieldgen', 6, 8, 1200)) return;  // damage-absorbing field over the base
  if (game.t > 340 && !count('cyber') && place('cyber', -4, 9, 1400)) return;       // EMP / covert legitimacy
  if (game.t > 480 && !count('drillbay') && place('drillbay', 9, 8, 1800)) return;  // Subterranean Borer + Hero excavation
  if (game.t > 600 && count('idome') < 2 && place('idome', 8, 7, 1400)) return;     // a 2nd dome for a sprawling base
}

/** Hero hunt + excavation for an AI with a Deep Bore Facility: Survey Hunters seek the nearest vault
 *  (AI knows the locations — a convenience cheat), then idle Borers drill a surveyed/known vault. */
function aiHero(team: number) {
  if (!game.buildings.some(b => b.team === team && b.type === 'drillbay' && b.progress >= 1)) return;
  const open = game.vaults.filter(v => !v.done);
  if (!open.length) return;
  const hunter = game.units.find(u => u.team === team && u.type === 'hunter' && u.order === 'idle');
  if (hunter) {
    const tgt = open.filter(v => v.discBy !== team).sort((a, b) => dist(hunter, a) - dist(hunter, b))[0];
    if (tgt) { hunter.order = 'move'; hunter.dest = { x: tgt.x, y: tgt.y }; setPath(hunter, tgt.x, tgt.y); }
  }
  const borer = game.units.find(u => u.team === team && u.type === 'borer' && u.order === 'idle');
  if (borer) {
    const known = open.filter(v => v.discBy === team || v.discovered).sort((a, b) => dist(borer, a) - dist(borer, b))[0];
    if (known) { borer.order = 'dig'; borer.digVault = known.id; borer.target = null; borer.path = null; }
  }
}

function aiUpdate(team: number, dt: number) {
  if (game.eliminated[team]) return;
  const ai = game.ai[team];
  const persona = FAC[team].persona;
  aiTech(team);
  const tShift = persona === 'warlord' ? -25 : (persona === 'merchant' ? 30 : persona === 'industrial' ? -10 : 0);
  while (ai.builtIdx < AI_SCRIPT.length && game.t >= AI_SCRIPT[ai.builtIdx].t + tShift) {
    const step = AI_SCRIPT[ai.builtIdx]; ai.builtIdx++;
    const ba = alloyCost(team, B[step.type].alloy);
    if (game.money[team] >= B[step.type].cost && ba <= (game.alloy[team] || 0)) {
      if (aiPlace(team, step.type, step.dx, step.dy, false)) { game.money[team] -= B[step.type].cost; game.alloy[team] -= ba; }
    }
  }
  if (game.t > 320) game.money[team] += 6 * dt;
  if (persona === 'merchant') game.money[team] += 4 * dt;
  if (persona === 'industrial') game.money[team] += 6 * dt;   // builder economy: steady production edge
  // Missile offense — parity with the player: the AI must own a Missile Silo, pay the cost, and respect a
  // cooldown. It goes thermonuclear when flush, else ballistic → the player's Iron Dome earns its keep.
  if (game.t >= ai.missileT && game.buildings.some(b => b.team === team && b.type === 'silo' && b.progress >= 1)) {
    const enemies = ALL_TEAMS.filter(f => f !== team && !game.eliminated[f] && isWar(team, f) && game.buildings.some(b => b.team === f));
    if (enemies.length) {
      const tgt = (enemies.includes(PLAYER) && Math.random() < 0.6) ? PLAYER : enemies[Math.random() * enemies.length | 0];
      const hq = game.buildings.find(b => b.team === tgt && b.type === 'hq') || game.buildings.find(b => b.team === tgt);
      if (hq) {
        const canThermo = game.money[team] >= ABILITIES.thermo.cost && (game.alloy[team] || 0) >= (ABILITIES.thermo.alloy || 0);
        const canOrbital = game.money[team] >= ABILITIES.orbital.cost && (game.alloy[team] || 0) >= (ABILITIES.orbital.alloy || 0);
        const canCarpet = game.money[team] >= ABILITIES.carpet.cost && (game.alloy[team] || 0) >= (ABILITIES.carpet.alloy || 0);
        let kind: 'nuke' | 'thermo' | 'orbital' | 'carpet';
        if (canThermo && Math.random() < (persona === 'warlord' ? 0.45 : 0.3)) kind = 'thermo';
        else if (canOrbital && Math.random() < 0.4) kind = 'orbital';   // surgical, uninterceptable — punishes a dome-turtle
        else if (canCarpet && Math.random() < 0.4) kind = 'carpet';     // wide line of blasts — area denial
        else kind = 'nuke';
        const a = ABILITIES[kind];
        if (game.money[team] >= a.cost && (game.alloy[team] || 0) >= (a.alloy || 0)) {
          game.money[team] -= a.cost; game.alloy[team] -= (a.alloy || 0);
          ai.missileT = game.t + a.cd * 0.8 + Math.random() * 45;
          if (kind === 'carpet') {
            const ownHq = game.buildings.find(b => b.team === team && b.type === 'hq') || game.buildings.find(b => b.team === team);
            launchCarpet(hq.x, hq.y, team, ownHq ? ownHq.x : hq.x - 400, ownHq ? ownHq.y : hq.y);
          } else {
            const travel = kind === 'thermo' ? THERMO_TRAVEL : kind === 'orbital' ? ORBITAL_TRAVEL : NUKE_TRAVEL;
            const scatter = kind === 'orbital' ? 14 : 45;                // orbital is precise — aim right at the structure
            pendingStrikes.push({ x: hq.x + (Math.random() * 2 - 1) * scatter, y: hq.y + (Math.random() * 2 - 1) * scatter, at: game.t + travel + 2, team, kind });
          }
          if (tgt === PLAYER || isAllied(PLAYER, tgt)) {
            const label = kind === 'thermo' ? 'THERMONUCLEAR MISSILE' : kind === 'orbital' ? 'ORBITAL ION STRIKE' : kind === 'carpet' ? 'CARPET BOMB RUN' : 'BALLISTIC MISSILE';
            logMsg('⚠ INBOUND ' + label + ' from ' + FAC[team].name + (kind === 'orbital' || kind === 'carpet' ? ' — no intercept, scatter!' : ' — intercept or scatter!'), 'war', { x: hq.x, y: hq.y }); sfx('klaxon');
          }
        } else {
          ai.missileT = game.t + 20;   // can't afford yet — re-check soon
        }
      }
    }
  }
  // Cyber: with a Cyber Ops Center the AI periodically EMPs a cluster of an enemy's combatants (pays the cost).
  if (game.t >= ai.empT && game.money[team] >= ABILITIES.emp.cost && game.buildings.some(b => b.team === team && b.type === 'cyber' && b.progress >= 1)) {
    const foes = game.units.filter(u => isWar(team, u.team) && !isSupport(u.type) && !U[u.type].hero);
    if (foes.length) {
      const c = foes[Math.random() * foes.length | 0];
      game.money[team] -= ABILITIES.emp.cost; ai.empT = game.t + 55 + Math.random() * 45;
      for (const u of game.units) if (!isAllied(team, u.team) && dist(u, c) < 132) u.disabledUntil = game.t + 8;
      for (const b of game.buildings) if (!isAllied(team, b.team) && b.type === 'turret' && dist(b, c) < 132) b.disabledUntil = game.t + 8;
      game.parts.push({ type: 'emp', x: c.x, y: c.y, t: 0, life: 0.85 });
      if (isAllied(PLAYER, c.team) || tileVisible(c.x, c.y)) { logMsg(FAC[team].name + ' unleashed an EMP pulse — systems offline', 'war'); sfx('emp', c.x); }
    } else ai.empT = game.t + 15;
  }
  // Cyber: System Hijack — the AI permanently steals an enemy combat unit (pays the cost).
  if (game.t >= ai.hijackT && game.money[team] >= ABILITIES.hijack.cost && game.buildings.some(b => b.team === team && b.type === 'cyber' && b.progress >= 1)) {
    const foes = game.units.filter(u => isWar(team, u.team) && !isSupport(u.type) && !U[u.type].hero);
    if (foes.length) {
      const v = foes[Math.random() * foes.length | 0]; const was = v.team;
      game.money[team] -= ABILITIES.hijack.cost; ai.hijackT = game.t + 95 + Math.random() * 70;
      v.team = team; v.order = 'idle'; v.target = null; v.path = null; v.hState = 'find'; v.hNode = null; v.guard = null;
      game.parts.push({ type: 'emp', x: v.x, y: v.y, t: 0, life: 0.8 });
      if (was === PLAYER || isAllied(PLAYER, was)) { logMsg(FAC[team].name + ' HIJACKED our ' + U[v.type].name + '!', 'war'); sfx('covert', v.x); }
    } else ai.hijackT = game.t + 20;
  }
  // Cyber: Overcharge — the AI stims a dense cluster of its own army when it's engaging (times it with a push).
  if (game.t >= (ai.buffT ?? 0) && game.money[team] >= ABILITIES.overcharge.cost && game.buildings.some(b => b.team === team && b.type === 'cyber' && b.progress >= 1)) {
    const mine = game.units.filter(u => u.team === team && !isSupport(u.type) && (U[u.type].dmg || 0) > 0 && !buffed(u));
    let best: Unit | null = null, bn = 0;
    for (const u of mine) {
      const near = mine.reduce((s, o) => s + (dist(o, u) < OVERCHARGE_R ? 1 : 0), 0);
      if (near > bn && game.units.some(e => isWar(team, e.team) && dist(e, u) < OVERCHARGE_R * 2)) { bn = near; best = u; }
    }
    if (best && bn >= 4) {
      game.money[team] -= ABILITIES.overcharge.cost; ai.buffT = game.t + 70 + Math.random() * 40;
      for (const u of game.units) if (u.team === team && !isSupport(u.type) && dist(u, best) < OVERCHARGE_R) u.buffUntil = game.t + OVERCHARGE_DUR;
      game.parts.push({ type: 'ring', x: best.x, y: best.y, t: 0, life: 0.8, big: true });
      if (tileVisible(best.x, best.y)) logMsg(FAC[team].name + ' overcharges its assault force', 'war');
    } else ai.buffT = game.t + 12;
  }
  // Cyber: lay a defensive Minefield on the approach to the AI's HQ (toward the map centre, where attacks come from).
  if (game.t >= (ai.mineT ?? 0) && game.money[team] >= ABILITIES.minefield.cost && game.buildings.some(b => b.team === team && b.type === 'cyber' && b.progress >= 1)) {
    const hq = game.buildings.find(b => b.team === team && b.type === 'hq');
    if (hq) {
      const dx = MAPW * TILE / 2 - hq.x, dy = MAPH * TILE / 2 - hq.y, len = Math.hypot(dx, dy) || 1;
      game.money[team] -= ABILITIES.minefield.cost; ai.mineT = game.t + 80 + Math.random() * 60;
      layMinefield(hq.x + dx / len * 130, hq.y + dy / len * 130, team);
    } else ai.mineT = game.t + 20;
  }
  // Cyber: Chrono Freeze — lock down a dense cluster of an enemy's combatants (pays the cost).
  if (game.t >= (ai.chronoT ?? 0) && game.money[team] >= ABILITIES.chrono.cost && game.buildings.some(b => b.team === team && b.type === 'cyber' && b.progress >= 1)) {
    const foes = game.units.filter(u => isWar(team, u.team) && !isSupport(u.type) && !U[u.type].hero);
    let best: Unit | null = null, bn = 0;
    for (const u of foes) { const near = foes.reduce((s, o) => s + (dist(o, u) < CHRONO_R ? 1 : 0), 0); if (near > bn) { bn = near; best = u; } }
    if (best && bn >= 4) {
      game.money[team] -= ABILITIES.chrono.cost; ai.chronoT = game.t + 110 + Math.random() * 60;
      chronoFreeze(best.x, best.y, team);
      if (tileVisible(best.x, best.y)) { logMsg(FAC[team].name + ' froze our advance with a Chrono Freeze', 'war'); sfx('emp', best.x); }
    } else ai.chronoT = game.t + 15;
  }
  // Garrison: occasionally tuck a spare IDLE infantryman into a nearby building for defense (never the whole army).
  if (Math.random() < dt * 0.15) {
    const inf = game.units.find(u => u.team === team && U[u.type].infantry && u.order === 'idle' && !U[u.type].hero);
    if (inf) {
      const b = game.buildings.find(bb => bb.team === team && garrisonable(bb) && (bb.garrison?.length || 0) < GARRISON_CAP && dist(bb, inf) < 12 * TILE);
      if (b) { inf.order = 'enter'; inf.guard = b; inf.target = null; inf.enterT = game.t; const sp = freeSpotNear(b.x, b.y + b.h * 0.6); inf.dest = sp; setPath(inf, sp.x, sp.y); }   // path to a passable spot beside it (centre is solid → A* would fail & thrash)
    }
  }
  // conscript from a surplus population when short on crystals (the people as a reserve)
  if ((game.pop[team] || 0) > 34 && game.money[team] < 500 && Math.random() < dt * 0.25) conscript(team);
  const harv = game.units.filter(u => u.team === team && u.type === 'harvester').length;
  const tankers = game.units.filter(u => u.team === team && u.type === 'tanker').length;
  const haulers = game.units.filter(u => u.team === team && u.type === 'hauler').length;
  const hasCoolantDepot = game.buildings.some(b => b.team === team && b.type === 'pump' && b.progress >= 1);
  const hasAlloyDepot = game.buildings.some(b => b.team === team && b.type === 'smelter' && b.progress >= 1);
  const hasMill = game.buildings.some(b => b.team === team && b.type === 'mill' && b.progress >= 1);
  const hasDrill = game.buildings.some(b => b.team === team && b.type === 'drillbay' && b.progress >= 1);
  const hasCyberB = game.buildings.some(b => b.team === team && b.type === 'cyber' && b.progress >= 1);
  const foundries = game.buildings.filter(b => b.team === team && b.type === 'foundry' && b.progress >= 1);
  const countType = (t: string) => game.units.reduce((s, u) => s + (u.team === team && u.type === t ? 1 : 0), 0);
  if (foundries.length && foundries[0].queue.length === 0) {
    if (harv < 2 && game.money[team] > 700) { foundries[0].queue.push('harvester'); game.money[team] -= U.harvester.cost; }
    else if (hasCoolantDepot && tankers < 2 && game.money[team] > 800) { foundries[0].queue.push('tanker'); game.money[team] -= U.tanker.cost; }
    else if (hasAlloyDepot && haulers < 2 && game.money[team] > 800) { foundries[0].queue.push('hauler'); game.money[team] -= U.hauler.cost; }
  }
  // Repair Rigs (sustain) + a Survey Hunter (hero scout) take any free foundry slot — not gated on foundry #0
  // being idle (army production keeps it busy). An in-flight guard avoids over-queuing past the cap.
  const anyQueued = (t: string) => foundries.some(f => f.queue.includes(t));
  const fSup = foundries.find(fo => fo.queue.length < 2);
  if (fSup) {
    if (hasMill && countType('repair') < 2 && !anyQueued('repair') && game.money[team] > 800) { fSup.queue.push('repair'); game.money[team] -= U.repair.cost; }
    else if (hasDrill && countType('hunter') < 1 && !anyQueued('hunter') && game.money[team] > 900) { fSup.queue.push('hunter'); game.money[team] -= U.hunter.cost; }
    else if (hasCyberB && game.money[team] > 1500 && Math.random() < dt * 0.03) {   // a special character — one of each per AI, occasionally
      const special = ['cartman', 'kenny', 'stan', 'kyle', 'jedi', 'sith', 'bountyhunter', 'droideka'].find(s => countType(s) < 1 && !anyQueued(s) && !respawnQueue.some(r => r.team === team && r.type === s) && game.money[team] >= U[s].cost);
      if (special) { fSup.queue.push(special); game.money[team] -= U[special].cost; }
    }
  }
  // Diplomacy parity: field an Envoy and send it to court the nearest neutral settlement (peaceful expansion).
  const neutralSettles = game.settlements.filter(s => !s.owner);
  if (neutralSettles.length) {
    const fEnv = foundries.find(fo => fo.queue.length < 2);
    if (fEnv && countType('envoy') < 2 && !anyQueued('envoy') && game.money[team] > 500 && game.t >= (ai.envoyT ?? 0)) {
      fEnv.queue.push('envoy'); game.money[team] -= U.envoy.cost; ai.envoyT = game.t + 60 + Math.random() * 40;
    }
    const idleEnvoy = game.units.find(u => u.team === team && U[u.type].diplomat && u.order === 'idle' && (u.recourtT ?? 0) <= game.t);
    if (idleEnvoy) {
      const tgt = neutralSettles.slice().sort((a, b) => dist(idleEnvoy, a) - dist(idleEnvoy, b))[0];
      if (tgt) { idleEnvoy.order = 'court'; idleEnvoy.courtId = tgt.id; idleEnvoy.target = null; const sp = freeSpotNear(tgt.x, tgt.y); idleEnvoy.dest = sp; setPath(idleEnvoy, sp.x, sp.y); }
    }
  }
  // Combat-vehicle parity: Sentry Pods (deploy forward turrets) + APC transports (ferry infantry to the front)
  if (game.t > 280) {
    const fVeh = foundries.find(fo => fo.queue.length < 2);
    if (fVeh && countType('sentrypod') < 1 && !anyQueued('sentrypod') && game.money[team] > 900 && Math.random() < dt * 0.05) { fVeh.queue.push('sentrypod'); game.money[team] -= U.sentrypod.cost; }
    const idlePod = game.units.find(u => u.team === team && U[u.type].deployable && u.order === 'idle');
    if (idlePod) {
      const tx = Math.round(idlePod.x / TILE - B.turret.w / 2), ty = Math.round(idlePod.y / TILE - B.turret.h / 2);
      if (footprintFree('turret', tx, ty)) { const b = addBuilding('turret', tx, ty, team, true); b.fromPod = true; b.hp = idlePod.hp; game.units = game.units.filter(x => x !== idlePod); }
    }
    if (fVeh && countType('transport') < 1 && !anyQueued('transport') && game.money[team] > 1100 && Math.random() < dt * 0.04) { fVeh.queue.push('transport'); game.money[team] -= U.transport.cost; }
    const apc = game.units.find(u => u.team === team && U[u.type].transport);
    if (apc) {
      const cap = U.transport.capacity || 5;
      if ((apc.cargoUnits?.length || 0) < cap) {                          // load nearby idle infantry
        const inf = game.units.find(u => u.team === team && U[u.type].infantry && u.order === 'idle' && !U[u.type].hero && dist(u, apc) < 10 * TILE);
        if (inf) { inf.order = 'board'; inf.guard = apc; inf.target = null; inf.enterT = game.t; setPath(inf, apc.x, apc.y); }
      }
      if ((apc.cargoUnits?.length || 0) >= 2) {                           // loaded → drive to an enemy building & disembark
        const enemyB = game.buildings.filter(b => isWar(team, b.team)).sort((a, b) => dist(apc, a) - dist(apc, b))[0];
        if (enemyB) {
          if (dist(apc, enemyB) < 220) { unloadTransport(apc, false); apc.order = 'idle'; }
          else if (apc.order === 'idle' || !apc.path) { apc.order = 'move'; apc.dest = { x: enemyB.x, y: enemyB.y }; setPath(apc, enemyB.x, enemyB.y); }
        }
      }
    }
  }
  const army = game.units.filter(u => u.team === team && !isSupport(u.type));
  if (foundries.length && game.money[team] > 900) {
    const f = foundries.find(fo => fo.queue.length < 2);
    if (f) {
      // late-game combined-arms: guarantee a standing core of advanced units…
      let pick: string | null = null;
      if (game.t > 300) {
        if (hasDrill && countType('borer') < 2 && !anyQueued('borer')) pick = 'borer';   // burrowing assault drill
        else if (hasCyberB && countType('spectre') < 3 && !anyQueued('spectre')) pick = 'spectre';   // cloaked raiders
        else if (countType('aircraft') < 3) pick = 'aircraft';
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
        if (alloyCost(team, U[pick].alloy) > (game.alloy[team] || 0)) pick = 'strike';   // alloy-starved → basic armor
        if (game.money[team] >= U[pick].cost && alloyCost(team, U[pick].alloy) <= (game.alloy[team] || 0)) {
          f.queue.push(pick); game.money[team] -= U[pick].cost; game.alloy[team] -= alloyCost(team, U[pick].alloy);
        }
      }
    }
  }
  aiHero(team);   // divert idle Survey Hunters / Borers to hero vaults BEFORE the wave grabs idle units
  aiLandmark(team);   // divert an idle special character to claim a Legendary Landmark
  if (game.t >= ai.nextWave) {
    ai.waveN++;
    const size = Math.min(16, 2 + Math.ceil(ai.waveN * 1.7));
    const squad = army.filter(u => u.order === 'idle' && !U[u.type].survey).slice(0, size);   // keep hunters out of combat waves
    const relayTargets = game.relays.filter(r => r.owner !== team);
    const contestRelay = relayTargets.length && Math.random() < 0.45;   // half the time, fight for an objective
    if (squad.length >= Math.min(3, size)) {
      if (contestRelay) {
        const bi = BASE_INFO[team], bx = (bi.tx + 1) * TILE, by = (bi.ty + 1) * TILE;
        relayTargets.sort((a, b) => dist(a, { x: bx, y: by }) - dist(b, { x: bx, y: by }));
        const r = relayTargets[0];
        for (const u of squad) { u.order = 'amove'; u.dest = { x: r.x + (Math.random() * 70 - 35), y: r.y + (Math.random() * 70 - 35) }; setPath(u, u.dest.x, u.dest.y); }
        if (isAllied(PLAYER, team)) logMsg(FAC[team].name + ' (ally) moves on a Command Relay');
      } else {
        const enemies = ALL_TEAMS.filter(f => f !== team && !game.eliminated[f] && isWar(team, f) && game.buildings.some(b => b.team === f));
        if (enemies.length) {
          enemies.sort((a, b) => getRel(team, a) - getRel(team, b));
          const tgtTeam = enemies[0];
          const tBuilds = game.buildings.filter(b => b.team === tgtTeam);
          if (tBuilds.length) {
            const tb = tBuilds[Math.random() * tBuilds.length | 0];
            for (const u of squad) { u.order = 'amove'; u.dest = { x: tb.x + (Math.random() * 120 - 60), y: tb.y + (Math.random() * 120 - 60) }; setPath(u, u.dest.x, u.dest.y); }
            if (tgtTeam === PLAYER || isAllied(PLAYER, tgtTeam)) { logMsg(FAC[team].name + ' strike force inbound — wave ' + ai.waveN, 'war'); sfx('war'); }
            else logMsg(FAC[team].name + ' launches an assault on ' + FAC[tgtTeam].name);
          }
        }
      }
    }
    ai.nextWave = game.t + Math.max(50, 115 - ai.waveN * 8) + Math.random() * 20;
  }
  if (FAC[team].persona === 'covert' && game.t >= ai.covertT) {
    ai.covertT = game.t + 80 + Math.random() * 50;
    const victims = ALL_TEAMS.filter(f => f !== team && !game.eliminated[f] && !isAllied(team, f));
    if (victims.length) {
      victims.sort((a, b) => game.money[b] - game.money[a]);
      const v = victims[0];
      if (Math.random() < 0.55) {
        const amt = Math.min(500, Math.max(100, game.money[v] * 0.22)) | 0;
        game.money[v] -= amt; game.money[team] += amt;
        if (v === PLAYER) { logMsg(FAC[team].name + ' operatives siphoned ' + amt + ' crystals from our network', 'war'); sfx('covert'); }
      } else {
        const bl = game.buildings.filter(b => b.team === v && b.type !== 'hq');
        if (bl.length) {
          const pick = bl[Math.random() * bl.length | 0];
          pick.hp = Math.max(pick.hpMax * 0.1, pick.hp - pick.hpMax * 0.3);
          if (v === PLAYER) { logMsg(FAC[team].name + ' operatives sabotaged our ' + B[pick.type].name, 'war'); sfx('war'); spawnParts('fire', pick.x, pick.y, 10, '255,160,60'); }
        }
      }
      if (Math.random() < 0.3) addRel(team, v, -12);
    }
  }
}

// ── Orders, placement, training (player intent) ──────────────────────────────
/** Arrange `units` into a grid formation centred on (wx,wy), facing the movement direction.
 *  Returns one slot per unit (index-aligned), nearest-assigned to cut down on path crossing. */
function formationSlots(units: Unit[], wx: number, wy: number): Vec[] {
  const n = units.length;
  if (n <= 1) return n ? [{ x: wx, y: wy }] : [];
  let cx = 0, cy = 0; for (const u of units) { cx += u.x; cy += u.y; } cx /= n; cy /= n;
  const dir = Math.atan2(wy - cy, wx - cx);
  const fx = Math.cos(dir), fy = Math.sin(dir);        // forward (depth) axis — points the way they're going
  const rx = -Math.sin(dir), ry = Math.cos(dir);       // right (width) axis
  const S = Math.max(22, 2.4 * Math.max(...units.map(u => U[u.type].radius)));
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  const slots: Vec[] = [];
  for (let row = 0; row < rows && slots.length < n; row++) {
    for (let col = 0; col < cols && slots.length < n; col++) {
      const depth = ((rows - 1) / 2 - row) * S;        // front rows pushed ahead
      const width = (col - (cols - 1) / 2) * S;
      slots.push({ x: wx + fx * depth + rx * width, y: wy + fy * depth + ry * width });
    }
  }
  const used = new Array(n).fill(false), out: Vec[] = new Array(n);
  for (const slot of slots) {                          // each slot grabs its nearest still-free unit
    let best = -1, bd = Infinity;
    for (let u = 0; u < n; u++) { if (used[u]) continue; const d = (units[u].x - slot.x) ** 2 + (units[u].y - slot.y) ** 2; if (d < bd) { bd = d; best = u; } }
    if (best >= 0) { used[best] = true; out[best] = slot; }
  }
  return out;
}
/** True if the selection has at least one player combat unit (can be put on patrol). */
export function canPatrol() { return game.selection.some(s => s.kind === 'u' && (s as Unit).team === PLAYER && !isSupport((s as Unit).type) && ((U[(s as Unit).type].dmg || 0) > 0)); }
/** Arm patrol mode — next map click sets the patrol post for the selected combat units. */
export function armPatrol() {
  if (!canPatrol()) { hint('Select combat units to patrol'); return; }
  game.armed = 'patrol'; game.placing = null;
  hint('Patrol: click a spot to guard — they will hunt any enemy that enters the area');
}
/** Post the selected combat units to guard an area around (wx,wy). */
function patrolOrder(wx: number, wy: number) {
  let n = 0;
  for (const s of game.selection) {
    if (s.kind !== 'u') continue; const u = s as Unit;
    if (u.team !== PLAYER || isSupport(u.type) || (U[u.type].dmg || 0) <= 0) continue;   // combat units only
    u.order = 'patrol'; u.dest = { x: wx, y: wy }; u.target = null; u.guard = null; u.path = null; setPath(u, wx, wy); n++;
  }
  if (n) { hint(n + (n > 1 ? ' units' : ' unit') + ' on patrol — they will engage enemies entering the area'); sfx('click'); }
}
/** Drop a colored command-confirmation marker at a point (green move / red attack / cyan special). */
function orderMark(x: number, y: number, kind: 'move' | 'attack' | 'special') {
  const rgb = kind === 'attack' ? '232,72,58' : kind === 'special' ? '150,225,255' : '90,230,120';
  game.parts.push({ type: 'order', x, y, t: 0, life: 0.55, rgb });
}
export function issueOrder(wx: number, wy: number, fromAmove: boolean) {
  const sel = game.selection.filter(s => s.kind === 'u') as Unit[];
  if (!sel.length) {
    const f = game.selection.find(s => s.kind === 'b' && (s as Building).type === 'foundry') as Building | undefined;
    if (f) { f.rally = { x: wx, y: wy }; hint('Rally point set'); }
    return;
  }
  // right-click a discovered Hero Vault with a Borer selected → send it to excavate
  const clickedVault = game.vaults.find(v => v.discovered && !v.done && dist(v, { x: wx, y: wy }) < 34);
  if (clickedVault && sel.some(s => U[s.type].tunneler)) {
    for (const u of sel) if (U[u.type].tunneler) { u.order = 'dig'; u.digVault = clickedVault.id; u.target = null; u.guard = null; setPath(u, clickedVault.x, clickedVault.y); }
    hint('Borer dispatched to excavate the Hero Vault'); orderMark(clickedVault.x, clickedVault.y, 'special'); sfx('click');
    return;
  }
  // right-click a Legendary Landmark with a SPECIAL CHARACTER selected → send them to claim/hold it (only they can).
  const clickedLandmark = game.landmarks.find(L => dist(L, { x: wx, y: wy }) < 32);
  if (clickedLandmark && sel.some(s => U[s.type].unique)) {
    const champs = sel.filter(u => U[u.type].unique);
    const slots = formationSlots(champs, clickedLandmark.x, clickedLandmark.y);
    for (let k = 0; k < champs.length; k++) { const u = champs[k]; u.order = 'move'; u.target = null; u.guard = null; u.dest = slots[k]; setPath(u, slots[k].x, slots[k].y); }
    const escorts = sel.filter(u => !U[u.type].unique);            // any escorts tag along to defend the claim
    if (escorts.length) { const es = formationSlots(escorts, clickedLandmark.x, clickedLandmark.y); for (let k = 0; k < escorts.length; k++) { const u = escorts[k]; u.order = 'move'; u.target = null; u.guard = null; u.dest = es[k]; setPath(u, es[k].x, es[k].y); } }
    hint(clickedLandmark.owner === PLAYER ? 'Holding the Legendary Landmark' : 'Channeling the Legendary Landmark — keep your character on it');
    orderMark(clickedLandmark.x, clickedLandmark.y, 'special'); sfx('click');
    return;
  }
  // right-clicking a settlement with an Envoy selected → court it peacefully (neutral) or develop it (your own).
  // Without an Envoy: a non-owned town tries the paid instant recruit, else units move there & take it by presence.
  const clickedSettle = game.settlements.find(s => dist(s, { x: wx, y: wy }) < 30);
  if (clickedSettle) {
    const envoys = sel.filter(u => U[u.type].diplomat);
    if (envoys.length && (clickedSettle.owner === PLAYER || clickedSettle.owner === 0 || !isAllied(PLAYER, clickedSettle.owner))) {
      for (const u of envoys) { u.order = 'court'; u.courtId = clickedSettle.id; u.target = null; u.guard = null; const sp = freeSpotNear(clickedSettle.x, clickedSettle.y); u.dest = sp; setPath(u, sp.x, sp.y); }
      const others = sel.filter(u => !U[u.type].diplomat);          // any escorts tag along to the town
      if (others.length) { const slots = formationSlots(others, clickedSettle.x, clickedSettle.y); for (let k = 0; k < others.length; k++) { const u = others[k]; u.order = 'move'; u.target = null; u.guard = null; u.dest = slots[k]; setPath(u, slots[k].x, slots[k].y); } }
      hint(clickedSettle.owner === PLAYER ? 'Envoy developing the settlement — investing in its infrastructure' : 'Envoy courting the settlement — winning its people over peacefully');
      orderMark(clickedSettle.x, clickedSettle.y, 'special'); sfx('click'); return;
    }
    if (clickedSettle.owner !== PLAYER && tryRecruit(clickedSettle)) { orderMark(clickedSettle.x, clickedSettle.y, 'special'); return; }
  }
  // right-clicking a Command Relay you don't hold → send selected military to assault & secure it
  // (a neutral relay falls to presence; an enemy's must be shot offline first — amove fights its defenders).
  const clickedRelay = game.relays.find(r => r.owner !== PLAYER && !isAllied(PLAYER, r.owner) && dist(r, { x: wx, y: wy }) < 30);
  if (clickedRelay) {
    const force = sel.filter(u => !isSupport(u.type));
    if (force.length) {
      const slots = formationSlots(force, clickedRelay.x, clickedRelay.y);
      for (let k = 0; k < force.length; k++) { const u = force[k]; u.order = 'amove'; u.target = null; u.guard = null; u.dest = slots[k]; setPath(u, slots[k].x, slots[k].y); }
      hint(clickedRelay.owner ? 'Assaulting the Command Relay — shoot it offline, then hold' : 'Securing the Command Relay');
      orderMark(clickedRelay.x, clickedRelay.y, 'special'); sfx('click');
      return;
    }
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
  // clicking a friendly unit (not itself selected) → escort/guard it
  let guardT: Unit | null = null;
  if (!tgt) for (const u2 of game.units) {
    if (!isAllied(PLAYER, u2.team) || sel.includes(u2)) continue;
    if (tileVisible(u2.x, u2.y) && dist(u2, { x: wx, y: wy }) < U[u2.type].radius + 12) { guardT = u2; break; }
  }
  // infantry right-clicking a friendly transport with room → board it (load up)
  const boardT: Unit | null = (guardT && U[guardT.type].transport && (guardT.cargoUnits?.length || 0) < (U[guardT.type].capacity || 5)) ? guardT : null;
  // a Repair Rig right-clicking a friendly (damaged) building → mend THAT building specifically
  let repairB: Building | null = null;
  if (!tgt && !guardT && sel.some(s => U[s.type].repair)) for (const b of game.buildings) {
    if (!isAllied(PLAYER, b.team) || b.progress < 1) continue;
    if (Math.abs(wx - b.x) <= b.w / 2 + 6 && Math.abs(wy - b.y) <= b.h / 2 + 6) { repairB = b; break; }
  }
  // infantry right-clicking a friendly building with room → garrison it (shelter + defensive fire)
  let garrisonB: Building | null = null;
  if (!tgt && !guardT && sel.some(s => canGarrison(s.type))) for (const b of game.buildings) {
    if (!isAllied(PLAYER, b.team) || !garrisonable(b) || (b.garrison?.length || 0) >= GARRISON_CAP) continue;
    if (Math.abs(wx - b.x) <= b.w / 2 + 6 && Math.abs(wy - b.y) <= b.h / 2 + 6) { garrisonB = b; break; }
  }
  if (tgt && !isWar(PLAYER, tgt.team)) {
    const key = 'ag' + tgt.team;
    if (!game.aggroT[key] || game.t - game.aggroT[key] > 10) {
      game.aggroT[key] = game.t; addRel(PLAYER, tgt.team, -10);
      logMsg('Attacking ' + FAC[tgt.team].name + ' — relations −10', 'war');
    }
  }
  // attackers → target, escorts → guard a friendly (military or Repair Rig), harvesters → node, everyone else → formation
  const movers: Unit[] = [];
  for (const u of sel) {
    const harvester = !!U[u.type].harvests;
    const support = isSupport(u.type);
    if (tgt && !support && eligibleTarget(u, tgt)) { u.order = 'attack'; u.target = tgt; u.guard = null; setPath(u, tgt.x, tgt.y); }
    else if (boardT && canGarrison(u.type)) { u.order = 'board'; u.guard = boardT; u.target = null; u.enterT = game.t; setPath(u, boardT.x, boardT.y); }
    else if (guardT && (!support || U[u.type].repair)) { u.order = 'guard'; u.guard = guardT; u.target = null; u.path = null; }
    else if (repairB && U[u.type].repair) { u.order = 'guard'; u.guard = repairB; u.target = null; u.path = null; setPath(u, repairB.x, repairB.y); }
    else if (garrisonB && canGarrison(u.type)) { u.order = 'enter'; u.guard = garrisonB; u.target = null; u.enterT = game.t; const sp = freeSpotNear(garrisonB.x, garrisonB.y + garrisonB.h * 0.6); u.dest = sp; setPath(u, sp.x, sp.y); }
    else if (node && harvester && node.kind === U[u.type].harvests) { u.hNode = node; u.hState = 'go'; u.order = 'idle'; setPath(u, node.x, node.y); }
    else if (!(guardT && support) && !(repairB && U[u.type].repair) && !(garrisonB && canGarrison(u.type))) { u.guard = null; movers.push(u); }
  }
  if (boardT && sel.some(s => canGarrison(s.type))) hint('Boarding the ' + U[boardT.type].name + ' — press U to unload');
  else if (guardT && sel.some(s => !isSupport(s.type) || U[s.type].repair)) hint((sel.some(s => U[s.type].repair) ? 'Repairing & escorting ' : 'Escorting ') + U[guardT.type].name);
  else if (repairB && sel.some(s => U[s.type].repair)) hint('Repair Rig dispatched to mend the ' + B[repairB.type].name);
  else if (garrisonB && sel.some(s => canGarrison(s.type))) hint('Garrisoning the ' + B[garrisonB.type].name + ' — press U to unload');
  const slots = formationSlots(movers, wx, wy);
  for (let k = 0; k < movers.length; k++) {
    const u = movers[k], support = isSupport(u.type);
    u.dest = slots[k]; u.order = fromAmove && !support ? 'amove' : 'move'; u.target = null;
    setPath(u, slots[k].x, slots[k].y);
  }
  // command-confirmation marker: red on an attack target, cyan on a special order, green on a plain move
  if (tgt) orderMark(tgt.x, tgt.y, 'attack');
  else if (guardT || repairB || garrisonB) orderMark((guardT || repairB || garrisonB)!.x, (guardT || repairB || garrisonB)!.y, 'special');
  else orderMark(wx, wy, 'move');
  sfx('click');
}
const LINEAR_DEFENSE = (type: string) => type === 'wall' || type === 'gate' || type === 'palisade';
export function startPlacing(type: string) {
  if (game.money[PLAYER] < B[type].cost) { hint('Insufficient crystals'); return; }
  if (alloyCost(PLAYER, B[type].alloy) > (game.alloy[PLAYER] || 0)) { hint('Insufficient alloy'); return; }
  if ((B[type].wood || 0) > (game.wood[PLAYER] || 0)) { hint('Insufficient wood — log some forest first'); return; }
  game.placing = type; game.armed = null;
  hint(LINEAR_DEFENSE(type) ? 'Place ' + B[type].name + ' — keep clicking to lay a line; right-click to stop' : 'Place ' + B[type].name + ' — right-click to cancel');
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
  if (alloyCost(PLAYER, d.alloy) > (game.alloy[PLAYER] || 0)) { hint('Insufficient alloy'); game.placing = null; return; }
  if ((d.wood || 0) > (game.wood[PLAYER] || 0)) { hint('Insufficient wood — log some forest first'); game.placing = null; return; }
  game.money[PLAYER] -= d.cost; game.alloy[PLAYER] -= alloyCost(PLAYER, d.alloy); game.wood[PLAYER] = (game.wood[PLAYER] || 0) - (d.wood || 0);
  addBuilding(type, tx, ty, PLAYER, false);
  sfx('place', wx);
  // Linear defenses stay armed so you can lay a long run with repeated clicks (right-click / Esc stops).
  if (LINEAR_DEFENSE(type) && game.money[PLAYER] >= d.cost && alloyCost(PLAYER, d.alloy) <= (game.alloy[PLAYER] || 0) && (d.wood || 0) <= (game.wood[PLAYER] || 0)) {
    hint('Placing ' + d.name + ' — keep clicking to extend; right-click to stop');
  } else { game.placing = null; hint(''); }
}
export function cancelUnit(t: string) {
  const fs = game.buildings.filter(b => b.team === PLAYER && b.type === 'foundry' && b.queue.includes(t));
  if (!fs.length) { hint('Nothing of that type queued to cancel'); return; }
  const f = fs[fs.length - 1];
  const i = f.queue.lastIndexOf(t);
  if (i < 0) return;
  f.queue.splice(i, 1);
  if (i === 0) f.queueT = 0;
  game.money[PLAYER] += U[t].cost;
  game.alloy[PLAYER] = (game.alloy[PLAYER] || 0) + alloyCost(PLAYER, U[t].alloy);
  logMsg(U[t].name + ' production cancelled — refunded', 'good');
  sfx('click');
}
export function trainUnit(t: string) {
  const fs = game.buildings.filter(b => b.team === PLAYER && b.type === 'foundry' && b.progress >= 1);
  if (!fs.length) { hint('Build a War Foundry first'); return; }
  const req = U[t].requires;
  if (req && !hasBuilding(req)) { hint('Requires a ' + B[req].name); return; }
  if (U[t].unique && (uniqueLive(PLAYER, t) || fs.some(f => f.queue.includes(t)))) { hint('You already command your ' + U[t].name); return; }
  if (game.money[PLAYER] < U[t].cost) { hint('Insufficient crystals'); return; }
  if (alloyCost(PLAYER, U[t].alloy) > (game.alloy[PLAYER] || 0)) { hint('Insufficient alloy — build an Alloy Smelter'); return; }
  fs.sort((a, b) => a.queue.length - b.queue.length);
  game.money[PLAYER] -= U[t].cost; game.alloy[PLAYER] -= alloyCost(PLAYER, U[t].alloy); fs[0].queue.push(t); sfx('click');
}

// ── Win / lose (annihilation only) ───────────────────────────────────────────
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

// ── Auto-scout (toggled Recon Drones) + auto-hunt (always-on Survey Hunters) ──
export function setAutoScout(on: boolean) { autoScout = on; }
export function getAutoScout() { return autoScout; }
function nearestUnexplored(u: Unit): Vec | null {
  let best: Vec | null = null, bestD = Infinity;
  const flies = !!U[u.type].air;                         // fliers reveal over any terrain (incl. rock where vaults hide)
  for (let i = 0; i < 90; i++) {
    const tx = Math.random() * MAPW | 0, ty = Math.random() * MAPH | 0;
    if (game.explored[idx(tx, ty)] || (!flies && !passable(tx, ty))) continue;
    const wx = tx * TILE + 16, wy = ty * TILE + 16;
    const d = (wx - u.x) * (wx - u.x) + (wy - u.y) * (wy - u.y);
    if (d < bestD) { bestD = d; best = { x: wx, y: wy }; }
  }
  return best;
}
function autoScoutTick(dt: number) {
  autoScoutT += dt;
  if (autoScoutT < 1.2) return;
  autoScoutT = 0;
  for (const u of game.units) {
    if (u.team !== PLAYER || u.order !== 'idle' || u.path) continue;
    const hunt = !!U[u.type].survey;                     // Survey Hunters ALWAYS auto-hunt for Hero Vaults
    const scout = u.type === 'recon' && autoScout;       // Recon Drones scout only when toggled on
    if (!hunt && !scout) continue;
    const t = nearestUnexplored(u);
    if (t) { u.order = 'move'; u.dest = t; setPath(u, t.x, t.y); }
  }
}

// ── Per-frame world step (everything except camera/input/render) ─────────────
export function stepWorld(dt: number) {
  game.t += dt;
  resetPathBudget(60000);   // cap A* WORK (node pops) this tick; over-budget searches DEFER (units hold + retry, never wedge)
  game.shake = Math.max(0, game.shake - dt * 14);
  for (const k in game.cooldowns) game.cooldowns[k] = Math.max(0, game.cooldowns[k] - dt);
  for (const k in game.covCd) game.covCd[k] = Math.max(0, game.covCd[k] - dt);
  // trade pacts flow all three resources; Mercantile leadership widens the pipes
  for (const team of ALL_TEAMS) {
    if (game.eliminated[team]) continue;
    const tm = styleMod(team).trade ?? 1;
    game.money[team] += tradeIncome(team) * tm * dt;
    let partners = 0; for (const f of ALL_TEAMS) if (f !== team && dip.trade[rk(team, f)] && !game.eliminated[f]) partners++;
    if (partners) {
      game.water[team] = clamp((game.water[team] || 0) + partners * 6 * tm * dt, 0, WATER_CAP);
      game.alloy[team] = (game.alloy[team] || 0) + partners * 5 * tm * dt;
    }
  }
  rebuildUnitGrid();                          // grid for target acquisition this step
  for (const u of game.units) updateUnit(u, dt);
  for (const u of game.units) postAttackCleanup(u);
  separation();                               // rebuilds the grid from post-movement positions
  for (const b of game.buildings) updateBuilding(b, dt);
  updateShots(dt);
  // Strategic AI (build/train/wave/missile) doesn't need 60Hz — it re-scans every unit per faction, so
  // running it every frame is a big late-game cost. Throttle to ~3Hz and feed it the accumulated dt so
  // income, cooldowns and rate-based rolls stay correct. Per-unit combat/targeting stays per-frame above.
  aiAccum += dt;
  if (aiAccum >= 0.33) { for (const f of AIS) aiUpdate(f, aiAccum); aiAccum = 0; }
  dipTickT += dt;
  if (dipTickT >= 5) { dipTickT = 0; diplomacyTick(); }
  regenCrystals(dt);
  waterStep(dt);
  societyTick(dt);
  settlementTick(dt);
  militiaTick(dt);
  relayTick(dt);
  landmarkTick(dt);
  vaultTick(dt);
  governmentTick(dt);
  autoScoutTick(dt);
  stealthTick(dt);
  mineTick(dt);
  respawnTick();              // bring back fallen respawning characters (Kenny)
  processStrikes();
  visionAccum += dt;
  if (visionAccum >= 0.066) { computeVision(); visionAccum = 0; }   // player fog ~15Hz (AI targeting doesn't use it)
  checkEnd();
}
