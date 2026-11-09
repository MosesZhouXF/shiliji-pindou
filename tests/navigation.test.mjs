import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachNavigation,normalizeZoom} from '../dist/navigation.js';

function setup(draw=false){
  const handlers=new Map(),captured=new Set(),classes=new Set(),calls=[];let zoom=1;
  const stage={clientHeight:400,classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)},addEventListener:(type,fn)=>handlers.set(type,fn),setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)};
  const paper={style:{transform:''},getBoundingClientRect(){const [x,y]=(this.style.transform.match(/-?[\d.]+/g)||[0,0]).map(Number);return{left:300-100*zoom+x,top:250-100*zoom+y,width:200*zoom,height:200*zoom};}};
  const nav=attachNavigation({stage,paper,getZoom:()=>zoom,setZoom:n=>{zoom=normalizeZoom(n,zoom);},canDraw:()=>draw,startDraw:e=>calls.push(['start',e.clientX,e.clientY]),moveDraw:e=>calls.push(['move',e.clientX,e.clientY]),endDraw:()=>calls.push(['end']),cancelDraw:()=>calls.push(['cancel']),hover:()=>calls.push(['hover'])});
  const fire=(type,x,y,extra={})=>{const event={clientX:x,clientY:y,pointerId:1,pointerType:'touch',button:0,preventDefault(){this.prevented=true;},...extra};handlers.get(type)(event);return event;};
  return{fire,paper,calls,nav,captured,classes,get zoom(){return zoom;}};
}

test('mouse and single-finger hand drags move even a fitted paper without editing',()=>{
  for(const pointerType of ['mouse','touch']){
    const s=setup(),before=s.paper.getBoundingClientRect();
    s.fire('pointerdown',250,200,{pointerType});s.fire('pointermove',290,230,{pointerType});s.fire('pointerup',290,230,{pointerType});
    const after=s.paper.getBoundingClientRect();assert.equal(after.left-before.left,40);assert.equal(after.top-before.top,30);assert.deepEqual(s.calls,[]);assert.equal(s.captured.size,0);assert.equal(s.classes.size,0);
    s.nav.reset();assert.deepEqual(s.paper.getBoundingClientRect(),before);
  }
});

test('pinch zoom follows finger distance and centroid, including two-finger translation',()=>{
  const s=setup(true);
  s.fire('pointerdown',250,250);s.fire('pointerdown',350,250,{pointerId:2});
  s.fire('pointermove',200,270);s.fire('pointermove',400,270,{pointerId:2});
  assert.equal(s.zoom,2);const r=s.paper.getBoundingClientRect();assert.equal(r.left+r.width/2,300);assert.equal(r.top+r.height/2,270);assert.deepEqual(s.calls,[]);
  s.fire('pointermove',220,300);s.fire('pointermove',420,300,{pointerId:2});
  const moved=s.paper.getBoundingClientRect();assert.equal(s.zoom,2);assert.equal(moved.left+moved.width/2,320);assert.equal(moved.top+moved.height/2,300);
});

test('a second finger cancels an already-started stroke, and lifting one finger never resumes painting',()=>{
  const s=setup(true);s.fire('pointerdown',250,250);s.fire('pointermove',260,250);
  s.fire('pointerdown',350,250,{pointerId:2});assert.deepEqual(s.calls.map(c=>c[0]),['start','move','cancel']);
  s.fire('pointerup',350,250,{pointerId:2});s.fire('pointermove',270,260);s.fire('pointerup',270,260);
  assert.deepEqual(s.calls.map(c=>c[0]),['start','move','cancel']);assert.equal(s.captured.size,0);
  s.fire('pointerdown',280,260);s.fire('pointerup',280,260);assert.deepEqual(s.calls.slice(-2).map(c=>c[0]),['start','end']);
});

test('a touch tap draws once on release while a mouse stroke starts immediately',()=>{
  const s=setup(true);s.fire('pointerdown',250,250);assert.deepEqual(s.calls,[]);s.fire('pointerup',250,250);assert.deepEqual(s.calls.map(c=>c[0]),['start','end']);
  const mouse=setup(true);mouse.fire('pointerdown',250,250,{pointerType:'mouse'});assert.equal(mouse.calls[0][0],'start');mouse.fire('pointermove',260,250,{pointerType:'mouse'});mouse.fire('pointerup',260,250,{pointerType:'mouse'});assert.deepEqual(mouse.calls.map(c=>c[0]),['start','move','end']);
});

test('canceled pending touches never paint; a lost capture cancels an active stroke',()=>{
  const s=setup(true);s.fire('pointerdown',250,250);s.fire('pointercancel',250,250);assert.deepEqual(s.calls,[]);
  s.fire('pointerdown',250,250);s.fire('pointermove',260,250);s.fire('lostpointercapture',260,250);assert.equal(s.calls.at(-1)[0],'cancel');assert.equal(s.captured.size,0);
});

test('wheel zoom preserves its anchor beyond 400% and retains the minimum',()=>{
  const s=setup();const e=s.fire('wheel',350,280,{deltaY:-120,deltaMode:0});assert.equal(e.prevented,true);
  const r=s.paper.getBoundingClientRect();assert.ok(Math.abs(r.left+r.width*.75-350)<1e-9);assert.ok(Math.abs(r.top+r.height*.65-280)<1e-9);
  for(let i=0;i<12;i++)s.fire('wheel',350,280,{deltaY:-240,deltaMode:0});assert.ok(s.zoom>80);
  for(let i=0;i<30;i++)s.fire('wheel',350,280,{deltaY:240,deltaMode:0});assert.equal(s.zoom,.5);
  s.nav.reset();s.fire('pointerdown',250,250);s.fire('pointerdown',350,250,{pointerId:2});s.fire('pointermove',200,250);s.fire('pointermove',400,250,{pointerId:2});assert.equal(s.zoom,1);
});

test('two-finger zoom goes beyond 400% and still follows its centroid',()=>{
  const s=setup(),r=s.paper.getBoundingClientRect(),a={x:(300-r.left)/r.width,y:(250-r.top)/r.height};
  s.fire('pointerdown',250,250);s.fire('pointerdown',350,250,{pointerId:2});
  s.fire('pointermove',-300,250);s.fire('pointermove',900,250,{pointerId:2});assert.equal(s.zoom,12);
  s.fire('pointermove',-280,280);s.fire('pointermove',920,280,{pointerId:2});assert.equal(s.zoom,12);
  const after=s.paper.getBoundingClientRect();assert.equal(after.left+a.x*after.width,320);assert.equal(after.top+a.y*after.height,280);
});

test('middle mouse drags pan even with a drawing tool selected',()=>{
  const s=setup(true);s.fire('pointerdown',250,250,{pointerType:'mouse',button:1});s.fire('pointermove',280,270,{pointerType:'mouse',button:1});s.fire('pointerup',280,270,{pointerType:'mouse',button:1});assert.deepEqual(s.calls,[]);assert.match(s.paper.style.transform,/30px, 20px/);
});

test('zoom has no application maximum and rejects non-finite values',()=>{
  assert.equal(normalizeZoom(1000000,1),1000000);
  assert.equal(normalizeZoom(Infinity,12),12);
  assert.equal(normalizeZoom(NaN,12),12);
  assert.equal(normalizeZoom(.01,12),.5);
});
