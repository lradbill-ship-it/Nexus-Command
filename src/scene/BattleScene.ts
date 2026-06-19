import Phaser from 'phaser';
import {
  TILE, MAPW, MAPH, WORLD_W, WORLD_H, PLAYER, FAC, B, U, BASE_INFO,
  idx, clamp, dist,
} from '../sim/constants';
import { game, resetState, isAllied } from '../sim/state';
import { resetSimLocals, setupBases, computeVision, canSee, setScorchHook, setEndHook, setClearForestHook, setDryWaterHook, stepWorld, issueOrder, tryPlace, castAbility, canPlaceHere, tryAbility, conscript, sellSelected, spawnParts, pendingStrikeList } from '../sim/sim';
import { generateMap } from '../sim/mapgen';
import { renderTerrain, getTerrainCanvas, scorch, clearForestAt, dryWaterAt, setTerrainTextures, setTreeTextures, terrainDirty, clearTerrainDirty } from '../render/terrain';
import grassTex from '../assets/terrain/grass.jpg?inline';
import rockTex from '../assets/terrain/rock.jpg?inline';
import dirtTex from '../assets/terrain/dirt.jpg?inline';
import pineTex from '../assets/trees/pine.png?inline';
import treeTex from '../assets/trees/tree.png?inline';
import { buildAllTextures, originOf } from '../render/textures';
import { initAudio, sfx, setViewWidth, toggleMute } from '../audio';
import type { Building, Unit, Entity } from '../sim/types';

interface SpriteRec {
  body: Phaser.GameObjects.Image;
  barrel?: Phaser.GameObjects.Image;
  glow?: Phaser.GameObjects.Image;
  dish?: Phaser.GameObjects.Image;     // spinning HQ radar
  rotor?: Phaser.GameObjects.Image;    // spinning rotor disc (aircraft / drone)
  shadow?: Phaser.GameObjects.Image;   // ground shadow for airborne units
}
const ALT = 17;                        // render altitude (px) for flying units
const hasRotor = (t: string) => t === 'aircraft' || t === 'recon' || t === 'hunter';

export class BattleScene extends Phaser.Scene {
  private terrainImg!: Phaser.GameObjects.Image;
  private terrainTex!: Phaser.Textures.CanvasTexture;
  private fogTex!: Phaser.Textures.CanvasTexture;
  private fogImg!: Phaser.GameObjects.Image;
  private fxAdd!: Phaser.GameObjects.Graphics;
  private fxNorm!: Phaser.GameObjects.Graphics;
  private settleGfx!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private vignette!: Phaser.GameObjects.Image;
  private recs = new Map<number, SpriteRec>();
  private crystals = new Map<object, { spr: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image }>();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private dragStart: { x: number; y: number } | null = null;
  private dragging = false;
  private midPan: { x: number; y: number } | null = null;
  private dragScreen: { x: number; y: number } | null = null;   // screen-space anchor for one-finger touch pan
  private pinchDist = 0;
  private twoFingerMid: { x: number; y: number } | null = null;
  private onEnd: (win: boolean) => void = () => {};
  private mm!: HTMLCanvasElement;
  private mmCtx!: CanvasRenderingContext2D;

  constructor() { super('battle'); }

  preload() {
    this.load.image('tex_grass', grassTex);     // CC0 ground textures (ambientCG) — loaded before the first terrain bake
    this.load.image('tex_rock', rockTex);
    this.load.image('tex_dirt', dirtTex);
    this.load.image('tex_pine', pineTex);        // CC0 tree sprites (Kenney foliage)
    this.load.image('tex_tree', treeTex);
  }

  create() {
    buildAllTextures(this);
    setTerrainTextures(                          // hand the loaded source images to the terrain renderer
      this.textures.get('tex_grass').getSourceImage() as HTMLImageElement,
      this.textures.get('tex_rock').getSourceImage() as HTMLImageElement,
      this.textures.get('tex_dirt').getSourceImage() as HTMLImageElement,
    );
    setTreeTextures(
      this.textures.get('tex_pine').getSourceImage() as HTMLImageElement,
      this.textures.get('tex_tree').getSourceImage() as HTMLImageElement,
    );
    setScorchHook(scorch);
    setClearForestHook(clearForestAt);
    setDryWaterHook(dryWaterAt);
    setEndHook((win) => this.onEnd(win));

    this.cameras.main.setBackgroundColor('#0a0e08');
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setZoom(1);

    // layers
    this.terrainImg = this.add.image(0, 0, '__DEFAULT').setOrigin(0, 0).setDepth(-100);
    this.settleGfx = this.add.graphics().setDepth(-40);   // settlements sit on the ground, under units
    this.fxNorm = this.add.graphics().setDepth(9000);
    this.fxAdd = this.add.graphics().setDepth(9001).setBlendMode(Phaser.BlendModes.ADD);
    this.fogImg = this.add.image(0, 0, '__DEFAULT').setOrigin(0, 0).setDepth(10000);
    this.makeVignette();                                   // cinematic edge darkening (screen-space)
    this.overlay = this.add.graphics().setDepth(11000);

    // fog texture (84x84, soft-filtered)
    this.fogTex = this.textures.createCanvas('fog', MAPW, MAPH)!;
    this.fogTex.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.fogImg.setTexture('fog').setDisplaySize(WORLD_W, WORLD_H);

    // minimap
    this.mm = document.getElementById('minimap') as HTMLCanvasElement;
    this.mmCtx = this.mm.getContext('2d')!;
    this.mm.addEventListener('mousedown', (e) => this.minimapJump(e));
    this.mm.addEventListener('mousemove', (e) => { if (e.buttons & 1) this.minimapJump(e); });
    this.mm.addEventListener('touchstart', (e) => { e.preventDefault(); this.minimapJumpTouch(e); }, { passive: false });
    this.mm.addEventListener('touchmove', (e) => { e.preventDefault(); this.minimapJumpTouch(e); }, { passive: false });

    // input
    this.input.mouse?.disableContextMenu();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>;
    this.setupPointer();
    this.setupKeys();

    setViewWidth(this.scale.width);
    this.scale.on('resize', () => { setViewWidth(this.scale.width); this.vignette.setDisplaySize(this.scale.width, this.scale.height); });

    this.newMatch(false);
  }

  setEndHandler(fn: (win: boolean) => void) { this.onEnd = fn; }

  /** Screen-space vignette — subtle edge darkening for cinematic depth. */
  private makeVignette() {
    const key = 'vignette';
    if (!this.textures.exists(key)) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 256;
      const g = c.getContext('2d')!;
      const grd = g.createRadialGradient(128, 128, 64, 128, 128, 184);
      grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.68, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(3,6,9,0.5)');
      g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
      this.textures.addCanvas(key, c);
    }
    this.vignette = this.add.image(0, 0, key).setOrigin(0, 0).setScrollFactor(0).setDepth(10500);
    this.vignette.setDisplaySize(this.scale.width, this.scale.height);
  }

  /** Regenerate a fresh battlefield. start=true skips the intro (used by restart). */
  newMatch(start: boolean) {
    // wipe sprites
    for (const r of this.recs.values()) { r.body.destroy(); r.barrel?.destroy(); r.glow?.destroy(); r.dish?.destroy(); r.rotor?.destroy(); r.shadow?.destroy(); }
    this.recs.clear();
    for (const c of this.crystals.values()) { c.spr.destroy(); c.glow.destroy(); }
    this.crystals.clear();

    resetState();
    resetSimLocals();
    generateMap();
    setupBases();
    computeVision();

    // upload terrain
    renderTerrain();
    if (this.textures.exists('terrain')) this.textures.remove('terrain');
    this.terrainTex = this.textures.addCanvas('terrain', getTerrainCanvas())!;
    clearTerrainDirty();
    this.terrainImg.setTexture('terrain');

    // camera to player's base (SW)
    const bi = BASE_INFO[PLAYER];
    this.cameras.main.setZoom(1);
    this.cameras.main.centerOn((bi.tx + 1) * TILE, (bi.ty + 1) * TILE);

    game.started = start;
    game.selection = [];
  }

  // ── input ────────────────────────────────────────────────────────────────
  private setupPointer() {
    this.input.addPointer(2);                          // enable multi-touch (pinch needs 2 active pointers)
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      initAudio();
      const p1 = this.input.pointer1, p2 = this.input.pointer2;
      if (p1?.isDown && p2?.isDown) {                  // second finger down → start a pinch gesture
        this.pinchDist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        this.twoFingerMid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        this.dragStart = null; this.dragging = false; this.dragScreen = null;
        return;
      }
      if (p.middleButtonDown()) { this.midPan = { x: p.x, y: p.y }; return; }
      if (!game.started || game.over) return;
      if (p.rightButtonDown()) {
        if (game.placing || game.armed) { game.placing = null; game.armed = null; return; }
        issueOrder(p.worldX, p.worldY, false);
      } else if (p.leftButtonDown()) {
        this.dragStart = { x: p.worldX, y: p.worldY };
        this.dragScreen = { x: p.x, y: p.y };
        this.dragging = false;
      }
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1, p2 = this.input.pointer2;
      if (p1?.isDown && p2?.isDown) {                  // two-finger pinch-zoom + pan
        const d = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2, cam = this.cameras.main;
        if (this.pinchDist > 0) {
          cam.setZoom(clamp(cam.zoom * (d / this.pinchDist), 0.4, 2.5));
          if (this.twoFingerMid) { cam.scrollX -= (mx - this.twoFingerMid.x) / cam.zoom; cam.scrollY -= (my - this.twoFingerMid.y) / cam.zoom; }
        }
        this.pinchDist = d; this.twoFingerMid = { x: mx, y: my };
        this.dragStart = null; this.dragging = false;
        return;
      }
      if (this.midPan) {
        const z = this.cameras.main.zoom;
        this.cameras.main.scrollX -= (p.x - this.midPan.x) / z;
        this.cameras.main.scrollY -= (p.y - this.midPan.y) / z;
        this.midPan = { x: p.x, y: p.y };
        return;
      }
      if (this.dragStart && this.dragScreen && p.wasTouch && p.isDown) {   // one-finger drag → pan the map
        const cam = this.cameras.main;
        cam.scrollX -= (p.x - this.dragScreen.x) / cam.zoom;
        cam.scrollY -= (p.y - this.dragScreen.y) / cam.zoom;
        this.dragScreen = { x: p.x, y: p.y };
        this.dragging = true;
        return;
      }
      if (this.dragStart && p.leftButtonDown() && Phaser.Math.Distance.Between(this.dragStart.x, this.dragStart.y, p.worldX, p.worldY) > 8 / this.cameras.main.zoom) this.dragging = true;
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.pinchDist > 0 || this.twoFingerMid) { this.pinchDist = 0; this.twoFingerMid = null; this.dragStart = null; this.dragging = false; this.dragScreen = null; return; }
      if (p.middleButtonReleased()) { this.midPan = null; return; }
      if (!game.started || game.over) { this.dragStart = null; return; }
      if (!p.leftButtonReleased()) return;
      if (game.placing) { tryPlace(p.worldX, p.worldY); this.dragStart = null; this.dragging = false; this.dragScreen = null; return; }
      if (game.armed) { castAbility(game.armed, p.worldX, p.worldY); this.dragStart = null; this.dragging = false; this.dragScreen = null; return; }
      if (p.wasTouch) {
        if (!this.dragging && this.dragStart) {        // a tap (we didn't pan) — select, or command if units are selected
          const wx = p.worldX, wy = p.worldY;
          let hit: Entity | null = null;
          for (const u of game.units) { if (u.team !== PLAYER) continue; if (dist(u, { x: wx, y: wy }) < U[u.type].radius + 10) { hit = u; break; } }
          if (!hit) for (const b of game.buildings) { if (b.team !== PLAYER) continue; if (Math.abs(wx - b.x) < b.w / 2 && Math.abs(wy - b.y) < b.h / 2) { hit = b; break; } }
          if (!hit && game.selection.some(s => s.kind === 'u')) issueOrder(wx, wy, false);
          else { game.selection = hit ? [hit] : []; if (hit) sfx('click'); }
        }
      } else if (this.dragging && this.dragStart) {
        const x1 = Math.min(this.dragStart.x, p.worldX), x2 = Math.max(this.dragStart.x, p.worldX);
        const y1 = Math.min(this.dragStart.y, p.worldY), y2 = Math.max(this.dragStart.y, p.worldY);
        game.selection = game.units.filter(u => u.team === PLAYER && u.x > x1 && u.x < x2 && u.y > y1 && u.y < y2);
        if (game.selection.length) sfx('click');
      } else if (this.dragStart) {
        const wx = p.worldX, wy = p.worldY;
        let hit: Entity | null = null;
        for (const u of game.units) { if (u.team !== PLAYER) continue; if (dist(u, { x: wx, y: wy }) < U[u.type].radius + 6) { hit = u; break; } }
        if (!hit) for (const b of game.buildings) { if (b.team !== PLAYER) continue; if (Math.abs(wx - b.x) < b.w / 2 && Math.abs(wy - b.y) < b.h / 2) { hit = b; break; } }
        game.selection = hit ? [hit] : [];
        if (hit) sfx('click');
      }
      this.dragStart = null; this.dragging = false; this.dragScreen = null;
    });

    this.input.on('wheel', (_p: any, _o: any, _dx: number, dy: number) => {
      const z = clamp(this.cameras.main.zoom * (dy > 0 ? 0.9 : 1.1), 0.4, 2.5);
      this.cameras.main.setZoom(z);
    });
  }

  private setupKeys() {
    const kb = this.input.keyboard!;
    kb.on('keydown', (e: KeyboardEvent) => {
      if (!game.started) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') { game.placing = null; game.armed = null; }
      else if (k === 'e') tryAbility('emp');
      else if (k === 'h') tryAbility('hijack');
      else if (k === 'n') tryAbility('nuke');
      else if (k === 'b') tryAbility('thermo');
      else if (k === 'm') toggleMute();
      else if (k === 't') { if (game.selection.some(s => s.kind === 'u')) game.armed = 'amove'; }
      else if (k === 'c') conscript(PLAYER);
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); sellSelected(); }
      else if (k >= '1' && k <= '9') this.controlGroup(+k, e.ctrlKey || e.metaKey, e.shiftKey);
    });
  }
  private controlGroup(n: number, assign: boolean, add: boolean) {
    if (assign) {
      game.groups[n] = game.selection.filter(s => s.kind === 'u').map(s => s.id);
      sfx('click');
    } else {
      const ids = game.groups[n] || [];
      const units = game.units.filter(u => ids.includes(u.id));
      if (add) for (const u of units) { if (!game.selection.includes(u)) game.selection.push(u); }
      else game.selection = units;
      if (units.length) sfx('click');
    }
  }

  private minimapJump(e: MouseEvent) {
    const r = this.mm.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    this.cameras.main.centerOn(fx * WORLD_W, fy * WORLD_H);
  }
  private minimapJumpTouch(e: TouchEvent) {
    const t = e.touches[0]; if (!t) return;
    const r = this.mm.getBoundingClientRect();
    const fx = (t.clientX - r.left) / r.width, fy = (t.clientY - r.top) / r.height;
    this.cameras.main.centerOn(fx * WORLD_W, fy * WORLD_H);
  }

  // ── main loop ──────────────────────────────────────────────────────────────
  update(_time: number, delta: number) {
    const dt = clamp(delta / 1000, 0, 0.05);
    if (game.started && !game.over) {
      this.panCamera(dt);
      stepWorld(dt);
      if (game.parts.length < 180 && Math.random() < 0.3) {     // faint ambient dust drifting across the view
        const wv = this.cameras.main.worldView;
        spawnParts('mote', wv.x + Math.random() * wv.width, wv.y + Math.random() * wv.height, 1, '198,210,196');
      }
    }
    // sync game.cam for audio panning
    game.cam.x = this.cameras.main.scrollX; game.cam.y = this.cameras.main.scrollY;

    this.syncCrystals();
    this.drawSettlements();
    this.syncEntities();
    this.drawFx();
    this.drawOverlay();
    this.updateFog();
    this.drawMinimap();
    if (terrainDirty()) { this.terrainTex.refresh(); clearTerrainDirty(); }

    // screen shake
    if (game.shake > 0.1) this.cameras.main.setScroll(
      this.cameras.main.scrollX + (Math.random() - 0.5) * game.shake,
      this.cameras.main.scrollY + (Math.random() - 0.5) * game.shake,
    );
  }

  private panCamera(dt: number) {
    const cam = this.cameras.main;
    const sp = 900 * dt;
    const k = this.keys;
    if (k.W.isDown || k.UP.isDown) cam.scrollY -= sp;
    if (k.S.isDown || k.DOWN.isDown) cam.scrollY += sp;
    if (k.A.isDown || k.LEFT.isDown) cam.scrollX -= sp;
    if (k.D.isDown || k.RIGHT.isDown) cam.scrollX += sp;
  }

  // ── entity sprites ─────────────────────────────────────────────────────────
  private setOrigin(img: Phaser.GameObjects.Image, key: string) {
    const o = originOf[key]; if (o) img.setOrigin(o.ox, o.oy);
  }
  private syncEntities() {
    const live = new Set<number>();
    for (const b of game.buildings) { live.add(b.id); this.syncBuilding(b); }
    for (const u of game.units) { live.add(u.id); this.syncUnit(u); }
    for (const [id, r] of this.recs) if (!live.has(id)) { r.body.destroy(); r.barrel?.destroy(); r.glow?.destroy(); r.dish?.destroy(); r.rotor?.destroy(); r.shadow?.destroy(); this.recs.delete(id); }
  }
  private syncBuilding(b: Building) {
    let r = this.recs.get(b.id);
    const key = `b_${b.type}_${b.team}`;
    if (!r) {
      const body = this.add.image(b.x, b.y, key); this.setOrigin(body, key);
      const glow = this.add.image(b.x, b.y, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(Phaser.Display.Color.HexStringToColor(FAC[b.team].col).color);
      r = { body, glow };
      if (b.type === 'turret' || b.type === 'aaturret') { const bk = `t_${b.type}_${b.team}`; r.barrel = this.add.image(b.x, b.y, bk); this.setOrigin(r.barrel, bk); }
      if (b.type === 'hq') { r.dish = this.add.image(b.x, b.y, 'radardish').setTint(Phaser.Display.Color.HexStringToColor(FAC[b.team].col).color); }
      this.recs.set(b.id, r);
    }
    const vis = canSee(b);
    const wv = this.cameras.main.worldView;                          // viewport culling — skip off-screen sprites
    if (!vis || b.x < wv.x - 64 || b.x > wv.right + 64 || b.y < wv.y - 64 || b.y > wv.bottom + 64) {
      r.body.setVisible(false); r.glow?.setVisible(false); r.dish?.setVisible(false); r.barrel?.setVisible(false); return;
    }
    r.body.setVisible(vis).setDepth(b.y);
    // construction look: darken + fade while building
    const built = b.progress >= 1;
    r.body.setAlpha(built ? 1 : 0.55).setTint(built ? 0xffffff : 0x6b7a5a);
    if (r.glow) {
      const pulse = 0.5 + 0.5 * Math.sin(b.anim * 2.4);
      r.glow.setVisible(vis && built).setDepth(b.y + 0.2)
        .setAlpha(0.12 + pulse * 0.16).setDisplaySize(b.w * 0.9, b.h * 0.9)
        .setPosition(b.x, b.y - B[b.type].hgt * 0.3);
    }
    if (r.dish) {
      r.dish.setVisible(vis && built).setDepth(b.y + 0.5)
        .setPosition(b.x, b.y - B[b.type].hgt * 0.55).setRotation(game.t * 0.9);
    }
    if (r.barrel) {
      r.barrel.setVisible(vis && built).setDepth(b.y + 0.4)
        .setPosition(b.x, b.y - B[b.type].hgt * 0.5).setRotation(b.aim + Math.PI / 2);
    }
  }
  private syncUnit(u: Unit) {
    let r = this.recs.get(u.id);
    const key = `u_${u.type}_${u.team}`;
    const hasBarrel = u.type === 'strike' || u.type === 'walker' || u.type === 'artillery';
    if (!r) {
      const body = this.add.image(u.x, u.y, key); this.setOrigin(body, key);
      r = { body };
      if (hasBarrel) { const bk = `t_${u.type}_${u.team}`; r.barrel = this.add.image(u.x, u.y, bk); this.setOrigin(r.barrel, bk); }
      if (hasRotor(u.type)) r.rotor = this.add.image(u.x, u.y, 'rotor').setBlendMode(Phaser.BlendModes.ADD);
      if (U[u.type].air) r.shadow = this.add.image(u.x, u.y, 'airshadow');
      this.recs.set(u.id, r);
    } else if (r.body.texture.key !== key) {
      // team changed (hijack) — reskin
      r.body.setTexture(key); this.setOrigin(r.body, key);
      if (r.barrel && hasBarrel) { const bk = `t_${u.type}_${u.team}`; r.barrel.setTexture(bk); this.setOrigin(r.barrel, bk); }
    }
    const vis = canSee(u);
    const wv = this.cameras.main.worldView;                          // viewport culling — skip off-screen sprites
    if (!vis || u.x < wv.x - 48 || u.x > wv.right + 48 || u.y < wv.y - 48 || u.y > wv.bottom + 48) {
      r.body.setVisible(false); r.barrel?.setVisible(false); r.rotor?.setVisible(false); r.shadow?.setVisible(false); return;
    }
    const air = !!U[u.type].air;
    const bob = Math.sin(game.t * 3 + u.bob) * (air ? 2.5 : 1.5);
    const dy = u.y - (air ? ALT : 0) + bob;       // airborne units float above the deck
    const depth = air ? u.y + 4000 : u.y;         // …and draw above ground entities
    r.body.setVisible(vis).setDepth(depth).setPosition(u.x, dy).setRotation(u.facing + Math.PI / 2)
      .setAlpha((u.tunnelT ?? 0) > 0 ? 0.3 : u.disabledUntil > game.t ? 0.6 : 1);   // faded while burrowing underground
    if (r.shadow) r.shadow.setVisible(vis).setDepth(u.y - 1).setPosition(u.x, u.y).setScale(0.8).setAlpha(0.45);
    if (r.barrel) r.barrel.setVisible(vis).setDepth(depth + 0.5).setPosition(u.x, dy).setRotation(u.aim + Math.PI / 2);
    if (r.rotor) r.rotor.setVisible(vis).setDepth(depth + 0.6).setPosition(u.x, dy).setRotation(game.t * 22)
      .setScale(u.type === 'aircraft' ? 1 : 0.6).setAlpha(0.5);
  }

  private drawSettlements() {
    const g = this.settleGfx; g.clear();
    for (const s of game.settlements) {
      const tx = s.x / TILE | 0, ty = s.y / TILE | 0;
      if (!game.explored[idx(tx, ty)]) continue;                  // hidden in unexplored fog
      const dim = !game.visible[idx(tx, ty)];                     // explored-but-not-visible → faded
      const a = dim ? 0.5 : 1;
      const nHuts = Math.min(12, 5 + (s.pop / 5 | 0));            // bigger population → bigger town
      const ringR = 16 + nHuts;
      // faint ground footprint so a town reads clearly on the map
      g.fillStyle(0x4a4636, a * 0.5); g.fillCircle(s.x, s.y, ringR - 2);
      // cluster of huts (golden-angle scatter, seeded), sized by population
      for (let i = 0; i < nHuts; i++) {
        const ang = i * 2.39996 + s.seed * 6.283;
        const rad = 4 + (i % 4) * 5;
        const ox = Math.cos(ang) * rad, oy = Math.sin(ang) * rad * 0.8;
        g.fillStyle(0x6b5436, a); g.fillRect(s.x + ox - 5, s.y + oy - 3, 10, 8);
        g.fillStyle(0x9a8050, a * 0.9); g.fillRect(s.x + ox - 6, s.y + oy - 5, 12, 3);   // roof
      }
      // flag — neutral grey, else owner colour
      const col = s.owner ? Phaser.Display.Color.HexStringToColor(FAC[s.owner].col).color : 0xb8bcc4;
      g.lineStyle(1.5, 0x2a2018, a); g.lineBetween(s.x + ringR - 4, s.y - 18, s.x + ringR - 4, s.y - 2);
      g.fillStyle(col, a); g.fillTriangle(s.x + ringR - 4, s.y - 18, s.x + ringR - 4, s.y - 10, s.x + ringR + 6, s.y - 14);
      // ownership ring / capture progress — clearer "where & whose"
      if (s.capT > 0.02 && s.capBy) {
        const cc = Phaser.Display.Color.HexStringToColor(FAC[s.capBy].col).color;
        g.lineStyle(2.5, cc, 0.95); g.beginPath();
        g.arc(s.x, s.y, ringR, -Math.PI / 2, -Math.PI / 2 + s.capT * Math.PI * 2); g.strokePath();
      } else {
        g.lineStyle(1.5, col, a * (s.owner ? 0.85 : 0.55)); g.strokeCircle(s.x, s.y, ringR);
      }
    }
    // Command Relays — taller beacons with a pulsing owner-coloured halo
    for (const r of game.relays) {
      const tx = r.x / TILE | 0, ty = r.y / TILE | 0;
      if (!game.explored[idx(tx, ty)]) continue;
      const a = game.visible[idx(tx, ty)] ? 1 : 0.5;
      const col = r.owner ? Phaser.Display.Color.HexStringToColor(FAC[r.owner].col).color : 0xcfe6ee;
      const pulse = 0.5 + 0.5 * Math.sin(game.t * 2.5 + r.pulse);
      g.fillStyle(col, a * (0.10 + pulse * 0.14)); g.fillCircle(r.x, r.y, 22);             // halo
      g.fillStyle(0x141a22, a); g.fillRect(r.x - 6, r.y - 4, 12, 10);                      // base
      g.fillStyle(col, a); g.fillTriangle(r.x, r.y - 22, r.x - 6, r.y - 4, r.x + 6, r.y - 4); // obelisk
      g.fillStyle(0xffffff, a * (0.4 + pulse * 0.5)); g.fillCircle(r.x, r.y - 16, 2.2);    // beacon light
      g.lineStyle(2, col, a * 0.8); g.strokeCircle(r.x, r.y, 22);
      if (r.owner && r.hp < r.hpMax) {                                                      // "hold" damage ring — shrinks as you shoot it offline
        const f = Math.max(0, r.hp / r.hpMax);
        g.lineStyle(3, 0xe8483a, a * 0.9); g.beginPath();
        g.arc(r.x, r.y, 25, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); g.strokePath();
      }
      if (r.capT > 0.02 && r.capBy) {
        const cc = Phaser.Display.Color.HexStringToColor(FAC[r.capBy].col).color;
        g.lineStyle(3, cc, 0.95); g.beginPath();
        g.arc(r.x, r.y, 25, -Math.PI / 2, -Math.PI / 2 + r.capT * Math.PI * 2); g.strokePath();
      }
    }
    // Hero Vaults — shown only once surveyed: a glowing shaft buried in the rock, with dig progress
    for (const v of game.vaults) {
      if (!v.discovered) continue;
      const tint = v.archetype === 'titan' ? 0xe8a33d : v.archetype === 'siegelord' ? 0xb07dff : 0x6fe08a;
      const pulse = 0.5 + 0.5 * Math.sin(game.t * 2.2 + v.pulse);
      g.fillStyle(tint, 0.12 + pulse * 0.16); g.fillCircle(v.x, v.y, 20);             // glow
      g.fillStyle(0x0a0e14, 0.9); g.fillCircle(v.x, v.y, 13);                         // shaft mouth
      g.lineStyle(2, tint, 0.85); g.strokeCircle(v.x, v.y, 13);
      if (v.done) { g.lineStyle(2, tint, 0.45); g.strokeCircle(v.x, v.y, 7); }        // emptied vault
      else if (v.digT > 0.001) {                                                      // excavation progress
        g.lineStyle(3, tint, 0.95); g.beginPath();
        g.arc(v.x, v.y, 17, -Math.PI / 2, -Math.PI / 2 + v.digT * Math.PI * 2); g.strokePath();
      }
      g.fillStyle(tint, 0.9); g.fillCircle(v.x, v.y, 3 + pulse * 1.6);                // core gem
    }
  }

  private syncCrystals() {
    const live = new Set<object>();
    for (const n of game.nodes) {
      if (n.amount <= 0) continue;
      live.add(n);
      let c = this.crystals.get(n);
      if (!c) {
        const tint = n.kind === 'coolant' ? 0x7fe6f0 : n.kind === 'alloy' ? 0xe0a155 : 0x9bd4ff;
        const glow = this.add.image(n.x, n.y, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(tint).setDepth(-51);
        const spr = this.add.image(n.x, n.y, n.kind).setDepth(-50);   // texture key == kind ('crystal'|'coolant'|'alloy')
        c = { spr, glow }; this.crystals.set(n, c);
      }
      const p = 0.6 + 0.4 * Math.sin(game.t * 2 + n.pulse);
      const sc = 0.6 + 0.5 * (n.amount / n.max);
      c.spr.setScale(sc);
      c.glow.setAlpha(0.3 * p).setDisplaySize(34 * sc, 34 * sc).setRotation(game.t * 0.2);
    }
    for (const [n, c] of this.crystals) if (!live.has(n)) { c.spr.destroy(); c.glow.destroy(); this.crystals.delete(n); }
  }

  // ── FX (shots, particles, explosions) ───────────────────────────────────────
  private drawFx() {
    const a = this.fxAdd, n = this.fxNorm;
    a.clear(); n.clear();
    for (const s of game.shots) {
      if (!s.target) continue;
      const ang = Math.atan2(s.target.y - s.y, s.target.x - s.x);
      const len = s.rail ? 22 : 11;
      const x0 = s.x - Math.cos(ang) * len, y0 = s.y - Math.sin(ang) * len;
      const col = Phaser.Display.Color.HexStringToColor(s.col).color;
      a.lineStyle(s.rail ? 5 : 3, col, 0.35); a.beginPath(); a.moveTo(x0, y0); a.lineTo(s.x, s.y); a.strokePath();
      a.lineStyle(s.rail ? 2 : 1.2, 0xffffff, 0.95); a.beginPath(); a.moveTo(x0, y0); a.lineTo(s.x, s.y); a.strokePath();
      a.fillStyle(col, 0.5); a.fillCircle(s.x, s.y, s.rail ? 5 : 3.4);                  // tracer head glow
      a.fillStyle(0xffffff, 0.95); a.fillCircle(s.x, s.y, s.rail ? 2.4 : 1.7);
    }
    for (const p of game.parts) {
      const k = 1 - p.t / p.life;
      if (p.type === 'ring') {
        const r = (p.big ? 16 : 9) + p.t * (p.big ? 170 : 95);
        a.lineStyle(3, 0xffb46e, k); a.strokeCircle(p.x, p.y, r);
      } else if (p.type === 'shock') {
        const r = 20 + p.t * 96;                                                        // slower outer shockwave
        a.lineStyle(2, 0xfff0d2, k * 0.55); a.strokeCircle(p.x, p.y, r);
      } else if (p.type === 'emp') {
        const r = p.t / p.life * 132;
        a.lineStyle(2, 0x96c3ff, k); a.strokeCircle(p.x, p.y, r); a.strokeCircle(p.x, p.y, r * 0.55);
      } else if (p.type === 'flash') {
        a.fillStyle(0xffffff, k); a.fillCircle(p.x, p.y, (p.big ? 26 : 13) * (0.5 + p.t / p.life));
      } else if (p.type === 'mote') {
        const c = Phaser.Display.Color.RGBStringToColor('rgb(' + (p.rgb || '200,210,200') + ')').color;
        a.fillStyle(c, 0.13 * k); a.fillCircle(p.x, p.y, (p.size || 1) + 0.3);          // faint ambient drift
      } else if (p.type === 'smoke' || p.type === 'steam') {
        const c = Phaser.Display.Color.RGBStringToColor('rgb(' + (p.rgb || '90,90,100') + ')').color;
        n.fillStyle(c, 0.3 * k); n.fillCircle(p.x, p.y, (p.size || 6) * (1 + p.t));
      } else if (p.type === 'debris') {
        const c = Phaser.Display.Color.RGBStringToColor('rgb(' + (p.rgb || '120,120,128') + ')').color;
        n.fillStyle(c, k); n.fillCircle(p.x, p.y, (p.size || 2) * k + 0.5);
      } else { // muzzle, spark, fire, mote
        const c = Phaser.Display.Color.RGBStringToColor('rgb(' + (p.rgb || '255,235,180') + ')').color;
        a.fillStyle(c, k); a.fillCircle(p.x, p.y, (p.size || 2) * k + 0.5);
      }
    }
  }

  // ── overlay (selection, hp, placement ghost, marquee) ───────────────────────
  private drawOverlay() {
    const g = this.overlay; g.clear();
    const drawHp = (x: number, y: number, w: number, f: number, col: number) => {
      g.fillStyle(0x000000, 0.7); g.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
      const c = f > 0.5 ? col : (f > 0.25 ? 0xe9a93d : 0xe8483a);
      g.fillStyle(c, 1); g.fillRect(x - w / 2, y, w * f, 3);
    };
    const drawBr = (x: number, y: number, r: number) => {
      g.lineStyle(1.6, 0xffffff, 0.85);
      const c = r * 0.5, pp = Math.sin(game.t * 5) * 1.5, rr = r + pp;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        g.beginPath(); g.moveTo(x + sx * rr, y + sy * (rr - c)); g.lineTo(x + sx * rr, y + sy * rr); g.lineTo(x + sx * (rr - c), y + sy * rr); g.strokePath();
      }
    };
    const sel = new Set(game.selection);
    for (const b of game.buildings) {
      if (!canSee(b)) continue;
      const col = Phaser.Display.Color.HexStringToColor(FAC[b.team].col).color;
      if (b.progress < 1) {
        g.fillStyle(0x000000, 0.5); g.fillRect(b.x - b.w / 2, b.y - b.h / 2 - 9, b.w, 4);
        g.fillStyle(0xe9a93d, 1); g.fillRect(b.x - b.w / 2, b.y - b.h / 2 - 9, b.w * b.progress, 4);
      } else if (b.type === 'foundry' && b.queue.length) {
        const f = b.queueT / U[b.queue[0]].buildTime;
        g.fillStyle(0x000000, 0.5); g.fillRect(b.x - 14, b.y + b.h * 0.32, 28, 4);
        g.fillStyle(col, 1); g.fillRect(b.x - 14, b.y + b.h * 0.32, 28 * f, 4);
      }
      if (b.hp < b.hpMax || sel.has(b)) drawHp(b.x, b.y - b.h / 2 - B[b.type].hgt * 0.4 - 6, b.w * 0.85, b.hp / b.hpMax, col);
      if (sel.has(b)) drawBr(b.x, b.y, Math.max(b.w, b.h) / 2 + 5);
      if (sel.has(b) && b.type === 'idome') { g.lineStyle(1.5, 0x9fdcff, 0.5); g.strokeCircle(b.x, b.y, 7 * TILE); }   // intercept coverage
      if (sel.has(b) && b.type === 'foundry' && b.rally) {
        g.lineStyle(1, 0x3ec8b4, 0.6); g.lineBetween(b.x, b.y, b.rally.x, b.rally.y);
        g.fillStyle(0x3ec8b4, 0.8); g.fillCircle(b.rally.x, b.rally.y, 4);
      }
    }
    for (const u of game.units) {
      if (!canSee(u)) continue;
      const d = U[u.type], col = Phaser.Display.Color.HexStringToColor(FAC[u.team].col).color;
      if (sel.has(u)) drawBr(u.x, u.y, d.radius + 7);
      if (sel.has(u) && d.shield) { g.lineStyle(1.5, 0x9fdcff, 0.5); g.strokeCircle(u.x, u.y, 5.5 * TILE); }   // Aegis intercept coverage
      if (u.hp < u.hpMax || sel.has(u)) drawHp(u.x, u.y - d.radius - 9, 22, u.hp / u.hpMax, col);
      if ((d.harvests || d.logs) && u.cargo > 0) {
        const f = u.cargo / d.cargo!;
        const cc = d.logs ? 0x9ec24f : d.harvests === 'coolant' ? 0x7fe6f0 : d.harvests === 'alloy' ? 0xe0a155 : 0x9bd4ff;
        g.fillStyle(cc, 0.85); g.fillRect(u.x - 6, u.y + d.radius + 2, 12 * f, 2);
      }
    }
    // placement ghost
    if (game.placing) {
      const d = B[game.placing], p = this.input.activePointer;
      const tx = Math.round(p.worldX / TILE - d.w / 2), ty = Math.round(p.worldY / TILE - d.h / 2);
      const ok = canPlaceHere(game.placing, tx, ty);
      g.fillStyle(ok ? 0x3ec8b4 : 0xe8483a, 0.2); g.fillRect(tx * TILE, ty * TILE, d.w * TILE, d.h * TILE);
      g.lineStyle(2, ok ? 0x3ec8b4 : 0xe8483a, 1); g.strokeRect(tx * TILE, ty * TILE, d.w * TILE, d.h * TILE);
    }
    if (game.armed === 'emp') {
      const p = this.input.activePointer;
      g.lineStyle(2, 0x96c3ff, 0.7); g.strokeCircle(p.worldX, p.worldY, 132);
    }
    // marquee
    if (this.dragging && this.dragStart) {
      const p = this.input.activePointer;
      g.lineStyle(1, 0x3ec8b4, 0.9); g.fillStyle(0x3ec8b4, 0.07);
      const x = Math.min(this.dragStart.x, p.worldX), y = Math.min(this.dragStart.y, p.worldY);
      const w = Math.abs(p.worldX - this.dragStart.x), h = Math.abs(p.worldY - this.dragStart.y);
      g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h);
    }
    // inbound-missile warning reticles (pulsing target rings at each in-flight strike)
    for (const s of pendingStrikeList()) {
      const big = s.kind === 'thermo';
      const col = big ? 0xff3030 : 0xffa040;
      const pulse = 0.45 + 0.55 * Math.abs(Math.sin(game.t * 6));
      const r = big ? 64 : 34;
      g.lineStyle(big ? 3 : 2, col, pulse);
      g.strokeCircle(s.x, s.y, r); g.strokeCircle(s.x, s.y, r * 0.55);
      g.lineBetween(s.x - r * 1.2, s.y, s.x + r * 1.2, s.y); g.lineBetween(s.x, s.y - r * 1.2, s.x, s.y + r * 1.2);
    }
  }

  // ── fog texture ──────────────────────────────────────────────────────────────
  private updateFog() {
    const ctx = this.fogTex.context;
    const img = ctx.getImageData(0, 0, MAPW, MAPH);
    const px = img.data;
    for (let i = 0; i < MAPW * MAPH; i++) {
      const o = i * 4; px[o] = 2; px[o + 1] = 4; px[o + 2] = 3;
      px[o + 3] = game.visible[i] ? 0 : (game.explored[i] ? 125 : 255);
    }
    ctx.putImageData(img, 0, 0);
    this.fogTex.refresh();
  }

  // ── minimap ──────────────────────────────────────────────────────────────────
  private drawMinimap() {
    const ctx = this.mmCtx, s = this.mm.width / MAPW;
    ctx.fillStyle = '#04070c'; ctx.fillRect(0, 0, this.mm.width, this.mm.height);
    ctx.fillStyle = '#1a2b1e';
    for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) if (game.explored[idx(x, y)]) ctx.fillRect(x * s, y * s, s + 0.5, s + 0.5);
    for (const nd of game.nodes) if (nd.amount > 0 && game.explored[idx(nd.x / TILE | 0, nd.y / TILE | 0)]) {
      ctx.fillStyle = nd.kind === 'coolant' ? '#7fe6f0' : nd.kind === 'alloy' ? '#e0a155' : '#9bd4ff';
      ctx.fillRect(nd.x / TILE * s - 1, nd.y / TILE * s - 1, 3, 3);
    }
    for (const b of game.buildings) { if (!canSee(b)) continue; ctx.fillStyle = FAC[b.team].col; ctx.fillRect(b.tx * s, b.ty * s, B[b.type].w * s, B[b.type].h * s); }
    for (const u of game.units) { if (!canSee(u)) continue; ctx.fillStyle = FAC[u.team].col; ctx.fillRect(u.x / TILE * s - 1, u.y / TILE * s - 1, 2.4, 2.4); }
    // settlements (square markers: grey neutral, else owner colour)
    for (const st of game.settlements) {
      if (!game.explored[idx(st.x / TILE | 0, st.y / TILE | 0)]) continue;
      ctx.fillStyle = st.owner ? FAC[st.owner].col : '#b8bcc4';
      ctx.fillRect(st.x / TILE * s - 2.5, st.y / TILE * s - 2.5, 5, 5);
    }
    // command relays (bright ringed markers)
    for (const r of game.relays) {
      if (!game.explored[idx(r.x / TILE | 0, r.y / TILE | 0)]) continue;
      const mx = r.x / TILE * s, my = r.y / TILE * s;
      ctx.fillStyle = r.owner ? FAC[r.owner].col : '#cfe6ee';
      ctx.beginPath(); ctx.arc(mx, my, 2.6, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.arc(mx, my, 3.6, 0, 7); ctx.stroke();
    }
    // hero vaults (discovered) — archetype-tinted diamond markers
    for (const v of game.vaults) {
      if (!v.discovered) continue;
      const mx = v.x / TILE * s, my = v.y / TILE * s;
      ctx.fillStyle = v.archetype === 'titan' ? '#e8a33d' : v.archetype === 'siegelord' ? '#b07dff' : '#6fe08a';
      ctx.beginPath(); ctx.moveTo(mx, my - 3.4); ctx.lineTo(mx + 3.4, my); ctx.lineTo(mx, my + 3.4); ctx.lineTo(mx - 3.4, my); ctx.closePath(); ctx.fill();
    }
    // camera viewport box
    const cam = this.cameras.main;
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1;
    ctx.strokeRect(cam.scrollX / WORLD_W * this.mm.width, cam.scrollY / WORLD_H * this.mm.height,
      cam.worldView.width / WORLD_W * this.mm.width, cam.worldView.height / WORLD_H * this.mm.height);
  }
}
