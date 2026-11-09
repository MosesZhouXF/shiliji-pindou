import {test} from 'node:test';
import assert from 'node:assert/strict';
import {replaceColor,countColors} from '../dist/engine.js';

test('replacement reaches all disconnected regions, preserving transparency and the original for undo',()=>{
  const grid=['G9','H7',null,'G9','G1','G9'],before=grid.slice();
  const out=replaceColor(grid,'G9','F9');
  assert.deepEqual(out,['F9','H7',null,'F9','G1','F9']);
  assert.deepEqual(grid,before);
  assert.deepEqual(replaceColor(out,'F9','G9'),grid);
});

test('replacement merges usage totals when the target color already exists',()=>{
  const grid=['G9','F9',null,'G9','H7'];
  const out=replaceColor(grid,'G9','F9');
  assert.deepEqual(countColors(out),[{code:'F9',count:3},{code:'H7',count:1}]);
  assert.equal(out.length,grid.length);
});

test('same color, absent source, and missing choices leave the grid unchanged',()=>{
  const grid=['G9',null,'H7'];
  for(const [from,to]of [['G9','G9'],['F9','G9'],[null,'G9'],['G9',null]])assert.deepEqual(replaceColor(grid,from,to),grid);
  assert.deepEqual(replaceColor([],'G9','F9'),[]);
});
