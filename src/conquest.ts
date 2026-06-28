// ── CONQUEST CAMPAIGN — a Risk-style metagame above the skirmish ──────────────
// A persistent world of territories you conquer one battle at a time. Attacking an
// adjacent enemy/neutral territory launches the normal skirmish; winning captures it.
// Holding more territory grants a growing reinforcement bonus in the next battle.
// Built as a DOM/SVG overlay (renders reliably; not gated by Phaser's RAF like the scene).
import { FAC } from './sim/constants';

interface Territory { id: number; name: string; x: number; y: number; owner: number; adj: number[]; }

const PLAYER = 1;
const AI_HOMES: Record<number, number> = { 2: 3, 3: 8, 4: 11, 5: 5, 6: 6 };   // faction → starting territory id
const BONUS_PER = 600;            // reinforcement credits per territory held beyond the first
const NAMES = ['Aurora Reach', 'Iron Vale', 'Cobalt Span', 'Solang Coast', 'Ashfall Basin', 'Meridian Flats',
  'Vantage Ridge', 'Tidewater', 'Drakmoor', 'Helix Delta', 'Zenith Mesa', 'Umbra Sound'];

let world: Territory[] = [];
let active = false;        // a campaign is running
let inBattle = false;      // a battle is being fought for `battleTarget`
let battleTarget = -1;
let selected = -1;         // the owned territory the player has selected to attack from
let overlay: HTMLDivElement | null = null;
let launchBattle: (bonus: number, name: string) => void = () => {};

export function setLaunchBattle(fn: (bonus: number, name: string) => void) { launchBattle = fn; }
export function isCampaignActive() { return active; }
export function isInCampaignBattle() { return active && inBattle; }
export function campaignStatus() { return { active, inBattle, owned: ownedCount(), total: world.length, owners: world.map(t => t.owner) }; }
const ownedCount = () => world.filter(t => t.owner === PLAYER).length;
const factionTerr = (f: number) => world.filter(t => t.owner === f).length;

function freshWorld(): Territory[] {
  const w: Territory[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    const id = r * 4 + c;
    w.push({ id, name: NAMES[id], x: 150 + c * 233, y: 130 + r * 175, owner: 0, adj: [] });
  }
  const link = (a: number, b: number) => { if (!w[a].adj.includes(b)) { w[a].adj.push(b); w[b].adj.push(a); } };
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    const id = r * 4 + c;
    if (c < 3) link(id, id + 1);            // horizontal
    if (r < 2) link(id, id + 4);            // vertical
  }
  link(0, 5); link(2, 7); link(5, 8); link(6, 11);   // a few diagonals for interesting frontiers
  w[0].owner = PLAYER;
  for (const f in AI_HOMES) w[AI_HOMES[f]].owner = +f;
  return w;
}

export function startCampaign(reset: boolean) {
  if (reset || !loadState()) { world = freshWorld(); active = true; inBattle = false; battleTarget = -1; selected = -1; saveState(); }
  active = true;
  ensureOverlay();
  showMap();
}

function attack(targetId: number) {
  const t = world[targetId];
  if (t.owner === PLAYER) return;
  const from = world.find(o => o.owner === PLAYER && o.adj.includes(targetId));
  if (!from) return;                       // must border one of your territories
  inBattle = true; battleTarget = targetId;
  hideOverlay();
  launchBattle((ownedCount() - 1) * BONUS_PER, t.name);
}

/** Called when a launched campaign battle ends. Win → capture the territory; then the AIs take a world turn. */
export function onBattleEnd(win: boolean) {
  if (!inBattle) return;
  const t = world[battleTarget];
  if (win) t.owner = PLAYER;
  inBattle = false; battleTarget = -1; selected = -1;
  aiWorldTurn();
  saveState();
  ensureOverlay();
  if (ownedCount() === world.length) { showVictory(); return; }
  if (ownedCount() === 0) { showDefeat(); return; }
  showMap(win ? t.name + ' secured.' : 'The assault on ' + t.name + ' failed — regroup and try again.');
}

/** Each AI faction may seize one adjacent neutral territory (a slow expansion race against the player). */
function aiWorldTurn() {
  for (const f of [2, 3, 4, 5, 6]) {
    if (!factionTerr(f)) continue;                          // eliminated on the world map
    if (Math.random() < 0.5) continue;
    const frontier: number[] = [];
    for (const t of world) if (t.owner === f) for (const n of t.adj) if (world[n].owner === 0) frontier.push(n);
    if (frontier.length) world[frontier[Math.random() * frontier.length | 0]].owner = f;
  }
}

// ── persistence (survives a reload) ──────────────────────────────────────────
function saveState() { try { localStorage.setItem('nexusConquest', JSON.stringify({ world, active })); } catch { /* ignore */ } }
function loadState(): boolean {
  try {
    const raw = localStorage.getItem('nexusConquest'); if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d.world || !Array.isArray(d.world) || d.world.length !== 12) return false;
    world = d.world; active = !!d.active; inBattle = false; battleTarget = -1; selected = -1;
    return true;
  } catch { return false; }
}

// ── DOM / SVG rendering ───────────────────────────────────────────────────────
function ensureOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.id = 'conquestOverlay';
  overlay.className = 'overlay';
  overlay.style.display = 'none';
  document.body.appendChild(overlay);
}
function hideOverlay() { if (overlay) overlay.style.display = 'none'; }

function showMap(note = '') {
  ensureOverlay();
  const ov = overlay!;
  const owned = ownedCount(), total = world.length, bonus = (owned - 1) * BONUS_PER;
  const colOf = (o: number) => o === 0 ? '#6b7280' : FAC[o].col;
  const lines = world.flatMap(t => t.adj.filter(n => n > t.id).map(n =>
    `<line x1="${t.x}" y1="${t.y}" x2="${world[n].x}" y2="${world[n].y}" stroke="#39414d" stroke-width="2"/>`)).join('');
  const nodes = world.map(t => {
    const sel = t.id === selected;
    const atk = selected >= 0 && world[selected].adj.includes(t.id) && t.owner !== PLAYER;
    const ring = sel ? '#e8b64c' : atk ? '#e8483a' : '#11161d';
    return `<g class="terr" data-id="${t.id}" style="cursor:pointer">
      <circle cx="${t.x}" cy="${t.y}" r="30" fill="${colOf(t.owner)}" stroke="${ring}" stroke-width="${sel || atk ? 5 : 2}"/>
      <text x="${t.x}" y="${t.y + 50}" fill="#cdd6e0" font-size="15" text-anchor="middle" font-family="monospace">${t.name}</text>
      ${t.owner === PLAYER ? `<text x="${t.x}" y="${t.y + 5}" fill="#0a0e14" font-size="16" text-anchor="middle">★</text>` : ''}
    </g>`;
  }).join('');
  const standings = [1, 2, 3, 4, 5, 6].map(f => `<span style="color:${FAC[f].col}">${FAC[f].name.split(' ')[0]} ${factionTerr(f)}</span>`).join(' · ');
  ov.innerHTML = `
    <div class="panelBox" style="max-width:880px;width:94%">
      <h1 style="color:#e8b64c;letter-spacing:.12em">CONQUEST CAMPAIGN</h1>
      <p style="color:#9aa4b2;margin:2px 0 6px">Select one of your ★ territories, then click a bordering enemy or neutral region to invade. Win the battle to claim it. ${note ? '<b style="color:#9ce6a4">' + note + '</b>' : ''}</p>
      <p style="margin:2px 0 8px;font-size:12px">Territories held: <b style="color:#9ce6a4">${owned}/${total}</b> · Reinforcement grant next battle: <b style="color:#e8b64c">+${bonus} cr</b> &nbsp;|&nbsp; ${standings}</p>
      <svg id="cqMap" viewBox="0 0 950 560" style="width:100%;height:auto;background:#0c1118;border:1px solid #2a313c;border-radius:6px">${lines}${nodes}</svg>
      <div style="margin-top:10px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="go" id="cqAttack" ${selected >= 0 ? '' : 'disabled'} style="opacity:${selected >= 0 ? 1 : .4}">${selected >= 0 ? 'PICK A TARGET TO INVADE' : 'SELECT ONE OF YOUR TERRITORIES'}</button>
        <button class="go" id="cqAbandon" style="background:linear-gradient(180deg,#3a414d,#272d36)">ABANDON CAMPAIGN</button>
      </div>
    </div>`;
  ov.style.display = 'flex';
  // wire territory clicks
  ov.querySelectorAll<SVGGElement>('.terr').forEach(g => {
    g.addEventListener('click', () => {
      const id = +g.dataset.id!;
      const t = world[id];
      if (t.owner === PLAYER) { selected = id; showMap(note); }                 // pick your launch territory
      else if (selected >= 0 && world[selected].adj.includes(id)) attack(id);   // invade a bordering region
    });
  });
  (ov.querySelector('#cqAbandon') as HTMLButtonElement).onclick = () => { abandon(); };
}

function showVictory() {
  ensureOverlay();
  overlay!.innerHTML = `<div class="panelBox"><h1 class="win" style="color:#9ce6a4">WORLD CONQUERED</h1>
    <p>Every territory flies your colors, Commander. The continent is yours.</p>
    <button class="go" id="cqNew">NEW CAMPAIGN</button></div>`;
  overlay!.style.display = 'flex';
  (overlay!.querySelector('#cqNew') as HTMLButtonElement).onclick = () => startCampaign(true);
}
function showDefeat() {
  ensureOverlay();
  overlay!.innerHTML = `<div class="panelBox"><h1 class="lose" style="color:#e8483a">CAMPAIGN LOST</h1>
    <p>Your last holding has fallen. The war is over.</p>
    <button class="go" id="cqNew">NEW CAMPAIGN</button></div>`;
  overlay!.style.display = 'flex';
  (overlay!.querySelector('#cqNew') as HTMLButtonElement).onclick = () => startCampaign(true);
}
function abandon() {
  active = false; inBattle = false;
  try { localStorage.removeItem('nexusConquest'); } catch { /* ignore */ }
  hideOverlay();
  const intro = document.getElementById('introOverlay'); if (intro) intro.style.display = 'flex';
}
