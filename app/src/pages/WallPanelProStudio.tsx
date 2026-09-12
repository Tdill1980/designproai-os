/**
 * WallPanelProStudio — WallPro's own production control room.
 *
 * Owner, 2026-09-12: "That's where I can instantly check if it took when they
 * time out and it's where we do back end designer QC checks and release gate
 * just like current vehicle wrap panelpro version." Then: "We already create
 * design id, version history and show up in RevisionStudioIQ so mirror what
 * would work to give wallpro its own wallpanelprostudio."
 *
 * So it mirrors, it does not invent. The vehicle board
 * (pages/designpro/PanelProStudioBoard.tsx) is one job with a VERSION RAIL
 * inside it, where selecting a version scopes the whole workspace so V1's
 * assets can never sit beside V2's. WallPro's equivalent of that job is the
 * PROJECT, and its rail is `wallpro_design_versions` — the same immutable
 * V1..Vn, the same DesignID (DID-XXXXXXXX), the same rows RevisionStudioIQ
 * already lists. One lineage, published twice; never reconstructed twice
 * (RULE 0.27).
 *
 * Two screens:
 *   INDEX   every design by DesignID, plus the RECOVERY lane — generations that
 *           completed and never became a version, which is the timeout.
 *   DESIGN  one project: version rail, then for the selected version the FLAT
 *           MASTER beside its PRINT FILES, the brief it was judged against,
 *           designer QC and the release gate.
 *
 * NOT a producer, for the reason the vehicle board is not: the artwork is
 * authored by generate-wall-design and the panels are cut deterministically on
 * the runtime. Nothing here regenerates, edits or re-cuts. The one write it
 * makes into a customer's data is the recovery, which copies no pixels — it
 * records the row their browser lost.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, FileJson, LifeBuoy, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  loadWallPanelProStudio, openWallPrintFiles, recordWallQcReview, recoverOrphanedWallGeneration,
  releaseWallProductionJob, wallPanelFiles, wholeWallFile,
} from '@/lib/wallpro-api';
import {
  STAGE_LABEL, deliveryState, jobIsStale, panelHealth, panelMap, validationHoursLeft, versionStage,
  wallForensicRecord, WALL_TARGET_PPI, WALL_VALIDATION_HOURS,
  type WallPanelProStudio as StudioModel, type WallStudioProjectRecord, type WallStudioVersionRecord,
} from '@/lib/wallpro-panelpro';
import {
  OUTCOME_MEANING, WALL_QC_CHECKS, canHold, canRelease, currentReview, requiredChecks,
} from '@/lib/wallpro-qc';

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
/** `2026-09-12 20:43:16Z` — the exact moment, as the vehicle board records it. */
const exact = (iso: string | null | undefined) => {
  const parsed = Date.parse(String(iso || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '—';
};
const short = (id: string) => id.slice(0, 8);
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + ' MB';
const num = (n: unknown) => Number(Number(n).toFixed(3)).toString();

const STAGE_STYLE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  approved: 'bg-violet-50 text-violet-800 border-violet-200',
  building: 'bg-violet-50 text-violet-800 border-violet-200',
  'panels-ready': 'bg-sky-50 text-sky-800 border-sky-200',
  'build-failed': 'bg-red-50 text-red-800 border-red-200',
  held: 'bg-red-600 text-white border-red-700',
  released: 'bg-emerald-600 text-white border-emerald-700',
};

function StagePill({ record }: { record: WallStudioVersionRecord }) {
  const stage = versionStage(record);
  return <span className={'rounded-full border px-3 py-1 text-xs font-semibold ' + STAGE_STYLE[stage]}>{STAGE_LABEL[stage]}</span>;
}

/* ══ INDEX ════════════════════════════════════════════════════════════════ */

function StudioIndex({ studio, loading, onReload }: { studio: StudioModel; loading: boolean; onReload: () => void }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const designs = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return studio.designs;
    return studio.designs.filter(d =>
      d.designId.includes(q) || d.projectName.toUpperCase().includes(q)
      || d.projectId.toUpperCase().includes(q) || d.ownerId.toUpperCase().includes(q)
      || d.versions.some(v => v.designId.includes(q)));
  }, [studio.designs, query]);

  async function recover(generationId: string) {
    setBusy(generationId); setError('');
    try {
      const result = await recoverOrphanedWallGeneration(generationId);
      onReload();
      navigate('/wallpanelprostudio/' + result.version.project_id);
    } catch (e) { setError(e instanceof Error ? e.message : 'The design could not be recovered.'); }
    finally { setBusy(''); }
  }

  return <>
    {/* THE RECOVERY LANE. First on the page, because a design that took and was
        never delivered is the most expensive thing on this board: it was paid
        for, it exists, and the customer believes it failed. */}
    {studio.orphans.length > 0 && <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
      <h2 className="text-lg font-bold text-amber-900">
        {studio.orphans.length} {studio.orphans.length === 1 ? 'design' : 'designs'} took, and the customer never got {studio.orphans.length === 1 ? 'it' : 'them'}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-amber-900">{OUTCOME_MEANING.orphaned}</p>
      {error && <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <ul className="mt-3 space-y-2">
        {studio.orphans.map(({ generation: g, artworkUrl }) => <li key={g.id}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-white p-3">
          {artworkUrl
            ? <img src={artworkUrl} alt="" className="h-16 w-16 rounded border border-slate-200 object-cover" />
            : <div className="h-16 w-16 rounded border border-dashed border-slate-300" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{g.design_name || 'Untitled wall design'}</p>
            <p className="text-xs text-slate-600">
              {String((g.input as any)?.intent || 'prompt')} · wall {String((g.input as any)?.width ?? '?')} × {String((g.input as any)?.height ?? '?')} in
              {g.charge_source ? ` · charged ${g.charge_source}` : ''}
            </p>
            <p className="text-xs text-slate-500">Generation {short(g.id)} · customer {short(g.owner_id)} · {exact(g.created_at)}</p>
          </div>
          <Button size="sm" disabled={busy === g.id} onClick={() => void recover(g.id)}>
            <LifeBuoy className="mr-1 h-4 w-4" />{busy === g.id ? 'Recovering…' : 'Give it back'}
          </Button>
        </li>)}
      </ul>
    </section>}

    <label className="block text-sm">Find by DesignID, project, customer
      <input className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        placeholder="DID-AEFEFBF9" value={query} onChange={e => setQuery(e.target.value)} />
    </label>

    {!loading && studio.designs.length === 0 && studio.orphans.length === 0 &&
      <p className="rounded-xl border bg-white p-6 text-sm text-slate-600">
        No wall designs yet. A design appears here under its DesignID as soon as a customer generates one.
      </p>}

    <div className="space-y-3">
      {designs.map(design => {
        const newest = design.versions[design.versions.length - 1];
        const approved = design.versions.find(v => v.version.id === design.approvedVersionId);
        const head = approved || newest;
        return <Link key={design.projectId} to={'/wallpanelprostudio/' + design.projectId}
          className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-violet-400 hover:shadow">
          {head.artworkUrl
            ? <img src={head.artworkUrl} alt="" className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
            : <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-slate-300 text-[10px] text-slate-500">no master</div>}
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-semibold">
              <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-sm text-white">{design.designId}</span>
              <span className="truncate">{design.projectName}</span>
            </p>
            <p className="mt-1 text-xs text-slate-600">
              {design.versions.length} {design.versions.length === 1 ? 'version' : 'versions'}
              {' · '}customer {short(design.ownerId)}{' · '}updated {when(design.updatedAt)}
            </p>
            {/* The whole rail at a glance, never only the newest (RULE 0.22). */}
            <p className="mt-1 flex flex-wrap gap-1">
              {design.versions.map(v => <span key={v.version.id}
                className={'rounded px-1.5 py-0.5 font-mono text-[10px] ' + (
                  v.release === 'released' ? 'bg-emerald-100 text-emerald-800'
                    : v.release === 'held' ? 'bg-red-100 text-red-800'
                      : v.version.status === 'approved' ? 'bg-violet-100 text-violet-800'
                        : 'bg-slate-100 text-slate-600')}>V{v.version.version_no}</span>)}
            </p>
          </div>
          <StagePill record={head} />
        </Link>;
      })}
    </div>
  </>;
}

/* ══ ONE DESIGN ═══════════════════════════════════════════════════════════ */

function PrintFiles({ record }: { record: WallStudioVersionRecord }) {
  const job = record.job;
  const [links, setLinks] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    if (!job || job.status !== 'ready') { setLinks({}); return; }
    void openWallPrintFiles(job).then(next => { if (live) setLinks(next); }).catch(() => {});
    return () => { live = false; };
  }, [job?.id, job?.status]);

  if (!job) return <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
    No print files. Panels are built on the runtime from the APPROVED version — a missing build is server work, never a file dropped in here.
  </div>;
  if (job.status === 'failed') return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
    <strong className="block">The panel build failed.</strong>{job.error}
  </div>;
  if (job.status !== 'ready') return <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">
    <Loader2 className="h-4 w-4 animate-spin" />
    Building panels · {job.progress?.panelsDone || 0}/{job.progress?.panelsTotal || '?'}
    {job.progress?.topaz ? ` · Topaz ${job.progress.topaz}` : ''}
  </div>;

  const whole = wholeWallFile(job);
  const health = panelHealth(job);
  const request = job.request as Record<string, any>;
  const stale = jobIsStale(record);
  const map = panelMap(job);

  return <div className="space-y-3">
    {stale && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      These files were built before this version's current approval. Re-request production before releasing them.
    </p>}

    {/* PANELIZATION, as the job actually cut it (owner, 2026-09-12: "make sure
        specs show 1/2\u201d overlap lets show panelization there"). Drawn from
        each panel's own stamped xIn / widthIn / overlapLeftIn, never re-derived
        from the wall inches in the browser -- a second set of numbers would
        agree with the first only by luck, and a reviewer holding the wrong one
        cannot tell. The overlap figure is read off a real panel rather than off
        the request: the request says what was asked for, the panel says what
        was cut, and QC cares about what was cut. */}
    {map && <div className="rounded-xl border border-slate-300 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Panelization</span>
        <span className="text-xs font-semibold">
          {map.entries.length} {map.entries.length === 1 ? 'panel' : 'panels'} · {map.seams} {map.seams === 1 ? 'seam' : 'seams'} · {num(map.totalWidthIn)}″ total with bleed
        </span>
      </div>
      {/* Every panel to scale across the printed width, with its duplicated
          overlap band hatched on the left edge where it meets its neighbour. */}
      <div className="relative h-20 w-full overflow-hidden rounded-lg border border-slate-300 bg-slate-100">
        {map.entries.map(entry => <div key={entry.number}
          className="absolute inset-y-0 border-r-2 border-dashed border-violet-500/70 bg-violet-500/10"
          style={{ left: `${entry.leftPct}%`, width: `${entry.widthPct}%` }}>
          {entry.overlapPct > 0 && <div className="absolute inset-y-0 left-0 bg-amber-400/45"
            style={{ width: `${entry.overlapPct}%` }} title={`${num(entry.overlapLeftIn)}″ duplicated overlap`} />}
          <span className="absolute inset-x-0 top-1 text-center text-[10px] font-bold text-slate-700">P{entry.number}</span>
          <span className="absolute inset-x-0 bottom-1 text-center text-[9px] text-slate-600">{num(entry.widthIn)}″</span>
        </div>)}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-amber-400/70" />{num(map.overlapIn)}″ duplicated overlap at every seam</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm border-r-2 border-dashed border-violet-500 bg-violet-500/10" />panel edge</span>
        <span>{num(map.bleedIn)}″ perimeter bleed</span>
      </p>
      <p className="mt-1 text-[11px] text-slate-500">
        Adjacent panels carry the SAME artwork through the overlap. Align the duplicate image at install; never stretch it.
      </p>
      {/* The spec the shop prints to, stated where QC signs it off. */}
      <ul className="mt-2 grid gap-x-4 gap-y-1 text-[11px] text-slate-600 sm:grid-cols-2">
        <li><strong>Roll width</strong> {num(map.panelWidthIn)}″ · Avery HP MPI 2610 wall vinyl, matte/luster</li>
        <li><strong>Overlap</strong> {num(map.overlapIn)}″ duplicated, identical on both panels</li>
        <li><strong>Bleed</strong> {num(map.bleedIn)}″ on the wall perimeter only, never at a seam</li>
        <li><strong>Resolution</strong> {map.targetPpi} PPI at the stated inches, per panel</li>
      </ul>
    </div>}

    {/* Measured, not assumed: every figure is one the runtime stamped. */}
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-4">
      <div><dt className="text-slate-500">Wall</dt><dd className="font-mono font-semibold">{num(request.wallWidthIn)}″ × {num(request.wallHeightIn)}″</dd></div>
      <div><dt className="text-slate-500">Panels</dt><dd className="font-mono font-semibold">{health?.panelCount ?? 0} × {num(request.panelWidthIn)}″ · {num(request.overlapIn)}″ overlap</dd></div>
      <div>
        <dt className="text-slate-500">Lowest panel PPI</dt>
        <dd className={'font-mono font-semibold ' + (health?.meetsTarget ? '' : 'text-amber-700')}>
          {health?.minPpi ?? '—'} <span className="font-sans font-normal text-slate-500">/ {WALL_TARGET_PPI} target</span>
        </dd>
      </div>
      <div><dt className="text-slate-500">Bleed</dt><dd className="font-mono font-semibold">{num(request.bleedIn)}″</dd></div>
    </dl>
    {health && health.nativePanels > 0 && <p className="text-xs text-amber-700">
      {health.nativePanels} of {health.panelCount} panels are native pixels — Topaz did not run on them.
    </p>}

    {/* THE PRINT FILE IS ONE FILE; the panels are the fallback for a RIP that
        cannot tile. Same order the production board uses. */}
    {whole && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-violet-400 bg-violet-50 px-4 py-3 text-sm">
      <span>
        <strong className="text-base">Print file · {record.designId}</strong><br />
        <span className="text-slate-700">
          {whole.file} · {num(whole.widthIn)} × {num(whole.heightIn)} in with bleed · {whole.widthPx.toLocaleString()} × {whole.heightPx.toLocaleString()} px · {whole.ppi} PPI · {mb(whole.byteSize)} · sha256 {whole.sha256.slice(0, 12)}
        </span>
      </span>
      {links[whole.path]
        ? <Button asChild size="lg"><a href={links[whole.path]} download={whole.file} rel="noopener"><Download className="mr-2 h-4 w-4" />Download print file</a></Button>
        : <span className="text-xs text-slate-500">preparing link…</span>}
    </div>}

    <ul className="divide-y rounded-lg border text-sm">
      {job.panels.map(panel => <li key={panel.number} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span>
          Panel {panel.number} · {num(panel.widthIn)} × {num(panel.heightIn)} in · {panel.widthPx.toLocaleString()} × {panel.heightPx.toLocaleString()} px · {panel.ppi} PPI
          {panel.overlapLeftIn ? ` · ${num(panel.overlapLeftIn)}″ overlap left` : ''} · {panel.upscale?.engine === 'none' ? 'native' : 'Topaz'} · sha256 {panel.sha256.slice(0, 12)}
        </span>
        <span className="flex gap-1">
          {wallPanelFiles(panel).map(file => file.path && links[file.path]
            ? <Button key={file.format} asChild size="sm" variant="outline">
                <a href={links[file.path]} download={file.file} rel="noopener">{file.format.toUpperCase()}</a>
              </Button>
            : <span key={file.format} className="text-xs text-slate-400">{file.format.toUpperCase()}</span>)}
        </span>
      </li>)}
      {job.manifest_path && <li className="flex items-center justify-between px-3 py-2">
        <span>Manifest and install notes</span>
        {links[job.manifest_path]
          ? <Button asChild size="sm" variant="ghost"><a href={links[job.manifest_path]} download="manifest.json">JSON</a></Button>
          : <span className="text-xs text-slate-500">preparing link…</span>}
      </li>}
    </ul>
  </div>;
}

function QcGate({ design, record, onChanged }: { design: WallStudioProjectRecord; record: WallStudioVersionRecord; onChanged: () => void }) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true); setError('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : failure); }
    finally { setBusy(false); }
  }
  // A new version is a new judgement: never carry the last one's ticks over.
  useEffect(() => { setChecks({}); setNotes(''); setError(''); }, [record.version.id]);

  const placement = record.version.placement;
  const needed = requiredChecks(placement);
  const review = currentReview(record.reviews);

  async function submit(verdict: 'released' | 'hold') {
    setBusy(true); setError('');
    try {
      await recordWallQcReview({ versionId: record.version.id, projectId: design.projectId, verdict, checks, notes });
      setChecks({}); setNotes(''); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'The review could not be recorded.'); }
    finally { setBusy(false); }
  }

  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">Designer QC · release gate</h3>
      <StagePill record={record} />
    </div>
    <p className="mt-1 text-xs text-slate-600">
      Released is what says this version may print. Every review is kept — a later verdict supersedes an earlier one without erasing it.
    </p>

    {review && <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <strong>{review.verdict === 'released' ? 'Released' : 'Held'}</strong> by {short(review.reviewer_id)} on {when(review.created_at)}
      {review.notes ? ` — ${review.notes}` : ''}
      {record.reviews.length > 1 ? ` · ${record.reviews.length} reviews on record` : ''}
    </p>}

    <ul className="mt-3 space-y-2">
      {WALL_QC_CHECKS.map(([key, label, why]) => {
        const applies = needed.includes(key);
        return <li key={key} className={'flex gap-2 ' + (applies ? '' : 'opacity-50')}>
          <Checkbox id={`${record.version.id}-${key}`} checked={!!checks[key]} disabled={!applies}
            onCheckedChange={v => setChecks(c => ({ ...c, [key]: v === true }))} />
          <label htmlFor={`${record.version.id}-${key}`} className="text-sm leading-tight">
            <span className="font-medium">{label}</span>
            {!applies && <span className="ml-1 text-xs text-slate-500">· not a repeating design</span>}
            <span className="block text-xs text-slate-500">{why}</span>
          </label>
        </li>;
      })}
    </ul>
    <Textarea className="mt-3" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
      placeholder="Notes. Required to hold: say what is wrong so the next person can act on it." />
    {error && <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={busy || !canRelease(checks, placement)} onClick={() => void submit('released')}>
        <ShieldCheck className="mr-1 h-4 w-4" />Release for print
      </Button>
      <Button size="sm" variant="destructive" disabled={busy || !canHold(notes)} onClick={() => void submit('hold')}>
        <ShieldAlert className="mr-1 h-4 w-4" />Hold
      </Button>
      {!canRelease(checks, placement) && <span className="text-xs text-slate-500">Every check that applies has to be ticked to release.</span>}
    </div>

    {/* THE HANDOVER. Separate from the verdict on purpose: the QC review says
        the DESIGN passed, this says the cut PANELS were checked against it and
        may go to the customer. Until it is pressed the customer cannot read
        the files at all -- 20260912240000 enforces that in storage, so this is
        a gate rather than a label (owner, 2026-09-12: "we can't risk going
        100% ai"). The RPC refuses unless a release verdict is already on
        record, so the two cannot drift apart. */}
    {record.job && record.job.status === 'ready' && <div className="mt-4 border-t border-slate-200 pt-3">
      {deliveryState(record.job) === 'released'
        ? <p className="text-sm font-semibold text-emerald-700">
            Released to the customer{record.job.released_at ? ` on ${when(record.job.released_at)}` : ''}
            {record.job.released_by ? ` by ${short(record.job.released_by)}` : ''}.
          </p>
        : <div className="space-y-2">
            <p className="text-sm">
              <strong>The customer cannot download these panels yet.</strong>{' '}
              {(() => { const left = validationHoursLeft(record.job); return left === null
                ? `They are inside the ${WALL_VALIDATION_HOURS}-hour validation window.`
                : `${left} ${left === 1 ? 'hour' : 'hours'} left of the ${WALL_VALIDATION_HOURS}-hour window they were promised.`; })()}
            </p>
            <p className="text-xs text-slate-600">
              Check the panel map, the {'\u00bd'}″ overlap at every seam and the resolution against the wall
              measurements before releasing. If anything is wrong, hold the version instead and fix or
              rebuild — nothing reaches the customer while it is held.
            </p>
            <Button size="sm" disabled={busy || record.release !== 'released'}
              title={record.release === 'released' ? undefined : 'Record a QC release for this version first.'}
              onClick={() => void run(async () => { await releaseWallProductionJob(record.job!.id, notes); onChanged(); }, 'The panels could not be released.')}>
              <ShieldCheck className="mr-1 h-4 w-4" />Release panels to the customer
            </Button>
            {record.release !== 'released' && <p className="text-xs text-slate-500">Tick the checks and press Release for print first — the handover needs a verdict on record.</p>}
          </div>}
    </div>}
  </div>;
}

function DesignBoard({ design, onChanged }: { design: WallStudioProjectRecord; onChanged: () => void }) {
  // Newest by default, which is what the team opens the board to look at.
  const [selectedId, setSelectedId] = useState(design.versions[design.versions.length - 1].version.id);
  useEffect(() => {
    if (!design.versions.some(v => v.version.id === selectedId)) {
      setSelectedId(design.versions[design.versions.length - 1].version.id);
    }
  }, [design.versions, selectedId]);
  const record = design.versions.find(v => v.version.id === selectedId) || design.versions[design.versions.length - 1];
  const forensicHref = useMemo(
    () => 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(wallForensicRecord(design, record), null, 2)),
    [design, record]);

  return <>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Link to="/wallpanelprostudio" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-3.5 w-3.5" />All wall designs
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
          <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-lg text-white">{design.designId}</span>
          <span className="truncate">{design.projectName}</span>
        </h1>
        <p className="mt-1 text-xs text-slate-600">
          Project {short(design.projectId)} · customer {short(design.ownerId)} · created {when(design.createdAt)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" asChild>
          <Link to={'/printpro/wallpro?project=' + design.projectId}>Open in WallPro</Link>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <a href={forensicHref} download={`${record.designId}-wallpro-record.json`}><FileJson className="mr-1 h-4 w-4" />Record</a>
        </Button>
      </div>
    </header>

    {/* THE VERSION RAIL. V1, V2, V3… all inspectable, never only the newest
        (RULE 0.22). Selecting one scopes everything below it. */}
    <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-3">
      {design.versions.map(v => {
        const on = v.version.id === record.version.id;
        return <button key={v.version.id} type="button" onClick={() => setSelectedId(v.version.id)}
          className={'flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition ' + (
            on ? 'border-violet-500 bg-violet-50' : 'border-slate-200 hover:border-slate-400')}>
          {v.artworkUrl
            ? <img src={v.artworkUrl} alt="" className="h-10 w-10 rounded border border-slate-200 object-cover" />
            : <div className="h-10 w-10 rounded border border-dashed border-slate-300" />}
          <span className="text-xs">
            <span className="block font-bold">V{v.version.version_no}{v.version.status === 'approved' ? ' · approved' : ''}</span>
            <span className="block font-mono text-[10px] text-slate-500">{v.designId}</span>
            <span className="block text-[10px] text-slate-500">{v.version.kind}</span>
          </span>
        </button>;
      })}
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      {/* FLAT MASTER — the print truth. The wall's answer to the vehicle
          board's REAL DESIGN PROOF. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Flat master · V{record.version.version_no}</h3>
          <StagePill record={record} />
        </div>
        {record.artworkUrl
          ? <a href={record.artworkUrl} target="_blank" rel="noreferrer">
              <img src={record.artworkUrl} alt={`V${record.version.version_no} master`}
                className="mt-3 w-full rounded-lg border border-slate-200 bg-white object-contain" />
            </a>
          : <div className="mt-3 flex aspect-video items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-500">
              The master could not be signed
            </div>}
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div><dt className="text-slate-500">Placement</dt><dd className="font-semibold">{record.version.placement}{record.version.repeat_width_in ? ` · tile ${num(record.version.repeat_width_in)}″` : ''}</dd></div>
          <div><dt className="text-slate-500">Master pixels</dt><dd className="font-mono font-semibold">{record.version.width_px && record.version.height_px ? `${record.version.width_px} × ${record.version.height_px}` : '—'}</dd></div>
          <div><dt className="text-slate-500">Authored</dt><dd className="font-mono">{exact(record.version.created_at)}</dd></div>
          <div><dt className="text-slate-500">Approved</dt><dd className="font-mono">{record.version.approved_at ? exact(record.version.approved_at) : '—'}</dd></div>
          <div className="col-span-2"><dt className="text-slate-500">sha256</dt><dd className="truncate font-mono">{record.version.sha256 || '—'}</dd></div>
        </dl>
        {record.artworkUrl && <Button className="mt-3" size="sm" variant="outline" asChild>
          <a href={record.artworkUrl} download rel="noopener"><Download className="mr-1 h-4 w-4" />Download master</a>
        </Button>}

        {/* The brief this version is judged against. A QC verdict without it is
            an opinion about a picture. */}
        {(record.version.prompt || record.generation) && <div className="mt-4 border-t border-slate-200 pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">What the customer asked for</div>
          <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            {record.version.prompt || String((record.generation?.input as any)?.prompt || '') || 'No brief recorded for this version.'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {record.version.intent ? `intent ${record.version.intent} · ` : ''}kind {record.version.kind}
            {record.version.generation_id ? ` · generation ${short(record.version.generation_id)}` : ''}
            {record.generation?.charge_source ? ` · charged ${record.generation.charge_source}` : ''}
          </p>
        </div>}
      </section>

      {/* PRINT FILES — what actually prints. The wall's answer to PRINT PANEL. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold">Print files · V{record.version.version_no}</h3>
        <p className="mt-1 text-xs text-slate-600">
          Cut on the runtime from the approved master. Nothing here is regenerated or edited.
        </p>
        <div className="mt-3"><PrintFiles record={record} /></div>
      </section>
    </div>

    <QcGate design={design} record={record} onChanged={onChanged} />
  </>;
}

/* ══ PAGE ═════════════════════════════════════════════════════════════════ */

export default function WallPanelProStudio() {
  const { projectId } = useParams();
  const [studio, setStudio] = useState<StudioModel | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setStudio(await loadWallPanelProStudio()); }
    catch (e) { setError(e instanceof Error ? e.message : 'WallPanelProStudio could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // A build in flight refreshes on its own so panels land on screen while the
  // customer is still on the phone.
  const live = studio?.designs.some(d => d.versions.some(v => v.job && (v.job.status === 'queued' || v.job.status === 'running')))
    || studio?.designs.some(d => d.versions.some(v => v.generation?.state === 'working'));
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [live, load]);

  const design = projectId && studio ? studio.designs.find(d => d.projectId === projectId) : undefined;

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 md:px-8">
    <Helmet><title>WallPanelProStudio | DesignProAI</title></Helmet>
    <div className="mx-auto max-w-5xl space-y-5">
      {!projectId && <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">WallPanelProStudio</p>
          <h1 className="mt-1 text-2xl font-bold">Every wall design, by DesignID</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            The same DesignID and version history RevisionStudioIQ shows, with the print files,
            designer QC and the release gate beside them — plus the designs that took while the
            customer's browser timed out.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link to="/admin/wallpro-production">Production jobs</Link></Button>
          <Button variant="outline" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={'mr-2 h-4 w-4' + (loading ? ' animate-spin' : '')} />Refresh
          </Button>
        </div>
      </header>}

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {!studio && !error && <p className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Loading wall designs…</p>}

      {studio && projectId && !design && <p className="rounded-xl border bg-white p-6 text-sm text-slate-600">
        That design is not on this board. <Link className="underline" to="/wallpanelprostudio">Back to all wall designs</Link>
      </p>}
      {studio && projectId && design && <DesignBoard design={design} onChanged={() => void load()} />}
      {studio && !projectId && <StudioIndex studio={studio} loading={loading} onReload={() => void load()} />}

      <p className="pt-2 text-xs text-slate-500">
        Nothing on this board regenerates, edits or re-cuts artwork. Recovery records the row the
        customer's browser lost; the pixels are the ones the server already stored.
      </p>
    </div>
  </main>;
}
