// Grid recovery inspired by Perfect Pixel: align sampling cells to image edges.
// Validate periodic edge candidates against cell colors; no runtime dependency.
function edgeProjections(data,w,h) {
  const x=new Float64Array(w),y=new Float64Array(h);
  const difference=(a,b)=>{
    const aa=data[a+3]/255,ab=data[b+3]/255;
    return Math.max(Math.abs(data[a]*aa-data[b]*ab),Math.abs(data[a+1]*aa-data[b+1]*ab),Math.abs(data[a+2]*aa-data[b+2]*ab),Math.abs(data[a+3]-data[b+3]));
  };
  for(let row=0;row<h;row++)for(let col=0;col<w;col++){
    const i=(row*w+col)*4;
    if(col)x[col]+=difference(i,i-4)/h;
    if(row)y[row]+=difference(i,i-w*4)/w;
  }
  return {x,y};
}

function peaksOf(projection) {
  const maximum=Math.max(...projection),threshold=Math.max(2,maximum*.18),peaks=[];
  if(maximum<6)return peaks;
  for(let i=1;i<projection.length-1;i++){
    if(projection[i]<threshold)continue;
    const start=i,value=projection[i];
    while(i<projection.length-2&&projection[i+1]===value)i++;
    if(value<=projection[start-1]||value<=projection[i+1])continue;
    const left=Math.min(...projection.slice(Math.max(0,start-3),start)),right=Math.min(...projection.slice(i+1,i+4));
    const prominence=value-Math.max(left,right);
    if(prominence>=Math.max(1,maximum*.025))peaks.push({position:(start+i)/2,weight:prominence});
  }
  return peaks;
}

function fitAxis(peaks,length,count) {
  const step=length/count,total=peaks.reduce((n,p)=>n+p.weight,0);
  let best=null;
  for(let phase=-10;phase<=10;phase++){
    const offset=phase*step*.05,lines=new Set();let explained=0,error=0;
    for(const p of peaks){
      const line=Math.round((p.position-offset)/step),distance=Math.abs(p.position-(line*step+offset));
      if(line<1||line>=count||distance>step*.28)continue;
      explained+=p.weight;error+=p.weight*distance/step;lines.add(line);
    }
    const coverage=explained/total,support=lines.size/(count-1),score=coverage*Math.sqrt(support)*(1-error/(explained||1));
    if(coverage>=.85&&support>=.3&&lines.size>=3&&(!best||score>best.score))best={count,step,offset,score};
  }
  return best;
}

function detectAxis(projection) {
  const peaks=peaksOf(projection),length=projection.length;
  if(peaks.length<3)return [];
  const candidates=[],total=peaks.reduce((n,p)=>n+p.weight,0);
  for(let count=4;count<=Math.min(160,Math.floor(length/2));count++){
    let real=0,imag=0;
    for(const p of peaks){const angle=2*Math.PI*p.position*count/length;real+=p.weight*Math.cos(angle);imag+=p.weight*Math.sin(angle);}
    const periodicity=Math.hypot(real,imag)/total;
    if(periodicity<.35)continue;
    const fit=fitAxis(peaks,length,count);
    if(fit&&fit.score>=.55)candidates.push({...fit,periodicity,peaks});
  }
  return candidates.sort((a,b)=>b.score-a.score).slice(0,6);
}

function coordinates(axis,length) {
  const out=[0];
  for(let i=1;i<axis.count;i++){
    const origin=i*axis.step+axis.offset;
    let nearest=null;
    for(const peak of axis.peaks){
      if(Math.abs(peak.position-origin)>axis.step*.28)continue;
      if(!nearest||peak.weight>nearest.weight)nearest=peak;
    }
    out.push(Math.max(out.at(-1)+.25,Math.min(length-(axis.count-i)*.25,nearest?.position??origin)));
  }
  out.push(length);return out;
}

function nativePixels(data,w,h) {
  if(Math.max(w,h)>160)return false;
  const colors=new Set();
  for(let i=0;i<data.length;i+=4){
    if(data[i+3]<128)continue;
    colors.add((data[i]<<16)|(data[i+1]<<8)|data[i+2]);
    if(colors.size>64)return false;
  }
  return colors.size>0;
}

function cellConsistency(data,sw,sh,xs,ys) {
  let cells=0,consistent=0,error=0;
  for(let row=0;row<ys.length-1;row++)for(let col=0;col<xs.length-1;col++){
    const sum=[0,0,0,0],square=[0,0,0,0];let occupied=false;
    // Fixed sample budget per cell keeps candidate validation bounded on phones.
    for(let y=0;y<3;y++)for(let x=0;x<3;x++){
      const px=Math.min(sw-1,Math.max(0,Math.floor(xs[col]+(xs[col+1]-xs[col])*(x+.5)/3)));
      const py=Math.min(sh-1,Math.max(0,Math.floor(ys[row]+(ys[row+1]-ys[row])*(y+.5)/3))),i=(py*sw+px)*4,alpha=data[i+3]/255;
      occupied||=alpha>=.5;
      for(let c=0;c<4;c++){const v=c===3?data[i+3]:data[i+c]*alpha;sum[c]+=v;square[c]+=v*v;}
    }
    if(!occupied)continue;
    const variance=square.reduce((n,v,c)=>n+Math.max(0,v/9-(sum[c]/9)**2),0)/4;
    cells++;error+=variance;if(variance<=14**2)consistent++;
  }
  return {consistent:cells?consistent/cells:0,error:cells?Math.sqrt(error/cells):Infinity};
}

function chooseGrid(data,sw,sh,xCandidates,yCandidates) {
  const pairs=[];
  for(const x of xCandidates)for(const y of yCandidates){
    if(Math.max(x.step,y.step)/Math.min(x.step,y.step)<=1.5)pairs.push({x,y,score:x.score+y.score});
  }
  for(const pair of pairs.sort((a,b)=>b.score-a.score).slice(0,6)){
    const xs=coordinates(pair.x,sw),ys=coordinates(pair.y,sh),quality=cellConsistency(data,sw,sh,xs,ys);
    if(quality.consistent>=.85&&quality.error<=16)return pair;
  }
  return null;
}

function representativeCell(data,sw,sh,x0,x1,y0,y1) {
  const bins=new Map();let opaque=0;
  const centerX=(x0+x1)/2,centerY=(y0+y1)/2;
  for(let y=Math.floor(y0);y<Math.ceil(y1);y++)for(let x=Math.floor(x0);x<Math.ceil(x1);x++){
    if(x<0||y<0||x>=sw||y>=sh)continue;
    const i=(y*sw+x)*4;if(data[i+3]<128)continue;
    const weight=(Math.min(x+1,x1)-Math.max(x,x0))*(Math.min(y+1,y1)-Math.max(y,y0));
    const rgb=Array.from(data.subarray(i,i+3)),key=rgb.map(v=>v>>5).join(','),distance=(x+.5-centerX)**2+(y+.5-centerY)**2;
    const bin=bins.get(key)||{weight:0,rgb,distance};bin.weight+=weight;
    if(distance<bin.distance){bin.rgb=rgb;bin.distance=distance;}bins.set(key,bin);opaque+=weight;
  }
  if(opaque<(x1-x0)*(y1-y0)*.5)return null;
  const groups=[...bins.values()];
  for(const a of groups)a.score=groups.reduce((n,b)=>n+(a.rgb.reduce((s,v,i)=>s+(v-b.rgb[i])**2,0)<48**2?b.weight:0),0);
  const chosen=groups.sort((a,b)=>b.score-a.score||a.distance-b.distance)[0].rgb;
  // Preserve a center ink pixel supported along a stroke, without expanding ink
  // into neighboring light cells or preserving isolated compression speckles.
  const cx=Math.min(sw-1,Math.floor(centerX)),cy=Math.min(sh-1,Math.floor(centerY)),ci=(cy*sw+cx)*4;
  const ink=i=>data[i+3]>=128&&data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722<85;
  if(ink(ci)){
    let support=0;
    for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1]]){
      const x=cx+dx,y=cy+dy;
      if(x>=0&&y>=0&&x<sw&&y<sh&&ink((y*sw+x)*4))support++;
    }
    if(support>=2)return Array.from(data.subarray(ci,ci+3));
  }
  return chosen;
}

export function recoverPixelGrid(data,sw,sh,width,height,auto=false) {
  const native=auto&&nativePixels(data,sw,sh),edges=native?null:edgeProjections(data,sw,sh);
  const xc=edges?detectAxis(edges.x):[],yc=edges?detectAxis(edges.y):[];
  const detected=auto&&!native?chooseGrid(data,sw,sh,xc,yc):null;
  let status='manual',aligned=false;
  if(auto){
    if(native){width=sw;height=sh;status='native';}
    else if(detected){width=detected.x.count;height=detected.y.count;status='detected';}
    else status='fallback';
  }
  // A user-specified size always wins. Only align a confidently matching lattice.
  const x=detected?.x||xc.find(c=>c.count===width),y=detected?.y||yc.find(c=>c.count===height);
  let xs=x?.count===width&&status!=='native'&&status!=='fallback'?coordinates(x,sw):null;
  let ys=y?.count===height&&status!=='native'&&status!=='fallback'?coordinates(y,sh):null;
  if(status==='manual'&&(xs||ys)){
    const quality=cellConsistency(data,sw,sh,xs||Array.from({length:width+1},(_,i)=>i*sw/width),ys||Array.from({length:height+1},(_,i)=>i*sh/height));
    if(quality.consistent<.85||quality.error>16){xs=null;ys=null;}
  }
  const cells=[];aligned=!!(xs||ys);
  for(let row=0;row<height;row++)for(let col=0;col<width;col++){
    if(status==='fallback'){
      cells.push(representativeCell(data,sw,sh,col*sw/width,(col+1)*sw/width,row*sh/height,(row+1)*sh/height));continue;
    }
    const cx=Math.min(sw-1,Math.max(0,Math.floor(xs?(xs[col]+xs[col+1])/2:(col+.5)*sw/width)));
    const cy=Math.min(sh-1,Math.max(0,Math.floor(ys?(ys[row]+ys[row+1])/2:(row+.5)*sh/height))),i=(cy*sw+cx)*4;
    cells.push(data[i+3]<128?null:Array.from(data.subarray(i,i+3)));
  }
  return {width,height,cells,status,aligned,sampling:status==='fallback'?'representative':'center'};
}
