import {countColors,validateProject,keepLargestRegion,addOutline,repairOutline,trimLightBorder,simplifyColors,matchPalette,floodFill,replaceColor} from './engine.js';
import {createPaletteCatalog} from './palettes.js';
import {attachNavigation,normalizeZoom} from './navigation.js';
import {createPatternSheet} from './export.js';
const $=id=>document.getElementById(id);
const names={flat:'描边平涂',cartoon:'卡通保边',photo:'照片保真',structure:'结构抽象',line:'黑白线稿',pixel:'像素原样'};
const descriptions={flat:'先分离线稿与色块，再平涂和保线采样；适合带描边的手绘插画。',cartoon:'主色取样，自动保护小面积细线，避免眼线整格变粗。',photo:'线性光区域平均，保留明暗与色彩关系。',structure:'依据颜色与位置迭代聚合，简化复杂细节。',line:'保留深色结构，再进行黑白亮度分割。',pixel:'自动识别并对齐像素格；无可靠网格时按格内主色取样，也可手动设置格数。'};
const processingPresets={off:[0,64,0,0,90],light:[25,48,5,2,90],standard:[45,32,7,4,90],strong:[70,24,8,6,90]};
const processingFields=[['smoothing','source-smoothing'],['sourceColors','source-colors'],['mergeDistance','merge-distance'],['speckleArea','speckle-area'],['inkThreshold','ink-threshold']];
function updateProcessingControls(){
  const isFlat=mode==='flat',isPixel=mode==='pixel';$('pixel-settings').hidden=!isPixel;$('pixel-auto').disabled=!source;$('pixel-grid-status').textContent=isPixel&&project?.mode==='pixel'?pixelStatus(project):'';$('size-value').value=isPixel&&$('pixel-auto').checked?'自动':$('size').value;$('fit').disabled=!source||isPixel;$('fit').closest('label').querySelector('small').textContent=isFlat?'裁掉外围留白，按主体比例生成图纸':'裁掉透明留白，四周约留一格';$('flat-settings').hidden=!isFlat;$('preprocess').hidden=isFlat||isPixel;document.querySelector('label[for="preprocess"]').hidden=isFlat||isPixel;$('preprocess').nextElementSibling.hidden=isFlat||isPixel;document.querySelector('.processing-settings').hidden=isFlat||isPixel;$('fit').closest('label').hidden=isPixel;
  for(const id of ['preprocess','outline','cleanup']){$(id).disabled=!source||isFlat||isPixel;if(id!=='preprocess')$(id).closest('label').hidden=isFlat||isPixel;}
  for(const id of ['flat-outer','flat-detail','flat-flatness']){$(id+'-value').value=$(id).value;$(id).disabled=!source;}
  $('flat-stroke-color').disabled=!source;

  for(const [key,id]of processingFields){$(id+'-value').value=$(id).value;$(id).disabled=!source||((key==='smoothing'||key==='sourceColors')&&$('preprocess').value==='off')||(key==='inkThreshold'&&(mode!=='cartoon'||!$('outline').checked))||(['mergeDistance','speckleArea'].includes(key)&&['pixel','line'].includes(mode))||(key==='speckleArea'&&!$('cleanup').checked);}
  $('reset-processing').disabled=!source;
}
function applyProcessingPreset(name){const values=processingPresets[name]||processingPresets.light;processingFields.forEach(([,id],i)=>{$(id).value=values[i];});updateProcessingControls();}
let palette=[],paletteMap=new Map(),paletteCatalog=[],activePaletteId='MARD-221',paletteTarget='brush',source=null,pixelSource=null,sourceName='花园里的小橘猫',project=null,mode='cartoon',tool='inspect',selected=null,zoom=1,worker=null,request=0,sourceRequest=0,generating=false,history=[],future=[],drawing=false,strokeSaved=false,debounce,toastTimer,originalUrl=null;
const canvas=$('pattern'),ctx=canvas.getContext('2d');
let replaceFrom=null,replaceTo=null,flatStroke=null;
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function setBusy(value){generating=value;$('busy').hidden=!value;for(const id of ['generate','export-png','export-svg','export-csv','export-project','keep-subject','trim-light','simplify-colors','simplify-level','add-stroke','repair-stroke','stroke-color','tidy-pattern','replace-colors'])$(id).disabled=value||!project;$('generate').disabled=value||!source;updateReplacement();}
function snapshot(){if(project){history.push({...project,grid:project.grid.slice()});if(history.length>30)history.shift();future=[];}updateHistory();}
function updateHistory(){$('undo').disabled=!history.length;$('redo').disabled=!future.length;}
function colorHex(rgb){return '#'+rgb.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');}
function paletteDefinition(id=activePaletteId){return paletteCatalog.find(p=>p.id===id)||paletteCatalog[0];}
function setStrokeColor(code){const p=paletteMap.get(code);if(!p)return;$('stroke-color').value=code;$('stroke-swatch').style.background=p.hex;$('stroke-label').textContent=code+' · '+p.hex.toUpperCase();$('stroke-color').setAttribute('aria-label','选择描边颜色，当前 '+code);}
function setFlatStroke(code){const p=paletteMap.get(code);if(!p)return;flatStroke=code;$('flat-stroke-swatch').style.background=p.hex;$('flat-stroke-label').textContent=code+' · '+p.hex.toUpperCase();$('flat-stroke-color').setAttribute('aria-label','选择平涂描边颜色，当前 '+code);}
function activatePalette(id){
  const definition=paletteDefinition(id);activePaletteId=definition.id;palette=definition.colors;$('palette-select').value=activePaletteId;$('palette-note').textContent=definition.note;
  const codes=new Set(palette.map(p=>p.code)),nearest=code=>paletteMap.has(code)?matchPalette([paletteMap.get(code).rgb],palette,palette.length)[0]:codes.has('H7')?'H7':palette[0].code;
  if(selected&&!codes.has(selected))selected=nearest(selected);
  const stroke=$('stroke-color').value;setStrokeColor(codes.has(stroke)?stroke:nearest(stroke));setFlatStroke(codes.has(flatStroke)?flatStroke:flatStroke?nearest(flatStroke):matchPalette([[90,33,33]],palette,1)[0]);
}
function restoreProjectPalette(){
  const definition=paletteDefinition(project.paletteId),codes=new Set(definition.colors.map(p=>p.code));
  const id=project.grid.every(c=>c===null||codes.has(c))?definition.id:'MARD-291';project.paletteId=id;
  if(activePaletteId!==id)activatePalette(id);
}
function options(){return {mode,size:+$('size').value,maxColors:+$('colors').value,outline:$('outline').checked,cleanup:$('cleanup').checked,background:$('background').checked,fit:mode!=='pixel'&&$('fit').checked,preprocess:mode==='pixel'?'off':$('preprocess').value,pixelAuto:mode==='pixel'&&$('pixel-auto').checked,flat:{outer:+$('flat-outer').value,detail:+$('flat-detail').value,flatness:+$('flat-flatness').value,strokeCode:flatStroke},processing:Object.fromEntries(processingFields.map(([key,id])=>[key,+$(id).value]))};}
function queueGenerate(){clearTimeout(debounce);if(source){if(worker){worker.terminate();worker=null;}request++;setBusy(true);debounce=setTimeout(generate,220);}else toast('这是已保存的图纸，导入原图后可重新转换。');}
function generate(){
  if(!source)return;
  clearTimeout(debounce);worker?.terminate();const id=++request;setBusy(true);
  const inputSource=mode==='pixel'?pixelSource:source;
  const paletteId=activePaletteId,size=+$('size').value,workSize=['flat','pixel'].includes(mode)?1600:$('preprocess').value==='off'?size*6:Math.min(768,Math.max(512,size*6)),scale=Math.min(1,workSize/Math.max(inputSource.width,inputSource.height));
  const sample=document.createElement('canvas');sample.width=Math.max(1,Math.round(inputSource.width*scale));sample.height=Math.max(1,Math.round(inputSource.height*scale));
  const c=sample.getContext('2d',{willReadFrequently:true});c.imageSmoothingEnabled=mode!=='pixel';c.drawImage(inputSource,0,0,sample.width,sample.height);
  const image=c.getImageData(0,0,sample.width,sample.height);
  worker=mode==='flat'?new Worker(new URL('./flat-worker.js',import.meta.url)):new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{if(data.id!==request)return;if(data.error){setBusy(false);toast('转换失败：'+data.error);return;}snapshot();const {preprocessed,...result}=data.result;project={...result,paletteId};if(preprocessed){const preview=document.createElement('canvas');preview.width=preprocessed.width;preview.height=preprocessed.height;preview.getContext('2d').putImageData(new ImageData(preprocessed.data,preprocessed.width,preprocessed.height),0,0);project.preprocessedUrl=preview.toDataURL('image/png');}selected=selected||countColors(project.grid)[0]?.code;setBusy(false);update();if(project.warning)toast(project.warning);worker?.terminate();worker=null;};
  worker.onerror=()=>{if(id!==request)return;setBusy(false);toast('转换未能完成，请减少格数后重试。');worker?.terminate();worker=null;};
  worker.postMessage({id,data:image.data,width:sample.width,height:sample.height,options:options(),palette},[image.data.buffer]);
}
function pixelStatus(p){const status=p.pixelRecovery?.status;if(status==='detected')return `已识别 ${p.width} × ${p.height} 格`;if(status==='native')return `保留原生像素 ${p.width} × ${p.height} 格`;if(status==='fallback')return `无可靠网格 · 按设置生成 ${p.width} × ${p.height} 格 · 主色取样`;return `手动 ${p.width} × ${p.height} 格${p.pixelRecovery?.aligned?' · 已对齐边界':''}`;}
function update(){if(!project)return;if(mode==='pixel'&&project.mode==='pixel')$('pixel-grid-status').textContent=pixelStatus(project);restoreProjectPalette();render();$('view-processed').disabled=!project.preprocessedUrl;if(project.preprocessedUrl)$('processed').src=project.preprocessedUrl;else{if(!$('processed').hidden)setView(false);$('processed').removeAttribute('src');}const counts=countColors(project.grid),total=counts.reduce((n,c)=>n+c.count,0);$('stat-beads').textContent=total.toLocaleString('zh-CN');$('stat-colors').textContent=counts.length;$('stat-dimensions').textContent=`${project.width} × ${project.height} 格`;$('stat-physical').textContent=`约 ${project.width*.5} × ${project.height*.5} cm`;$('paper-size').textContent=`${project.width} × ${project.height}`;$('paper-meta').textContent=`${paletteDefinition(project.paletteId).name} · ${counts.length} COLORS`;$('preview-description').textContent=`${sourceName} · ${names[project.mode]||'导入图纸'}${project.preprocess&&project.preprocess!=='off'?' · 预处理'+({light:'轻度',standard:'标准',strong:'加强',custom:'自定义'}[project.preprocess]||''):''}`;
  $('palette-list').replaceChildren();for(const {code,count} of counts){const p=paletteMap.get(code),button=document.createElement('button');button.className='color-row'+(code===selected?' selected':'');button.setAttribute('aria-label',`${code}，${count} 颗`);button.setAttribute('aria-pressed',String(code===selected));button.innerHTML=`<span class="swatch" style="background:${p.hex}"></span><span><strong>${code}</strong><small>${p.hex.toUpperCase()}</small></span><span class="count">${count}<small>颗</small></span>`;button.onclick=()=>chooseColor(code);$('palette-list').append(button);}if(!counts.length)$('palette-list').textContent='图纸为空，可选色后用画笔绘制。';updateSelected();updateHistory();updateReplacement();setZoom(zoom);
}
function updateSelected(){const p=paletteMap.get(selected);$('selected-code').textContent=p?p.code:'选择一个色号';$('selected-swatch').style.background=p?.hex||'#f0ede5';$('rail-color-code').textContent=p?.code||'—';$('rail-color-swatch').style.background=p?.hex||'#f0ede5';$('rail-color').setAttribute('aria-label','选择画笔颜色'+(p?'，当前 '+p.code:''));}
function chooseColor(code){selected=code;updateSelected();for(const b of $('palette-list').children){const active=b.getAttribute('aria-label')?.startsWith(code+'，');b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));}}
function render(){if(!project)return;const showCodes=$('codes-toggle').checked,cell=showCodes?24:12,labels=[];canvas.width=project.width*cell;canvas.height=project.height*cell;ctx.clearRect(0,0,canvas.width,canvas.height);for(let y=0;y<project.height;y++)for(let x=0;x<project.width;x++){const code=project.grid[y*project.width+x];if(!code)continue;const p=paletteMap.get(code);ctx.fillStyle=p.hex;ctx.fillRect(x*cell,y*cell,cell,cell);if(showCodes){const color=p.rgb.reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)<145?'#fff':'#23392b';labels.push(`<text x="${(x+.5)*cell}" y="${(y+.5)*cell}" fill="${color}">${code}</text>`);}}
  const overlay=$('pattern-labels');overlay.setAttribute('viewBox',`0 0 ${canvas.width} ${canvas.height}`);overlay.innerHTML=labels.join('');overlay.toggleAttribute('hidden',!showCodes);
  if($('grid-toggle').checked){for(let x=0;x<=project.width;x++){ctx.strokeStyle=x%10===0?'#354a4559':'#354a451a';ctx.lineWidth=x%10===0?1:.5;ctx.beginPath();ctx.moveTo(x*cell,0);ctx.lineTo(x*cell,canvas.height);ctx.stroke();}for(let y=0;y<=project.height;y++){ctx.strokeStyle=y%10===0?'#354a4559':'#354a451a';ctx.lineWidth=y%10===0?1:.5;ctx.beginPath();ctx.moveTo(0,y*cell);ctx.lineTo(canvas.width,y*cell);ctx.stroke();}}
}
function setView(original){const view=original===true?'original':original==='processed'?'processed':'pattern';if(view==='original'&&!source){toast('工程文件只保存图纸，不包含原始图片。');return;}if(view==='processed'&&!project?.preprocessedUrl){toast('选择原图预处理强度后，可查看预处理图。');return;}$('pattern-surface').hidden=view!=='pattern';for(const [id,key]of [['pattern','pattern'],['original','original'],['processed','processed']])$(id).hidden=key!==view;for(const [id,key]of [['view-pattern','pattern'],['view-original','original'],['view-processed','processed']]){$(id).classList.toggle('active',key===view);$(id).setAttribute('aria-pressed',String(key===view));}}
function setTool(value){tool=value;$('canvas-stage').classList.toggle('can-pan',value==='inspect');for(const b of document.querySelectorAll('[data-tool]')){b.classList.toggle('active',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool));}$('current-tool').textContent={inspect:'拖动画布',brush:'画笔',eraser:'橡皮',fill:'油漆桶 · 连续区域',picker:'吸取色号'}[tool];$('tool-hint').textContent={inspect:'拖动画布：按住并拖动移动图纸，悬停查看色号；手机支持双指缩放和移动。',brush:'画笔：选择右侧或全部色板中的颜色，点击或拖动绘制。',eraser:'橡皮：点击或拖动，将格子设为透明，不计入拼豆用量。',fill:'油漆桶：点击填充上下左右相连的同色区域；透明区域也可填充，支持撤销。',picker:'吸管：点击图纸上的格子，将它的色号设为画笔色。'}[tool];}
function cellAt(e){const r=canvas.getBoundingClientRect(),x=Math.floor((e.clientX-r.left)/r.width*project.width),y=Math.floor((e.clientY-r.top)/r.height*project.height);if(x<0||y<0||x>=project.width||y>=project.height)return null;return{x,y,i:y*project.width+x};}
function paint(e){if(!project||generating)return;const cell=cellAt(e);if(!cell)return;const code=project.grid[cell.i];$('hover-info').textContent=`第 ${cell.x+1} 列 · 第 ${cell.y+1} 行 · ${code?`MARD ${code}`:'透明 / 无拼豆'}`;if(!drawing)return;if(tool==='picker'){if(code)chooseColor(code);return;}if(tool==='fill'){if(strokeSaved)return;strokeSaved=true;if(!selected){toast('请先选择一个色号');return;}const grid=floodFill(project.grid,project.width,project.height,cell.i,selected),changed=grid.reduce((n,c,i)=>n+(c!==project.grid[i]),0);applyGridAction(grid,`已填充 ${changed} 格，可一次撤销`);return;}if(tool!=='brush'&&tool!=='eraser')return;if(tool==='brush'&&!selected){toast('请先选择一个色号');return;}const next=tool==='eraser'?null:selected;if(code===next)return;if(!strokeSaved){snapshot();strokeSaved=true;}project.grid[cell.i]=next;render();}
let touchStroke=null;
function startStroke(e){touchStroke=e.pointerType==='touch'&&project?{project:{...project,grid:project.grid.slice()},history:history.slice(),future:future.slice(),selected}:null;drawing=true;strokeSaved=false;paint(e);}
function endStroke(){touchStroke=null;if(drawing){drawing=false;update();}}
function cancelStroke(){if(touchStroke){drawing=false;({project,history,future,selected}=touchStroke);touchStroke=null;if(strokeSaved)$('toast').hidden=true;update();}else endStroke();}
function undo(){if(!history.length||generating)return;future.push({...project,grid:project.grid.slice()});project=history.pop();update();}function redo(){if(!future.length||generating)return;history.push({...project,grid:project.grid.slice()});project=future.pop();update();}
$('undo').onclick=undo;$('redo').onclick=redo;document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA'].includes(e.target.tagName)){e.preventDefault();e.shiftKey?redo():undo();}});
function applyGridAction(grid,message){
  if(grid.every((c,i)=>c===project.grid[i]))return false;
  snapshot();project={...project,grid};setView(false);update();toast(message);return true;
}
function updateReplacement(){
  const counts=countColors(project?.grid||[]);
  if(!counts.some(c=>c.code===replaceFrom))replaceFrom=counts.find(c=>c.code===selected)?.code||counts[0]?.code||null;
  if(!palette.some(p=>p.code===replaceTo))replaceTo=null;
  for(const [key,code,label]of [['from',replaceFrom,'原颜色'],['to',replaceTo,'目标颜色']]){
    const p=paletteMap.get(code);$('replace-'+key+'-swatch').style.background=p?.hex||'transparent';$('replace-'+key+'-label').textContent=p?`${p.code} · ${p.hex.toUpperCase()}`:'选择颜色';$('replace-'+key).setAttribute('aria-label',`选择${label}${p?'，当前 '+p.code:''}`);$('replace-'+key).disabled=generating||!project||(key==='from'&&!counts.length);
  }
  const count=counts.find(c=>c.code===replaceFrom)?.count||0;
  $('replace-preview').textContent=!count?'图纸中没有可替换的颜色。':replaceFrom===replaceTo?'请选择不同的目标颜色。':`将替换整张图纸中 ${count} 格，包括不相连的同色区域。`;
  $('replace-apply').disabled=generating||!count||!replaceTo||replaceFrom===replaceTo;
}
$('replace-colors').onclick=()=>{
  if(!project||generating)return;
  if(project.grid.includes(selected))replaceFrom=selected;
  updateReplacement();$('canvas-actions').open=false;$('replace-dialog').showModal();
};
$('replace-from').onclick=()=>openPalette('replace-from');$('replace-to').onclick=()=>openPalette('replace-to');
$('replace-apply').onclick=()=>{
  if(generating||!project||!replaceFrom||!replaceTo||replaceFrom===replaceTo)return;
  const from=replaceFrom,to=replaceTo,count=project.grid.filter(c=>c===from).length;
  if(applyGridAction(replaceColor(project.grid,from,to),`已将 ${count} 格 ${from} 全部替换为 ${to}，可一次撤销`))$('replace-dialog').close();
};
$('tidy-pattern').onclick=()=>{
  if(!project||generating)return;
  const code=$('stroke-color').value;if(!paletteMap.has(code))return;
  const {width,height}=project,main=keepLargestRegion(project.grid,width,height),cleaned=keepLargestRegion(trimLightBorder(main,width,height,palette),width,height);
  if(!applyGridAction(addOutline(cleaned,width,height,code),'已保留主体、清理一层浅色外边并描边；可一次撤销'))toast('没有可整理的外部透明区域，请先移除背景。');
};
$('keep-subject').onclick=()=>{
  if(!project||generating)return;
  const grid=keepLargestRegion(project.grid,project.width,project.height),removed=project.grid.filter(Boolean).length-grid.filter(Boolean).length;
  if(!applyGridAction(grid,`已保留主体，清除 ${removed} 颗脱离的拼豆`))toast('当前图纸没有脱离的部分；有背景时请先移除背景。');
};
$('add-stroke').onclick=()=>{
  if(!project||generating)return;
  const code=$('stroke-color').value;if(!paletteMap.has(code))return;
  const grid=addOutline(project.grid,project.width,project.height,code),added=grid.filter(Boolean).length-project.grid.filter(Boolean).length;
  if(!applyGridAction(grid,`已用 ${code} 添加一格外描边，共 ${added} 颗`))toast('没有可描边的外部透明格子；可先移除背景或用橡皮留出边距。');
};
$('repair-stroke').onclick=()=>{
  if(!project||generating)return;
  const grid=repairOutline(project.grid,project.width,project.height,[...paletteMap.values()]),changed=grid.reduce((n,c,i)=>n+(c!==project.grid[i]),0);
  const code=grid.find((c,i)=>c!==project.grid[i]);
  if(!applyGridAction(grid,`已用边界主色 ${code} 补齐 ${changed} 格，可一次撤销`))toast('未发现可安全补齐的外轮廓小断口；较长缺口可用画笔补齐。');
};
$('trim-light').onclick=()=>{
  if(!project||generating)return;
  const grid=trimLightBorder(project.grid,project.width,project.height,palette),removed=project.grid.filter(Boolean).length-grid.filter(Boolean).length;
  if(!applyGridAction(grid,`已清理 ${removed} 颗浅色外边，可再次点击逐层清理`))toast('外缘没有可清理的白色或近白色格；若已描边，请先撤销描边。');
};
$('simplify-colors').onclick=()=>{
  if(!project||generating)return;
  const before=countColors(project.grid).length,grid=simplifyColors(project.grid,project.width,project.height,palette,$('simplify-level').value),after=countColors(grid).length;
  if(!applyGridAction(grid,`已整理色块：${before} → ${after} 色，可撤销`))toast('当前色块已较简洁，可尝试更强的简化程度。');
};
$('stroke-color').onclick=()=>openPalette('stroke');$('flat-stroke-color').onclick=()=>openPalette('flat-stroke');
$('rail-color').onclick=()=>openPalette('brush');
function closeSidePanels(){document.body.classList.remove('settings-open','palette-open');$('panel-backdrop').hidden=true;$('toggle-settings').setAttribute('aria-expanded','false');$('toggle-palette').setAttribute('aria-expanded','false');}
function toggleSidePanel(name){const open=document.body.classList.contains(name+'-open');closeSidePanels();if(!open){document.body.classList.add(name+'-open');$('panel-backdrop').hidden=false;$('toggle-'+name).setAttribute('aria-expanded','true');}}
$('toggle-settings').onclick=()=>toggleSidePanel('settings');$('toggle-palette').onclick=()=>toggleSidePanel('palette');$('panel-backdrop').onclick=closeSidePanels;
for(const b of document.querySelectorAll('[data-close-panel]'))b.onclick=closeSidePanels;
window.addEventListener('resize',closeSidePanels);
document.addEventListener('pointerdown',e=>{if(!$('canvas-actions').contains(e.target))$('canvas-actions').open=false;});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('canvas-actions').open=false;closeSidePanels();}});
for(const b of document.querySelectorAll('[data-tool]'))b.onclick=()=>{setView(false);setTool(b.dataset.tool);};
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{mode=b.dataset.mode;for(const a of document.querySelectorAll('[data-mode]')){a.classList.toggle('selected',a===b);a.setAttribute('aria-pressed',String(a===b));}$('mode-description').textContent=descriptions[mode];updateProcessingControls();setView(false);queueGenerate();};
for(const id of ['size','colors'])$(id).addEventListener('input',()=>{if(id==='size'&&mode==='pixel')$('pixel-auto').checked=false;$(id+'-value').value=$(id).value;queueGenerate();});
for(const id of ['outline','cleanup','background','fit'])$(id).onchange=()=>{updateProcessingControls();queueGenerate();};
$('pixel-auto').onchange=()=>{updateProcessingControls();queueGenerate();};
$('preprocess').onchange=()=>{if($('preprocess').value!=='custom')applyProcessingPreset($('preprocess').value);else updateProcessingControls();queueGenerate();};
for(const [,id]of processingFields)$(id).addEventListener('input',()=>{if($('preprocess').value!=='off')$('preprocess').value='custom';updateProcessingControls();queueGenerate();});
for(const id of ['flat-outer','flat-detail','flat-flatness'])$(id).addEventListener('input',()=>{updateProcessingControls();queueGenerate();});
$('reset-processing').onclick=()=>{if($('preprocess').value==='custom')$('preprocess').value='light';applyProcessingPreset($('preprocess').value);queueGenerate();};
$('view-processed').onclick=()=>setView('processed');$('generate').onclick=generate;$('grid-toggle').onchange=render;$('codes-toggle').onchange=render;$('view-pattern').onclick=()=>setView(false);$('view-original').onclick=()=>setView(true);
function setZoom(next){const nextZoom=normalizeZoom(next,zoom);const stage=$('canvas-stage'),style=getComputedStyle(stage),availableWidth=stage.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),availableHeight=stage.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom)-88,ratio=project?project.width/project.height:source?source.width/source.height:1;const fit=Math.min(availableWidth,Math.max(100,availableHeight)*ratio+36);const width=Math.max(100,fit*nextZoom);if(!Number.isFinite(width))return;zoom=nextZoom;$('paper').style.width=width+'px';$('paper').style.maxWidth='none';$('zoom-value').textContent=Math.round(zoom*100)+'%';}$('zoom-in').onclick=()=>setZoom(zoom*1.25);$('zoom-out').onclick=()=>setZoom(zoom/1.25);$('zoom-fit').onclick=()=>setZoom(1);new ResizeObserver(()=>setZoom(zoom)).observe($('canvas-stage'));
const navigation=attachNavigation({stage:$('canvas-stage'),paper:$('paper'),getZoom:()=>zoom,setZoom,canDraw:e=>!!project&&!generating&&e.target===canvas&&!canvas.hidden&&tool!=='inspect',startDraw:startStroke,moveDraw:paint,endDraw:endStroke,cancelDraw:cancelStroke,hover:e=>{if(e.target===canvas)paint(e);}});
$('zoom-fit').onclick=()=>{navigation.reset();setZoom(1);};
const fullscreenPanel=document.querySelector('.preview-panel');let fullscreenFallback=false;
function updateFullscreen(){const active=document.fullscreenElement===fullscreenPanel||fullscreenFallback;document.body.classList.toggle('canvas-fullscreen',fullscreenFallback);fullscreenPanel.classList.toggle('is-fullscreen',active);const button=$('canvas-fullscreen');button.textContent=active?'退出全屏':'全屏';button.title=active?'退出全屏画布':'全屏画布';button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(active));}
$('canvas-fullscreen').onclick=async()=>{
  if(document.fullscreenElement===fullscreenPanel){await document.exitFullscreen();return;}
  if(fullscreenFallback){fullscreenFallback=false;updateFullscreen();return;}
  try{if(!fullscreenPanel.requestFullscreen)throw Error('unsupported');await fullscreenPanel.requestFullscreen();}
  catch{fullscreenFallback=true;updateFullscreen();}
};
document.addEventListener('fullscreenchange',updateFullscreen);
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(fullscreenFallback){fullscreenFallback=false;updateFullscreen();}else if(document.fullscreenElement===fullscreenPanel)document.exitFullscreen().catch(e=>toast(e.message));});

async function loadImage(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('无法读取图片，请选择 PNG、JPG 或 WebP 文件。'));image.src=url;});}
async function setSource(url,name,isSample=false){const id=++sourceRequest;const image=await loadImage(url);if(id!==sourceRequest)return;if(image.width*image.height>40000000)throw Error('图片超过 4000 万像素，请先缩小后导入。');const scaled=document.createElement('canvas'),scale=Math.min(1,1600/Math.max(image.width,image.height));scaled.width=Math.max(1,Math.round(image.width*scale));scaled.height=Math.max(1,Math.round(image.height*scale));scaled.getContext('2d').drawImage(image,0,0,scaled.width,scaled.height);navigation.reset();source=scaled;pixelSource=image;sourceName=name;project=null;history=[];future=[];$('source-thumb').src=url;$('original').src=url;$('source-name').textContent=name;$('source-info').textContent=`${isSample?'示例图片':'本地图片'} · ${image.width} × ${image.height}`;$('sample-badge').hidden=!isSample;setView(false);setZoom(1);for(const id of ['size','colors','outline','cleanup','background','fit','preprocess'])$(id).disabled=false;updateProcessingControls();generate();}
async function importFile(file){if(!file)return;if(file.size>20*1024*1024){toast('文件不能超过 20 MB');return;}try{if(/\.json$/i.test(file.name)){const p=validateProject(JSON.parse(await file.text()),[...paletteMap.values()]);++sourceRequest;++request;clearTimeout(debounce);worker?.terminate();worker=null;navigation.reset();source=null;pixelSource=null;history=[];future=[];project=p;setZoom(1);sourceName=file.name.replace(/\.json$/i,'');selected=countColors(p.grid)[0]?.code||palette[0].code;setView(false);$('source-name').textContent=sourceName;$('source-info').textContent='工程图纸 · 不包含原图';$('source-thumb').removeAttribute('src');$('sample-badge').hidden=true;for(const id of ['size','colors','outline','cleanup','background','fit','preprocess'])$(id).disabled=true;updateProcessingControls();setBusy(false);update();toast('已恢复工程，可以继续精修。');}else{if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('请选择 JPG、PNG、WebP 图片或拾粒集工程 JSON。');const url=URL.createObjectURL(file);try{await setSource(url,file.name.replace(/\.[^.]+$/,''));if(originalUrl)URL.revokeObjectURL(originalUrl);originalUrl=url;}catch(e){URL.revokeObjectURL(url);throw e;}}}catch(e){toast(e.message||'文件读取失败');}}
$('import-image').onclick=$('upload').onclick=()=>$('file').click();$('file').onchange=e=>{importFile(e.target.files[0]);e.target.value='';};for(const event of ['dragenter','dragover'])$('upload').addEventListener(event,e=>{e.preventDefault();$('upload').classList.add('dragging');});$('upload').addEventListener('dragleave',()=>$('upload').classList.remove('dragging'));$('upload').addEventListener('drop',e=>{e.preventDefault();$('upload').classList.remove('dragging');importFile(e.dataTransfer.files[0]);});$('sample').onclick=()=>setSource('./sample.svg','花园里的小橘猫',true).catch(e=>toast(e.message));
for(const [button,dialog] of [['help','help-dialog'],['algorithm-help','algorithm-dialog'],['about','algorithm-dialog']])$(button).onclick=()=>$(dialog).showModal();for(const d of document.querySelectorAll('dialog')){d.querySelector('.dialog-close').onclick=()=>d.close();d.onclick=e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}};}
function showPalette(){
  const query=$('palette-search').value.trim().toUpperCase(),current=paletteTarget==='stroke'?$('stroke-color').value:paletteTarget==='flat-stroke'?flatStroke:paletteTarget==='replace-from'?replaceFrom:paletteTarget==='replace-to'?replaceTo:selected,available=paletteTarget==='replace-from'?countColors(project.grid).map(c=>paletteMap.get(c.code)):palette,colors=available.filter(p=>p.code.includes(query)||p.hex.toUpperCase().includes(query));
  $('palette-title').textContent=({'flat-stroke':'选择平涂描边颜色','stroke':'选择描边颜色','replace-from':'选择要替换的原颜色','replace-to':'选择替换后的目标颜色'})[paletteTarget]||'选择画笔颜色';$('palette-dialog-note').textContent=paletteTarget==='replace-from'?'仅显示当前图纸实际使用的颜色。':paletteDefinition().name+' · '+paletteDefinition().note;
  $('full-palette').replaceChildren();
  for(const p of colors){const b=document.createElement('button');b.className='palette-choice';b.setAttribute('aria-label',`选择 ${p.code} ${p.hex.toUpperCase()}`);b.setAttribute('aria-pressed',String(p.code===current));b.title=`${p.code} · ${p.hex.toUpperCase()}`;b.innerHTML=`<span class="swatch" style="background:${p.hex}"></span><strong>${p.code}</strong><small>${p.hex.toUpperCase()}</small>`;b.onclick=()=>{if(paletteTarget==='stroke')setStrokeColor(p.code);else if(paletteTarget==='flat-stroke'){setFlatStroke(p.code);if(mode==='flat')queueGenerate();}else if(paletteTarget==='replace-from'||paletteTarget==='replace-to'){if(paletteTarget==='replace-from')replaceFrom=p.code;else replaceTo=p.code;updateReplacement();}else{chooseColor(p.code);setTool(tool==='fill'?'fill':'brush');setView(false);}$('palette-dialog').close();};$('full-palette').append(b);}
  $('palette-empty').hidden=colors.length>0;
}
function openPalette(target){paletteTarget=target;$('palette-search').value='';showPalette();$('palette-dialog').showModal();$('palette-search').focus();}
$('all-colors').onclick=()=>openPalette('brush');$('palette-search').oninput=showPalette;
$('palette-select').onchange=()=>{
  activatePalette($('palette-select').value);
  if(source){queueGenerate();return;}
  if(project){snapshot();project={...project,paletteId:activePaletteId,grid:matchPalette(project.grid.map(c=>c===null?null:paletteMap.get(c).rgb),palette,palette.length)};update();toast('图纸已匹配所选色板，可撤销');}
};
function download(blob,ext){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=`拾粒集-${sourceName.replace(/[<>:"/\\|?*]/g,'-')}.${ext}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('export-csv').onclick=()=>{if(!project)return;const counts=countColors(project.grid);download(new Blob(['\uFEFF品牌,色号,HEX,颗数\r\n'+counts.map(c=>`MARD,${c.code},${paletteMap.get(c.code).hex},${c.count}`).join('\r\n')],{type:'text/csv;charset=utf-8'}),'csv');toast('用量清单已导出');};
$('export-project').onclick=()=>{if(!project)return;download(new Blob([JSON.stringify({format:'douge-v1',palette:project.paletteId||activePaletteId,width:project.width,height:project.height,mode:project.mode,grid:project.grid},null,2)],{type:'application/json'}),'json');toast('工程已保存，可再次导入继续精修');};
$('export-svg').onclick=()=>{if(!project)return;const sheet=createPatternSheet(project,paletteMap,paletteDefinition(project.paletteId).name);download(new Blob([sheet.svg],{type:'image/svg+xml;charset=utf-8'}),'svg');toast('矢量图纸已导出，可放大或打印');};
$('export-png').onclick=async()=>{
  if(!project)return;
  const sheet=createPatternSheet(project,paletteMap,paletteDefinition(project.paletteId).name),url=URL.createObjectURL(new Blob([sheet.svg],{type:'image/svg+xml;charset=utf-8'}));
  $('export-png').disabled=true;
  try{
    const image=await loadImage(url),canvas=document.createElement('canvas');canvas.width=sheet.pngWidth;canvas.height=sheet.pngHeight;
    const context=canvas.getContext('2d');if(!context)throw Error('内存不足，请改用 SVG 矢量图纸。');
    context.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob)throw Error('图片导出失败，请改用 SVG 矢量图纸。');
    download(blob,'png');toast(`高清图纸已导出 · ${canvas.width} × ${canvas.height} 像素`);
  }catch(e){toast(e.message);}finally{URL.revokeObjectURL(url);$('export-png').disabled=generating||!project;}
};
try {const response=await fetch('./palette.json');if(!response.ok)throw Error('色板加载失败');const colors=(await response.json()).map(p=>({...p,hex:colorHex(p.rgb)}));paletteMap=new Map(colors.map(p=>[p.code,p]));paletteCatalog=createPaletteCatalog(colors);$('palette-select').replaceChildren(...paletteCatalog.map(p=>new Option(p.name,p.id)));activatePalette('MARD-221');await setSource('./sample.svg','花园里的小橘猫',true);}catch(e){toast(e.message);$('busy').hidden=true;}
