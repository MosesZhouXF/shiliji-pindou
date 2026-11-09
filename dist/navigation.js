// Pointer gestures are kept separate from bead editing so navigation never paints.
export function normalizeZoom(next,current){return Number.isFinite(next)?Math.max(.5,next):current;}

export function attachNavigation({stage,paper,getZoom,setZoom,canDraw,startDraw,moveDraw,endDraw,cancelDraw,hover}){
  const pointers=new Map();let mode=null,last=null,pinch=null,panX=0,panY=0;
  const point=e=>({x:e.clientX,y:e.clientY});
  const applyPan=()=>{paper.style.transform=`translate(${panX}px, ${panY}px)`;};
  const anchor=p=>{const r=paper.getBoundingClientRect();return{x:(p.x-r.left)/r.width,y:(p.y-r.top)/r.height};};
  function place(a,p){const r=paper.getBoundingClientRect();panX+=p.x-r.left-a.x*r.width;panY+=p.y-r.top-a.y*r.height;applyPan();}
  function pair(){const [a,b]=[...pointers.values()];return{center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))};}
  function beginPinch(){const p=pair();pinch={...p,zoom:getZoom(),anchor:anchor(p.center)};mode='pinch';stage.classList.add('dragging');}
  stage.addEventListener('pointerdown',e=>{
    if(e.button!==0&&e.button!==1)return;
    e.preventDefault();pointers.set(e.pointerId,point(e));stage.setPointerCapture(e.pointerId);
    if(pointers.size>=2){if(mode==='draw')cancelDraw();beginPinch();return;}
    last=point(e);
    if(e.button===0&&canDraw(e)){
      mode=e.pointerType==='touch'?'pending':'draw';
      last=e;if(mode==='draw')startDraw(e);
    }else{mode='pan';stage.classList.add('dragging');}
  });
  stage.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId)){if(!pointers.size)hover(e);return;}
    e.preventDefault();const current=point(e);pointers.set(e.pointerId,current);
    if(mode==='pinch'){
      const p=pair();setZoom(pinch.zoom*p.distance/pinch.distance);place(pinch.anchor,p.center);
    }else if(mode==='pan'){
      panX+=current.x-last.x;panY+=current.y-last.y;last=current;applyPan();
    }else if(mode==='pending'){
      if(Math.hypot(e.clientX-last.clientX,e.clientY-last.clientY)<4)return;
      mode='draw';startDraw(last);moveDraw(e);
    }else if(mode==='draw')moveDraw(e);
  });
  function finish(e,canceled=false){
    if(!pointers.has(e.pointerId))return;
    if(mode==='pending'&&!canceled){startDraw(e);endDraw();}
    else if(mode==='draw'){if(canceled)cancelDraw();else endDraw();}
    pointers.delete(e.pointerId);
    if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);
    if(pointers.size>=2)beginPinch();
    else if(pointers.size){mode='pan';last=[...pointers.values()][0];}
    else{mode=null;pinch=null;stage.classList.remove('dragging');}
  }
  stage.addEventListener('pointerup',e=>finish(e));
  stage.addEventListener('pointercancel',e=>finish(e,true));
  stage.addEventListener('lostpointercapture',e=>finish(e,true));
  stage.addEventListener('dragstart',e=>e.preventDefault());
  stage.addEventListener('wheel',e=>{
    if(!e.deltaY||pointers.size)return;
    e.preventDefault();const p=point(e),a=anchor(p),delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?stage.clientHeight:1);
    setZoom(getZoom()*Math.exp(-Math.max(-240,Math.min(240,delta))*.0015));place(a,p);
  },{passive:false});
  return{reset(){if(mode==='draw')cancelDraw();const ids=[...pointers.keys()];pointers.clear();mode=null;pinch=null;for(const id of ids)if(stage.hasPointerCapture(id))stage.releasePointerCapture(id);panX=panY=0;applyPan();stage.classList.remove('dragging');}};
}
