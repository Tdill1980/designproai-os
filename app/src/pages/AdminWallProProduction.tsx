import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listWallProductionJobsForTeam, openWallAssets, wallDesignId, wholeWallFile, type WallTeamJob } from '@/lib/wallpro-api';

const fmt = (n: unknown) => Number(Number(n).toFixed(3)).toString();
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + ' MB';
const when = (iso: string) => new Date(iso).toLocaleString();

/** The design team's WallPro production board: every customer's 150 PPI
 * panel jobs, the approved master they were cut from, and print-ready
 * downloads. Read-only: production artifacts are immutable. */
export default function AdminWallProProduction() {
  const [jobs, setJobs] = useState<WallTeamJob[] | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const rows = await listWallProductionJobsForTeam();
      setJobs(rows);
      const paths = new Set<string>();
      for (const j of rows) { for (const p of j.panels) paths.add(p.path); if (j.manifest_path) paths.add(j.manifest_path); if (j.artwork_path) paths.add(j.artwork_path); const w = wholeWallFile(j); if (w) paths.add(w.path); }
      const missing = [...paths].filter(p => !links[p]);
      if (missing.length) { const signed = await openWallAssets(missing, { download: true }); setLinks(old => ({ ...old, ...signed })); }
    } catch (e) { setError(e instanceof Error ? e.message : 'The production board could not be loaded.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  // Live jobs refresh on their own so the team sees panels land.
  useEffect(() => {
    if (!jobs?.some(j => j.status === 'queued' || j.status === 'running')) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [jobs?.map(j => j.status).join(',')]);

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 md:px-8">
    <Helmet><title>WallPro production | DesignProAI</title></Helmet>
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-violet-600">PanelPro Studio</p><h1 className="mt-1 text-2xl font-bold">WallPro production</h1><p className="mt-1 text-sm text-slate-600">Every customer's 150 PPI print panels, built on the runtime from the approved version. Download print-ready files here; nothing on this board is regenerated or edited.</p></div>
        <div className="flex gap-2"><Button variant="outline" asChild><Link to="/admin/wallpro-batch">Batch generator</Link></Button><Button variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw className={'mr-2 h-4 w-4' + (loading ? ' animate-spin' : '')} />Refresh</Button></div>
      </header>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {jobs === null && !error && <p className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Loading production jobs…</p>}
      {jobs?.length === 0 && <p className="rounded-xl border bg-white p-6 text-sm text-slate-600">No production jobs yet. A job is created the moment a customer approves a version in WallPro.</p>}
      <label className="block text-sm">Find by DesignID, project or job<input className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="DID-AEFEFBF9" value={query} onChange={e => setQuery(e.target.value)} /></label>
      {jobs?.filter(j => { const q = query.trim().toUpperCase(); return !q || wallDesignId(j.version_id).includes(q) || j.project_name.toUpperCase().includes(q) || j.id.toUpperCase().includes(q); }).map(job => {
        const r = job.request as Record<string, any>;
        const live = job.status === 'queued' || job.status === 'running';
        return <section key={job.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold"><span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-sm text-white">{wallDesignId(job.version_id)}</span> <span className="ml-2">{job.project_name}{job.version_no ? ` · V${job.version_no}` : ''}</span></h2>
              <p className="mt-1 text-xs text-slate-600">Wall {fmt(r.wallWidthIn)} × {fmt(r.wallHeightIn)} in · {r.placement}{r.placement === 'repeat' ? ` · tile ${fmt(r.repeatWidthIn)} in` : ''} · {fmt(r.panelWidthIn)}″ panels · {fmt(r.overlapIn)}″ overlap · {fmt(r.bleedIn)}″ bleed · {r.targetPpi} PPI</p>
              <p className="mt-1 text-xs text-slate-500">Job {job.id.slice(0, 8)} · customer {job.owner_id.slice(0, 8)} · requested {when(job.created_at)}{job.finished_at ? ` · finished ${when(job.finished_at)}` : ''}{job.progress?.topaz ? ` · Topaz ${job.progress.topaz}` : ''}{job.progress?.nativePpi ? ` · master ${job.progress.nativePpi} PPI native` : ''}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={'rounded-full px-3 py-1 text-xs font-semibold ' + (job.status === 'ready' ? 'bg-emerald-50 text-emerald-800' : job.status === 'failed' ? 'bg-red-50 text-red-800' : 'bg-violet-50 text-violet-800')}>{live ? `${job.status} · ${job.progress?.panelsDone || 0}/${job.progress?.panelsTotal || '?'}` : job.status}</span>
              <Button size="sm" variant="outline" asChild><Link to={'/printpro/wallpro?project=' + job.project_id}>Open in WallPro</Link></Button>
              {job.artwork_path && links[job.artwork_path] && <Button size="sm" variant="ghost" asChild><a href={links[job.artwork_path]} download rel="noopener">Approved master</a></Button>}
            </div>
          </div>
          {job.status === 'failed' && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{job.error}</p>}
          {(() => { const w = wholeWallFile(job); return w
            ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-violet-400 bg-violet-50 px-4 py-3 text-sm"><span><strong className="text-base">Print file · {wallDesignId(job.version_id)}</strong><br /><span className="text-slate-700">{w.file} · {fmt(w.widthIn)} × {fmt(w.heightIn)} in with {fmt(r.bleedIn)}″ bleed · {w.widthPx.toLocaleString()} × {w.heightPx.toLocaleString()} px · {w.ppi} PPI · {mb(w.byteSize)} · sha256 {w.sha256.slice(0, 12)}</span></span>{links[w.path] ? <Button asChild size="lg"><a href={links[w.path]} download={w.file} rel="noopener"><Download className="mr-2 h-4 w-4" />Download print file</a></Button> : <span className="text-xs text-slate-500">preparing link…</span>}</div>
            : job.status === 'ready' && job.progress?.wholeWall && 'error' in job.progress.wholeWall ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">One-file print could not be built: {job.progress.wholeWall.error}. Print from the panels.</p> : null; })()}
          {job.panels.length > 0 && <ul className="mt-3 divide-y rounded-lg border text-sm">
            {job.panels.map(p => <li key={p.number} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>Panel {p.number} · {fmt(p.widthIn)} × {fmt(p.heightIn)} in · {p.widthPx.toLocaleString()} × {p.heightPx.toLocaleString()} px · {p.ppi} PPI{p.overlapLeftIn ? ` · ${fmt(p.overlapLeftIn)}″ overlap left` : ''} · {mb(p.byteSize)} · {p.upscale?.engine === 'none' ? 'native' : 'Topaz'} · sha256 {p.sha256.slice(0, 12)}</span>
              {links[p.path] ? <Button asChild size="sm" variant="outline"><a href={links[p.path]} download={p.file} rel="noopener"><Download className="mr-1 h-3 w-3" />PNG</a></Button> : <span className="text-xs text-slate-500">preparing link…</span>}
            </li>)}
            {job.manifest_path && <li className="flex items-center justify-between px-3 py-2"><span>Manifest and install notes</span>{links[job.manifest_path] ? <Button asChild size="sm" variant="ghost"><a href={links[job.manifest_path]} download="manifest.json">JSON</a></Button> : <span className="text-xs text-slate-500">preparing link…</span>}</li>}
          </ul>}
        </section>;
      })}
    </div>
  </main>;
}
