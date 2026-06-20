import type { ResourceKind } from './types';

// ── Core grid ────────────────────────────────────────────────────────────────
export const TILE = 32;
export const MAP_SCALE = 3;                 // ×3 larger battlefields (note #2)
export const MAPW = 112 * MAP_SCALE;        // 336 tiles
export const MAPH = 112 * MAP_SCALE;        // 336 tiles
export const WORLD_W = MAPW * TILE;
export const WORLD_H = MAPH * TILE;

export const PLAYER = 1;
export const AIS = [2, 3, 4, 5, 6] as const;
export const ALL_TEAMS = [1, 2, 3, 4, 5, 6] as const;

export type Persona = 'player' | 'warlord' | 'merchant' | 'covert' | 'industrial';

// ── Government: leader styles (DESIGN_SPEC_v4 §4) ─────────────────────────────
// Faction-wide modifier sets, chosen at game start (and later swung by elections/coups).
export type LeaderStyle = 'militarist' | 'industrialist' | 'populist' | 'technocrat' | 'mercantile';
export interface StyleDef {
  name: string; blurb: string; col: string;
  combat?: number;     // ×damage dealt by this faction's units
  econ?: number;       // ×crystal income (harvest deliveries)
  labor?: number;      // ×labor factor (harvest & build speed)
  happy?: number;      // +happiness target
  alloyDisc?: number;  // ×alloy build-cost (lower = cheaper)
  recruitDisc?: number;// ×conscription / settlement-recruit cost
  trade?: number;      // ×resource trade flow
  cdMul?: number;      // ×ability cooldown (lower = faster)
}
export const STYLES: Record<LeaderStyle, StyleDef> = {
  militarist:    { name: 'Militarist',    col: '#e8483a', blurb: 'Hardened army, lean economy.',       combat: 1.20, econ: 0.88 },
  industrialist: { name: 'Industrialist', col: '#e0a155', blurb: 'Factories hum; everything builds & mines faster.', labor: 1.16, econ: 1.05 },
  populist:      { name: 'Populist',      col: '#4faf5a', blurb: 'Beloved leadership; happy, cheap to mobilise.', happy: 14, recruitDisc: 0.55, combat: 0.95 },
  technocrat:    { name: 'Technocrat',    col: '#9b6fe8', blurb: 'High-tech edge: cheaper alloy, faster cyber.', alloyDisc: 0.68, cdMul: 0.65, econ: 0.97 },
  mercantile:    { name: 'Mercantile',    col: '#3ec8b4', blurb: 'Wealth & trade flow; a softer military.', econ: 1.18, trade: 1.6, combat: 0.95 },
};
// AI factions adopt a style that fits their persona.
export const PERSONA_STYLE: Record<Persona, LeaderStyle> = {
  player: 'industrialist', warlord: 'militarist', merchant: 'mercantile', covert: 'technocrat', industrial: 'industrialist',
};

export interface Faction {
  name: string;
  col: string;
  rgb: string;
  persona: Persona;
}

// 6 regional coalitions (DESIGN_SPEC_v4 §6). Names are geopolitical coalitions;
// AI persona is a GAMEPLAY archetype, deliberately not a cultural stereotype.
export const FAC: Record<number, Faction> = {
  1: { name: 'AMERICAN FEDERATION', col: '#3e7cd8', rgb: '62,124,216', persona: 'player' },
  2: { name: 'EUROPEAN CONCORD', col: '#cdd6e4', rgb: '205,214,228', persona: 'merchant' },
  3: { name: 'PAN-AFRICAN UNION', col: '#4faf5a', rgb: '79,175,90', persona: 'industrial' },
  4: { name: 'GULF COALITION', col: '#e0a83d', rgb: '224,168,61', persona: 'merchant' },
  5: { name: 'EASTERN BLOC', col: '#e8483a', rgb: '232,72,58', persona: 'warlord' },
  6: { name: 'OCEANIC LEAGUE', col: '#2fc6c0', rgb: '47,198,192', persona: 'covert' },
};

// ── Terrain ──────────────────────────────────────────────────────────────────
export const T_GRASS = 0;
export const T_DIRT = 1;
export const T_WATER = 2;
export const T_ROCK = 3;
export const T_FOREST = 4;
export const T_BRIDGE = 5;
export const T_ROAD = 6;
// grass / dirt / road / bridge are passable
export const PASSABLE = [1, 1, 0, 0, 0, 1, 1] as const;

// ── Buildings ────────────────────────────────────────────────────────────────
export interface BuildingDef {
  name: string;
  w: number;
  h: number;
  hp: number;
  cost: number;
  power: number;
  buildTime: number;
  sight: number;
  hgt: number;
  dmg?: number;
  range?: number;
  rof?: number;
  antiAir?: boolean;       // can engage airborne units
  airOnly?: boolean;       // engages ONLY airborne units (flak)
  water?: number;          // +coolant trickled per second (passive floor)
  coolant?: number;        // coolant consumed per second while active
  accepts?: ResourceKind;  // harvested resource this structure is a drop-off for
  freeUnit?: string;       // unit gifted on construction completion
  alloy?: number;          // alloy build-cost surcharge (advanced structures)
  house?: number;          // civilian housing capacity provided
  civic?: number;          // happiness contribution (civic needs met)
  desc: string;
}

export const B: Record<string, BuildingDef> = {
  hq: { name: 'Command HQ', w: 3, h: 3, hp: 1700, cost: 0, power: +20, buildTime: 0, sight: 8, hgt: 26, water: 5, house: 20, civic: 6, desc: 'Primary structure. Accepts all resource deliveries. Houses your first citizens.' },
  power: { name: 'Power Plant', w: 2, h: 2, hp: 430, cost: 300, power: +50, buildTime: 8, sight: 4, hgt: 20, desc: '+50 power.' },
  refinery: { name: 'Crystal Refinery', w: 3, h: 2, hp: 700, cost: 600, power: -10, buildTime: 12, sight: 5, hgt: 20, accepts: 'crystal', freeUnit: 'harvester', desc: 'Crystal harvester drop-off. Free Harvester on completion.' },
  foundry: { name: 'War Foundry', w: 3, h: 2, hp: 900, cost: 500, power: -15, buildTime: 12, sight: 5, hgt: 22, desc: 'Fabricates all vehicles, drones, infantry & aircraft.' },
  turret: { name: 'Sentinel Turret', w: 1, h: 1, hp: 520, cost: 400, power: -10, buildTime: 8, sight: 9, hgt: 8, dmg: 13, range: 250, rof: 0.65, desc: 'Automated ground point-defense. Long range; engages ground targets only.' },
  pump: { name: 'Coolant Refinery', w: 2, h: 2, hp: 420, cost: 450, power: -15, buildTime: 11, sight: 4, hgt: 18, water: 6, accepts: 'coolant', freeUnit: 'tanker', desc: 'Coolant tanker drop-off. Free Tanker on completion. Cools heavy units.' },
  watertower: { name: 'Water Tower', w: 2, h: 2, hp: 420, cost: 450, power: -8, buildTime: 10, sight: 4, hgt: 26, water: 4, accepts: 'coolant', desc: 'Lets Coolant Tankers draw coolant straight from rivers & lakes (which drain & dry up). Coolant drop-off; +4 coolant/s.' },
  smelter: { name: 'Alloy Smelter', w: 2, h: 2, hp: 440, cost: 500, power: -15, buildTime: 11, sight: 4, hgt: 19, accepts: 'alloy', freeUnit: 'hauler', desc: 'Alloy hauler drop-off. Free Hauler on completion. Alloy builds advanced war machines.' },
  mill: { name: 'Lumber Mill', w: 2, h: 2, hp: 460, cost: 400, power: -10, buildTime: 10, sight: 4, hgt: 18, accepts: 'wood', freeUnit: 'logger', desc: 'Logger drop-off. Free Logger on completion. Wood fuels Repair Rigs.' },
  aaturret: { name: 'Flak Cannon', w: 1, h: 1, hp: 460, cost: 500, power: -10, buildTime: 9, sight: 10, hgt: 8, dmg: 9, range: 285, rof: 0.42, antiAir: true, airOnly: true, coolant: 3, alloy: 150, desc: 'Long-range anti-air flak. Engages aircraft only. Needs alloy.' },
  habitat: { name: 'Habitat Block', w: 2, h: 2, hp: 360, cost: 250, power: -5, buildTime: 8, sight: 3, hgt: 22, house: 45, civic: 2, desc: 'Housing for +45 citizens. Population = labor & conscripts.' },
  market: { name: 'Civic Market', w: 2, h: 2, hp: 340, cost: 350, power: -8, buildTime: 9, sight: 3, hgt: 18, civic: 16, desc: 'Meets civic needs (+happiness). Happy citizens work faster.' },
  cyber: { name: 'Cyber Ops Center', w: 2, h: 2, hp: 740, cost: 800, power: -20, buildTime: 14, sight: 6, hgt: 20, alloy: 300, desc: 'Unlocks cyber abilities & covert missions. Needs alloy.' },
  drillbay: { name: 'Deep Bore Facility', w: 3, h: 2, hp: 980, cost: 1200, power: -25, buildTime: 18, sight: 5, hgt: 22, alloy: 300, desc: 'Hallmark works. Unlocks the Subterranean Borer — a burrowing assault drill. Needs alloy.' },
  silo: { name: 'Missile Silo', w: 2, h: 2, hp: 820, cost: 1400, power: -25, buildTime: 16, sight: 5, hgt: 24, alloy: 400, desc: 'Launch platform. Unlocks Ballistic & Thermonuclear missile strikes. Needs alloy.' },
  idome: { name: 'Iron Dome', w: 2, h: 2, hp: 560, cost: 900, power: -20, buildTime: 12, sight: 6, hgt: 16, alloy: 250, desc: 'Intercepts inbound ballistic & thermonuclear missiles over a wide radius. Recharges between intercepts.' },
};

// ── Units ────────────────────────────────────────────────────────────────────
export interface UnitDef {
  name: string;
  cost: number;
  hp: number;
  speed: number;
  radius: number;
  sight: number;
  buildTime: number;
  cargo?: number;
  dmg?: number;
  range?: number;
  rof?: number;
  air?: boolean;           // flies — ignores terrain, only AA/aircraft can hit it
  antiAir?: boolean;       // can engage airborne targets
  splash?: number;         // area-of-effect blast radius on impact
  coolant?: number;        // coolant consumed per second while alive
  infantry?: boolean;      // soft target rendered small; trained from the Foundry
  harvests?: ResourceKind; // resource this unit gathers (harvester=crystal, tanker=coolant, hauler=alloy)
  logs?: boolean;          // fells & clears forest tiles for wood (Logger Rig)
  repair?: boolean;        // mends friendly units & buildings, burning wood (Repair Rig)
  tunneler?: boolean;      // burrows through any terrain AND can strike underground units (Subterranean Borer)
  shield?: boolean;        // mobile missile interceptor — no weapon (Aegis Shield)
  survey?: boolean;        // long-range sense that locates buried Hero Vaults (Survey Hunter)
  hero?: boolean;          // unique excavated super-unit (golden render; never deserts)
  auraHeal?: number;       // hp/sec healed to nearby allies (Warden hero aura)
  requires?: string;       // building type that must be built before this unit can be trained
  alloy?: number;          // alloy build-cost surcharge (advanced units)
  desc: string;
}

export const U: Record<string, UnitDef> = {
  harvester: { name: 'Crystal Harvester', cost: 400, hp: 310, speed: 74, radius: 11, sight: 5, buildTime: 10, cargo: 200, harvests: 'crystal', desc: 'Gathers data crystals. Your economy.' },
  tanker: { name: 'Coolant Tanker', cost: 450, hp: 300, speed: 70, radius: 11, sight: 5, buildTime: 11, cargo: 180, harvests: 'coolant', desc: 'Draws coolant from wells to a Coolant Refinery.' },
  hauler: { name: 'Alloy Hauler', cost: 450, hp: 320, speed: 68, radius: 11, sight: 5, buildTime: 11, cargo: 170, harvests: 'alloy', desc: 'Hauls alloy ore to a Smelter. Alloy builds advanced units.' },
  logger: { name: 'Logger Rig', cost: 250, hp: 300, speed: 72, radius: 11, sight: 5, buildTime: 9, cargo: 150, logs: true, desc: 'Fells & clears forest for wood — opening new ground. Delivers to a Lumber Mill or HQ.' },
  repair: { name: 'Repair Rig', cost: 350, hp: 270, speed: 80, radius: 10, sight: 5, buildTime: 10, repair: true, desc: 'Mobile mender — heals friendly units & buildings, burning wood. Escort one (right-click) or it auto-seeks the wounded.' },
  recon: { name: 'Recon Drone', cost: 150, hp: 78, speed: 140, radius: 8, sight: 9, buildTime: 6, dmg: 4, range: 96, rof: 0.4, air: true, desc: 'Fast scout quadcopter — flies over terrain; only AA can hit it.' },
  infantry: { name: 'Rifle Trooper', cost: 90, hp: 70, speed: 70, radius: 7, sight: 6, buildTime: 4, dmg: 5, range: 98, rof: 0.5, infantry: true, desc: 'Cheap massable foot soldier.' },
  rocket: { name: 'Rocket Trooper', cost: 180, hp: 90, speed: 62, radius: 7, sight: 7, buildTime: 7, dmg: 17, range: 152, rof: 1.5, antiAir: true, infantry: true, desc: 'Anti-armor & anti-air infantry.' },
  strike: { name: 'Hover Tank', cost: 300, hp: 155, speed: 96, radius: 10, sight: 7, buildTime: 9, dmg: 11, range: 124, rof: 0.8, desc: 'Backbone main battle tank.' },
  artillery: { name: 'Siege Artillery', cost: 850, hp: 200, speed: 50, radius: 12, sight: 6, buildTime: 18, dmg: 58, range: 256, rof: 3.0, splash: 58, coolant: 3, alloy: 350, desc: 'Long-range splash siege. Fragile; needs coolant + alloy.' },
  walker: { name: 'Railgun Walker', cost: 700, hp: 440, speed: 56, radius: 13, sight: 7, buildTime: 16, dmg: 48, range: 182, rof: 2.2, coolant: 4, alloy: 300, desc: 'Quad-legged siege platform. Runs hot; needs alloy.' },
  harrier: { name: 'Harrier Jet', cost: 420, hp: 130, speed: 176, radius: 8, sight: 9, buildTime: 9, dmg: 14, range: 122, rof: 0.5, air: true, antiAir: true, coolant: 3, alloy: 120, desc: 'Cheap, fast strike jet. Flies over terrain; light air-to-ground & dogfighting. Modest coolant + alloy.' },
  aircraft: { name: 'Wraith Gunship', cost: 600, hp: 240, speed: 158, radius: 10, sight: 10, buildTime: 16, dmg: 24, range: 150, rof: 0.6, splash: 26, air: true, antiAir: true, coolant: 6, alloy: 300, desc: 'VTOL gunship. Devastating splash strafes; flies over terrain; heavy coolant + alloy upkeep.' },
  borer: { name: 'Subterranean Borer', cost: 1500, hp: 520, speed: 72, radius: 13, sight: 7, buildTime: 24, dmg: 60, range: 150, rof: 1.6, splash: 30, coolant: 4, alloy: 450, tunneler: true, requires: 'drillbay', desc: 'Burrows through ANY terrain, strikes units underground, AND excavates Hero Vaults. Very costly; needs a Deep Bore Facility.' },
  hunter: { name: 'Survey Hunter', cost: 320, hp: 120, speed: 150, radius: 8, sight: 11, buildTime: 7, dmg: 3, range: 92, rof: 0.7, air: true, survey: true, requires: 'drillbay', desc: 'Fast airborne surveyor — flies the highlands to locate buried Hero Vaults. Lightly armed. Needs a Deep Bore Facility.' },
  // Heroes — never built; excavated from Hero Vaults by a Borer. cost/buildTime unused.
  titan: { name: 'Colossus Titan', cost: 0, hp: 1700, speed: 58, radius: 15, sight: 7, buildTime: 0, dmg: 46, range: 128, rof: 0.9, splash: 30, coolant: 3, hero: true, desc: 'HERO — a towering brawler. Massive armour and a crushing short-range cannon.' },
  siegelord: { name: 'Devastator', cost: 0, hp: 760, speed: 54, radius: 13, sight: 8, buildTime: 0, dmg: 95, range: 300, rof: 3.2, splash: 72, coolant: 4, hero: true, desc: 'HERO — siege artillery. Annihilating long-range splash; fragile up close.' },
  warden: { name: 'Warden', cost: 0, hp: 1100, speed: 70, radius: 12, sight: 8, buildTime: 0, dmg: 18, range: 140, rof: 0.7, hero: true, auraHeal: 16, desc: 'HERO — battlefield guardian. Constantly mends nearby allies with a healing aura; steady weapon.' },
  aegis: { name: 'Aegis Shield', cost: 700, hp: 320, speed: 66, radius: 11, sight: 7, buildTime: 14, alloy: 200, shield: true, requires: 'idome', desc: 'Mobile interceptor — shields nearby units from inbound missiles. Recharges between intercepts. Needs an Iron Dome.' },
};

export interface AbilityDef { name: string; cost: number; cd: number; key: string; requires?: string; alloy?: number; desc: string; }
export const ABILITIES: Record<string, AbilityDef> = {
  emp: { name: 'EMP Pulse', cost: 300, cd: 60, key: 'E', requires: 'cyber', desc: 'Disable non-allied units & turrets in a zone for 8s. Hitting neutrals angers them.' },
  hijack: { name: 'System Hijack', cost: 600, cd: 90, key: 'H', requires: 'cyber', desc: 'Seize one enemy unit permanently. A hostile act against neutrals.' },
  nuke: { name: 'Ballistic Missile', cost: 2000, cd: 150, key: 'N', requires: 'silo', desc: 'Long-range strike — a devastating area blast after a short flight. Needs a Missile Silo. Interceptable by Iron Dome.' },
  thermo: { name: 'Thermonuclear Missile', cost: 9000, alloy: 2500, cd: 360, key: 'B', requires: 'silo', desc: 'CONTINENT-CRACKER — a colossal blast that can erase an entire faction in one strike. Staggering cost; needs a Missile Silo. Interceptable by Iron Dome.' },
};

export interface CovertDef { name: string; cost: number; cd: number; chance: number; desc: string; }
export const COVERT: Record<string, CovertDef> = {
  steal: { name: 'Steal Data', cost: 250, cd: 45, chance: 0.70, desc: 'Siphon up to 600 crystals from the target. Detection: −20 relations.' },
  sabotage: { name: 'Sabotage', cost: 500, cd: 75, chance: 0.65, desc: 'Cripple a random enemy structure. Detection: −25.' },
  recon: { name: 'Recon Sweep', cost: 150, cd: 40, chance: 1.00, desc: 'Reveal the target base for 15s. Never detected.' },
  incite: { name: 'Incite War', cost: 700, cd: 120, chance: 0.55, desc: 'Poison relations between the target and another faction (−40). Detection: −25.' },
};

// ── Base anchors (6 factions around the perimeter of the 112² map) ───────────
export interface BaseInfo { tx: number; ty: number; sx: number; sy: number; }
export const BASE_INFO: Record<number, BaseInfo> = {
  1: { tx: 14 * MAP_SCALE, ty: 78 * MAP_SCALE, sx: +1, sy: -1 }, // AMERICAN FEDERATION (SW, player)
  2: { tx: 14 * MAP_SCALE, ty: 30 * MAP_SCALE, sx: +1, sy: +1 }, // EUROPEAN CONCORD     (NW)
  3: { tx: 54 * MAP_SCALE, ty: 8 * MAP_SCALE,  sx: +1, sy: +1 }, // PAN-AFRICAN UNION    (N)
  4: { tx: 95 * MAP_SCALE, ty: 30 * MAP_SCALE, sx: -1, sy: +1 }, // GULF COALITION       (NE)
  5: { tx: 95 * MAP_SCALE, ty: 78 * MAP_SCALE, sx: -1, sy: -1 }, // EASTERN BLOC         (SE)
  6: { tx: 54 * MAP_SCALE, ty: 99 * MAP_SCALE, sx: +1, sy: -1 }, // OCEANIC LEAGUE       (S)
};

// Indices 0-5 sit just inside each base toward centre; 6 = centre; 7-10 = frontier.
export const NODE_SITES = [
  { x: 26 * MAP_SCALE, y: 70 * MAP_SCALE }, { x: 26 * MAP_SCALE, y: 40 * MAP_SCALE }, { x: 56 * MAP_SCALE, y: 22 * MAP_SCALE }, { x: 86 * MAP_SCALE, y: 40 * MAP_SCALE }, { x: 86 * MAP_SCALE, y: 70 * MAP_SCALE }, { x: 56 * MAP_SCALE, y: 88 * MAP_SCALE },
  { x: 56 * MAP_SCALE, y: 56 * MAP_SCALE },
  { x: 38 * MAP_SCALE, y: 56 * MAP_SCALE }, { x: 74 * MAP_SCALE, y: 56 * MAP_SCALE }, { x: 56 * MAP_SCALE, y: 36 * MAP_SCALE }, { x: 56 * MAP_SCALE, y: 76 * MAP_SCALE },
];

// Each base is RICH in its home resource and scarce in the other two → forces
// expansion toward the contested centre/frontier (DESIGN_SPEC_v4 §2.3). Two
// factions per resource; alloy split across Europe & the Gulf.
export const HOME_RES: Record<number, ResourceKind> = {
  1: 'crystal', 2: 'alloy', 3: 'coolant', 4: 'alloy', 5: 'crystal', 6: 'coolant',
};

// ── Command Relays (DESIGN_SPEC_v4 §5) ────────────────────────────────────────
// Strategic points (centre + 3 frontiers) captured by presence. A held relay
// grants its owner a crystal trickle (income) and battlefield vision — no longer
// a Victory-Point win path (annihilation is the sole win condition).
export const RELAY_SITES = [
  { x: 56 * MAP_SCALE, y: 56 * MAP_SCALE },                       // the central nexus
  { x: 56 * MAP_SCALE, y: 30 * MAP_SCALE }, { x: 32 * MAP_SCALE, y: 74 * MAP_SCALE }, { x: 80 * MAP_SCALE, y: 74 * MAP_SCALE },
];
export const RELAY_INCOME = 3;            // crystals/s per held relay
export const RELAY_HP = 600;              // an owned relay's "hold" — shoot it to 0 to knock it neutral, then re-take by presence

export interface AIScriptStep { t: number; type: string; dx: number; dy: number; }
export const AI_SCRIPT: AIScriptStep[] = [
  { t: 20, type: 'power', dx: -2, dy: 7 }, { t: 55, type: 'foundry', dx: 5, dy: 5 },
  { t: 90, type: 'habitat', dx: -4, dy: 4 }, { t: 120, type: 'turret', dx: 8, dy: 6 },
  { t: 150, type: 'turret', dx: 6, dy: 9 }, { t: 185, type: 'pump', dx: -3, dy: 9 },
  { t: 215, type: 'market', dx: -6, dy: 3 }, { t: 245, type: 'smelter', dx: -5, dy: 6 },
  { t: 280, type: 'refinery', dx: 0, dy: 10 }, { t: 310, type: 'aaturret', dx: 7, dy: 4 },
  { t: 350, type: 'habitat', dx: -7, dy: 7 }, { t: 390, type: 'foundry', dx: 9, dy: 2 },
  { t: 430, type: 'power', dx: 2, dy: 12 }, { t: 480, type: 'aaturret', dx: 4, dy: 10 },
  { t: 540, type: 'turret', dx: 10, dy: 9 }, { t: 600, type: 'pump', dx: 6, dy: 12 },
  { t: 650, type: 'habitat', dx: 9, dy: 5 }, { t: 700, type: 'smelter', dx: 8, dy: 8 },
];

// ── Shared math helpers ──────────────────────────────────────────────────────
export const idx = (tx: number, ty: number) => ty * MAPW + tx;
export const inMap = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < MAPW && ty < MAPH;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
