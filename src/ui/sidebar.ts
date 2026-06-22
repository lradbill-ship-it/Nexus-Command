import {
  PLAYER, AIS, FAC, B, U, ABILITIES, COVERT, TILE, STYLES,
} from '../sim/constants';
import type { LeaderStyle } from '../sim/constants';
import { game, dip, rk, getRel, isWar, isAllied, stateOf, lastHint, setLogHook, setHintHook } from '../sim/state';
import {
  startPlacing, trainUnit, cancelUnit, tryAbility, runCovert, dipGift, dipTrade, dipAlly, dipWar,
  hasCyber, hasBuilding, powerOf, tradeIncome, waterOf, conscript, housingCap, setLeader,
  setPlatform, campaignRally, launchCoup, nextElectionIn, approvalEst, sellSelected, setAutoScout, getAutoScout,
} from '../sim/sim';

let chosenLeader: LeaderStyle = 'industrialist';
export function getChosenLeader() { return chosenLeader; }

const buildOrder = ['power', 'refinery', 'foundry', 'turret', 'wall', 'gate', 'palisade', 'pump', 'watertower', 'smelter', 'mill', 'habitat', 'market', 'aaturret', 'idome', 'cyber', 'silo', 'drillbay'];
const unitOrder = ['harvester', 'tanker', 'hauler', 'logger', 'repair', 'aegis', 'recon', 'infantry', 'rocket', 'strike', 'artillery', 'walker', 'harrier', 'aircraft', 'hunter', 'borer'];
const covertOrder = ['steal', 'sabotage', 'recon', 'incite'];
const $ = (id: string) => document.getElementById(id)!;

function iconCanvas(kind: 'b' | 'u', type: string): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 40; c.height = 26;
  const g = c.getContext('2d')!; const cx = 20, cy = 13;
  g.strokeStyle = '#9fd9cc'; g.fillStyle = '#1a2735'; g.lineWidth = 1.4;
  if (kind === 'b') {
    if (type === 'power') { g.fillRect(11, 6, 18, 14); g.strokeRect(11, 6, 18, 14); g.fillStyle = '#69d84f'; g.fillRect(15, 9, 3, 8); g.fillRect(22, 9, 3, 8); }
    else if (type === 'refinery') { g.fillRect(9, 7, 22, 12); g.strokeRect(9, 7, 22, 12); g.fillStyle = '#9bd4ff'; g.beginPath(); g.arc(24, 13, 4, 0, 7); g.fill(); }
    else if (type === 'foundry') { g.fillRect(9, 6, 22, 14); g.strokeRect(9, 6, 22, 14); g.fillStyle = '#0a0f15'; g.fillRect(14, 12, 12, 8); }
    else if (type === 'turret') { g.beginPath(); g.arc(cx, cy, 7, 0, 7); g.fill(); g.stroke(); g.strokeStyle = '#cdd9e3'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + 9, cy - 5); g.stroke(); }
    else if (type === 'pump') { g.beginPath(); g.arc(cx, cy, 8, 0, 7); g.fillStyle = 'rgba(127,214,234,.5)'; g.fill(); g.strokeStyle = '#7fd6ea'; g.stroke(); g.beginPath(); g.arc(cx, cy, 4, 0, 7); g.stroke(); }
    else if (type === 'watertower') { g.fillStyle = 'rgba(127,214,234,.55)'; g.beginPath(); g.arc(cx, cy - 2, 6, 0, 7); g.fill(); g.strokeStyle = '#7fd6ea'; g.lineWidth = 1.4; g.stroke(); g.strokeStyle = '#9fb3c2'; g.beginPath(); g.moveTo(15, 21); g.lineTo(17, 8); g.moveTo(25, 21); g.lineTo(23, 8); g.stroke(); }
    else if (type === 'smelter') { g.beginPath(); g.arc(cx, cy, 8, 0, 7); g.fillStyle = 'rgba(224,161,85,.55)'; g.fill(); g.strokeStyle = '#e0a155'; g.stroke(); g.fillStyle = '#2a2018'; g.fillRect(cx + 5, cy - 9, 3, 7); }
    else if (type === 'mill') { g.fillStyle = '#3a4f63'; g.fillRect(12, 11, 16, 9); g.strokeRect(12, 11, 16, 9); g.fillStyle = '#9c7338'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(15 + i * 5, 16, 2.3, 0, 7); g.fill(); } g.strokeStyle = '#cdd9e3'; g.lineWidth = 1.4; g.beginPath(); g.arc(24, 9, 4, 0, 7); g.stroke(); }
    else if (type === 'habitat') { g.fillStyle = '#3a4f63'; g.fillRect(13, 11, 14, 9); g.strokeRect(13, 11, 14, 9); g.fillStyle = '#9fd9cc'; g.beginPath(); g.moveTo(12, 11); g.lineTo(20, 5); g.lineTo(28, 11); g.closePath(); g.stroke(); g.fillStyle = '#69d84f'; g.fillRect(18, 15, 4, 5); }
    else if (type === 'market') { g.fillStyle = '#caa05a'; for (let i = 0; i < 4; i++) { g.fillRect(12 + i * 4, 8, 3, 4); } g.strokeStyle = '#e0c089'; g.strokeRect(12, 12, 16, 8); g.fillStyle = '#9fd9cc'; g.fillRect(14, 14, 3, 4); g.fillRect(23, 14, 3, 4); }
    else if (type === 'aaturret') { g.beginPath(); g.arc(cx, cy, 7, 0, 7); g.fill(); g.stroke(); g.strokeStyle = '#cdd9e3'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 2, cy); g.lineTo(cx + 5, cy - 8); g.moveTo(cx + 2, cy); g.lineTo(cx + 9, cy - 6); g.stroke(); }
    else if (type === 'cyber') { g.beginPath(); g.arc(cx, cy, 8, 0, 7); g.fillStyle = 'rgba(155,111,232,.5)'; g.fill(); g.strokeStyle = '#b07dff'; g.stroke(); }
    else if (type === 'drillbay') { g.fillStyle = '#1a2735'; g.fillRect(12, 11, 16, 9); g.strokeRect(12, 11, 16, 9); g.strokeStyle = '#cdd9e3'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(15, 20); g.lineTo(20, 7); g.lineTo(25, 20); g.stroke(); g.fillStyle = '#9fb3c2'; g.beginPath(); g.moveTo(20, 10); g.lineTo(23, 17); g.lineTo(17, 17); g.closePath(); g.fill(); }
    else if (type === 'silo') { g.fillStyle = '#11161d'; g.beginPath(); g.arc(cx, cy, 8, 0, 7); g.fill(); g.strokeStyle = '#e8b64c'; g.lineWidth = 1.6; g.beginPath(); g.arc(cx, cy, 8, 0, 7); g.stroke(); g.fillStyle = '#cdd9e3'; g.beginPath(); g.arc(cx, cy, 3, 0, 7); g.fill(); g.fillStyle = '#e8483a'; g.beginPath(); g.arc(cx, cy, 1.5, 0, 7); g.fill(); }
    else if (type === 'idome') { g.fillStyle = 'rgba(150,210,255,.6)'; g.beginPath(); g.arc(cx, cy + 3, 8, Math.PI, 0); g.fill(); g.strokeStyle = '#9fdcff'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy + 3, 8, Math.PI, 0); g.stroke(); g.strokeStyle = '#c9d6e0'; g.beginPath(); g.moveTo(cx - 3, cy + 2); g.lineTo(cx - 6, cy - 4); g.moveTo(cx + 3, cy + 2); g.lineTo(cx + 6, cy - 4); g.stroke(); }
    else if (type === 'wall') { g.fillStyle = '#3a4552'; g.fillRect(11, 10, 18, 10); g.strokeStyle = '#9fd9cc'; g.strokeRect(11, 10, 18, 10); g.fillStyle = '#2c3744'; for (let i = 0; i < 4; i++) g.fillRect(12 + i * 5, 6, 3, 4); }
    else if (type === 'gate') { g.fillStyle = '#3a4552'; g.fillRect(10, 8, 6, 12); g.fillRect(24, 8, 6, 12); g.strokeStyle = '#9fd9cc'; g.strokeRect(10, 8, 6, 12); g.strokeRect(24, 8, 6, 12); g.strokeStyle = '#69d84f'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(20, 8); g.lineTo(20, 20); g.stroke(); }
    else if (type === 'palisade') { g.strokeStyle = '#9c7338'; g.lineWidth = 2.4; for (let i = 0; i < 4; i++) { const x = 13 + i * 5; g.beginPath(); g.moveTo(x, 19); g.lineTo(x, 8); g.stroke(); g.fillStyle = '#7a5a2c'; g.beginPath(); g.moveTo(x - 2, 8); g.lineTo(x + 2, 8); g.lineTo(x, 5); g.closePath(); g.fill(); } }
  } else {
    if (type === 'harvester') { g.fillRect(13, 5, 14, 16); g.strokeRect(13, 5, 14, 16); g.fillStyle = '#9bd4ff'; g.fillRect(16, 9, 8, 6); }
    else if (type === 'tanker') { g.fillRect(13, 5, 14, 16); g.strokeRect(13, 5, 14, 16); g.fillStyle = '#7fd6ea'; g.beginPath(); g.arc(20, 13, 5, 0, 7); g.fill(); g.strokeStyle = '#cfeef5'; g.beginPath(); g.moveTo(15, 13); g.lineTo(25, 13); g.stroke(); }
    else if (type === 'hauler') { g.fillRect(13, 5, 14, 16); g.strokeRect(13, 5, 14, 16); g.fillStyle = '#e0a155'; g.fillRect(15, 9, 10, 8); g.fillStyle = '#caa05a'; g.fillRect(16, 8, 3, 2); g.fillRect(21, 8, 3, 2); }
    else if (type === 'logger') { g.fillRect(13, 5, 14, 16); g.strokeRect(13, 5, 14, 16); g.fillStyle = '#9c7338'; for (const [ox, oy] of [[17, 9], [22, 9], [17, 15], [22, 15]]) { g.beginPath(); g.arc(ox, oy, 2.2, 0, 7); g.fill(); } }
    else if (type === 'repair') { g.fillRect(13, 5, 14, 16); g.strokeRect(13, 5, 14, 16); g.fillStyle = '#7fe07f'; g.fillRect(cx - 2, cy - 5, 4, 10); g.fillRect(cx - 5, cy - 2, 10, 4); }
    else if (type === 'recon') { g.strokeStyle = '#cfe6ee'; for (const [rx, ry] of [[-6, -4], [6, -4], [-6, 4], [6, 4]]) { g.beginPath(); g.arc(cx + rx, cy + ry, 3, 0, 7); g.stroke(); } }
    else if (type === 'infantry') { g.fillStyle = '#9fb3c2'; g.beginPath(); g.arc(cx, cy - 4, 3, 0, 7); g.fill(); g.fillStyle = '#2c3744'; g.fillRect(cx - 3, cy - 1, 6, 8); g.strokeStyle = '#cdd9e3'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + 7, cy - 6); g.stroke(); }
    else if (type === 'rocket') { g.fillStyle = '#9fb3c2'; g.beginPath(); g.arc(cx, cy - 4, 3, 0, 7); g.fill(); g.fillStyle = '#2c3744'; g.fillRect(cx - 3, cy - 1, 6, 8); g.strokeStyle = '#e8a33d'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - 4, cy - 1); g.lineTo(cx + 8, cy - 7); g.stroke(); }
    else if (type === 'strike') { g.fillRect(12, 6, 16, 14); g.strokeRect(12, 6, 16, 14); g.strokeStyle = '#cdd9e3'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + 10, cy - 4); g.stroke(); }
    else if (type === 'artillery') { g.fillStyle = '#1a232e'; g.fillRect(10, 6, 3, 14); g.fillRect(27, 6, 3, 14); g.fillStyle = '#1a2735'; g.fillRect(13, 7, 14, 12); g.strokeRect(13, 7, 14, 12); g.strokeStyle = '#aebcc8'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + 12, cy - 7); g.stroke(); }
    else if (type === 'walker') { g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * 7 + 0.5; const px = cx + Math.cos(a) * 8, py = cy + Math.sin(a) * 8; if (i) g.lineTo(px, py); else g.moveTo(px, py); } g.closePath(); g.fill(); g.stroke(); }
    else if (type === 'aircraft') { g.fillStyle = '#1a2735'; g.beginPath(); g.moveTo(cx, cy - 8); g.lineTo(cx + 4, cy + 6); g.lineTo(cx - 4, cy + 6); g.closePath(); g.fill(); g.stroke(); g.strokeStyle = '#cfe6ee'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(cx - 9, cy); g.lineTo(cx + 9, cy); g.stroke(); }
    else if (type === 'harrier') { g.fillStyle = '#1a2735'; g.beginPath(); g.moveTo(cx, cy - 9); g.lineTo(cx + 3, cy + 7); g.lineTo(cx - 3, cy + 7); g.closePath(); g.fill(); g.stroke(); g.strokeStyle = '#cfe6ee'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx - 8, cy + 2); g.lineTo(cx, cy - 3); g.lineTo(cx + 8, cy + 2); g.stroke(); }
    else if (type === 'borer') { g.fillRect(13, 8, 14, 12); g.strokeRect(13, 8, 14, 12); g.fillStyle = '#dde7ef'; g.beginPath(); g.moveTo(20, 2); g.lineTo(25, 8); g.lineTo(15, 8); g.closePath(); g.fill(); g.strokeStyle = '#1a232e'; g.lineWidth = 1; g.beginPath(); g.moveTo(18, 4); g.lineTo(20, 8); g.moveTo(22, 4); g.lineTo(20, 8); g.stroke(); }
    else if (type === 'hunter') { g.fillStyle = '#1a2735'; g.beginPath(); g.moveTo(cx, cy - 8); g.lineTo(cx + 5, cy + 6); g.lineTo(cx - 5, cy + 6); g.closePath(); g.fill(); g.stroke(); g.strokeStyle = '#9ce6a4'; g.lineWidth = 1.4; g.beginPath(); g.arc(cx, cy, 4, 0, 7); g.stroke(); }
    else if (type === 'aegis') { g.fillRect(13, 7, 14, 13); g.strokeRect(13, 7, 14, 13); g.fillStyle = 'rgba(150,210,255,.7)'; g.beginPath(); g.arc(cx, cy, 5, 0, 7); g.fill(); g.strokeStyle = '#9fdcff'; g.lineWidth = 1.3; g.beginPath(); g.arc(cx, cy, 5, 0, 7); g.stroke(); }
  }
  return c;
}

function cmdButton(id: string, icon: HTMLCanvasElement, label: string, cost: string, key?: string): HTMLButtonElement {
  const btn = document.createElement('button'); btn.className = 'cmd'; btn.id = id;
  btn.appendChild(icon);
  const l = document.createElement('span'); l.className = 'lbl'; l.textContent = label; btn.appendChild(l);
  const c = document.createElement('span'); c.className = 'cost'; c.textContent = cost; btn.appendChild(c);
  if (key) { const k = document.createElement('span'); k.className = 'key'; k.textContent = key; btn.appendChild(k); }
  const cd = document.createElement('span'); cd.className = 'cd'; btn.appendChild(cd);
  return btn;
}

let restartHook: () => void = () => {};
export function setRestartHook(fn: () => void) { restartHook = fn; }
let startHook: () => void = () => {};
export function setStartHook(fn: () => void) { startHook = fn; }

/** Create the covert chip + diplomacy row for one faction if they don't exist yet.
 *  Idempotent, so it auto-extends the diplomacy UI to a faction that emerges mid-match (the Free Legion). */
function ensureDipUI(f: number) {
  if (!document.getElementById('chip_' + f)) {
    const btn = document.createElement('button'); btn.id = 'chip_' + f;
    btn.textContent = FAC[f].name.split(' ')[0]; btn.style.borderColor = FAC[f].col;
    btn.onclick = () => { game.covTarget = f; refresh(); };
    $('covChips').appendChild(btn);
  }
  if (!document.getElementById('dip_' + f)) {
    const row = document.createElement('div'); row.className = 'dipRow'; row.id = 'dip_' + f;
    row.innerHTML = `
      <div class="hd"><span class="sw" style="background:${FAC[f].col};color:${FAC[f].col}"></span>
        <span>${FAC[f].name}</span><span class="st" id="dst_${f}">NEUTRAL</span></div>
      <div class="relBar"><div class="mid"></div><div class="fill" id="drel_${f}"></div></div>
      <div class="dipBtns">
        <button id="dg_${f}">GIFT 300</button><button id="dt_${f}">TRADE</button>
        <button id="da_${f}">ALLY</button><button id="dw_${f}">WAR</button>
      </div>`;
    $('dipRows').appendChild(row);
    ($('dg_' + f) as HTMLButtonElement).onclick = () => dipGift(f);
    ($('dt_' + f) as HTMLButtonElement).onclick = () => dipTrade(f);
    ($('da_' + f) as HTMLButtonElement).onclick = () => dipAlly(f);
    ($('dw_' + f) as HTMLButtonElement).onclick = () => dipWar(f);
  }
}

export function makeUI() {
  setLogHook(logMsg); setHintHook((m) => { $('uiHint').textContent = m; });

  const bg = $('buildBtns');
  for (const t of buildOrder) {
    const d = B[t];
    const btn = cmdButton('b_' + t, iconCanvas('b', t), d.name, '▣' + d.cost + (d.alloy ? ' ⬡' + d.alloy : '') + (d.wood ? ' 🪵' + d.wood : ''));
    btn.title = d.desc; btn.onclick = () => startPlacing(t); bg.appendChild(btn);
  }
  const ug = $('unitBtns');
  for (const t of unitOrder) {
    const d = U[t];
    const btn = cmdButton('u_' + t, iconCanvas('u', t), d.name, '▣' + d.cost + (d.alloy ? ' ⬡' + d.alloy : ''));
    btn.title = d.desc + ' · right-click cancels one'; btn.onclick = () => trainUnit(t); btn.oncontextmenu = (e) => { e.preventDefault(); cancelUnit(t); }; ug.appendChild(btn);
  }
  const ag = $('abilityBtns');
  for (const k of Object.keys(ABILITIES)) {
    const a = ABILITIES[k];
    const ic = document.createElement('canvas'); ic.width = 40; ic.height = 26;
    const g = ic.getContext('2d')!; g.strokeStyle = k === 'emp' ? '#96c3ff' : k === 'nuke' ? '#e9a93d' : k === 'thermo' ? '#e8483a' : '#b07dff'; g.lineWidth = 1.6;
    g.beginPath(); g.arc(20, 13, 8, 0, 7); g.stroke(); g.beginPath(); g.arc(20, 13, 4, 0, 7); g.stroke();
    if (k === 'thermo') { g.fillStyle = '#e8483a'; g.beginPath(); g.arc(20, 13, 2, 0, 7); g.fill(); }
    const btn = cmdButton('a_' + k, ic, a.name, '▣' + a.cost + (a.alloy ? ' ⬡' + a.alloy : '') + ' · ' + a.cd + 's', a.key);
    btn.title = a.desc; btn.onclick = () => tryAbility(k); ag.appendChild(btn);
  }
  const cg = $('covBtns');
  for (const k of covertOrder) {
    const m = COVERT[k];
    const ic = document.createElement('canvas'); ic.width = 40; ic.height = 26;
    const g = ic.getContext('2d')!; g.fillStyle = '#9aa6b2'; g.font = '11px monospace'; g.textAlign = 'center'; g.fillText({ steal: '⤓', sabotage: '✸', recon: '◎', incite: '⚔' }[k]!, 20, 17);
    const btn = cmdButton('c_' + k, ic, m.name, '▣' + m.cost + ' · ' + Math.round(m.chance * 100) + '%');
    btn.title = m.desc; btn.onclick = () => runCovert(k); cg.appendChild(btn);
  }
  for (const f of AIS) ensureDipUI(f);   // covert chip + diplomacy row per AI faction (auto-extends to an emergent faction)
  // tabs
  const tabs: [string, string][] = [['tabBase', 'paneBase'], ['tabOps', 'paneOps'], ['tabDip', 'paneDip']];
  for (const [tb, pn] of tabs) {
    $(tb).onclick = () => {
      for (const [tb2, pn2] of tabs) { $(tb2).classList.toggle('on', tb2 === tb); $(pn2).classList.toggle('on', pn2 === pn); }
    };
  }
  // leader doctrine picker (intro overlay)
  const lp = $('leaderPick');
  const renderPick = () => {
    for (const k of Object.keys(STYLES) as LeaderStyle[]) {
      ($('lead_' + k) as HTMLElement)?.classList.toggle('on', chosenLeader === k);
    }
  };
  for (const k of Object.keys(STYLES) as LeaderStyle[]) {
    const sd = STYLES[k];
    const b = document.createElement('button'); b.className = 'lead'; b.id = 'lead_' + k;
    b.style.borderLeftColor = sd.col;
    b.innerHTML = `<b style="color:${sd.col}">${sd.name}</b><span>${sd.blurb}</span>`;
    b.onclick = () => { chosenLeader = k; setLeader(PLAYER, k); renderPick(); };
    lp.appendChild(b);
  }
  renderPick();

  // government: platform selector + campaign / coup
  const pp = $('platformPick');
  for (const k of Object.keys(STYLES) as LeaderStyle[]) {
    const b = document.createElement('button'); b.id = 'plat_' + k; b.textContent = STYLES[k].name;
    b.onclick = () => setPlatform(k); pp.appendChild(b);
  }
  ($('campaignBtn') as HTMLButtonElement).onclick = () => campaignRally();
  ($('coupBtn') as HTMLButtonElement).onclick = () => launchCoup();

  ($('conscriptBtn') as HTMLButtonElement).onclick = () => conscript(PLAYER);
  ($('sellBtn') as HTMLButtonElement).onclick = () => sellSelected();
  ($('autoScoutBtn') as HTMLButtonElement).onclick = () => setAutoScout(!getAutoScout());
  ($('restartBtn') as HTMLButtonElement).onclick = () => restartHook();
  ($('startBtn') as HTMLButtonElement).onclick = () => { $('introOverlay').style.display = 'none'; startHook(); };
  ($('endBtn') as HTMLButtonElement).onclick = () => { $('endOverlay').style.display = 'none'; restartHook(); };
  ($('helpBtn') as HTMLButtonElement).onclick = () => { $('helpOverlay').style.display = 'flex'; };
  ($('helpCloseBtn') as HTMLButtonElement).onclick = () => { $('helpOverlay').style.display = 'none'; };
}

export function logMsg(msg: string, cls?: string) {
  const el = $('log'); const d = document.createElement('div'); if (cls) d.className = cls;
  d.textContent = '› ' + msg; el.prepend(d);
  while (el.children.length > 7) el.lastChild!.remove();
}

export function showEnd(win: boolean) {
  const m = Math.floor(game.t / 60), s = Math.floor(game.t % 60);
  ($('endTitle') as HTMLElement).textContent = win ? 'GRID SECURED' : 'SIGNAL LOST';
  ($('endTitle') as HTMLElement).className = win ? 'win' : 'lose';
  ($('endSub') as HTMLElement).textContent = 'OPERATION TIME ' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  const allies = AIS.filter(f => isAllied(PLAYER, f) && !game.eliminated[f]).map(f => FAC[f].name);
  ($('endText') as HTMLElement).textContent = win
    ? (allies.length ? 'Every rival is rubble. You and ' + allies.join(' & ') + ' control the battlefield.' : 'Every rival network is rubble and static. The grid answers only to you.')
    : 'Your last structure has gone dark. The battlefield belongs to someone else now.';
  $('endOverlay').style.display = 'flex';
}
export function resetOverlays() {
  $('endOverlay').style.display = 'none'; $('log').innerHTML = '';
  // drop any emergent-faction (team >6) diplomacy UI left over from the previous match
  for (const el of Array.from(document.querySelectorAll('[id^="dip_"],[id^="chip_"]'))) {
    const n = +el.id.split('_')[1]; if (n > 6) el.remove();
  }
}

/** Periodic UI sync (credits, power, cooldowns, diplomacy, selection). */
export function refresh() {
  $('uiData').textContent = String(Math.floor(game.money[PLAYER]));
  $('uiDataSide').textContent = String(Math.floor(game.money[PLAYER]));
  const pw = powerOf(PLAYER);
  $('uiPower').textContent = pw.use + '/' + pw.prod;
  $('uiPowerWrap').className = 'pw' + (pw.ok ? '' : ' bad');
  const ti = tradeIncome(PLAYER);
  $('uiTradeWrap').style.display = ti > 0 ? '' : 'none';
  $('uiTrade').textContent = '+' + ti + '/s';
  const w = waterOf(PLAYER);
  $('uiWater').textContent = Math.floor(w.stored) + (w.net >= 0 ? ' +' + w.net : ' ' + w.net) + '/s';
  $('uiWaterWrap').className = 'stat' + (game.overheat[PLAYER] ? ' hot' : '');
  $('uiAlloy').textContent = String(Math.floor(game.alloy[PLAYER] || 0));
  $('uiWood').textContent = String(Math.floor(game.wood[PLAYER] || 0));
  const pop = Math.floor(game.pop[PLAYER] || 0), cap = housingCap(PLAYER), hap = Math.round(game.happy[PLAYER] ?? 60);
  $('uiPop').textContent = String(pop);
  $('uiPopCap').textContent = String(cap);
  $('uiHappyFill').style.width = hap + '%';
  $('uiHappyTxt').textContent = hap > 70 ? 'thriving' : hap > 45 ? 'content' : hap > 25 ? 'restless' : 'in revolt';
  ($('conscriptBtn') as HTMLButtonElement).disabled = pop < 15;
  const asOn = getAutoScout();
  const asBtn = $('autoScoutBtn') as HTMLButtonElement;
  asBtn.textContent = '🔭 AUTO-SCOUT: ' + (asOn ? 'ON' : 'OFF');
  asBtn.style.color = asOn ? '#69d84f' : '#c8d4dc';
  asBtn.style.borderColor = asOn ? '#69d84f' : '#424a56';
  const ld = STYLES[game.leader[PLAYER] || 'industrialist'];
  $('uiLeader').innerHTML = 'LEADER <b style="color:' + ld.col + '">' + ld.name + '</b>';
  // government panel
  const el = nextElectionIn(), ap = Math.round(approvalEst());
  $('uiElection').textContent = Math.floor(el / 60) + ':' + String(Math.floor(el % 60)).padStart(2, '0');
  $('uiApproval').textContent = ap + '%';
  $('uiApprovalFill').style.width = ap + '%';
  for (const k of Object.keys(STYLES) as LeaderStyle[]) {
    ($('plat_' + k) as HTMLElement)?.classList.toggle('on', game.platform[PLAYER] === k);
  }
  ($('campaignBtn') as HTMLButtonElement).disabled = game.money[PLAYER] < 220;
  ($('coupBtn') as HTMLButtonElement).disabled = !hasCyber() || game.money[PLAYER] < 600 || !!game.eliminated[game.covTarget] || isAllied(PLAYER, game.covTarget);
  const m = Math.floor(game.t / 60), s = Math.floor(game.t % 60);
  $('uiTime').textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  if (game.t - lastHint > 5) $('uiHint').textContent = '';

  const hasF = game.buildings.some(b => b.team === PLAYER && b.type === 'foundry' && b.progress >= 1);
  const hc = hasCyber();
  const alloyHave = game.alloy[PLAYER] || 0;
  for (const t of buildOrder) {
    const btn = $('b_' + t) as HTMLButtonElement;
    btn.disabled = game.money[PLAYER] < B[t].cost || (B[t].alloy || 0) > alloyHave;
    btn.classList.toggle('armed', game.placing === t);
  }
  for (const t of unitOrder) {
    const req = U[t].requires;
    ($('u_' + t) as HTMLButtonElement).disabled = !hasF || game.money[PLAYER] < U[t].cost || (U[t].alloy || 0) > alloyHave || (!!req && !hasBuilding(req));
  }
  for (const k of Object.keys(ABILITIES)) {
    const btn = $('a_' + k) as HTMLButtonElement;
    const ab = ABILITIES[k];
    btn.disabled = !hasBuilding(ab.requires || 'cyber') || game.money[PLAYER] < ab.cost || (ab.alloy || 0) > alloyHave || game.cooldowns[k] > 0;
    btn.classList.toggle('armed', game.armed === k);
    (btn.querySelector('.cd') as HTMLElement).style.width = (game.cooldowns[k] > 0 ? game.cooldowns[k] / ab.cd * 100 : 0) + '%';
  }
  for (const k of covertOrder) {
    const btn = $('c_' + k) as HTMLButtonElement;
    btn.disabled = !hc || game.money[PLAYER] < COVERT[k].cost || game.covCd[k] > 0 || !!game.eliminated[game.covTarget] || isAllied(PLAYER, game.covTarget);
    (btn.querySelector('.cd') as HTMLElement).style.width = (game.covCd[k] > 0 ? game.covCd[k] / COVERT[k].cd * 100 : 0) + '%';
  }
  for (const f of AIS) ensureDipUI(f);   // a faction may have emerged mid-match → make sure its chip + row exist
  for (const f of AIS) {
    const c = $('chip_' + f);
    c.classList.toggle('on', game.covTarget === f);
    c.style.color = game.covTarget === f ? FAC[f].col : '';
    const st = stateOf(PLAYER, f), rel = getRel(PLAYER, f);
    const stEl = $('dst_' + f); stEl.textContent = st === 'GONE' ? 'ELIMINATED' : st; stEl.className = 'st ' + st;
    const fill = $('drel_' + f); const pct = Math.abs(rel) / 100 * 50;
    if (rel >= 0) { fill.style.left = '50%'; fill.style.width = pct + '%'; fill.style.background = '#3ec8b4'; }
    else { fill.style.left = (50 - pct) + '%'; fill.style.width = pct + '%'; fill.style.background = '#e8483a'; }
    const gone = st === 'GONE';
    ($('dg_' + f) as HTMLButtonElement).disabled = gone || game.money[PLAYER] < 300;
    const tBtn = $('dt_' + f) as HTMLButtonElement;
    tBtn.disabled = gone || isWar(PLAYER, f); tBtn.classList.toggle('active', !!dip.trade[rk(PLAYER, f)]);
    tBtn.textContent = dip.trade[rk(PLAYER, f)] ? 'TRADE ✓' : 'TRADE';
    const aBtn = $('da_' + f) as HTMLButtonElement;
    aBtn.disabled = gone || isWar(PLAYER, f); aBtn.classList.toggle('active', isAllied(PLAYER, f));
    aBtn.textContent = isAllied(PLAYER, f) ? 'BREAK' : 'ALLY';
    ($('dw_' + f) as HTMLButtonElement).disabled = gone || isWar(PLAYER, f);
  }
  refreshSel();
}

function refreshSel() {
  const el = $('selInfo');
  const sellable = game.selection.filter(s => s.kind === 'b' && (s as any).team === PLAYER) as any[];
  const sellBtn = $('sellBtn') as HTMLButtonElement;
  if (sellable.length) {
    let cr = 0; for (const b of sellable) cr += Math.round(B[b.type].cost * 0.5 * Math.min(1, b.progress));
    sellBtn.style.display = ''; sellBtn.textContent = '✖ SELL STRUCTURE' + (cr ? ' · +' + cr : '');
  } else sellBtn.style.display = 'none';
  if (!game.selection.length) { el.innerHTML = 'Nothing selected.'; return; }
  if (game.selection.length === 1) {
    const sObj = game.selection[0];
    const d: any = sObj.kind === 'b' ? B[(sObj as any).type] : U[(sObj as any).type];
    let extra = '';
    if (sObj.kind === 'b' && (sObj as any).progress < 1) extra = `<br>Constructing ${Math.round((sObj as any).progress * 100)}%`;
    if (sObj.kind === 'b' && (sObj as any).type === 'foundry' && (sObj as any).queue.length) extra = `<br>Queue: ${(sObj as any).queue.length} (${U[(sObj as any).queue[0]].name})`;
    if (sObj.kind === 'u' && U[(sObj as any).type].harvests) extra = `<br>Cargo ${Math.round((sObj as any).cargo)}/${d.cargo} ${d.harvests}`;
    if (sObj.kind === 'u' && U[(sObj as any).type].logs) extra = `<br>Cargo ${Math.round((sObj as any).cargo)}/${d.cargo} wood`;
    const vet = sObj.kind === 'u' ? ((sObj as any).vet || 0) : 0;
    const rank = vet >= 2 ? ' <b style="color:#ffd95a">★ ELITE</b>' : vet >= 1 ? ' <b style="color:#ffd95a">▲ VETERAN</b>' : '';
    el.innerHTML = `<span class="nm">${d.name}</span>${rank}<br>HP ${Math.ceil(sObj.hp)}/${sObj.hpMax}${extra}`;
  } else el.innerHTML = `<span class="nm">${game.selection.length} units</span> in command group`;
}
