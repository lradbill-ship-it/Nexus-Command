import Phaser from 'phaser';
import { BattleScene } from './scene/BattleScene';
import { game, logMsg as stateLog } from './sim/state';
import { makeUI, refresh, showEnd, resetOverlays, setRestartHook, setStartHook, logMsg, getChosenLeader } from './ui/sidebar';
import { setLeader } from './sim/sim';
import { PLAYER } from './sim/constants';
import { initAudio, sfx } from './audio';

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

scene.setEndHandler((win) => { showEnd(win); sfx(win ? 'chime' : 'war'); });

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
