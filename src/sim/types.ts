export interface Vec { x: number; y: number; }

export type ResourceKind = 'crystal' | 'coolant' | 'alloy';
export interface ResourceNode {
  kind: ResourceKind;
  x: number; y: number;
  amount: number; max: number;
  pulse: number; shards: number;
}

export interface Tree { x: number; y: number; r: number; pine: boolean; tone: number; }

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
  dead?: boolean;
}

export interface Unit {
  id: number;
  kind: 'u';
  type: string;
  team: number;
  x: number; y: number;
  hpMax: number; hp: number;
  order: 'idle' | 'move' | 'amove' | 'attack';
  dest: Vec | null;
  target: Entity | null;
  path: Vec[] | null;
  finalDest?: Vec;
  repathT: number;
  stuckT: number;
  acqT?: number;     // target-reacquisition throttle (don't scan every frame)
  lx: number; ly: number;
  cooldown: number;
  disabledUntil: number;
  cargo: number;
  hNode: ResourceNode | null;
  hState: 'find' | 'go' | 'mine' | 'return' | 'idlewait';
  facing: number;
  aim: number;
  bob: number;
  moving: boolean;
  trailT: number;
  lastShot: number;
  resume?: string | null;
  savedDest?: Vec | null;
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
}

export interface GameState {
  started: boolean;
  over: boolean;
  won: boolean;
  t: number;
  money: Record<number, number>;
  water: Record<number, number>;          // stored coolant reserve per team
  alloy: Record<number, number>;          // stored alloy stockpile per team (build-cost resource)
  overheat: Record<number, boolean>;      // true when a team's reserve is dry & in deficit
  cam: { x: number; y: number };
  buildings: Building[];
  units: Unit[];
  shots: Shot[];
  parts: Particle[];
  nodes: ResourceNode[];
  trees: Tree[];
  waterTiles: { x: number; y: number }[];
  terr: Uint8Array;
  occupied: Uint8Array;
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
}
