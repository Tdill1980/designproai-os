/**
 * WallPanelPro Studio — the WallPro equivalent of the vehicle PanelPro board.
 *
 * Owner, 2026-09-12: "That's where I can instantly check if it took when they
 * time out and it's where we do back end designer QC checks and release gate
 * just like current vehicle wrap panelpro version."
 *
 * Three jobs, in that order, because that is the order the team needs them:
 *
 * 1. DID IT TAKE. The board is spined on `wallpro_generations` — the row the
 *    SERVER writes — not on projects or versions, which the CUSTOMER'S BROWSER
 *    writes after the response arrives. Listing versions would show only the
 *    designs that survived the round trip, which is exactly the set nobody
 *    needs this board for. A generation that completed with artwork and has no
 *    version is the timeout, and it is called what it is: "Took — customer
 *    never got it", with one button that gives it back to them.
 *
 * 2. DESIGNER QC. Six wall-specific checks against one immutable version, with
 *    the flat master and the customer's own brief on screen so the reviewer is
 *    judging the design against what was asked for.
 *
 * 3. THE RELEASE GATE. Released or held, append-only, signed by the reviewer.
 *    A later verdict supersedes an earlier one without erasing it.
 *
 * It is NOT a producer, for the same reason the vehicle board is not: the
 * artwork is authored by generate-wall-design and the panels are cut
 * deterministically on the runtime. Nothing here regenerates, edits or
 * re-cuts anything. The single write it makes into a customer's data is the
 * recovery, which copies no pixels — it records the row that was lost.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { CheckCircle2, Download, Loader2, RefreshCw, ShieldAlert, ShieldCheck, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  listWallStudioFeed, recoverOrphanedWallGeneration, recordWallQcReview, wallDesignId, wholeWallFile,
  type WallStudioEntry,
} from '@/lib/wallpro-api';
import {
  WALL_QC_CHECKS, OUTCOME_LABEL, OUTCOME_MEANING, canHold, canRelease, currentReview,
  generationOutcome, isRecoverable, releaseState, requiredChecks,
  type WallGenerationOutcome,
} from '@/lib/wallpro-qc';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const short = (id: string) => id.slice(0, 8);

const OUTCOME_STYLE: Record<WallGenerationOutcome, string> = {
  landed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  orphaned: 'bg-amber-50 text-amber-900 border-amber-300',
  running: 'bg-violet-50 text-violet-800 border-violet-200',
  stalled: 'bg-orange-50 text-orange-900 border-orange-300',
  failed: 'bg-red-50 text-red-800 border-red-200',
};

/** One generation, what became of it, and its QC. */
function EntryCard({ entry, onChanged }: { entry: WallStudioEntry; onChanged: () => void }) {
  const { generation: g, version } = entry;
  const outcome = generationOutcome(g, !!version);
  const input = (g.input || {}) as Record<string, any>;
  const placement = version?.placement ?? (typeof input.placement === 'string' ? input.placement : null);
  const review = currentReview(entry.reviews);
  const release = releaseState(entry.reviews);
  const whole = wholeWallFile(entry.job);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [qcOpen, setQcOpen] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');

  const needed = requiredChecks(placement);
  const releasable = canRelease(checks, placement);

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true); setError('');
    try { await action(); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : failure); }
    finally { setBusy(false); }
  }

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex flex-wrap items-center gap-2 font-semibold">
          {version
            ? <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-sm text-white">{wallDesignId(version.id)}</span>
            : <span className="rounded bg-slate-200 px-2 py-0.5 font-mono text-sm text-slate-700">no DesignID yet</span>}
          <span>{entry.projectName || g.design_name || 'Untitled wall design'}{version?.version_no ? ` · V${version.version_no}` : ''}</span>
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          {typeof input.intent === 'string' ? input.intent : 'prompt'} · wall {input.width ?? '?'} × {input.height ?? '?'} in
          {placement ? ` · ${placement}` : ''}{placement === 'repeat' && input.repeatWidthIn ? ` · tile ${input.repeatWidthIn} in` : ''}
          {g.charge_source ? ` · charged ${g.charge_source}` : ''}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Generation {short(g.id)} · customer {short(g.owner_id)} · started {when(g.created_at)}
          {g.completed_at ? ` · finished ${when(g.completed_at)}` : ''}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <span className={'rounded-full border px-3 py-1 text-xs font-semibold ' + OUTCOME_STYLE[outcome]}>
          {OUTCOME_LABEL[outcome]}
        </span>
        {version && <span className={'rounded-full px-3 py-1 text-xs font-semibold ' + (
          release === 'released' ? 'bg-emerald-600 text-white'
            : release === 'held' ? 'bg-red-600 text-white'
              : 'bg-slate-200 text-slate-700')}>
          {release === 'released' ? 'Released for print' : release === 'held' ? 'Held' : 'Not reviewed'}
        </span>}
      </div>
    </div>

    {/* What the customer is looking at right now, in one sentence. */}
    <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
      {OUTCOME_MEANING[outcome]}
    </p>
    {g.error && <p className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{g.error}</p>}
    {error && <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

    <div className="mt-3 grid gap-4 md:grid-cols-[220px_1fr]">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Flat master</div>
        {entry.artworkUrl
          ? <a href={entry.artworkUrl} target="_blank" rel="noreferrer">
              <img src={entry.artworkUrl} alt="Generated wall design" className="w-full rounded-lg border border-slate-200 bg-white object-contain" />
            </a>
          : <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-500">
              {g.state === 'working' ? 'Still generating' : 'No artwork'}
            </div>}
      </div>
      <div className="min-w-0 space-y-3">
        {/* The brief this design was judged against. A QC verdict without it is
            an opinion about a picture, not a check. */}
        {typeof input.prompt === 'string' && input.prompt.trim() && <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">What the customer asked for</div>
          <p className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{input.prompt}</p>
        </div>}

        <div className="flex flex-wrap items-center gap-2">
          {entry.artworkUrl && <Button size="sm" variant="outline" asChild>
            <a href={entry.artworkUrl} download rel="noopener"><Download className="mr-1 h-3 w-3" />Master</a>
          </Button>}
          {entry.projectId && <Button size="sm" variant="outline" asChild>
            <Link to={'/printpro/wallpro?project=' + entry.projectId}>Open in WallPro</Link>
          </Button>}
          {entry.job && <Button size="sm" variant="outline" asChild>
            <Link to="/admin/wallpro-production">Production job · {entry.job.status}</Link>
          </Button>}
          {whole && <span className="text-xs text-slate-600">Print file {whole.widthPx.toLocaleString()} × {whole.heightPx.toLocaleString()} px · {whole.ppi} PPI</span>}

          {/* THE RECOVERY. One button, on exactly the rows that need it. */}
          {isRecoverable(outcome) && <Button size="sm" disabled={busy}
            onClick={() => void run(() => recoverOrphanedWallGeneration(g.id), 'The design could not be recovered.')}>
            <LifeBuoy className="mr-1 h-4 w-4" />{busy ? 'Recovering…' : 'Give it back to the customer'}
          </Button>}
        </div>

        {/* ── Designer QC and the release gate ───────────────────────────── */}
        {version && <div className="rounded-xl border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Designer QC · release gate</span>
            <Button size="sm" variant="ghost" onClick={() => setQcOpen(o => !o)}>{qcOpen ? 'Close' : review ? 'Review again' : 'Start review'}</Button>
          </div>

          {review && <p className="mt-2 text-xs text-slate-600">
            {review.verdict === 'released' ? 'Released' : 'Held'} by {short(review.reviewer_id)} on {when(review.created_at)}
            {review.notes ? ` — ${review.notes}` : ''}
            {entry.reviews.length > 1 ? ` · ${entry.reviews.length} reviews on record` : ''}
          </p>}

          {qcOpen && <div className="mt-3 space-y-3">
            <ul className="space-y-2">
              {WALL_QC_CHECKS.map(([key, label, why]) => {
                const applies = needed.includes(key);
                return <li key={key} className={'flex gap-2 ' + (applies ? '' : 'opacity-50')}>
                  <Checkbox id={`${version.id}-${key}`} checked={!!checks[key]} disabled={!applies}
                    onCheckedChange={v => setChecks(c => ({ ...c, [key]: v === true }))} />
                  <label htmlFor={`${version.id}-${key}`} className="text-sm leading-tight">
                    <span className="font-medium">{label}</span>
                    {!applies && <span className="ml-1 text-xs text-slate-500">· not a repeating design</span>}
                    <span className="block text-xs text-slate-500">{why}</span>
                  </label>
                </li>;
              })}
            </ul>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Notes. Required to hold: say what is wrong so the next person can act on it." />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy || !releasable}
                onClick={() => void run(async () => {
                  await recordWallQcReview({ versionId: version.id, projectId: version.project_id, verdict: 'released', checks, notes });
                  setQcOpen(false); setNotes('');
                }, 'The release could not be recorded.')}>
                <ShieldCheck className="mr-1 h-4 w-4" />Release for print
              </Button>
              <Button size="sm" variant="destructive" disabled={busy || !canHold(notes)}
                onClick={() => void run(async () => {
                  await recordWallQcReview({ versionId: version.id, projectId: version.project_id, verdict: 'hold', checks, notes });
                  setQcOpen(false); setNotes('');
                }, 'The hold could not be recorded.')}>
                <ShieldAlert className="mr-1 h-4 w-4" />Hold
              </Button>
              {!releasable && <span className="text-xs text-slate-500">Every check that applies has to be ticked to release.</span>}
            </div>
          </div>}
        </div>}
      </div>
    </div>
  </section>;
}

export default function WallPanelProStudio() {
  const [entries, setEntries] = useState<WallStudioEntry[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState<'all' | 'attention'>('all');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setEntries(await listWallStudioFeed()); }
    catch (e) { setError(e instanceof Error ? e.message : 'The studio could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // Live generations refresh on their own so a design lands on screen while the
  // customer is still on the phone.
  const live = entries?.some(e => e.generation.state === 'working');
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [live, load]);

  const shown = useMemo(() => {
    const q = query.trim().toUpperCase();
    return (entries || []).filter(e => {
      const outcome = generationOutcome(e.generation, !!e.version);
      if (only === 'attention' && outcome !== 'orphaned' && outcome !== 'stalled' && outcome !== 'failed'
        && releaseState(e.reviews) !== 'held') return false;
      if (!q) return true;
      return (e.version ? wallDesignId(e.version.id) : '').includes(q)
        || e.generation.id.toUpperCase().includes(q)
        || e.generation.owner_id.toUpperCase().includes(q)
        || (e.projectName || e.generation.design_name || '').toUpperCase().includes(q);
    });
  }, [entries, query, only]);

  const counts = useMemo(() => {
    const out = { orphaned: 0, stalled: 0, failed: 0, held: 0 };
    for (const e of entries || []) {
      const outcome = generationOutcome(e.generation, !!e.version);
      if (outcome === 'orphaned') out.orphaned++;
      else if (outcome === 'stalled') out.stalled++;
      else if (outcome === 'failed') out.failed++;
      if (releaseState(e.reviews) === 'held') out.held++;
    }
    return out;
  }, [entries]);

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 md:px-8">
    <Helmet><title>WallPanelPro Studio | DesignProAI</title></Helmet>
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">WallPanelPro Studio</p>
          <h1 className="mt-1 text-2xl font-bold">Every wall generation, and what became of it</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Read off the server's own generation record, so a design that took while the customer's
            browser timed out shows here as took. Recover it, QC it, release it for print.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link to="/admin/wallpro-production">Production panels</Link></Button>
          <Button variant="outline" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={'mr-2 h-4 w-4' + (loading ? ' animate-spin' : '')} />Refresh
          </Button>
        </div>
      </header>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {entries === null && !error && <p className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Loading generations…</p>}

      {entries !== null && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
        <span className="font-semibold">{entries.length} recent</span>
        {counts.orphaned > 0 && <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">{counts.orphaned} took but never delivered</span>}
        {counts.stalled > 0 && <span className="rounded-full border border-orange-300 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-900">{counts.stalled} stalled</span>}
        {counts.failed > 0 && <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800">{counts.failed} failed</span>}
        {counts.held > 0 && <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white">{counts.held} held in QC</span>}
        {counts.orphaned + counts.stalled + counts.failed + counts.held === 0 && <span className="text-emerald-700">Nothing needs attention.</span>}
        <Button size="sm" variant={only === 'attention' ? 'default' : 'outline'} className="ml-auto"
          onClick={() => setOnly(o => (o === 'attention' ? 'all' : 'attention'))}>
          {only === 'attention' ? 'Showing what needs attention' : 'Only what needs attention'}
        </Button>
      </div>}

      <label className="block text-sm">Find by DesignID, generation, customer or project
        <input className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="DID-AEFEFBF9" value={query} onChange={e => setQuery(e.target.value)} />
      </label>

      {entries?.length === 0 && <p className="rounded-xl border bg-white p-6 text-sm text-slate-600">
        No wall generations yet. A row appears here the moment a customer presses Generate.
      </p>}
      {entries !== null && entries.length > 0 && shown.length === 0 && <p className="rounded-xl border bg-white p-6 text-sm text-slate-600">
        Nothing matches. <button className="underline" onClick={() => { setQuery(''); setOnly('all'); }}>Clear the filters</button>
      </p>}

      {shown.map(entry => <EntryCard key={entry.generation.id} entry={entry} onChanged={() => void load()} />)}

      <p className="flex items-center gap-2 pt-2 text-xs text-slate-500">
        <CheckCircle2 className="h-3 w-3" />
        Nothing on this board regenerates, edits or re-cuts artwork. Recovery records the row the
        customer's browser lost; the pixels are the ones the server already stored.
      </p>
    </div>
  </main>;
}
