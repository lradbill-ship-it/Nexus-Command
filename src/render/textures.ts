import Phaser from 'phaser';
import { TILE, B, U, FAC, ALL_TEAMS } from '../sim/constants';

// Normalized origin (0..1) for each generated texture so its logical anchor
// (building footprint center / unit center) lands on the entity's world x,y.
export const originOf: Record<string, { ox: number; oy: number }> = {};

function addCanvas(scene: Phaser.Scene, key: string, cv: HTMLCanvasElement, ox: number, oy: number) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, cv);
  originOf[key] = { ox: ox / cv.width, oy: oy / cv.height };
}
function mk(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h);
  return [c, c.getContext('2d')!];
}
function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// ── Soft additive glow (used for cores, muzzles, crystals, explosions) ───────
export function buildGlow(scene: Phaser.Scene) {
  const [c, g] = mk(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  addCanvas(scene, 'glow', c, 32, 32);
  // soft round particle
  const [c2, g2] = mk(16, 16);
  const gr2 = g2.createRadialGradient(8, 8, 0, 8, 8, 8);
  gr2.addColorStop(0, 'rgba(255,255,255,1)'); gr2.addColorStop(1, 'rgba(255,255,255,0)');
  g2.fillStyle = gr2; g2.fillRect(0, 0, 16, 16);
  addCanvas(scene, 'dot', c2, 8, 8);
}

// ── Data crystal cluster ─────────────────────────────────────────────────────
export function buildCrystal(scene: Phaser.Scene) {
  const [c, g] = mk(40, 40);
  const cx = 20, cy = 22;
  const shards = [[0, -14, 6, 16], [-9, -6, 5, 12], [9, -7, 5, 13], [-3, -2, 4, 9]];
  for (const [dx, dy, w, h] of shards) {
    const x = cx + dx, y = cy + dy;
    g.fillStyle = 'rgba(40,90,150,.9)';
    g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + w, y); g.lineTo(x, y + h * 0.4); g.lineTo(x - w, y); g.closePath(); g.fill();
    g.fillStyle = 'rgba(160,220,255,.95)';
    g.beginPath(); g.moveTo(x, y - h); g.lineTo(x, y + h * 0.4); g.lineTo(x - w, y); g.closePath(); g.fill();
    g.fillStyle = 'rgba(220,245,255,.9)';
    g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + w * 0.5, y - h * 0.3); g.lineTo(x, y - h * 0.1); g.closePath(); g.fill();
  }
  addCanvas(scene, 'crystal', c, 20, 22);
}

// ── Coolant well (teal liquid pool + condensate spires) ──────────────────────
export function buildCoolant(scene: Phaser.Scene) {
  const [c, g] = mk(40, 40);
  const cx = 20, cy = 24;
  // liquid pool
  const pool = g.createRadialGradient(cx, cy, 1, cx, cy, 14);
  pool.addColorStop(0, 'rgba(150,235,245,.95)'); pool.addColorStop(0.6, 'rgba(40,150,180,.85)'); pool.addColorStop(1, 'rgba(18,70,95,.5)');
  g.fillStyle = pool; g.beginPath(); g.ellipse(cx, cy, 14, 8, 0, 0, 7); g.fill();
  g.strokeStyle = 'rgba(190,245,255,.7)'; g.lineWidth = 1.2; g.beginPath(); g.ellipse(cx, cy, 14, 8, 0, 0, 7); g.stroke();
  // frozen condensate spires rising from the pool
  for (const [dx, h] of [[-6, 13], [2, 17], [8, 11]]) {
    const x = cx + dx;
    g.fillStyle = 'rgba(120,205,225,.9)';
    g.beginPath(); g.moveTo(x, cy - h); g.lineTo(x + 3.5, cy - 1); g.lineTo(x - 3.5, cy - 1); g.closePath(); g.fill();
    g.fillStyle = 'rgba(225,250,255,.85)';
    g.beginPath(); g.moveTo(x, cy - h); g.lineTo(x + 1.4, cy - h * 0.4); g.lineTo(x - 1.4, cy - h * 0.4); g.closePath(); g.fill();
  }
  addCanvas(scene, 'coolant', c, 20, 24);
}

// ── Alloy ore (stacked metallic ingots / raw ore chunks) ─────────────────────
export function buildAlloy(scene: Phaser.Scene) {
  const [c, g] = mk(40, 40);
  const cx = 20, cy = 24;
  // ground ore scatter
  g.fillStyle = 'rgba(70,52,34,.55)'; g.beginPath(); g.ellipse(cx, cy + 4, 15, 7, 0, 0, 7); g.fill();
  // stacked ingots
  const ingot = (x: number, y: number, w: number, h: number) => {
    const grd = g.createLinearGradient(x - w, y, x + w, y);
    grd.addColorStop(0, '#7a4a22'); grd.addColorStop(0.5, '#e0a155'); grd.addColorStop(1, '#9a5e2c');
    g.fillStyle = grd; g.beginPath();
    g.moveTo(x - w, y); g.lineTo(x - w + 3, y - h); g.lineTo(x + w - 3, y - h); g.lineTo(x + w, y); g.lineTo(x + w - 3, y + 3); g.lineTo(x - w + 3, y + 3); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,225,180,.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x - w + 3, y - h); g.lineTo(x + w - 3, y - h); g.stroke();
  };
  ingot(cx - 5, cy + 2, 9, 5); ingot(cx + 6, cy + 1, 8, 5);
  ingot(cx, cy - 5, 9, 6);
  // raw ore nugget with sheen
  g.fillStyle = '#c98a44'; g.beginPath(); g.arc(cx - 9, cy - 4, 4, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,235,200,.6)'; g.beginPath(); g.arc(cx - 10, cy - 5, 1.5, 0, 7); g.fill();
  addCanvas(scene, 'alloy', c, 20, 24);
}

// ── Buildings (pseudo-3D, faction-trimmed) ───────────────────────────────────
const PAD = 10;
function buildingCanvas(type: string, team: number): [HTMLCanvasElement, number, number] {
  const d = B[type]; const col = FAC[team].col;
  const fw = d.w * TILE, fh = d.h * TILE, hgt = d.hgt;
  const W = fw + PAD * 2, H = fh + hgt + PAD * 2;
  const [c, g] = mk(W, H);
  const fx = PAD, fy = PAD + hgt;            // footprint top-left
  const cx = fx + fw / 2, cy = fy + fh / 2;  // footprint center -> world anchor
  // drop shadow
  g.fillStyle = 'rgba(0,0,0,.42)';
  rr(g, fx + 5, fy + 7, fw, fh, 7); g.fill();
  // extruded side walls (front + right faces) for depth
  g.fillStyle = '#0c121b';
  g.beginPath();
  g.moveTo(fx, fy); g.lineTo(fx, fy + fh); g.lineTo(fx + fw, fy + fh); g.lineTo(fx + fw, fy);
  g.lineTo(fx + fw, fy - hgt); g.lineTo(fx, fy - hgt); g.closePath(); g.fill();
  // top roof slab
  const roofY = fy - hgt;
  const grd = g.createLinearGradient(fx, roofY, fx, roofY + fh);
  grd.addColorStop(0, '#26303f'); grd.addColorStop(1, '#161e29');
  g.fillStyle = grd; rr(g, fx, roofY, fw, fh, 6); g.fill();
  // faction trim border
  g.strokeStyle = col; g.lineWidth = 2; rr(g, fx + 1.5, roofY + 1.5, fw - 3, fh - 3, 5); g.stroke();
  // bevel highlight on top edge
  g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(fx + 5, roofY + 3); g.lineTo(fx + fw - 5, roofY + 3); g.stroke();
  // panel seams across the roof slab (subtle prefab look)
  g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 1;
  for (let sx = fx + 10; sx < fx + fw - 6; sx += 12) { g.beginPath(); g.moveTo(sx, roofY + 4); g.lineTo(sx, roofY + fh - 4); g.stroke(); }
  // lit window strip along the front edge of the slab (faction-tinted glow)
  for (let wx = fx + 6; wx < fx + fw - 7; wx += 7) {
    g.fillStyle = Math.random() < 0.78 ? `rgba(${FAC[team].rgb},.85)` : 'rgba(20,28,38,.9)';
    g.fillRect(wx, fy - 5, 4, 3);
  }
  // weathered side-wall faction stripe + rivets
  g.fillStyle = col; g.globalAlpha = 0.5; g.fillRect(fx, fy + fh - 5, fw, 4); g.globalAlpha = 1;
  g.fillStyle = 'rgba(0,0,0,.4)'; for (let rx = fx + 4; rx < fx + fw - 2; rx += 9) g.fillRect(rx, fy + fh - 3, 1.5, 1.5);

  const rcx = fx + fw / 2, rcy = roofY + fh / 2;
  g.lineWidth = 2; g.strokeStyle = col; g.fillStyle = col;
  if (type === 'hq') {
    // radar dish base + antenna mast
    g.fillStyle = '#2b3646'; g.beginPath(); g.arc(rcx, rcy, fw * 0.22, 0, 7); g.fill();
    g.strokeStyle = col; g.beginPath(); g.arc(rcx, rcy, fw * 0.22, 0, 7); g.stroke();
    g.strokeStyle = 'rgba(180,220,235,.7)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(rcx, rcy); g.lineTo(rcx + fw * 0.2, rcy - fw * 0.12); g.stroke();
    g.fillStyle = col; g.beginPath(); g.arc(rcx, rcy, 3, 0, 7); g.fill();
    g.fillStyle = '#9fb3c2';
    for (const [ax, ay] of [[fx + 7, roofY + 7], [fx + fw - 7, roofY + 7], [fx + 7, roofY + fh - 7], [fx + fw - 7, roofY + fh - 7]]) g.fillRect(ax - 2, ay - 2, 4, 4);
  } else if (type === 'power') {
    // twin cooling stacks
    for (const sx of [-0.22, 0.22]) {
      g.fillStyle = '#39424f'; g.beginPath(); g.arc(rcx + fw * sx, rcy, 7, 0, 7); g.fill();
      g.fillStyle = '#10161e'; g.beginPath(); g.arc(rcx + fw * sx, rcy, 4, 0, 7); g.fill();
      g.strokeStyle = col; g.beginPath(); g.arc(rcx + fw * sx, rcy, 7, 0, 7); g.stroke();
    }
  } else if (type === 'refinery') {
    // glowing intake well + pipe
    g.fillStyle = '#222d3a'; rr(g, rcx - 14, rcy - 9, 28, 18, 4); g.fill();
    g.fillStyle = 'rgba(150,212,255,.85)'; g.beginPath(); g.arc(rcx + 8, rcy, 7, 0, 7); g.fill();
    g.strokeStyle = '#5f6f80'; g.lineWidth = 4; g.beginPath(); g.moveTo(rcx - 14, rcy); g.lineTo(rcx - 2, rcy); g.stroke();
  } else if (type === 'foundry') {
    // bay door + gantry
    g.fillStyle = '#11161d'; rr(g, rcx - fw * 0.3, rcy - 2, fw * 0.6, fh * 0.34, 3); g.fill();
    g.strokeStyle = col; g.strokeRect(rcx - fw * 0.3, rcy - 2, fw * 0.6, fh * 0.34);
    g.fillStyle = '#5d6878'; for (let i = -2; i <= 2; i++) g.fillRect(rcx + i * 7 - 1, rcy - 12, 2, 8);
  } else if (type === 'turret') {
    // armored ring base (barrel drawn as a separate sprite)
    g.fillStyle = '#2a3340'; g.beginPath(); g.arc(rcx, rcy, fw * 0.42, 0, 7); g.fill();
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(rcx, rcy, fw * 0.42, 0, 7); g.stroke();
    g.fillStyle = '#1a222c'; g.beginPath(); g.arc(rcx, rcy, fw * 0.24, 0, 7); g.fill();
  } else if (type === 'cyber') {
    // glass data dome
    const dg = g.createRadialGradient(rcx, rcy, 2, rcx, rcy, fw * 0.3);
    dg.addColorStop(0, 'rgba(170,140,255,.7)'); dg.addColorStop(1, 'rgba(80,60,150,.15)');
    g.fillStyle = dg; g.beginPath(); g.arc(rcx, rcy, fw * 0.3, 0, 7); g.fill();
    g.strokeStyle = col; g.beginPath(); g.ellipse(rcx, rcy, fw * 0.3, fw * 0.18, 0, 0, 7); g.stroke();
  } else if (type === 'pump') {
    // coolant plant: water reservoir + condenser coils
    const wg = g.createRadialGradient(rcx, rcy, 2, rcx, rcy, fw * 0.32);
    wg.addColorStop(0, 'rgba(120,210,235,.9)'); wg.addColorStop(1, 'rgba(30,90,120,.4)');
    g.fillStyle = wg; g.beginPath(); g.arc(rcx, rcy, fw * 0.3, 0, 7); g.fill();
    g.strokeStyle = '#7fd6ea'; g.lineWidth = 1.5;
    for (let rr2 = 5; rr2 < fw * 0.3; rr2 += 4) { g.beginPath(); g.arc(rcx, rcy, rr2, 0, 7); g.stroke(); }
    g.fillStyle = '#3a4650'; g.fillRect(rcx - 3, rcy - fh * 0.42, 6, fh * 0.3);  // intake pipe
  } else if (type === 'smelter') {
    // alloy smelter: glowing crucible + chimney
    const cr = g.createRadialGradient(rcx, rcy, 1, rcx, rcy, fw * 0.3);
    cr.addColorStop(0, 'rgba(255,210,120,.95)'); cr.addColorStop(0.6, 'rgba(220,120,40,.8)'); cr.addColorStop(1, 'rgba(90,40,16,.5)');
    g.fillStyle = cr; g.beginPath(); g.arc(rcx, rcy, fw * 0.28, 0, 7); g.fill();
    g.strokeStyle = '#e0a155'; g.lineWidth = 2; g.beginPath(); g.arc(rcx, rcy, fw * 0.28, 0, 7); g.stroke();
    g.fillStyle = '#2a2018'; g.fillRect(rcx + fw * 0.18, rcy - fh * 0.42, 7, fh * 0.34);   // chimney
    g.fillStyle = 'rgba(255,180,90,.5)'; g.beginPath(); g.arc(rcx, rcy, 4, 0, 7); g.fill();
  } else if (type === 'habitat') {
    // residential block: grid of lit apartment windows
    g.fillStyle = '#1b2430'; rr(g, rcx - fw * 0.32, rcy - fh * 0.3, fw * 0.64, fh * 0.6, 3); g.fill();
    for (let wy = -1; wy <= 1; wy++) for (let wx = -2; wx <= 2; wx++) {
      g.fillStyle = Math.random() < 0.6 ? 'rgba(159,217,204,.85)' : 'rgba(40,52,64,.9)';
      g.fillRect(rcx + wx * 6 - 1.5, rcy + wy * 7 - 1.5, 3.5, 4);
    }
    g.fillStyle = '#69d84f'; g.fillRect(rcx - 2, rcy + fh * 0.28, 4, 4);   // green courtyard
  } else if (type === 'market') {
    // civic market: striped awning stalls
    for (let i = -1; i <= 1; i++) {
      g.fillStyle = i === 0 ? '#caa05a' : '#9fd9cc';
      g.beginPath(); g.moveTo(rcx + i * 11 - 6, rcy - 2); g.lineTo(rcx + i * 11, rcy - 9); g.lineTo(rcx + i * 11 + 6, rcy - 2); g.closePath(); g.fill();
      g.fillStyle = '#2a2018'; g.fillRect(rcx + i * 11 - 5, rcy - 2, 10, 8);
    }
  } else if (type === 'aaturret') {
    // flak base ring with quad missile cells
    g.fillStyle = '#2a3340'; g.beginPath(); g.arc(rcx, rcy, fw * 0.4, 0, 7); g.fill();
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(rcx, rcy, fw * 0.4, 0, 7); g.stroke();
    g.fillStyle = '#11161d'; g.beginPath(); g.arc(rcx, rcy, fw * 0.2, 0, 7); g.fill();
    g.fillStyle = '#c9d6e0'; for (const [ox, oy] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) g.fillRect(rcx + ox - 1, rcy + oy - 1, 2, 2);
  } else if (type === 'mill') {
    // lumber mill: stacked logs + a circular saw blade
    g.fillStyle = '#2a2018'; rr(g, rcx - fw * 0.3, rcy - fh * 0.18, fw * 0.6, fh * 0.4, 3); g.fill();
    g.fillStyle = '#6a4a28';
    for (const [lx, ly] of [[-9, 6], [-2, 6], [5, 6]]) { g.beginPath(); g.arc(rcx + lx, rcy + ly, 3.6, 0, 7); g.fill(); }
    g.fillStyle = '#9c7338'; for (const [lx, ly] of [[-9, 6], [-2, 6], [5, 6]]) { g.beginPath(); g.arc(rcx + lx, rcy + ly, 1.7, 0, 7); g.fill(); }
    g.strokeStyle = '#c9d6e0'; g.lineWidth = 1.6; g.beginPath(); g.arc(rcx + 4, rcy - 6, 6, 0, 7); g.stroke();   // saw blade
    g.fillStyle = '#9fb3c2'; g.beginPath(); g.arc(rcx + 4, rcy - 6, 2, 0, 7); g.fill();
    g.fillStyle = '#9ec24f'; g.fillRect(rcx - fw * 0.18, rcy + fh * 0.26, 5, 4);   // green log-pile marker
  } else if (type === 'drillbay') {
    // deep-bore facility: a drill derrick over a dark shaft mouth
    g.fillStyle = '#0a0e14'; g.beginPath(); g.arc(rcx, rcy + 2, fw * 0.2, 0, 7); g.fill();               // shaft
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(rcx, rcy + 2, fw * 0.2, 0, 7); g.stroke();
    g.strokeStyle = '#9fb3c2'; g.lineWidth = 2;                                                          // derrick truss
    g.beginPath(); g.moveTo(rcx - fw * 0.22, rcy + fh * 0.22); g.lineTo(rcx, rcy - fh * 0.18); g.lineTo(rcx + fw * 0.22, rcy + fh * 0.22); g.stroke();
    g.beginPath(); g.moveTo(rcx - fw * 0.1, rcy + fh * 0.04); g.lineTo(rcx + fw * 0.1, rcy + fh * 0.04); g.stroke();
    const dg = g.createLinearGradient(rcx, rcy - 4, rcx, rcy + 8);                                       // suspended drill bit
    dg.addColorStop(0, '#cdd9e3'); dg.addColorStop(1, '#5a6573');
    g.fillStyle = dg; g.beginPath(); g.moveTo(rcx, rcy + 8); g.lineTo(rcx + 4, rcy - 3); g.lineTo(rcx - 4, rcy - 3); g.closePath(); g.fill();
  }
  return [c, cx, cy];
}

// ── Units (top-down, art points "up"/-Y; rotated to facing at runtime) ───────
function unitCanvas(type: string, team: number): [HTMLCanvasElement, number, number] {
  const d = U[type]; const col = FAC[team].col; const rgb = FAC[team].rgb;
  const S = d.radius * 2 + 18; const [c, g] = mk(S, S); const cx = S / 2, cy = S / 2;
  // shadow
  g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(cx, cy + d.radius * 0.7, d.radius * 0.95, d.radius * 0.45, 0, 0, 7); g.fill();
  const body = g.createLinearGradient(0, cy - d.radius, 0, cy + d.radius);
  body.addColorStop(0, '#243140'); body.addColorStop(1, '#0f1721');
  g.fillStyle = body; g.strokeStyle = col; g.lineWidth = 1.6;
  if (type === 'harvester') {
    rr(g, cx - 10, cy - 13, 20, 26, 5); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(155,212,255,.5)'; g.strokeRect(cx - 6, cy - 7, 12, 13);
    g.fillStyle = `rgba(${rgb},.8)`; g.fillRect(cx - 12, cy + 4, 2.5, 5); g.fillRect(cx + 9.5, cy + 4, 2.5, 5);
    g.fillStyle = '#9fb6c8'; g.fillRect(cx - 7, cy - 16, 14, 4);
  } else if (type === 'tanker') {
    // coolant tanker: rounded hull + cylindrical teal tank drum
    rr(g, cx - 10, cy - 13, 20, 26, 6); g.fill(); g.stroke();
    const tank = g.createLinearGradient(cx - 8, 0, cx + 8, 0);
    tank.addColorStop(0, 'rgba(40,120,150,.95)'); tank.addColorStop(0.5, 'rgba(140,225,240,.95)'); tank.addColorStop(1, 'rgba(40,120,150,.95)');
    g.fillStyle = tank; rr(g, cx - 8, cy - 9, 16, 18, 7); g.fill();
    g.strokeStyle = 'rgba(210,250,255,.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - 8, cy); g.lineTo(cx + 8, cy); g.stroke();
    g.fillStyle = `rgba(${rgb},.8)`; g.fillRect(cx - 12, cy + 4, 2.5, 5); g.fillRect(cx + 9.5, cy + 4, 2.5, 5);
    g.fillStyle = '#7fd6ea'; g.fillRect(cx - 6, cy - 16, 12, 4);
  } else if (type === 'hauler') {
    // alloy hauler: flatbed with an ore hopper
    rr(g, cx - 10, cy - 13, 20, 26, 5); g.fill(); g.stroke();
    const ore = g.createLinearGradient(cx - 8, 0, cx + 8, 0);
    ore.addColorStop(0, 'rgba(122,74,34,.95)'); ore.addColorStop(0.5, 'rgba(224,161,85,.95)'); ore.addColorStop(1, 'rgba(122,74,34,.95)');
    g.fillStyle = ore; rr(g, cx - 8, cy - 9, 16, 17, 2); g.fill();
    g.fillStyle = '#caa05a'; for (const [ox, oy] of [[-4, -4], [3, -5], [-1, 0], [4, 2]]) { g.beginPath(); g.arc(cx + ox, cy + oy, 1.8, 0, 7); g.fill(); }
    g.fillStyle = `rgba(${rgb},.8)`; g.fillRect(cx - 12, cy + 4, 2.5, 5); g.fillRect(cx + 9.5, cy + 4, 2.5, 5);
    g.fillStyle = '#e0a155'; g.fillRect(cx - 6, cy - 16, 12, 4);
  } else if (type === 'logger') {
    // logger rig: flatbed stacked with felled logs + a saw mast
    rr(g, cx - 10, cy - 13, 20, 26, 5); g.fill(); g.stroke();
    g.fillStyle = '#6a4a28'; for (const [ox, oy] of [[-4, -3], [2, -3], [-2, 4], [4, 4]]) { g.beginPath(); g.arc(cx + ox, cy + oy, 3.2, 0, 7); g.fill(); }
    g.fillStyle = '#9c7338'; for (const [ox, oy] of [[-4, -3], [2, -3], [-2, 4], [4, 4]]) { g.beginPath(); g.arc(cx + ox, cy + oy, 1.4, 0, 7); g.fill(); }
    g.strokeStyle = '#cdd9e3'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy - 14); g.lineTo(cx, cy - 8); g.stroke();   // saw arm
    g.fillStyle = `rgba(${rgb},.8)`; g.fillRect(cx - 12, cy + 4, 2.5, 5); g.fillRect(cx + 9.5, cy + 4, 2.5, 5);
    g.fillStyle = '#9ec24f'; g.fillRect(cx - 6, cy - 16, 12, 4);
  } else if (type === 'repair') {
    // repair rig: utility hull with a glowing green mend-cross
    rr(g, cx - 10, cy - 12, 20, 24, 5); g.fill(); g.stroke();
    g.fillStyle = 'rgba(127,224,127,.95)'; g.fillRect(cx - 2.4, cy - 7, 4.8, 14); g.fillRect(cx - 7, cy - 2.4, 14, 4.8);
    g.fillStyle = `rgba(${rgb},.8)`; g.fillRect(cx - 12, cy + 4, 2.5, 5); g.fillRect(cx + 9.5, cy + 4, 2.5, 5);
    g.fillStyle = '#9fb6c8'; g.fillRect(cx - 6, cy - 15, 12, 4);
  } else if (type === 'borer') {
    // subterranean borer: heavy hull + big conical drill bit up front
    g.fillStyle = '#1a232e'; g.fillRect(cx - 13, cy - 6, 3.6, 18); g.fillRect(cx + 9.4, cy - 6, 3.6, 18);   // tracks
    rr(g, cx - 11, cy - 8, 22, 22, 5); g.fill(); g.stroke();
    const dg = g.createLinearGradient(cx, cy - 19, cx, cy - 4);
    dg.addColorStop(0, '#dde7ef'); dg.addColorStop(1, '#5a6573');
    g.fillStyle = dg; g.beginPath(); g.moveTo(cx, cy - 20); g.lineTo(cx + 7, cy - 4); g.lineTo(cx - 7, cy - 4); g.closePath(); g.fill();   // drill cone
    g.strokeStyle = col; g.lineWidth = 1.4; g.beginPath(); g.moveTo(cx, cy - 20); g.lineTo(cx + 7, cy - 4); g.lineTo(cx - 7, cy - 4); g.closePath(); g.stroke();
    g.strokeStyle = 'rgba(20,28,38,.7)'; g.lineWidth = 1;                                                  // flutes
    g.beginPath(); g.moveTo(cx - 3.5, cy - 6); g.lineTo(cx, cy - 16); g.moveTo(cx + 3.5, cy - 6); g.lineTo(cx, cy - 16); g.stroke();
    g.fillStyle = `rgba(${rgb},.75)`; g.fillRect(cx - 9, cy + 9, 18, 3);
  } else if (type === 'recon') {
    // quadcopter: 4 rotor rings + slim core
    g.strokeStyle = 'rgba(200,225,235,.5)'; g.lineWidth = 1.4;
    for (const [rx, ry] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) { g.beginPath(); g.arc(cx + rx, cy + ry, 4.5, 0, 7); g.stroke(); }
    g.fillStyle = body; g.strokeStyle = col; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(cx, cy - 8); g.lineTo(cx + 5, cy + 6); g.lineTo(cx - 5, cy + 6); g.closePath(); g.fill(); g.stroke();
  } else if (type === 'strike') {
    // hover tank hull (turret is a separate sprite)
    rr(g, cx - 9, cy - 11, 18, 22, 4); g.fill(); g.stroke();
    g.fillStyle = `rgba(${rgb},.7)`; g.fillRect(cx - 9, cy + 7, 18, 3);
    g.fillStyle = '#1a2530'; g.beginPath(); g.arc(cx, cy, 6, 0, 7); g.fill();
  } else if (type === 'walker') {
    // quad legs
    g.strokeStyle = 'rgba(120,140,165,.7)'; g.lineWidth = 2.5;
    for (const [lx, ly] of [[-11, 7], [11, 7], [-9, -7], [9, -7]]) { g.beginPath(); g.moveTo(cx + lx * 0.5, cy); g.lineTo(cx + lx, cy + ly); g.stroke(); }
    g.fillStyle = body; g.strokeStyle = col; g.lineWidth = 1.8;
    g.beginPath();
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; const px = cx + Math.cos(a) * 11, py = cy + Math.sin(a) * 11; if (i) g.lineTo(px, py); else g.moveTo(px, py); }
    g.closePath(); g.fill(); g.stroke();
  } else if (type === 'infantry') {
    // foot trooper: helmet, torso, slung rifle (small)
    g.fillStyle = '#3a4654'; g.beginPath(); g.ellipse(cx, cy + 1, 4.5, 5.5, 0, 0, 7); g.fill();
    g.strokeStyle = col; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = '#9fb3c2'; g.beginPath(); g.arc(cx, cy - 4, 3, 0, 7); g.fill();   // helmet
    g.strokeStyle = '#cdd9e3'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx + 1, cy); g.lineTo(cx + 6, cy - 6); g.stroke(); // rifle
    g.fillStyle = `rgba(${rgb},.9)`; g.fillRect(cx - 4, cy + 4, 8, 1.5);
  } else if (type === 'rocket') {
    // rocket trooper: trooper + shoulder launcher tube
    g.fillStyle = '#3a4654'; g.beginPath(); g.ellipse(cx, cy + 1, 4.5, 5.5, 0, 0, 7); g.fill();
    g.strokeStyle = col; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = '#9fb3c2'; g.beginPath(); g.arc(cx, cy - 4, 3, 0, 7); g.fill();
    g.strokeStyle = '#e8a33d'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - 4, cy - 1); g.lineTo(cx + 7, cy - 7); g.stroke(); // launcher
    g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(cx + 7, cy - 7, 1.6, 0, 7); g.fill();
  } else if (type === 'artillery') {
    // tracked siege hull (long barrel is a separate sprite)
    g.fillStyle = '#1a232e'; g.fillRect(cx - 12, cy - 9, 4, 18); g.fillRect(cx + 8, cy - 9, 4, 18); // tracks
    g.strokeStyle = 'rgba(120,140,165,.6)'; g.lineWidth = 1; for (let i = -8; i <= 8; i += 4) { g.beginPath(); g.moveTo(cx - 12, cy + i); g.lineTo(cx - 8, cy + i); g.moveTo(cx + 8, cy + i); g.lineTo(cx + 12, cy + i); g.stroke(); }
    g.fillStyle = body; g.strokeStyle = col; g.lineWidth = 1.6; rr(g, cx - 8, cy - 8, 16, 16, 3); g.fill(); g.stroke();
    g.fillStyle = '#1a2530'; g.beginPath(); g.arc(cx, cy, 5, 0, 7); g.fill();
  } else if (type === 'harrier') {
    // strike jet: slim swept-wing dart pointing "up"
    g.fillStyle = body; g.strokeStyle = col; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(cx, cy - 13); g.lineTo(cx + 3, cy + 8); g.lineTo(cx - 3, cy + 8); g.closePath(); g.fill(); g.stroke();   // fuselage
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 10, cy + 4); g.lineTo(cx, cy - 2); g.lineTo(cx + 10, cy + 4); g.stroke();   // swept wings
    g.fillStyle = '#cdd9e3'; g.beginPath(); g.arc(cx, cy - 8, 1.6, 0, 7); g.fill();   // canopy
    g.fillStyle = '#ffb15a'; g.fillRect(cx - 1.2, cy + 8, 2.4, 3);   // exhaust glow
  } else if (type === 'aircraft') {
    // VTOL gunship: swept fuselage + twin rotor nacelles (rotor discs spin in-scene)
    g.fillStyle = body; g.strokeStyle = col; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(cx, cy - 13); g.lineTo(cx + 5, cy + 6); g.lineTo(cx, cy + 11); g.lineTo(cx - 5, cy + 6); g.closePath(); g.fill(); g.stroke(); // fuselage
    g.fillStyle = '#2c3a48';
    for (const sx of [-1, 1]) { g.save(); g.translate(cx + sx * 9, cy - 1); rr(g, -2.5, -5, 5, 10, 2); g.fill(); g.strokeStyle = col; g.stroke(); g.restore(); } // nacelles
    g.fillStyle = '#cdd9e3'; g.beginPath(); g.moveTo(cx, cy - 13); g.lineTo(cx - 2, cy - 7); g.lineTo(cx + 2, cy - 7); g.closePath(); g.fill(); // canopy
  }
  // core light + faction halo (polish)
  g.fillStyle = `rgba(${rgb},.45)`; g.beginPath(); g.arc(cx, cy, 4.5, 0, 7); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(cx, cy, 2.2, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(cx, cy, 1, 0, 7); g.fill();
  return [c, cx, cy];
}

// Separate rotating barrel/turret pieces (point "up", rotated to aim).
function barrelCanvas(type: string, team: number): [HTMLCanvasElement, number, number] {
  const col = FAC[team].col; const [c, g] = mk(40, 40); const cx = 20, cy = 22;
  if (type === 'turret') {
    g.fillStyle = '#323d4b'; g.beginPath(); g.arc(cx, cy, 8, 0, 7); g.fill();
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 8, 0, 7); g.stroke();
    g.strokeStyle = '#c9d6e0'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - 17); g.stroke();
    g.fillStyle = col; g.beginPath(); g.arc(cx, cy - 17, 2.5, 0, 7); g.fill();
  } else if (type === 'strike') {
    g.fillStyle = '#26323f'; rr(g, cx - 6, cy - 6, 12, 12, 3); g.fill();
    g.strokeStyle = col; g.lineWidth = 1.5; rr(g, cx - 6, cy - 6, 12, 12, 3); g.stroke();
    g.strokeStyle = '#cdd9e3'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - 15); g.stroke();
  } else if (type === 'walker') {
    g.strokeStyle = 'rgba(200,230,255,.9)'; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(cx - 3, cy); g.lineTo(cx - 3, cy - 20); g.moveTo(cx + 3, cy); g.lineTo(cx + 3, cy - 20); g.stroke();
  } else if (type === 'artillery') {
    g.fillStyle = '#26323f'; g.beginPath(); g.arc(cx, cy, 7, 0, 7); g.fill();
    g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, 7, 0, 7); g.stroke();
    g.strokeStyle = '#aebcc8'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - 21); g.stroke();
    g.fillStyle = '#1a2129'; g.fillRect(cx - 2.5, cy - 22, 5, 3);   // muzzle brake
  } else if (type === 'aaturret') {
    g.fillStyle = '#323d4b'; g.beginPath(); g.arc(cx, cy, 7, 0, 7); g.fill();
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 7, 0, 7); g.stroke();
    g.strokeStyle = '#c9d6e0'; g.lineWidth = 2.4;   // twin flak barrels, slightly splayed
    g.beginPath(); g.moveTo(cx - 2, cy); g.lineTo(cx - 4, cy - 16); g.moveTo(cx + 2, cy); g.lineTo(cx + 4, cy - 16); g.stroke();
  }
  return [c, cx, cy];
}

// Generic faction-tintable spinning parts (rotated each frame by the scene).
function buildSpinners(scene: Phaser.Scene) {
  // radar dish — an asymmetric paddle so its rotation reads
  const [c, g] = mk(34, 34); const cx = 17, cy = 17;
  g.strokeStyle = 'rgba(210,230,240,.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + 12, cy - 4); g.stroke();
  g.fillStyle = 'rgba(180,210,230,.55)'; g.beginPath(); g.ellipse(cx + 12, cy - 4, 5, 8, -0.5, 0, 7); g.fill();
  g.fillStyle = '#d8e6ee'; g.beginPath(); g.arc(cx, cy, 3, 0, 7); g.fill();
  addCanvas(scene, 'radardish', c, cx, cy);
  // rotor blur disc for fliers
  const [c2, g2] = mk(40, 40);
  const rg = g2.createRadialGradient(20, 20, 4, 20, 20, 19);
  rg.addColorStop(0, 'rgba(220,235,245,.0)'); rg.addColorStop(0.7, 'rgba(200,225,240,.18)'); rg.addColorStop(1, 'rgba(200,225,240,.04)');
  g2.fillStyle = rg; g2.beginPath(); g2.arc(20, 20, 19, 0, 7); g2.fill();
  g2.strokeStyle = 'rgba(230,240,250,.5)'; g2.lineWidth = 2;
  g2.beginPath(); g2.moveTo(3, 20); g2.lineTo(37, 20); g2.moveTo(20, 3); g2.lineTo(20, 37); g2.stroke();
  addCanvas(scene, 'rotor', c2, 20, 20);
  // soft ground shadow for airborne units
  const [c3, g3] = mk(40, 24);
  const sg = g3.createRadialGradient(20, 12, 1, 20, 12, 18);
  sg.addColorStop(0, 'rgba(0,0,0,.5)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
  g3.fillStyle = sg; g3.beginPath(); g3.ellipse(20, 12, 18, 10, 0, 0, 7); g3.fill();
  addCanvas(scene, 'airshadow', c3, 20, 12);
}

/** Build every entity texture for all four factions. Call once after the scene boots. */
export function buildAllTextures(scene: Phaser.Scene) {
  buildGlow(scene); buildCrystal(scene); buildCoolant(scene); buildAlloy(scene); buildSpinners(scene);
  for (const team of ALL_TEAMS) {
    for (const type of Object.keys(B)) {
      const [c, cx, cy] = buildingCanvas(type, team); addCanvas(scene, `b_${type}_${team}`, c, cx, cy);
    }
    for (const type of Object.keys(U)) {
      const [c, cx, cy] = unitCanvas(type, team); addCanvas(scene, `u_${type}_${team}`, c, cx, cy);
    }
    for (const type of ['turret', 'strike', 'walker', 'artillery', 'aaturret']) {
      const [c, cx, cy] = barrelCanvas(type, team); addCanvas(scene, `t_${type}_${team}`, c, cx, cy);
    }
  }
}
