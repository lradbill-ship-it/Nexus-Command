import { MAPW, MAPH } from './constants';
import type { GameState, DipState } from './types';

function createGame(): GameState {
  return {
    started: false, over: false, won: false, t: 0,
    money: { 1: 1500, 2: 2200, 3: 2200, 4: 2200, 5: 2200, 6: 2200 },
    water: { 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60 },
    alloy: { 1: 120, 2: 160, 3: 160, 4: 160, 5: 160, 6: 160 },
    overheat: {},
    pop: { 1: 24, 2: 24, 3: 24, 4: 24, 5: 24, 6: 24 },
    happy: { 1: 62, 2: 62, 3: 62, 4: 62, 5: 62, 6: 62 },
    conscriptPenalty: {},
    cam: { x: 0, y: 0 },
    buildings: [], units: [], shots: [], parts: [], nodes: [], settlements: [], trees: [], waterTiles: [],
    terr: new Uint8Array(MAPW * MAPH),
    occupied: new Uint8Array(MAPW * MAPH),
    explored: new Uint8Array(MAPW * MAPH),
    visible: new Uint8Array(MAPW * MAPH),
    selection: [], groups: {}, placing: null, armed: null,
    cooldowns: { emp: 0, hijack: 0 },
    covCd: { steal: 0, sabotage: 0, recon: 0, incite: 0 },
    covTarget: 2, tempVision: [], shake: 0, aggroT: {}, ai: {}, eliminated: {},
  };
}

function createDip(): DipState {
  return { rel: {}, alliance: {}, trade: {} };
}

// Live module bindings — reassigned wholesale on restart. ES module consumers
// importing { game, dip } see the new objects automatically.
export let game: GameState = createGame();
export let dip: DipState = createDip();

export const rk = (a: number, b: number) => (a < b ? a + '-' + b : b + '-' + a);
export const getRel = (a: number, b: number) => dip.rel[rk(a, b)] ?? 0;
export function setRel(a: number, b: number, v: number) { dip.rel[rk(a, b)] = Math.max(-100, Math.min(100, v)); }
export function addRel(a: number, b: number, d: number) { if (a !== b) setRel(a, b, getRel(a, b) + d); }
export const isAllied = (a: number, b: number) => a === b || !!dip.alliance[rk(a, b)];
export const isWar = (a: number, b: number) => a !== b && !isAllied(a, b) && getRel(a, b) <= -30;
export const stateOf = (a: number, b: number) =>
  game.eliminated[b] ? 'GONE' : (isAllied(a, b) ? 'ALLIED' : (isWar(a, b) ? 'WAR' : 'NEUTRAL'));

function applyStartingRelations() {
  // 15 pairwise relations across the 6 coalitions — a web of warm & cold ties,
  // none below the −30 war line at start (DESIGN_SPEC_v4 §6).
  setRel(1, 2, -5); setRel(1, 3, 8); setRel(1, 4, -10); setRel(1, 5, -22); setRel(1, 6, 5);
  setRel(2, 3, 6); setRel(2, 4, -8); setRel(2, 5, -14); setRel(2, 6, 4);
  setRel(3, 4, -6); setRel(3, 5, -10); setRel(3, 6, 10);
  setRel(4, 5, 8); setRel(4, 6, -12);
  setRel(5, 6, -8);
}
applyStartingRelations();

/** Wipe and recreate world + diplomacy for a fresh match. */
export function resetState() {
  game = createGame();
  dip = createDip();
  applyStartingRelations();
}

// ── Decoupled UI hooks (set by the DOM layer; sim never touches the DOM) ──────
type LogFn = (msg: string, cls?: string) => void;
type HintFn = (msg: string) => void;
let logHook: LogFn = () => {};
let hintHook: HintFn = () => {};
export function setLogHook(fn: LogFn) { logHook = fn; }
export function setHintHook(fn: HintFn) { hintHook = fn; }
export let lastHint = 0;
export function logMsg(msg: string, cls?: string) { logHook(msg, cls); }
export function hint(msg: string) { hintHook(msg); lastHint = game.t; }
export function setLastHint(v: number) { lastHint = v; }
