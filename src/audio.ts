import { game } from './sim/state';
import { clamp } from './sim/constants';

// Stereo positional audio: noise-buffer impacts, StereoPanner per source,
// master compressor, low ambient wind bed. Ported from wip-v3/p1-core.html.
let AC: AudioContext | null = null;
let masterG: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
export let muted = false;
const sfxLast: Record<string, number> = {};
let viewW = 1280;

export function setViewWidth(w: number) { viewW = w; }
export function toggleMute() { muted = !muted; return muted; }

export function initAudio() {
  if (AC) return;
  try {
    AC = new (window.AudioContext || (window as any).webkitAudioContext)();
    masterG = AC.createGain();
    masterG.gain.value = 0.9;
    const comp = AC.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 6;
    masterG.connect(comp); comp.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    // ambient wind bed
    const amb = AC.createBufferSource(); amb.buffer = noiseBuf; amb.loop = true;
    const af = AC.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 170;
    const ag = AC.createGain(); ag.gain.value = 0.014;
    amb.connect(af); af.connect(ag); ag.connect(masterG); amb.start();
  } catch (e) { /* audio unavailable */ }
}

function panFor(x?: number) {
  if (x === undefined) return 0;
  return clamp(((x - game.cam.x) - viewW / 2) / (viewW * 0.65), -1, 1);
}
function chain(nodes: AudioNode[], pan: number) {
  let p: StereoPannerNode | null = null;
  try { p = AC!.createStereoPanner(); p.pan.value = pan; } catch (e) { /* no panner */ }
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  const tail = nodes[nodes.length - 1];
  if (p) { tail.connect(p); p.connect(masterG!); } else tail.connect(masterG!);
}
function noiseHit(pan: number, { dur = 0.5, f0 = 900, f1 = 110, vol = 0.4, type = 'lowpass' as BiquadFilterType } = {}) {
  const t = AC!.currentTime;
  const src = AC!.createBufferSource(); src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const flt = AC!.createBiquadFilter(); flt.type = type;
  flt.frequency.setValueAtTime(f0, t);
  flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur * 0.85);
  const g = AC!.createGain();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  chain([src, flt, g], pan); src.start(t); src.stop(t + dur + 0.02);
}
function tone(pan: number, { w = 'sine' as OscillatorType, f0 = 440, f1 = null as number | null, dur = 0.2, vol = 0.06, delay = 0 } = {}) {
  const t = AC!.currentTime + delay;
  const o = AC!.createOscillator(); o.type = w;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur * 0.85);
  const g = AC!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  chain([o, g], pan); o.start(t); o.stop(t + dur + 0.03);
}

export function sfx(type: string, x?: number) {
  if (muted || !AC) return;
  const now = performance.now();
  const minGap = ({ shot: 45, boom: 70, cash: 120 } as Record<string, number>)[type] || 30;
  if (sfxLast[type] && now - sfxLast[type] < minGap) return;
  sfxLast[type] = now;
  const pan = panFor(x);
  try {
    switch (type) {
      case 'shot':
        noiseHit(pan, { dur: 0.07, f0: 2400, f1: 900, vol: 0.05, type: 'bandpass' });
        tone(pan, { w: 'square', f0: 520, f1: 170, dur: 0.06, vol: 0.025 }); break;
      case 'rail':
        noiseHit(pan, { dur: 0.12, f0: 3600, f1: 500, vol: 0.07, type: 'bandpass' });
        tone(pan, { w: 'triangle', f0: 2300, f1: 210, dur: 0.14, vol: 0.05 });
        tone(pan, { w: 'sine', f0: 130, f1: 55, dur: 0.18, vol: 0.07 }); break;
      case 'boom':
        // sharp crack transient + punchy short body + tight low thump (no long farty descending sweep)
        noiseHit(pan, { dur: 0.11, f0: 7000, f1: 1800, vol: 0.16, type: 'highpass' });
        noiseHit(pan, { dur: 0.3, f0: 2200, f1: 240, vol: 0.44, type: 'lowpass' });
        tone(pan, { w: 'triangle', f0: 170, f1: 58, dur: 0.17, vol: 0.3 }); break;
      case 'bigboom':
        noiseHit(pan, { dur: 1.0, f0: 800, f1: 60, vol: 0.6 });
        tone(pan, { w: 'sine', f0: 85, f1: 30, dur: 0.8, vol: 0.5 });
        noiseHit(pan, { dur: 0.3, f0: 6000, f1: 1200, vol: 0.12, type: 'highpass' }); break;
      case 'emp':
        tone(pan, { w: 'sawtooth', f0: 75, f1: 1400, dur: 0.45, vol: 0.07 });
        noiseHit(pan, { dur: 0.4, f0: 5000, f1: 9000, vol: 0.03, type: 'highpass' }); break;
      case 'click': tone(0, { w: 'sine', f0: 660, dur: 0.045, vol: 0.05 }); break;
      case 'place':
        tone(0, { w: 'sine', f0: 330, f1: 220, dur: 0.12, vol: 0.07 });
        noiseHit(0, { dur: 0.1, f0: 700, f1: 200, vol: 0.06 }); break;
      case 'cash':
        tone(pan, { w: 'square', f0: 880, dur: 0.05, vol: 0.025 });
        tone(pan, { w: 'square', f0: 1320, dur: 0.07, vol: 0.025, delay: 0.05 }); break;
      case 'chime':
        tone(0, { w: 'sine', f0: 660, dur: 0.22, vol: 0.05 });
        tone(0, { w: 'sine', f0: 990, dur: 0.3, vol: 0.045, delay: 0.09 }); break;
      case 'war':
        tone(0, { w: 'square', f0: 330, dur: 0.16, vol: 0.055 });
        tone(0, { w: 'square', f0: 262, dur: 0.22, vol: 0.055, delay: 0.18 }); break;
      case 'covert': tone(pan, { w: 'triangle', f0: 360, f1: 120, dur: 0.2, vol: 0.05 }); break;
    }
  } catch (e) { /* ignore */ }
}
