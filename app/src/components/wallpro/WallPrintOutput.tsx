import { useEffect, useRef, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { loadWallImage } from '@/lib/wallpro-render';
import { openWallAsset, type WallAsset } from '@/lib/wallpro-api';
import { wallPrintPreflight, type WallPrintSettings } from '@/lib/wallpro-print-plan';
import type { WallLayout } from '@/lib/wallpro-geometry';
import { measureSeam, type SeamlessReceipt } from '@/lib/wallpro-seamless';

type Props = {
  artwork: WallAsset | null; name: string; projectId: string; layout: WallLayout;
  /** Repeat only: the seam receipt for `artwork` as the page prepared it. The
   * export re-measures the exact pixels it embeds before trusting it. */
  seamless: SeamlessReceipt | null;
  settings: WallPrintSettings; onSettings: (settings: WallPrintSettings) => void;
  busy: boolean; run: (label: string, action: () => Promise<void>) => Promise<void>;
};
type Downloads = { signature: string; filename: string; url: string; files: { name: string; url: string }[]; panels: number };
const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950';

export function WallPrintOutput({ artwork, name, projectId, layout, seamless, settings, onSettings, busy, run }: Props) {
  const [pixels, setPixels] = useState<{ url: string; width: number; height: number } | null>(null);
  const [sourceError, setSourceError] = useState('');
  const [approved, setApproved] = useState('');
  const [progress, setProgress] = useState('');
  const [downloads, setDownloads] = useState<Downloads | null>(null);
  const ownedUrls = useRef<string[]>([]);
  const signature = JSON.stringify({ artwork: artwork?.path || artwork?.url, name, projectId, layout, settings, seam: seamless?.method ?? null });
  const signatureRef = useRef(signature); signatureRef.current = signature;
  useEffect(() => {
    let active = true; setPixels(null); setSourceError('');
    if (artwork) loadWallImage(artwork.url).then(image => { if (active) setPixels({ url: artwork.url, width: image.naturalWidth, height: image.naturalHeight }); }).catch(e => { if (active) setSourceError(e.message); });
    return () => { active = false; };
  }, [artwork?.url]);
  useEffect(() => {
    setDownloads(null); setApproved('');
    ownedUrls.current.forEach(URL.revokeObjectURL); ownedUrls.current = [];
    return () => { ownedUrls.current.forEach(URL.revokeObjectURL); ownedUrls.current = []; };
  }, [signature]);
  let check: ReturnType<typeof wallPrintPreflight> | null = null;
  let problem = sourceError;
  try { if (pixels && pixels.url === artwork?.url) check = wallPrintPreflight(layout, settings, pixels); }
  catch (e) { problem = e instanceof Error ? e.message : 'Check the print settings.'; }
  // A repeat is print-ready only with a verified seam. The page prepares the
  // receipt; the export re-measures the embedded pixels before honouring it.
  const seamBlocker = layout.mode === 'repeat' && check ? (!seamless ? 'Checking that the pattern tile joins seamlessly.' : !seamless.verified ? 'This tile does not join seamlessly. Choose Mirror repeat or Blended repeat in Size the artwork.' : '') : '';
  const ready = !!check?.ready && !seamBlocker;
  const currentDownloads = downloads?.signature === signature ? downloads : null;

  async function prepare() {
    if (!artwork || !ready || approved !== signature) return;
    const requestedSignature = signature, receipt = seamless;
    await run('Building wall print files', async () => {
      setProgress('Preparing full-resolution artwork');
      try {
        const sourceUrl = artwork.path ? await openWallAsset(artwork.path) : artwork.url;
        const image = await loadWallImage(sourceUrl);
        // Normalize image orientation, browser-managed sRGB and transparency at
        // original pixel dimensions. Never use the room-preview canvas.
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('This browser could not prepare the artwork. Try a desktop browser.');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0);
        // The seam is proven on the exact pixels being embedded, never on a
        // preview or an earlier copy. Mirror needs no measurement: its joins are
        // identical artwork by construction.
        let printSeam: SeamlessReceipt | null = null;
        if (layout.mode === 'repeat') {
          if (!receipt) throw new Error('The seam check has not finished. Wait for Size the artwork to report the tile status.');
          setProgress('Verifying the pattern seam on the print pixels');
          if (receipt.method === 'mirror') printSeam = receipt;
          else {
            const measured = measureSeam(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            printSeam = { ...receipt, after: measured, verified: measured.seamless };
          }
        }
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('The full-resolution artwork could not be prepared.')), 'image/png'));
        const source = { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
        canvas.width = 1; canvas.height = 1;
        const { buildWallPrintPack } = await import('@/lib/wallpro-print-export');
        const pack = await buildWallPrintPack({ name, projectId, layout: { ...layout }, settings: { ...settings }, source, seamless: printSeam, onProgress: setProgress });
        if (signatureRef.current !== requestedSignature) throw new Error('The wall settings changed during export. Build the print files again.');
        const link = (bytes: Uint8Array, type: string) => { const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type })); ownedUrls.current.push(url); return url; };
        ownedUrls.current.forEach(URL.revokeObjectURL); ownedUrls.current = [];
        setDownloads({ signature: requestedSignature, filename: pack.filename, url: link(pack.zip, 'application/zip'), panels: check!.plan.panels.length,
          files: pack.files.filter(file => file.mime === 'application/pdf').map(file => ({ name: file.name, url: link(file.bytes, file.mime) })) });
      } finally { setProgress(''); }
    });
  }

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Wall print output">
    <h2 className="flex items-center gap-2 text-lg font-semibold"><Printer size={20} />4. Prepare print files</h2>
    <p className="mt-2 text-sm text-slate-600">Full-size PDF panels, a wall master and an installation sheet. Every panel stays within your 51″ printable width, including bleed and overlap.</p>
    <fieldset disabled={busy} className="mt-4 grid gap-3 sm:grid-cols-3">
      <label className="text-sm">Perimeter bleed (inches)<input className={fieldClass} type="number" min="0" max="5" step="0.125" value={settings.bleed} onChange={e => onSettings({ ...settings, bleed: Number(e.target.value) })} /></label>
      <label className="text-sm">Panel overlap (inches)<input className={fieldClass} type="number" min="0" max="5" step="0.125" value={settings.overlap} onChange={e => onSettings({ ...settings, overlap: Number(e.target.value) })} /></label>
      <label className="text-sm">Minimum source PPI<select className={fieldClass} value={settings.minPpi} onChange={e => onSettings({ ...settings, minPpi: Number(e.target.value) })}>{[72, 100, 150, 200, 300, 600].map(value => <option key={value} value={value}>{value} PPI</option>)}</select></label>
    </fieldset>
    <p className="mt-2 text-xs text-slate-500">Bleed extends the outside perimeter. Overlap duplicates artwork at each seam. RGB output: apply your printer/media profile in the RIP. Windows and object masks affect the room preview; print panels remain continuous for trimming on site.</p>
    {!artwork && <p className="mt-4 text-sm text-slate-600">Upload artwork or generate a design to check print resolution.</p>}
    {problem && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{problem}</p>}
    {check && <div className="mt-4 space-y-2 rounded-xl border border-slate-200 p-4 text-sm">
      <p><strong>Source:</strong> {pixels?.width.toLocaleString()} × {pixels?.height.toLocaleString()} pixels · {check.ppi.toFixed(1)} PPI at the chosen size.</p>
      <p><strong>Output:</strong> {check.plan.panels.length} panels · {check.plan.bounds.height}″ printed height · final panel {check.plan.panels.at(-1)?.width}″ wide.</p>
      <p><strong>PDF widths:</strong> {check.plan.panels.map(p => p.width + '″').join(' + ')}</p>
      {check.ready ? <p className="font-medium text-emerald-700">Dimensions and source resolution pass the selected print settings.</p> : check.blockers.map(message => <p key={message} role="alert" className="text-red-700">{message}</p>)}
      {layout.mode === 'repeat' && (seamBlocker ? <p role={seamless && !seamless.verified ? 'alert' : 'status'} className={seamless && !seamless.verified ? 'text-red-700' : 'text-slate-600'}>{seamBlocker}</p>
        : <p className="font-medium text-emerald-700"><strong>Seam:</strong> {seamless?.method === 'mirror' ? 'mirror repeat, joins identical by construction.' : `verified to join (${(seamless?.after ?? seamless?.before)?.ratio.toFixed(2)}× the neighbouring pixel step${seamless?.method === 'blend' ? ', after deterministic seam blend' : ''}).`}</p>)}
      {!check.ready && <p>Required source at this placement: at least {check.requiredPixels.width.toLocaleString()} × {check.requiredPixels.height.toLocaleString()} pixels.</p>}
      {layout.mode === 'contain' && <p className="text-amber-800">Fit whole artwork prints white margins where the artwork does not cover the wall.</p>}
      {settings.minPpi < 150 && <p className="text-amber-800">You selected a lower resolution threshold. Inspect a physical sample at the intended viewing distance.</p>}
      {check.plan.bounds.height > 199 && <p className="text-amber-800">These long panels use PDF 1.6 large-page dimensions. Confirm the RIP reads the stated size.</p>}
    </div>}
    <label className="mt-4 flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" disabled={busy || !ready} checked={approved === signature} onChange={e => setApproved(e.target.checked ? signature : '')} />I reviewed the wall dimensions, artwork placement, bleed and overlap. I will print at 100% / actual size.</label>
    <Button className="mt-4" disabled={busy || !ready || approved !== signature} onClick={() => void prepare()}><Printer className="mr-2 h-4 w-4" />Build print files</Button>
    {progress && <p role="status" className="mt-3 text-sm text-violet-700">{progress}…</p>}
    {currentDownloads && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <p role="status" className="font-semibold text-emerald-900">Print pack ready — {currentDownloads.panels} full-size panel PDFs</p>
      <Button asChild className="mt-3"><a href={currentDownloads.url} download={currentDownloads.filename}><Download className="mr-2 h-4 w-4" />Download print ZIP</a></Button>
      <p className="mt-2 text-xs text-emerald-900">Send the numbered panel PDFs to your RIP at actual size. Check the first panel dimensions and a color sample before printing the complete wall. This export does not place an order.</p>
      <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Download individual PDFs</summary><div className="mt-2 flex flex-col items-start gap-2">{currentDownloads.files.map(file => <a className="underline" key={file.name} href={file.url} download={file.name.split('/').at(-1)}>{file.name}</a>)}</div></details>
    </div>}
  </section>;
}
