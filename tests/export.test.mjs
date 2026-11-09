import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPatternSheet} from '../dist/export.js';

const palette=new Map([
  ['H1',{code:'H1',hex:'#101010',rgb:[16,16,16]}],
  ['A1',{code:'A1',hex:'#ffffee',rgb:[255,255,238]}]
]);

test('sheet preserves cell colors, contrasting codes, coordinates and exact quantities',()=>{
  const sheet=createPatternSheet({width:2,height:2,grid:['H1',null,'A1','H1']},palette,'MARD 221');
  assert.match(sheet.svg,/<rect x="88" y="144" width="56" height="56" fill="#101010"/);
  assert.match(sheet.svg,/<text x="116" y="178"[^>]*fill="#fff"[^>]*>H1<\/text>/);
  assert.match(sheet.svg,/<text x="116" y="234"[^>]*fill="#26372b"[^>]*>A1<\/text>/);
  assert.match(sheet.svg,/>H1 · 2 颗<\/text>/);assert.match(sheet.svg,/>A1 · 1 颗<\/text>/);
  assert.match(sheet.svg,/>2 × 2 格 · MARD 221 · 2 色 · 3 颗<\/text>/);
  assert.match(sheet.svg,/<text x="172" y="124"[^>]*>2<\/text>/);
  assert.match(sheet.svg,/<text x="68" y="234"[^>]*>2<\/text>/);
  assert.ok(sheet.width>=880);assert.equal(sheet.pngWidth,sheet.width);
});

test('64-grid PNG is genuinely higher resolution while large projects stay within mobile allocation',()=>{
  const small=createPatternSheet({width:64,height:64,grid:Array(4096).fill('H1')},palette,'MARD 221');
  assert.equal(small.pngWidth,3760);assert.ok(small.pngWidth>2*(64*28));
  for(const [width,height] of [[192,192],[1,192],[192,1]]){
    const sheet=createPatternSheet({width,height,grid:Array(width*height).fill('H1')},palette,'MARD 221');
    assert.ok(sheet.pngWidth<=4096&&sheet.pngHeight<=4096);
    assert.ok(sheet.pngWidth*sheet.pngHeight<=16000000);
    assert.match(sheet.svg,new RegExp(`viewBox="0 0 ${sheet.width} ${sheet.height}"`));
    assert.ok(sheet.svg.includes(`${width*height} 颗`));
  }
});

test('text is escaped and exports do not mutate the editable grid',()=>{
  const project={width:1,height:1,grid:['H1']};const before=JSON.stringify(project);
  const sheet=createPatternSheet(project,palette,'MARD <221> & "colors"');
  assert.match(sheet.svg,/MARD &lt;221&gt; &amp; &quot;colors&quot;/);
  assert.equal(JSON.stringify(project),before);
});
