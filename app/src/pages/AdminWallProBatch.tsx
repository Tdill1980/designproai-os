/** WallPro Batch Generate: curate the ready-to-sell wall catalog from the
 * 500-prompt industry library (docs/wallpro). Ported from RestylePro's
 * AdminWallProBatch and adapted to this OS: our wall generator, the seam gate
 * inside the queue, real failure reasons on every card, and publication with
 * DesignID + GenerationID + hash provenance. Curators are admin/tester, which
 * the reservation function charges as privileged (no tokens spent). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Loader2, Play, Square, Upload, RefreshCw, Trash2, Download, Zap, Layers, Star, Eye, EyeOff, FileJson, Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import library from '@/data/wallpro-prompt-library.json';
import { wallUser, uploadWallAsset, openWallAsset, openWallAssets, generateWall, getWallGeneration, listWallCatalogAll, publishWallDesign, updateWallDesign, deleteWallDesign, sha256Hex, detectWall, listWallScenesAll, publishWallScene, updateWallScene, deleteWallScene, saveWallDesignMockups, type WallAsset } from '@/lib/wallpro-api';
import { validateWallUpload, prepareWallUpload, loadWallImage, canvasBlob, renderWallPreview } from '@/lib/wallpro-render';
import { WallPhotoEditor } from '@/components/wallpro/WallPhotoEditor';
import { sceneUpsertRow, sceneLayoutFor, mockupCaption, DEFAULT_SCENE_WALL_IN, FULL_FRAME_CORNERS, type WallCatalogScene } from '@/lib/wallpro-scenes';
import type { Point } from '@/lib/wallpro-geometry';
import { measureSeam, seamlessReceipt, type SeamlessReceipt } from '@/lib/wallpro-seamless';
import { batchDimensions, planWallBatch, selectLibraryEntries, catalogMasterPath, catalogThumbPath, designUpsertRow, provenanceManifest, catalogEffectivePpi, CATALOG_THUMB_PX, DEFAULT_TILE_WIDTH_IN, libraryEntryDomain, catalogRowDomain, batchDiversitySummary, batchCreativeBrief, type WallPromptEntry, type WallCatalogRow, type WallCatalogMode, type WallBatchFilter, type WallIntensity } from '@/lib/wallpro-catalog';
import type { WallDesignContract } from '../../../supabase/functions/generate-wall-design/prompt';

const LIBRARY = library as WallPromptEntry[];
const INDUSTRIES = [...new Set(LIBRARY.map(e => e.industry))].sort();
const DESIGN_TYPES = [...new Set(LIBRARY.map(e => e.designType))].sort();
const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950';
const panelClass = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm';
/** A readable label for the domain/space-type chip on a job or catalog card. */
function domainLabel(d: { designDomain: 'commercial' | 'residential'; commercialSpaceType: string | null; residentialSpaceType: string | null; designStyle: string | null }): string {
  const space = (d.commercialSpaceType || d.residentialSpaceType || '').replace(/_/g, ' ');
  const base = d.designDomain === 'commercial' ? 'Commercial' : 'Residential';
  return space && space !== 'other' ? `${base} · ${space}` : base;
}

type JobStatus = 'queued' | 'running' | 'done' | 'failed';
type Job = {
  id: string; entry: WallPromptEntry; mode: WallCatalogMode; referenceIndex: number | null; status: JobStatus;
  requestId: string | null; imageUrl: string | null; storagePath: string | null; widthPx: number; heightPx: number;
  seam: SeamlessReceipt | null; error: string | null; ms: number | null; rating: number | null; tileWidthIn: number; published: WallCatalogRow | null;
  contract: WallDesignContract | null; complianceCheck: Record<string, unknown> | null;
};

function Stars({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return <span className="inline-flex gap-0.5">{[1, 2, 3, 4, 5].map(s => <button key={s} type="button" aria-label={`Rate ${s}`} onClick={() => onChange(s)} className="p-0"><Star className={'h-4 w-4 ' + (s <= (value || 0) ? 'fill-amber-400 text-amber-400' : 'text-slate-300 hover:text-amber-300')} /></button>)}</span>;
}

async function measureAsset(url: string) {
  const image = await loadWallImage(url);
  const tile = document.createElement('canvas');
  tile.width = image.naturalWidth; tile.height = image.naturalHeight;
  const ctx = tile.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser could not read the generated image.');
  ctx.drawImage(image, 0, 0);
  const report = measureSeam(ctx.getImageData(0, 0, tile.width, tile.height).data, tile.width, tile.height);
  tile.width = 1; tile.height = 1;
  return { report, widthPx: image.naturalWidth, heightPx: image.naturalHeight, image };
}
/** The mockup as a listing image: the composite with its true-size caption
 * burned into a bar along the bottom, so the number travels with the picture
 * wherever it is posted. JPEG, since it is a photograph. */
async function listingJpeg(composite: HTMLCanvasElement, caption: string): Promise<Blob> {
  const bar = Math.max(28, Math.round(composite.height * 0.05));
  const c = document.createElement('canvas'); c.width = composite.width; c.height = composite.height + bar;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(composite, 0, 0);
  ctx.fillStyle = '#111827'; ctx.fillRect(0, composite.height, c.width, bar);
  ctx.fillStyle = '#ffffff'; ctx.font = `${Math.round(bar * 0.5)}px system-ui, sans-serif`; ctx.textBaseline = 'middle';
  ctx.fillText(caption, Math.round(bar * 0.4), composite.height + bar / 2);
  return new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('Mockup export failed.')), 'image/jpeg', 0.9));
}
async function thumbnailOf(image: HTMLImageElement): Promise<Blob> {
  const scale = Math.min(1, CATALOG_THUMB_PX / Math.max(image.naturalWidth, image.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(image.naturalWidth * scale)); c.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(image, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('Thumbnail failed.')), 'image/jpeg', 0.86));
}

export default function AdminWallProBatch() {
  const [tab, setTab] = useState<'generator' | 'gallery' | 'history' | 'scenes'>('generator');
  // Room scenes (stock photographs with the feature wall's corners and real
  // inches recorded once) and the "In a room" mockup modal for a published design.
  const [scenes, setScenes] = useState<WallCatalogScene[]>([]);
  const [sceneThumbs, setSceneThumbs] = useState<Record<string, string>>({});
  const [scenePhoto, setScenePhoto] = useState<WallAsset | null>(null);
  const [sceneCorners, setSceneCorners] = useState<Point[]>(FULL_FRAME_CORNERS);
  const [sceneCornerSource, setSceneCornerSource] = useState<'default' | 'detected' | 'marked'>('default');
  const [sceneName, setSceneName] = useState('');
  const [sceneRoom, setSceneRoom] = useState('living_room');
  const [sceneWall, setSceneWall] = useState<{ width: number; height: number }>({ ...DEFAULT_SCENE_WALL_IN });
  const [mockupRow, setMockupRow] = useState<WallCatalogRow | null>(null);
  const [mockups, setMockups] = useState<{ scene: WallCatalogScene; canvas: HTMLCanvasElement; url: string; caption: string }[]>([]);
  const [filter, setFilter] = useState<WallBatchFilter>({ segment: 'all', industry: 'all', designType: 'all', intensity: 'all', domain: 'all' });
  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [batchSize, setBatchSize] = useState(10);
  const [includePublished, setIncludePublished] = useState(false);
  // Default the new-batch UI to the measured architectural baseline — a
  // decorative repeat about TWICE across the tile's own square canvas
  // (`autoMatchRepeatWidthIn(96) === 48`), not the four-across craft scale
  // `DEFAULT_TILE_WIDTH_IN` still names for legacy rows with no stored width.
  // The curator can still type any width per batch or per job.
  const [tileWidthIn, setTileWidthIn] = useState(48);
  const [examples, setExamples] = useState<WallAsset[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [batchId, setBatchId] = useState('');
  const [catalog, setCatalog] = useState<WallCatalogRow[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [galleryIndustry, setGalleryIndustry] = useState('all');
  const [galleryDomain, setGalleryDomain] = useState<'all' | 'commercial' | 'residential'>('all');
  const stop = useRef(false);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach(u => URL.revokeObjectURL(u)), []);

  const published = useMemo(() => new Set(catalog.map(r => r.design_id)), [catalog]);
  const matching = useMemo(() => selectLibraryEntries(LIBRARY, filter, published, includePublished), [filter, published, includePublished]);

  async function refreshCatalog() {
    const rows = await listWallCatalogAll();
    setCatalog(rows);
    const paths = rows.map(r => r.thumb_path || r.master_path);
    setThumbs(await openWallAssets(paths).catch(() => ({})));
  }
  async function refreshScenes() {
    const rows = await listWallScenesAll();
    setScenes(rows);
    setSceneThumbs(await openWallAssets(rows.map(r => r.image_path)).catch(() => ({})));
  }
  // Scenes fail soft: a database without 20260914160000 yet must not take
  // the generator down with it.
  useEffect(() => { refreshCatalog().catch(e => setError(e.message)); refreshScenes().catch(() => {}); }, []);

  async function guarded(label: string, action: () => Promise<void>) {
    setBusy(label); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'The operation could not be completed.'); }
    finally { setBusy(''); }
  }

  async function addExamples(files: FileList | null) {
    if (!files?.length) return;
    await guarded('Opening style examples', async () => {
      const next: WallAsset[] = [];
      for (const file of Array.from(files).slice(0, 6 - examples.length)) { const v = await validateWallUpload(file); urls.current.push(v.url); next.push({ ...v, file }); }
      setExamples(old => [...old, ...next]);
    });
  }

  function buildQueue() {
    const id = 'wallbatch_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    setBatchId(id); stop.current = false;
    const plan = planWallBatch(matching.slice(0, batchSize), examples.length);
    setJobs(plan.map(p => ({ id: id + '_' + p.index, entry: p.entry, mode: p.mode, referenceIndex: p.referenceIndex, status: 'queued', requestId: null, imageUrl: null, storagePath: null, widthPx: 0, heightPx: 0, seam: null, error: null, ms: null, rating: null, tileWidthIn, published: null, contract: null, complianceCheck: null })));
    setError('');
  }
  const patch = (id: string, p: Partial<Job>) => setJobs(old => old.map(j => j.id === id ? { ...j, ...p } : j));

  async function runOne(job: Job, referencePaths: (string | null)[]) {
    const t0 = Date.now();
    const requestId = crypto.randomUUID();
    patch(job.id, { status: 'running', error: null, requestId });
    try {
      const dims = batchDimensions(job.mode);
      const referencePath = job.referenceIndex == null ? null : referencePaths[job.referenceIndex] || null;
      // The curator's own tile-width field was collected and stored on every
      // job but never sent: a repeat batch job asked the model for artwork
      // with no repeat width at all, so the model had nothing to draw motifs
      // at real size against — the same root cause as the customer-facing
      // "pattern too small" report, on this surface too. It rides the same
      // generate-wall-design request the customer designer uses, through the
      // same two-persona pipeline (consultant enriches, designer composes at
      // architectural scale, told this exact motif size).
      // Library metadata rides as advisory hints only (owner spec,
      // 2026-09-13): the edge function's classifier reads industry/room/style
      // the same way it reads a customer's prompt text, and never overrides
      // a word of the library prompt itself. Without this the classifier had
      // only the prompt text to read, which is weaker for a library entry
      // that already names its business/room explicitly.
      // The model gets the listing-quality creative brief, never the raw
      // library prompt: 72% of that text is production-pipeline instruction
      // the pipeline already enforces in code (see batchCreativeBrief). The
      // published row still records entry.prompt as the production contract.
      const result = await generateWall({ requestId, prompt: batchCreativeBrief(job.entry), width: dims.width, height: dims.height, placement: dims.placement, repeatWidthIn: job.mode === 'repeat' ? job.tileWidthIn : undefined, wallPath: null, referencePath, libraryIndustry: job.entry.industry, libraryRoom: job.entry.room, libraryStyle: job.entry.style });
      const measured = await measureAsset(result.image_url);
      // The seam gate runs here, on the generated pixels, before anyone rates
      // or publishes. Repeat tiles that do not join are marked mirror by the
      // same rule the customer page applies; murals carry no seam.
      const seam = job.mode === 'repeat' ? seamlessReceipt('auto', measured.report, null) : null;
      patch(job.id, { status: 'done', imageUrl: result.image_url, storagePath: result.storage_path, widthPx: measured.widthPx, heightPx: measured.heightPx, seam, ms: Date.now() - t0,
        contract: (result as any).design_contract ?? null, complianceCheck: (result as any).compliance_check ?? null });
    } catch (e) {
      patch(job.id, { status: 'failed', error: e instanceof Error ? e.message : 'Generation failed.', ms: Date.now() - t0 });
    }
  }

  async function runBatch() {
    setRunning(true); stop.current = false; setError('');
    try {
      const user = await wallUser();
      const referencePaths: (string | null)[] = [];
      for (const example of examples) referencePaths.push(await uploadWallAsset(example, user.id));
      setExamples(old => old.map((e, i) => ({ ...e, path: referencePaths[i] || e.path })));
      for (const job of jobs) {
        if (stop.current) break;
        if (job.status === 'done') continue;
        await runOne(job, referencePaths);
        if (!stop.current) await new Promise(r => setTimeout(r, 1500));
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'The batch could not run.'); }
    finally { setRunning(false); }
  }

  async function publish(job: Job) {
    if (!job.imageUrl || !job.storagePath || !job.requestId || job.published) return;
    await guarded('Publishing ' + job.entry.id, async () => {
      const user = await wallUser();
      const generation = await getWallGeneration(job.requestId!);
      if (generation.state !== 'completed' || !generation.artwork_path) throw new Error('The generation record is not complete.');
      const source = await openWallAsset(generation.artwork_path);
      const response = await fetch(source);
      if (!response.ok) throw new Error('The master could not be read for hashing.');
      const blob = await response.blob();
      const sha = await sha256Hex(await blob.arrayBuffer());
      const measured = await measureAsset(source);
      const fileId = crypto.randomUUID();
      const existing = catalog.find(r => r.design_id === job.entry.id);
      const row = designUpsertRow({ entry: job.entry, mode: job.mode, tileWidthIn: job.tileWidthIn, generationId: generation.id, promptHash: generation.input_hash,
        masterPath: catalogMasterPath(fileId, blob.type), thumbPath: catalogThumbPath(fileId), masterSha256: sha, widthPx: measured.widthPx, heightPx: measured.heightPx,
        seam: job.seam, rating: job.rating, batchId, createdBy: user.id, previousVersion: existing?.master_version ?? 0 });
      const thumb = await thumbnailOf(measured.image);
      const saved = await publishWallDesign(generation.artwork_path, thumb, row);
      patch(job.id, { published: saved });
      await refreshCatalog();
    });
  }
  async function publishAll() { for (const job of jobs) if (job.status === 'done' && !job.published) await publish(job); }

  async function addScenePhoto(files: FileList | null) {
    const file = files?.[0]; if (!file) return;
    await guarded('Opening the room photo', async () => {
      const prepared = await prepareWallUpload(file);
      const v = await validateWallUpload(prepared);
      urls.current.push(v.url);
      setScenePhoto({ ...v, file: prepared }); setSceneCorners(FULL_FRAME_CORNERS); setSceneCornerSource('default');
      if (!sceneName) setSceneName(file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 80));
      // Detection reads the photo from storage; a miss leaves the curator marking by hand.
      const user = await wallUser();
      const path = await uploadWallAsset({ ...v, file: prepared }, user.id);
      setScenePhoto(p => p ? { ...p, path } : p);
      const detected = await detectWall(path).catch(() => null);
      if (detected?.wall && detected.wall.length === 4) { setSceneCorners(detected.wall); setSceneCornerSource('detected'); }
    });
  }
  async function saveScene() {
    if (!scenePhoto?.path) return;
    await guarded('Saving scene', async () => {
      // A full-frame "wall" would paint the whole room (the same defect the
      // customer page refuses to display, 2026-09-12).
      if (sceneCornerSource === 'default') throw new Error('Mark the four corners of the feature wall first — a full-frame wall would paint the whole room.');
      const user = await wallUser();
      const ext = scenePhoto.file?.type === 'image/png' ? 'png' : scenePhoto.file?.type === 'image/webp' ? 'webp' : 'jpg';
      const row = sceneUpsertRow({ name: sceneName, room: sceneRoom, imagePath: 'catalog/' + crypto.randomUUID() + '.' + ext, widthPx: scenePhoto.width || 0, heightPx: scenePhoto.height || 0, corners: sceneCorners, wallWidthIn: sceneWall.width, wallHeightIn: sceneWall.height, createdBy: user.id, sortOrder: scenes.length });
      await publishWallScene(scenePhoto.path!, row);
      setScenePhoto(null); setSceneName(''); setSceneCorners(FULL_FRAME_CORNERS); setSceneCornerSource('default');
      await refreshScenes();
    });
  }
  /** Imposes the design's own master on every active scene at TRUE size —
   * the customer page's deterministic composite, no AI — one room at a time
   * so the first appears while the rest render. */
  async function openMockups(row: WallCatalogRow) {
    const active = scenes.filter(s => s.is_active);
    if (!active.length) { setError('Add at least one room scene on the Scenes tab first.'); return; }
    setMockupRow(row); setMockups([]);
    await guarded(`Rendering ${row.design_id} in ${active.length} room${active.length === 1 ? '' : 's'}`, async () => {
      const art = await openWallAsset(row.master_path);
      const out: typeof mockups = [];
      for (const scene of active) {
        const photo = sceneThumbs[scene.image_path] || await openWallAsset(scene.image_path);
        const canvas = await renderWallPreview(photo, art, scene.corners, [], sceneLayoutFor(row, scene, DEFAULT_TILE_WIDTH_IN));
        const url = URL.createObjectURL(await canvasBlob(canvas)); urls.current.push(url);
        out.push({ scene, canvas, url, caption: mockupCaption(row, scene, DEFAULT_TILE_WIDTH_IN) });
        setMockups([...out]);
      }
    });
  }
  async function saveMockups() {
    if (!mockupRow || !mockups.length) return;
    await guarded('Saving mockups for ' + mockupRow.design_id, async () => {
      const blobs = await Promise.all(mockups.map(async m => ({ sceneId: m.scene.id, caption: m.caption, blob: await listingJpeg(m.canvas, m.caption) })));
      await saveWallDesignMockups(mockupRow.id, blobs);
      await refreshCatalog();
      setMockupRow(null); setMockups([]);
    });
  }

  const done = jobs.filter(j => j.status === 'done').length, failed = jobs.filter(j => j.status === 'failed').length, processed = jobs.filter(j => j.status === 'done' || j.status === 'failed').length;
  const galleryRows = catalog
    .filter(r => galleryIndustry === 'all' || r.industry === galleryIndustry)
    .filter(r => galleryDomain === 'all' || catalogRowDomain(r).designDomain === galleryDomain);
  const batches = useMemo(() => { const m = new Map<string, WallCatalogRow[]>(); for (const r of catalog) { const k = r.batch_id || 'unbatched'; m.set(k, [...(m.get(k) || []), r]); } return [...m.entries()].sort((a, b) => (b[1][0].created_at > a[1][0].created_at ? 1 : -1)); }, [catalog]);
  const downloadJson = (row: WallCatalogRow) => { const url = URL.createObjectURL(new Blob([JSON.stringify(provenanceManifest(row), null, 2)], { type: 'application/json' })); urls.current.push(url); const a = document.createElement('a'); a.href = url; a.download = row.design_id + '-provenance.json'; a.click(); };

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 md:px-8">
    <Helmet><title>WallPro Batch Generate | DesignProAI</title></Helmet>
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-emerald-600">WrapReady Designs</p><h1 className="mt-1 flex items-center gap-2 text-3xl font-bold"><Layers className="h-7 w-7 text-emerald-500" />WallPro Batch Generate</h1><p className="mt-1 text-sm text-slate-600">Generate, seam-check, curate and publish wall designs from the 500-prompt industry library. Every published design keeps its DesignID, GenerationID and master hash.</p></div>
        <div className="text-xs text-slate-500">{catalog.length} in catalog · {catalog.filter(r => r.is_active).length} active · {LIBRARY.length - published.size} library prompts unpublished</div>
      </header>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      <div className="flex gap-2">{(['generator', 'gallery', 'scenes', 'history'] as const).map(t => <Button key={t} size="sm" variant={tab === t ? 'default' : 'outline'} onClick={() => setTab(t)}>{t === 'generator' ? 'Generator' : t === 'gallery' ? `Gallery (${catalog.length})` : t === 'scenes' ? `Room scenes (${scenes.length})` : `History (${batches.length})`}</Button>)}</div>

      {tab === 'generator' && <>
        <section className={panelClass}>
          <h2 className="font-semibold">Batch settings</h2>
          <fieldset disabled={running || !!busy} className="mt-3 grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <label className="text-sm">Segment<select className={inputClass} value={filter.segment} onChange={e => setFilter(f => ({ ...f, segment: e.target.value as WallBatchFilter['segment'] }))}><option value="all">All</option><option value="B2B">B2B</option><option value="B2C">B2C</option></select></label>
            <label className="text-sm">Domain<select className={inputClass} value={filter.domain} onChange={e => setFilter(f => ({ ...f, domain: e.target.value as WallBatchFilter['domain'] }))}><option value="all">Commercial + Residential</option><option value="commercial">Commercial</option><option value="residential">Residential</option></select></label>
            <label className="text-sm lg:col-span-2">Industry<select className={inputClass} value={filter.industry} onChange={e => setFilter(f => ({ ...f, industry: e.target.value }))}><option value="all">All industries</option>{INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}</select></label>
            <label className="text-sm">Design type<select className={inputClass} value={filter.designType} onChange={e => setFilter(f => ({ ...f, designType: e.target.value }))}><option value="all">All types</option>{DESIGN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
            <label className="text-sm">Intensity<select className={inputClass} value={filter.intensity} onChange={e => setFilter(f => ({ ...f, intensity: e.target.value as WallIntensity | 'all' }))}><option value="all">Any</option>{(['Quiet', 'Balanced', 'Statement'] as const).map(i => <option key={i} value={i}>{i}</option>)}</select></label>
            <label className="text-sm">Batch size<select className={inputClass} value={batchSize} onChange={e => setBatchSize(Number(e.target.value))}>{[5, 10, 15, 20, 25, 50].map(n => <option key={n} value={n}>{n} designs</option>)}</select></label>
            <label className="text-sm">Repeat tile width (in)<input className={inputClass} type="number" min="1" max="2400" step="1" value={tileWidthIn} onChange={e => setTileWidthIn(Number(e.target.value))} /></label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={includePublished} onChange={e => setIncludePublished(e.target.checked)} />Regenerate already published DesignIDs</label>
            <div className="text-sm text-slate-600 self-end pb-2 lg:col-span-2">{matching.length} library prompts match; the queue takes the first {Math.min(batchSize, matching.length)} in catalog order.</div>
          </fieldset>
          {jobs.length > 1 && <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            {(() => { const d = batchDiversitySummary(jobs.map(j => j.entry)); const top = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1])[0]; const domainTop = top(d.domains), styleTop = top(d.styles), paletteTop = top(d.paletteFamilies);
              return <>Batch diversity — {Object.keys(d.domains).length} domain(s), {Object.keys(d.styles).length} style(s), {Object.keys(d.paletteFamilies).length} palette famil{Object.keys(d.paletteFamilies).length === 1 ? 'y' : 'ies'} across {d.count} jobs.
                {domainTop && domainTop[1] === d.count && <span className="ml-1 font-medium text-amber-700">All {domainTop[0]}.</span>}
                {styleTop && styleTop[1] > d.count * 0.6 && <span className="ml-1 font-medium text-amber-700">{styleTop[1]}/{d.count} share style "{styleTop[0]}" — check for a converging house look.</span>}
                {paletteTop && paletteTop[1] > d.count * 0.6 && <span className="ml-1 font-medium text-amber-700">{paletteTop[1]}/{d.count} share the "{paletteTop[0]}" palette family.</span>}
              </>; })()}
          </div>}
          <div className="mt-4 rounded-lg border border-slate-200 p-3">
            <label className="relative flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-3 text-sm font-medium hover:border-emerald-400"><Upload size={16} />Add style examples for the AI (up to 6, cycled across the batch)<input type="file" multiple accept="image/jpeg,image/png,image/webp" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" disabled={running} onChange={e => { void addExamples(e.target.files); e.target.value = ''; }} /></label>
            {examples.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{examples.map((ex, i) => <div key={i} className="relative"><img src={ex.url} alt={'Style example ' + (i + 1)} className="h-16 w-16 rounded object-cover" /><button type="button" className="absolute -right-1 -top-1 rounded-full bg-white px-1 text-xs shadow" onClick={() => setExamples(old => old.filter((_, j) => j !== i))} disabled={running}>×</button></div>)}</div>}
            <p className="mt-2 text-xs text-slate-500">Examples are sent as style references only. Each prompt already carries the production contract: flat artwork, full bleed, one master, no panel-by-panel generation.</p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled={running || !!busy || !matching.length} onClick={buildQueue}><Zap className="mr-2 h-4 w-4" />Build queue</Button>
            {jobs.length > 0 && !running && <Button className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white" disabled={!!busy} onClick={() => void runBatch()}><Play className="mr-2 h-4 w-4" />Run {jobs.filter(j => j.status !== 'done').length}</Button>}
            {running && <Button variant="destructive" onClick={() => { stop.current = true; }}><Square className="mr-2 h-4 w-4" />Stop after this one</Button>}
            {jobs.some(j => j.status === 'done' && !j.published) && !running && <Button variant="outline" disabled={!!busy} onClick={() => void publishAll()}><Upload className="mr-2 h-4 w-4" />Publish all ready ({jobs.filter(j => j.status === 'done' && !j.published).length})</Button>}
            {failed > 0 && !running && <Button variant="ghost" onClick={() => setJobs(old => old.map(j => j.status === 'failed' ? { ...j, status: 'queued', error: null } : j))}><RefreshCw className="mr-2 h-4 w-4" />Re-queue failed ({failed})</Button>}
            {jobs.length > 0 && !running && <Button variant="ghost" onClick={() => setJobs([])}><Trash2 className="mr-2 h-4 w-4" />Clear</Button>}
            {(running || busy) && <span className="flex items-center gap-1 text-sm text-emerald-700"><Loader2 className="h-4 w-4 animate-spin" />{busy || `Generating ${processed + 1} of ${jobs.length}`}</span>}
          </div>
          {jobs.length > 0 && <div className="mt-3"><div className="flex justify-between text-xs text-slate-600"><span>{processed}/{jobs.length} processed</span><span>{done} done · {failed} failed · {jobs.filter(j => j.published).length} published</span></div><div className="mt-1 h-2 rounded bg-slate-200"><div className="h-2 rounded bg-emerald-500" style={{ width: (jobs.length ? processed / jobs.length * 100 : 0) + '%' }} /></div></div>}
        </section>

        {jobs.length === 0 ? <section className={panelClass + ' text-center text-sm text-slate-600'}>Choose a segment, industry or design type, then Build queue. Repeat patterns and architectural surfaces are seam-checked as they arrive; a tile that does not join is marked Mirror and still publishes seamless.</section>
        : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{jobs.map(job => <article key={job.id} className={'overflow-hidden rounded-2xl border bg-white shadow-sm ' + (job.status === 'failed' ? 'border-red-300' : job.published ? 'border-emerald-400' : 'border-slate-200')}>
          <div className="relative flex aspect-[4/3] items-center justify-center bg-slate-100">
            {job.status === 'queued' && <span className="text-xs text-slate-500">Queued</span>}
            {job.status === 'running' && <span className="flex items-center gap-1 text-xs text-emerald-700"><Loader2 className="h-4 w-4 animate-spin" />Generating</span>}
            {job.status === 'done' && job.imageUrl && <img src={job.imageUrl} alt={job.entry.title} className="h-full w-full object-cover" loading="lazy" />}
            {job.status === 'failed' && <p className="px-3 text-center text-xs text-red-700">{job.error}</p>}
            <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">{job.mode === 'repeat' ? 'Repeat tile' : 'Mural'}</span>
            {job.ms != null && <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{Math.round(job.ms / 1000)}s</span>}
          </div>
          <div className="space-y-2 p-3 text-xs">
            <p className="font-semibold">{job.entry.id} · {job.entry.title}</p>
            <p className="text-slate-500">{job.entry.industry} · {job.entry.room} · {job.entry.designType} · {job.entry.intensity}</p>
            <span className={'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ' + (libraryEntryDomain(job.entry).designDomain === 'commercial' ? 'bg-sky-100 text-sky-800' : 'bg-fuchsia-100 text-fuchsia-800')}>{domainLabel(libraryEntryDomain(job.entry))}</span>
            {job.status === 'done' && <>
              {job.seam && <p className={job.seam.method === 'verified' ? 'text-emerald-700' : 'text-amber-700'}>{job.seam.method === 'verified' ? `Seam verified as generated (${job.seam.before.ratio.toFixed(2)}×).` : `Seam ${job.seam.before.ratio.toFixed(1)}× its neighbours: publishes as mirror repeat.`}</p>}
              <p className="text-slate-500">{job.widthPx}×{job.heightPx} px · {catalogEffectivePpi({ mode: job.mode, tile_width_in: job.tileWidthIn, width_px: job.widthPx, height_px: job.heightPx }).toFixed(0)} PPI at {job.mode === 'repeat' ? job.tileWidthIn + '″ tile' : '144″ wall'}{job.published ? ` · published v${job.published.master_version}` : ''}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Stars value={job.rating} onChange={v => patch(job.id, { rating: v })} />
                {job.mode === 'repeat' && !job.published && <label className="flex items-center gap-1">Tile<input type="number" min="1" max="2400" className="w-16 rounded border border-slate-300 px-1 py-0.5" value={job.tileWidthIn} disabled={!!busy} onChange={e => patch(job.id, { tileWidthIn: Number(e.target.value) })} />″</label>}
              </div>
              <div className="flex flex-wrap gap-1">
                {!job.published && <Button size="sm" variant="outline" disabled={!!busy || running} onClick={() => void publish(job)}><Upload className="mr-1 h-3 w-3" />Publish</Button>}
                <Button size="sm" variant="ghost" asChild><a href={job.imageUrl!} download={job.entry.id + '.png'}><Download className="mr-1 h-3 w-3" />Save</a></Button>
                <Button size="sm" variant="ghost" disabled={!!busy || running} onClick={() => void runOne({ ...job, status: 'queued', published: null }, examples.map(e => e.path || null))}><RefreshCw className="mr-1 h-3 w-3" />Regen</Button>
                <Button size="sm" variant="ghost" onClick={() => setDetailJob(job)}><Info className="mr-1 h-3 w-3" />Details</Button>
              </div>
            </>}
          </div>
        </article>)}</div>}
      </>}

      {tab === 'gallery' && <section className={panelClass}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Catalog</h2>
          <div className="flex gap-2">
            <label className="text-sm">Domain<select className={inputClass + ' w-auto'} value={galleryDomain} onChange={e => setGalleryDomain(e.target.value as typeof galleryDomain)}><option value="all">All</option><option value="commercial">Commercial</option><option value="residential">Residential</option></select></label>
            <label className="text-sm">Industry<select className={inputClass + ' w-auto'} value={galleryIndustry} onChange={e => setGalleryIndustry(e.target.value)}><option value="all">All ({catalog.length})</option>{[...new Set(catalog.map(r => r.industry))].sort().map(i => <option key={i} value={i}>{i} ({catalog.filter(r => r.industry === i).length})</option>)}</select></label>
          </div>
        </div>
        {galleryRows.length === 0 ? <p className="mt-4 text-sm text-slate-600">Nothing published yet. Run a batch and publish the designs you approve.</p>
        : <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{galleryRows.map(row => <article key={row.id} className={'overflow-hidden rounded-2xl border border-slate-200 bg-white ' + (row.is_active ? '' : 'opacity-60')}>
          <div className="aspect-[4/3] bg-slate-100">{thumbs[row.thumb_path || row.master_path] ? <img src={thumbs[row.thumb_path || row.master_path]} alt={row.title} className="h-full w-full object-cover" loading="lazy" /> : null}</div>
          <div className="space-y-2 p-3 text-xs">
            <p className="font-semibold">{row.design_id} · {row.title}</p>
            <span className={'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ' + (catalogRowDomain(row).designDomain === 'commercial' ? 'bg-sky-100 text-sky-800' : 'bg-fuchsia-100 text-fuchsia-800')}>{domainLabel(catalogRowDomain(row))}</span>
            <p className="text-slate-500">{row.industry} · {row.design_type} · v{row.master_version} · {catalogEffectivePpi(row).toFixed(0)} PPI{row.seam ? ` · seam ${row.seam.method}` : ''}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Stars value={row.rating} onChange={v => void guarded('Rating', async () => { await updateWallDesign(row.id, { rating: v }); await refreshCatalog(); })} />
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void guarded('Updating', async () => { await updateWallDesign(row.id, { is_active: !row.is_active }); await refreshCatalog(); })}>{row.is_active ? <><Eye className="mr-1 h-3 w-3" />Active</> : <><EyeOff className="mr-1 h-3 w-3" />Hidden</>}</Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void openMockups(row)}><Layers className="mr-1 h-3 w-3" />In a room{row.mockups?.length ? ` (${row.mockups.length})` : ''}</Button>
              <Button size="sm" variant="ghost" onClick={() => downloadJson(row)}><FileJson className="mr-1 h-3 w-3" />Provenance</Button>
              <Button size="sm" variant="ghost" className="text-red-700" disabled={!!busy} onClick={() => { if (window.confirm(`Remove ${row.design_id} from the catalog? The master copy and generation record are retained as provenance.`)) void guarded('Removing', async () => { await deleteWallDesign(row); await refreshCatalog(); }); }}><Trash2 className="mr-1 h-3 w-3" />Remove</Button>
            </div>
          </div>
        </article>)}</div>}
      </section>}

      {tab === 'history' && <section className={panelClass}>
        <h2 className="font-semibold">Batches</h2>
        {batches.length === 0 ? <p className="mt-4 text-sm text-slate-600">Published designs appear here grouped by batch.</p>
        : <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{batches.map(([id, rows]) => <div key={id} className="rounded-xl border border-slate-200 p-3 text-sm"><p className="font-mono text-xs">{id}</p><p className="mt-1 text-slate-600">{rows.length} designs · {rows.filter(r => r.is_active).length} active · {new Date(rows[0].created_at).toLocaleString()}</p><p className="mt-1 text-xs text-slate-500">{[...new Set(rows.map(r => r.industry))].join(' · ')}</p></div>)}</div>}
      </section>}

      {tab === 'scenes' && <section className={panelClass}>
        <h2 className="font-semibold">Room scenes</h2>
        <p className="mt-1 text-sm text-slate-600">A stock room photo with its feature wall marked once and its real size recorded. Every published design can then be shown in it at true pattern size — the number a customer needs before they buy.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            {!scenePhoto ? <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-sm font-medium hover:border-emerald-400"><Upload size={16} />Add a room photo<input type="file" accept="image/*,.heic,.heif" className="sr-only" disabled={!!busy} onChange={e => { void addScenePhoto(e.target.files); e.target.value = ''; }} /></label>
            : <>
              <WallPhotoEditor url={scenePhoto.url} alt="Room scene" aspect={scenePhoto.aspect} busy={!!busy} marking={null} corners={sceneCorners} masks={[]} draft={[]} showMasks={false} seams={[]} onEditing={() => {}} onPoint={() => {}} onRectangle={() => {}} onCorners={pts => { setSceneCorners(pts); setSceneCornerSource('marked'); }} onMasks={() => {}} />
              <p className="mt-2 text-xs text-slate-600">{sceneCornerSource === 'detected' ? 'Wall corners detected — drag any handle to correct them.' : sceneCornerSource === 'marked' ? 'Corners marked by hand.' : 'Detection did not find the wall: drag the four handles to its corners.'}</p>
            </>}
          </div>
          <fieldset disabled={!scenePhoto || running || !!busy} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">Scene name<input className={inputClass} value={sceneName} onChange={e => setSceneName(e.target.value)} maxLength={80} /></label>
            <label className="text-sm">Room<select className={inputClass} value={sceneRoom} onChange={e => setSceneRoom(e.target.value)}>{['living_room', 'bedroom', 'nursery', 'kids_room', 'dining_room', 'kitchen', 'bathroom', 'powder_room', 'home_office', 'entryway', 'hallway', 'corporate_office', 'restaurant', 'retail', 'hotel', 'other'].map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}</select></label>
            <div />
            <label className="text-sm">Wall width (in)<input className={inputClass} type="number" min="12" max="2400" value={sceneWall.width} onChange={e => setSceneWall(w => ({ ...w, width: Number(e.target.value) }))} /></label>
            <label className="text-sm">Wall height (in)<input className={inputClass} type="number" min="12" max="2400" value={sceneWall.height} onChange={e => setSceneWall(w => ({ ...w, height: Number(e.target.value) }))} /></label>
            <p className="text-xs text-slate-500 sm:col-span-2">Measure the wall inside the four corners. A typical feature wall is 14 × 9 ft (168 × 108 in). Every mockup's scale depends on this number.</p>
            <div className="flex gap-2 sm:col-span-2"><Button disabled={!scenePhoto?.path} onClick={() => void saveScene()}><Upload className="mr-2 h-4 w-4" />Save scene</Button><Button variant="ghost" onClick={() => { setScenePhoto(null); setSceneCorners(FULL_FRAME_CORNERS); setSceneCornerSource('default'); }}>Discard</Button></div>
          </fieldset>
        </div>
        {scenes.length > 0 && <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{scenes.map(s => <article key={s.id} className={'overflow-hidden rounded-2xl border border-slate-200 bg-white ' + (s.is_active ? '' : 'opacity-60')}>
          <div className="aspect-[4/3] bg-slate-100">{sceneThumbs[s.image_path] && <img src={sceneThumbs[s.image_path]} alt={s.name} className="h-full w-full object-cover" loading="lazy" />}</div>
          <div className="space-y-2 p-3 text-xs">
            <p className="font-semibold">{s.name}</p>
            <p className="text-slate-500">{(s.room || 'room').replace(/_/g, ' ')} · wall {Math.round(s.wall_width_in / 12)} × {Math.round(s.wall_height_in / 12)} ft</p>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void guarded('Updating scene', async () => { await updateWallScene(s.id, { is_active: !s.is_active }); await refreshScenes(); })}>{s.is_active ? <><Eye className="mr-1 h-3 w-3" />Active</> : <><EyeOff className="mr-1 h-3 w-3" />Hidden</>}</Button>
              <Button size="sm" variant="ghost" className="text-red-700" disabled={!!busy} onClick={() => { if (window.confirm(`Remove the scene "${s.name}"? Mockups already saved from it are kept.`)) void guarded('Removing scene', async () => { await deleteWallScene(s.id); await refreshScenes(); }); }}><Trash2 className="mr-1 h-3 w-3" />Remove</Button>
            </div>
          </div>
        </article>)}</div>}
      </section>}
    </div>

    {/* "In a room": the design's master on every active scene at true size. */}
    {mockupRow && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setMockupRow(null); setMockups([]); }}>
      <div className="max-h-full w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-widest text-emerald-600">{mockupRow.design_id} · in a room</p><h3 className="text-lg font-bold">{mockupRow.title}</h3></div><Button size="sm" variant="ghost" onClick={() => { setMockupRow(null); setMockups([]); }}><X className="h-4 w-4" /></Button></div>
        {mockups.length === 0 && <p className="mt-4 flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Imposing the master on each room at true size…</p>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">{mockups.map(m => <figure key={m.scene.id}><img src={m.url} alt={m.scene.name} className="w-full rounded-lg border border-slate-200" /><figcaption className="mt-1 text-xs text-slate-600">{m.scene.name} — {m.caption}</figcaption></figure>)}</div>
        {mockups.length > 0 && <div className="mt-4 flex flex-wrap items-center gap-3"><Button disabled={!!busy} onClick={() => void saveMockups()}><Upload className="mr-2 h-4 w-4" />Save as listing images ({mockups.length})</Button><p className="text-xs text-slate-500">Saved mockups become the design's storefront image, caption burned in. Presentation only — never a print file.</p></div>}
      </div>
    </div>}

    {/* Detail drawer: the full WallDesignContract + advisory compliance
        receipt persona 1/2 actually produced for this job — never shown on
        the card itself, to keep it uncluttered (owner spec, section 9). */}
    {detailJob && <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40" onClick={() => setDetailJob(null)}>
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div><p className="text-xs font-semibold uppercase tracking-widest text-emerald-600">{detailJob.entry.id}</p><h3 className="text-lg font-bold">{detailJob.entry.title}</h3></div>
          <Button size="sm" variant="ghost" onClick={() => setDetailJob(null)}><X className="h-4 w-4" /></Button>
        </div>
        <p className="mt-1 text-xs text-slate-500">{detailJob.entry.industry} · {detailJob.entry.room} · {detailJob.entry.designType} · {domainLabel(libraryEntryDomain(detailJob.entry))}</p>
        {detailJob.contract ? <div className="mt-4 space-y-3 text-sm">
          <div><p className="text-xs font-semibold text-slate-500">Design domain persona 2 used</p><p>{domainLabel({ designDomain: detailJob.contract.designDomain || 'commercial', commercialSpaceType: detailJob.contract.commercialSpaceType ?? null, residentialSpaceType: detailJob.contract.residentialSpaceType ?? null, designStyle: detailJob.contract.designStyle ?? null })}{detailJob.contract.designStyle ? ` · style guidance: ${detailJob.contract.designStyle}` : ''}</p></div>
          <div><p className="text-xs font-semibold text-slate-500">Client intent</p><p>{detailJob.contract.customerIntent}</p></div>
          {detailJob.contract.requiredSubjects.length > 0 && <div><p className="text-xs font-semibold text-slate-500">Required subjects (immutable)</p><ul className="list-disc pl-4">{detailJob.contract.requiredSubjects.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
          {detailJob.contract.requiredElements.length > 0 && <div><p className="text-xs font-semibold text-slate-500">Required elements (immutable)</p><ul className="list-disc pl-4">{detailJob.contract.requiredElements.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
          {detailJob.contract.requiredColors.length > 0 && <div><p className="text-xs font-semibold text-slate-500">Required colors (immutable)</p><p>{detailJob.contract.requiredColors.join(', ')}</p></div>}
          <div><p className="text-xs font-semibold text-slate-500">Business context</p><p>{detailJob.contract.businessContext || '(none)'}</p></div>
          {detailJob.contract.forbiddenInventions.length > 0 && <div><p className="text-xs font-semibold text-slate-500">Forbidden</p><ul className="list-disc pl-4">{detailJob.contract.forbiddenInventions.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
          {detailJob.complianceCheck ? <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs font-semibold text-slate-500">Advisory creative compliance (off by default; only present when explicitly run)</p>
            <p className="mt-1">Compliant: {String((detailJob.complianceCheck as any).compliant)} · Professional quality floor: {String((detailJob.complianceCheck as any).professionalQualityFloor)}</p>
            {Array.isArray((detailJob.complianceCheck as any).aiSlopFlags) && (detailJob.complianceCheck as any).aiSlopFlags.length > 0 && <p className="mt-1 text-amber-700">AI-slop flags: {(detailJob.complianceCheck as any).aiSlopFlags.join(', ')}</p>}
            {(detailJob.complianceCheck as any).notes && <p className="mt-1 text-slate-600">{(detailJob.complianceCheck as any).notes}</p>}
          </div> : <p className="text-xs text-slate-500">Advisory compliance check was not run for this job (off by default).</p>}
          <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-500">Full WallDesignContract JSON</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[10px]">{JSON.stringify(detailJob.contract, null, 2)}</pre></details>
        </div> : <p className="mt-4 text-sm text-slate-600">No Design Contract was produced for this job (the consultant call may have failed soft, or this intent skips it) — the library prompt went through as written.</p>}
      </div>
    </div>}
  </main>;
}
