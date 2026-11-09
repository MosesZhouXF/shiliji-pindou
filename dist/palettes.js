import {rgbToLab} from './color.js';

const limits={A:26,B:32,C:29,D:26,E:24,F:25,G:21,H:23,M:15};
const order=(a,b)=>a.code.localeCompare(b.code,'en',{numeric:true});

// These smaller sets are coverage-based selections, not retail-kit inventories.
function selectColors(colors,count){
  const labs=colors.map(p=>rgbToLab(p.rgb)),chosen=[],used=new Set();
  const distance=(a,b)=>a.reduce((sum,v,i)=>sum+(v-b[i])**2,0);
  const nearest=colors.map(()=>Infinity);
  const add=index=>{if(index<0||used.has(index))return;used.add(index);chosen.push(colors[index]);for(let i=0;i<colors.length;i++)nearest[i]=Math.min(nearest[i],distance(labs[i],labs[index]));};
  for(const code of ['H7','H2','H6','H4','G1','G2','G7','G6','F9','F14','E2','M12'])add(colors.findIndex(p=>p.code===code));
  while(chosen.length<Math.min(count,colors.length)){
    let best=-1,score=-1;for(let i=0;i<colors.length;i++)if(!used.has(i)&&nearest[i]>score){score=nearest[i];best=i;}
    if(best<0)break;add(best);
  }
  return chosen.sort(order);
}

export function createPaletteCatalog(allColors){
  const full=[...allColors].sort(order),standard=full.filter(p=>{const match=/^([A-Z]+)(\d+)$/.exec(p.code);return match&&+match[2]>=1&&+match[2]<=limits[match[1]];});
  return [
    {id:'MARD-291',name:'MARD · 291 色（扩展）',note:'包含 221 色基础色号与 P、Q、R、T、Y、ZG 扩展组。',colors:full},
    {id:'MARD-221',name:'MARD · 221 色',note:'A、B、C、D、E、F、G、H、M 九组基础色号。',colors:standard},
    {id:'MARD-144-selected',name:'MARD · 精选 144 色',note:'从 221 色中按颜色覆盖精选，并非官方套装；请按色号备料。',colors:selectColors(standard,144)},
    {id:'MARD-96-selected',name:'MARD · 精选 96 色',note:'从 221 色中按颜色覆盖精选，并非官方套装；请按色号备料。',colors:selectColors(standard,96)}
  ];
}
