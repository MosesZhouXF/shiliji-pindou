import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {convert,rgbToLab,deltaE,removeBackground,matchPalette,countColors,cleanSpeckles,validateProject,fitSubject,keepLargestRegion,addOutline,trimLightBorder,simplifyColors} from '../dist/engine.js';
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

test('keep largest region removes every detached component without changing colors or positions',()=>{
  const grid=Array(49).fill(null);grid[0]='red';grid[1]='white';grid[16]='red';grid[17]='black';grid[23]='white';grid[24]='red';grid[47]='black';
  const result=keepLargestRegion(grid,7,7);
  assert.deepEqual(result.map((c,i)=>c?i:-1).filter(i=>i>=0),[16,17,23,24]);
  for(const i of [16,17,23,24])assert.equal(result[i],grid[i]);
  assert.equal(grid[0],'red','input and undo snapshot stay unchanged');
});
test('largest region treats diagonal contacts as connected and resolves ties consistently',()=>{
  const grid=Array(25).fill(null);grid[0]='red';grid[6]='black';grid[19]='white';grid[24]='red';
  const result=keepLargestRegion(grid,5,5);
  assert.equal(result[0],'red');assert.equal(result[6],'black');assert.equal(result[19],null);assert.equal(result[24],null);
  assert.deepEqual(keepLargestRegion(Array(9).fill(null),3,3),Array(9).fill(null));
});
test('outline adds exactly one exterior layer in the chosen bead code',()=>{
  const grid=Array(25).fill(null);grid[12]='red';
  const result=addOutline(grid,5,5,'black');
  assert.equal(result[12],'red');assert.equal(result.filter(c=>c==='black').length,8);assert.equal(result[0],null);
  assert.deepEqual(countColors(result),[{code:'black',count:8},{code:'red',count:1}]);
  assert.equal(grid.filter(Boolean).length,1,'input remains available to undo');
});
test('outline preserves enclosed holes and does not overwrite existing bead colors',()=>{
  const grid=Array(49).fill(null);for(let y=2;y<=4;y++)for(let x=2;x<=4;x++)if(x!==3||y!==3)grid[y*7+x]='red';
  const result=addOutline(grid,7,7,'black');
  assert.equal(result[24],null);assert.equal(result.filter(c=>c==='red').length,8);assert.equal(result.filter(c=>c==='black').length,16);
});
test('outline clips safely at edges and handles empty or full canvases',()=>{
  const grid=Array(9).fill(null);grid[0]='red';const result=addOutline(grid,3,3,'black');
  assert.equal(result.length,9);assert.equal(result.filter(c=>c==='black').length,3);assert.equal(result[8],null);
  assert.deepEqual(addOutline(Array(9).fill(null),3,3,'black'),Array(9).fill(null));
  assert.deepEqual(addOutline(Array(9).fill('red'),3,3,'black'),Array(9).fill('red'));
});
test('postprocessed grids remain valid editable projects and preserve exact bead totals',()=>{
  const grid=Array(25).fill(null);grid[12]='red';grid[0]='white';
  const processed=addOutline(keepLargestRegion(grid,5,5),5,5,'black');
  const p=validateProject({format:'douge-v1',width:5,height:5,grid:processed},small);
  assert.equal(countColors(p.grid).reduce((n,c)=>n+c.count,0),p.grid.filter(Boolean).length);
});

test('light border cleanup removes one exterior layer and preserves interior white details',()=>{
  const grid=Array(81).fill(null);
  for(let y=1;y<=7;y++)for(let x=1;x<=7;x++)grid[y*9+x]='white';
  for(let y=3;y<=5;y++)for(let x=3;x<=5;x++)grid[y*9+x]='red';
  grid[40]='white';
  const once=trimLightBorder(grid,9,9,small);
  assert.equal(grid.filter(Boolean).length,49);
  assert.equal(once.filter(Boolean).length,25,'only the outer one-cell ring is peeled');
  assert.equal(once[40],'white','white highlight enclosed in the subject survives');
  const twice=trimLightBorder(once,9,9,small);
  assert.equal(twice.filter(Boolean).length,9);assert.equal(twice[40],'white');
});
test('light border cleanup recognizes off-white but protects pale saturated colors and gray',()=>{
  const pal=[...small,{code:'offwhite',rgb:[252,247,248]},{code:'yellow',rgb:[255,255,180]},{code:'gray',rgb:[185,185,185]}];
  const grid=Array(25).fill(null);grid[6]='offwhite';grid[7]='yellow';grid[8]='gray';grid[12]='red';
  const result=trimLightBorder(grid,5,5,pal);
  assert.equal(result[6],null);assert.equal(result[7],'yellow');assert.equal(result[8],'gray');assert.equal(result[12],'red');
});
test('cleanup ignores white bordering an enclosed hole and safely handles edges and empty images',()=>{
  const grid=Array(49).fill(null);for(let y=1;y<=5;y++)for(let x=1;x<=5;x++)grid[y*7+x]='red';grid[24]=null;grid[23]='white';
  assert.equal(trimLightBorder(grid,7,7,small)[23],'white');
  assert.deepEqual(trimLightBorder(Array(9).fill(null),3,3,small),Array(9).fill(null));
  assert.deepEqual(trimLightBorder(['white'],1,1,small),[null]);
});
test('outlining a cleaned subject follows its color boundary without restoring the white halo',()=>{
  const grid=Array(49).fill(null);for(let y=1;y<=5;y++)for(let x=1;x<=5;x++)grid[y*7+x]='white';for(let y=2;y<=4;y++)for(let x=2;x<=4;x++)grid[y*7+x]='red';
  const result=addOutline(trimLightBorder(grid,7,7,small),7,7,'black');
  assert.equal(result.filter(c=>c==='white').length,0);assert.equal(result.filter(c=>c==='red').length,9);assert.equal(result.filter(c=>c==='black').length,16);
});

test('color simplification respects each cap, preserves silhouette and uses only existing bead colors',()=>{
  const grid=Array.from({length:20*12},(_,i)=>i%13===0?null:palette[(i*7)%28].code),original=grid.slice(),used=new Set(grid.filter(Boolean));
  for(const [strength,cap]of [['light',18],['standard',12],['strong',8]]){
    const result=simplifyColors(grid,20,12,palette,strength);
    assert.equal(result.length,grid.length);assert.ok(countColors(result).length<=cap);
    assert.deepEqual(result.map(c=>c===null),grid.map(c=>c===null));
    assert.ok(result.every(c=>c===null||used.has(c)));
    assert.deepEqual(result,simplifyColors(grid,20,12,palette,strength),'same inputs give deterministic output');
  }
  assert.deepEqual(grid,original);
});
test('simplification merges low-contrast flecks and retains high-contrast eyes and highlights',()=>{
  const pal=[{code:'gray',rgb:[170,160,160]},{code:'fleck',rgb:[180,170,170]},{code:'eye',rgb:[15,15,15]},{code:'highlight',rgb:[255,255,255]}];
  const grid=Array(81).fill('gray');grid[20]='fleck';grid[60]='fleck';grid[30]='eye';grid[50]='highlight';
  const result=simplifyColors(grid,9,9,pal,'standard');
  assert.equal(result.filter(c=>c==='fleck').length,0);assert.equal(result[30],'eye');assert.equal(result[50],'highlight');
});
test('simplification preserves a thin high-contrast line and enclosed transparent holes',()=>{
  const grid=Array.from({length:81},(_,i)=>i%9===4?'black':'white');grid[20]=null;
  const result=simplifyColors(grid,9,9,small,'strong');assert.deepEqual(result,grid);
});
test('simplification handles empty images and rejects unsupported strength',()=>{
  assert.deepEqual(simplifyColors(Array(9).fill(null),3,3,small),Array(9).fill(null));
  assert.throws(()=>simplifyColors(['red'],1,1,small,'unsupported'));
});
