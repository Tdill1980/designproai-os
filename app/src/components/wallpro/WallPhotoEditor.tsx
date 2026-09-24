import { useEffect, useRef, useState } from 'react';
import { rectangularWallMask, isRectangularMask, resizeRectangularMask, translateMask, type Point } from '@/lib/wallpro-geometry';
import type { WallItem } from '@/lib/wallpro-items';
// The overlay colours live in ONE place so the FAQ can show the customer the
// same glass this editor draws, and cannot be left behind by a restyle here.
import {
  WALL_GLASS, WallGlassDefs, WALL_AREA_FILL, WALL_PROTECTED_FILL, WALL_HALO_FILTER,
} from './wall-glass';

type Props = {
  url: string; alt: string; aspect: number; busy: boolean;
  /** 'tap' is one-touch masking and 'tap-remove' its opposite: a single tap is
   *  the whole gesture either way, so neither enters `draft` and neither needs
   *  a Finish. The page turns that point into a segmentation request and
   *  applies the mode's own class to whatever comes back. */
  marking: 'wall' | 'exclude' | 'rectangle' | 'tap' | 'tap-remove' | null;
  corners: Point[]; masks: Point[][]; draft: Point[]; showMasks: boolean;
  /** Pixel-accurate protected areas from detection (white where protected). */
  maskUrl?: string | null;
  /**
   * The detected objects, still as objects. Tapping one flips it between kept
   * and painted-through — the one-click correction the composite masks alone
   * could never offer, because once rasterised there is no "the sofa" to tap.
   */
  items?: WallItem[];
  onToggleItem?: (id: string) => void;
  seams: { top: Point; bottom: Point }[];
  onEditing: (editing: boolean) => void;
  onPoint: (point: Point) => void;
  onRectangle: (a: Point, b: Point) => void;
  onCorners: (points: Point[]) => void;
  onMasks: (masks: Point[][]) => void;
};
/**
 * `body` is a whole-mask drag; its `vertex` is unused. Moving a mask was
 * impossible before -- the only affordance was one vertex at a time, which
 * changes the shape rather than its position.
 */
type Handle = { kind: 'wall' | 'mask' | 'body'; mask: number; vertex: number };
/** Touch radius in viewBox units (~4% of the photo's width): a thumb, not a
 *  cursor. The drawn dot stays at 1.1 so it never hides what it sits on. */
const HANDLE_TOUCH_R = 4;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const coords = (points: Point[]) => points.map(p => `${p.x * 100},${p.y * 100}`).join(' ');

export function WallPhotoEditor(p: Props) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Handle | null>(null);
  const bodyFrom = useRef<Point | null>(null);
  const rectangle = useRef<{ start: Point; down: Point; hadStart: boolean; moved: boolean } | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const point = (e: { clientX: number; clientY: number }): Point => {
    const bounds = box.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - bounds.left) / bounds.width), y: clamp((e.clientY - bounds.top) / bounds.height) };
  };
  function moveHandle(handle: Handle, next: Point) {
    if (handle.kind === 'wall') { p.onCorners(p.corners.map((q,i) => i === handle.vertex ? next : q)); return; }
    if (handle.kind === 'body') {
      const from = bodyFrom.current; if (!from) return; bodyFrom.current = next;
      p.onMasks(p.masks.map((mask,i) => i === handle.mask ? translateMask(mask, next.x - from.x, next.y - from.y) : mask));
      return;
    }
    // A RECTANGLE RESIZES AS A RECTANGLE. Dragging one corner used to move that
    // point alone and shear the box into a parallelogram, so its SIZE could not
    // be changed at all -- the owner's "adjust mask size" was impossible.
    p.onMasks(p.masks.map((mask,i) => {
      if (i !== handle.mask) return mask;
      return (isRectangularMask(mask) && resizeRectangularMask(mask, handle.vertex, next))
        || mask.map((q,j) => j === handle.vertex ? next : q);
    }));
  }
  function startHandle(e: React.PointerEvent<SVGElement>, handle: Handle) {
    e.stopPropagation(); if (p.busy) return;
    e.preventDefault(); drag.current = handle; p.onEditing(true); e.currentTarget.setPointerCapture(e.pointerId);
    bodyFrom.current = handle.kind === 'body' ? point(e) : null;
  }
  function keyboardHandle(e: React.KeyboardEvent<SVGElement>, handle: Handle, current: Point) {
    const deltas: Record<string,Point> = { ArrowLeft:{x:-1,y:0}, ArrowRight:{x:1,y:0}, ArrowUp:{x:0,y:-1}, ArrowDown:{x:0,y:1} };
    if (p.busy || !deltas[e.key]) return; e.preventDefault();
    const step = e.shiftKey ? .01 : .001, delta = deltas[e.key];
    moveHandle(handle,{x:clamp(current.x+delta.x*step),y:clamp(current.y+delta.y*step)});
  }
  let rectanglePreview: Point[] = [];
  if (p.marking === 'rectangle' && p.draft[0] && hover) { try { rectanglePreview = rectangularWallMask(p.draft[0],hover); } catch { /* Pointer has not moved yet. */ } }
  const overlays = p.showMasks || !!p.marking;
  /* ⚠️ THE OVERLAY IS STRETCHED ON PURPOSE, SO ANYTHING ROUND MUST UNDO IT.
     (owner, 2026-09-24, on her own marked wall: "Fix the numbers look they are
     now distorted".)
     `preserveAspectRatio="none"` maps this 100x100 viewBox onto a box whose
     real shape is `p.aspect`, and that is what makes a normalized 0..1 point
     land exactly where it belongs. Lines and polygons do not care — an affine
     scale takes a straight line to a straight line — which is why the wall
     outline always looked right. A CIRCLE and a GLYPH do care: one x-unit is
     `aspect` times as many pixels as one y-unit, so every handle rendered as a
     wide ellipse and every numeral came out stretched, and the wider the photo
     the worse it got.
     `kx` is the counter-scale. An x-extent multiplied by it covers the same
     number of PIXELS as the matching y-extent, so `rx={r*kx} ry={r}` is a
     round dot and `scale(kx 1)` is unstretched type. Nothing about where
     anything sits changes — only how wide it is drawn. */
  //
  // ⚠️ AND `p.aspect` IS NOT THE BOX'S REAL SHAPE, WHICH IS WHY THE FIRST FIX
  // ONLY HALF WORKED (owner, 2026-09-24, after it shipped: "Still looks wrong
  // the pins look distorted still").
  //
  // The box is `w-full` + `aspectRatio: p.aspect` + `maxHeight: min(70svh,
  // 560px)`. Width is pinned at 100%, so when the cap bites it clamps the
  // HEIGHT and the width does not follow — the element ends up WIDER than the
  // ratio it declares. Measured in a browser at 750px wide with a 1.350 photo
  // on a 760px-tall viewport: the real box is 750 x 532, an aspect of 1.410,
  // and a dot corrected from 1.350 still renders 1.043 wide. On a shorter
  // window the cap bites harder and the error grows with it.
  //
  // So the box is MEASURED. A ResizeObserver is immune to the cap, to svh, to
  // zoom and to any future CSS — whereas every number we could derive from
  // props is a second opinion about something the browser already knows.
  // `p.aspect` remains the fallback for the first frame only.
  const [boxSize, setBoxSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) setBoxSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const aspect = Number.isFinite(p.aspect) && p.aspect > 0 ? p.aspect : 1;
  // Pixels per y-unit over pixels per x-unit: multiply an x-extent by it and it
  // covers the same number of pixels as the matching y-extent.
  const kx = boxSize ? boxSize.h / boxSize.w : 1 / aspect;
  /** Type and chips, drawn at the origin inside a group that undoes the
   *  stretch, so their own coordinates stay readable. */
  const unstretch = (x: number, y: number) => `translate(${x} ${y}) scale(${kx} 1)`;
  /* ⚠️ THE PHOTO NEEDS A CEILING (owner, Trish 2026-09-24: "its displaying
     photo too large and now you cant see your prompt").
     This box had `w-full` and an aspectRatio and NOTHING ELSE, so a wide room
     shot -- about 2:1 on a phone camera -- rendered as tall as the column is
     wide and ate the viewport whole. Everything that explains what is
     happening (the brief, the generating notice, the controls) was pushed off
     screen by the picture itself.
     `maxHeight` with an aspect-ratio shrinks the WIDTH to match rather than
     cropping, so the photo letterboxes into the column and centres. svh, not
     vh, because iOS vh includes the browser chrome that is not actually there. */
  return <div ref={box} className="relative mx-auto w-full overflow-hidden rounded-lg bg-[hsl(var(--wall-ground))] select-none" style={{ aspectRatio:p.aspect, maxHeight:'min(70svh, 560px)', cursor:p.marking ? 'crosshair' : 'default', touchAction:p.marking ? 'none' : 'auto' }} aria-label="Wall placement photo"
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
      if(drag.current){moveHandle(drag.current,point(e));drag.current=null;bodyFrom.current=null;p.onEditing(false);return;}
      const active=rectangle.current; rectangle.current=null;
      if(active && !p.busy){ if(active.moved)p.onRectangle(active.start,point(e)); else if(active.hadStart)p.onPoint(point(e)); }
      setHover(null);
    }}
    onPointerCancel={() => {p.onEditing(false);drag.current=null;bodyFrom.current=null;rectangle.current=null;setHover(null);}}
    onLostPointerCapture={() => {p.onEditing(false);drag.current=null;bodyFrom.current=null;rectangle.current=null;}}
    onPointerLeave={() => {if(!rectangle.current && !drag.current)setHover(null);}}>
    <img src={p.url} alt={p.alt} className="pointer-events-none absolute inset-0 h-full w-full object-contain" draggable={false}/>
    {overlays && p.maskUrl && <img src={p.maskUrl} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-35" style={{ filter: `drop-shadow(0 0 1px ${WALL_GLASS.protected.stroke})` }} draggable={false}/>}
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
      <WallGlassDefs/>
      {overlays && <polygon points={coords(p.corners)} fill={WALL_AREA_FILL} stroke={WALL_GLASS.area.stroke} strokeWidth=".3"/>}
      {overlays && p.masks.map((mask,i)=>{
        const x=Math.min(...mask.map(q=>q.x))*100, y=Math.min(...mask.map(q=>q.y))*100;
        return <g key={i}>
          <polygon points={coords(mask)} fill="rgba(0,120,220,.10)" stroke={WALL_GLASS.protected.halo} strokeWidth=".65" filter={WALL_HALO_FILTER}/>
          <polygon points={coords(mask)} fill={WALL_PROTECTED_FILL} stroke={WALL_GLASS.protected.stroke} strokeWidth=".35" style={{pointerEvents:!p.marking && !p.busy?'auto':'none',cursor:selected===i?'move':'pointer',touchAction:'none'}} onPointerDown={e=>{e.stopPropagation();if(selected===i)startHandle(e,{kind:'body',mask:i,vertex:-1});else setSelected(i);}}/>
          <g transform={unstretch(x, y)}>
            <rect x=".4" y=".4" width="19" height="3.8" rx=".65" fill={WALL_GLASS.protected.chip} fillOpacity=".9"/>
            <text x="1.2" y="2.4" fill="white" fontSize="1.5">Protected {i+1}</text>
          </g>
          {(selected===i || !!p.marking) && mask.map((q,j)=><g key={j}>
            {/* THE HIT TARGET IS THE FINGER'S, NOT THE DOT'S. The visible
                handle was r=.7 on a 100-unit viewBox -- about three pixels on
                a phone, which is why the owner called the tool finicky. The
                dot stays small so it does not hide the wall; an invisible
                circle around it takes the tap at a size a thumb can actually
                land on. It is drawn as an ELLIPSE with `rx` counter-scaled by
                `kx`, which is what makes it round ON SCREEN inside a viewBox
                that does not preserve aspect — see the note beside `kx`. */}
            <ellipse cx={q.x*100} cy={q.y*100} rx={HANDLE_TOUCH_R*kx} ry={HANDLE_TOUCH_R} fill="transparent" style={{pointerEvents:p.busy?'none':'auto',cursor:'move',touchAction:'none'}} tabIndex={0} role="button" aria-label={`Mask ${i+1} ${isRectangularMask(mask)?'corner':'point'} ${j+1}`} onPointerDown={e=>startHandle(e,{kind:'mask',mask:i,vertex:j})} onKeyDown={e=>keyboardHandle(e,{kind:'mask',mask:i,vertex:j},q)}/>
            <ellipse cx={q.x*100} cy={q.y*100} rx={1.1*kx} ry={1.1} fill="white" stroke={WALL_GLASS.protected.vertex} strokeWidth=".35" className="pointer-events-none"/>
          </g>)}
        </g>;
      })}
      {/* THE DETECTED ITEMS, ONE TAP EACH.
          Kept reads as the protected glass the rest of the editor already uses,
          so a customer who has seen a hand-drawn mask recognises it instantly.
          Painted-through is the SAME outline dashed and unfilled: the item is
          still shown, because the point of the layer is that she can see what
          the detector decided and disagree with it. An item nobody can see is
          an item nobody can correct. */}
      {overlays && (p.items ?? []).map(item => {
        const x0 = Math.min(item.box.x0, item.box.x1) * 100, x1 = Math.max(item.box.x0, item.box.x1) * 100;
        const y0 = Math.min(item.box.y0, item.box.y1) * 100, y1 = Math.max(item.box.y0, item.box.y1) * 100;
        const kept = item.applied === 'fixed';
        const chipW = Math.max(9, Math.min(30, item.label.length * 1.05 + 5));
        return <g key={item.id}>
          <rect
            x={x0} y={y0} width={Math.max(0, x1 - x0)} height={Math.max(0, y1 - y0)} rx=".8"
            fill={kept ? WALL_PROTECTED_FILL : 'transparent'}
            stroke={kept ? WALL_GLASS.protected.stroke : WALL_GLASS.area.stroke}
            strokeWidth={kept ? '.45' : '.35'}
            /* A BOX-ONLY ITEM IS DRAWN AS A BOX AND SAYS SO. The detector
               located it but its mask outline never arrived, so the preview
               covers the whole rectangle -- wider than the object. Shown
               rather than hidden, because one tap paints it through, and an
               item nobody can see is an item nobody can correct. */
            strokeDasharray={!kept ? '1.4 1' : item.png ? undefined : '2.4 1.2'}
            style={{ pointerEvents: !p.marking && !p.busy && p.onToggleItem ? 'auto' : 'none', cursor: 'pointer' }}
            tabIndex={p.onToggleItem && !p.marking ? 0 : -1}
            role="button"
            aria-pressed={kept}
            aria-label={`${item.label} — ${kept ? 'kept as photographed' : 'painted through'}${item.png ? '' : ', as a rectangle rather than its exact outline'}. Tap to ${kept ? 'paint through it' : 'keep it'}.`}
            onPointerDown={e => { if (!p.onToggleItem || p.marking || p.busy) return; e.stopPropagation(); p.onToggleItem(item.id); }}
            onKeyDown={e => { if (!p.onToggleItem) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); p.onToggleItem(item.id); } }}
          />
          <g transform={unstretch(x0, y0)} pointerEvents="none">
            <rect x=".4" y=".4" width={chipW} height="3.6" rx=".6"
              fill={kept ? WALL_GLASS.protected.chip : WALL_GLASS.area.label} fillOpacity=".92"/>
            <text x="1.1" y="2.9" fill="white" fontSize="1.9">
              {kept ? '✓ ' : '× '}{item.label}
            </text>
          </g>
        </g>;
      })}
      {overlays && p.corners.map((q,i)=><g key={i}><ellipse cx={q.x*100} cy={q.y*100} rx={HANDLE_TOUCH_R*kx} ry={HANDLE_TOUCH_R} fill="transparent" style={{pointerEvents:p.busy?'none':'auto',cursor:'move',touchAction:'none'}} tabIndex={0} role="button" aria-label={`Wall corner ${i+1}`} onPointerDown={e=>startHandle(e,{kind:'wall',mask:0,vertex:i})} onKeyDown={e=>keyboardHandle(e,{kind:'wall',mask:0,vertex:i},q)}/><ellipse cx={q.x*100} cy={q.y*100} rx={1.1*kx} ry={1.1} fill={WALL_GLASS.area.handle} stroke="white" strokeWidth=".25" className="pointer-events-none"/><g transform={unstretch(q.x*100, q.y*100)}><text x="1.2" y="-1.2" fill={WALL_GLASS.area.label} fontSize="2.5">{i+1}</text></g></g>)}
      {p.seams.map((seam,i)=><line key={i} x1={seam.top.x*100} y1={seam.top.y*100} x2={seam.bottom.x*100} y2={seam.bottom.y*100} stroke={WALL_GLASS.seam} strokeWidth=".3" strokeDasharray="1 .8"/>)}
      {p.marking==='exclude' && <polygon points={coords([...p.draft,...(hover?[hover]:[])])} fill={WALL_PROTECTED_FILL} stroke={WALL_GLASS.protected.stroke} strokeWidth=".3" strokeDasharray=".8 .5"/>}
      {rectanglePreview.length>0 && <polygon points={coords(rectanglePreview)} fill={WALL_PROTECTED_FILL} stroke={WALL_GLASS.protected.stroke} strokeWidth=".3"/>}
      {p.draft.map((q,i)=><ellipse key={i} cx={q.x*100} cy={q.y*100} rx={.65*kx} ry={.65} fill={WALL_GLASS.protected.vertex}/>)}
    </svg>
  </div>;
}
