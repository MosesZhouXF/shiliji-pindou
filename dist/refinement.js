import {rgbToLab} from './color.js';

const luma=(r,g,b)=>r*.2126+g*.7152+b*.0722;

export function thin(mask,w,h){
  const out=new Uint8Array(mask);
  for(let round=0;round<40;round++){
    let changed=false;
    for(let phase=0;phase<2;phase++){
      const erase=[];
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
        const i=y*w+x;if(!out[i])continue;
        const p=[out[i-w],out[i-w+1],out[i+1],out[i+w+1],out[i+w],out[i+w-1],out[i-1],out[i-w-1]];
        const count=p.reduce((a,b)=>a+b,0);let transitions=0;
        for(let k=0;k<8;k++)if(!p[k]&&p[(k+1)%8])transitions++;
        if(count<2||count>6||transitions!==1)continue;
        if(phase===0?(p[0]*p[2]*p[4]||p[2]*p[4]*p[6]):(p[0]*p[2]*p[6]||p[0]*p[4]*p[6]))continue;
        erase.push(i);
      }
      if(erase.length)changed=true;for(const i of erase)out[i]=0;
    }
    if(!changed)break;
  }
  return out;
}

// Find small isolated ink components anywhere in the image, without face coordinates.
// Large filled shapes (hair, clothes, silhouettes) are excluded from thinning.
export function protectThinLines(cells,data,sw,sh,w,h,threshold=90){
  const dark=new Uint8Array(sw*sh),labels=new Int32Array(sw*sh),parts=[],queue=new Int32Array(sw*sh),unit=sw*sh/(w*h);
  for(let i=0;i<dark.length;i++)dark[i]=data[i*4+3]>=128&&luma(data[i*4],data[i*4+1],data[i*4+2])<threshold?1:0;
  for(let start=0;start<dark.length;start++){
    if(!dark[start]||labels[start])continue;
    const id=parts.length+1,part={id,pixels:[],left:sw,top:sh,right:0,bottom:0,rgb:[0,0,0],rim:0,rimCount:0};
    let head=0,tail=1;queue[0]=start;labels[start]=id;
    while(head<tail){
      const i=queue[head++],x=i%sw,y=Math.floor(i/sw);part.pixels.push(i);
      part.left=Math.min(part.left,x);part.right=Math.max(part.right,x);part.top=Math.min(part.top,y);part.bottom=Math.max(part.bottom,y);
      for(let c=0;c<3;c++)part.rgb[c]+=data[i*4+c];
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const xx=x+dx,yy=y+dy;if(xx<0||xx>=sw||yy<0||yy>=sh)continue;
        const j=yy*sw+xx;
        if(dark[j]){if(!labels[j]){labels[j]=id;queue[tail++]=j;}}
        else if(data[j*4+3]>=128){part.rim+=luma(data[j*4],data[j*4+1],data[j*4+2]);part.rimCount++;}
      }
    }
    parts.push(part);
  }
  const out=cells.slice();
  for(const part of parts){
    if(part.pixels.length<Math.max(3,unit*.15)||part.pixels.length>unit*24||(part.right-part.left+1)>sw/w*9||(part.bottom-part.top+1)>sh/h*9||!part.rimCount||part.rim/part.rimCount<threshold+20)continue;
    const bw=part.right-part.left+3,bh=part.bottom-part.top+3,mask=new Uint8Array(bw*bh),footprint=new Set(),stroke=new Set();
    for(const i of part.pixels){const x=i%sw,y=Math.floor(i/sw);mask[(y-part.top+1)*bw+x-part.left+1]=1;footprint.add(Math.min(h-1,Math.floor((y+.5)*h/sh))*w+Math.min(w-1,Math.floor((x+.5)*w/sw)));}
    const skeleton=thin(mask,bw,bh);
    const length=skeleton.reduce((sum,p)=>sum+p,0);
    if(!length||part.pixels.length/length>Math.sqrt(unit)*1.5)continue;
    for(let y=1;y<bh-1;y++)for(let x=1;x<bw-1;x++)if(skeleton[y*bw+x])stroke.add(Math.min(h-1,Math.floor((part.top+y-.5)*h/sh))*w+Math.min(w-1,Math.floor((part.left+x-.5)*w/sw)));
    for(const cell of footprint){
      if(!out[cell]||stroke.has(cell)||luma(...out[cell])>=threshold)continue;
      const gx=cell%w,gy=Math.floor(cell/w),bins=new Map();let foreignInk=false;
      for(let y=Math.floor(gy*sh/h);y<Math.floor((gy+1)*sh/h);y++)for(let x=Math.floor(gx*sw/w);x<Math.floor((gx+1)*sw/w);x++){
        const i=y*sw+x;if(dark[i]&&labels[i]!==part.id)foreignInk=true;
        if(data[i*4+3]<128||luma(data[i*4],data[i*4+1],data[i*4+2])<threshold+20)continue;
        const rgb=Array.from(data.slice(i*4,i*4+3)),key=rgb.map(v=>v>>5).join(',');
        const bin=bins.get(key)||{n:0,rgb:[0,0,0]};bin.n++;for(let c=0;c<3;c++)bin.rgb[c]+=rgb[c];bins.set(key,bin);
      }
      if(!foreignInk&&bins.size){const b=[...bins.values()].sort((a,b)=>b.n-a.n)[0];out[cell]=b.rgb.map(v=>v/b.n);}
    }
    const ink=part.rgb.map(v=>v/part.pixels.length);
    for(const cell of stroke)if(out[cell])out[cell]=ink;
  }
  return out;
}

export function accentWeights(cells,w,h){
  const labs=cells.map(c=>c&&rgbToLab(c));
  return labs.map((lab,i)=>{
    if(!lab)return 1;
    const x=i%w,y=Math.floor(i/w),neighbors=[];if(x)neighbors.push(i-1);if(x<w-1)neighbors.push(i+1);if(y)neighbors.push(i-w);if(y<h-1)neighbors.push(i+w);
    const contrast=neighbors.reduce((sum,j)=>sum+(labs[j]?Math.min(40,Math.hypot(...lab.map((v,k)=>v-labs[j][k]))):0),0)/Math.max(1,neighbors.length);
    return 1+Math.min(2,Math.hypot(lab[1],lab[2])/35)+Math.min(2,contrast/20);
  });
}

// Both operations keep the alpha mask and use only colors already in the grid.
export function refineRegions(grid,w,h,palette,difference,mergeDistance=0,maxArea=0){
  const labs=new Map(palette.map(p=>[p.code,rgbToLab(p.rgb)])),counts=new Map();
  for(const c of grid)if(c)counts.set(c,(counts.get(c)||0)+1);
  const ordered=[...counts.keys()].sort((a,b)=>counts.get(b)-counts.get(a)||a.localeCompare(b)),kept=[],mapping=new Map();
  for(const code of ordered){let best=code,score=mergeDistance;for(const c of kept){const d=difference(labs.get(code),labs.get(c));if(d<score){score=d;best=c;}}mapping.set(code,best);if(best===code)kept.push(code);}
  const source=grid.map(c=>c===null?null:mapping.get(c)),out=source.slice(),seen=new Uint8Array(grid.length);
  const neighbors=i=>{const x=i%w,y=Math.floor(i/w),a=[];if(x)a.push(i-1);if(x<w-1)a.push(i+1);if(y)a.push(i-w);if(y<h-1)a.push(i+w);return a;};
  if(!maxArea)return out;
  const totals=new Map();for(const c of source)if(c)totals.set(c,(totals.get(c)||0)+1);
  for(let start=0;start<source.length;start++){
    if(!source[start]||seen[start])continue;
    const region=[start],border=new Map();seen[start]=1;
    for(let head=0;head<region.length;head++)for(const j of neighbors(region[head])){
      if(source[j]===source[start]){if(!seen[j]){seen[j]=1;region.push(j);}}
      else if(source[j])border.set(source[j],(border.get(source[j])||0)+1);
    }
    if(region.length>maxArea)continue;
    let best=null,score=Infinity;
    for(const [code,touches]of border){
      if(totals.get(code)<=totals.get(source[start]))continue;
      const d=difference(labs.get(source[start]),labs.get(code));if(d>16)continue;
      const cost=d*d/(1+Math.log2(1+touches));if(cost<score){score=cost;best=code;}
    }
    if(best)for(const i of region)out[i]=best;
  }
  return out;
}
