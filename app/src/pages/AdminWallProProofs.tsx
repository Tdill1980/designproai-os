/**
 * THE PROOF BAND, RUN BY THE OWNER.
 *
 * Owner, 2026-09-15: "just create a container and i can place on admin side."
 *
 * Every before/after on the WePrintWraps page has so far cost a round trip
 * through a developer: files reach a session, a script normalises them, a
 * constant is hand-edited, a release ships. That is a marketing decision
 * sitting behind an engineering queue, and it is why one gym pair took a dozen
 * messages. Here the curator uploads a pair, trims it, writes its words, orders
 * it and publishes it — and the live band changes with no deploy.
 *
 * WHAT THIS PAGE REFUSES TO LET SOMEONE DO WRONG, because the band's failure
 * modes are specific and invisible until a stranger sees them:
 *
 *  - MISMATCHED SHAPES. Both halves are normalised to one canvas on upload
 *    (wallpro-proof-canvas), so a 4:3 and a 2:1 cannot end up in one wipe,
 *    which is what makes a room appear to jump and reads as two rooms.
 *  - A SOFT HALF. A thumbnail enlarged onto the canvas looks soft beside a
 *    sharp partner. The upscale factor is measured and SHOWN rather than
 *    discovered later on the live page.
 *  - A BAKED-IN CAPTION. Marketing frames often carry "BEFORE" in a corner,
 *    which collides with the band's own chip. The per-edge trim clears it from
 *    the top for a tenth of the frame instead of a quarter.
 *  - HALF A PAIR. A row needs both halves and all three texts before it can be
 *    published; the band drops any pair whose halves fail to load, so a
 *    half-finished row would silently vanish rather than warn anyone.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowDown, ArrowUp, Eye, EyeOff, Trash2, Upload, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  listWallProofsForCurator, saveWallProof, deleteWallProof, reorderWallProofs,
  uploadWallProofImage, wallProofUrl, wallUser, type WallProofRow,
} from '@/lib/wallpro-api';
import {
  normalizeProofImage, upscaleFactor, PROOF_CANVAS, PROOF_ASPECT, SOFT_BELOW,
  type ProofTrim,
} from '@/lib/wallpro-proof-canvas';

const BRAND = 'weprintwraps';
const field = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950';

type Half = { file: File; natural: { width: number; height: number }; preview: string };

function useHalf() {
  const [half, setHalf] = useState<Half | null>(null);
  const take = useCallback(async (file: File | undefined) => {
    if (!file) return;
    const bitmap = await createImageBitmap(file);
    setHalf({ file, natural: { width: bitmap.width, height: bitmap.height }, preview: URL.createObjectURL(file) });
    bitmap.close?.();
  }, []);
  return [half, take, setHalf] as const;
}

export default function AdminWallProProofs() {
  const [rows, setRows] = useState<WallProofRow[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [before, takeBefore, setBefore] = useHalf();
  const [after, takeAfter, setAfter] = useHalf();
  const [trim, setTrim] = useState<ProofTrim>({ top: 0, bottom: 0 });
  const [headline, setHeadline] = useState('');
  const [caption, setCaption] = useState('');
  const [alt, setAlt] = useState('');
  const beforeInput = useRef<HTMLInputElement>(null);
  const afterInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setRows(await listWallProofsForCurator(BRAND)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not read the band.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError('');
    try { await action(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'That did not work.'); }
    finally { setBusy(''); }
  }

  const ready = before && after && headline.trim() && caption.trim() && alt.trim();

  function add() {
    if (!ready) return;
    void run('Adding the pair', async () => {
      await wallUser(); // a curator action needs a real session, not a silent failure
      // BOTH halves take the IDENTICAL trim. What has to match is the treatment
      // of the two halves; trimming one and not the other is how a pair starts
      // sliding under the wipe.
      const [beforePath, afterPath] = await Promise.all([
        normalizeProofImage(before!.file, trim).then(b => uploadWallProofImage(b, 'before')),
        normalizeProofImage(after!.file, trim).then(b => uploadWallProofImage(b, 'after')),
      ]);
      await saveWallProof({
        brand: BRAND, before_path: beforePath, after_path: afterPath,
        headline: headline.trim(), caption: caption.trim(), alt: alt.trim(),
        // New pairs land at the end; the curator moves them up deliberately
        // rather than having the newest silently take the lead slide.
        position: rows.length, published: false,
      });
      setBefore(null); setAfter(null); setHeadline(''); setCaption(''); setAlt('');
      setTrim({ top: 0, bottom: 0 });
      if (beforeInput.current) beforeInput.current.value = '';
      if (afterInput.current) afterInput.current.value = '';
    });
  }

  function move(index: number, by: number) {
    const next = [...rows];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next);
    void run('Reordering', () => reorderWallProofs(next.map((r, i) => ({ id: r.id, position: i }))));
  }

  const softness = (half: Half | null) => {
    if (!half) return null;
    const factor = upscaleFactor(half.natural, trim);
    return factor > 1 / SOFT_BELOW ? factor : null;
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 md:px-8">
      <div className="mx-auto max-w-5xl">
        <Link to="/wall-wrap" className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:underline">
          <ArrowLeft className="h-4 w-4" />The WallPro page
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Before &amp; after band</h1>
        <p className="mt-2 max-w-[65ch] text-sm text-slate-600">
          The rotating proof under the header on <code className="rounded bg-slate-200 px-1">/wall-wrap</code>.
          Published pairs show in this order, top first — and the first one is what
          most visitors see, so lead with the most persuasive room. Changes are live
          immediately; there is no deploy.
        </p>

        {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

        {/* ── Add a pair ─────────────────────────────────────────────── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Add a pair</h2>
          <p className="mt-1 text-sm text-slate-600">
            The same room photographed twice from one camera position: bare, then
            wrapped. Both are cropped to {PROOF_CANVAS.width}×{PROOF_CANVAS.height} on
            upload so they sit in register.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {([['before', before, takeBefore, beforeInput], ['after', after, takeAfter, afterInput]] as const).map(
              ([key, half, take, ref]) => (
                <div key={key}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{key}</p>
                  <input ref={ref} type="file" accept="image/*" className="sr-only"
                    onChange={e => void take(e.target.files?.[0])} />
                  <Button variant="outline" className="mt-1.5 w-full justify-center" disabled={!!busy}
                    onClick={() => ref.current?.click()}>
                    <Upload className="mr-2 h-4 w-4" />{half ? 'Replace' : `Choose the ${key}`}
                  </Button>
                  {half && (
                    <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-900"
                      style={{ aspectRatio: String(PROOF_ASPECT) }}>
                      {/* Previewed with the SAME cover fit and trim the upload will
                          apply, so what the curator approves is what ships. */}
                      <img src={half.preview} alt="" className="h-full w-full object-cover"
                        style={{ objectPosition: `50% ${trim.top + trim.bottom > 0
                          ? (trim.top / Math.max(0.0001, trim.top + trim.bottom)) * 100 : 50}%` }} />
                    </div>
                  )}
                  {half && <p className="mt-1 text-xs text-slate-500">{half.natural.width}×{half.natural.height}</p>}
                  {softness(half) && (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      Enlarged {softness(half)!.toFixed(1)}× — this will look soft next to a sharp partner.
                      Use the full-size original if you have it.
                    </p>
                  )}
                </div>
              ))}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {(['top', 'bottom'] as const).map(edge => (
              <label key={edge} className="block text-sm">
                Trim {edge} — {trim[edge]}%
                <Slider className="mt-2" min={0} max={30} step={1} value={[trim[edge]]}
                  onValueChange={([v]) => setTrim(t => ({ ...t, [edge]: v }))} />
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Trim is applied identically to both halves, so they stay in register. Use
            the top trim to cut a caption baked into a photo — it costs far less of
            the picture than cropping both edges evenly.
          </p>

          <div className="mt-5 grid gap-3">
            <label className="block text-sm">Headline
              <input className={field} maxLength={60} value={headline} placeholder="A training floor, transformed."
                onChange={e => setHeadline(e.target.value)} /></label>
            <label className="block text-sm">Caption
              <input className={field} maxLength={140} value={caption} placeholder="A gym wall in a full-height athletic mural. Drag to compare."
                onChange={e => setCaption(e.target.value)} /></label>
            <label className="block text-sm">Alt text — what a screen reader says
              <input className={field} maxLength={220} value={alt} placeholder="A gym photographed with a plain grey wall, and again with a full-wall athletic mural"
                onChange={e => setAlt(e.target.value)} /></label>
          </div>

          <Button className="mt-4" disabled={!ready || !!busy} onClick={add}>
            {busy === 'Adding the pair' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Add as a draft
          </Button>
          {!ready && <p className="mt-2 text-xs text-slate-500">Both images and all three lines are needed — a pair missing a half is dropped by the band without saying so.</p>}
        </section>

        {/* ── The band ───────────────────────────────────────────────── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">The band <span className="text-sm font-normal text-slate-500">({rows.filter(r => r.published).length} published)</span></h2>
          {!rows.length && (
            <p className="mt-3 text-sm text-slate-600">
              Nothing here yet. Until a pair is published the page shows the built-in
              examples that ship with the release, so the band is never empty.
            </p>
          )}
          <div className="mt-4 space-y-3">
            {rows.map((row, i) => (
              <div key={row.id} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${row.published ? 'border-slate-200' : 'border-dashed border-slate-300 bg-slate-50'}`}>
                <div className="flex shrink-0 gap-1">
                  {[row.before_path, row.after_path].map(p => (
                    <img key={p} src={wallProofUrl(p)} alt="" className="h-14 w-24 rounded object-cover" />
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{row.headline}</p>
                  <p className="truncate text-xs text-slate-500">{row.caption}</p>
                  {!row.published && <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700">Draft — not shown</p>}
                  {i === 0 && row.published && <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Lead slide</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" disabled={!!busy || i === 0} title="Move up" onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" disabled={!!busy || i === rows.length - 1} title="Move down" onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="sm" variant="outline" disabled={!!busy}
                    onClick={() => void run(row.published ? 'Unpublishing' : 'Publishing', () => saveWallProof({ id: row.id, published: !row.published }).then(() => undefined))}>
                    {row.published ? <><EyeOff className="mr-1.5 h-4 w-4" />Hide</> : <><Eye className="mr-1.5 h-4 w-4" />Publish</>}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-700 hover:text-red-800" disabled={!!busy}
                    title="Remove from the band"
                    onClick={() => { if (window.confirm(`Remove "${row.headline}" from the band?`)) void run('Removing', () => deleteWallProof(row.id)); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
