
/* =====================================================================
   TERRAIN PRE-RENDER — painted natural battlefield
   ===================================================================== */
const terrain=document.createElement('canvas');
terrain.width=WORLD_W;terrain.height=WORLD_H;
const tg=terrain.getContext('2d');
function shade(rgb,k){return `rgb(${rgb.map(c=>clamp(c*k|0,0,255)).join(',')})`;}
function renderTerrain(){
  const T=game.terr;
  const detail=makeNoise();
  for(let y=0;y<MAPH;y++)for(let x=0;x<MAPW;x++){
    const t=T[idx(x,y)],px=x*TILE,py=y*TILE;
    const v=detail(x*0.5,y*0.5);          // per-tile tonal variance
    const v2=detail(x*0.13,y*0.13);       // broad lighting variance
    if(t===T_GRASS){
      const base=[52+v*26,76+v*22,40+v*14].map(c=>c*(0.86+v2*0.3));
      tg.fillStyle=`rgb(${base.map(c=>c|0).join(',')})`;
      tg.fillRect(px,py,TILE,TILE);
    } else if(t===T_DIRT||t===T_ROAD){
      const k=t===T_ROAD?1.12:1;
      tg.fillStyle=shade([97+v*20,80+v*16,55+v*10],k*(0.9+v2*0.2));
      tg.fillRect(px,py,TILE,TILE);
    } else if(t===T_WATER){
      tg.fillStyle=shade([26,68,92],0.85+v*0.3);
      tg.fillRect(px,py,TILE,TILE);
    } else if(t===T_ROCK){
      tg.fillStyle=shade([74,80,88],0.8+v*0.4);
      tg.fillRect(px,py,TILE,TILE);
    } else if(t===T_FOREST){
      tg.fillStyle=shade([38,58,32],0.85+v*0.3);
      tg.fillRect(px,py,TILE,TILE);
    } else if(t===T_BRIDGE){
      tg.fillStyle=shade([26,68,92],0.9);tg.fillRect(px,py,TILE,TILE);
    }
  }
  // soft organic speckle over everything
  for(let i=0;i<14000;i++){
    const x=Math.random()*WORLD_W,y=Math.random()*WORLD_H;
    const tx=x/TILE|0,ty=y/TILE|0,t=T[idx(tx,ty)];
    if(t===T_WATER||t===T_BRIDGE)continue;
    const dark=Math.random()<0.5;
    tg.fillStyle=dark?'rgba(0,0,0,.10)':'rgba(255,255,230,.05)';
    const r=1+Math.random()*3.5;
    tg.beginPath();tg.arc(x,y,r,0,7);tg.fill();
  }
  // grass tufts
  for(let i=0;i<5200;i++){
    const x=Math.random()*WORLD_W,y=Math.random()*WORLD_H;
    if(game.terr[idx(x/TILE|0,y/TILE|0)]!==T_GRASS)continue;
    tg.strokeStyle=`rgba(${90+Math.random()*50|0},${130+Math.random()*50|0},60,.35)`;
    tg.lineWidth=1;
    tg.beginPath();tg.moveTo(x,y);tg.lineTo(x+(Math.random()*4-2),y-3-Math.random()*3);tg.stroke();
  }
  // flowers like the screenshot's yellow fields
  for(let i=0;i<900;i++){
    const x=Math.random()*WORLD_W,y=Math.random()*WORLD_H;
    if(game.terr[idx(x/TILE|0,y/TILE|0)]!==T_GRASS)continue;
    if(detail(x/TILE*0.09,y/TILE*0.09)<0.62)continue;
    tg.fillStyle=Math.random()<0.8?'rgba(228,200,80,.8)':'rgba(240,240,235,.7)';
    tg.beginPath();tg.arc(x,y,1.2+Math.random(),0,7);tg.fill();
  }
  // water depth + banks
  for(const w of game.waterTiles){
    const px=w.x*TILE,py=w.y*TILE;
    const g2=tg.createRadialGradient(px+16,py+16,2,px+16,py+16,22);
    g2.addColorStop(0,'rgba(12,40,60,.55)');g2.addColorStop(1,'rgba(12,40,60,0)');
    tg.fillStyle=g2;tg.fillRect(px-4,py-4,TILE+8,TILE+8);
    // sandy bank where touching land
    const dirs=[[1,0],[ -1,0],[0,1],[0,-1]];
    for(const [dx,dy] of dirs){
      const nt=inMap(w.x+dx,w.y+dy)?game.terr[idx(w.x+dx,w.y+dy)]:T_WATER;
      if(nt!==T_WATER&&nt!==T_BRIDGE){
        tg.fillStyle='rgba(170,150,105,.5)';
        if(dx===1)tg.fillRect(px+TILE-3,py,3,TILE);
        if(dx===-1)tg.fillRect(px,py,3,TILE);
        if(dy===1)tg.fillRect(px,py+TILE-3,TILE,3);
        if(dy===-1)tg.fillRect(px,py,TILE,3);
      }
    }
  }
  // rock formations (angular boulders w/ sunlit facets)
  for(let y=0;y<MAPH;y++)for(let x=0;x<MAPW;x++){
    if(game.terr[idx(x,y)]!==T_ROCK)continue;
    const px=x*TILE,py=y*TILE;
    const n=2+(Math.random()*2|0);
    for(let i=0;i<n;i++){
      const cx=px+6+Math.random()*20,cy=py+6+Math.random()*20,r=6+Math.random()*9;
      const a0=Math.random()*7;
      tg.fillStyle='rgba(0,0,0,.3)';
      tg.beginPath();
      for(let k=0;k<5;k++){const a=a0+k/5*Math.PI*2;tg[k?'lineTo':'moveTo'](cx+3+Math.cos(a)*r,cy+4+Math.sin(a)*r*.8);}
      tg.closePath();tg.fill();
      tg.fillStyle=shade([88,95,104],0.8+Math.random()*0.4);
      tg.beginPath();
      for(let k=0;k<5;k++){const a=a0+k/5*Math.PI*2;tg[k?'lineTo':'moveTo'](cx+Math.cos(a)*r,cy+Math.sin(a)*r*.8);}
      tg.closePath();tg.fill();
      tg.fillStyle='rgba(235,240,245,.25)';
      tg.beginPath();
      for(let k=0;k<3;k++){const a=a0+Math.PI+k/5*Math.PI*2;tg[k?'lineTo':'moveTo'](cx-2+Math.cos(a)*r*.55,cy-3+Math.sin(a)*r*.45);}
      tg.closePath();tg.fill();
    }
  }
  // bridges (plank decks)
  for(let y=0;y<MAPH;y++)for(let x=0;x<MAPW;x++){
    if(game.terr[idx(x,y)]!==T_BRIDGE)continue;
    const px=x*TILE,py=y*TILE;
    tg.fillStyle='#6e5132';tg.fillRect(px,py+1,TILE,TILE-2);
    tg.fillStyle='#7e5e3a';
    for(let p=0;p<4;p++)tg.fillRect(px+1,py+2+p*8,TILE-2,5);
    tg.fillStyle='rgba(0,0,0,.35)';
    tg.fillRect(px,py,TILE,2);tg.fillRect(px,py+TILE-2,TILE,2);
  }
  // road wear lines
  for(let y=0;y<MAPH;y++)for(let x=0;x<MAPW;x++){
    if(game.terr[idx(x,y)]!==T_ROAD)continue;
    if(Math.random()<0.5)continue;
    const px=x*TILE,py=y*TILE;
    tg.strokeStyle='rgba(60,48,32,.4)';tg.lineWidth=2;
    tg.beginPath();tg.moveTo(px+Math.random()*8,py+Math.random()*32);
    tg.lineTo(px+24+Math.random()*8,py+Math.random()*32);tg.stroke();
  }
}
function scorch(x,y,r){
  tg.fillStyle='rgba(8,6,4,.5)';
  for(let i=0;i<6;i++){
    const a=Math.random()*7,d=Math.random()*r*.7;
    tg.beginPath();tg.arc(x+Math.cos(a)*d,y+Math.sin(a)*d,r*(.35+Math.random()*.45),0,7);tg.fill();
  }
}
/* screen overlay: vignette + grain */
let overlayCv=document.createElement('canvas');
function buildOverlay(){
  overlayCv.width=canvas.width;overlayCv.height=canvas.height;
  const o=overlayCv.getContext('2d');
  const v=o.createRadialGradient(canvas.width/2,canvas.height/2,Math.min(canvas.width,canvas.height)*.45,
    canvas.width/2,canvas.height/2,Math.max(canvas.width,canvas.height)*.8);
  v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,0,0,.42)');
  o.fillStyle=v;o.fillRect(0,0,canvas.width,canvas.height);
  o.fillStyle='rgba(255,255,255,.012)';
  for(let i=0;i<1200;i++)o.fillRect(Math.random()*canvas.width,Math.random()*canvas.height,1,1);
}

/* =====================================================================
   A* PATHFINDING (8-dir, corner-safe, smoothed)
   ===================================================================== */
function losClear(ax,ay,bx,by){
  const steps=Math.ceil(Math.hypot(bx-ax,by-ay)/10);
  for(let i=1;i<=steps;i++){
    const x=ax+(bx-ax)*i/steps,y=ay+(by-ay)*i/steps;
    if(!passable(x/TILE|0,y/TILE|0))return false;
  }
  return true;
}
function nearestPassableTile(tx,ty){
  if(passable(tx,ty))return [tx,ty];
  for(let r=1;r<=7;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
    if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
    if(passable(tx+dx,ty+dy))return [tx+dx,ty+dy];
  }
  return null;
}
const _g=new Float32Array(MAPW*MAPH),_came=new Int32Array(MAPW*MAPH);
function findPath(wx0,wy0,wx1,wy1){
  let sx=clamp(wx0/TILE|0,0,MAPW-1),sy=clamp(wy0/TILE|0,0,MAPH-1);
  const tgt=nearestPassableTile(clamp(wx1/TILE|0,0,MAPW-1),clamp(wy1/TILE|0,0,MAPH-1));
  if(!tgt)return null;
  const [tx,ty]=tgt;
  if(sx===tx&&sy===ty)return [{x:wx1,y:wy1}];
  if(!passable(sx,sy)){const np=nearestPassableTile(sx,sy);if(np){sx=np[0];sy=np[1];}}
  _g.fill(Infinity);_came.fill(-1);
  const start=idx(sx,sy),goal=idx(tx,ty);
  _g[start]=0;
  // binary heap of [f, idx]
  const hf=[],hi=[];
  function push(f,i){hf.push(f);hi.push(i);let c=hf.length-1;
    while(c>0){const p=(c-1)>>1;if(hf[p]<=hf[c])break;
      [hf[p],hf[c]]=[hf[c],hf[p]];[hi[p],hi[c]]=[hi[c],hi[p]];c=p;}}
  function pop(){const f=hf[0],i=hi[0];const lf=hf.pop(),li=hi.pop();
    if(hf.length){hf[0]=lf;hi[0]=li;let c=0;
      while(true){let l=c*2+1,r=l+1,m=c;
        if(l<hf.length&&hf[l]<hf[m])m=l;
        if(r<hf.length&&hf[r]<hf[m])m=r;
        if(m===c)break;
        [hf[m],hf[c]]=[hf[c],hf[m]];[hi[m],hi[c]]=[hi[c],hi[m]];c=m;}}
    return i;}
  const H=(i)=>{const x=i%MAPW,y=i/MAPW|0;return (Math.abs(x-tx)+Math.abs(y-ty));};
  push(H(start),start);
  let pops=0,found=false;
  const DIRS=[[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,1.4],[1,-1,1.4],[-1,1,1.4],[-1,-1,1.4]];
  while(hf.length&&pops++<8000){
    const cur=pop();
    if(cur===goal){found=true;break;}
    const cx=cur%MAPW,cy=cur/MAPW|0,cg=_g[cur];
    for(const [dx,dy,c] of DIRS){
      const nx=cx+dx,ny=cy+dy;
      if(!passable(nx,ny))continue;
      if(dx&&dy&&(!passable(cx+dx,cy)||!passable(cx,cy+dy)))continue;
      const ni=idx(nx,ny),ng=cg+c;
      if(ng<_g[ni]){_g[ni]=ng;_came[ni]=cur;push(ng+H(ni),ni);}
    }
  }
  if(!found)return null;
  // reconstruct
  let pts=[];let cur=goal;
  while(cur!==-1&&cur!==start){pts.push({x:(cur%MAPW)*TILE+16,y:(cur/MAPW|0)*TILE+16});cur=_came[cur];}
  pts.reverse();
  pts.push({x:wx1,y:wy1});
  // smooth with line-of-sight skips
  const sm=[];let from={x:wx0,y:wy0};let i=0;
  while(i<pts.length){
    let j=Math.min(pts.length-1,i+6);
    while(j>i&&!losClear(from.x,from.y,pts[j].x,pts[j].y))j--;
    sm.push(pts[j]);from=pts[j];i=j+1;
  }
  return sm;
}

/* =====================================================================
   ENTITIES
   ===================================================================== */
let nextId=1;
function footprintFree(type,tx,ty){
  const d=B[type];
  for(let y=ty;y<ty+d.h;y++)for(let x=tx;x<tx+d.w;x++){
    if(!inMap(x,y)||game.occupied[idx(x,y)])return false;
    const t=game.terr[idx(x,y)];
    if(!(t===T_GRASS||t===T_DIRT||t===T_ROAD))return false;
    for(const n of game.nodes){if(n.amount>0&&Math.abs(n.x-(x*TILE+16))<30&&Math.abs(n.y-(y*TILE+16))<30)return false;}
  }
  return true;
}
function addBuilding(type,tx,ty,team,instant){
  const d=B[type];
  const b={id:nextId++,kind:'b',type,team,tx,ty,
    x:(tx+d.w/2)*TILE,y:(ty+d.h/2)*TILE,w:d.w*TILE,h:d.h*TILE,
    hpMax:d.hp,hp:instant?d.hp:1,progress:instant?1:0,
    cooldown:0,target:null,queue:[],queueT:0,disabledUntil:0,anim:Math.random()*7,unloadFx:-9,aim:0};
  for(let y=ty;y<ty+d.h;y++)for(let x=tx;x<tx+d.w;x++)game.occupied[idx(x,y)]=1;
  game.buildings.push(b);return b;
}
function removeBuildingTiles(b){
  const d=B[b.type];
  for(let y=b.ty;y<b.ty+d.h;y++)for(let x=b.tx;x<b.tx+d.w;x++)game.occupied[idx(x,y)]=0;
}
function addUnit(type,x,y,team){
  const u={id:nextId++,kind:'u',type,team,x,y,hpMax:U[type].hp,hp:U[type].hp,
    order:'idle',dest:null,target:null,path:null,repathT:0,stuckT:0,lx:x,ly:y,
    cooldown:0,disabledUntil:0,cargo:0,hNode:null,hState:'find',
    facing:Math.random()*7,aim:Math.random()*7,bob:Math.random()*7,
    moving:false,trailT:0,lastShot:-9};
  game.units.push(u);return u;
}
function freeSpotNear(x,y){
  for(let r=0;r<12;r++)for(let i=0;i<12;i++){
    const a=Math.random()*Math.PI*2,px=x+Math.cos(a)*r*20,py=y+Math.sin(a)*r*20;
    if(passable(px/TILE|0,py/TILE|0))return {x:px,y:py};
  }
  return {x,y};
}
function setupBases(){
  for(const team of [1,2,3,4]){
    const bi=BASE_INFO[team];
    addBuilding('hq',bi.tx,bi.ty,team,true);
    if(team===PLAYER){
      let s=freeSpotNear((bi.tx+4)*TILE,(bi.ty)*TILE);addUnit('recon',s.x,s.y,team);
      s=freeSpotNear((bi.tx+1)*TILE,(bi.ty-3)*TILE);addUnit('recon',s.x,s.y,team);
      continue;
    }
    aiPlace(team,'power',-1,4,true);
    aiPlace(team,'refinery',4,1,true);
    let s=freeSpotNear((bi.tx+3*bi.sx+1.5)*TILE,(bi.ty+5*bi.sy)*TILE);
    addUnit('harvester',s.x,s.y,team);
    s=freeSpotNear((bi.tx+5*bi.sx)*TILE,(bi.ty+2*bi.sy)*TILE);
    addUnit('recon',s.x,s.y,team);
    if(FAC[team].persona==='warlord'){
      aiPlace(team,'turret',6,3,true);
      s=freeSpotNear((bi.tx+6*bi.sx)*TILE,(bi.ty+5*bi.sy)*TILE);addUnit('strike',s.x,s.y,team);
      s=freeSpotNear((bi.tx+4*bi.sx)*TILE,(bi.ty+6*bi.sy)*TILE);addUnit('strike',s.x,s.y,team);
    }
    game.ai[team]={builtIdx:0,nextWave:0,waveN:0,covertT:120+Math.random()*60};
    game.ai[team].nextWave=FAC[team].persona==='warlord'?130+Math.random()*40:180+Math.random()*60;
  }
}
function aiPlace(team,type,dx,dy,instant){
  const bi=BASE_INFO[team];
  const tx=bi.tx+dx*bi.sx,ty=bi.ty+dy*bi.sy;
  for(let n=0;n<48;n++){
    const ox=tx+(n%7)-3,oy=ty+((n/7)|0)-3;
    if(footprintFree(type,ox,oy)){addBuilding(type,ox,oy,team,instant);return true;}
  }
  return false;
}
const AI_SCRIPT=[
  {t:20,type:'power',dx:-2,dy:7},{t:60,type:'foundry',dx:5,dy:5},
  {t:100,type:'turret',dx:8,dy:6},{t:135,type:'turret',dx:6,dy:9},
  {t:210,type:'refinery',dx:0,dy:10},{t:310,type:'foundry',dx:9,dy:2},
  {t:390,type:'power',dx:2,dy:12},{t:500,type:'turret',dx:10,dy:9},
];

/* ---------- fog of war ---------- */
const fogCanvas=document.createElement('canvas');fogCanvas.width=MAPW;fogCanvas.height=MAPH;
const fogCtx=fogCanvas.getContext('2d');
const fogImg=fogCtx.createImageData(MAPW,MAPH);
function computeVision(){
  game.visible.fill(0);
  const stamp=(ex,ey,sight)=>{
    const cx=ex/TILE|0,cy=ey/TILE|0;
    for(let y=cy-sight;y<=cy+sight;y++)for(let x=cx-sight;x<=cx+sight;x++){
      if(!inMap(x,y))continue;
      if((x-cx)*(x-cx)+(y-cy)*(y-cy)<=sight*sight){game.visible[idx(x,y)]=1;game.explored[idx(x,y)]=1;}
    }
  };
  for(const b of game.buildings)if(isAllied(PLAYER,b.team))stamp(b.x,b.y,B[b.type].sight);
  for(const u of game.units)if(isAllied(PLAYER,u.team))stamp(u.x,u.y,U[u.type].sight);
  game.tempVision=game.tempVision.filter(v=>v.until>game.t);
  for(const v of game.tempVision)stamp(v.x,v.y,v.r);
  const px=fogImg.data;
  for(let i=0;i<MAPW*MAPH;i++){
    const o=i*4;px[o]=2;px[o+1]=4;px[o+2]=3;
    px[o+3]=game.visible[i]?0:(game.explored[i]?125:255);
  }
  fogCtx.putImageData(fogImg,0,0);
}
const tileVisible=(x,y)=>game.visible[idx(clamp(x/TILE|0,0,MAPW-1),clamp(y/TILE|0,0,MAPH-1))]===1;
const canSee=(e)=>isAllied(PLAYER,e.team)||tileVisible(e.x,e.y);

/* ---------- economy ---------- */
function powerOf(team){
  let prod=0,use=0;
  for(const b of game.buildings){if(b.team!==team||b.progress<1)continue;
    const p=B[b.type].power;if(p>0)prod+=p;else use-=p;}
  return {prod,use,ok:prod>=use,factor:prod>=use?1:0.5};
}
function tradeIncome(team){
  let n=0;for(const f of [1,2,3,4])if(f!==team&&dip.trade[rk(team,f)]&&!game.eliminated[f])n++;
  return n*9;
}

/* ---------- combat ---------- */
function fireAt(src,target,dmg,rail){
  game.shots.push({x:src.x,y:src.y,target,dmg,team:src.team,speed:rail?940:560,col:FAC[src.team].col,rail});
  src.lastShot=game.t;
  spawnParts('muzzle',src.x,src.y,2,'255,235,180');
  sfx(rail?'rail':'shot',src.x);
}
function damage(e,amt,fromTeam){e.hp-=amt;if(e.hp<=0)destroy(e,fromTeam);}
function destroy(e,fromTeam){
  if(e.dead)return;e.dead=true;
  const big=e.kind==='b';
  spawnParts('fire',e.x,e.y,big?26:12,'255,160,60');
  spawnParts('debris',e.x,e.y,big?14:7,'120,120,128');
  spawnParts('smoke',e.x,e.y,big?12:5,'70,70,76');
  game.parts.push({type:'ring',x:e.x,y:e.y,t:0,life:.7,big});
  game.parts.push({type:'flash',x:e.x,y:e.y,t:0,life:.16,big});
  scorch(e.x,e.y,big?Math.max(e.w,e.h)*.6:15);
  game.shake=Math.min(11,game.shake+(big?7:2));
  sfx(big?'bigboom':'boom',e.x);
  if(big){
    removeBuildingTiles(e);
    game.buildings=game.buildings.filter(b=>b!==e);
    logMsg((e.team===PLAYER?'Our ':FAC[e.team].name+' ')+B[e.type].name+' destroyed',e.team===PLAYER?'war':null);
  } else game.units=game.units.filter(u=>u!==e);
  game.selection=game.selection.filter(s=>s!==e);
  if(fromTeam&&fromTeam!==e.team&&!isAllied(fromTeam,e.team))addRel(fromTeam,e.team,big?-16:-5);
  if(big)checkElimination(e.team);
}
function checkElimination(team){
  if(game.eliminated[team])return;
  if(!game.buildings.some(b=>b.team===team)){
    game.eliminated[team]=true;
    logMsg(FAC[team].name+' has been wiped from the battlefield','war');sfx('war');
  }
}
function nearestHostile(e,range,team,playerVisOnly){
  let best=null,bd=range;
  for(const u of game.units){if(!isWar(team,u.team))continue;
    if(playerVisOnly&&!tileVisible(u.x,u.y))continue;
    const d=dist(e,u)-U[u.type].radius;if(d<bd){bd=d;best=u;}}
  for(const b of game.buildings){if(!isWar(team,b.team))continue;
    if(playerVisOnly&&!tileVisible(b.x,b.y))continue;
    const d=dist(e,b)-Math.max(b.w,b.h)/2;if(d<bd){bd=d;best=b;}}
  return best;
}

/* ---------- movement: path following + local steering ---------- */
function unitBlocked(x,y){return !passable(x/TILE|0,y/TILE|0);}
function stepToward(u,dx,dy,dt){
  const sp=U[u.type].speed*dt,len=Math.hypot(dx,dy);
  if(len<1){u.moving=false;return true;}
  u.moving=true;
  const nx=u.x+dx/len*sp,ny=u.y+dy/len*sp;
  u.facing=Math.atan2(dy,dx);
  if(!unitBlocked(nx,ny)){u.x=nx;u.y=ny;}
  else if(!unitBlocked(nx,u.y)){u.x=nx;}
  else if(!unitBlocked(u.x,ny)){u.y=ny;}
  else{const px=u.x+(-dy/len)*sp,py=u.y+(dx/len)*sp;
    if(!unitBlocked(px,py)){u.x=px;u.y=py;}}
  u.x=clamp(u.x,12,WORLD_W-12);u.y=clamp(u.y,12,WORLD_H-12);
  return len<sp*1.5;
}
function setPath(u,wx,wy){
  u.path=findPath(u.x,u.y,wx,wy);
  u.finalDest={x:wx,y:wy};
  u.stuckT=0;
}
function followPath(u,dt){
  if(!u.path||!u.path.length){
    if(u.finalDest)return stepToward(u,u.finalDest.x-u.x,u.finalDest.y-u.y,dt);
    return true;
  }
  const p=u.path[0];
  const arrived=stepToward(u,p.x-u.x,p.y-u.y,dt)||dist(u,p)<13;
  if(arrived){u.path.shift();return u.path.length===0&&dist(u,u.finalDest||p)<16;}
  // stuck detection
  const moved=Math.hypot(u.x-u.lx,u.y-u.ly);
  if(moved<U[u.type].speed*dt*0.25)u.stuckT+=dt;else u.stuckT=0;
  u.lx=u.x;u.ly=u.y;
  if(u.stuckT>1.3&&u.finalDest){u.stuckT=0;setPath(u,u.finalDest.x,u.finalDest.y);}
  return false;
}
function separation(){
  const us=game.units;
  for(let i=0;i<us.length;i++)for(let j=i+1;j<us.length;j++){
    const a=us[i],b=us[j];
    const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
    const min=U[a.type].radius+U[b.type].radius;
    if(d>0&&d<min){
      const push=(min-d)/2,ux=dx/d,uy=dy/d;
      if(!unitBlocked(a.x-ux*push,a.y-uy*push)){a.x-=ux*push;a.y-=uy*push;}
      if(!unitBlocked(b.x+ux*push,b.y+uy*push)){b.x+=ux*push;b.y+=uy*push;}
    }
  }
}

/* ---------- harvesting ---------- */
function nearestNodePathable(u){
  const sorted=[...game.nodes].filter(n=>n.amount>0).sort((a,b)=>dist(u,a)-dist(u,b));
  for(let i=0;i<Math.min(4,sorted.length);i++){
    const p=findPath(u.x,u.y,sorted[i].x,sorted[i].y);
    if(p)return {node:sorted[i],path:p};
  }
  return null;
}
function nearestDepot(u){
  let best=null,bd=1e9;
  for(const b of game.buildings){
    if(b.team!==u.team||b.progress<1)continue;
    if(b.type!=='refinery'&&b.type!=='hq')continue;
    const d=dist(u,b);if(d<bd){bd=d;best=b;}}
  return best;
}
function updateHarvester(u,dt){
  const cap=U.harvester.cargo;
  if(u.hState==='find'){
    const got=nearestNodePathable(u);
    if(got){u.hNode=got.node;u.path=got.path;u.finalDest={x:got.node.x,y:got.node.y};u.hState='go';}
    else u.hState='idlewait';
  }
  if(u.hState==='idlewait'){if(game.t%2<dt)u.hState='find';u.moving=false;return;}
  if(u.hState==='go'){
    if(!u.hNode||u.hNode.amount<=0){u.hState='find';return;}
    if(dist(u,u.hNode)<28){u.hState='mine';u.path=null;}
    else followPath(u,dt);
  }else if(u.hState==='mine'){
    u.moving=false;
    if(!u.hNode||u.hNode.amount<=0){u.hState='find';return;}
    const take=Math.min(62*dt,u.hNode.amount,cap-u.cargo);
    u.hNode.amount-=take;u.cargo+=take;
    if(Math.random()<dt*6)spawnParts('spark',u.hNode.x,u.hNode.y-4,1,'255,220,120');
    if(u.cargo>=cap-0.5){
      u.hState='return';
      const dep=nearestDepot(u);
      if(dep)setPath(u,dep.x,dep.y+dep.h/2+14);
    }
  }else if(u.hState==='return'){
    const dep=nearestDepot(u);
    if(!dep){u.hState='idlewait';return;}
    if(dist(u,dep)<Math.max(dep.w,dep.h)/2+26){
      game.money[u.team]+=Math.round(u.cargo);u.cargo=0;u.hState='find';
      dep.unloadFx=game.t;u.moving=false;u.path=null;
      if(u.team===PLAYER)sfx('cash',dep.x);
    } else followPath(u,dt);
  }
}

/* ---------- unit update ---------- */
function updateUnit(u,dt){
  if(u.disabledUntil>game.t){u.moving=false;return;}
  const d=U[u.type];
  u.cooldown=Math.max(0,u.cooldown-dt);
  // turret aim smoothing
  let want=u.facing;
  if(u.target&&!u.target.dead)want=Math.atan2(u.target.y-u.y,u.target.x-u.x);
  let da=((want-u.aim+Math.PI*3)%(Math.PI*2))-Math.PI;
  u.aim+=clamp(da,-7*dt,7*dt);
  if(u.type==='harvester'){
    if(u.order==='move'&&u.dest){
      if(followPath(u,dt)){u.order='idle';u.hState='find';u.dest=null;}
      return;
    }
    updateHarvester(u,dt);return;
  }
  if(u.target&&u.target.dead)u.target=null;
  if(u.order==='attack'&&u.target){
    const r=d.range+(u.target.kind==='b'?Math.max(u.target.w,u.target.h)/2:U[u.target.type].radius);
    if(dist(u,u.target)<=r){
      u.moving=false;u.path=null;
      u.facing=Math.atan2(u.target.y-u.y,u.target.x-u.x);
      if(u.cooldown<=0&&Math.abs(da)<0.5){fireAt(u,u.target,d.dmg,u.type==='walker');u.cooldown=d.rof;}
    } else {
      u.repathT-=dt;
      if(!u.path||u.repathT<=0){u.repathT=1.0;setPath(u,u.target.x,u.target.y);}
      followPath(u,dt);
    }
    return;
  }
  if((u.order==='move'||u.order==='amove')&&u.dest){
    if(u.order==='amove'){
      const t=nearestHostile(u,210,u.team,u.team===PLAYER);
      if(t){u.target=t;u.savedDest=u.dest;u.order='attack';u.resume='amove';return;}
    }
    if(followPath(u,dt)){u.order='idle';u.dest=null;u.path=null;}
    return;
  }
  if(u.order==='idle'){
    u.moving=false;
    if(u.resume==='amove'&&u.savedDest){
      u.order='amove';u.dest=u.savedDest;setPath(u,u.dest.x,u.dest.y);
      u.resume=null;u.savedDest=null;return;
    }
    const t=nearestHostile(u,d.range+52,u.team,u.team===PLAYER);
    if(t){u.target=t;u.order='attack';}
  }
}
function postAttackCleanup(u){
  if(u.order==='attack'&&(!u.target||u.target.dead)){u.target=null;u.order='idle';u.path=null;}
}

/* ---------- building update ---------- */
function updateBuilding(b,dt){
  const d=B[b.type],pw=powerOf(b.team);
  b.anim+=dt;
  if(b.progress<1){
    b.progress=Math.min(1,b.progress+dt/(d.buildTime||1)*pw.factor);
    b.hp=Math.max(b.hp,d.hp*b.progress*0.999);
    if(b.progress>=1){
      b.hp=d.hp;
      if(b.team===PLAYER){logMsg(d.name+' online','good');sfx('place',b.x);}
      if(b.type==='refinery'){
        const s=freeSpotNear(b.x,b.y+b.h);
        addUnit('harvester',s.x,s.y,b.team);
        if(b.team===PLAYER)logMsg('Harvester deployed','good');
      }
    }
    return;
  }
  if(b.disabledUntil>game.t)return;
  if(b.type==='turret'){
    b.cooldown=Math.max(0,b.cooldown-dt);
    if(b.target&&(b.target.dead||dist(b,b.target)>d.range+30))b.target=null;
    if(!b.target)b.target=nearestHostile(b,d.range,b.team,b.team===PLAYER);
    if(b.target){
      const want=Math.atan2(b.target.y-b.y,b.target.x-b.x);
      let da=((want-b.aim+Math.PI*3)%(Math.PI*2))-Math.PI;
      b.aim+=clamp(da,-5*dt,5*dt);
      if(b.cooldown<=0&&Math.abs(da)<0.4){fireAt(b,b.target,d.dmg,false);b.cooldown=d.rof/pw.factor;}
    } else b.aim+=dt*0.4;
  }
  if(b.type==='power'&&Math.random()<dt*1.6)
    spawnParts('steam',b.x-b.w*0.18,b.y-b.h/2-d.hgt,1,'200,205,210');
  if(b.type==='foundry'&&b.queue.length){
    b.queueT+=dt*pw.factor;
    if(Math.random()<dt*5)spawnParts('spark',b.x+(Math.random()*30-15),b.y+6,1,'255,210,120');
    const ut=U[b.queue[0]];
    if(b.queueT>=ut.buildTime){
      b.queueT=0;const type=b.queue.shift();
      const s=freeSpotNear(b.x,b.y+b.h*0.7+20);
      const nu=addUnit(type,s.x,s.y,b.team);
      if(b.team===PLAYER)logMsg(ut.name+' fabricated','good');
      if(b.rally){nu.order='move';nu.dest={...b.rally};setPath(nu,b.rally.x,b.rally.y);}
    }
  }
  if(b.hp<b.hpMax*0.45&&Math.random()<dt*2.4)
    spawnParts('smoke',b.x+(Math.random()*b.w-b.w/2)*.5,b.y-b.h*0.2,1,'60,60,66');
}

/* ---------- shots & particles ---------- */
function spawnParts(type,x,y,n,rgb){
  if(game.parts.length>520)return;
  for(let i=0;i<n;i++){
    const a=Math.random()*7;
    const sp=type==='fire'?50+Math.random()*190:type==='debris'?70+Math.random()*200:
       type==='smoke'?8+Math.random()*26:type==='steam'?6+Math.random()*14:20+Math.random()*70;
    game.parts.push({type,x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-(type==='debris'?60:0),
      t:0,life:type==='smoke'?1.3+Math.random()*0.9:type==='steam'?1.4+Math.random():
        type==='debris'?0.6+Math.random()*0.5:type==='fire'?0.35+Math.random()*0.35:0.3+Math.random()*0.25,
      rgb,size:type==='smoke'||type==='steam'?5+Math.random()*8:1.5+Math.random()*2.5,
      grav:type==='debris'?340:0});
  }
}
function updateShots(dt){
  for(const s of game.shots){
    if(!s.target||s.target.dead){s.dead=true;continue;}
    const dx=s.target.x-s.x,dy=s.target.y-s.y,l=Math.hypot(dx,dy),step=s.speed*dt;
    if(l<=step){
      damage(s.target,s.dmg,s.team);s.dead=true;
      spawnParts('spark',s.target.x,s.target.y,3,'255,240,200');
    } else {s.x+=dx/l*step;s.y+=dy/l*step;}
  }
  game.shots=game.shots.filter(s=>!s.dead);
  for(const p of game.parts){
    p.t+=dt;
    if(p.vx!==undefined){
      p.x+=p.vx*dt;p.y+=p.vy*dt;
      p.vx*=(1-dt*2.2);p.vy*=(1-dt*2.2);
      if(p.grav)p.vy+=p.grav*dt;
      if(p.type==='smoke'||p.type==='steam')p.y-=14*dt;
    }
  }
  game.parts=game.parts.filter(p=>p.t<p.life);
}

/* ---------- abilities & covert ---------- */
function hasCyber(){return game.buildings.some(b=>b.team===PLAYER&&b.type==='cyber'&&b.progress>=1);}
function tryAbility(key){
  if(game.over)return;
  if(!hasCyber()){hint('Requires a Cyber Ops Center');sfx('click');return;}
  const a=ABILITIES[key];
  if(game.cooldowns[key]>0){hint(a.name+' recharging');return;}
  if(game.money[PLAYER]<a.cost){hint('Insufficient crystals');return;}
  game.armed=key;game.placing=null;
  hint(a.name+': click a target');refreshSidebar();
}
function castAbility(key,wx,wy){
  if(key==='amove'){issueOrder(wx,wy,true);game.armed=null;hint('');return;}
  const a=ABILITIES[key];
  if(key==='emp'){
    game.money[PLAYER]-=a.cost;game.cooldowns.emp=a.cd;
    game.parts.push({type:'emp',x:wx,y:wy,t:0,life:.85});
    sfx('emp',wx);
    let n=0;const hitFac={};
    for(const u of game.units)if(!isAllied(PLAYER,u.team)&&dist(u,{x:wx,y:wy})<132){u.disabledUntil=game.t+8;n++;hitFac[u.team]=1;}
    for(const b of game.buildings)if(!isAllied(PLAYER,b.team)&&b.type==='turret'&&dist(b,{x:wx,y:wy})<132){b.disabledUntil=game.t+8;n++;hitFac[b.team]=1;}
    for(const f in hitFac)if(!isWar(PLAYER,+f))addRel(PLAYER,+f,-12);
    logMsg('EMP pulse — '+n+' systems offline','hot');
  } else if(key==='hijack'){
    let best=null,bd=42;
    for(const u of game.units){if(isAllied(PLAYER,u.team))continue;
      const dd=dist(u,{x:wx,y:wy});if(dd<bd&&tileVisible(u.x,u.y)){bd=dd;best=u;}}
    if(!best){hint('Hijack: click directly on an enemy unit');return;}
    game.money[PLAYER]-=a.cost;game.cooldowns.hijack=a.cd;
    if(!isWar(PLAYER,best.team))addRel(PLAYER,best.team,-18);
    best.team=PLAYER;best.order='idle';best.target=null;best.hState='find';best.hNode=null;best.path=null;
    game.parts.push({type:'emp',x:best.x,y:best.y,t:0,life:.8});
    sfx('emp',best.x);
    logMsg(U[best.type].name+' hijacked — it\'s ours now','hot');
  }
  game.armed=null;refreshSidebar();
}
function runCovert(key){
  if(game.over)return;
  if(!hasCyber()){hint('Covert ops require a Cyber Ops Center');return;}
  const m=COVERT[key],tgt=game.covTarget;
  if(game.eliminated[tgt]){hint('Target faction is gone');return;}
  if(isAllied(PLAYER,tgt)){hint('Cannot run ops against an ally');return;}
  if(game.covCd[key]>0){hint(m.name+' recharging');return;}
  if(game.money[PLAYER]<m.cost){hint('Insufficient crystals');return;}
  game.money[PLAYER]-=m.cost;game.covCd[key]=m.cd;
  sfx('covert');
  const ok=Math.random()<m.chance,fname=FAC[tgt].name;
  if(key==='steal'){
    if(ok){const amt=Math.min(600,Math.max(150,game.money[tgt]*0.3))|0;
      game.money[tgt]-=amt;game.money[PLAYER]+=amt;
      logMsg('Covert: siphoned '+amt+' crystals from '+fname,'good');sfx('cash');}
    else{addRel(PLAYER,tgt,-20);logMsg('Covert op DETECTED — '+fname+' relations −20','war');sfx('war');}
  } else if(key==='sabotage'){
    const bl=game.buildings.filter(b=>b.team===tgt&&b.type!=='hq');
    const pick=bl.length?bl[Math.random()*bl.length|0]:game.buildings.find(b=>b.team===tgt);
    if(ok&&pick){
      pick.hp=Math.max(pick.hpMax*0.08,pick.hp-pick.hpMax*0.45);
      pick.disabledUntil=game.t+20;
      spawnParts('fire',pick.x,pick.y,14,'255,160,60');
      game.parts.push({type:'ring',x:pick.x,y:pick.y,t:0,life:.7,big:true});
      sfx('boom',pick.x);
      logMsg('Covert: '+fname+' '+B[pick.type].name+' sabotaged','good');
    } else {addRel(PLAYER,tgt,-25);logMsg('Sabotage DETECTED — '+fname+' relations −25','war');sfx('war');}
  } else if(key==='recon'){
    const hq=game.buildings.find(b=>b.team===tgt&&b.type==='hq')||game.buildings.find(b=>b.team===tgt);
    if(hq){game.tempVision.push({x:hq.x,y:hq.y,r:17,until:game.t+15});
      logMsg('Recon sweep over '+fname+' territory','good');}
  } else if(key==='incite'){
    const others=AIS.filter(f=>f!==tgt&&!game.eliminated[f]);
    if(ok&&others.length){
      const o=others[Math.random()*others.length|0];
      addRel(tgt,o,-40);
      logMsg('Covert: forged intel — '+fname+' vs '+FAC[o].name+' relations collapse','good');
    } else {addRel(PLAYER,tgt,-25);logMsg('Incitement DETECTED — '+fname+' relations −25','war');sfx('war');}
  }
  refreshSidebar();
}

/* ---------- player diplomacy ---------- */
function dipGift(f){
  if(game.money[PLAYER]<300){hint('Insufficient crystals');return;}
  game.money[PLAYER]-=300;addRel(PLAYER,f,12);
  logMsg('Gift sent to '+FAC[f].name+' (+12 relations)','good');sfx('chime');
}
function dipTrade(f){
  const k=rk(PLAYER,f);
  if(dip.trade[k]){delete dip.trade[k];logMsg('Trade pact with '+FAC[f].name+' cancelled');return;}
  if(isWar(PLAYER,f)){hint('Cannot trade during war');return;}
  const need=FAC[f].persona==='merchant'?0:10;
  if(getRel(PLAYER,f)<need){hint(FAC[f].name+' requires relations ≥ '+need+' to trade');return;}
  dip.trade[k]=true;addRel(PLAYER,f,5);
  logMsg('Trade pact signed with '+FAC[f].name+' (+9 crystals/s each)','good');sfx('chime');
}
function dipAlly(f){
  const k=rk(PLAYER,f);
  if(dip.alliance[k]){
    delete dip.alliance[k];addRel(PLAYER,f,-30);
    logMsg('Alliance with '+FAC[f].name+' dissolved','war');sfx('war');return;
  }
  if(isWar(PLAYER,f)){hint('They are at war with you');return;}
  const need={warlord:75,merchant:40,covert:55}[FAC[f].persona];
  if(getRel(PLAYER,f)>=need){
    dip.alliance[k]=true;delete dip.trade[k];addRel(PLAYER,f,10);
    logMsg('ALLIANCE forged with '+FAC[f].name+' — shared vision active','good');sfx('chime');
  } else logMsg(FAC[f].name+' declines. (Needs relations ≥ '+need+', now '+Math.round(getRel(PLAYER,f))+')');
}
function dipWar(f){
  setRel(PLAYER,f,Math.min(getRel(PLAYER,f),-60));
  delete dip.alliance[rk(PLAYER,f)];delete dip.trade[rk(PLAYER,f)];
  logMsg('WAR declared on '+FAC[f].name,'war');sfx('war');
}

/* ---------- AI & world diplomacy ---------- */
let dipTickT=0,lastStates={};
function diplomacyTick(){
  const targets={warlord:{1:-55,def:-28},merchant:{1:18,def:14},covert:{1:-2,def:-2}};
  for(const a of AIS){
    if(game.eliminated[a])continue;
    for(const b of [1,2,3,4]){
      if(b===a||game.eliminated[b])continue;
      const tg2=targets[FAC[a].persona];
      const want=(b===1?tg2[1]:tg2.def),cur=getRel(a,b);
      if(Math.abs(cur-want)>1)addRel(a,b,cur<want?0.9:-0.9);
    }
  }
  for(const k in dip.trade){const [a,b]=k.split('-').map(Number);addRel(a,b,1);}
  for(const k in dip.alliance){
    const [a,b]=k.split('-').map(Number);
    for(const c of [1,2,3,4]){
      if(c===a||c===b)continue;
      if(isWar(a,c))addRel(b,c,-2.2);
      if(isWar(b,c))addRel(a,c,-2.2);
    }
  }
  for(const k of Object.keys(dip.alliance)){
    const [a,b]=k.split('-').map(Number);
    if(getRel(a,b)<25){delete dip.alliance[k];
      logMsg('Alliance between '+FAC[a].name+' and '+FAC[b].name+' collapses','war');}
  }
  for(const a of AIS)for(const b of AIS){
    if(a>=b||game.eliminated[a]||game.eliminated[b])continue;
    if(!dip.alliance[rk(a,b)]&&getRel(a,b)>60){
      dip.alliance[rk(a,b)]=true;
      logMsg(FAC[a].name+' and '+FAC[b].name+' have formed an alliance','hot');
    }
  }
  for(const a of [1,2,3,4])for(const b of [1,2,3,4]){
    if(a>=b)continue;
    const k=rk(a,b),st=stateOf(a,b);
    if(lastStates[k]&&lastStates[k]!=='WAR'&&st==='WAR'){
      logMsg('WAR: '+FAC[a].name+' ⚔ '+FAC[b].name,'war');sfx('war');
    }
    lastStates[k]=st;
  }
}
function aiUpdate(team,dt){
  if(game.eliminated[team])return;
  const ai=game.ai[team];
  const tShift=FAC[team].persona==='warlord'?-25:(FAC[team].persona==='merchant'?30:0);
  while(ai.builtIdx<AI_SCRIPT.length&&game.t>=AI_SCRIPT[ai.builtIdx].t+tShift){
    const step=AI_SCRIPT[ai.builtIdx];ai.builtIdx++;
    if(game.money[team]>=B[step.type].cost){
      if(aiPlace(team,step.type,step.dx,step.dy,false))game.money[team]-=B[step.type].cost;
    }
  }
  if(game.t>320)game.money[team]+=6*dt;
  if(FAC[team].persona==='merchant')game.money[team]+=4*dt;
  const harv=game.units.filter(u=>u.team===team&&u.type==='harvester').length;
  const foundries=game.buildings.filter(b=>b.team===team&&b.type==='foundry'&&b.progress>=1);
  if(harv<2&&game.money[team]>700&&foundries.length&&foundries[0].queue.length===0){
    foundries[0].queue.push('harvester');game.money[team]-=U.harvester.cost;
  }
  const army=game.units.filter(u=>u.team===team&&u.type!=='harvester');
  if(army.length<26&&foundries.length){
    for(const f of foundries){
      if(f.queue.length<2&&game.money[team]>900){
        const pool=game.t<320?['recon','strike','strike']:['strike','strike','walker','recon'];
        const pick=pool[Math.random()*pool.length|0];
        f.queue.push(pick);game.money[team]-=U[pick].cost;
      }
    }
  }
  if(game.t>=ai.nextWave){
    const enemies=[1,2,3,4].filter(f=>f!==team&&!game.eliminated[f]&&isWar(team,f)&&game.buildings.some(b=>b.team===f));
    if(enemies.length){
      enemies.sort((a,b)=>getRel(team,a)-getRel(team,b));
      const tgtTeam=enemies[0];
      ai.waveN++;
      const size=Math.min(16,2+Math.ceil(ai.waveN*1.7));
      const squad=army.filter(u=>u.order==='idle').slice(0,size);
      const tBuilds=game.buildings.filter(b=>b.team===tgtTeam);
      if(squad.length>=Math.min(3,size)&&tBuilds.length){
        const tb=tBuilds[Math.random()*tBuilds.length|0];
        for(const u of squad){
          u.order='amove';u.dest={x:tb.x+(Math.random()*120-60),y:tb.y+(Math.random()*120-60)};
          setPath(u,u.dest.x,u.dest.y);
        }
        if(tgtTeam===PLAYER||isAllied(PLAYER,tgtTeam)){
          logMsg(FAC[team].name+' strike force inbound — wave '+ai.waveN,'war');sfx('war');
        } else logMsg(FAC[team].name+' launches an assault on '+FAC[tgtTeam].name);
      }
    }
    ai.nextWave=game.t+Math.max(50,115-ai.waveN*8)+Math.random()*20;
  }
  if(FAC[team].persona==='covert'&&game.t>=ai.covertT){
    ai.covertT=game.t+80+Math.random()*50;
    const victims=[1,2,3,4].filter(f=>f!==team&&!game.eliminated[f]&&!isAllied(team,f));
    if(victims.length){
      victims.sort((a,b)=>game.money[b]-game.money[a]);
      const v=victims[0];
      if(Math.random()<0.55){
        const amt=Math.min(500,Math.max(100,game.money[v]*0.22))|0;
        game.money[v]-=amt;game.money[team]+=amt;
        if(v===PLAYER){logMsg('VANTA CELL siphoned '+amt+' crystals from our network','war');sfx('covert');}
      } else {
        const bl=game.buildings.filter(b=>b.team===v&&b.type!=='hq');
        if(bl.length){
          const pick=bl[Math.random()*bl.length|0];
          pick.hp=Math.max(pick.hpMax*0.1,pick.hp-pick.hpMax*0.3);
          if(v===PLAYER){logMsg('VANTA CELL sabotaged our '+B[pick.type].name,'war');sfx('war');
            spawnParts('fire',pick.x,pick.y,10,'255,160,60');}
        }
      }
      if(Math.random()<0.3)addRel(team,v,-12);
    }
  }
}
