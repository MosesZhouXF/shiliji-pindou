import {countColors} from './engine.js';

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

// SVG keeps labels and grid lines sharp independently of screen zoom.
export function createPatternSheet(project,paletteMap,paletteName){
  const cell=56,pad=88,top=144,counts=countColors(project.grid);
  const width=Math.max(880,project.width*cell+pad*2),cols=Math.max(1,Math.floor((width-pad*2)/208));
  const legendTop=top+project.height*cell+48,height=legendTop+Math.ceil(counts.length/cols)*60+64;
  const parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#fff"/>',
    '<g font-family="Arial, sans-serif">'];
  const text=(x,y,value,size=16,color='#3c5941',anchor='start',weight='normal')=>parts.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${weight}">${escape(value)}</text>`);
  text(pad,48,'拾粒集 SHILIJI / 拼豆图纸',28,'#245840','start','bold');
  text(pad,82,`${project.width} × ${project.height} 格 · ${paletteName} · ${counts.length} 色 · ${counts.reduce((n,v)=>n+v.count,0)} 颗`);
  parts.push(`<rect x="${pad}" y="${top}" width="${project.width*cell}" height="${project.height*cell}" fill="#fafbf8"/>`);
  for(let x=0;x<project.width;x++)text(pad+(x+.5)*cell,top-20,x+1,16,'#667460','middle');
  for(let y=0;y<project.height;y++){
    text(pad-20,top+(y+.5)*cell+6,y+1,16,'#667460','end');
    for(let x=0;x<project.width;x++){
      const p=paletteMap.get(project.grid[y*project.width+x]);if(!p)continue;
      parts.push(`<rect x="${pad+x*cell}" y="${top+y*cell}" width="${cell}" height="${cell}" fill="${escape(p.hex)}"/>`);
      const luminance=p.rgb.reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      text(pad+(x+.5)*cell,top+(y+.5)*cell+6,p.code,18,luminance<145?'#fff':'#26372b','middle','bold');
    }
  }
  for(const major of [false,true]){
    const lines=[];
    for(let x=0;x<=project.width;x++)if((x%10===0||x===project.width)===major)lines.push(`M${pad+x*cell} ${top}v${project.height*cell}`);
    for(let y=0;y<=project.height;y++)if((y%10===0||y===project.height)===major)lines.push(`M${pad} ${top+y*cell}h${project.width*cell}`);
    parts.push(`<path d="${lines.join('')}" fill="none" stroke="${major?'#465b49':'#bdc6bf'}" stroke-width="${major?2:1}"/>`);
  }
  counts.forEach((item,i)=>{
    const x=pad+(i%cols)*208,y=legendTop+Math.floor(i/cols)*60;
    parts.push(`<rect x="${x}" y="${y}" width="32" height="32" fill="${escape(paletteMap.get(item.code).hex)}" stroke="#bbb"/>`);
    text(x+44,y+23,`${item.code} · ${item.count} 颗`,18);
  });
  text(pad,height-24,'5 mm 拼豆 · 色号仅供参考，实物请对照色卡 · 拾粒集',14,'#667460');
  parts.push('</g></svg>');
  // Keep mobile canvas allocation within 16 megapixels; SVG retains full detail at any size.
  const scale=Math.min(1,4096/width,4096/height,Math.sqrt(16000000/(width*height)));
  return{svg:parts.join(''),width,height,pngWidth:Math.floor(width*scale),pngHeight:Math.floor(height*scale)};
}
