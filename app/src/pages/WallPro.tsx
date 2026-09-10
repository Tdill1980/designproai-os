/** WallPro's migrated wall designer. Original creative prompts are in the OS edge
 * function. Physical placement never invokes or changes vehicle production. */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Upload, Wand2, Download, Save, ImageIcon, Ruler, RotateCcw, FolderOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WALL_DESIGNS } from '@/components/wallpro/galleryData';
import { validWallSize, validWallCorners, layoutMetrics, wallPrintPanels, WALLPRO_PRINT_WIDTH, homography, projectPoint, UNIT_WALL, type Point, type Placement } from '@/lib/wallpro-geometry';
import { validateWallUpload, loadWallImage, renderWallPreview, canvasBlob } from '@/lib/wallpro-render';
import { wallUser, uploadWallAsset, openWallAsset, generateWall, saveWallProject, wallHistory, getWallProject, type WallAsset } from '@/lib/wallpro-api';
import { beginAppBusy, endAppBusy } from '@/lib/app-busy';

const cornerNames = ['top left', 'top right', 'bottom right', 'bottom left'];
const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950';
const panelClass = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm';
type History = Awaited<ReturnType<typeof wallHistory>>;

export default function WallPro() {
  const [params, setParams] = useSearchParams();
  const [projectId, setProjectId] = useState(() => params.get('project') || crypto.randomUUID());
  const [name, setName] = useState('My wall design');
  const [photo, setPhoto] = useState<WallAsset | null>(null);
  const [artwork, setArtwork] = useState<WallAsset | null>(null);
  const [reference, setReference] = useState<WallAsset | null>(null);
  const [designMode, setDesignMode] = useState<'ai' | 'upload'>('ai');
  const [prompt, setPrompt] = useState('');
  const [width, setWidth] = useState(120), [height, setHeight] = useState(96);
  const [placement, setPlacement] = useState<Placement>('cover'), [repeatWidth, setRepeatWidth] = useState(24);
  const [corners, setCorners] = useState<Point[]>([]), [exclusions, setExclusions] = useState<Point[][]>([]);
  const [marking, setMarking] = useState<'wall' | 'exclude' | null>('wall');
  const [excludeDraft, setExcludeDraft] = useState<Point[]>([]);
  const [view, setView] = useState<'before' | 'after' | 'design'>('before');
  const [showPrintGuides, setShowPrintGuides] = useState(false);
  const [preview, setPreview] = useState<string | null>(null), [rendering, setRendering] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [history, setHistory] = useState<History | null>(null);
  const urls = useRef(new Set<string>()), canvas = useRef<HTMLCanvasElement | null>(null), loadOnce = useRef(false);
  const previewVersion = useRef(0);
  const retain = (url: string) => { if (url.startsWith('blob:')) urls.current.add(url); return url; };
  useEffect(() => () => urls.current.forEach(url => URL.revokeObjectURL(url)), []);
  const dimensionsValid = validWallSize(width, height);
  const cornersValid = validWallCorners(corners);
  const printPanels = dimensionsValid ? wallPrintPanels(width,height) : [];
  const wallMap = cornersValid ? homography(UNIT_WALL,corners) : null;
  const printSeams = wallMap ? printPanels.slice(1).map(panel => ({
    top: projectPoint(wallMap,{x:panel.start/width,y:0}),
    bottom: projectPoint(wallMap,{x:panel.start/width,y:1}),
  })) : [];
  let metrics: ReturnType<typeof layoutMetrics> | null = null;
  try { if (artwork) metrics = layoutMetrics({ width, height, mode: placement, repeatWidth }, artwork.aspect); } catch { /* visible validation below */ }

  useEffect(() => {
    const version = ++previewVersion.current;
    let ownedPreview: string | null = null;
    setPreview(null); canvas.current = null;
    if (!photo || !artwork || !cornersValid || !dimensionsValid || !metrics) { setRendering(false); return; }
    setRendering(true);
    renderWallPreview(photo.url, artwork.url, corners, exclusions, { width, height, mode: placement, repeatWidth })
      .then(async output => {
        const blob = await canvasBlob(output);
        if (version !== previewVersion.current) return;
        canvas.current = output;
        ownedPreview = URL.createObjectURL(blob);
        setPreview(ownedPreview);
      })
      .catch(e => { if (version === previewVersion.current) setError(e.message); })
      .finally(() => { if (version === previewVersion.current) setRendering(false); });
    return () => { previewVersion.current++; if (ownedPreview) URL.revokeObjectURL(ownedPreview); };
  }, [photo, artwork, corners, exclusions, width, height, placement, repeatWidth]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError(''); setNotice(''); beginAppBusy();
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'The operation could not be completed.'); }
    finally { setBusy(''); endAppBusy(); }
  }
  async function fileSelected(file: File | undefined, role: 'photo' | 'artwork' | 'reference') {
    if (!file) return;
    await run('Opening image', async () => {
      const validated = await validateWallUpload(file);
      const asset = { ...validated, file, url: retain(validated.url) };
      if (role === 'photo') { setPhoto(asset); setCorners([]); setExclusions([]); setExcludeDraft([]); setMarking('wall'); setView('before'); }
      if (role === 'artwork') { setArtwork(asset); setDesignMode('upload'); setView('after'); }
      if (role === 'reference') { setReference(asset); setArtwork(null); }
    });
  }
  const uploadControl = (role: 'photo' | 'artwork' | 'reference', label: string) => (
    <label className="relative flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-sm font-medium hover:border-violet-400 focus-within:ring-2 focus-within:ring-violet-500">
      <Upload size={18} />{label}
      <input aria-label={label} type="file" accept="image/jpeg,image/png,image/webp" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" onChange={e => { void fileSelected(e.target.files?.[0], role); e.target.value = ''; }} />
    </label>
  );
  async function storedAsset(path: string): Promise<WallAsset> {
    const url = await openWallAsset(path), image = await loadWallImage(url);
    return { path, url, aspect: image.naturalWidth / image.naturalHeight };
  }
  async function restore(config: any, id?: string, title?: string) {
    const [wall, art, ref] = await Promise.all([config.wallPath ? storedAsset(config.wallPath) : null, config.artworkPath ? storedAsset(config.artworkPath) : null, config.referencePath ? storedAsset(config.referencePath) : null]);
    setPhoto(wall); setArtwork(art); setReference(ref); setWidth(config.width || 120); setHeight(config.height || 96);
    setPlacement(config.placement || 'cover'); setRepeatWidth(config.repeatWidth || 24); setPrompt(config.prompt || '');
    setDesignMode(config.designMode || 'ai'); setCorners(config.corners || []); setExclusions(config.exclusions || []); setExcludeDraft([]);
    setMarking(validWallCorners(config.corners || []) ? null : 'wall'); setView(art ? 'after' : 'before');
    setName(title || 'Wall design'); setHistory(null);
    if (id) { setProjectId(id); setParams({ project: id }, { replace: true }); }
  }
  useEffect(() => {
    if (loadOnce.current || !params.get('project')) return;
    loadOnce.current = true;
    void run('Opening project', async () => {
      const project = await getWallProject(params.get('project')!);
      await restore(project.config, project.id, project.name);
    });
  }, []);
  async function persistCurrent(art: WallAsset | null = artwork, designName = name) {
    const user = await wallUser();
    const wallPath = photo ? await uploadWallAsset(photo, user.id) : null;
    const artworkPath = art ? await uploadWallAsset(art, user.id) : null;
    const referencePath = reference ? await uploadWallAsset(reference, user.id) : null;
    if (photo && wallPath) setPhoto({ ...photo, path: wallPath });
    if (art && artworkPath) setArtwork({ ...art, path: artworkPath });
    if (reference && referencePath) setReference({ ...reference, path: referencePath });
    await saveWallProject(projectId, user.id, designName, { wallPath, artworkPath, referencePath, width, height, placement, repeatWidth, printWidth: WALLPRO_PRINT_WIDTH, corners, exclusions, prompt, designMode });
    setParams({ project: projectId }, { replace: true }); setNotice('Project saved. You can reopen it from My wall designs.');
  }
  async function generate() {
    await run('Generating wall artwork', async () => {
      if (!dimensionsValid) throw new Error('Enter wall dimensions between 1 and 2,400 inches.');
      if (photo && !cornersValid) throw new Error('Mark the four corners of the wall first.');
      const user = await wallUser();
      const wallPath = photo ? await uploadWallAsset(photo, user.id) : null;
      const referencePath = reference ? await uploadWallAsset(reference, user.id) : null;
      if (photo && wallPath) setPhoto({ ...photo, path: wallPath });
      if (reference && referencePath) setReference({ ...reference, path: referencePath });
      const result = await generateWall({ requestId: crypto.randomUUID(), prompt, width, height, placement, wallPath, referencePath });
      const image = await loadWallImage(result.image_url);
      const art = { url: result.image_url, path: result.storage_path, aspect: image.naturalWidth / image.naturalHeight };
      setArtwork(art); setName(result.design_name); setView(photo ? 'after' : 'design');
      // The server saves every generation before responding. Project save also
      // retains the measured wall and placement even if the customer reloads.
      try { await saveWallProject(projectId, user.id, result.design_name, { wallPath, artworkPath: result.storage_path, referencePath, width, height, placement, repeatWidth, printWidth: WALLPRO_PRINT_WIDTH, corners, exclusions, prompt, designMode: 'ai' }); setParams({ project: projectId }, { replace: true }); }
      catch { setNotice('Artwork is saved in My wall designs. Save this project again to retain the wall placement.'); }
    });
  }
  function markPoint(e: React.MouseEvent<HTMLDivElement>) {
    if (!marking || busy) return;
    const box = e.currentTarget.getBoundingClientRect(), p = { x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)) };
    if (marking === 'exclude') { setExcludeDraft(old => [...old, p]); return; }
    const next = [...corners, p]; setCorners(next);
    if (next.length === 4) { setMarking(null); if (!validWallCorners(next)) setError('Those corners cross or form a narrow area. Mark them clockwise starting at the top left.'); else { setError(''); if (artwork) setView('after'); } }
  }
  async function download(source: 'preview' | 'artwork') {
    await run('Preparing download', async () => {
      let blob: Blob;
      if (source === 'preview') { if (!canvas.current) throw new Error('Wait for the wall preview to finish.'); blob = await canvasBlob(canvas.current); }
      else { if (!artwork) return; const url = artwork.path ? await openWallAsset(artwork.path) : artwork.url; const result = await fetch(url); if (!result.ok) throw new Error('The artwork could not be downloaded.'); blob = await result.blob(); }
      const url = retain(URL.createObjectURL(blob)), a = document.createElement('a'); a.href = url;
      a.download = 'wallpro-' + source + (blob.type === 'image/jpeg' ? '.jpg' : blob.type === 'image/webp' ? '.webp' : '.png'); a.click();
    });
  }

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 md:px-8">
    <Helmet><title>WallPro — Wall Design & Preview | DesignProAI</title></Helmet>
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-violet-600">DesignProAI</p><h1 className="mt-1 text-3xl font-bold">Wall<span className="bg-gradient-to-r from-sky-500 via-violet-500 to-fuchsia-500 bg-clip-text text-transparent">Pro</span></h1><p className="mt-1 text-sm text-slate-600">Your wall. Your design. Sized to fit.</p></div>
        <Button variant="outline" disabled={!!busy} onClick={() => void run('Opening wall designs', async () => setHistory(await wallHistory()))}><FolderOpen className="mr-2 h-4 w-4" />My wall designs</Button>
      </header>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}{error.startsWith('Sign in') && <Link className="ml-2 underline" to="/login" state={{ from: '/printpro/wallpro' }}>Sign in</Link>}</div>}
      {notice && <p role="status" className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm">{notice}</p>}
      {history && <section className={panelClass}><div className="flex items-center justify-between"><h2 className="font-semibold">My wall designs</h2><Button variant="ghost" onClick={() => setHistory(null)}>Close</Button></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">{history.projects.map((p: any) => <Button key={p.id} disabled={!!busy} variant="outline" className="justify-start truncate" onClick={() => void run('Opening project', () => restore(p.config, p.id, p.name))}>{p.name}</Button>)}</div>
        <h3 className="mt-5 text-sm font-semibold">Generated artwork</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">{history.generations.map((g: any) => <button key={g.id} disabled={!!busy || g.state !== 'completed'} className="rounded-lg border p-3 text-left text-sm disabled:opacity-60" onClick={() => void run('Opening artwork', () => restore({ ...g.input, artworkPath: g.artwork_path }, crypto.randomUUID(), g.design_name))}>{g.design_name || 'Wall design'} · {g.state}{g.error && <span className="mt-1 block text-xs text-red-700">{g.error}</span>}</button>)}</div>
        {!history.projects.length && !history.generations.length && <p className="py-4 text-sm text-slate-500">Your saved projects will appear here.</p>}
      </section>}
      <div className="grid gap-5 lg:grid-cols-[350px_minmax(0,1fr)]">
        <fieldset disabled={!!busy} className="min-w-0 space-y-5 disabled:opacity-70">
          <section className={panelClass}><h2 className="mb-3 font-semibold">1. Upload your wall</h2>{uploadControl('photo', photo ? 'Replace wall photo' : 'Upload wall photo')}<p className="mt-2 text-xs text-slate-500">JPG, PNG or WebP · up to 20 MB</p>
            {photo && <p className="mt-3 text-sm text-slate-600">Mark the four corners in the photo, starting at the top left and moving clockwise.</p>}
            <div className="mt-4 grid grid-cols-2 gap-3"><label className="text-sm">Width (inches)<input className={inputClass} type="number" min="1" max="2400" step="0.25" value={width || ''} onChange={e => setWidth(Number(e.target.value))} /></label><label className="text-sm">Height (inches)<input className={inputClass} type="number" min="1" max="2400" step="0.25" value={height || ''} onChange={e => setHeight(Number(e.target.value))} /></label></div>
            <p className="mt-2 flex items-center gap-1 text-xs text-slate-500"><Ruler size={14} />{dimensionsValid ? (width * height / 144).toFixed(1) + ' sq ft' : 'Enter positive wall dimensions.'}</p>
          </section>
          <section className={panelClass}><h2 className="mb-3 font-semibold">2. Choose your design</h2><div className="mb-4 grid grid-cols-2 gap-2">{(['ai','upload'] as const).map(mode => <Button key={mode} variant={designMode === mode ? 'default' : 'outline'} onClick={() => { setDesignMode(mode); setArtwork(null); }}>{mode === 'ai' ? 'Create with AI' : 'Use my artwork'}</Button>)}</div>
            {designMode === 'ai' ? <div className="space-y-3"><label className="block text-sm">Describe the design<textarea className={inputClass + ' min-h-28'} maxLength={6000} value={prompt} placeholder="Oversized blue botanicals on warm ivory, refined and hand-painted…" onChange={e => { setPrompt(e.target.value); setArtwork(null); }} /></label>
              <label className="block text-sm">Start with a style<select className={inputClass} value="" onChange={e => { setPrompt(WALL_DESIGNS.find(d => d.id === e.target.value)?.prompt || ''); setArtwork(null); }}><option value="">Choose a starting point</option>{WALL_DESIGNS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              {uploadControl('reference', reference ? 'Replace style reference' : 'Upload a style reference')}
              <p className="text-xs text-slate-500">Optional: a photo, pattern or another wall design to inspire the AI.</p>
              {reference && <div className="flex items-center gap-3"><img src={reference.url} alt="Style reference" className="h-14 w-14 rounded object-contain" /><Button size="sm" variant="ghost" onClick={() => { setReference(null); setArtwork(null); }}>Remove</Button></div>}
              <Button className="w-full bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-600 text-white" disabled={!prompt.trim() || !dimensionsValid || !!photo && !cornersValid} onClick={() => void generate()}><Wand2 className="mr-2 h-4 w-4" />Generate wall design</Button><p className="text-xs text-slate-500">1 design token or plan render. Usually ready in 1–2 minutes.</p>
            </div> : <div className="space-y-3">{uploadControl('artwork', artwork ? 'Replace artwork' : 'Upload artwork or pattern')}<p className="text-xs text-slate-500">Your artwork is placed as supplied. Pattern size stays under your control.</p></div>}
          </section>
          <section className={panelClass}><h2 className="mb-3 font-semibold">3. Size the artwork</h2><label className="block text-sm">Placement<select className={inputClass} value={placement} onChange={e => setPlacement(e.target.value as Placement)}><option value="cover">Fill wall — crop edges</option><option value="contain">Fit whole artwork — leave margins</option><option value="repeat">Repeat pattern at a measured size</option></select></label>
            {placement === 'repeat' && <label className="mt-3 block text-sm">Pattern tile width (inches)<input className={inputClass} type="number" min="1" max="2400" step="0.25" value={repeatWidth || ''} onChange={e => setRepeatWidth(Number(e.target.value))} /><span className="mt-2 block text-xs text-slate-500">One tile is the entire uploaded image. Height follows its proportions.</span></label>}
            {metrics && placement === 'repeat' && <p role="status" className="mt-3 rounded-lg bg-violet-50 p-3 text-sm text-violet-900">{metrics.across.toFixed(2)} tiles across × {metrics.down.toFixed(2)} down. Each tile: {metrics.artworkWidth.toFixed(2)}″ × {metrics.artworkHeight.toFixed(2)}″.</p>}
            {artwork && !metrics && <p className="mt-2 text-sm text-red-700">Enter valid wall and repeat dimensions to preview.</p>}
            <div className="mt-4 rounded-lg border border-slate-200 p-3 text-sm"><p className="font-semibold">Print panel width: {WALLPRO_PRINT_WIDTH}″</p>
              {printPanels.length > 0 && <p className="mt-1 text-slate-600">{printPanels.length} {printPanels.length === 1 ? 'panel' : 'panels'} × {height}″ tall. {printPanels.length === 1 ? 'Panel' : 'Last panel'}: {Number(printPanels.at(-1)!.width.toFixed(2))}″ wide.</p>}
              <p className="mt-2 text-xs text-slate-500">Trim layout before installation overlap and bleed. Pattern scale continues across every panel.</p>
              <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={showPrintGuides} onChange={e => setShowPrintGuides(e.target.checked)} />Show 51-inch print panel guides</label>
            </div>
          </section>
        </fieldset>
        <div className="min-w-0 space-y-5">
          <section className={panelClass + ' overflow-hidden'}>
            <div className="mb-4 flex flex-wrap items-center gap-2">{(['before','after','design'] as const).map(v => <Button size="sm" variant={view === v ? 'default' : 'outline'} key={v} onClick={() => setView(v)} disabled={v !== 'before' && !artwork}>{v === 'before' ? 'Before' : v === 'after' ? 'On your wall' : 'Design only'}</Button>)}{rendering && <span className="flex items-center gap-1 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" />Updating scale</span>}</div>
            {photo && view !== 'design' ? <>
              <div className="relative w-full overflow-hidden rounded-lg bg-slate-100" style={{ aspectRatio: photo.aspect, cursor: marking ? 'crosshair' : 'default' }} onClick={markPoint} aria-label="Wall placement photo">
                <img src={view === 'after' && preview ? preview : photo.url} alt={view === 'after' && preview ? 'Your design scaled on your wall' : 'Your original wall'} className="block h-full w-full object-contain" draggable={false} />
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
                  {(marking || view === 'before') && <polygon points={corners.map(p => p.x * 100 + ',' + p.y * 100).join(' ')} fill="rgba(139,92,246,.1)" stroke="#8b5cf6" strokeWidth=".35" />}
                  {corners.map((p,i) => (marking || view === 'before') && <g key={i}><circle cx={p.x * 100} cy={p.y * 100} r="1.1" fill="#7c3aed" /><text x={p.x * 100 + 1.5} y={p.y * 100 - 1.5} fill="#7c3aed" fontSize="3">{i+1}</text></g>)}
                  {exclusions.map((poly,i) => (marking || view === 'before') && <polygon key={i} points={poly.map(p => p.x * 100 + ',' + p.y * 100).join(' ')} fill="rgba(245,158,11,.2)" stroke="#f59e0b" strokeWidth=".3" />)}
                  {showPrintGuides && printSeams.map((seam,i) => <line key={'seam-'+i} x1={seam.top.x*100} y1={seam.top.y*100} x2={seam.bottom.x*100} y2={seam.bottom.y*100} stroke="#06b6d4" strokeWidth=".4" strokeDasharray="1 .8" />)}
                  <polyline points={excludeDraft.map(p => p.x * 100 + ',' + p.y * 100).join(' ')} fill="none" stroke="#f59e0b" strokeWidth=".4" />
                </svg>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={!!busy} onClick={() => { setCorners([]); setMarking('wall'); setExcludeDraft([]); setView('before'); }}><RotateCcw className="mr-1 h-3 w-3" />Mark wall corners</Button><Button size="sm" variant="outline" disabled={!!busy || !cornersValid} onClick={() => { setMarking('exclude'); setExcludeDraft([]); setView('before'); }}>Protect a window or object</Button>
                {marking === 'exclude' && <><Button size="sm" disabled={excludeDraft.length < 3} onClick={() => { setExclusions(old => [...old, excludeDraft]); setExcludeDraft([]); setMarking(null); setView('after'); }}>Finish protected area</Button><Button size="sm" variant="ghost" onClick={() => { setExcludeDraft([]); setMarking(null); }}>Cancel</Button></>}
                {!!exclusions.length && <Button size="sm" variant="ghost" onClick={() => setExclusions(old => old.slice(0,-1))}>Undo protected area</Button>}
              </div>
              {marking && <p role="status" className="mt-3 text-sm text-violet-700">{marking === 'wall' ? 'Tap corner ' + (corners.length + 1) + ': ' + cornerNames[corners.length] + '.' : 'Tap around the area to keep unchanged, then choose Finish protected area.'}</p>}
              {!marking && cornersValid && <p className="mt-3 text-xs text-slate-500">Measured wall: {width}″ W × {height}″ H. Placement follows the selected corners.</p>}
              {corners.length > 0 && <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Adjust corner positions</summary><div className="mt-2 grid grid-cols-2 gap-2">{corners.map((p,i) => <div key={i}><span>{i+1}. {cornerNames[i]}</span><div className="flex gap-1">{(['x','y'] as const).map(axis => <label key={axis}>{axis} %<input disabled={!!busy} aria-label={'Corner ' + (i+1) + ' ' + axis + ' percent'} type="number" min="0" max="100" step="0.1" className={inputClass} value={Number((p[axis]*100).toFixed(2))} onChange={e => setCorners(old => old.map((q,j) => j === i ? { ...q, [axis]: Number(e.target.value)/100 } : q))} /></label>)}</div></div>)}</div></details>}
            </> : artwork ? <div className="flex min-h-80 items-center justify-center rounded-xl bg-slate-100 p-4"><img src={artwork.url} alt="Flat wall artwork" className="max-h-[650px] max-w-full object-contain" /></div> : <div className="flex min-h-96 flex-col items-center justify-center rounded-xl bg-slate-100 p-8 text-center"><ImageIcon className="mb-4 h-12 w-12 text-slate-300" /><h2 className="font-semibold">See the design on your wall</h2><p className="mt-2 max-w-sm text-sm text-slate-500">Upload a wall photo and mark its corners. Create a design with AI or upload your own artwork.</p></div>}
            {busy && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-violet-700"><Loader2 className="h-4 w-4 animate-spin" />{busy}…</p>}
          </section>
          <section className={panelClass}><label className="block text-sm">Project name<input className={inputClass} maxLength={200} value={name} onChange={e => setName(e.target.value)} disabled={!!busy} /></label><div className="mt-4 flex flex-wrap gap-2"><Button disabled={!!busy || !artwork || !dimensionsValid || !!photo && !cornersValid || !metrics} onClick={() => void run('Saving project', () => persistCurrent())}><Save className="mr-2 h-4 w-4" />Save project</Button><Button variant="outline" disabled={!!busy || !preview || rendering} onClick={() => void download('preview')}><Download className="mr-2 h-4 w-4" />Download wall preview</Button><Button variant="outline" disabled={!!busy || !artwork} onClick={() => void download('artwork')}>Download artwork</Button></div><p className="mt-3 text-xs text-slate-500">The wall image is a visual proof. Print resolution, bleed and material are checked separately before production.</p></section>
        </div>
      </div>
    </div>
  </main>;
}
