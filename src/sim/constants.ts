import type { ResourceKind } from './types';

// ── Core grid ────────────────────────────────────────────────────────────────
export const TILE = 32;
export const MAPW = 84;
export const MAPH = 84;
export const WORLD_W = MAPW * TILE;
export const WORLD_H = MAPH * TILE;

export const PLAYER = 1;
export const AIS = [2, 3, 4] as const;
export const ALL_TEAMS = [1, 2, 3, 4] as const;

export type Persona = 'player' | 'warlord' | 'merchant' | 'covert';

export interface Faction {
  name: string;
  col: string;
  rgb: string;
  persona: Persona;
}

// Colors & personas per DESIGN_SPEC §1
export const FAC: Record<number, Faction> = {
  1: { name: 'NEXUS', col: '#3ec8b4', rgb: '62,200,180', persona: 'player' },
  2: { name: 'HELIX COMBINE', col: '#e8483a', rgb: '232,72,58', persona: 'warlord' },
  3: { name: 'AURUM SYNDICATE', col: '#e9a93d', rgb: '233,169,61', persona: 'merchant' },
  4: { name: 'VANTA CELL', col: '#9b6fe8', rgb: '155,111,232', persona: 'covert' },
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
  desc: string;
}

export const B: Record<string, BuildingDef> = {
  hq: { name: 'Command HQ', w: 3, h: 3, hp: 1700, cost: 0, power: +20, buildTime: 0, sight: 8, hgt: 26, water: 5, desc: 'Primary structure. Accepts all resource deliveries. Trickles coolant.' },
  power: { name: 'Power Plant', w: 2, h: 2, hp: 430, cost: 300, power: +50, buildTime: 8, sight: 4, hgt: 20, desc: '+50 power.' },
  refinery: { name: 'Crystal Refinery', w: 3, h: 2, hp: 700, cost: 600, power: -10, buildTime: 12, sight: 5, hgt: 20, accepts: 'crystal', freeUnit: 'harvester', desc: 'Crystal harvester drop-off. Free Harvester on completion.' },
  foundry: { name: 'War Foundry', w: 3, h: 2, hp: 900, cost: 500, power: -15, buildTime: 12, sight: 5, hgt: 22, desc: 'Fabricates all vehicles, drones, infantry & aircraft.' },
  turret: { name: 'Sentinel Turret', w: 1, h: 1, hp: 520, cost: 400, power: -10, buildTime: 8, sight: 7, hgt: 8, dmg: 13, range: 188, rof: 0.65, desc: 'Automated ground point-defense.' },
  pump: { name: 'Coolant Refinery', w: 2, h: 2, hp: 420, cost: 450, power: -15, buildTime: 11, sight: 4, hgt: 18, water: 6, accepts: 'coolant', freeUnit: 'tanker', desc: 'Coolant tanker drop-off. Free Tanker on completion. Cools heavy units.' },
  aaturret: { name: 'Flak Cannon', w: 1, h: 1, hp: 460, cost: 500, power: -10, buildTime: 9, sight: 8, hgt: 8, dmg: 9, range: 210, rof: 0.42, antiAir: true, airOnly: true, coolant: 3, desc: 'Anti-air flak. Engages aircraft only.' },
  cyber: { name: 'Cyber Ops Center', w: 2, h: 2, hp: 740, cost: 800, power: -20, buildTime: 14, sight: 6, hgt: 20, desc: 'Unlocks cyber abilities & covert missions.' },
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
  harvests?: ResourceKind; // resource this unit gathers (harvester=crystal, tanker=coolant)
  desc: string;
}

export const U: Record<string, UnitDef> = {
  harvester: { name: 'Crystal Harvester', cost: 400, hp: 310, speed: 74, radius: 11, sight: 5, buildTime: 10, cargo: 200, harvests: 'crystal', desc: 'Gathers data crystals. Your economy.' },
  tanker: { name: 'Coolant Tanker', cost: 450, hp: 300, speed: 70, radius: 11, sight: 5, buildTime: 11, cargo: 180, harvests: 'coolant', desc: 'Draws coolant from wells to a Coolant Refinery.' },
  recon: { name: 'Recon Drone', cost: 150, hp: 78, speed: 140, radius: 8, sight: 9, buildTime: 6, dmg: 4, range: 96, rof: 0.4, desc: 'Fast scout quadcopter.' },
  infantry: { name: 'Rifle Trooper', cost: 90, hp: 70, speed: 70, radius: 7, sight: 6, buildTime: 4, dmg: 5, range: 98, rof: 0.5, infantry: true, desc: 'Cheap massable foot soldier.' },
  rocket: { name: 'Rocket Trooper', cost: 180, hp: 90, speed: 62, radius: 7, sight: 7, buildTime: 7, dmg: 17, range: 152, rof: 1.5, antiAir: true, infantry: true, desc: 'Anti-armor & anti-air infantry.' },
  strike: { name: 'Hover Tank', cost: 300, hp: 155, speed: 96, radius: 10, sight: 7, buildTime: 9, dmg: 11, range: 124, rof: 0.8, desc: 'Backbone main battle tank.' },
  artillery: { name: 'Siege Artillery', cost: 850, hp: 200, speed: 50, radius: 12, sight: 6, buildTime: 18, dmg: 58, range: 256, rof: 3.0, splash: 58, coolant: 3, desc: 'Long-range splash siege. Fragile; needs coolant.' },
  walker: { name: 'Railgun Walker', cost: 700, hp: 440, speed: 56, radius: 13, sight: 7, buildTime: 16, dmg: 48, range: 182, rof: 2.2, coolant: 4, desc: 'Quad-legged siege platform. Runs hot.' },
  aircraft: { name: 'Wraith Gunship', cost: 600, hp: 175, speed: 150, radius: 10, sight: 9, buildTime: 14, dmg: 14, range: 132, rof: 0.7, air: true, antiAir: true, coolant: 5, desc: 'VTOL gunship. Flies over terrain; needs heavy coolant.' },
};

export interface AbilityDef { name: string; cost: number; cd: number; key: string; desc: string; }
export const ABILITIES: Record<string, AbilityDef> = {
  emp: { name: 'EMP Pulse', cost: 300, cd: 60, key: 'E', desc: 'Disable non-allied units & turrets in a zone for 8s. Hitting neutrals angers them.' },
  hijack: { name: 'System Hijack', cost: 600, cd: 90, key: 'H', desc: 'Seize one enemy unit permanently. A hostile act against neutrals.' },
};

export interface CovertDef { name: string; cost: number; cd: number; chance: number; desc: string; }
export const COVERT: Record<string, CovertDef> = {
  steal: { name: 'Steal Data', cost: 250, cd: 45, chance: 0.70, desc: 'Siphon up to 600 crystals from the target. Detection: −20 relations.' },
  sabotage: { name: 'Sabotage', cost: 500, cd: 75, chance: 0.65, desc: 'Cripple a random enemy structure. Detection: −25.' },
  recon: { name: 'Recon Sweep', cost: 150, cd: 40, chance: 1.00, desc: 'Reveal the target base for 15s. Never detected.' },
  incite: { name: 'Incite War', cost: 700, cd: 120, chance: 0.55, desc: 'Poison relations between the target and another faction (−40). Detection: −25.' },
};

// ── Base anchors & crystal sites (per DESIGN_SPEC §6) ─────────────────────────
export interface BaseInfo { tx: number; ty: number; sx: number; sy: number; }
export const BASE_INFO: Record<number, BaseInfo> = {
  1: { tx: 7, ty: 74, sx: +1, sy: -1 }, // NEXUS  (SW)
  2: { tx: 74, ty: 7, sx: -1, sy: +1 }, // HELIX  (NE)
  3: { tx: 74, ty: 74, sx: -1, sy: -1 }, // AURUM  (SE)
  4: { tx: 7, ty: 7, sx: +1, sy: +1 }, // VANTA  (NW)
};

export const NODE_SITES = [
  { x: 17, y: 66 }, { x: 66, y: 17 }, { x: 66, y: 66 }, { x: 17, y: 17 },
  { x: 42, y: 42 }, { x: 42, y: 13 }, { x: 42, y: 71 }, { x: 13, y: 42 }, { x: 71, y: 42 },
];

// Each base is RICH in its home resource and POOR in the other → forces expansion
// toward the contested centre/frontier to balance an economy (DESIGN_SPEC_v4 §2.3).
export const HOME_RES: Record<number, ResourceKind> = {
  1: 'crystal', 2: 'crystal', 3: 'coolant', 4: 'coolant',
};

export interface AIScriptStep { t: number; type: string; dx: number; dy: number; }
export const AI_SCRIPT: AIScriptStep[] = [
  { t: 20, type: 'power', dx: -2, dy: 7 }, { t: 60, type: 'foundry', dx: 5, dy: 5 },
  { t: 100, type: 'turret', dx: 8, dy: 6 }, { t: 135, type: 'turret', dx: 6, dy: 9 },
  { t: 185, type: 'pump', dx: -3, dy: 9 }, { t: 230, type: 'refinery', dx: 0, dy: 10 },
  { t: 290, type: 'aaturret', dx: 7, dy: 4 }, { t: 340, type: 'foundry', dx: 9, dy: 2 },
  { t: 410, type: 'power', dx: 2, dy: 12 }, { t: 470, type: 'aaturret', dx: 4, dy: 10 },
  { t: 540, type: 'turret', dx: 10, dy: 9 }, { t: 620, type: 'pump', dx: 6, dy: 12 },
];

// ── Shared math helpers ──────────────────────────────────────────────────────
export const idx = (tx: number, ty: number) => ty * MAPW + tx;
export const inMap = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < MAPW && ty < MAPH;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
