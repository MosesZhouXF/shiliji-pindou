// Pure conversion engine: the worker and Node tests share this module.
export function rgbToLab(rgb) {
  const [r,g,b]=rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
  const f=v=>v>.008856?Math.cbrt(v):7.787*v+16/116;
  const x=f((r*.4124564+g*.3575761+b*.1804375)/.95047),y=f(r*.2126729+g*.7151522+b*.072175),z=f((r*.0193339+g*.119192+b*.9503041)/1.08883);
  return [116*y-16,500*(x-y),200*(y-z)];
}
export function deltaE(a,b) {
  const rad=Math.PI/180, c1=Math.hypot(a[1],a[2]),c2=Math.hypot(b[1],b[2]),cm=(c1+c2)/2;
  const g=.5*(1-Math.sqrt(cm**7/(cm**7+25**7)));
  const ap1=(1+g)*a[1],ap2=(1+g)*b[1],cp1=Math.hypot(ap1,a[2]),cp2=Math.hypot(ap2,b[2]);
  const hue=(x,y)=>(Math.atan2(y,x)/rad+360)%360,h1=hue(ap1,a[2]),h2=hue(ap2,b[2]);
  let dh=h2-h1;if(!cp1||!cp2)dh=0;else if(dh>180)dh-=360;else if(dh< -180)dh+=360;
  let hm=h1+h2;if(cp1*cp2){if(Math.abs(h1-h2)<=180)hm/=2;else hm=(hm+(hm<360?360:-360))/2;}
  const lm=(a[0]+b[0])/2,cp=(cp1+cp2)/2;
  const t=1-.17*Math.cos((hm-30)*rad)+.24*Math.cos(2*hm*rad)+.32*Math.cos((3*hm+6)*rad)-.2*Math.cos((4*hm-63)*rad);
  const sl=1+.015*(lm-50)**2/Math.sqrt(20+(lm-50)**2),sc=1+.045*cp,sh=1+.015*cp*t;
  const dl=(b[0]-a[0])/sl,dc=(cp2-cp1)/sc,dH=2*Math.sqrt(cp1*cp2)*Math.sin(dh*rad/2)/sh;
  const rt=-2*Math.sqrt(cp**7/(cp**7+25**7))*Math.sin(60*Math.exp(-(((hm-275)/25)**2))*rad);
  return Math.sqrt(Math.max(0,dl*dl+dc*dc+dH*dH+rt*dc*dH));
}
const linear=Array.from({length:256},(_,i)=>i/255<=.04045?i/255/12.92:((i/255+.055)/1.055)**2.4);
const srgb=v=>Math.round(255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055));
const dist2=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0);
const luminance=p=>.2126*p[0]+.7152*p[1]+.0722*p[2];

export function removeBackground(data,w,h,tolerance=28) {
  const corners=[0,w-1,(h-1)*w,w*h-1].map(i=>Array.from(data.slice(i*4,i*4+3)));
  if(corners.some(c=>Math.sqrt(dist2(c,corners[0]))>tolerance))return {data,removed:false,warning:'四角颜色不一致，已保留背景。可先裁切图片或用橡皮精修。'};
  const out=new Uint8ClampedArray(data),visited=new Uint8Array(w*h),queue=[];
  const add=i=>{if(visited[i])return;visited[i]=1;const o=i*4;if(out[o+3]<128||Math.sqrt(dist2(Array.from(out.slice(o,o+3)),corners[0]))<=tolerance){queue.push(i);out[o+3]=0;}};
  for(let x=0;x<w;x++){add(x);add((h-1)*w+x);}for(let y=0;y<h;y++){add(y*w);add(y*w+w-1);}
  for(let n=0;n<queue.length;n++){const i=queue[n],x=i%w,y=Math.floor(i/w);if(x)add(i-1);if(x<w-1)add(i+1);if(y)add(i-w);if(y<h-1)add(i+w);}
  return {data:out,removed:true,warning:''};
}

export function fitSubject(data,width,height,targetWidth,targetHeight) {
  // Locate substantial connected regions instead of using stray background dots as crop bounds.
  const labels=new Int32Array(width*height),queue=new Int32Array(width*height),parts=[];
  for(let i=0;i<labels.length;i++){
    if(labels[i]||data[i*4+3]<128)continue;
    const id=parts.length+1,part={id,count:0,left:width,top:height,right:0,bottom:0};
    let head=0,tail=1;queue[0]=i;labels[i]=id;
    while(head<tail){
      const p=queue[head++],x=p%width,y=Math.floor(p/width);part.count++;
      part.left=Math.min(part.left,x);part.right=Math.max(part.right,x);part.top=Math.min(part.top,y);part.bottom=Math.max(part.bottom,y);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=width||yy>=height)continue;
        const next=yy*width+xx;if(labels[next]||data[next*4+3]<128)continue;
        labels[next]=id;queue[tail++]=next;
      }
    }
    parts.push(part);
  }
  const unchanged={data,width,height,cropped:false};if(!parts.length)return unchanged;
  parts.sort((a,b)=>b.count-a.count);const main=parts[0],reach=Math.max(main.right-main.left+1,main.bottom-main.top+1)*.18;
  const kept=parts.filter(p=>p===main||p.count>=main.count*.08||(p.count>=Math.max(4,main.count*.003)&&Math.hypot(Math.max(0,main.left-p.right,p.left-main.right),Math.max(0,main.top-p.bottom,p.top-main.bottom))<=reach));
  const left=Math.min(...kept.map(p=>p.left)),right=Math.max(...kept.map(p=>p.right)),top=Math.min(...kept.map(p=>p.top)),bottom=Math.max(...kept.map(p=>p.bottom));
  const unit=Math.max((right-left+1)/Math.max(1,targetWidth-2),(bottom-top+1)/Math.max(1,targetHeight-2));
  const cropWidth=Math.ceil(unit*targetWidth),cropHeight=Math.ceil(unit*targetHeight);
  if(cropWidth>=width&&cropHeight>=height)return unchanged;
  const x0=Math.floor((left+right+1-cropWidth)/2),y0=Math.floor((top+bottom+1-cropHeight)/2),out=new Uint8ClampedArray(cropWidth*cropHeight*4);
  for(let y=0;y<cropHeight;y++){
    const sy=y+y0;if(sy<0||sy>=height)continue;
    const from=Math.max(0,x0),to=Math.min(width,x0+cropWidth);if(to<=from)continue;
    out.set(data.subarray((sy*width+from)*4,(sy*width+to)*4),(y*cropWidth+from-x0)*4);
  }
  return {data:out,width:cropWidth,height:cropHeight,cropped:true};
}

function tiles(data,sw,sh,w,h,mode,outline) {
  const cells=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const x0=Math.floor(x*sw/w),x1=Math.max(x0+1,Math.floor((x+1)*sw/w)),y0=Math.floor(y*sh/h),y1=Math.max(y0+1,Math.floor((y+1)*sh/h));
    if(mode==='pixel') {const i=(Math.min(sh-1,Math.floor((y+.5)*sh/h))*sw+Math.min(sw-1,Math.floor((x+.5)*sw/w)))*4;cells.push(data[i+3]<128?null:Array.from(data.slice(i,i+3)));continue;}
    let n=0;const sum=[0,0,0],bins=new Map();
    for(let py=y0;py<y1;py++)for(let px=x0;px<x1;px++){const i=(py*sw+px)*4;if(data[i+3]<128)continue;const c=[data[i],data[i+1],data[i+2]],key=c.map(v=>v>>5).join(',');let bin=bins.get(key);if(!bin){bin={n:0,rgb:[0,0,0]};bins.set(key,bin);}bin.n++;for(let k=0;k<3;k++){sum[k]+=linear[c[k]];bin.rgb[k]+=c[k];}n++;}
    if(n<(x1-x0)*(y1-y0)*.4){cells.push(null);continue;}
    if(mode==='photo'){cells.push(sum.map(v=>srgb(v/n)));continue;}
    const groups=[...bins.values()].map(b=>({n:b.n,rgb:b.rgb.map(v=>v/b.n)})).sort((a,b)=>b.n-a.n);
    const dark=groups.filter(b=>luminance(b.rgb)<80&&b.n/n>=.12).sort((a,b)=>luminance(a.rgb)-luminance(b.rgb))[0];
    const chosen=outline&&dark?dark.rgb:groups[0].rgb;
    cells.push(mode==='line'?(luminance(chosen)<145?[25,29,30]:[255,255,255]):chosen);
  }
  return cells;
}

// SLIC-inspired local region assignment; intentionally not a reproduction of PIA.
function structureSamples(data,sw,sh,w,h) {
  const scale=3,ww=w*scale,hh=h*scale;
  const samples=tiles(data,sw,sh,ww,hh,'photo',false),labs=samples.map(c=>c&&rgbToLab(c));
  let centers=tiles(data,sw,sh,w,h,'cartoon',true).map((rgb,i)=>({x:(i%w+.5)*scale,y:(Math.floor(i/w)+.5)*scale,rgb,lab:rgb&&rgbToLab(rgb)}));
  for(let round=0;round<3;round++){
    const sums=centers.map(()=>({n:0,x:0,y:0,rgb:[0,0,0]}));
    for(let y=0;y<hh;y++)for(let x=0;x<ww;x++){const p=y*ww+x;if(!labs[p])continue;const cx=Math.floor(x/scale),cy=Math.floor(y/scale);let best=-1,score=Infinity;
      for(let yy=Math.max(0,cy-1);yy<=Math.min(h-1,cy+1);yy++)for(let xx=Math.max(0,cx-1);xx<=Math.min(w-1,cx+1);xx++){const i=yy*w+xx,c=centers[i];if(!c.lab)continue;const d=dist2(labs[p],c.lab)+220*((x-c.x)**2+(y-c.y)**2)/scale**2;if(d<score){score=d;best=i;}}
      if(best<0)continue;const s=sums[best];s.n++;s.x+=x;s.y+=y;samples[p].forEach((v,k)=>s.rgb[k]+=v);
    }
    centers=centers.map((c,i)=>{const s=sums[i];if(!s.n)return c;const rgb=s.rgb.map(v=>v/s.n);return{x:s.x/s.n,y:s.y/s.n,rgb,lab:rgbToLab(rgb)};});
  }
  return centers.map(c=>c.rgb);
}

export function matchPalette(cells,palette,maxColors) {
  const pal=palette.map(p=>({...p,lab:rgbToLab(p.rgb)})),hist=new Map();
  for(const c of cells)if(c){const key=c.map(Math.round).join(',');if(!hist.has(key))hist.set(key,{rgb:c,lab:rgbToLab(c),n:0});hist.get(key).n++;}
  const samples=[...hist.values()];if(!samples.length)return cells.map(()=>null);
  const nearest=lab=>{let best=0,d=Infinity;pal.forEach((p,i)=>{const e=deltaE(lab,p.lab);if(e<d){best=i;d=e;}});return best;};
  const weights=new Map();for(const s of samples){s.index=nearest(s.lab);weights.set(s.index,(weights.get(s.index)||0)+s.n);}
  const candidates=[...weights.keys()],chosen=[];
  if(candidates.length<=maxColors)chosen.push(...candidates);
  else{
    chosen.push([...weights].sort((a,b)=>b[1]-a[1])[0][0]);
    const distances=new Map(candidates.map(i=>[i,Float32Array.from(samples,s=>deltaE(s.lab,pal[i].lab)**2)]));
    const errors=Float32Array.from(distances.get(chosen[0]));
    while(chosen.length<maxColors){let winner=-1,gain=-1;for(const i of candidates){if(chosen.includes(i))continue;let total=0;const distancesToColor=distances.get(i);for(let j=0;j<samples.length;j++)total+=samples[j].n*Math.max(0,errors[j]-distancesToColor[j]);if(total>gain){gain=total;winner=i;}}if(winner<0)break;chosen.push(winner);const d=distances.get(winner);for(let j=0;j<samples.length;j++)errors[j]=Math.min(errors[j],d[j]);}
  }
  const map=new Map();for(const s of samples){let best=chosen[0],d=Infinity;for(const i of chosen){const e=deltaE(s.lab,pal[i].lab);if(e<d){best=i;d=e;}}map.set(s.rgb.map(Math.round).join(','),pal[best].code);}
  return cells.map(c=>c?map.get(c.map(Math.round).join(',')):null);
}

export function cleanSpeckles(grid,w,h,palette) {
  const out=grid.slice(),pal=new Map(palette.map(p=>[p.code,rgbToLab(p.rgb)]));
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,c=grid[i];if(!c)continue;const nb=[grid[i-1],grid[i+1],grid[i-w],grid[i+w]];if(nb.includes(c))continue;const common=nb.find(n=>n&&nb.filter(v=>v===n).length>=3);if(common&&deltaE(pal.get(c),pal.get(common))<14)out[i]=common;}
  return out;
}

export function convert({data,width:sw,height:sh,options,palette}) {
  const {mode='cartoon',size=64,maxColors=18,outline=true,cleanup=true,background=false,fit=false}=options;
  if(!['photo','cartoon','structure','line','pixel'].includes(mode))throw Error('不支持的算法');
  if(!Number.isInteger(size)||size<8||size>192||!Number.isInteger(maxColors)||maxColors<1||maxColors>291||!sw||!sh||data.length!==sw*sh*4)throw Error('转换参数无效');
  const w=Math.max(1,Math.round(sw/Math.max(sw,sh)*size)),h=Math.max(1,Math.round(sh/Math.max(sw,sh)*size));
  const bg=background?removeBackground(data,sw,sh):{data,warning:''};
  const prepared=fit?fitSubject(bg.data,sw,sh,w,h):{data:bg.data,width:sw,height:sh,cropped:false};
  const cells=mode==='structure'?structureSamples(prepared.data,prepared.width,prepared.height,w,h):tiles(prepared.data,prepared.width,prepared.height,w,h,mode,outline);
  let grid=matchPalette(cells,palette,maxColors);
  if(cleanup&&mode!=='pixel'&&mode!=='line')grid=cleanSpeckles(grid,w,h,palette);
  return {width:w,height:h,grid,warning:bg.warning,mode,fitted:prepared.cropped};
}

export function keepLargestRegion(grid,width,height) {
  const visited=new Uint8Array(grid.length);let largest=[];
  for(let i=0;i<grid.length;i++){
    if(visited[i]||grid[i]===null)continue;
    const region=[i];visited[i]=1;
    for(let head=0;head<region.length;head++){
      const p=region[head],x=p%width,y=Math.floor(p/width);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=width||yy>=height)continue;
        const next=yy*width+xx;if(visited[next]||grid[next]===null)continue;
        visited[next]=1;region.push(next);
      }
    }
    if(region.length>largest.length)largest=region;
  }
  const out=Array(grid.length).fill(null);for(const i of largest)out[i]=grid[i];return out;
}

function exteriorCells(grid,width,height) {
  const exterior=new Uint8Array(grid.length),queue=[];
  const add=i=>{if(exterior[i]||grid[i]!==null)return;exterior[i]=1;queue.push(i);};
  for(let x=0;x<width;x++){add(x);add((height-1)*width+x);}
  for(let y=0;y<height;y++){add(y*width);add(y*width+width-1);}
  for(let head=0;head<queue.length;head++){
    const i=queue[head],x=i%width,y=Math.floor(i/width);
    if(x)add(i-1);if(x<width-1)add(i+1);if(y)add(i-width);if(y<height-1)add(i+width);
  }
  return {exterior,queue};
}

export function trimLightBorder(grid,width,height,palette) {
  const light=new Set(palette.filter(p=>{const [l,a,b]=rgbToLab(p.rgb);return l>=92&&Math.hypot(a,b)<=14;}).map(p=>p.code));
  const {exterior}=exteriorCells(grid,width,height),out=grid.slice();
  for(let i=0;i<grid.length;i++){
    if(!light.has(grid[i]))continue;
    const x=i%width,y=Math.floor(i/width);let exposed=x===0||y===0||x===width-1||y===height-1;
    for(let dy=-1;dy<=1&&!exposed;dy++)for(let dx=-1;dx<=1;dx++){
      const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<width&&yy<height&&exterior[yy*width+xx]){exposed=true;break;}
    }
    if(exposed)out[i]=null;
  }
  return out;
}

export function addOutline(grid,width,height,code) {
  // Only paint exterior transparent cells. Enclosed holes and original beads stay intact.
  const {queue}=exteriorCells(grid,width,height),out=grid.slice();
  for(const i of queue){
    const x=i%width,y=Math.floor(i/width);let touches=false;
    for(let dy=-1;dy<=1&&!touches;dy++)for(let dx=-1;dx<=1;dx++){
      const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<width&&yy<height&&grid[yy*width+xx]!==null){touches=true;break;}
    }
    if(touches)out[i]=code;
  }
  return out;
}

export function simplifyColors(grid,width,height,palette,strength='standard') {
  const level={light:{cap:18,weight:30,passes:2,area:2},standard:{cap:12,weight:55,passes:3,area:4},strong:{cap:8,weight:80,passes:4,area:8}}[strength];
  if(!level)throw Error('不支持的简化强度');
  const used=new Set(grid.filter(Boolean)),pal=palette.filter(p=>used.has(p.code));
  const colors=new Map(pal.map(p=>[p.code,p.rgb])),labs=new Map(pal.map(p=>[p.code,rgbToLab(p.rgb)])),costs=new Map();
  const diff=(a,b)=>{const key=a+'|'+b;if(!costs.has(key))costs.set(key,deltaE(labs.get(a),labs.get(b)));return costs.get(key);};
  const neighbors=i=>{const x=i%width,y=Math.floor(i/width),result=[];if(x)result.push(i-1);if(x<width-1)result.push(i+1);if(y)result.push(i-width);if(y<height-1)result.push(i+width);return result.filter(j=>grid[j]!==null);};
  const out=matchPalette(grid.map(c=>c===null?null:colors.get(c)),pal,level.cap);
  // Prefer coherent neighboring labels while keeping strong color boundaries in the original guide.
  for(let pass=0;pass<level.passes;pass++)for(let step=0;step<out.length;step++){
    const i=pass%2?out.length-1-step:step;if(grid[i]===null)continue;
    const nb=neighbors(i);let best=out[i],score=Infinity;
    for(const c of new Set([out[i],...nb.map(j=>out[j])])){
      const d=diff(grid[i],c);if(c!==out[i]&&d>20)continue;
      let energy=d*d;for(const j of nb)if(c!==out[j])energy+=level.weight*Math.exp(-((diff(grid[i],grid[j])/18)**2));
      if(energy<score){score=energy;best=c;}
    }
    out[i]=best;
  }
  const source=out.slice(),seen=new Uint8Array(out.length),counts=new Map(countColors(source).map(p=>[p.code,p.count]));
  // Merge tiny low-contrast islands; black eyes and other high-contrast accents are protected.
  for(let start=0;start<out.length;start++){
    if(source[start]===null||seen[start])continue;
    const region=[start],border=new Map();seen[start]=1;
    for(let head=0;head<region.length;head++)for(const j of neighbors(region[head])){
      if(source[j]===source[start]){if(!seen[j]){seen[j]=1;region.push(j);}}
      else border.set(source[j],(border.get(source[j])||0)+1);
    }
    if(region.length>level.area)continue;
    let chosen=null,best=Infinity;
    for(const [code,n]of border){
      if(counts.get(code)<counts.get(source[start])||(counts.get(code)===counts.get(source[start])&&code.localeCompare(source[start])>=0))continue;
      const d=diff(source[start],code);if(d>18)continue;
      const cost=d*d/(1+Math.log2(1+n));if(cost<best){best=cost;chosen=code;}
    }
    if(chosen)for(const i of region)out[i]=chosen;
  }
  return out;
}

export function countColors(grid) {const m=new Map();for(const c of grid)if(c)m.set(c,(m.get(c)||0)+1);return [...m].map(([code,count])=>({code,count})).sort((a,b)=>b.count-a.count||a.code.localeCompare(b.code));}
export function validateProject(p,palette) {const codes=new Set(palette.map(c=>c.code));if(p?.format!=='douge-v1'||!Number.isInteger(p.width)||!Number.isInteger(p.height)||p.width<1||p.height<1||p.width>192||p.height>192||!Array.isArray(p.grid)||p.grid.length!==p.width*p.height||p.grid.some(c=>c!==null&&!codes.has(c)))throw Error('图纸文件无效或包含不支持的色号');return {width:p.width,height:p.height,grid:p.grid.slice(),mode:p.mode||'cartoon'};}
