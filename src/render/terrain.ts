import {
  TILE, MAPW, MAPH, WORLD_W, WORLD_H, idx,
  T_GRASS, T_DIRT, T_WATER, T_ROCK, T_FOREST, T_BRIDGE, T_ROAD,
} from '../sim/constants';
import { game } from '../sim/state';
import { makeNoise } from '../sim/mapgen';

const terrainCv = document.createElement('canvas');
terrainCv.width = WORLD_W; terrainCv.height = WORLD_H;
const tg = terrainCv.getContext('2d')!;
let dirty = false;

export function getTerrainCanvas() { return terrainCv; }
export function terrainDirty() { return dirty; }
export function clearTerrainDirty() { dirty = false; }

const inMapT = (x: number, y: number) => x >= 0 && y >= 0 && x < MAPW && y < MAPH;
function shade(rgb: number[], k: number) { return `rgb(${rgb.map(c => Math.max(0, Math.min(255, c * k | 0))).join(',')})`; }

/** Paint the full natural battlefield (ported from wip-v3/p2-systems renderTerrain) + baked trees. */
export function renderTerrain() {
  const T = game.terr;
  const detail = makeNoise();
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) {
    const t = T[idx(x, y)], px = x * TILE, py = y * TILE;
    const v = detail(x * 0.5, y * 0.5);
    const v2 = detail(x * 0.13, y * 0.13);
    if (t === T_GRASS) {
      const base = [52 + v * 26, 76 + v * 22, 40 + v * 14].map(c => c * (0.86 + v2 * 0.3));
      tg.fillStyle = `rgb(${base.map(c => c | 0).join(',')})`;
      tg.fillRect(px, py, TILE, TILE);
    } else if (t === T_DIRT || t === T_ROAD) {
      const k = t === T_ROAD ? 1.12 : 1;
      tg.fillStyle = shade([97 + v * 20, 80 + v * 16, 55 + v * 10], k * (0.9 + v2 * 0.2));
      tg.fillRect(px, py, TILE, TILE);
    } else if (t === T_WATER) {
      tg.fillStyle = shade([26, 68, 92], 0.85 + v * 0.3);
      tg.fillRect(px, py, TILE, TILE);
    } else if (t === T_ROCK) {
      tg.fillStyle = shade([74, 80, 88], 0.8 + v * 0.4);
      tg.fillRect(px, py, TILE, TILE);
    } else if (t === T_FOREST) {
      tg.fillStyle = shade([38, 58, 32], 0.85 + v * 0.3);
      tg.fillRect(px, py, TILE, TILE);
    } else if (t === T_BRIDGE) {
      tg.fillStyle = shade([26, 68, 92], 0.9); tg.fillRect(px, py, TILE, TILE);
    }
  }
  // soft organic speckle
  for (let i = 0; i < 14000; i++) {
    const x = Math.random() * WORLD_W, y = Math.random() * WORLD_H;
    const t = T[idx(x / TILE | 0, y / TILE | 0)];
    if (t === T_WATER || t === T_BRIDGE) continue;
    tg.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.10)' : 'rgba(255,255,230,.05)';
    const r = 1 + Math.random() * 3.5;
    tg.beginPath(); tg.arc(x, y, r, 0, 7); tg.fill();
  }
  // grass tufts
  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * WORLD_W, y = Math.random() * WORLD_H;
    if (T[idx(x / TILE | 0, y / TILE | 0)] !== T_GRASS) continue;
    tg.strokeStyle = `rgba(${90 + Math.random() * 50 | 0},${130 + Math.random() * 50 | 0},60,.35)`;
    tg.lineWidth = 1;
    tg.beginPath(); tg.moveTo(x, y); tg.lineTo(x + (Math.random() * 4 - 2), y - 3 - Math.random() * 3); tg.stroke();
  }
  // yellow flower fields (C&C screenshot vibe)
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * WORLD_W, y = Math.random() * WORLD_H;
    if (T[idx(x / TILE | 0, y / TILE | 0)] !== T_GRASS) continue;
    if (detail(x / TILE * 0.09, y / TILE * 0.09) < 0.62) continue;
    tg.fillStyle = Math.random() < 0.8 ? 'rgba(228,200,80,.8)' : 'rgba(240,240,235,.7)';
    tg.beginPath(); tg.arc(x, y, 1.2 + Math.random(), 0, 7); tg.fill();
  }
  // water depth + sandy banks
  for (const w of game.waterTiles) {
    const px = w.x * TILE, py = w.y * TILE;
    const g2 = tg.createRadialGradient(px + 16, py + 16, 2, px + 16, py + 16, 22);
    g2.addColorStop(0, 'rgba(12,40,60,.55)'); g2.addColorStop(1, 'rgba(12,40,60,0)');
    tg.fillStyle = g2; tg.fillRect(px - 4, py - 4, TILE + 8, TILE + 8);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nt = inMapT(w.x + dx, w.y + dy) ? game.terr[idx(w.x + dx, w.y + dy)] : T_WATER;
      if (nt !== T_WATER && nt !== T_BRIDGE) {
        tg.fillStyle = 'rgba(170,150,105,.5)';
        if (dx === 1) tg.fillRect(px + TILE - 3, py, 3, TILE);
        if (dx === -1) tg.fillRect(px, py, 3, TILE);
        if (dy === 1) tg.fillRect(px, py + TILE - 3, TILE, 3);
        if (dy === -1) tg.fillRect(px, py, TILE, 3);
      }
    }
  }
  // rock formations (faceted boulders with sunlit faces)
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) {
    if (game.terr[idx(x, y)] !== T_ROCK) continue;
    const px = x * TILE, py = y * TILE;
    const n = 2 + (Math.random() * 2 | 0);
    for (let i = 0; i < n; i++) {
      const cx = px + 6 + Math.random() * 20, cy = py + 6 + Math.random() * 20, r = 6 + Math.random() * 9;
      const a0 = Math.random() * 7;
      tg.fillStyle = 'rgba(0,0,0,.3)';
      tg.beginPath();
      for (let k = 0; k < 5; k++) { const a = a0 + k / 5 * Math.PI * 2; if (k) tg.lineTo(cx + 3 + Math.cos(a) * r, cy + 4 + Math.sin(a) * r * 0.8); else tg.moveTo(cx + 3 + Math.cos(a) * r, cy + 4 + Math.sin(a) * r * 0.8); }
      tg.closePath(); tg.fill();
      tg.fillStyle = shade([88, 95, 104], 0.8 + Math.random() * 0.4);
      tg.beginPath();
      for (let k = 0; k < 5; k++) { const a = a0 + k / 5 * Math.PI * 2; if (k) tg.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8); else tg.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8); }
      tg.closePath(); tg.fill();
      tg.fillStyle = 'rgba(235,240,245,.25)';
      tg.beginPath();
      for (let k = 0; k < 3; k++) { const a = a0 + Math.PI + k / 5 * Math.PI * 2; if (k) tg.lineTo(cx - 2 + Math.cos(a) * r * 0.55, cy - 3 + Math.sin(a) * r * 0.45); else tg.moveTo(cx - 2 + Math.cos(a) * r * 0.55, cy - 3 + Math.sin(a) * r * 0.45); }
      tg.closePath(); tg.fill();
    }
  }
  // plank bridges
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) {
    if (game.terr[idx(x, y)] !== T_BRIDGE) continue;
    const px = x * TILE, py = y * TILE;
    tg.fillStyle = '#6e5132'; tg.fillRect(px, py + 1, TILE, TILE - 2);
    tg.fillStyle = '#7e5e3a';
    for (let p = 0; p < 4; p++) tg.fillRect(px + 1, py + 2 + p * 8, TILE - 2, 5);
    tg.fillStyle = 'rgba(0,0,0,.35)';
    tg.fillRect(px, py, TILE, 2); tg.fillRect(px, py + TILE - 2, TILE, 2);
  }
  // road wear
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) {
    if (game.terr[idx(x, y)] !== T_ROAD) continue;
    if (Math.random() < 0.5) continue;
    const px = x * TILE, py = y * TILE;
    tg.strokeStyle = 'rgba(60,48,32,.4)'; tg.lineWidth = 2;
    tg.beginPath(); tg.moveTo(px + Math.random() * 8, py + Math.random() * 32);
    tg.lineTo(px + 24 + Math.random() * 8, py + Math.random() * 32); tg.stroke();
  }
  // baked pseudo-3D trees on forest tiles (sorted top-to-bottom for overlap)
  const trees = [...game.trees].sort((a, b) => a.y - b.y);
  for (const tr of trees) paintTree(tr.x, tr.y, tr.r, tr.pine, tr.tone);
  dirty = true;
}

function paintTree(x: number, y: number, r: number, pine: boolean, tone: number) {
  // ground shadow
  tg.fillStyle = 'rgba(0,0,0,.32)';
  tg.beginPath(); tg.ellipse(x + 3, y + r * 0.7, r * 1.05, r * 0.42, 0, 0, 7); tg.fill();
  // trunk
  tg.fillStyle = '#3a2c1d';
  tg.fillRect(x - 1.6, y - 1, 3.2, r * 0.8);
  const g = 0.78 + tone * 0.35;
  if (pine) {
    for (let i = 0; i < 3; i++) {
      const ly = y - r * 0.9 + i * r * 0.62, lw = r * (1 - i * 0.22);
      tg.fillStyle = shade([34, 70 + i * 6, 30], g);
      tg.beginPath();
      tg.moveTo(x, ly - r * 0.7); tg.lineTo(x + lw, ly + r * 0.35); tg.lineTo(x - lw, ly + r * 0.35);
      tg.closePath(); tg.fill();
      tg.fillStyle = 'rgba(190,220,150,.18)';
      tg.beginPath();
      tg.moveTo(x, ly - r * 0.7); tg.lineTo(x - lw * 0.5, ly + r * 0.1); tg.lineTo(x - lw, ly + r * 0.35);
      tg.closePath(); tg.fill();
    }
  } else {
    const blobs = [[0, -r * 0.7, r * 0.9], [-r * 0.6, -r * 0.3, r * 0.7], [r * 0.6, -r * 0.3, r * 0.7], [0, -r * 0.1, r * 0.8]];
    tg.fillStyle = shade([42, 86, 38], g);
    for (const [bx, by, br] of blobs) { tg.beginPath(); tg.arc(x + bx, y + by, br, 0, 7); tg.fill(); }
    tg.fillStyle = 'rgba(190,225,150,.22)';
    for (const [bx, by, br] of blobs) { tg.beginPath(); tg.arc(x + bx - br * 0.25, y + by - br * 0.3, br * 0.55, 0, 7); tg.fill(); }
  }
}

/** Burn a scorch mark into the terrain at a world position (called from sim on destroy). */
export function scorch(x: number, y: number, r: number) {
  tg.fillStyle = 'rgba(8,6,4,.5)';
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * 7, d = Math.random() * r * 0.7;
    tg.beginPath(); tg.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.35 + Math.random() * 0.45), 0, 7); tg.fill();
  }
  dirty = true;
}
