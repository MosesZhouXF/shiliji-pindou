import {test} from 'node:test';
import assert from 'node:assert/strict';
import {floodFill,countColors,validateProject} from '../dist/engine.js';

test('bucket fills only the clicked four-connected color region and leaves the input available for undo',()=>{
  const grid=['red','red','black','red','red','black','red','black','red'],before=grid.slice();
  const out=floodFill(grid,3,3,0,'blue');
  assert.deepEqual(out,['blue','blue','black','blue','blue','black','blue','black','red']);assert.deepEqual(grid,before);
});

test('diagonal contacts and row wrapping do not connect separate fill regions',()=>{
  const diagonal=['red','black','black','red'];assert.deepEqual(floodFill(diagonal,2,2,0,'blue'),['blue','black','black','red']);
  const rowEdge=['black','red','red','black'];assert.deepEqual(floodFill(rowEdge,2,2,1,'blue'),['black','blue','red','black']);
});

test('bucket fills transparent regions independently of enclosed holes and updates bead totals',()=>{
  const grid=Array(49).fill(null);for(let y=1;y<=5;y++)for(let x=1;x<=5;x++)if(x===1||x===5||y===1||y===5)grid[y*7+x]='black';
  const out=floodFill(grid,7,7,0,'red');assert.equal(out[24],null);assert.equal(out.filter(c=>c==='red').length,24);assert.equal(grid[0],null);
  const cleared=floodFill(out,7,7,8,null);assert.equal(cleared.filter(c=>c==='black').length,0);assert.equal(countColors(cleared).reduce((sum,c)=>sum+c.count,0),24);
  assert.deepEqual(validateProject({format:'douge-v1',width:7,height:7,grid:out},[{code:'black'},{code:'red'}]).grid,out);
});

test('same-color and invalid clicks are no-ops and a full-size fill needs no recursion',()=>{
  const grid=Array(192*192).fill('red');assert.deepEqual(floodFill(grid,192,192,0,'red'),grid);
  for(const i of [-1,grid.length,1.5])assert.deepEqual(floodFill(grid,192,192,i,'blue'),grid);
  assert.ok(floodFill(grid,192,192,grid.length-1,'blue').every(c=>c==='blue'));assert.deepEqual(floodFill([],0,0,0,'blue'),[]);
});
