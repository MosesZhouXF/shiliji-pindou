import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {repairOutline,countColors,validateProject,rgbToLab} from '../dist/engine.js';

const palette=[{code:'black',rgb:[0,0,0]},{code:'brown',rgb:[90,33,33]},{code:'white',rgb:[255,255,255]},{code:'pink',rgb:[255,150,190]}];
function rectangle(code='black'){
  const grid=Array(13*13).fill(null);
  for(let y=2;y<=10;y++)for(let x=2;x<=10;x++)grid[y*13+x]=x===2||x===10||y===2||y===10?code:'white';
  return grid;
}
test('repair uses the most frequent exterior boundary color rather than the overall or nearby color',()=>{
  const grid=rectangle();for(let x=2;x<=10;x++)grid[2*13+x]='brown';grid[2*13+5]='white';
  assert.equal(countColors(grid)[0].code,'white','interior fill is the overall majority');
  const result=repairOutline(grid,13,13,palette);
  assert.equal(result[2*13+5],'black','other boundary sides make black the dominant outline color');
  assert.equal(result[2*13+4],'brown','retain the existing local line');
});
test('repair follows the boundary majority even when it is a light colored outline',()=>{
  const grid=rectangle('pink'),expected=grid.slice();grid[2*13+5]=null;
  assert.deepEqual(repairOutline(grid,13,13,palette),expected);
});
test('repair accepts diagonal adjacency and staircase continuation at a slanted corner',()=>{
  const grid=Array(13*13).fill(null);
  for(let y=3;y<=10;y++)for(let x=3;x<=9;x++)grid[y*13+x]=x===3||x===9||y===10?'black':'white';
  for(let x=4;x<=8;x++)grid[2*13+x]='black';
  grid[2*13+4]='white';
  const result=repairOutline(grid,13,13,palette);
  assert.equal(result[2*13+4],'black');
  assert.equal(result[3*13+4],'white');
});
test('repair follows existing ink across one to three light or transparent edge gaps',()=>{
  for(const code of ['black','brown'])for(const gap of [1,2,3])for(const missing of ['white',null]){
    const grid=rectangle(code),expected=grid.slice();
    for(let x=5;x<5+gap;x++)grid[2*13+x]=missing;
    assert.deepEqual(repairOutline(grid,13,13,palette),expected);
    assert.equal(grid[2*13+5],missing,'keep source grid for undo');
  }
});
test('repair restores a missing corner without adding another outer ring',()=>{
  const expected=rectangle(),grid=expected.slice();grid[2*13+2]='white';
  const result=repairOutline(grid,13,13,palette);
  assert.deepEqual(result,expected);assert.equal(result.filter(Boolean).length,81);
});
test('repair preserves eyes, mouth, enclosed holes and completed outlines',()=>{
  const grid=rectangle();grid[5*13+4]='black';grid[5*13+6]='black';grid[5*13+8]='black';
  grid[7*13+5]='brown';grid[7*13+7]='brown';grid[8*13+6]=null;
  assert.deepEqual(repairOutline(grid,13,13,palette),grid);
  assert.deepEqual(repairOutline(Array(25).fill(null),5,5,palette),Array(25).fill(null));
  assert.deepEqual(repairOutline(Array(25).fill('pink'),5,5,palette),Array(25).fill('pink'));
});
test('repair declines long gaps, unsupported dots and incompatible endpoint colors',()=>{
  const long=rectangle();for(let x=4;x<=7;x++)long[2*13+x]='white';
  assert.deepEqual(repairOutline(long,13,13,palette),long);
  const unsupported=Array(13*13).fill(null);for(let y=2;y<=10;y++)for(let x=2;x<=10;x++)unsupported[y*13+x]='white';
  unsupported[2*13+4]='black';unsupported[2*13+6]='black';
  assert.deepEqual(repairOutline(unsupported,13,13,palette),unsupported);
  const mixed=rectangle();mixed[2*13+5]='white';for(let x=6;x<=10;x++)mixed[2*13+x]='brown';
  assert.equal(repairOutline(mixed,13,13,palette)[2*13+5],'white');
});
test('repair does not connect separate foreground pieces or wrap across rows',()=>{
  const grid=Array(13*13).fill(null);
  for(let y=2;y<=8;y++)for(let x=1;x<=4;x++)grid[y*13+x]=y===2?'black':'white';
  for(let y=2;y<=8;y++)for(let x=6;x<=9;x++)grid[y*13+x]=y===2?'black':'white';
  assert.deepEqual(repairOutline(grid,13,13,palette),grid);
  const edge=Array(25).fill(null);edge[4]='black';edge[5]='black';edge[6]='white';
  assert.deepEqual(repairOutline(edge,5,5,palette),edge);
});
test('repaired grid remains editable, uses existing colors and is stable after a completed repair',()=>{
  const grid=rectangle('brown');grid[2*13+5]='white';
  const result=repairOutline(grid,13,13,palette);
  assert.deepEqual(repairOutline(result,13,13,palette),result);
  assert.deepEqual(validateProject({format:'douge-v1',width:13,height:13,grid:result},palette).grid,result);
  assert.equal(countColors(result).reduce((n,c)=>n+c.count,0),81);
  assert.ok(result.every(c=>c===null||grid.includes(c)));
});

test('character example repairs exterior gaps while preserving interior cells and all existing dark ink',async()=>{
  const p=JSON.parse(await readFile(new URL('./fixtures/outline-character.pindou.json',import.meta.url),'utf8'));
  const colors=JSON.parse((await readFile(new URL('../dist/palette.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
  const labs=new Map(colors.map(c=>[c.code,rgbToLab(c.rgb)])),result=repairOutline(p.grid,p.width,p.height,colors);
  assert.ok(result.some((c,i)=>c!==p.grid[i]));assert.equal(result.length,p.grid.length);
  for(let i=0;i<p.grid.length;i++){
    if(p.grid[i]===null)continue;
    const x=i%p.width,y=Math.floor(i/p.width);
    let interior=x>0&&y>0&&x<p.width-1&&y<p.height-1;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(p.grid[(y+dy)*p.width+x+dx]===null)interior=false;
    if(interior||labs.get(p.grid[i])[0]<=45)assert.equal(result[i],p.grid[i]);
  }
  assert.ok(result.every(c=>c===null||p.grid.includes(c)));
});
