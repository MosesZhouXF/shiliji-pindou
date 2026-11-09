import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPaletteCatalog} from '../dist/palettes.js';
import {convert,matchPalette,countColors,validateProject} from '../dist/engine.js';

const all=JSON.parse((await readFile(new URL('../dist/palette.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
const catalog=createPaletteCatalog(all);

test('MARD 221 contains exactly the nine standard groups, excluding extension colors',()=>{
  const colors=catalog.find(p=>p.id==='MARD-221').colors,groups={};
  for(const p of colors){const group=p.code.match(/^[A-Z]+/)[0];groups[group]=(groups[group]||0)+1;}
  assert.equal(colors.length,221);assert.deepEqual(groups,{A:26,B:32,C:29,D:26,E:24,F:25,G:21,H:23,M:15});
  assert.ok(!colors.some(p=>p.code==='P1'||p.code==='T1'));assert.ok(colors.some(p=>p.code==='H7'));
});

test('selected palettes have exact sizes, stable membership and original MARD RGB values',()=>{
  const original=structuredClone(all),map=new Map(all.map(p=>[p.code,p])),standard=new Set(catalog[1].colors.map(p=>p.code));
  for(const [id,size]of [['MARD-291',291],['MARD-221',221],['MARD-144-selected',144],['MARD-96-selected',96]]){
    const colors=catalog.find(p=>p.id===id).colors;assert.equal(colors.length,size);assert.equal(new Set(colors.map(p=>p.code)).size,size);
    for(const p of colors){assert.deepEqual(p.rgb,map.get(p.code).rgb);if(size<221)assert.ok(standard.has(p.code));}
    for(const code of ['H7','H2','H6','G1','G7','F9'])assert.ok(colors.some(p=>p.code===code));
  }
  const larger=new Set(catalog[2].colors.map(p=>p.code));assert.ok(catalog[3].colors.every(p=>larger.has(p.code)));
  assert.deepEqual(createPaletteCatalog(all),catalog);assert.deepEqual(all,original);
});

test('conversion and project recoloring use only the selected palette and preserve transparency',()=>{
  const data=Uint8ClampedArray.from(Array.from({length:32*24},(_,i)=>[i%256,(i*13)%256,(i*7)%256,i%32<2?0:255]).flat());
  const projectGrid=['P1','ZG1','H7',null,'R27','G1'],map=new Map(all.map(p=>[p.code,p.rgb]));
  for(const definition of catalog){
    const allowed=new Set(definition.colors.map(p=>p.code));
    const result=convert({data,width:32,height:24,palette:definition.colors,options:{mode:'cartoon',size:16,maxColors:12}});
    assert.ok(countColors(result.grid).length<=12);assert.ok(result.grid.every(c=>c===null||allowed.has(c)));
    const remapped=matchPalette(projectGrid.map(c=>c===null?null:map.get(c)),definition.colors,definition.colors.length);
    assert.deepEqual(remapped.map(c=>c===null),projectGrid.map(c=>c===null));assert.ok(remapped.every(c=>c===null||allowed.has(c)));
  }
});

test('saved palette identity survives validation and legacy projects default to MARD 291',()=>{
  const project={format:'douge-v1',palette:'MARD-221',width:2,height:1,mode:'pixel',grid:['H7',null]};
  const restored=validateProject(project,all);assert.equal(restored.paletteId,'MARD-221');assert.deepEqual(restored.grid,project.grid);
  const {palette,...legacy}=project;assert.equal(validateProject(legacy,all).paletteId,'MARD-291');
});
