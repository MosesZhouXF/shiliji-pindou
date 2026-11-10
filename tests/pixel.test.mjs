import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {convert} from '../dist/engine.js';
import {recoverPixelGrid} from '../dist/pixel.js';

const palette=[{code:'black',rgb:[0,0,0]},{code:'white',rgb:[255,255,255]},{code:'red',rgb:[255,0,0]}];
function raster(xs,ys,cell){
  const width=xs.at(-1),height=ys.at(-1),data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const col=xs.findIndex(n=>n>x)-1,row=ys.findIndex(n=>n>y)-1;
    data.set(cell(col,row),(y*width+x)*4);
  }
  return {data,width,height};
}
const boundaries=(n,step)=>Array.from({length:n+1},(_,i)=>i*step);
const checker=(x,y)=>(x+y)%2?[255,0,0,255]:[0,0,0,255];
const run=(input,options={})=>convert({...input,palette,options:{mode:'pixel',pixelAuto:true,size:64,maxColors:3,...options}});

test('pixel auto recovers enlarged regular grids without changing cells or palette constraints',()=>{
  const p=run(raster(boundaries(16,16),boundaries(12,16),checker));
  assert.equal(p.width,16);assert.equal(p.height,12);assert.equal(p.pixelRecovery.status,'detected');
  assert.deepEqual(p.grid,Array.from({length:16*12},(_,i)=>(i%16+Math.floor(i/16))%2?'red':'black'));
});

test('dense two-pixel grids are evaluated for periodicity instead of rejected as broad gradients',()=>{
  const p=run(raster(boundaries(96,2),boundaries(96,2),checker));
  assert.equal(p.pixelRecovery.status,'detected');assert.equal(p.width,96);assert.equal(p.height,96);
  assert.deepEqual(p.grid,Array.from({length:96*96},(_,i)=>(i%96+Math.floor(i/96))%2?'red':'black'));
});

test('dense periodic grids tolerate small per-pixel color noise without changing bead colors',()=>{
  const input=raster(boundaries(96,2),boundaries(96,2),checker);
  for(let i=0;i<input.data.length;i++)if(i%4!==3)input.data[i]=Math.max(0,Math.min(255,input.data[i]+i%9-4));
  const p=run(input);
  assert.equal(p.width,96);assert.equal(p.height,96);assert.equal(p.pixelRecovery.status,'detected');
  assert.deepEqual(p.grid,Array.from({length:96*96},(_,i)=>(i%96+Math.floor(i/96))%2?'red':'black'));
});

test('pixel auto aligns uneven boundaries and preserves a rectangular canvas',()=>{
  const xs=boundaries(16,16).map((v,i)=>i>0&&i<16?v+(i%3-1)*3:v),ys=boundaries(12,16).map((v,i)=>i>0&&i<12?v+(i%3-1)*3:v);
  const p=run(raster(xs,ys,checker));
  assert.equal(p.width,16);assert.equal(p.height,12);assert.equal(p.pixelRecovery.aligned,true);
  assert.deepEqual(p.grid,Array.from({length:16*12},(_,i)=>(i%16+Math.floor(i/16))%2?'red':'black'));
});

test('native pixel artwork keeps every pixel including transparent cells and high contrast features',()=>{
  const cell=(x,y)=>x===7&&y===5?[0,0,0,255]:(x===0||y===0?[99,12,87,0]:[255,255,255,255]);
  const p=run(raster(boundaries(16,1),boundaries(12,1),cell),{fit:true,preprocess:'strong'});
  assert.equal(p.width,16);assert.equal(p.height,12);assert.equal(p.pixelRecovery.status,'native');
  assert.equal(p.fitted,false);assert.equal(p.preprocessed,null);assert.equal(p.preprocess,'off');
  assert.deepEqual(p.grid,Array.from({length:16*12},(_,i)=>i%16===0||i<16?null:i===5*16+7?'black':'white'));
});

test('subject fitting crops native pixel margins on whole cells without scaling the artwork',()=>{
  const input=raster(boundaries(64,1),boundaries(64,1),(x,y)=>x>=22&&x<42&&y>=18&&y<46?checker(x,y):[0,0,0,0]);
  const original=run(input,{fit:false}),fitted=run(input,{fit:true});
  assert.equal(fitted.fitted,true);assert.equal(fitted.width,30);assert.equal(fitted.height,30);
  assert.equal(original.width,64);assert.equal(fitted.pixelRecovery.status,'native');
  assert.equal(fitted.grid.filter(Boolean).length,original.grid.filter(Boolean).length);
  for(let y=0;y<28;y++)for(let x=0;x<20;x++)assert.equal(fitted.grid[(y+1)*30+x+5],original.grid[(y+18)*64+x+22]);
});

test('subject fitting preserves the detected grid before cropping pixel margins',()=>{
  const input=raster(boundaries(64,8),boundaries(64,8),(x,y)=>x>=14&&x<50&&y>=14&&y<50?checker(x,y):[0,0,0,0]);
  const original=run(input,{fit:false}),fitted=run(input,{fit:true});
  assert.equal(original.pixelRecovery.status,'detected');assert.equal(fitted.pixelRecovery.status,'detected');
  assert.equal(fitted.fitted,true);assert.equal(fitted.width,38);assert.equal(fitted.height,38);
  assert.equal(fitted.grid.filter(Boolean).length,36*36);
  assert.deepEqual(fitted.grid.filter(Boolean),original.grid.filter(Boolean));
});

test('subject fitting uses source detail at the requested size when no pixel grid is reliable',async()=>{
  const data=new Uint8ClampedArray(gunzipSync(await readFile(new URL('./fixtures/noisy-character.rgba.gz',import.meta.url))));
  const colors=JSON.parse((await readFile(new URL('../dist/palette.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
  const convertWith=fit=>convert({data,width:158,height:158,palette:colors,options:{mode:'pixel',pixelAuto:true,size:112,maxColors:18,background:true,fit}});
  const original=convertWith(false),fitted=convertWith(true);
  assert.equal(fitted.pixelRecovery.status,'fallback');assert.equal(fitted.width,112);assert.equal(fitted.height,112);
  assert.equal(fitted.fitted,true);assert.ok(fitted.grid.filter(Boolean).length>original.grid.filter(Boolean).length*1.3);
});

test('smooth gradients do not acquire a false grid and retain the requested dimensions',()=>{
  const width=240,height=180,data=Uint8ClampedArray.from(Array.from({length:width*height},(_,i)=>[i%width,Math.floor(i/width),80,255]).flat());
  const auto=run({data,width,height},{size:32}),manual=run({data,width,height},{size:32,pixelAuto:false});
  assert.equal(auto.pixelRecovery.status,'fallback');assert.equal(auto.width,32);assert.equal(auto.height,24);assert.deepEqual(auto.grid,manual.grid);
});

test('noisy character is not forced into a coarse grid and representative sampling removes tiny background regions',async()=>{
  // Lossless RGBA fixture from the user's 158 × 158 source; no image library needed.
  const data=new Uint8ClampedArray(gunzipSync(await readFile(new URL('./fixtures/noisy-character.rgba.gz',import.meta.url))));
  const colors=JSON.parse((await readFile(new URL('../dist/palette.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
  const options={mode:'pixel',size:64,maxColors:18,background:true,fit:false};
  const p=convert({data,width:158,height:158,palette:colors,options:{...options,pixelAuto:true}});
  const manual=convert({data,width:158,height:158,palette:colors,options:{...options,pixelAuto:false}});
  assert.equal(p.width,64);assert.equal(p.height,64);assert.equal(p.pixelRecovery.status,'fallback');
  assert.equal(p.pixelRecovery.sampling,'representative');assert.notDeepEqual(p.grid,manual.grid);
  const tinyRegions=grid=>{
    const seen=new Set();let tiny=0;
    for(let i=0;i<grid.length;i++){
      if(grid[i]===null||seen.has(i))continue;
      const queue=[i];seen.add(i);
      for(let n=0;n<queue.length;n++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const x=queue[n]%64+dx,y=Math.floor(queue[n]/64)+dy,j=y*64+x;
        if(x>=0&&y>=0&&x<64&&y<64&&grid[j]!==null&&!seen.has(j)){seen.add(j);queue.push(j);}
      }
      if(queue.length<=3)tiny++;
    }
    return tiny;
  };
  assert.equal(tinyRegions(manual.grid),2);assert.equal(tinyRegions(p.grid),0);
  assert.ok(new Set(p.grid.filter(Boolean)).size<=18);
});

test('representative sampling keeps source colors and supported center ink without averaging or extending its width',()=>{
  const width=192,height=192,data=new Uint8ClampedArray(width*height*4);
  for(let y=60;y<132;y++)for(let x=60;x<132;x++){
    const ink=x===85,rgb=ink?[0,0,0]:[255,255,255];data.set([...rgb,255],(y*width+x)*4);
  }
  const result=recoverPixelGrid(data,width,height,64,64,true);
  assert.equal(result.status,'fallback');assert.deepEqual(result.cells[30*64+28],[0,0,0]);
  assert.deepEqual(result.cells[30*64+27],[255,255,255]);assert.deepEqual(result.cells[30*64+29],[255,255,255]);
  assert.ok(result.cells.every(c=>c===null||c.every(v=>v===0)||c.every(v=>v===255)));
});

test('manual size wins over detected dimensions and a matching size may align boundaries',()=>{
  const input=raster(boundaries(16,16),boundaries(12,16),checker),p=run(input,{pixelAuto:false,size:32});
  assert.equal(p.width,32);assert.equal(p.height,24);assert.equal(p.pixelRecovery.status,'manual');
  const matching=run(input,{pixelAuto:false,size:16});
  assert.equal(matching.width,16);assert.equal(matching.height,12);assert.equal(matching.pixelRecovery.aligned,true);
});

test('empty images safely fall back and hidden transparent RGB does not create a grid',()=>{
  const input=raster(boundaries(16,16),boundaries(12,16),(x,y)=>[x%2*255,y%2*255,0,0]);
  const p=run(input);assert.equal(p.pixelRecovery.status,'fallback');assert.ok(p.grid.every(c=>c===null));
});

test('boundary alignment corrects cells missed by uniform center sampling',()=>{
  const xs=boundaries(16,16).map((v,i)=>i>0&&i<16?v+7+(i%3-1)*3:v),ys=boundaries(12,16);
  const input=raster(xs,ys,checker),p=run(input,{pixelAuto:false,size:16});
  assert.equal(p.pixelRecovery.aligned,true);
  const expected=Array.from({length:16*12},(_,i)=>(i%16+Math.floor(i/16))%2?'red':'black');
  const uniform=Array.from({length:16*12},(_,i)=>{
    const x=(i%16+.5)*16,y=(Math.floor(i/16)+.5)*16,col=xs.findIndex(n=>n>x)-1,row=ys.findIndex(n=>n>y)-1;
    return (col+row)%2?'red':'black';
  });
  assert.notDeepEqual(uniform,expected);assert.deepEqual(p.grid,expected);
});

test('native small images with repeated blocks are never mistaken for a coarser grid',()=>{
  const input=raster(boundaries(16,4),boundaries(12,4),checker),p=run(input);
  assert.equal(p.width,64);assert.equal(p.height,48);assert.equal(p.pixelRecovery.status,'native');
});

test('existing character artwork produces identical bead cells at native and enlarged resolutions',async()=>{
  const project=JSON.parse(await readFile(new URL('./fixtures/pixel-character.pindou.json',import.meta.url),'utf8'));
  const colors=JSON.parse((await readFile(new URL('../dist/palette.json',import.meta.url),'utf8')).replace(/^\uFEFF/,'')),byCode=new Map(colors.map(c=>[c.code,c.rgb]));
  const cell=(x,y)=>{const code=project.grid[y*project.width+x];return code?[...byCode.get(code),255]:[120,200,30,0];};
  const convertAt=step=>convert({...raster(boundaries(project.width,step),boundaries(project.height,step),cell),palette:colors,options:{mode:'pixel',pixelAuto:true,size:80,maxColors:18}});
  const native=convertAt(1),enlarged=convertAt(8);
  assert.equal(native.width,project.width);assert.equal(native.height,project.height);
  assert.equal(enlarged.pixelRecovery.status,'detected');assert.equal(enlarged.width,project.width);assert.equal(enlarged.height,project.height);
  assert.deepEqual(enlarged.grid,native.grid);
  const input=raster(boundaries(project.width,1),boundaries(project.height,1),cell),original=input.data.slice();
  run(input);assert.deepEqual(input.data,original);
});
