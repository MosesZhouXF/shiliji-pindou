import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {convert,rgbToLab,deltaE,removeBackground,matchPalette,countColors,cleanSpeckles,validateProject,fitSubject} from '../dist/engine.js';
const palette=JSON.parse((await readFile(new URL('../dist/palette.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
const small=[{code:'black',rgb:[0,0,0]},{code:'white',rgb:[255,255,255]},{code:'red',rgb:[255,0,0]}];
function image(w,h,fn){return Uint8ClampedArray.from(Array.from({length:w*h},(_,i)=>fn(i%w,Math.floor(i/w))).flat());}
test('CIEDE2000 matches published Sharma reference pairs',()=>{for(const [a,b,expected] of [[[50,2.6772,-79.7751],[50,0,-82.7485],2.0425],[[50,3.1571,-77.2803],[50,0,-82.7485],2.8615],[[50,2.8361,-74.02],[50,0,-82.7485],3.4412]])assert.ok(Math.abs(deltaE(a,b)-expected)<.0001);assert.ok(deltaE(rgbToLab([0,0,0]),rgbToLab([0,0,0]))<1e-8);});
test('each algorithm respects dimensions, real color codes, color cap and counts',()=>{const data=image(40,24,(x,y)=>[x*6,y*10,(x*y)%255,x<3?0:255]);for(const mode of ['photo','cartoon','structure','line','pixel']){const p=convert({data,width:40,height:24,options:{mode,size:16,maxColors:4},palette});assert.equal(p.width,16);assert.equal(p.height,10);assert.equal(p.grid.length,160);const counts=countColors(p.grid);assert.ok(counts.length<=4);assert.equal(counts.reduce((n,c)=>n+c.count,0),p.grid.filter(Boolean).length);assert.ok(p.grid.every(c=>c===null||palette.some(p=>p.code===c)));}});
test('linear-light averaging differs from cartoon dominant-color sampling',()=>{const data=image(64,8,x=>x%8<2?[0,0,0,255]:[255,255,255,255]);const common={data,width:64,height:8,palette:small};const photo=convert({...common,options:{mode:'photo',size:8,maxColors:3,cleanup:false}});const cartoon=convert({...common,options:{mode:'cartoon',size:8,maxColors:3,cleanup:false,outline:true}});assert.notDeepEqual(photo.grid,cartoon.grid);assert.equal(cartoon.grid[0],'black');});
test('transparent images remain empty in every algorithm',()=>{for(const mode of ['photo','cartoon','structure','line','pixel']){const p=convert({data:new Uint8ClampedArray(16*16*4),width:16,height:16,options:{mode,size:8,maxColors:2},palette:small});assert.ok(p.grid.every(c=>c===null));assert.deepEqual(countColors(p.grid),[]);}});
test('background removal clears connected exterior but preserves enclosed white',()=>{const data=image(9,9,(x,y)=>x>=2&&x<=6&&y>=2&&y<=6&&(x===2||x===6||y===2||y===6)?[0,0,0,255]:[255,255,255,255]);const result=removeBackground(data,9,9);assert.equal(result.removed,true);assert.equal(result.data[3],0);assert.equal(result.data[(4*9+4)*4+3],255);assert.equal(data[3],255);});
test('ambiguous corners refuse background removal',()=>{const data=image(8,8,x=>x<4?[255,255,255,255]:[0,0,0,255]);const p=removeBackground(data,8,8);assert.equal(p.removed,false);assert.ok(p.warning);assert.equal(p.data,data);});
test('palette cap never invents an unavailable bead code',()=>{const p=matchPalette([[251,5,0],[255,255,255],[10,10,10],null],small,1);assert.equal(new Set(p.filter(Boolean)).size,1);assert.equal(p[3],null);});
test('speckle cleanup protects high-contrast eye pixels',()=>{const grid=Array(9).fill('white');grid[4]='black';assert.equal(cleanSpeckles(grid,3,3,small)[4],'black');});
test('project validation rejects unknown colors, bad dimensions and grid lengths',()=>{const p={format:'douge-v1',width:2,height:1,grid:['red',null]};assert.deepEqual(validateProject(p,small).grid,p.grid);for(const invalid of [{...p,width:999},{...p,grid:['fake',null]},{...p,grid:['red']},{...p,format:'other'}])assert.throws(()=>validateProject(invalid,small));});

test('fit subject uses the 60 × 60 grid instead of retaining transparent margins',()=>{
  const data=image(120,120,(x,y)=>x>=40&&x<80&&y>=30&&y<90?[255,0,0,255]:[255,255,255,255]);
  const p=convert({data,width:120,height:120,options:{mode:'pixel',size:60,maxColors:3,background:true,fit:true},palette:small});
  const occupied=p.grid.map((v,i)=>v?i:-1).filter(i=>i>=0),xs=occupied.map(i=>i%60),ys=occupied.map(i=>Math.floor(i/60));
  assert.equal(p.width,60);assert.equal(p.height,60);
  assert.ok(Math.max(...ys)-Math.min(...ys)+1>=56,'subject should fill the height, with about one cell of padding');
  assert.ok(Math.abs((Math.max(...xs)-Math.min(...xs)+1)/(Math.max(...ys)-Math.min(...ys)+1)-2/3)<.04,'keep subject proportions');
});

test('fit subject ignores isolated outer dots and keeps nearby decorative regions',()=>{
  const data=image(120,120,(x,y)=>{
    const main=x>=45&&x<85&&y>=30&&y<90,decoration=x>=34&&x<40&&y>=55&&y<61;
    return main||decoration?[255,0,0,255]:(x===1&&y===1?[255,255,255,255]:[0,0,0,0]);
  });
  const cropped=fitSubject(data,120,120,60,60);
  assert.ok(cropped.cropped);assert.ok(cropped.width<70&&cropped.height<70,'tiny corner noise must not expand the crop');
  assert.equal(Array.from(cropped.data).filter((v,i)=>i%4===3&&v===255).length,40*60+6*6,'retain both the subject and detached decoration');
});
test('subject fitting handles empty and opaque images without introducing a border',()=>{
  for(const alpha of [0,255]){const data=image(16,16,()=>[255,0,0,alpha]),result=fitSubject(data,16,16,60,60);assert.equal(result.cropped,false);assert.equal(result.data,data);}
});
test('subject fitting keeps the requested rectangular canvas and can be disabled',()=>{
  const data=image(120,80,(x,y)=>x>=45&&x<75&&y>=20&&y<60?[255,0,0,255]:[0,0,0,0]);
  const p=convert({data,width:120,height:80,options:{mode:'pixel',size:60,maxColors:3,fit:true},palette:small});
  assert.equal(p.width,60);assert.equal(p.height,40);assert.equal(p.fitted,true);
  const original=convert({data,width:120,height:80,options:{mode:'pixel',size:60,maxColors:3,fit:false},palette:small});
  assert.equal(original.fitted,false);assert.ok(countColors(p.grid)[0].count>countColors(original.grid)[0].count);
});
