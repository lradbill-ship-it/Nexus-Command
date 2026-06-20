import {
  TILE, MAPW, MAPH, WORLD_W, WORLD_H, PLAYER, AIS, ALL_TEAMS, FAC, B, U, ABILITIES, COVERT,
  BASE_INFO, AI_SCRIPT, T_GRASS, T_DIRT, T_ROAD, T_FOREST, T_WATER, STYLES,
  RELAY_INCOME, RELAY_HP,
  idx, inMap, clamp, dist,
} from './constants';
import type { LeaderStyle } from './constants';
import {
  game, dip, rk, getRel, setRel, addRel, isAllied, isWar, stateOf, logMsg, hint,
} from './state';
import type { Building, Unit, Entity, Vec, Particle, Settlement, Relay, ResourceNode, Vault } from './types';
import { findPath, passable, nearestPassableTile } from './pathfind';
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

// Transient module locals — reset on each new match.
let nextId = 1;
let dipTickT = 0;
let lastStates: Record<string, string> = {};
let lastHintT = 0;
let crystalT = 55;   // first new formation seeds ~55s in
let autoScout = false;   // when on, idle Recon Drones auto-reveal the map (scouts-only auto-explore)
let autoScoutT = 0;      // throttle accumulator for auto-scout order assignment
type Strike = { x: number; y: number; at: number; team: number; kind: 'nuke' | 'thermo' };
let pendingStrikes: Strike[] = [];   // in-flight missiles → detonate when game.t >= at (unless intercepted)
export function pendingStrikeList(): readonly Strike[] { return pendingStrikes; }
export function resetSimLocals() { nextId = 1; dipTickT = 0; lastStates = {}; lastHintT = 0; crystalT = 55; autoScout = false; autoScoutT = 0; pendingStrikes = []; lastWoodNag = -9; }

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
function captureSettlement(s: Settlement, team: number, militaryOnly: boolean) {
  const prev = s.owner;
  s.owner = team; s.capT = 0; s.capBy = 0;
  game.pop[team] = (game.pop[team] || 0) + s.pop;                 // its citizens join your population
  // intimidated (troops only) subjects resent it; persuaded/recruited ones welcome it
  game.happy[team] = clamp((game.happy[team] ?? 60) + (militaryOnly ? -6 : 6), 0, 100);
  if (team === PLAYER) { logMsg((militaryOnly ? 'Intimidated' : 'Won over') + ' a settlement — +' + s.pop + ' population', 'good'); sfx('chime'); }
  else if (prev === PLAYER) { logMsg(FAC[team].name + ' has seized one of our settlements', 'war'); sfx('war'); }
}
function settlementTick(dt: number) {
  for (const s of game.settlements) {
    const army: Record<number, number> = {}, civ: Record<number, number> = {};
    forNearbyUnits(s.x, s.y, SETTLE_R, (u) => {
      if (dist(u, s) > SETTLE_R) return;
      if (isSupport(u.type)) civ[u.team] = (civ[u.team] || 0) + 1; else army[u.team] = (army[u.team] || 0) + 1;
    });
    const present = new Set<number>([...Object.keys(army), ...Object.keys(civ)].map(Number));
    const challengers = [...present].filter(t => t !== s.owner);
    if (challengers.length === 1) {                                // uncontested takeover
      const team = challengers[0];
      s.capBy = team; s.capT += dt / 6;                            // ~6s of presence to flip
      if (s.capT >= 1) captureSettlement(s, team, !civ[team] && !!army[team]);   // troops-only ⇒ intimidation
    } else if (present.size === 0) {
      s.capT = Math.max(0, s.capT - dt / 10); if (s.capT === 0) s.capBy = 0;     // unattended → cools off
    } else {
      s.capT = Math.max(0, s.capT - dt / 18);                      // contested → stalls
    }
    // an owned settlement is a working town — its citizens yield a crystal trickle to the owner
    if (s.owner) game.money[s.owner] += s.pop * SETTLE_INCOME * dt;
  }
}

// ── Command Relays — income + vision objective points (§5) ───────────────────
const RELAY_R = 4 * TILE;
function captureRelay(r: Relay, team: number) {
  const prev = r.owner;
  r.owner = team; r.capT = 0; r.capBy = 0;
  game.parts.push({ type: 'ring', x: r.x, y: r.y, t: 0, life: 0.7, big: true });
  if (team === PLAYER) { logMsg('Command Relay secured — bonus income & vision', 'good'); sfx('chime'); }
  else if (prev === PLAYER) { logMsg(FAC[team].name + ' has seized a Command Relay from us', 'war'); sfx('war'); }
  else if (isAllied(PLAYER, team)) logMsg(FAC[team].name + ' (ally) secured a Command Relay', 'good');
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

// ── Hero Vaults: survey to find, Borer to excavate, unearth a hero (roadmap #6) ──
const SURVEY_R = 14 * TILE;   // a Survey Hunter senses buried vaults from this far
const STUMBLE_R = 2.5 * TILE; // any unit this close trips over one
const DIG_TIME = 18;          // seconds of drilling to unearth a hero
const DIG_CR_RATE = 50;       // crystals/sec spent while excavating ("resources")
const DIG_AL_RATE = 12;       // alloy/sec spent while excavating ("special equipment")
let lastDigNag = -9;
function vaultTick(dt: number) {
  for (const v of game.vaults) {
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
    const sp = freeSpotNear(v.x, v.y);
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
  const byUnit = src.kind === 'u' ? (src as Unit) : undefined;
  if (byUnit) dmg *= vetDmg(byUnit.vet || 0);            // veterans/elites hit harder
  const subsurface = src.kind === 'u' && !!U[(src as Unit).type].tunneler;
  game.shots.push({ x: src.x, y: src.y, target, dmg, team: src.team, speed: rail ? 940 : 560, col: FAC[src.team].col, rail, splash, subsurface, by: byUnit });
  src.lastShot = game.t;
  spawnParts('muzzle', src.x, src.y, 2, '255,235,180');
  sfx(rail ? 'rail' : 'shot', src.x);
}
function damage(e: Entity, amt: number, fromTeam: number) { e.hp -= amt; if (e.hp <= 0) destroy(e, fromTeam); }
function destroy(e: Entity, fromTeam: number) {
  if (e.dead) return; e.dead = true;
  const big = e.kind === 'b';
  spawnParts('fire', e.x, e.y, big ? 30 : 13, '255,160,60');
  spawnParts('ember', e.x, e.y, big ? 22 : 10, '255,198,104');
  spawnParts('debris', e.x, e.y, big ? 14 : 7, '120,120,128');
  spawnParts('smoke', e.x, e.y, big ? 16 : 6, '70,70,76');
  game.parts.push({ type: 'ring', x: e.x, y: e.y, t: 0, life: 0.7, big });
  if (big) game.parts.push({ type: 'shock', x: e.x, y: e.y, t: 0, life: 0.85, big });   // slower outer shockwave
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
// ── Spatial grid — keeps separation & target-acquisition near O(n) at scale ───
// (the 112² / 6-faction map can field hundreds of units; the old O(n²) scans
//  spiked frame time in big battles).
const GCELL = 64;
const GW = Math.ceil(WORLD_W / GCELL), GH = Math.ceil(WORLD_H / GCELL);
let unitGrid: Unit[][] = [];
function rebuildUnitGrid() {
  unitGrid = new Array(GW * GH);
  for (let i = 0; i < unitGrid.length; i++) unitGrid[i] = [];
  for (const u of game.units) {
    const gx = clamp(u.x / GCELL | 0, 0, GW - 1), gy = clamp(u.y / GCELL | 0, 0, GH - 1);
    unitGrid[gy * GW + gx].push(u);
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
function unitBlocked(x: number, y: number) { return !passable(x / TILE | 0, y / TILE | 0); }
// Phasing units ignore terrain entirely: fliers always, dedicated tunnelers (Borer) always,
// and harvesters while burrowing underground.
const phasing = (u: Unit) => !!U[u.type].air || !!U[u.type].tunneler || (u.tunnelT ?? 0) > 0;
function stepToward(u: Unit, dx: number, dy: number, dt: number) {
  const sp = U[u.type].speed * dt, len = Math.hypot(dx, dy);
  if (len < 1) { u.moving = false; return true; }
  u.moving = true;
  const nx = u.x + dx / len * sp, ny = u.y + dy / len * sp;
  u.facing = Math.atan2(dy, dx);
  if (phasing(u)) { u.x = nx; u.y = ny; }                 // fliers + burrowing harvesters ignore terrain entirely
  else if (!unitBlocked(nx, ny)) { u.x = nx; u.y = ny; }
  else if (!unitBlocked(nx, u.y)) { u.x = nx; }
  else if (!unitBlocked(u.x, ny)) { u.y = ny; }
  else { const slx = u.x + (-dy / len) * sp, sly = u.y + (dx / len) * sp, srx = u.x + (dy / len) * sp, sry = u.y + (-dx / len) * sp; if (!unitBlocked(slx, sly)) { u.x = slx; u.y = sly; } else if (!unitBlocked(srx, sry)) { u.x = srx; u.y = sry; } }
  u.x = clamp(u.x, 12, WORLD_W - 12); u.y = clamp(u.y, 12, WORLD_H - 12);
  return len < sp * 1.5;
}
export function setPath(u: Unit, wx: number, wy: number) {
  if (!u.finalDest || u.finalDest.x !== wx || u.finalDest.y !== wy) u.unstick = 0;   // reset escalation only on a genuinely new destination
  u.path = U[u.type].air ? [{ x: wx, y: wy }] : findPath(u.x, u.y, wx, wy);   // fliers fly straight
  u.finalDest = { x: wx, y: wy };
  u.stuckT = 0;
}
function followPath(u: Unit, dt: number) {
  // escape if we ended up sitting on a blocked tile (e.g. a building was placed on us)
  if (!phasing(u) && unitBlocked(u.x, u.y)) {
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
    const n = (u.unstick || 0) + 1; u.unstick = n;
    if (n >= 2) {
      // wedged → hop toward the next waypoint onto open ground (get past the obstacle), then re-path
      const aim = (u.path && u.path[0]) ? u.path[0] : u.finalDest;
      const ang = Math.atan2(aim.y - u.y, aim.x - u.x);
      let placed = false;
      for (const hop of [2.2, 1.4, 3.2, 0.8]) {
        const np = nearestPassableTile((u.x + Math.cos(ang) * hop * TILE) / TILE | 0, (u.y + Math.sin(ang) * hop * TILE) / TILE | 0);
        if (np) { u.x = np[0] * TILE + 16; u.y = np[1] * TILE + 16; placed = true; break; }
      }
      if (!placed) { const np = nearestPassableTile(u.x / TILE | 0, u.y / TILE | 0); if (np) { u.x = np[0] * TILE + 16; u.y = np[1] * TILE + 16; } }
      u.unstick = 0;
    }
    setPath(u, u.finalDest.x, u.finalDest.y);
  }
  return false;
}
function separation() {
  rebuildUnitGrid();                                       // fresh buckets from post-movement positions
  for (const a of game.units) {
    if (phasing(a)) continue;                              // air & burrowing units occupy separate layers
    const ar = U[a.type].radius;
    forNearbyUnits(a.x, a.y, GCELL, (b) => {
      if (a.id >= b.id || phasing(b)) return;              // each ground pair resolved once
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      const min = ar + U[b.type].radius;
      if (d > 0 && d < min) {
        const push = (min - d) / 2, ux = dx / d, uy = dy / d;
        if (!unitBlocked(a.x - ux * push, a.y - uy * push)) { a.x -= ux * push; a.y -= uy * push; }
        if (!unitBlocked(b.x + ux * push, b.y + uy * push)) { b.x += ux * push; b.y += uy * push; }
      }
    });
  }
}

// Non-combat economy/support units (harvesters, loggers, repair rigs) — never
// desert in a revolt, count as civilians at settlements, and don't take attack orders.
export const isSupport = (type: string) => !!(U[type].harvests || U[type].logs || U[type].repair || U[type].shield);

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
      const p = findPath(u.x, u.y, ax, ay);
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
  const cap = U[u.type].cargo!;
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
      const take = Math.min(62 * laborFactor(u.team) * dt, game.waterAmt[i], cap - u.cargo);
      game.waterAmt[i] -= take; u.cargo += take;
      if (Math.random() < dt * 6) spawnParts('spark', u.chopTx * TILE + 16, u.chopTy! * TILE + 12, 1, '150,220,235');
      if (game.waterAmt[i] <= 0) { dryWater(u.chopTx, u.chopTy!); u.chopTx = undefined; }
      if (u.cargo >= cap - 0.5) { u.chopTx = undefined; toDepot(); }
      else if (u.chopTx === undefined) u.hState = 'find';
      return;
    }
    if (!u.hNode || u.hNode.amount <= 0) { u.hState = 'find'; return; }
    const take = Math.min(62 * laborFactor(u.team) * dt, u.hNode.amount, cap - u.cargo);
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
  for (let i = 0; i < Math.min(6, cand.length); i++) {
    const { tx, ty } = cand[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      if (!passable(tx + dx, ty + dy)) continue;
      const ax = (tx + dx) * TILE + 16, ay = (ty + dy) * TILE + 16;
      const p = findPath(u.x, u.y, ax, ay);
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
function updateUnit(u: Unit, dt: number) {
  if (u.disabledUntil > game.t) { u.moving = false; return; }
  const d = U[u.type];
  u.cooldown = Math.max(0, u.cooldown - dt);
  if (U[u.type].tunneler && u.moving && Math.random() < dt * 7) spawnParts('debris', u.x, u.y + 6, 1, '120,100,72');   // burrow spoil trail
  if (U[u.type].auraHeal) auraTick(u, dt);                              // Warden hero — constant heal aura
  if ((u.vet || 0) >= 2 && u.hp < u.hpMax) u.hp = Math.min(u.hpMax, u.hp + 4 * dt);   // Elite units self-repair slowly
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
  if (U[u.type].logs) {
    if (u.order === 'move' && u.dest) {
      if (followPath(u, dt)) { u.order = 'idle'; u.hState = 'find'; u.dest = null; }
      return;
    }
    updateLogger(u, dt); return;
  }
  if (U[u.type].repair) { updateRepair(u, dt); return; }
  if (U[u.type].shield) {                                               // Aegis — mobile missile interceptor (no weapon); cooldown ticks above
    if ((u.order === 'move' || u.order === 'amove') && u.dest) { if (followPath(u, dt)) { u.order = 'idle'; u.dest = null; u.path = null; } }
    else u.moving = false;
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
    if (followPath(u, dt)) { u.order = 'idle'; u.dest = null; u.path = null; }
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
  if (b.type === 'turret' || b.type === 'aaturret') {
    b.cooldown = Math.max(0, b.cooldown - dt);
    if (b.target && (b.target.dead || dist(b, b.target) > d.range! + 30 || !eligibleTarget(b, b.target) || (b.target.kind === 'u' && ((b.target as Unit).tunnelT ?? 0) > 0))) b.target = null;   // turrets can't hit the underground
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
export function spawnParts(type: string, x: number, y: number, n: number, rgb: string) {
  if (game.parts.length > 520) return;
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
  }
  game.armed = null;
}
const NUKE_TRAVEL = 4;       // seconds from launch to impact
const NUKE_R = 150;          // ballistic blast radius (px)
const THERMO_TRAVEL = 7;     // thermonuclear flight time (longer — react / intercept window)
const THERMO_R = 440;        // thermonuclear blast radius (px) — covers a clustered base → faction-killer
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
function processStrikes() {
  if (!pendingStrikes.length) return;
  const due = pendingStrikes.filter(s => s.at <= game.t);
  if (!due.length) return;
  pendingStrikes = pendingStrikes.filter(s => s.at > game.t);
  for (const s of due) {
    if (tryIntercept(s)) continue;
    if (s.kind === 'thermo') detonateThermo(s.x, s.y, s.team); else detonateNuke(s.x, s.y, s.team);
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
  delete dip.alliance[rk(PLAYER, f)]; delete dip.trade[rk(PLAYER, f)];
  logMsg('WAR declared on ' + FAC[f].name, 'war'); sfx('war');
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
  for (const a of ALL_TEAMS) for (const b of ALL_TEAMS) {
    if (a >= b) continue;
    const k = rk(a, b), st = stateOf(a, b);
    if (lastStates[k] && lastStates[k] !== 'WAR' && st === 'WAR') { logMsg('WAR: ' + FAC[a].name + ' ⚔ ' + FAC[b].name, 'war'); sfx('war'); }
    lastStates[k] = st;
  }
}
function aiUpdate(team: number, dt: number) {
  if (game.eliminated[team]) return;
  const ai = game.ai[team];
  const persona = FAC[team].persona;
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
  // late-game: aggressive factions lob the occasional ballistic missile at a rival → makes Iron Dome matter
  if (game.t > 540 && Math.random() < dt * (persona === 'warlord' ? 0.006 : 0.003)) {
    const enemies = ALL_TEAMS.filter(f => f !== team && !game.eliminated[f] && isWar(team, f) && game.buildings.some(b => b.team === f));
    if (enemies.length) {
      const tgt = (enemies.includes(PLAYER) && Math.random() < 0.6) ? PLAYER : enemies[Math.random() * enemies.length | 0];
      const hq = game.buildings.find(b => b.team === tgt && b.type === 'hq') || game.buildings.find(b => b.team === tgt);
      if (hq) {
        pendingStrikes.push({ x: hq.x + (Math.random() * 90 - 45), y: hq.y + (Math.random() * 90 - 45), at: game.t + NUKE_TRAVEL + 2, team, kind: 'nuke' });
        if (tgt === PLAYER || isAllied(PLAYER, tgt)) { logMsg('⚠ INBOUND BALLISTIC MISSILE from ' + FAC[team].name + ' — intercept or scatter!', 'war'); sfx('war'); }
      }
    }
  }
  // conscript from a surplus population when short on crystals (the people as a reserve)
  if ((game.pop[team] || 0) > 34 && game.money[team] < 500 && Math.random() < dt * 0.25) conscript(team);
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
  const army = game.units.filter(u => u.team === team && !isSupport(u.type));
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
        if (alloyCost(team, U[pick].alloy) > (game.alloy[team] || 0)) pick = 'strike';   // alloy-starved → basic armor
        if (game.money[team] >= U[pick].cost && alloyCost(team, U[pick].alloy) <= (game.alloy[team] || 0)) {
          f.queue.push(pick); game.money[team] -= U[pick].cost; game.alloy[team] -= alloyCost(team, U[pick].alloy);
        }
      }
    }
  }
  if (game.t >= ai.nextWave) {
    ai.waveN++;
    const size = Math.min(16, 2 + Math.ceil(ai.waveN * 1.7));
    const squad = army.filter(u => u.order === 'idle').slice(0, size);
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
    hint('Borer dispatched to excavate the Hero Vault'); sfx('click');
    return;
  }
  // right-clicking a settlement you don't own tries to recruit it (paid); on failure,
  // fall through so the units simply move there and take it by presence.
  const clickedSettle = game.settlements.find(s => s.owner !== PLAYER && dist(s, { x: wx, y: wy }) < 30);
  if (clickedSettle && tryRecruit(clickedSettle)) return;
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
    else if (guardT && (!support || U[u.type].repair)) { u.order = 'guard'; u.guard = guardT; u.target = null; u.path = null; }
    else if (node && harvester && node.kind === U[u.type].harvests) { u.hNode = node; u.hState = 'go'; u.order = 'idle'; setPath(u, node.x, node.y); }
    else if (!(guardT && support)) { u.guard = null; movers.push(u); }
  }
  if (guardT && sel.some(s => !isSupport(s.type) || U[s.type].repair)) hint((sel.some(s => U[s.type].repair) ? 'Repairing & escorting ' : 'Escorting ') + U[guardT.type].name);
  const slots = formationSlots(movers, wx, wy);
  for (let k = 0; k < movers.length; k++) {
    const u = movers[k], support = isSupport(u.type);
    u.dest = slots[k]; u.order = fromAmove && !support ? 'amove' : 'move'; u.target = null;
    setPath(u, slots[k].x, slots[k].y);
  }
  sfx('click');
}
export function startPlacing(type: string) {
  if (game.money[PLAYER] < B[type].cost) { hint('Insufficient crystals'); return; }
  if (alloyCost(PLAYER, B[type].alloy) > (game.alloy[PLAYER] || 0)) { hint('Insufficient alloy'); return; }
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
  if (alloyCost(PLAYER, d.alloy) > (game.alloy[PLAYER] || 0)) { hint('Insufficient alloy'); game.placing = null; return; }
  game.money[PLAYER] -= d.cost; game.alloy[PLAYER] -= alloyCost(PLAYER, d.alloy);
  addBuilding(type, tx, ty, PLAYER, false);
  sfx('place', wx); game.placing = null; hint('');
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
  for (const f of AIS) aiUpdate(f, dt);
  dipTickT += dt;
  if (dipTickT >= 5) { dipTickT = 0; diplomacyTick(); }
  regenCrystals(dt);
  waterStep(dt);
  societyTick(dt);
  settlementTick(dt);
  relayTick(dt);
  vaultTick(dt);
  governmentTick(dt);
  autoScoutTick(dt);
  processStrikes();
  computeVision();
  checkEnd();
}
