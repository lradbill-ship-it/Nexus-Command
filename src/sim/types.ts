export interface Vec { x: number; y: number; }

export type ResourceKind = 'crystal' | 'coolant' | 'alloy' | 'wood';
export interface ResourceNode {
  kind: ResourceKind;
  x: number; y: number;
  amount: number; max: number;
  pulse: number; shards: number;
}

export interface Tree { x: number; y: number; r: number; pine: boolean; tone: number; }

// Command Relays — strategic points captured by presence; a held relay grants
// its owner income (crystal trickle) and battlefield vision (DESIGN_SPEC_v4 §5).
export interface Relay {
  id: number;
  x: number; y: number;
  owner: number;      // 0 = neutral, else faction id
  capBy: number;      // faction currently gaining capture progress
  capT: number;       // capture progress 0..1
  hp: number;         // "hold" strength — an owned relay must be shot to 0 to knock it neutral
  hpMax: number;
  pulse: number;      // render animation phase
}

// Neutral civilian settlements on the map — recruited (paid), persuaded (peaceful
// presence) or intimidated (military presence) into a faction (DESIGN_SPEC_v4 §3.2).
export interface Settlement {
  id: number;
  x: number; y: number;
  pop: number;                 // citizens this settlement contributes when taken
  owner: number;               // 0 = neutral, else faction id
  capBy: number;               // faction currently gaining capture progress (0 = none)
  capT: number;                // capture progress 0..1
  seed: number;                // render variation
  unrest?: number;             // ungoverned-town unrest accrual → a Free Militia uprising (team 0)
  affinity?: Record<number, number>; // peaceful goodwill 0..100 a faction's Envoys have built up courting this town
  dev?: number;                // development tier progress 0..DEV_MAX (owned towns invested in → richer yields)
}

// Proximity mines — scattered by the Minefield ability; hidden from the enemy, they
// detonate when a hostile unit wanders within trigger range.
export interface Mine {
  id: number;
  x: number; y: number;
  team: number;       // owner faction (allies are safe; only enemies trigger it)
  armAt: number;      // game.t when the mine becomes live (brief arming delay after being laid)
}

// Hero Vaults — buried in mountain rock, found by surveying (Hero Hunter), excavated
// by a Subterranean Borer (pay-as-you-drill) to unearth a unique hero super-unit.
export interface Vault {
  id: number;
  x: number; y: number;
  tx: number; ty: number;
  archetype: string;      // unit type the vault yields (titan / siegelord / warden)
  discovered: boolean;    // revealed to the player by surveying
  discBy?: number;        // an AI team that has surveyed this vault (per-team knowledge; no player fog reveal)
  digBy: number;          // team currently / last excavating
  digT: number;           // excavation progress 0..1
  done: boolean;          // hero already extracted
  pulse: number;          // render animation phase
}

export interface Building {
  id: number;
  kind: 'b';
  type: string;
  team: number;
  tx: number; ty: number;
  x: number; y: number;
  w: number; h: number;
  hpMax: number; hp: number;
  progress: number;
  cooldown: number;
  target: Entity | null;
  queue: string[];
  queueT: number;
  disabledUntil: number;
  anim: number;
  unloadFx: number;
  aim: number;
  lastShot?: number;
  rally?: Vec;
  garrison?: { type: string; hp: number; vet?: number }[];   // infantry sheltering inside → defensive fire; eject if it falls
  dead?: boolean;
}

export interface Unit {
  id: number;
  kind: 'u';
  type: string;
  team: number;
  x: number; y: number;
  hpMax: number; hp: number;
  order: 'idle' | 'move' | 'amove' | 'attack' | 'guard' | 'dig' | 'patrol' | 'enter' | 'court';
  dest: Vec | null;
  digVault?: number;     // vault id a Borer is excavating (order === 'dig')
  courtId?: number;      // settlement id an Envoy is courting/developing (order === 'court')
  target: Entity | null;
  path: Vec[] | null;
  finalDest?: Vec;
  repathT: number;
  stuckT: number;
  acqT?: number;     // target-reacquisition throttle (don't scan every frame)
  unstick?: number;  // consecutive stuck-repath count; escalates to a physical dislodge
  lx: number; ly: number;
  cooldown: number;
  disabledUntil: number;
  cargo: number;
  hNode: ResourceNode | null;
  hState: 'find' | 'go' | 'mine' | 'return' | 'idlewait';
  chopTx?: number; chopTy?: number;   // forest tile a Logger is felling
  chopT?: number;                     // chop progress (seconds) on the current tile
  tunnelT?: number;                   // >0 ⇒ a harvester is burrowing underground (phases through terrain)
  facing: number;
  aim: number;
  bob: number;
  moving: boolean;
  trailT: number;
  lastShot: number;
  resume?: string | null;
  savedDest?: Vec | null;
  guard?: Unit | Building | null;   // friendly unit being escorted, OR a friendly building a Repair Rig is mending (order === 'guard')
  kills?: number;        // confirmed kills (drives veterancy)
  vet?: number;          // rank: 0 rookie · 1 veteran · 2 elite
  stack?: number;        // merged collectors: how many units this one represents (cargo/rate/hp scale ×stack)
  revealT?: number;      // stealth units: game.t until which the cloak is dropped (fired recently / enemy nearby)
  buffUntil?: number;    // Overcharge: game.t until which this unit has the combat-stim (+dmg/+speed) buff
  enterT?: number;       // game.t an 'enter' (garrison) order began → give up if it can't reach in time
  dead?: boolean;
}

export type Entity = Building | Unit;

export interface Shot {
  x: number; y: number;
  target: Entity;
  dmg: number;
  team: number;
  speed: number;
  col: string;
  rail: boolean;
  splash?: number;
  subsurface?: boolean;   // fired by a tunneler → its blast can also reach underground units
  by?: Unit;              // the firing unit (for veterancy kill credit); undefined for buildings
  dead?: boolean;
}

export interface Particle {
  type: string;
  x: number; y: number;
  vx?: number; vy?: number;
  t: number; life: number;
  rgb?: string;
  size?: number;
  grav?: number;
  big?: boolean;
}

export interface AIState {
  builtIdx: number;
  nextWave: number;
  waveN: number;
  covertT: number;
  missileT: number;   // next time this AI may launch a missile (needs its own Silo)
  techT: number;      // throttle for the conditional advanced-build pass (domes/silo/etc.)
  empT: number;       // next time this AI may fire an EMP (needs a Cyber Ops Center)
  hijackT: number;    // next time this AI may hijack an enemy unit (needs a Cyber Ops Center)
  buffT?: number;     // next time this AI may Overcharge its army (needs a Cyber Ops Center)
  mineT?: number;     // next time this AI may lay a defensive Minefield (needs a Cyber Ops Center)
  envoyT?: number;    // throttle for fielding an Envoy to court a neutral settlement
}

export interface GameState {
  started: boolean;
  over: boolean;
  won: boolean;
  paused: boolean;     // sim frozen (camera/selection still work)
  speed: number;       // sim speed multiplier: 1 / 2 / 3
  t: number;
  money: Record<number, number>;
  water: Record<number, number>;          // stored coolant reserve per team
  alloy: Record<number, number>;          // stored alloy stockpile per team (build-cost resource)
  wood: Record<number, number>;           // stored wood stockpile per team (repair-rig fuel; logged from forests)
  overheat: Record<number, boolean>;      // true when a team's reserve is dry & in deficit
  pop: Record<number, number>;            // civilian population per faction (labor + conscription pool)
  happy: Record<number, number>;          // population happiness 0..100 per faction
  conscriptPenalty: Record<number, number>; // transient happiness hit from recent conscription
  leader: Record<number, import('./constants').LeaderStyle>; // active leader style per faction
  platform: Record<number, import('./constants').LeaderStyle>; // doctrine each faction runs on next election
  electionT: Record<number, number>;      // time of each faction's next election
  campaign: Record<number, number>;       // campaign approval boost (decays)
  coupT: Record<number, number>;          // sustained-misery timer feeding coup risk
  cam: { x: number; y: number };
  buildings: Building[];
  units: Unit[];
  shots: Shot[];
  parts: Particle[];
  nodes: ResourceNode[];
  settlements: Settlement[];
  relays: Relay[];
  vaults: Vault[];
  mines: Mine[];
  trees: Tree[];
  waterTiles: { x: number; y: number }[];
  waterAmt: Float32Array;                  // per-tile coolant remaining in water features (drained by tankers → dries up)
  terr: Uint8Array;
  occupied: Uint8Array;
  gate: Uint8Array;
  explored: Uint8Array;
  visible: Uint8Array;
  selection: Entity[];
  groups: Record<number, number[]>; // control groups 1-9 -> unit ids
  placing: string | null;
  armed: string | null;
  cooldowns: Record<string, number>;
  covCd: Record<string, number>;
  covTarget: number;
  tempVision: { x: number; y: number; r: number; until: number }[];
  shake: number;
  aggroT: Record<string, number>;
  ai: Record<number, AIState>;
  eliminated: Record<number, boolean>;
}

export interface DipState {
  rel: Record<string, number>;
  alliance: Record<string, boolean>;
  trade: Record<string, boolean>;
  truce: Record<string, number>;   // pair key → game.t at which the ceasefire lapses (holds relations out of war until then)
}
