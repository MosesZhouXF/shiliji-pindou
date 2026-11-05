import {rgbToLab} from './color.js';

// Work on a source-resolution image, before it is reduced to the bead grid.
export function preprocessImage(data,width,height,strength='standard',targetSize=64) {
  const level={light:{passes:1,range:12,colors:20,radius:.22},standard:{passes:2,range:18,colors:16,radius:.38},strong:{passes:3,range:25,colors:12,radius:.55}}[strength];
  if(!level||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||data.length!==width*height*4)throw Error('原图预处理参数无效');
  const n=width*height,guide=new Float32Array(n*3);let current=new Float32Array(n*3);
  for(let i=0;i<n;i++){const c=[data[i*4],data[i*4+1],data[i*4+2]];current.set(c,i*3);if(data[i*4+3]>=128)guide.set(rgbToLab(c),i*3);}
  const radius=Math.max(1,Math.min(5,Math.round(Math.max(width,height)/targetSize*level.radius))),offsets=[];
  for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)offsets.push([dx,dy,Math.exp(-(dx*dx+dy*dy)/(2*radius*radius))]);
  const range=Float32Array.from({length:20001},(_,i)=>Math.exp(-i/(2*level.range*level.range)));
  for(let pass=0;pass<level.passes;pass++){
    const next=new Float32Array(current);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x,k=i*3;if(data[i*4+3]<128)continue;
      let weight=0,r=0,g=0,b=0;
      for(const [dx,dy,spatial]of offsets){
        const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=width||yy>=height)continue;
        const j=yy*width+xx,q=j*3;if(data[j*4+3]<128)continue;
        const d=(guide[k]-guide[q])**2+(guide[k+1]-guide[q+1])**2+(guide[k+2]-guide[q+2])**2;
        const w=spatial*range[Math.min(20000,Math.round(d))];weight+=w;r+=w*current[q];g+=w*current[q+1];b+=w*current[q+2];
      }
      next[k]=r/weight;next[k+1]=g/weight;next[k+2]=b/weight;
    }
    current=next;
  }
  // Weighted Lab clustering creates a flat-color source, rather than merely blurring textures.
  const histogram=new Map(),keys=new Int16Array(n).fill(-1);
  for(let i=0;i<n;i++)if(data[i*4+3]>=128){
    const k=i*3,key=(Math.min(255,Math.round(current[k]))>>4)*256+(Math.min(255,Math.round(current[k+1]))>>4)*16+(Math.min(255,Math.round(current[k+2]))>>4);
    keys[i]=key;let bin=histogram.get(key);if(!bin){bin={count:0,rgb:[0,0,0],label:0};histogram.set(key,bin);}bin.count++;for(let c=0;c<3;c++)bin.rgb[c]+=current[k+c];
  }
  const out=new Uint8ClampedArray(data),bins=[...histogram.values()];if(!bins.length)return out;
  for(const bin of bins){bin.rgb=bin.rgb.map(v=>v/bin.count);bin.lab=rgbToLab(bin.rgb);}
  const distance=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;
  let centers=[bins.reduce((a,b)=>a.count>=b.count?a:b)];
  const dark=bins.filter(b=>b.count>=3&&b.lab[0]<35).sort((a,b)=>b.count-a.count||a.lab[0]-b.lab[0])[0];
  if(dark){const anchor={rgb:dark.rgb,lab:dark.lab,fixed:true};if(centers[0]===dark)centers[0]=anchor;else centers.push(anchor);}
  const errors=bins.map(b=>Math.min(...centers.map(c=>distance(b.lab,c.lab))));
  while(centers.length<Math.min(level.colors,bins.length)){
    let best=-1,score=1;for(let i=0;i<bins.length;i++){const merit=Math.sqrt(bins[i].count)*errors[i];if(merit>score){score=merit;best=i;}}
    if(best<0)break;centers.push(bins[best]);for(let i=0;i<bins.length;i++)errors[i]=Math.min(errors[i],distance(bins[i].lab,bins[best].lab));
  }
  for(let iteration=0;iteration<8;iteration++){
    const sums=centers.map(()=>({count:0,rgb:[0,0,0]}));
    for(const bin of bins){let best=0,score=Infinity;for(let c=0;c<centers.length;c++){const d=distance(bin.lab,centers[c].lab);if(d<score){score=d;best=c;}}bin.label=best;const s=sums[best];s.count+=bin.count;for(let c=0;c<3;c++)s.rgb[c]+=bin.rgb[c]*bin.count;}
    centers=centers.map((old,i)=>{const s=sums[i];if(old.fixed||!s.count)return old;const rgb=s.rgb.map(v=>v/s.count);return{rgb,lab:rgbToLab(rgb)};});
  }
  let labels=Int16Array.from(keys,key=>key<0?-1:histogram.get(key).label);
  const similar=centers.map(a=>centers.map(b=>distance(a.lab,b.lab)<=20**2));
  for(let pass=0;pass<level.passes;pass++){
    const next=new Int16Array(labels),counts=new Uint8Array(centers.length);
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
      const i=y*width+x;if(labels[i]<0)continue;counts.fill(0);let best=labels[i];
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const label=labels[(y+dy)*width+x+dx];if(label>=0){counts[label]++;if(counts[label]>counts[best])best=label;}}
      if(counts[best]>=5&&similar[labels[i]][best])next[i]=best;
    }
    labels=next;
  }
  for(let i=0;i<n;i++)if(labels[i]>=0)for(let c=0;c<3;c++)out[i*4+c]=Math.round(centers[labels[i]].rgb[c]);
  return out;
}
