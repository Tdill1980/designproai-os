/** WallPro's migrated wall designer. Original creative prompts are in the OS edge
 * function. Physical placement never invokes or changes vehicle production. */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Upload, Wand2, Download, Save, ImageIcon, Ruler, RotateCcw, FolderOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WallPhotoEditor } from '@/components/wallpro/WallPhotoEditor';
import { WallPrintOutput } from '@/components/wallpro/WallPrintOutput';
import { DEFAULT_WALL_PRINT, planWallPrint, type WallPrintSettings } from '@/lib/wallpro-print-plan';
import { WALL_DESIGNS } from '@/components/wallpro/galleryData';
import { validWallSize, validWallCorners, wallGenerationBlocker, rectangularWallMask, layoutMetrics, WALLPRO_PRINT_WIDTH, homography, projectPoint, UNIT_WALL, type Point, type Placement } from '@/lib/wallpro-geometry';
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
  const [marking, setMarking] = useState<'wall' | 'exclude' | 'rectangle' | null>('wall');
  const [excludeDraft, setExcludeDraft] = useState<Point[]>([]);
  const [view, setView] = useState<'before' | 'after' | 'design'>('before');
  const [showPrintGuides, setShowPrintGuides] = useState(false);
  const [editingPhoto, setEditingPhoto] = useState(false);
  const [showMasks, setShowMasks] = useState(true);
  const [printSettings, setPrintSettings] = useState<WallPrintSettings>({ ...DEFAULT_WALL_PRINT });
  const [preview, setPreview] = useState<string | null>(null), [rendering, setRendering] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [history, setHistory] = useState<History | null>(null);
  const [artworkDownload, setArtworkDownload] = useState<{ source: string; url: string; name: string } | null>(null);
  const urls = useRef(new Set<string>()), canvas = useRef<HTMLCanvasElement | null>(null), loadOnce = useRef(false);
  const previewVersion = useRef(0);
  const retain = (url: string) => { if (url.startsWith('blob:')) urls.current.add(url); return url; };
  useEffect(() => () => urls.current.forEach(url => URL.revokeObjectURL(url)), []);
  const dimensionsValid = validWallSize(width, height);
  const cornersValid = validWallCorners(corners);
  // Hard gate: a wall photo with fewer than four valid corners cannot be projected,
  // so no token is spent until the placement exists. Null means generation may run.
  const generationBlocker = wallGenerationBlocker(!!photo, corners, width, height);
  let printPanels: ReturnType<typeof planWallPrint>['panels'] = [];
  try { printPanels = planWallPrint(width, height, printSettings).panels; } catch { /* Output settings show validation. */ }
  const wallMap = cornersValid ? homography(UNIT_WALL,corners) : null;
  const printSeams = wallMap ? printPanels.slice(1).map(panel => ({
    top: projectPoint(wallMap,{x:Math.max(0, panel.x)/width,y:0}),
    bottom: projectPoint(wallMap,{x:Math.max(0, panel.x)/width,y:1}),
  })) : [];
  let metrics: ReturnType<typeof layoutMetrics> | null = null;
  try { if (artwork) metrics = layoutMetrics({ width, height, mode: placement, repeatWidth }, artwork.aspect); } catch { /* visible validation below */ }

  useEffect(() => {
    const version = ++previewVersion.current;
    let ownedPreview: string | null = null;
    setPreview(null); canvas.current = null;
    if (editingPhoto || !photo || !artwork || !cornersValid || !dimensionsValid || !metrics) { setRendering(false); return; }
    setRendering(true);
    renderWallPreview(photo.url, artwork.url, corners, exclusions, { width, height, mode: placement, repeatWidth }, () => version !== previewVersion.current)
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
  }, [photo, artwork, corners, exclusions, width, height, placement, repeatWidth, editingPhoto]);

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
      if (role === 'artwork') { setArtwork(asset); setDesignMode('upload'); setView(photo && cornersValid ? 'after' : 'design'); }
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
    setPrintSettings({ ...DEFAULT_WALL_PRINT, ...config.printSettings });
    setPlacement(config.placement || 'cover'); setRepeatWidth(config.repeatWidth || 24); setPrompt(config.prompt || '');
    setDesignMode(config.designMode || 'ai'); setCorners(config.corners || []); setExclusions(config.exclusions || []); setExcludeDraft([]);
    const restoredCornersValid = validWallCorners(config.corners || []);
    setMarking(restoredCornersValid ? null : 'wall');
    // Only a wall with four valid corners can show the projected design. A saved
    // project that carries artwork on an unmarked wall opens on the photo so the
    // customer finishes the corners; the compositor then runs on the fourth point.
    setView(art ? (wall && !restoredCornersValid ? 'before' : 'after') : 'before');
    if (art && wall && !restoredCornersValid) setNotice('This project has artwork but the wall corners are incomplete. Mark all four corners to see the design on your wall.');
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
    await saveWallProject(projectId, user.id, designName, { wallPath, artworkPath, referencePath, width, height, placement, repeatWidth, printWidth: WALLPRO_PRINT_WIDTH, printSettings, corners, exclusions, prompt, designMode });
    setParams({ project: projectId }, { replace: true }); setNotice('Project saved. You can reopen it from My wall designs.');
  }
  async function generate() {
    // Freeze the placement this generation is made for. The editor stays disabled
    // while busy, but the saved project must record exactly what was validated.
    const wallCorners = corners, wallExclusions = exclusions;
    await run('Generating wall artwork', async () => {
      // Hard gate, not a warning: with a wall photo, all four corners must be
      // marked and valid before any paid call. Otherwise the artwork can never
      // be projected onto the photo (the saved-project failure mode).
      const blocker = wallGenerationBlocker(!!photo, wallCorners, width, height);
      if (blocker) { if (photo && !validWallCorners(wallCorners)) { setMarking('wall'); setView('before'); } throw new Error(blocker); }
      const user = await wallUser();
      const wallPath = photo ? await uploadWallAsset(photo, user.id) : null;
      const referencePath = reference ? await uploadWallAsset(reference, user.id) : null;
      if (photo && wallPath) setPhoto({ ...photo, path: wallPath });
      if (reference && referencePath) setReference({ ...reference, path: referencePath });
      const result = await generateWall({ requestId: crypto.randomUUID(), prompt, width, height, placement, wallPath, referencePath });
      const image = await loadWallImage(result.image_url);
      // The flat artwork is the production master. Setting it with a wall photo and
      // valid corners drives the renderWallPreview compositor immediately (the
      // preview effect keys on artwork/corners/exclusions), so the customer lands on
      // the design projected onto their own wall with every mask preserved.
      const art = { url: result.image_url, path: result.storage_path, aspect: image.naturalWidth / image.naturalHeight };
      setArtwork(art); setName(result.design_name); setMarking(null); setView(photo ? 'after' : 'design');
      // The server saves every generation before responding. Project save also
      // retains the measured wall and placement even if the customer reloads.
      try { await saveWallProject(projectId, user.id, result.design_name, { wallPath, artworkPath: result.storage_path, referencePath, width, height, placement, repeatWidth, printWidth: WALLPRO_PRINT_WIDTH, printSettings, corners: wallCorners, exclusions: wallExclusions, prompt, designMode: 'ai' }); setParams({ project: projectId }, { replace: true }); }
      catch { setNotice('Artwork is saved in My wall designs. Save this project again to retain the wall placement.'); }
    });
  }
  function finishMask(points: Point[]) {
    setExclusions(old => [...old, points]); setExcludeDraft([]); setError('');
    setMarking(corners.length < 4 ? 'wall' : null); setView(artwork && cornersValid ? 'after' : 'before');
  }
  function markPoint(p: Point) {
    if (!marking || busy) return;
    if (marking === 'rectangle') {
      if (!excludeDraft.length) setExcludeDraft([p]);
      else { try { finishMask(rectangularWallMask(excludeDraft[0], p)); } catch (e) { setError(e instanceof Error ? e.message : 'Choose opposite corners.'); setExcludeDraft([]); } }
      return;
    }
    if (marking === 'exclude') { setExcludeDraft(old => [...old, p]); return; }
    const next = corners.length >= 4 ? [p] : [...corners, p]; setCorners(next);
    if (next.length === 4) { setMarking(null); if (!validWallCorners(next)) setError('Those corners cross or form a narrow area. Mark them clockwise starting at the top left.'); else { setError(''); if (artwork) setView('after'); } }
  }
  async function prepareArtworkDownload() {
    await run('Preparing artwork download', async () => {
      if (!artwork) return;
      const url = artwork.path ? await openWallAsset(artwork.path) : artwork.url;
      const result = await fetch(url);
      if (!result.ok) throw new Error('The artwork could not be downloaded.');
      const blob = await result.blob();
      setArtworkDownload({ source: artwork.path || artwork.url, url: retain(URL.createObjectURL(blob)), name: 'wallpro-artwork' + (blob.type === 'image/jpeg' ? '.jpg' : blob.type === 'image/webp' ? '.webp' : '.png') });
    });
  }

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 md:px-8">
    <Helmet><title>WallPro — Wall Design & Preview | DesignProAI</title></Helmet>
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-violet-600">DesignProAI</p><h1 className="mt-1 text-3xl font-bold">Wall<span className="bg-gradient-to-r from-sky-500 via-violet-500 to-fuchsia-500 bg-clip-text text-transparent">Pro</span></h1><p className="mt-1 text-sm text-slate-600">Your wall. Your design. Sized to fit.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!!busy} onClick={() => window.location.assign('/printpro/wallpro')} title="Start a blank wall. Saved projects remain in My wall designs."><RotateCcw className="mr-2 h-4 w-4" />Start fresh</Button>
          <Button variant="outline" disabled={!!busy} onClick={() => void run('Opening wall designs', async () => setHistory(await wallHistory()))}><FolderOpen className="mr-2 h-4 w-4" />My wall designs</Button>
        </div>
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
          <section className={panelClass}><h2 className="mb-3 font-semibold">1. Upload your wall</h2>{uploadControl('photo', photo ? 'Replace wall photo' : 'Upload wall photo')}<p className="mt-2 text-xs text-slate-500">JPG, PNG or WebP · up to 20 MB. A wall photo is optional when generating artwork.</p>
            {photo && <p className="mt-3 text-sm text-slate-600">Mark all four wall corners: top left, top right, bottom right, bottom left. Generation waits until the wall is marked so the design lands on your photo.</p>}
            <div className="mt-4 grid grid-cols-2 gap-3"><label className="text-sm">Width (inches)<input className={inputClass} type="number" min="1" max="2400" step="0.25" value={width || ''} onChange={e => setWidth(Number(e.target.value))} /></label><label className="text-sm">Height (inches)<input className={inputClass} type="number" min="1" max="2400" step="0.25" value={height || ''} onChange={e => setHeight(Number(e.target.value))} /></label></div>
            <p className="mt-2 flex items-center gap-1 text-xs text-slate-500"><Ruler size={14} />{dimensionsValid ? (width * height / 144).toFixed(1) + ' sq ft' : 'Enter positive wall dimensions.'}</p>
          </section>
          <section className={panelClass}><h2 className="mb-3 font-semibold">2. Size the artwork</h2><label className="block text-sm">Placement<select className={inputClass} value={placement} onChange={e => setPlacement(e.target.value as Placement)}><option value="cover">Fill wall — crop edges</option><option value="contain">Fit whole artwork — leave margins</option><option value="repeat">Repeat pattern at a measured size</option></select></label>
            {placement === 'repeat' && <label className="mt-3 block text-sm">Pattern tile width (inches)<input className={inputClass} type="number" min="1" max="2400" step="0.25" value={repeatWidth || ''} onChange={e => setRepeatWidth(Number(e.target.value))} /><span className="mt-2 block text-xs text-slate-500">One tile is the entire uploaded image. Height follows its proportions.</span></label>}
            {metrics && placement === 'repeat' && <p role="status" className="mt-3 rounded-lg bg-violet-50 p-3 text-sm text-violet-900">{metrics.across.toFixed(2)} tiles across × {metrics.down.toFixed(2)} down. Each tile: {metrics.artworkWidth.toFixed(2)}″ × {metrics.artworkHeight.toFixed(2)}″.</p>}
            {artwork && !metrics && <p className="mt-2 text-sm text-red-700">Enter valid wall and repeat dimensions to preview.</p>}
            <div className="mt-4 rounded-lg border border-slate-200 p-3 text-sm"><p className="font-semibold">Print panel width: {WALLPRO_PRINT_WIDTH}″</p>
              <p className="mt-1 text-xs text-slate-500">Includes {printSettings.bleed}″ perimeter bleed and {printSettings.overlap}″ seam overlap. Adjust below in Prepare print files.</p>
              {printPanels.length > 0 && <p className="mt-1 text-slate-600">{printPanels.length} {printPanels.length === 1 ? 'panel' : 'panels'} × {height + 2 * printSettings.bleed}″ printed height. {printPanels.length === 1 ? 'Panel' : 'Last panel'}: {Number(printPanels.at(-1)!.width.toFixed(2))}″ wide.</p>}
              <p className="mt-2 text-xs text-slate-500">Guides mark where the next printed panel begins. Pattern scale continues through every overlap.</p>
              <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={showPrintGuides} onChange={e => setShowPrintGuides(e.target.checked)} />Show 51-inch print panel guides</label>
            </div>
          </section>
          <section className={panelClass}><h2 className="mb-3 font-semibold">3. Choose your design</h2><div className="mb-4 grid grid-cols-2 gap-2">{(['ai','upload'] as const).map(mode => <Button key={mode} variant={designMode === mode ? 'default' : 'outline'} onClick={() => { setDesignMode(mode); setArtwork(null); }}>{mode === 'ai' ? 'Create with AI' : 'Use my artwork'}</Button>)}</div>
            {designMode === 'ai' ? <div className="space-y-3"><label className="block text-sm">Describe the design<textarea className={inputClass + ' min-h-28'} maxLength={6000} value={prompt} placeholder="Oversized blue botanicals on warm ivory, refined and hand-painted…" onChange={e => { setPrompt(e.target.value); setArtwork(null); }} /></label>
              <label className="block text-sm">Start with a style<select className={inputClass} value="" onChange={e => { setPrompt(WALL_DESIGNS.find(d => d.id === e.target.value)?.prompt || ''); setArtwork(null); }}><option value="">Choose a starting point</option>{WALL_DESIGNS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              {uploadControl('reference', reference ? 'Replace style reference' : 'Upload a style reference')}
              <p className="text-xs text-slate-500">Optional inspiration only. Your description is enough to generate a design; no example image is required.</p>
              {reference && <div className="flex items-center gap-3"><img src={reference.url} alt="Style reference" className="h-14 w-14 rounded object-contain" /><Button size="sm" variant="ghost" onClick={() => { setReference(null); setArtwork(null); }}>Remove</Button></div>}
              <p className="text-xs text-slate-500">1 design token or plan render. Usually ready in 1–2 minutes.</p>
              {/* The reason generation is blocked, and any failure, sit beside the button
                  the customer is looking at. The page-top alert alone is off screen here. */}
              {photo && generationBlocker && dimensionsValid && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">{generationBlocker}</p>}
              {error && !busy && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}
              <Button className="w-full bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-600 text-white" disabled={!prompt.trim() || !!generationBlocker} onClick={() => void generate()}><Wand2 className="mr-2 h-4 w-4" />Generate wall design</Button>
            </div> : <div className="space-y-3">{uploadControl('artwork', artwork ? 'Replace artwork' : 'Upload artwork or pattern')}<p className="text-xs text-slate-500">Your artwork is placed as supplied. Pattern size stays under your control.</p></div>}
          </section>
        </fieldset>
        <div className="min-w-0 space-y-5">
          <section className={panelClass + ' overflow-hidden'}>
            <div className="mb-4 flex flex-wrap items-center gap-2">{(['before','after','design'] as const).map(v => <Button size="sm" variant={view === v ? 'default' : 'outline'} key={v} onClick={() => setView(v)} disabled={v !== 'before' && !artwork}>{v === 'before' ? 'Before' : v === 'after' ? 'On your wall' : 'Design only'}</Button>)}{rendering && <span className="flex items-center gap-1 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" />Updating scale</span>}</div>
            {photo && view !== 'design' ? <>
              <WallPhotoEditor onEditing={setEditingPhoto} url={view === 'after' && preview ? preview : photo.url} alt={view === 'after' && preview ? 'Your design scaled on your wall' : 'Your original wall'} aspect={photo.aspect} busy={!!busy} marking={marking} corners={corners} masks={exclusions} draft={excludeDraft} showMasks={showMasks} seams={showPrintGuides ? printSeams : []} onPoint={markPoint} onRectangle={(a,b) => { try { finishMask(rectangularWallMask(a,b)); } catch (e) { setError(e instanceof Error ? e.message : 'Choose opposite corners.'); setExcludeDraft([]); } }} onCorners={setCorners} onMasks={setExclusions} />
              <label className="mt-3 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={showMasks} onChange={e => setShowMasks(e.target.checked)} />Show glass mask overlay and editing handles</label>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => { setCorners([]); setMarking('wall'); setExcludeDraft([]); setView('before'); }}><RotateCcw className="mr-1 h-3 w-3" />{corners.length ? 'Restart wall corners' : 'Mark wall corners'}</Button>
                <Button size="sm" variant={marking === 'rectangle' ? 'default' : 'outline'} disabled={!!busy} onClick={() => { setMarking('rectangle'); setShowMasks(true); setExcludeDraft([]); setView('before'); }}>Mask window / drapes</Button>
                <Button size="sm" variant={marking === 'exclude' ? 'default' : 'outline'} disabled={!!busy} onClick={() => { setMarking('exclude'); setShowMasks(true); setExcludeDraft([]); setView('before'); }}>Outline an object</Button>
                {marking === 'exclude' && <Button size="sm" disabled={!!busy || excludeDraft.length < 3} onClick={() => finishMask(excludeDraft)}>Finish mask</Button>}
                {(marking === 'exclude' || marking === 'rectangle') && <>
                  <Button size="sm" variant="ghost" disabled={!!busy || !excludeDraft.length} onClick={() => setExcludeDraft(old => old.slice(0,-1))}>Undo mask point</Button>
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { setExcludeDraft([]); setMarking(cornersValid ? null : 'wall'); }}>Cancel mask</Button>
                </>}
                {!!exclusions.length && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setExclusions(old => old.slice(0,-1))}>Remove last mask</Button>}
              </div>
              <p className="mt-2 text-xs text-slate-600">Mask the window and each drape to keep their original appearance while the design covers the wall around them. Use Outline an object for irregular edges. Select a finished mask and drag its white points to adjust; arrow keys fine-tune a focused point. {exclusions.length > 0 && `${exclusions.length} protected ${exclusions.length === 1 ? 'area' : 'areas'}.`}</p>
              {marking && <p role="status" className="mt-3 text-sm text-violet-700">{marking === 'wall' ? 'Tap corner ' + (corners.length + 1) + ': ' + cornerNames[corners.length] + '. Wall corners control the preview only.' : marking === 'rectangle' ? excludeDraft.length ? 'Now tap the opposite corner. Everything inside the rectangle will stay unchanged.' : 'Drag a box around the window or drapes, or tap two opposite corners.' : 'Tap around the edge of the drapes or object, then choose Finish mask.'}</p>}
              {!marking && cornersValid && <p className="mt-3 text-xs text-slate-500">Measured wall: {width}″ W × {height}″ H. Placement follows the selected corners.</p>}
              {corners.length > 0 && <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Adjust corner positions</summary><div className="mt-2 grid grid-cols-2 gap-2">{corners.map((p,i) => <div key={i}><span>{i+1}. {cornerNames[i]}</span><div className="flex gap-1">{(['x','y'] as const).map(axis => <label key={axis}>{axis} %<input disabled={!!busy} aria-label={'Corner ' + (i+1) + ' ' + axis + ' percent'} type="number" min="0" max="100" step="0.1" className={inputClass} value={Number((p[axis]*100).toFixed(2))} onChange={e => setCorners(old => old.map((q,j) => j === i ? { ...q, [axis]: Number(e.target.value)/100 } : q))} /></label>)}</div></div>)}</div></details>}
            </> : artwork ? <div className="flex min-h-80 items-center justify-center rounded-xl bg-slate-100 p-4"><img src={artwork.url} alt="Flat wall artwork" className="max-h-[650px] max-w-full object-contain" /></div> : <div className="flex min-h-96 flex-col items-center justify-center rounded-xl bg-slate-100 p-8 text-center"><ImageIcon className="mb-4 h-12 w-12 text-slate-300" /><h2 className="font-semibold">See the design on your wall</h2><p className="mt-2 max-w-sm text-sm text-slate-500">Describe a design and choose Generate wall design, or upload your own artwork. Add a wall photo whenever you want to preview it in your room.</p></div>}
            {busy && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-violet-700"><Loader2 className="h-4 w-4 animate-spin" />{busy}…</p>}
          </section>
          <section className={panelClass}><label className="block text-sm">Project name<input className={inputClass} maxLength={200} value={name} onChange={e => setName(e.target.value)} disabled={!!busy} /></label><div className="mt-4 flex flex-wrap gap-2"><Button disabled={!!busy || !artwork || !dimensionsValid || !metrics} onClick={() => void run('Saving project', () => persistCurrent())}><Save className="mr-2 h-4 w-4" />Save project</Button>{preview && !rendering && !busy ? <Button asChild variant="outline"><a href={preview} download="wallpro-wall-preview.png"><Download className="mr-2 h-4 w-4" />Download wall preview</a></Button> : <Button variant="outline" disabled>Download wall preview</Button>}{artworkDownload && artworkDownload.source === (artwork?.path || artwork?.url) ? <Button asChild variant="outline"><a href={artworkDownload.url} download={artworkDownload.name}>Download artwork</a></Button> : <Button variant="outline" disabled={!!busy || !artwork} onClick={() => void prepareArtworkDownload()}>Prepare artwork download</Button>}</div><p className="mt-3 text-xs text-slate-500">The wall photo download is a visual proof. Use Prepare print files below for full-size panel PDFs.</p></section>
          <WallPrintOutput artwork={artwork} name={name} projectId={projectId} layout={{ width, height, mode: placement, repeatWidth }} settings={printSettings} onSettings={setPrintSettings} busy={!!busy} run={run} />
        </div>
      </div>
    </div>
  </main>;
}
