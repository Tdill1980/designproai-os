/** WallPro Batch Generate: curate the ready-to-sell wall catalog from the
 * 500-prompt industry library (docs/wallpro). Ported from RestylePro's
 * AdminWallProBatch and adapted to this OS: our wall generator, the seam gate
 * inside the queue, real failure reasons on every card, and publication with
 * DesignID + GenerationID + hash provenance. Curators are admin/tester, which
 * the reservation function charges as privileged (no tokens spent). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Loader2, Play, Square, Upload, RefreshCw, Trash2, Download, Zap, Layers, Star, Eye, EyeOff, FileJson } from 'lucide-react';
import { Button } from '@/components/ui/button';
import library from '@/data/wallpro-prompt-library.json';
import { wallUser, uploadWallAsset, openWallAsset, openWallAssets, generateWall, getWallGeneration, listWallCatalogAll, publishWallDesign, updateWallDesign, deleteWallDesign, sha256Hex, type WallAsset } from '@/lib/wallpro-api';
import { validateWallUpload, loadWallImage, canvasBlob } from '@/lib/wallpro-render';
import { measureSeam, seamlessReceipt, type SeamlessReceipt } from '@/lib/wallpro-seamless';
import { batchDimensions, planWallBatch, selectLibraryEntries, catalogMasterPath, catalogThumbPath, designUpsertRow, provenanceManifest, catalogEffectivePpi, CATALOG_THUMB_PX, DEFAULT_TILE_WIDTH_IN, type WallPromptEntry, type WallCatalogRow, type WallCatalogMode, type WallBatchFilter, type WallIntensity } from '@/lib/wallpro-catalog';

const LIBRARY = library as WallPromptEntry[];
const INDUSTRIES = [...new Set(LIBRARY.map(e => e.industry))].sort();
const DESIGN_TYPES = [...new Set(LIBRARY.map(e => e.designType))].sort();
const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950';
const panelClass = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm';

type JobStatus = 'queued' | 'running' | 'done' | 'failed';
type Job = {
  id: string; entry: WallPromptEntry; mode: WallCatalogMode; referenceIndex: number | null; status: JobStatus;
  requestId: string | null; imageUrl: string | null; storagePath: string | null; widthPx: number; heightPx: number;
  seam: SeamlessReceipt | null; error: string | null; ms: number | null; rating: number | null; tileWidthIn: number; published: WallCatalogRow | null;
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
async function thumbnailOf(image: HTMLImageElement): Promise<Blob> {
  const scale = Math.min(1, CATALOG_THUMB_PX / Math.max(image.naturalWidth, image.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(image.naturalWidth * scale)); c.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(image, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('Thumbnail failed.')), 'image/jpeg', 0.86));
}

export default function AdminWallProBatch() {
  const [tab, setTab] = useState<'generator' | 'gallery' | 'history'>('generator');
  const [filter, setFilter] = useState<WallBatchFilter>({ segment: 'all', industry: 'all', designType: 'all', intensity: 'all' });
  const [batchSize, setBatchSize] = useState(10);
  const [includePublished, setIncludePublished] = useState(false);
  const [tileWidthIn, setTileWidthIn] = useState(DEFAULT_TILE_WIDTH_IN);
  const [examples, setExamples] = useState<WallAsset[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [batchId, setBatchId] = useState('');
  const [catalog, setCatalog] = useState<WallCatalogRow[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [galleryIndustry, setGalleryIndustry] = useState('all');
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
  useEffect(() => { refreshCatalog().catch(e => setError(e.message)); }, []);

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
    setJobs(plan.map(p => ({ id: id + '_' + p.index, entry: p.entry, mode: p.mode, referenceIndex: p.referenceIndex, status: 'queued', requestId: null, imageUrl: null, storagePath: null, widthPx: 0, heightPx: 0, seam: null, error: null, ms: null, rating: null, tileWidthIn, published: null })));
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
      const result = await generateWall({ requestId, prompt: job.entry.prompt, width: dims.width, height: dims.height, placement: dims.placement, wallPath: null, referencePath });
      const measured = await measureAsset(result.image_url);
      // The seam gate runs here, on the generated pixels, before anyone rates
      // or publishes. Repeat tiles that do not join are marked mirror by the
      // same rule the customer page applies; murals carry no seam.
      const seam = job.mode === 'repeat' ? seamlessReceipt('auto', measured.report, null) : null;
      patch(job.id, { status: 'done', imageUrl: result.image_url, storagePath: result.storage_path, widthPx: measured.widthPx, heightPx: measured.heightPx, seam, ms: Date.now() - t0 });
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

  const done = jobs.filter(j => j.status === 'done').length, failed = jobs.filter(j => j.status === 'failed').length, processed = jobs.filter(j => j.status === 'done' || j.status === 'failed').length;
  const galleryRows = galleryIndustry === 'all' ? catalog : catalog.filter(r => r.industry === galleryIndustry);
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
      <div className="flex gap-2">{(['generator', 'gallery', 'history'] as const).map(t => <Button key={t} size="sm" variant={tab === t ? 'default' : 'outline'} onClick={() => setTab(t)}>{t === 'generator' ? 'Generator' : t === 'gallery' ? `Gallery (${catalog.length})` : `History (${batches.length})`}</Button>)}</div>

      {tab === 'generator' && <>
        <section className={panelClass}>
          <h2 className="font-semibold">Batch settings</h2>
          <fieldset disabled={running || !!busy} className="mt-3 grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <label className="text-sm">Segment<select className={inputClass} value={filter.segment} onChange={e => setFilter(f => ({ ...f, segment: e.target.value as WallBatchFilter['segment'] }))}><option value="all">All</option><option value="B2B">B2B</option><option value="B2C">B2C</option></select></label>
            <label className="text-sm lg:col-span-2">Industry<select className={inputClass} value={filter.industry} onChange={e => setFilter(f => ({ ...f, industry: e.target.value }))}><option value="all">All industries</option>{INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}</select></label>
            <label className="text-sm">Design type<select className={inputClass} value={filter.designType} onChange={e => setFilter(f => ({ ...f, designType: e.target.value }))}><option value="all">All types</option>{DESIGN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
            <label className="text-sm">Intensity<select className={inputClass} value={filter.intensity} onChange={e => setFilter(f => ({ ...f, intensity: e.target.value as WallIntensity | 'all' }))}><option value="all">Any</option>{(['Quiet', 'Balanced', 'Statement'] as const).map(i => <option key={i} value={i}>{i}</option>)}</select></label>
            <label className="text-sm">Batch size<select className={inputClass} value={batchSize} onChange={e => setBatchSize(Number(e.target.value))}>{[5, 10, 15, 20, 25, 50].map(n => <option key={n} value={n}>{n} designs</option>)}</select></label>
            <label className="text-sm">Repeat tile width (in)<input className={inputClass} type="number" min="1" max="2400" step="1" value={tileWidthIn} onChange={e => setTileWidthIn(Number(e.target.value))} /></label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={includePublished} onChange={e => setIncludePublished(e.target.checked)} />Regenerate already published DesignIDs</label>
            <div className="text-sm text-slate-600 self-end pb-2 lg:col-span-2">{matching.length} library prompts match; the queue takes the first {Math.min(batchSize, matching.length)} in catalog order.</div>
          </fieldset>
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
              </div>
            </>}
          </div>
        </article>)}</div>}
      </>}

      {tab === 'gallery' && <section className={panelClass}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Catalog</h2><label className="text-sm">Industry<select className={inputClass + ' w-auto'} value={galleryIndustry} onChange={e => setGalleryIndustry(e.target.value)}><option value="all">All ({catalog.length})</option>{[...new Set(catalog.map(r => r.industry))].sort().map(i => <option key={i} value={i}>{i} ({catalog.filter(r => r.industry === i).length})</option>)}</select></label></div>
        {galleryRows.length === 0 ? <p className="mt-4 text-sm text-slate-600">Nothing published yet. Run a batch and publish the designs you approve.</p>
        : <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{galleryRows.map(row => <article key={row.id} className={'overflow-hidden rounded-2xl border border-slate-200 bg-white ' + (row.is_active ? '' : 'opacity-60')}>
          <div className="aspect-[4/3] bg-slate-100">{thumbs[row.thumb_path || row.master_path] ? <img src={thumbs[row.thumb_path || row.master_path]} alt={row.title} className="h-full w-full object-cover" loading="lazy" /> : null}</div>
          <div className="space-y-2 p-3 text-xs">
            <p className="font-semibold">{row.design_id} · {row.title}</p>
            <p className="text-slate-500">{row.industry} · {row.design_type} · v{row.master_version} · {catalogEffectivePpi(row).toFixed(0)} PPI{row.seam ? ` · seam ${row.seam.method}` : ''}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Stars value={row.rating} onChange={v => void guarded('Rating', async () => { await updateWallDesign(row.id, { rating: v }); await refreshCatalog(); })} />
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void guarded('Updating', async () => { await updateWallDesign(row.id, { is_active: !row.is_active }); await refreshCatalog(); })}>{row.is_active ? <><Eye className="mr-1 h-3 w-3" />Active</> : <><EyeOff className="mr-1 h-3 w-3" />Hidden</>}</Button>
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
    </div>
  </main>;
}
