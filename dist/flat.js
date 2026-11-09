import {removeBackground,matchPalette} from './engine.js';
import {thin,accentWeights} from './refinement.js';

// Region/ink separation ported from the local outline-study experiment.
// All OpenCV allocations belong to this invocation and are released in finally.
export function convertFlat({data,width:sw,height:sh,options={},palette},cv){
  const {size=70,maxColors=12,background=true,fit=true,flat={}}=options;
  const {outer=2,detail=50,flatness=50,strokeCode}=flat;
  if(!Number.isInteger(size)||size<8||size>192||!Number.isInteger(maxColors)||maxColors<1||maxColors>291||!sw||!sh||data.length!==sw*sh*4)throw Error('转换参数无效');
  if(!Number.isInteger(outer)||outer<0||outer>4||!Number.isFinite(detail)||detail<0||detail>100||!Number.isFinite(flatness)||flatness<0||flatness>100)throw Error('描边平涂参数无效');
  const ink=palette.find(p=>p.code===strokeCode)?.rgb||palette.find(p=>p.code===matchPalette([[90,33,33]],palette,1)[0]).rgb;
  let input=data,warning='';
  if(background&&!data.some((v,i)=>i%4===3&&v<128)){const bg=removeBackground(data,sw,sh);input=bg.data;warning=bg.warning;}
  let left=sw,top=sh,right=-1,bottom=-1;
  for(let y=0;y<sh;y++)for(let x=0;x<sw;x++)if(input[(y*sw+x)*4+3]>0){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  if(!fit||right<left){left=top=0;right=sw-1;bottom=sh-1;}
  const bw=right-left+1,bh=bottom-top+1,w=Math.max(1,Math.round(bw/Math.max(bw,bh)*size)),h=Math.max(1,Math.round(bh/Math.max(bw,bh)*size));
  const unit=Math.max(4,Math.min(12,Math.floor(960/Math.max(w,h)))),ww=w*unit,hh=h*unit,n=ww*hh;
  const owned=[],own=m=>(owned.push(m),m),release=mark=>{while(owned.length>mark)owned.pop().delete();};
  const mark=()=>owned.length,mat=(bytes,channels=1)=>own(cv.matFromArray(hh,ww,channels===3?cv.CV_8UC3:cv.CV_8UC1,bytes));
  const kernel=(radius,ellipse=false)=>own(cv.getStructuringElement(ellipse?cv.MORPH_ELLIPSE:cv.MORPH_RECT,new cv.Size(radius*2+1,radius*2+1)));
  function morph(mask,operation,radius=1,ellipse=false){const m=mark(),src=mat(mask),out=own(new cv.Mat()),k=kernel(radius,ellipse);if(operation==='grow')cv.dilate(src,out,k);else cv.morphologyEx(src,out,cv.MORPH_CLOSE,k);const bytes=new Uint8Array(out.data);release(m);return bytes;}
  function components(mask){const m=mark(),src=mat(mask),labels=own(new cv.Mat()),stats=own(new cv.Mat()),centers=own(new cv.Mat());const count=cv.connectedComponentsWithStats(src,labels,stats,centers,8,cv.CV_32S);const result={count,labels:new Int32Array(labels.data32S),stats:new Int32Array(stats.data32S)};release(m);return result;}
  function medianRGB(indices,rgb){const bins=[new Uint32Array(256),new Uint32Array(256),new Uint32Array(256)];for(const i of indices)for(let c=0;c<3;c++)bins[c][rgb[i*3+c]]++;return bins.map(b=>{let count=0,a=-1;for(let v=0;v<256;v++){count+=b[v];if(a<0&&count>Math.floor((indices.length-1)/2))a=v;if(count>Math.floor(indices.length/2))return(a+v)/2;}return 255;});}
  function cluster(samples,k){const m=mark(),count=samples.length/3,src=own(cv.matFromArray(count,3,cv.CV_32F,samples)),labels=own(new cv.Mat()),centers=own(new cv.Mat());cv.setRNGSeed(20261106);cv.kmeans(src,Math.min(k,count),labels,new cv.TermCriteria(cv.TermCriteria_EPS+cv.TermCriteria_MAX_ITER,30,.2),1,cv.KMEANS_PP_CENTERS,centers);const result={labels:new Int32Array(labels.data32S),centers:new Float32Array(centers.data32F)};release(m);return result;}
  function labRGB(centers){const m=mark(),bytes=Uint8Array.from(centers,v=>Math.max(0,Math.min(255,Math.trunc(v)))),src=own(cv.matFromArray(1,bytes.length/3,cv.CV_8UC3,bytes)),out=own(new cv.Mat());cv.cvtColor(src,out,cv.COLOR_Lab2RGB);const rgb=new Uint8Array(out.data);release(m);return rgb;}
  function regionalFill(rgb,mask,dark,saturation){
    const m=mark(),barrier=morph(dark,'grow'),src=mat(rgb,3),bar=mat(Uint8Array.from(barrier,v=>v?255:0)),filled=own(new cv.Mat());cv.inpaint(src,bar,filled,3,cv.INPAINT_TELEA);const result=new Uint8Array(filled.data);release(m);
    for(let colored=0;colored<2;colored++){
      const free=Uint8Array.from(mask,(v,i)=>v&&!barrier[i]&&Number(saturation[i]>=24)===colored?1:0),parts=components(free),counts=new Int32Array(parts.count),starts=new Int32Array(parts.count+1);
      for(let id=1;id<parts.count;id++)if(parts.stats[id*5+4]>=20)counts[id]=parts.stats[id*5+4];
      for(let id=0;id<parts.count;id++)starts[id+1]=starts[id]+counts[id];
      const cursor=starts.slice(),packed=new Int32Array(starts[parts.count]);for(let i=0;i<n;i++){const id=parts.labels[i];if(counts[id])packed[cursor[id]++]=i;}
      for(let id=1;id<parts.count;id++){
        if(!counts[id])continue;
        const indices=packed.subarray(starts[id],starts[id+1]),pixels=new Uint8Array(indices.length*3);indices.forEach((i,j)=>pixels.set(rgb.subarray(i*3,i*3+3),j*3));
        const r=mark(),sample=own(cv.matFromArray(indices.length,1,cv.CV_8UC3,pixels)),lab=own(new cv.Mat());cv.cvtColor(sample,lab,cv.COLOR_RGB2Lab);const labs=new Uint8Array(lab.data),middle=medianRGB(Array.from({length:indices.length},(_,i)=>i),labs),distances=new Float32Array(indices.length);
        for(let i=0;i<indices.length;i++)distances[i]=Math.hypot(labs[i*3]-middle[0],labs[i*3+1]-middle[1],labs[i*3+2]-middle[2]);
        distances.sort();const spread=distances[Math.min(distances.length-1,Math.floor(distances.length*.95))];release(r);
        if(spread>12+flatness*.24&&indices.length>=2){const groups=cluster(Float32Array.from(labs),2),colors=labRGB(groups.centers);indices.forEach((i,j)=>result.set(colors.subarray(groups.labels[j]*3,groups.labels[j]*3+3),i*3));}
        else{const color=medianRGB(indices,rgb);for(const i of indices)result.set(color,i*3);}
      }
    }
    return result;
  }
  try{
    const sourceRGB=new Uint8Array(sw*sh*3),sourceAlpha=new Uint8Array(sw*sh);for(let i=0;i<sw*sh;i++){const a=input[i*4+3]/255;sourceAlpha[i]=input[i*4+3];for(let c=0;c<3;c++)sourceRGB[i*3+c]=Math.round(input[i*4+c]*a+255*(1-a));}
    const source=own(cv.matFromArray(sh,sw,cv.CV_8UC3,sourceRGB)),sourceMask=own(cv.matFromArray(sh,sw,cv.CV_8UC1,sourceAlpha)),roi=own(source.roi(new cv.Rect(left,top,bw,bh))),maskROI=own(sourceMask.roi(new cv.Rect(left,top,bw,bh))),resized=own(new cv.Mat()),resizedMask=own(new cv.Mat());cv.resize(roi,resized,new cv.Size(ww,hh),0,0,cv.INTER_LANCZOS4);cv.resize(maskROI,resizedMask,new cv.Size(ww,hh),0,0,cv.INTER_LANCZOS4);
    const alpha=Uint8Array.from(resizedMask.data,v=>v>=128?1:0),rgb=new Uint8Array(resized.data);
    release(0);
    if(!alpha.some(Boolean))return{width:w,height:h,grid:Array(w*h).fill(null),mode:'flat',preprocess:'off',flat:{outer,detail,flatness,strokeCode},warning};
    const color=mat(rgb,3),gray=own(new cv.Mat()),hsv=own(new cv.Mat());cv.cvtColor(color,gray,cv.COLOR_RGB2GRAY);cv.cvtColor(color,hsv,cv.COLOR_RGB2HSV);
    const saturation=Uint8Array.from(alpha,(_,i)=>hsv.data[i*3+1]);let mask=new Uint8Array(alpha);
    if(background){
      const barrier=morph(Uint8Array.from(alpha,(a,i)=>a&&(gray.data[i]<195||saturation[i]>=24)?1:0),'close'),src=mat(barrier),contours=own(new cv.MatVector()),hierarchy=own(new cv.Mat());cv.findContours(src,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
      const silhouette=own(cv.Mat.zeros(hh,ww,cv.CV_8UC1));for(let i=0;i<contours.size();i++){const c=contours.get(i);if(cv.contourArea(c)>=w*h*.05)cv.drawContours(silhouette,contours,i,new cv.Scalar(1),cv.FILLED);c.delete();}
      if(silhouette.data.some(Boolean))mask=Uint8Array.from(alpha,(a,i)=>a&&silhouette.data[i]?1:0);
    }
    const med=own(new cv.Mat()),medianSize=Math.max(3,Math.round(unit*1.25)|1);cv.medianBlur(gray,med,medianSize);
    const dark=Uint8Array.from(mask,(v,i)=>v&&gray.data[i]<155&&(med.data[i]-gray.data[i]>14||gray.data[i]<95)?1:0),parts=components(dark),minimum=.2+(100-detail)*.004;
    for(let i=0;i<n;i++){const p=parts.labels[i]*5;if(dark[i]&&parts.stats[p+4]<unit*unit*minimum&&Math.min(parts.stats[p+2],parts.stats[p+3])<unit*.6)dark[i]=0;}
    const maskMat=mat(mask),depth=own(new cv.Mat());cv.distanceTransform(maskMat,depth,cv.DIST_L2,3);
    const exterior=Uint8Array.from(mask,(v,i)=>v&&depth.data32F[i]<=unit*.25?1:0),inner=Uint8Array.from(dark,(v,i)=>v&&depth.data32F[i]>unit*.25?1:0),outline=morph(exterior,'grow',Math.max(0,Math.round(outer*unit/12)),true);
    const flatRGB=regionalFill(rgb,mask,dark,saturation),flatMat=mat(flatRGB,3),flatLab=own(new cv.Mat());cv.cvtColor(flatMat,flatLab,cv.COLOR_RGB2Lab);
    const valid=[];for(let i=0;i<n;i++)if(mask[i]&&!dark[i])valid.push(i);
    const stride=Math.max(1,Math.ceil(valid.length/160000)),samples=new Float32Array(Math.ceil(valid.length/stride)*3);let pos=0;for(let i=0;i<valid.length;i+=stride){samples.set(flatLab.data.subarray(valid[i]*3,valid[i]*3+3),pos);pos+=3;}
    const fallback=valid.length?null:[255,255,255],quant=valid.length?cluster(samples,Math.round(26-flatness*.16)):null,colors=quant?labRGB(quant.centers):new Uint8Array(fallback),ids=new Uint8Array(n),colorCount=colors.length/3;
    if(quant)for(let i=0;i<n;i++){let best=0,score=Infinity;for(let k=0;k<colorCount;k++){const a=flatLab.data[i*3]-quant.centers[k*3],b=flatLab.data[i*3+1]-quant.centers[k*3+1],c=flatLab.data[i*3+2]-quant.centers[k*3+2],d=a*a+b*b+c*c;if(d<score){score=d;best=k;}}ids[i]=best;}
    const featureCells=new Uint8Array(w*h),features=components(dark);
    for(let id=1;id<features.count;id++){
      const [x,y,bw,bh,area]=features.stats.subarray(id*5,id*5+5);if(area<unit*unit*(.1+(100-detail)*.002)||area>unit*unit*10||bw>unit*6||bh>unit*6)continue;
      const mw=bw+2,mh=bh+2,small=new Uint8Array(mw*mh);for(let yy=0;yy<bh;yy++)for(let xx=0;xx<bw;xx++)if(features.labels[(y+yy)*ww+x+xx]===id)small[(yy+1)*mw+xx+1]=1;
      const core=thin(small,mw,mh);for(let yy=1;yy<mh-1;yy++)for(let xx=1;xx<mw-1;xx++)if(core[yy*mw+xx])featureCells[Math.floor((y+yy-1)/unit)*w+Math.floor((x+xx-1)/unit)]=1;
    }
    const cells=[],preview=new Uint8ClampedArray(n*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const votes=new Uint32Array(colorCount);let filled=0,outerHits=0,innerHits=0;for(let dy=0;dy<unit;dy++)for(let dx=0;dx<unit;dx++){const i=(y*unit+dy)*ww+x*unit+dx;votes[ids[i]]++;filled+=mask[i];outerHits+=outline[i];innerHits+=inner[i];}
      let chosen=0;for(let k=1;k<votes.length;k++)if(votes[k]>votes[chosen])chosen=k;
      const isLine=outerHits>=unit*unit*.24||innerHits>=unit*unit*.24||featureCells[y*w+x],occupied=filled>=unit*unit*.35||isLine;
      cells.push(!occupied?null:isLine?ink:Array.from(colors.subarray(chosen*3,chosen*3+3)));
    }
    for(let i=0;i<n;i++){preview.set(outline[i]||inner[i]?ink:flatRGB.subarray(i*3,i*3+3),i*4);preview[i*4+3]=mask[i]||outline[i]?255:0;}
    return{width:w,height:h,grid:matchPalette(cells,palette,maxColors,accentWeights(cells,w,h)),mode:'flat',preprocess:'off',flat:{outer,detail,flatness,strokeCode},fitted:fit,warning,preprocessed:{width:ww,height:hh,data:preview}};
  }finally{release(0);}
}
