import Phaser from 'phaser';
import { BattleScene } from './scene/BattleScene';
import { game, logMsg as stateLog } from './sim/state';
import { makeUI, refresh, showEnd, resetOverlays, setRestartHook, setStartHook, logMsg, getChosenLeader } from './ui/sidebar';
import { setLeader } from './sim/sim';
import { PLAYER } from './sim/constants';
import { initAudio, sfx } from './audio';
import { isInCampaignBattle, onBattleEnd as conquestBattleEnd, setLaunchBattle, startCampaign } from './conquest';

// Guard against duplicate boots (Vite HMR can re-run this module without a full
// page reload, which would otherwise stack multiple Phaser games on one page).
const w = window as unknown as { __nexusGame?: Phaser.Game; __nexusUI?: boolean };
if (w.__nexusGame) w.__nexusGame.destroy(true);

if (!w.__nexusUI) { makeUI(); setInterval(() => refresh(), 130); w.__nexusUI = true; }

const scene = new BattleScene();

w.__nexusGame = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'gameArea',
  backgroundColor: '#0a0e08',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  render: { antialias: true, powerPreference: 'high-performance' },
  scene,
});

scene.setEndHandler((win) => {
  sfx(win ? 'victory' : 'defeat');
  if (isInCampaignBattle()) conquestBattleEnd(win);   // resolve the territory + return to the world map
  else showEnd(win);
});

// Conquest campaign: a battle launched from the world map (carry-over reinforcement bonus + theater name)
setLaunchBattle((bonus, name) => {
  initAudio();
  resetOverlays();
  scene.newMatch(true);
  setLeader(PLAYER, getChosenLeader());
  if (bonus > 0) game.money[PLAYER] += bonus;
  logMsg('Theater: ' + name + '.' + (bonus > 0 ? ' Reinforcement grant +' + bonus + ' credits.' : ''));
  sfx('place');
});

// "CONQUEST CAMPAIGN" button on the intro overlay → open the world map (resume a saved one or start fresh)
const cqBtn = document.getElementById('conquestBtn');
if (cqBtn) cqBtn.onclick = () => { const intro = document.getElementById('introOverlay'); if (intro) intro.style.display = 'none'; startCampaign(false); };

setStartHook(() => {
  initAudio();
  setLeader(PLAYER, getChosenLeader());
  game.started = true;
  logMsg('Uplink established. Five rival coalitions are watching, Commander.');
  sfx('click');
});

setRestartHook(() => {
  initAudio();
  resetOverlays();
  scene.newMatch(true);
  setLeader(PLAYER, getChosenLeader());     // keep the chosen doctrine across new battlefields
  logMsg('New battlefield generated. Deploy your forces, Commander.');
  sfx('place');
});

// keep state's logMsg hook pointed at the live feed even before makeUI hooks bind
void stateLog;

refresh();
