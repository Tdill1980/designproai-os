import { useEffect, useState } from 'react';
import { Download, Loader2, Sparkles, ShieldCheck } from 'lucide-react';
import { deliveryMessage, deliveryState } from '@/lib/wallpro-panelpro';
import { Button } from '@/components/ui/button';
import { latestWallProductionJob, getWallProductionJob, openWallAssets, requestWallProduction, wallDesignId, wallPanelFiles, wholeWallFile, type WallProductionJob, type WallProductionRequest, type WallVersion } from '@/lib/wallpro-api';

type Props = {
  /** The approved version the panels are built from, or null when none is approved. */
  approved: WallVersion | null;
  request: WallProductionRequest;
  /** Bumped by the page when it wants a build started (approval auto-starts one). */
  autoStart: number;
  busy: boolean;
};

const fmt = (n: number) => Number(n.toFixed(3)).toString();
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + ' MB';

/** 150 PPI print panels, built on the server through Topaz for the approved
 * version. Every panel is a full-size PNG at its stated inches. */
export function WallProductionPanels({ approved, request, autoStart, busy }: Props) {
  const [job, setJob] = useState<WallProductionJob | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [requesting, setRequesting] = useState(false);
  const live = job && (job.status === 'queued' || job.status === 'running');

  useEffect(() => {
    let active = true; setJob(null); setLinks({}); setError('');
    if (!approved) return;
    latestWallProductionJob(approved.id).then(j => { if (active) setJob(j); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [approved?.id]);

  async function start() {
    if (!approved) return;
    setRequesting(true); setError('');
    try { setJob(await requestWallProduction(approved.id, request)); }
    catch (e) { setError(e instanceof Error ? e.message : 'The production build could not be requested.'); }
    finally { setRequesting(false); }
  }
  useEffect(() => { if (autoStart > 0 && approved) void start(); }, [autoStart]);

  // Poll while the runtime works; each panel lands in the row as it is built.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => { getWallProductionJob(job!.id).then(setJob).catch(e => setError(e.message)); }, 5000);
    return () => clearInterval(timer);
  }, [live, job?.id]);

  useEffect(() => {
    let active = true;
    const whole = wholeWallFile(job);
    const paths = [...(job?.panels || []).flatMap(p => wallPanelFiles(p).map(f => f.path!)), ...(job?.manifest_path ? [job.manifest_path] : []), ...(whole ? [whole.path] : [])].filter(p => !links[p]);
    if (!paths.length) return;
    openWallAssets(paths, { download: true }).then(more => { if (active) setLinks(old => ({ ...old, ...more })); }).catch(() => { /* links retry on the next poll */ });
    return () => { active = false; };
  }, [job?.panels?.length, job?.manifest_path, wholeWallFile(job)?.path]);
  const whole = wholeWallFile(job);

  const stale = job && JSON.stringify(job.request) !== JSON.stringify(request);
  return <section className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm" aria-label="Production panels">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold"><Sparkles className="mr-2 inline h-4 w-4 text-violet-600" />Production panels{approved ? <> · <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-sm text-white">{wallDesignId(approved.id)}</span></> : ''} · {request.targetPpi} PPI · {fmt(request.panelWidthIn)}″ panels · {fmt(request.overlapIn)}″ overlap</h2>
      {approved && <Button size="sm" disabled={busy || requesting || !!live} onClick={() => void start()}>{requesting ? 'Requesting…' : live ? 'Building…' : job ? 'Rebuild panels' : 'Build 150 PPI panels'}</Button>}
    </div>
    <p className="mt-1 text-sm text-slate-600">Built on the server from the approved version: each panel is rasterised from the master, enhanced through Topaz, and delivered at exactly {request.targetPpi} PPI for its inches. Print files never wait for the wall photo.{approved ? ` Your design team can download these under ${wallDesignId(approved.id)}.` : ''}</p>
    {!approved && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Approve a version to build its production panels.</p>}
    {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {job && <div className="mt-3 space-y-2 text-sm">
      {live && <p role="status" className="flex items-center gap-2 text-violet-700"><Loader2 className="h-4 w-4 animate-spin" />{job.status === 'queued' ? 'Queued for the production runtime…' : `Building panel ${Math.min((job.progress.panelsDone || 0) + 1, job.progress.panelsTotal || 0)} of ${job.progress.panelsTotal || '?'}${job.progress.nativePpi ? ` · master is ${job.progress.nativePpi} PPI native, Topaz ${job.progress.topaz || ''} to ${request.targetPpi}` : ''}`}</p>}
      {job.status === 'failed' && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">The build failed: {job.error || 'unknown error'}. Rebuild to try again.</p>}
      {/* GENIE WALL PANELIZER -- THE WINDOW, STATED AS THE SERVICE IT IS.
          `ready` means cut, not handed over: a person checks every panel
          against the wall measurements, the seams and the resolution before
          anything is released, and until they do the files are unreadable
          (20260912240000). Owner, 2026-09-12: "these are our real customers of
          wpw we can't risk going 100% ai." A competitor ships whatever the
          model produced; this is the reason the trade buys here, so it is sold
          rather than apologised for. */}
      {(() => { const message = deliveryMessage(job); const state = deliveryState(job); return message && state !== 'failed' && state !== 'building'
        ? <div className={'rounded-xl border p-3 ' + (state === 'released' ? 'border-emerald-300 bg-emerald-50' : 'border-sky-300 bg-sky-50')}>
            <p className={'flex items-center gap-2 text-sm font-semibold ' + (state === 'released' ? 'text-emerald-900' : 'text-sky-900')}>
              <ShieldCheck className="h-4 w-4 shrink-0" />{message.title}
            </p>
            <p className={'mt-1 text-xs ' + (state === 'released' ? 'text-emerald-900' : 'text-sky-900')}>{message.detail}</p>
          </div>
        : null; })()}
      {stale && !live && <p className="text-xs text-amber-800">These panels were built for a different wall size or placement. Rebuild for the current settings.</p>}
      {/* THE print file first: the whole wall as one PNG. Panels are the fallback for a RIP that cannot tile. */}
      {job.status === 'ready' && whole && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-violet-400 bg-violet-50 px-4 py-3">
        <span><strong className="text-base">Print file · {wallDesignId(approved!.id)}</strong><br /><span className="text-slate-700">{whole.file} · {fmt(whole.widthIn)} × {fmt(whole.heightIn)} in with {fmt(request.bleedIn)}″ bleed · {whole.widthPx.toLocaleString()} × {whole.heightPx.toLocaleString()} px · {whole.ppi} PPI · {mb(whole.byteSize)}</span></span>
        {links[whole.path] ? <Button asChild size="lg"><a href={links[whole.path]} download={whole.file} rel="noopener"><Download className="mr-2 h-4 w-4" />Download print file</a></Button> : <span className="text-xs text-slate-500">preparing link…</span>}
      </div>}
      {job.status === 'ready' && !whole && job.progress?.wholeWall && 'error' in job.progress.wholeWall && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">One-file print could not be built: {job.progress.wholeWall.error}. Print from the panels below.</p>}
      {job.panels.length > 0 && <details open={!whole} className="rounded-lg border"><summary className="cursor-pointer px-3 py-2 text-slate-700">{whole ? 'Panels, for a RIP that cannot tile' : 'Panels'} ({job.panels.length} × {fmt(request.panelWidthIn)}″)</summary><ul className="divide-y border-t">
        {job.panels.map(p => <li key={p.number} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span>Panel {p.number} · {fmt(p.widthIn)} × {fmt(p.heightIn)} in · {p.widthPx.toLocaleString()} × {p.heightPx.toLocaleString()} px · {p.ppi} PPI{p.overlapLeftIn ? ` · ${fmt(p.overlapLeftIn)}″ overlap left` : ''} · {mb(p.byteSize)}{p.upscale?.engine === 'none' ? ' · native' : ' · Topaz'}</span>
          <span className="flex flex-wrap items-center gap-1">{wallPanelFiles(p).map(f => links[f.path!]
            ? <Button key={f.format} asChild size="sm" variant={f.format === 'tiff' ? 'default' : 'outline'}><a href={links[f.path!]} download={f.file} rel="noopener"><Download className="mr-1 h-3 w-3" />{f.format.toUpperCase()}{f.byteSize ? ` · ${mb(f.byteSize)}` : ''}</a></Button>
            : <span key={f.format} className="text-xs text-slate-500">preparing link…</span>)}</span>
        </li>)}
        {job.status === 'ready' && job.manifest_path && <li className="flex items-center justify-between px-3 py-2"><span>Panel manifest and install notes</span>{links[job.manifest_path] ? <Button asChild size="sm" variant="ghost"><a href={links[job.manifest_path]} download="manifest.json">JSON</a></Button> : <span className="text-xs text-slate-500">preparing link…</span>}</li>}
      </ul></details>}
    </div>}
  </section>;
}
