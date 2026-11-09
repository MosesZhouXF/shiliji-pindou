import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {convertFlat} from '../dist/flat.js';
import {countColors,validateProject} from '../dist/engine.js';
const cv=await createRequire(import.meta.url)('../dist/vendor/opencv.js');
const palette=[{code:'white',rgb:[255,255,255]},{code:'ink',rgb:[90,33,33]},{code:'peach',rgb:[255,225,210]},{code:'yellow',rgb:[255,215,110]},{code:'red',rgb:[190,40,40]}];
function source(w,h,fn){return Uint8ClampedArray.from(Array.from({length:w*h},(_,i)=>fn(i%w,Math.floor(i/w))).flat());}
function run(data,width,height,extra={}){return convertFlat({data,width,height,palette,options:{size:32,maxColors:5,background:true,fit:true,...extra}},cv);}
function sticker(){return source(96,96,(x,y)=>{
  if(x<8||x>87||y<8||y>87)return[25,230,20,0];
  if(x<18||x>77||y<18||y>77)return[255,255,255,255];
  if(x<21||x>74||y<21||y>74)return[90,33,33,255];
  if((x>=33&&x<=37||x>=57&&x<=61)&&y>=35&&y<=47)return[50,25,20,255];
  return x<48?[255,225,210,255]:[255,255,255,255];
});}

test('flat mode trims the exterior halo, keeps enclosed white and pale skin, and never edits input pixels',()=>{
  const data=sticker(),before=data.slice(),p=run(data,96,96);
  assert.deepEqual(data,before);assert.equal(p.width,32);assert.equal(p.height,32);assert.equal(p.mode,'flat');
  assert.equal(p.grid[0],null);assert.ok(p.grid.includes('white'));assert.ok(p.grid.includes('peach'));assert.ok(p.grid.includes('ink'));
  assert.notEqual(p.grid[20*32+20],null,'inside the face must remain occupied');
});

test('flat output obeys the chosen palette, color budget, stroke color and save format',()=>{
  const p=run(sticker(),96,96,{maxColors:3,flat:{strokeCode:'red'}});
  assert.ok(countColors(p.grid).length<=3);assert.ok(p.grid.includes('red'));
  assert.deepEqual(validateProject({format:'douge-v1',palette:'custom',width:p.width,height:p.height,grid:p.grid,mode:'flat'},palette).grid,p.grid);
  assert.equal(countColors(p.grid).reduce((n,c)=>n+c.count,0),p.grid.filter(Boolean).length);
  assert.ok(p.preprocessed.data instanceof Uint8ClampedArray);
});

test('transparent and white-background images produce empty grids without leaking hidden RGB',()=>{
  for(const data of [source(20,10,()=>[255,40,80,0]),source(20,10,()=>[255,255,255,255])]){
    const p=run(data,20,10);assert.equal(p.width,32);assert.equal(p.height,16);assert.ok(p.grid.every(c=>c===null));
  }
});

test('subject fitting derives a rectangular grid, can be disabled, and preserves an alpha hole',()=>{
  const data=source(120,80,(x,y)=>x>=20&&x<100&&y>=25&&y<55?x>=50&&x<70&&y>=32&&y<48?[0,0,0,0]:[255,215,110,255]:[0,0,0,0]);
  const p=run(data,120,80,{background:false});assert.equal(p.width,32);assert.equal(p.height,12);assert.equal(p.grid[6*32+16],null);
  const full=run(data,120,80,{fit:false,background:false});assert.equal(full.width,32);assert.equal(full.height,21);assert.equal(full.grid[0],null);
});

test('flat settings are deterministic across runs and reject invalid ranges',()=>{
  const data=sticker(),options={flat:{outer:4,detail:80,flatness:30,strokeCode:'ink'}};
  assert.deepEqual(run(data,96,96,options).grid,run(data,96,96,options).grid);
  for(const flat of [{outer:-1},{outer:2.5},{outer:5},{detail:101},{flatness:-1}])assert.throws(()=>run(data,96,96,{flat}),/参数无效/);
});
