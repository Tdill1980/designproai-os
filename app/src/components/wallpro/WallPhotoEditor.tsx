import { useRef, useState } from 'react';
import { rectangularWallMask, type Point } from '@/lib/wallpro-geometry';

type Props = {
  url: string; alt: string; aspect: number; busy: boolean;
  marking: 'wall' | 'exclude' | 'rectangle' | null;
  corners: Point[]; masks: Point[][]; draft: Point[]; showMasks: boolean;
  /** Pixel-accurate protected areas from detection (white where protected). */
  maskUrl?: string | null;
  seams: { top: Point; bottom: Point }[];
  onEditing: (editing: boolean) => void;
  onPoint: (point: Point) => void;
  onRectangle: (a: Point, b: Point) => void;
  onCorners: (points: Point[]) => void;
  onMasks: (masks: Point[][]) => void;
};
type Handle = { kind: 'wall' | 'mask'; mask: number; vertex: number };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const coords = (points: Point[]) => points.map(p => `${p.x * 100},${p.y * 100}`).join(' ');

export function WallPhotoEditor(p: Props) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Handle | null>(null);
  const rectangle = useRef<{ start: Point; down: Point; hadStart: boolean; moved: boolean } | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const point = (e: { clientX: number; clientY: number }): Point => {
    const bounds = box.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - bounds.left) / bounds.width), y: clamp((e.clientY - bounds.top) / bounds.height) };
  };
  function moveHandle(handle: Handle, next: Point) {
    if (handle.kind === 'wall') p.onCorners(p.corners.map((q,i) => i === handle.vertex ? next : q));
    else p.onMasks(p.masks.map((mask,i) => i === handle.mask ? mask.map((q,j) => j === handle.vertex ? next : q) : mask));
  }
  function startHandle(e: React.PointerEvent<SVGCircleElement>, handle: Handle) {
    e.stopPropagation(); if (p.busy) return;
    e.preventDefault(); drag.current = handle; p.onEditing(true); e.currentTarget.setPointerCapture(e.pointerId);
  }
  function keyboardHandle(e: React.KeyboardEvent<SVGCircleElement>, handle: Handle, current: Point) {
    const deltas: Record<string,Point> = { ArrowLeft:{x:-1,y:0}, ArrowRight:{x:1,y:0}, ArrowUp:{x:0,y:-1}, ArrowDown:{x:0,y:1} };
    if (p.busy || !deltas[e.key]) return; e.preventDefault();
    const step = e.shiftKey ? .01 : .001, delta = deltas[e.key];
    moveHandle(handle,{x:clamp(current.x+delta.x*step),y:clamp(current.y+delta.y*step)});
  }
  let rectanglePreview: Point[] = [];
  if (p.marking === 'rectangle' && p.draft[0] && hover) { try { rectanglePreview = rectangularWallMask(p.draft[0],hover); } catch { /* Pointer has not moved yet. */ } }
  const overlays = p.showMasks || !!p.marking;
  return <div ref={box} className="relative w-full overflow-hidden rounded-lg bg-slate-100 select-none" style={{ aspectRatio:p.aspect, cursor:p.marking ? 'crosshair' : 'default', touchAction:p.marking ? 'none' : 'auto' }} aria-label="Wall placement photo"
    onPointerDown={e => {
      if (p.busy || !p.marking) return; e.preventDefault();
      const next=point(e); e.currentTarget.setPointerCapture(e.pointerId);
      if(p.marking==='rectangle') { rectangle.current={start:p.draft[0]||next,down:next,hadStart:!!p.draft.length,moved:false}; if(!p.draft.length)p.onPoint(next); }
      else p.onPoint(next);
    }}
    onPointerMove={e => {
      if(p.busy)return; const next=point(e);
      if(drag.current){moveHandle(drag.current,next);return;}
      if(p.marking)setHover(next);
      if(rectangle.current && Math.hypot(next.x-rectangle.current.down.x,next.y-rectangle.current.down.y)>.004)rectangle.current.moved=true;
    }}
    onPointerUp={e => {
      if(drag.current){moveHandle(drag.current,point(e));drag.current=null;p.onEditing(false);return;}
      const active=rectangle.current; rectangle.current=null;
      if(active && !p.busy){ if(active.moved)p.onRectangle(active.start,point(e)); else if(active.hadStart)p.onPoint(point(e)); }
      setHover(null);
    }}
    onPointerCancel={() => {p.onEditing(false);drag.current=null;rectangle.current=null;setHover(null);}}
    onLostPointerCapture={() => {p.onEditing(false);drag.current=null;rectangle.current=null;}}
    onPointerLeave={() => {if(!rectangle.current && !drag.current)setHover(null);}}>
    <img src={p.url} alt={p.alt} className="pointer-events-none absolute inset-0 h-full w-full object-contain" draggable={false}/>
    {overlays && p.maskUrl && <img src={p.maskUrl} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-35" style={{ filter: 'drop-shadow(0 0 1px #22d3ee)' }} draggable={false}/>}
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <linearGradient id="wall-protected-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#b9f6ff" stopOpacity=".4"/><stop offset=".45" stopColor="#38bdf8" stopOpacity=".13"/><stop offset="1" stopColor="#0e7490" stopOpacity=".28"/></linearGradient>
        <linearGradient id="wall-area-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ddd6fe" stopOpacity=".22"/><stop offset="1" stopColor="#8b5cf6" stopOpacity=".07"/></linearGradient>
        <filter id="wall-mask-halo" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".35"/></filter>
      </defs>
      {overlays && <polygon points={coords(p.corners)} fill="url(#wall-area-glass)" stroke="#8b5cf6" strokeWidth=".3"/>}
      {overlays && p.masks.map((mask,i)=>{
        const x=Math.min(...mask.map(q=>q.x))*100, y=Math.min(...mask.map(q=>q.y))*100;
        return <g key={i}>
          <polygon points={coords(mask)} fill="rgba(0,120,220,.10)" stroke="#00dcff" strokeWidth=".65" filter="url(#wall-mask-halo)"/>
          <polygon points={coords(mask)} fill="url(#wall-protected-glass)" stroke="#22d3ee" strokeWidth=".35" style={{pointerEvents:!p.marking && !p.busy?'auto':'none',cursor:'pointer'}} onPointerDown={e=>{e.stopPropagation();setSelected(i);}}/>
          <rect x={x+.4} y={y+.4} width="19" height="3.8" rx=".65" fill="#0e7490" fillOpacity=".9"/>
          <text x={x+1.2} y={y+2.4} fill="white" fontSize="1.5">Protected {i+1}</text>
          {(selected===i || !!p.marking) && mask.map((q,j)=><circle key={j} cx={q.x*100} cy={q.y*100} r=".7" fill="white" stroke="#0891b2" strokeWidth=".3" style={{pointerEvents:p.busy?'none':'auto',cursor:'move',touchAction:'none'}} tabIndex={0} role="button" aria-label={`Mask ${i+1} point ${j+1}`} onPointerDown={e=>startHandle(e,{kind:'mask',mask:i,vertex:j})} onKeyDown={e=>keyboardHandle(e,{kind:'mask',mask:i,vertex:j},q)}/>)}
        </g>;
      })}
      {overlays && p.corners.map((q,i)=><g key={i}><circle cx={q.x*100} cy={q.y*100} r=".85" fill="#7c3aed" stroke="white" strokeWidth=".2" style={{pointerEvents:p.busy?'none':'auto',cursor:'move',touchAction:'none'}} tabIndex={0} role="button" aria-label={`Wall corner ${i+1}`} onPointerDown={e=>startHandle(e,{kind:'wall',mask:0,vertex:i})} onKeyDown={e=>keyboardHandle(e,{kind:'wall',mask:0,vertex:i},q)}/><text x={q.x*100+1.2} y={q.y*100-1.2} fill="#6d28d9" fontSize="2.5">{i+1}</text></g>)}
      {p.seams.map((seam,i)=><line key={i} x1={seam.top.x*100} y1={seam.top.y*100} x2={seam.bottom.x*100} y2={seam.bottom.y*100} stroke="#06b6d4" strokeWidth=".3" strokeDasharray="1 .8"/>)}
      {p.marking==='exclude' && <polygon points={coords([...p.draft,...(hover?[hover]:[])])} fill="url(#wall-protected-glass)" stroke="#22d3ee" strokeWidth=".3" strokeDasharray=".8 .5"/>}
      {rectanglePreview.length>0 && <polygon points={coords(rectanglePreview)} fill="url(#wall-protected-glass)" stroke="#22d3ee" strokeWidth=".3"/>}
      {p.draft.map((q,i)=><circle key={i} cx={q.x*100} cy={q.y*100} r=".65" fill="#0891b2"/>)}
    </svg>
  </div>;
}
