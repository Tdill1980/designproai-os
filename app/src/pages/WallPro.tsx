/** WallPro's migrated wall designer. Original creative prompts are in the OS edge
 * function. Physical placement never invokes or changes vehicle production. */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Upload, Wand2, Download, Save, ImageIcon, Ruler, RotateCcw, FolderOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WallPhotoEditor } from '@/components/wallpro/WallPhotoEditor';
import { WallPrintOutput } from '@/components/wallpro/WallPrintOutput';
import { WallProductionPanels } from '@/components/wallpro/WallProductionPanels';
import { rasterizeDetectionMasks } from '@/lib/wallpro-masks';
import { DEFAULT_WALL_PRINT, planWallPrint, type WallPrintSettings } from '@/lib/wallpro-print-plan';
import { WALL_DESIGNS } from '@/components/wallpro/galleryData';
import { validWallSize, validWallCorners, wallGenerationBlocker, wallPreviewBlocker, rectangularWallMask, layoutMetrics, WALLPRO_PRINT_WIDTH, homography, projectPoint, UNIT_WALL, type Point, type Placement, type WallLayout } from '@/lib/wallpro-geometry';
import { prepareWallUpload, validateWallUpload, loadWallImage, renderWallPreview, renderFlatWall, canvasBlob } from '@/lib/wallpro-render';
import { measureSeam, blendSeamless, chooseSeamlessMethod, seamlessReceipt, type SeamReport, type SeamlessPreference, type SeamlessReceipt } from '@/lib/wallpro-seamless';
import { autoRepeatWidthIn, autoWallScale, clampPatternScale, maxPrintSafeScale, patternDrawnWidthIn, patternPpi, patternScaleLabel, patternScaleWord, patternSizeAtScale, PATTERN_SCALE_MAX, PATTERN_SCALE_MIN, PATTERN_SCALE_PRESETS, PATTERN_SCALE_STEP, type PatternSize, type WallBox } from '@/lib/wallpro-scale';
import { Slider } from '@/components/ui/slider';
import { wallUser, uploadWallAsset, openWallAsset, openWallAssets, generateWall, detectWall, renderWallView, saveWallProject, wallHistory, getWallProject, listWallCatalog, listWallVersions, createWallVersion, approveWallVersion, sha256Hex, wallProEntitlements, startWallProCheckout, type WallAsset, type WallVersion, type WallVersionKind, type WallProEntitlement } from '@/lib/wallpro-api';
import type { WallCatalogRow } from '@/lib/wallpro-catalog';
import { beginAppBusy, endAppBusy } from '@/lib/app-busy';

const cornerNames = ['top left', 'top right', 'bottom right', 'bottom left'];
const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950';
const panelClass = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm';
type History = Awaited<ReturnType<typeof wallHistory>>;

/** The project a reload reopens when the URL has lost its ?project=. */
const LAST_PROJECT_KEY = 'wallpro:last-project';

export default function WallPro() {
  const [params, setParams] = useSearchParams();
  const [projectId, setProjectId] = useState(() => params.get('project') || crypto.randomUUID());
  const [name, setName] = useState('My wall design');
  const [photo, setPhoto] = useState<WallAsset | null>(null);
  const [artwork, setArtwork] = useState<WallAsset | null>(null);
  const [reference, setReference] = useState<WallAsset | null>(null);
  // library: pick a ready design · ai: describe · match: reproduce an uploaded
  // design faithfully · wall: design for the wall photo · upload: a print-ready file.
  const [designMode, setDesignMode] = useState<'library' | 'ai' | 'match' | 'wall' | 'upload'>('ai');
  const intent = designMode === 'match' ? 'match' : designMode === 'wall' ? 'wall' : 'prompt';
  // A design uploaded to match IS the design (WallPro contract), so it goes on
  // the wall the moment it is chosen, before a token is spent — owner,
  // 2026-09-12: "I'm uploading an image and it's not showing on the image".
  // It is a preview only: every print, version and production path below still
  // reads `artwork`, which exists only after a generation.
  const previewArt = artwork || (intent === 'match' ? reference : null);
  // Design session: every artwork the customer lands on is an immutable
  // version; refinement edits the current one; exactly one is approved and
  // production reads only it. docs/wallpro/WALLPRO-REFINEMENT-WORKFLOW.md
  const [versions, setVersions] = useState<WallVersion[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [versionThumbs, setVersionThumbs] = useState<Record<string, string>>({});
  const [refinePrompt, setRefinePrompt] = useState('');
  const [maskMode, setMaskMode] = useState(false);
  const [maskRects, setMaskRects] = useState<{ x: number; y: number; w: number; h: number }[]>([]);
  const [maskDraft, setMaskDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const maskStart = useRef<{ x: number; y: number } | null>(null);
  const currentVersion = versions.find(v => v.id === currentVersionId) || null;
  const approvedVersion = versions.find(v => v.status === 'approved') || null;
  // Paid entitlements for the current version. Production export is gated on
  // this server-side (request_wallpro_production); the button here is the
  // purchase path, not the security boundary.
  const [entitlements, setEntitlements] = useState<WallProEntitlement[]>([]);
  const entitled = entitlements.length > 0;
  // Ready-to-sell catalog (WrapReady Designs). A pick never regenerates: it
  // loads the approved master and the placement that master was published for.
  const [catalog, setCatalog] = useState<WallCatalogRow[] | null>(null);
  const [catalogThumbs, setCatalogThumbs] = useState<Record<string, string>>({});
  const [catalogIndustry, setCatalogIndustry] = useState('all');
  const [designId, setDesignId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [width, setWidth] = useState(120), [height, setHeight] = useState(96);
  const [placement, setPlacement] = useState<Placement>('cover'), [repeatWidth, setRepeatWidth] = useState(24);
  // Tile-or-mural and the tile's width are decided by code from the brief and
  // the wall inches (wallpro-scale.ts). 'auto' is the product; Mural and
  // Repeating pattern are overrides a customer may still choose.
  const [scaleChoice, setScaleChoice] = useState<'auto' | 'cover' | 'repeat'>('auto');
  // Seamless repeat is decided by measurement and closed by code (wallpro-seamless).
  // `seam` is the derivation for the current artwork + preference: its receipt and
  // the artwork that actually tiles (the blended copy, or the original).
  const [seamPreference, setSeamPreference] = useState<SeamlessPreference>('auto');
  const [seam, setSeam] = useState<{ key: string; receipt: SeamlessReceipt; artwork: WallAsset } | null>(null);
  const [seamBusy, setSeamBusy] = useState(false);
  const [corners, setCorners] = useState<Point[]>([]), [exclusions, setExclusions] = useState<Point[][]>([]);
  const [marking, setMarking] = useState<'wall' | 'exclude' | 'rectangle' | null>('wall');
  const [excludeDraft, setExcludeDraft] = useState<Point[]>([]);
  const [view, setView] = useState<'before' | 'after' | 'design' | 'ai'>('before');
  const showPrintGuides = false; // Print-seam guides on the photo are an internal aid; the customer page keeps them off.
  const [editingPhoto, setEditingPhoto] = useState(false);
  const [showMasks, setShowMasks] = useState(true);
  const [printSettings, setPrintSettings] = useState<WallPrintSettings>({ ...DEFAULT_WALL_PRINT });
  const [preview, setPreview] = useState<string | null>(null), [rendering, setRendering] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [productionKick, setProductionKick] = useState(0);
  // Pixel-accurate protected areas from detection: one PNG, white where the
  // design must not paint. Preview-only; print panels stay full rectangles.
  const [detectedMask, setDetectedMask] = useState<{ url: string; path: string | null } | null>(null);
  // The AI picture of the design on the wall: presentation only, never print.
  const [aiView, setAiView] = useState<{ url: string; path: string; artwork: string; forArtwork: string; forPhoto: string; forScale: string } | null>(null);
  const [aiPainting, setAiPainting] = useState(false);
  // Latest photo and corners, readable from a detection that started earlier.
  const photoRef = useRef<WallAsset | null>(null), cornersRef = useRef<Point[]>([]), exclusionsRef = useRef<Point[][]>([]), artworkRef = useRef<WallAsset | null>(null);
  photoRef.current = photo; cornersRef.current = corners; exclusionsRef.current = exclusions; artworkRef.current = artwork;
  // Nobody has to tap corners. A photo starts as the whole frame ('default'),
  // detection tightens it when it can ('detected'), and only a customer's own
  // tap or drag ('manual') is ever protected from being replaced.
  const cornersOrigin = useRef<'default' | 'detected' | 'manual'>('default');
  // The ref drives logic mid-flight; the state drives what the customer is
  // told. 'default' means nobody has found this wall yet and the corners are
  // still the whole photo, so the design covers the ceiling and floor too.
  const [cornerSource, setCornerSource] = useState<'default' | 'detected' | 'manual'>('default');
  const fullFrame = () => UNIT_WALL.map(p => ({ ...p }));
  // The on-wall view switches on by itself the moment a design and four valid
  // corners both exist, whichever arrives last: detection landing after a
  // generation, a generation landing after hand-marked corners, or a restore.
  const cornersValidNow = validWallCorners(corners);
  // The corners default to the WHOLE PHOTO so nothing errors before detection
  // lands. But painting the design across the whole frame hides the room
  // entirely: the customer sees her flat design twice and her photo gone
  // (owner, 2026-09-12: "the photo disappeared and it just shows the same
  // image twice"). So the on-wall composite waits until the wall has actually
  // been located — detected, marked by hand, or restored — and until then the
  // photo pane stays on the photo and says what it needs. Print files never
  // wait on this; they are built from the flat master.
  const wallLocated = cornersValidNow && cornerSource !== 'default';
  // The AI picture is for one design, one photo and one pattern size; a step
  // Bigger or Smaller makes it stale, the exact-geometry view updates at once,
  // and the tab offers to repaint.
  const scaleKey = placement + '|' + (placement === 'repeat' ? repeatWidth : 0);
  const aiViewCurrent = !!aiView && !!artwork && !!photo && aiView.forArtwork === artwork.url && aiView.forPhoto === photo.url && aiView.forScale === scaleKey;
  /** PATTERN SCALE, as RestylePro's PatternPro slider (owner, 2026-09-12:
   * "the pattern design size larger and smaller … look at PatternPro, we
   * literally had this"): 30 to 300 percent of the size the design was
   * generated at. The design is the swatch; the slider draws it bigger or
   * smaller across the wall, repeated. The 59-inch panels never change. The
   * base is the version as generated; the percentage re-tiles the same master
   * deterministically, no regeneration, no token. The flat pane shows the
   * print master at the chosen scale, the on-wall view updates at once,
   * production uses it on Rebuild, and the project remembers it. */
  const [patternScale, setPatternScale] = useState(100);
  // While the slider is moving, `scaleDraft` leads and the flat pane previews
  // it instantly in CSS, exactly the way PatternPro previewed a swatch. The
  // committed scale, which drives the real canvas renders and the print
  // geometry, only follows when the slider rests — one exact render per
  // decision instead of one per tick.
  const [scaleDraft, setScaleDraft] = useState(100);
  const patternBase: PatternSize = currentVersion
    ? { placement: currentVersion.placement, repeatWidthIn: Number(currentVersion.repeat_width_in) || autoRepeatWidthIn(width) }
    : { placement, repeatWidthIn: repeatWidth };
  const wallBox: WallBox = { width, height, aspect: previewArt?.aspect || 1 };
  const masterPx = { width: previewArt?.width || 0, height: previewArt?.height || 0 };
  const draftPpi = previewArt ? patternPpi(masterPx, patternBase, wallBox, scaleDraft) : 0;
  const printSafeMax = previewArt ? maxPrintSafeScale(masterPx, patternBase, wallBox, printSettings.minPpi) : null;
  const scaleSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scaleCommit = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setScaleDraft(patternScale); }, [patternScale]);
  /** A slider tick: instant preview only. */
  function draftPatternScale(percent: number) {
    setScaleDraft(clampPatternScale(percent));
    // Touch and keyboard do not always fire a commit; this guarantees one.
    if (scaleCommit.current) clearTimeout(scaleCommit.current);
    scaleCommit.current = setTimeout(() => applyPatternScale(percent), 400);
  }
  function applyPatternScale(percent: number) {
    if (scaleCommit.current) clearTimeout(scaleCommit.current);
    const pct = clampPatternScale(percent);
    const next = patternSizeAtScale(patternBase, wallBox, pct);
    setScaleDraft(pct); setPatternScale(pct); setPlacement(next.placement); setRepeatWidth(next.repeatWidthIn);
    // The project remembers the slider once it rests, not on every tick.
    if (scaleSave.current) clearTimeout(scaleSave.current);
    scaleSave.current = setTimeout(() => {
      wallUser().then(user => saveWallProject(projectId, user.id, name, { wallPath: photo?.path || null, artworkPath: artwork?.path || null, referencePath: reference?.path || null, width, height, placement: next.placement, repeatWidth: next.repeatWidthIn, patternScale: pct, seamPreference, printWidth: WALLPRO_PRINT_WIDTH, printSettings, corners, exclusions, maskPath: detectedMask?.path || null, prompt, designMode, designId, currentVersionId })).catch(() => { /* signed out: the scale still applies on screen */ });
    }, 600);
  }
  useEffect(() => { if (artwork && photo && wallLocated) setView(aiViewCurrent ? 'ai' : 'after'); }, [!!artwork, !!photo, wallLocated, aiViewCurrent]);
  // The photo pane opens on the AI picture by itself: the model puts the
  // covering on the wall and leaves the window, drapes, shelves and furniture
  // as photographed, with no masks to mark (owner, 2026-09-11: "it should know
  // to not wrap but keep in image"). Once per design-and-photo pair, in the
  // background, never charged; the exact-geometry view stays one tab away.
  const aiAutoKey = useRef<string | null>(null);
  useEffect(() => {
    if (!artwork || !photo || aiViewCurrent) return;
    const key = artwork.url + '|' + photo.url;
    if (aiAutoKey.current === key) return;
    aiAutoKey.current = key;
    void paintAiView(artwork, photo, true);
  }, [artwork?.url, photo?.url]);
  const [history, setHistory] = useState<History | null>(null);
  const [artworkDownload, setArtworkDownload] = useState<{ source: string; url: string; name: string } | null>(null);
  const urls = useRef(new Set<string>()), canvas = useRef<HTMLCanvasElement | null>(null), loadOnce = useRef(false);
  const previewVersion = useRef(0);
  const previewIdentity = useRef(''), previewUrl = useRef<string | null>(null);
  const uploadInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const retain = (url: string) => { if (url.startsWith('blob:')) urls.current.add(url); return url; };
  useEffect(() => () => urls.current.forEach(url => URL.revokeObjectURL(url)), []);
  const dimensionsValid = validWallSize(width, height);
  const cornersValid = validWallCorners(corners);
  // Hard gate: a wall photo with fewer than four valid corners cannot be projected,
  // so no token is spent until the placement exists. Null means generation may run.
  const generationBlocker = wallGenerationBlocker(!!photo, corners, width, height);
  const previewBlocker = wallPreviewBlocker(!!photo, corners);
  let printPanels: ReturnType<typeof planWallPrint>['panels'] = [];
  try { printPanels = planWallPrint(width, height, printSettings).panels; } catch { /* Output settings show validation. */ }
  const wallMap = cornersValid ? homography(UNIT_WALL,corners) : null;
  const printSeams = wallMap ? printPanels.slice(1).map(panel => ({
    top: projectPoint(wallMap,{x:Math.max(0, panel.x)/width,y:0}),
    bottom: projectPoint(wallMap,{x:Math.max(0, panel.x)/width,y:1}),
  })) : [];
  const seamKey = artwork && placement === 'repeat' ? artwork.url + '|' + seamPreference : '';
  const seamCurrent = seam && seam.key === seamKey ? seam : null;
  // What the preview samples and the print embeds. For a repeat this is the
  // seam-derived artwork; the layout carries mirror when that method was chosen.
  const tileArtwork = seamCurrent ? seamCurrent.artwork : previewArt;
  const seamReceipt = seamCurrent ? seamCurrent.receipt : null;
  const layout: WallLayout = { width, height, mode: placement, repeatWidth, mirror: seamReceipt?.method === 'mirror' };
  const seamReady = placement !== 'repeat' || !!seamCurrent;
  let metrics: ReturnType<typeof layoutMetrics> | null = null;
  try { if (previewArt) metrics = layoutMetrics(layout, previewArt.aspect); } catch { /* visible validation below */ }
  // The flat pane shows the print master as it prints across the wall at the
  // current pattern scale; while a refinement mask is being drawn it shows the
  // generated tile itself, which is what the mask coordinates belong to.
  const [flatPreview, setFlatPreview] = useState<{ key: string; url: string } | null>(null);
  const flatKey = tileArtwork && metrics ? [tileArtwork.url, placement, repeatWidth, width, height, !!layout.mirror].join('|') : '';
  useEffect(() => {
    if (!tileArtwork || !flatKey || !seamReady) return;
    let active = true;
    renderFlatWall(tileArtwork.url, layout).then(canvas => { if (active) setFlatPreview({ key: flatKey, url: canvas.toDataURL('image/jpeg', 0.9) }); }).catch(() => { /* the generated tile stays on screen */ });
    return () => { active = false; };
  }, [flatKey, seamReady]);
  // The exact render for this scale, or the previous one while the next is
  // still drawing — never a jump back to the bare tile.
  const flatCurrent = flatPreview && flatPreview.key === flatKey ? flatPreview.url : null;
  const flatShown = flatCurrent || (flatPreview && tileArtwork && flatPreview.key.startsWith(tileArtwork.url + '|') ? flatPreview.url : null);
  // The instant preview under the moving slider: the master tiled in CSS at
  // the draft size, the way PatternPro previewed a swatch. Approximate for a
  // mirrored repeat (CSS cannot flip alternate tiles); the exact canvas
  // replaces it the moment the slider rests.
  const draftDrawnIn = previewArt ? patternDrawnWidthIn(patternBase, wallBox, scaleDraft) : 0;
  const draftTile = previewArt && draftDrawnIn > 0
    ? { fraction: draftDrawnIn / width, position: `${draftDrawnIn >= width ? 'center' : 'left'} ${draftDrawnIn / previewArt.aspect >= height ? 'center' : 'top'}` }
    : null;
  const scaleSettling = scaleDraft !== patternScale;

  useEffect(() => {
    if (!seamKey || !artwork) { setSeam(null); setSeamBusy(false); return; }
    let active = true, owned: string | null = null;
    setSeam(null); setSeamBusy(true);
    (async () => {
      const image = await loadWallImage(artwork.url);
      const tile = document.createElement('canvas');
      tile.width = image.naturalWidth; tile.height = image.naturalHeight;
      const ctx = tile.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('This browser could not check the pattern seam. Try a desktop browser.');
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, tile.width, tile.height);
      const before = measureSeam(pixels.data, tile.width, tile.height);
      const method = chooseSeamlessMethod(before, seamPreference);
      let after: SeamReport | null = null, tiled: WallAsset = artwork;
      if (method === 'blend') {
        const blended = blendSeamless(pixels.data, tile.width, tile.height);
        after = measureSeam(blended, tile.width, tile.height);
        ctx.putImageData(new ImageData(blended, tile.width, tile.height), 0, 0);
        const blob = await canvasBlob(tile);
        if (!active) return;
        owned = URL.createObjectURL(blob);
        // Derived deterministically from the stored artwork; never uploaded itself.
        tiled = { url: owned, aspect: artwork.aspect };
      }
      tile.width = 1; tile.height = 1;
      if (!active) return;
      setSeam({ key: seamKey, receipt: seamlessReceipt(seamPreference, before, after, method), artwork: tiled });
    })().catch(e => { if (active) setError(e instanceof Error ? e.message : 'The pattern seam could not be checked.'); })
      .finally(() => { if (active) setSeamBusy(false); });
    return () => { active = false; if (owned) URL.revokeObjectURL(owned); };
  }, [seamKey]);

  useEffect(() => {
    const version = ++previewVersion.current;
    // A pattern-size change re-renders the same wall, so the last composite
    // stays on screen (marked "updating") instead of blanking. Anything that
    // changes WHICH wall or WHICH design is shown clears it at once, so a
    // stale picture can never be mistaken for the new one.
    const identity = [photo?.url, previewArt?.url, tileArtwork?.url, JSON.stringify(corners), JSON.stringify(exclusions), detectedMask?.url, editingPhoto].join('|');
    if (identity !== previewIdentity.current) {
      previewIdentity.current = identity;
      setPreview(null);
      if (previewUrl.current) { URL.revokeObjectURL(previewUrl.current); previewUrl.current = null; }
    }
    canvas.current = null;
    if (editingPhoto || !photo || !previewArt || !tileArtwork || !seamReady || !wallLocated || !dimensionsValid || !metrics) { setRendering(false); return; }
    setRendering(true);
    renderWallPreview(photo.url, tileArtwork.url, corners, exclusions, layout, () => version !== previewVersion.current, detectedMask?.url ?? null)
      .then(async output => {
        const blob = await canvasBlob(output);
        if (version !== previewVersion.current) return;
        canvas.current = output;
        const url = URL.createObjectURL(blob);
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = url;
        setPreview(url);
      })
      .catch(e => { if (version === previewVersion.current) setError(e.message); })
      .finally(() => { if (version === previewVersion.current) setRendering(false); });
    return () => { previewVersion.current++; };
  }, [photo, artwork, corners, exclusions, detectedMask?.url, width, height, placement, repeatWidth, editingPhoto, seamCurrent]);
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError(''); setNotice(''); beginAppBusy();
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'The operation could not be completed.'); }
    finally { setBusy(''); endAppBusy(); }
  }
  async function fileSelected(file: File | undefined, role: 'photo' | 'artwork' | 'reference') {
    if (!file) return;
    await run('Opening image', async () => {
      // An iPhone hands us HEIC; this converts it once, here, and passes a
      // JPG, PNG or WebP through untouched so a print-ready upload is never
      // re-compressed.
      const ready = await prepareWallUpload(file);
      const validated = await validateWallUpload(ready);
      const asset = { ...validated, file: ready, url: retain(validated.url) };
      if (role === 'photo') {
        setPhoto(asset); setCorners(fullFrame()); cornersOrigin.current = 'default'; setCornerSource('default'); setExclusions([]); setDetectedMask(null); setExcludeDraft([]); setMarking(null); setView('before');
        // Uploading a wall photo means "find my wall": detection starts at once,
        // in the background. It must not hold the form: the customer types the
        // wall size while it runs, and the corner gate still guards Generate.
        void detectInBackground(asset);
      }
      if (role === 'artwork') { setArtwork(asset); setDesignMode('upload'); setView(photo && cornersValid ? 'after' : 'design'); await recordVersion('upload', asset, { note: file.name.slice(0, 200) }); }
      if (role === 'reference') { setReference(asset); setArtwork(null); }
    });
  }
  // A real button that opens the picker, not a transparent file input laid over
  // a label: on a phone the overlay is one hit-test away from doing nothing,
  // and a tap that does nothing is indistinguishable from a broken app. The
  // accept list stays wide so the iOS photo picker offers every photo —
  // `prepareWallUpload` converts whatever comes back.
  const uploadControl = (role: 'photo' | 'artwork' | 'reference', label: string) => (
    <div>
      <input ref={el => { uploadInputs.current[role] = el; }} aria-label={label} type="file" accept="image/*,.heic,.heif,.HEIC,.HEIF" className="sr-only"
        onChange={e => { void fileSelected(e.target.files?.[0], role); e.target.value = ''; }} />
      <button type="button" style={{ touchAction: 'manipulation' }} onClick={() => uploadInputs.current[role]?.click()}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-sm font-medium hover:border-violet-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
        <Upload size={18} />{label}
      </button>
    </div>
  );
  async function storedAsset(path: string): Promise<WallAsset> {
    const url = await openWallAsset(path), image = await loadWallImage(url);
    return { path, url, aspect: image.naturalWidth / image.naturalHeight, width: image.naturalWidth, height: image.naturalHeight };
  }
  async function restore(config: any, id?: string, title?: string) {
    const [wall, art, ref] = await Promise.all([config.wallPath ? storedAsset(config.wallPath) : null, config.artworkPath ? storedAsset(config.artworkPath) : null, config.referencePath ? storedAsset(config.referencePath) : null]);
    setPhoto(wall); setArtwork(art); setReference(ref); setWidth(config.width || 120); setHeight(config.height || 96);
    setPrintSettings({ ...DEFAULT_WALL_PRINT, ...config.printSettings });
    setPlacement(config.placement || 'cover'); setRepeatWidth(config.repeatWidth || 24); setPrompt(config.prompt || '');
    setPatternScale(typeof config.patternScale === 'number' && config.patternScale >= PATTERN_SCALE_MIN && config.patternScale <= PATTERN_SCALE_MAX ? clampPatternScale(config.patternScale) : 100);
    setSeamPreference(['auto', 'mirror', 'blend'].includes(config.seamPreference) ? config.seamPreference : 'auto');
    setDesignMode(['library', 'ai', 'match', 'wall', 'upload'].includes(config.designMode) ? config.designMode : 'ai'); setDesignId(typeof config.designId === 'string' ? config.designId : null);
    setMaskRects([]); setMaskMode(false); setRefinePrompt('');
    if (id) {
      const rows = await listWallVersions(id).catch(() => [] as WallVersion[]);
      setVersions(rows);
      const current = rows.find(v => v.id === config.currentVersionId) || rows.at(-1) || null;
      setCurrentVersionId(current?.id ?? null);
    } else { setVersions([]); setCurrentVersionId(null); }
    const restoredCornersValid = validWallCorners(config.corners || []);
    // A saved project without usable corners still shows the design on the wall:
    // the whole photo stands in until the customer adjusts.
    setCorners(restoredCornersValid ? config.corners : wall ? fullFrame() : []); cornersOrigin.current = restoredCornersValid ? 'manual' : 'default'; setCornerSource(restoredCornersValid ? 'manual' : 'default');
    setExclusions(config.exclusions || []); setExcludeDraft([]); setMarking(null);
    setDetectedMask(null);
    if (typeof config.maskPath === 'string' && config.maskPath) openWallAsset(config.maskPath).then(url => setDetectedMask({ url, path: config.maskPath })).catch(() => { /* the polygons and corners still restore */ });
    setView(art ? 'after' : 'before');
    setName(title || 'Wall design'); setHistory(null);
    if (id) { setProjectId(id); setParams({ project: id }, { replace: true }); }
  }
  useEffect(() => {
    // The catalog is browsable without signing in; failures leave the AI path untouched.
    let active = true;
    listWallCatalog().then(async rows => {
      if (!active) return;
      setCatalog(rows);
      if (rows.length && !params.get('project')) setDesignMode('library');
      setCatalogThumbs(await openWallAssets(rows.map(r => r.thumb_path || r.master_path)).catch(() => ({})));
    }).catch(() => { if (active) setCatalog([]); });
    return () => { active = false; };
  }, []);
  async function pickDesign(row: WallCatalogRow) {
    await run('Opening ' + row.design_id, async () => {
      const art = await storedAsset(row.master_path);
      setArtwork(art); setDesignId(row.design_id); setName(row.title); setPrompt('');
      const nextPlacement: Placement = row.mode === 'repeat' ? 'repeat' : 'cover';
      setPlacement(nextPlacement); setRepeatWidth(row.tile_width_in || 24); setSeamPreference('auto');
      setView(photo && cornersValid ? 'after' : 'design');
      await recordVersion('catalog', art, { designId: row.design_id, placement: nextPlacement, repeatWidthIn: row.tile_width_in, note: row.title });
    });
  }
  /** Appends the next immutable version for the current artwork. Needs a
   * signed-in owner and a saved project row; when either is missing the
   * artwork still works for preview, only the session history is skipped. */
  async function recordVersion(kind: WallVersionKind, art: WallAsset, extra: { intent?: string | null; prompt?: string | null; maskPath?: string | null; referencePath?: string | null; generationId?: string | null; designId?: string | null; placement?: Placement; repeatWidthIn?: number | null; note?: string | null; sha256?: string | null } = {}): Promise<WallVersion | null> {
    let user: Awaited<ReturnType<typeof wallUser>>;
    try { user = await wallUser(); } catch { return null; }
    const artworkPath = art.path || await uploadWallAsset(art, user.id);
    if (!art.path) setArtwork(old => old && old.url === art.url ? { ...old, path: artworkPath } : old);
    await saveWallProject(projectId, user.id, name, { wallPath: photo?.path || null, artworkPath, referencePath: reference?.path || null, width, height, placement: extra.placement ?? placement, repeatWidth: extra.repeatWidthIn ?? repeatWidth, seamPreference, printWidth: WALLPRO_PRINT_WIDTH, printSettings, corners, exclusions, maskPath: detectedMask?.path || null, prompt, designMode, designId: extra.designId ?? designId, currentVersionId });
    setParams({ project: projectId }, { replace: true });
    const version = await createWallVersion({ projectId, owner: user.id, parent: currentVersion, kind, versionNo: versions.length + 1, artworkPath, widthPx: art.width ?? null, heightPx: art.height ?? null,
      placement: extra.placement ?? placement, repeatWidthIn: extra.repeatWidthIn ?? repeatWidth, intent: extra.intent ?? null, prompt: extra.prompt ?? null, maskPath: extra.maskPath ?? null, referencePath: extra.referencePath ?? null,
      generationId: extra.generationId ?? null, designId: extra.designId ?? null, note: extra.note ?? null, sha256: extra.sha256 ?? null });
    setVersions(old => [...old, version]); setCurrentVersionId(version.id);
    return version;
  }
  /** Preview-only: proposes corners and protected areas from the photo. Print
   * panels stay full rectangles whatever is detected; the installer trims. */
  async function detectPhoto(asset: WallAsset, applyMasks = false) {
    const user = await wallUser();
    const wallPath = asset.path || await uploadWallAsset(asset, user.id);
    if (!asset.path) setPhoto(old => old && old.url === asset.url ? { ...old, path: wallPath } : old);
    const found = await detectWall(wallPath);
    // The customer may have replaced the photo or tapped corners while the model
    // was thinking. A stale answer, or one that would overwrite hand-placed
    // corners, is dropped rather than applied on top of their work.
    if (photoRef.current?.url !== asset.url) return;
    const handMarked = cornersOrigin.current === 'manual' && validWallCorners(cornersRef.current);
    const cornersOk = !!found.wall && validWallCorners(found.wall);
    if (!handMarked && cornersOk) { setCorners(found.wall!); cornersOrigin.current = 'detected'; setCornerSource('detected'); }
    setMarking(null);
    // Segmentation masks follow the real outline of a bed, a drape or a shelf,
    // so the wall around them keeps the design. The coarse polygon list is only
    // the fallback when segmentation returned nothing usable.
    // Owner (2026-09-11): people mark the windows and drapes themselves. Auto
    // masks only run from the explicit button, never on upload.
    const raster = applyMasks && found.masks.length && asset.width && asset.height ? await rasterizeDetectionMasks(found.masks, asset.width, asset.height).catch(() => null) : null;
    if (photoRef.current?.url !== asset.url) return;
    let maskCount = 0, labels: string[] = [];
    if (!applyMasks) { /* corners only; hand-drawn masks stay as they are */ }
    else if (raster) {
      maskCount = found.masks.length; labels = found.masks.map(m => m.label);
      const blob = await canvasBlob(raster);
      const url = retain(URL.createObjectURL(blob));
      setDetectedMask({ url, path: null }); setExclusions([]);
      // Persisted for restores; a failed upload keeps the in-memory mask working.
      uploadWallAsset({ url, aspect: asset.aspect, file: new File([blob], 'protected-areas.png', { type: 'image/png' }) }, user.id)
        .then(path => setDetectedMask(old => old && old.url === url ? { ...old, path } : old)).catch(() => { /* preview keeps the in-memory mask */ });
    } else {
      // No true masks came back. The detector's coarse polygons are NOT a
      // substitute: a box around a window swallows the wall beside it (owner,
      // 2026-09-11: "it's way over and masking wall and items"). Apply nothing
      // and say so; the AI picture never needed masks in the first place.
      setDetectedMask(null);
    }
    setExcludeDraft([]); setShowMasks(true);
    setView(artworkRef.current ? 'after' : 'before'); setError('');
    const cornersNote = handMarked ? 'Kept the corners you marked.' : cornersOk ? 'Wall corners placed.' : 'Using the whole photo as the wall.';
    if (!applyMasks) setNotice(cornersNote + ' Use Mask window / drapes or Outline an object for anything the design must not cover. Masks affect the preview only; print panels stay full.');
    else if (maskCount) setNotice(cornersNote + ` Found ${maskCount} protected area${maskCount === 1 ? '' : 's'} (${[...new Set(labels)].slice(0, 6).join(', ')}). Clear detected areas removes them. Masks affect the preview only; print panels stay full.` + (found.notes ? ' ' + found.notes : ''));
    else setNotice(cornersNote + ' The objects could not be outlined precisely, so nothing was masked. Use Mask window / drapes for the window, or the AI picture, which keeps the room as photographed without masks.');
  }
  /** Detection never holds the form: it is a preview aid, so it runs beside the
   * customer's typing and a signed-out session or a model failure leaves the
   * upload in place and falls back to hand marking. */
  async function detectInBackground(asset: WallAsset, applyMasks = false) {
    setDetecting(true); setNotice(applyMasks ? 'Finding windows, drapes and furniture to protect…' : 'Finding your wall. Enter the wall size meanwhile; nothing else is needed.');
    try { await detectPhoto(asset, applyMasks); }
    catch (e) { if (photoRef.current?.url === asset.url) setNotice((e instanceof Error ? e.message : 'The wall could not be detected.') + ' Using the whole photo as the wall; drag the corners if the wall is smaller.'); }
    finally { if (photoRef.current?.url === asset.url) setDetecting(false); }
  }
  /** ChatGPT-style "show me": the image model paints the flat master onto the
   * wall and leaves the window, drapes and furniture as photographed. No corners,
   * no masks, no token. The flat master stays the print truth. */
  async function paintAiView(art: WallAsset, wall: WallAsset, background: boolean) {
    const paint = async () => {
      const user = await wallUser();
      const wallPath = wall.path || await uploadWallAsset(wall, user.id);
      if (!wall.path) setPhoto(old => old && old.url === wall.url ? { ...old, path: wallPath } : old);
      const artworkPath = art.path || await uploadWallAsset(art, user.id);
      if (!art.path) setArtwork(old => old && old.url === art.url ? { ...old, path: artworkPath } : old);
      const result = await renderWallView({ wallPath, artworkPath, placement, repeatWidthIn: placement === 'repeat' ? repeatWidth : null, wallWidthIn: width, wallHeightIn: height });
      // The design or the photo may have changed while the model painted.
      if (artworkRef.current?.url !== art.url || photoRef.current?.url !== wall.url) return;
      setAiView({ url: result.view_url, path: result.view_path, artwork: artworkPath, forArtwork: art.url, forPhoto: wall.url, forScale: placement + '|' + (placement === 'repeat' ? repeatWidth : 0) }); setView('ai');
      setNotice('AI view ready. It is a picture for showing the design; the flat master and the production panels are what print. "On your wall" is the exact-geometry view.');
    };
    if (!background) { await run('Painting the design onto your wall', paint); return; }
    // Background: the form stays usable; a signed-out or failed paint just
    // leaves the exact-geometry view, which never needed the model.
    setAiPainting(true);
    try { await paint(); } catch (e) { if (artworkRef.current?.url === art.url) setNotice((e instanceof Error ? e.message : 'The AI view could not be painted.') + ' The exact-geometry view is on the "On your wall" tab.'); }
    finally { setAiPainting(false); }
  }
  async function showAiView() {
    if (!photo || !artwork) return;
    await paintAiView(artwork, photo, false);
  }
  /** Re-runs detection on demand (a different photo crop, or after the customer
   * moved things). The first pass happens automatically on upload. */
  function detectMyWall(applyMasks = false) {
    if (!photo || detecting) return;
    if (!applyMasks) { cornersOrigin.current = 'default'; setCornerSource('default'); }
    setMarking(null);
    void detectInBackground(photo, applyMasks);
  }
  async function restoreVersion(version: WallVersion) {
    await run('Restoring V' + version.version_no, async () => {
      const art = await storedAsset(version.artwork_path);
      setArtwork(art); setCurrentVersionId(version.id); setPlacement(version.placement); if (version.repeat_width_in) setRepeatWidth(Number(version.repeat_width_in)); setPatternScale(100);
      if (version.design_id) setDesignId(version.design_id);
      setView(photo && cornersValid ? 'after' : 'design'); setMaskRects([]);
      const user = await wallUser();
      await saveWallProject(projectId, user.id, name, { wallPath: photo?.path || null, artworkPath: version.artwork_path, referencePath: reference?.path || null, width, height, placement: version.placement, repeatWidth: version.repeat_width_in ? Number(version.repeat_width_in) : repeatWidth, seamPreference, printWidth: WALLPRO_PRINT_WIDTH, printSettings, corners, exclusions, maskPath: detectedMask?.path || null, prompt, designMode, designId: version.design_id || designId, currentVersionId: version.id });
    });
  }
  async function approveCurrent() {
    if (!currentVersion) return;
    await run('Approving V' + currentVersion.version_no, async () => {
      await approveWallVersion(projectId, currentVersion.id);
      setVersions(await listWallVersions(projectId));
      setNotice(`V${currentVersion.version_no} approved. Building its ${printSettings.minPpi} PPI production panels through Topaz now.`);
      // Approval auto-runs production: the 150 PPI panels start on the server
      // without another click (owner, 2026-09-11).
      setProductionKick(k => k + 1);
    });
  }
  function maskPoint(e: React.PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)) };
  }
  async function maskPng(art: WallAsset): Promise<File> {
    const w = art.width || 2048, h = art.height || Math.round(2048 / art.aspect);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff';
    for (const r of maskRects) ctx.fillRect(Math.round(r.x * w), Math.round(r.y * h), Math.round(r.w * w), Math.round(r.h * h));
    const blob = await canvasBlob(c);
    return new File([blob], 'mask.png', { type: 'image/png' });
  }
  async function refine() {
    const source = artwork, changes = refinePrompt.trim(), rects = maskRects;
    if (!source || !changes) return;
    await run('Refining the design', async () => {
      const user = await wallUser();
      const sourcePath = source.path || await uploadWallAsset(source, user.id);
      const maskPath = rects.length ? await uploadWallAsset({ url: '', aspect: source.aspect, file: await maskPng(source) }, user.id) : null;
      const referencePath = reference ? await uploadWallAsset(reference, user.id) : null;
      const result = await generateWall({ requestId: crypto.randomUUID(), intent: 'refine', prompt: changes, width, height, placement, sourcePath, maskPath, referencePath });
      const image = await loadWallImage(result.image_url);
      let art: WallAsset = { url: result.image_url, path: result.storage_path, aspect: image.naturalWidth / image.naturalHeight, width: image.naturalWidth, height: image.naturalHeight };
      let kind: WallVersionKind = 'refine', sha: string | null = null;
      if (rects.length) {
        // Deterministic preservation: every pixel outside the mask comes from
        // the parent version; only the masked regions take the model's output.
        const parent = await loadWallImage(source.url);
        const c = document.createElement('canvas'); c.width = parent.naturalWidth; c.height = parent.naturalHeight;
        const ctx = c.getContext('2d')!; ctx.drawImage(parent, 0, 0);
        for (const r of rects) ctx.drawImage(image, r.x * image.naturalWidth, r.y * image.naturalHeight, r.w * image.naturalWidth, r.h * image.naturalHeight, r.x * c.width, r.y * c.height, r.w * c.width, r.h * c.height);
        const blob = await canvasBlob(c);
        sha = await sha256Hex(await blob.arrayBuffer());
        const file = new File([blob], 'composite.png', { type: 'image/png' });
        const url = retain(URL.createObjectURL(blob));
        art = { url, file, aspect: c.width / c.height, width: c.width, height: c.height };
        kind = 'composite';
      }
      setArtwork(art); setMaskRects([]); setMaskMode(false); setRefinePrompt('');
      setView(photo && cornersValid ? 'after' : 'design');
      await recordVersion(kind, art, { intent: 'refine', prompt: changes, maskPath, referencePath, generationId: result.request_id, sha256: sha, note: changes.slice(0, 200) });
    });
  }
  useEffect(() => {
    // Thumbnails for the version strip: signed URLs for whatever paths are new.
    const missing = versions.map(v => v.artwork_path).filter(p => !versionThumbs[p]);
    if (!missing.length) return;
    let active = true;
    openWallAssets(missing).then(urls => { if (active) setVersionThumbs(old => ({ ...old, ...urls })); }).catch(() => undefined);
    return () => { active = false; };
  }, [versions]);
  useEffect(() => {
    if (loadOnce.current) return;
    const linked = params.get('project');
    if (linked) {
      loadOnce.current = true;
      void run('Opening project', async () => {
        const project = await getWallProject(linked);
        await restore(project.config, project.id, project.name);
      });
      return;
    }
    // A reload or a sidebar click drops the ?project= from the URL; the last
    // project the customer worked on comes back rather than a blank wall
    // (owner, 2026-09-11: "It refreshed and they're gone"). "Start fresh" is
    // the one way to a blank wall. Unreadable (signed out, deleted) fails soft.
    let remembered: string | null = null;
    try { remembered = localStorage.getItem(LAST_PROJECT_KEY); } catch { remembered = null; }
    if (!remembered) return;
    loadOnce.current = true;
    getWallProject(remembered)
      .then(project => run('Opening your last project', () => restore(project.config, project.id, project.name)))
      .catch(() => { try { localStorage.removeItem(LAST_PROJECT_KEY); } catch { /* nothing to forget */ } });
  }, []);
  useEffect(() => {
    const id = params.get('project');
    if (id) try { localStorage.setItem(LAST_PROJECT_KEY, id); } catch { /* private mode: the URL still carries it */ }
  }, [params]);
  useEffect(() => {
    if (!currentVersionId) { setEntitlements([]); return; }
    let active = true;
    wallProEntitlements(currentVersionId).then(rows => { if (active) setEntitlements(rows); }).catch(() => { if (active) setEntitlements([]); });
    return () => { active = false; };
  }, [currentVersionId]);
  // Returning from Stripe: the webhook records the entitlement asynchronously,
  // so this re-checks a few times rather than trusting the redirect alone.
  useEffect(() => {
    const purchase = params.get('wallproPurchase');
    if (!purchase || !currentVersionId) return;
    setParams(p => { const next = new URLSearchParams(p); next.delete('wallproPurchase'); return next; }, { replace: true });
    if (purchase === 'cancelled') { setNotice('Checkout was cancelled. Nothing was charged.'); return; }
    setNotice('Payment received — confirming your entitlement…');
    let attempts = 0;
    const poll = () => wallProEntitlements(currentVersionId).then(rows => {
      if (rows.length) { setEntitlements(rows); setNotice('Purchase confirmed. Your print-ready wall file can now be produced.'); return; }
      attempts += 1;
      if (attempts < 6) setTimeout(poll, 2000);
    }).catch(() => {});
    poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, currentVersionId]);
  async function persistCurrent(art: WallAsset | null = artwork, designName = name) {
    const user = await wallUser();
    const wallPath = photo ? await uploadWallAsset(photo, user.id) : null;
    const artworkPath = art ? await uploadWallAsset(art, user.id) : null;
    const referencePath = reference ? await uploadWallAsset(reference, user.id) : null;
    if (photo && wallPath) setPhoto({ ...photo, path: wallPath });
    if (art && artworkPath) setArtwork({ ...art, path: artworkPath });
    if (reference && referencePath) setReference({ ...reference, path: referencePath });
    await saveWallProject(projectId, user.id, designName, { wallPath, artworkPath, referencePath, width, height, placement, repeatWidth, seamPreference, printWidth: WALLPRO_PRINT_WIDTH, printSettings, corners, exclusions, maskPath: detectedMask?.path || null, prompt, designMode, designId, currentVersionId });
    setParams({ project: projectId }, { replace: true }); setNotice('Project saved. You can reopen it from My wall designs.');
  }
  async function generate() {
    // Corners and masks are read LIVE when the design lands, never frozen at the
    // click: detection or hand marking may finish while the model works, and the
    // saved project and the on-wall decision must reflect what is on screen then.
    const wallCorners = corners;
    await run('Generating wall artwork', async () => {
      // The flat rectangle is the product: only the wall size gates the call.
      // Corners decide whether the result can be imposed on the photo, not
      // whether it exists.
      const blocker = wallGenerationBlocker(!!photo, wallCorners, width, height);
      if (blocker) throw new Error(blocker);
      if (intent === 'match' && !reference) throw new Error('Upload the design to match first.');
      if (intent === 'wall' && !photo) throw new Error('Upload your wall photo first.');
      if (intent === 'prompt' && !prompt.trim()) throw new Error('Describe the design first.');
      const user = await wallUser();
      const wallPath = photo ? await uploadWallAsset(photo, user.id) : null;
      const referencePath = reference ? await uploadWallAsset(reference, user.id) : null;
      if (photo && wallPath) setPhoto({ ...photo, path: wallPath });
      if (reference && referencePath) setReference({ ...reference, path: referencePath });
      // WallPro decides tile-versus-mural and the tile's real-world width from
      // the brief and the wall inches; the generator is told that width so
      // motifs are drawn at the size they print.
      const scale = autoWallScale({ intent, prompt, wallWidthIn: width, chosen: scaleChoice === 'auto' ? null : scaleChoice });
      const placement = scale.placement, repeatWidth = scale.repeatWidthIn;
      setPlacement(placement); setRepeatWidth(repeatWidth); setPatternScale(100);
      const result = await generateWall({ requestId: crypto.randomUUID(), intent, prompt, width, height, placement, repeatWidthIn: placement === 'repeat' ? repeatWidth : null, wallPath, referencePath });
      const image = await loadWallImage(result.image_url);
      // The flat artwork is the production master and is shown first. With a wall
      // photo and four valid corners the renderWallPreview compositor runs at once
      // (the preview effect keys on artwork/corners/exclusions) and the customer
      // lands on the design imposed on their wall; otherwise they see the flat
      // rectangle and the on-wall view appears when the corners are in.
      const art = { url: result.image_url, path: result.storage_path, aspect: image.naturalWidth / image.naturalHeight, width: image.naturalWidth, height: image.naturalHeight };
      const liveCorners = cornersRef.current, liveExclusions = exclusionsRef.current;
      const imposable = !!photo && validWallCorners(liveCorners);
      setArtwork(art); setName(result.design_name); setMarking(imposable || !photo ? null : 'wall'); setView(imposable ? 'after' : 'design');
      if (photo && !imposable) setNotice('Your flat design is ready. Mark the four wall corners on the Before view to see it imposed on your wall.');
      // On a phone the preview is a card below the fold, so a finished design
      // looked like nothing had happened — owner, 2026-09-12: "what button do I
      // push so I see the recreated design on the photo I provide". Nothing to
      // push: it goes on the photo by itself and the page moves to it.
      else if (imposable) setNotice('Your design is on your wall photo. "On your wall" is the exact print geometry; "Show me with AI" paints a photo-real picture of the room.');
      if (photo) setTimeout(() => document.getElementById('wall-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      // The server saves every generation before responding. Project save also
      // retains the measured wall and placement even if the customer reloads.
      try { await saveWallProject(projectId, user.id, result.design_name, { wallPath, artworkPath: result.storage_path, referencePath, width, height, placement, repeatWidth, seamPreference, printWidth: WALLPRO_PRINT_WIDTH, printSettings, corners: liveCorners, exclusions: liveExclusions, maskPath: detectedMask?.path || null, prompt, designMode, currentVersionId }); setParams({ project: projectId }, { replace: true }); }
      catch { setNotice('Artwork is saved in My wall designs. Save this project again to retain the wall placement.'); }
      // V1 of a new session, or the next version when the customer generates
      // again inside an existing project.
      await recordVersion('create', art, { intent, prompt, referencePath, generationId: result.request_id, note: result.design_name, placement, repeatWidthIn: placement === 'repeat' ? repeatWidth : null });
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
    const next = corners.length >= 4 ? [p] : [...corners, p]; setCorners(next); cornersOrigin.current = 'manual'; setCornerSource('manual');
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
          <Button variant="outline" disabled={!!busy} onClick={() => { try { localStorage.removeItem(LAST_PROJECT_KEY); } catch { /* nothing remembered */ } window.location.assign('/printpro/wallpro'); }} title="Start a blank wall. Saved projects remain in My wall designs."><RotateCcw className="mr-2 h-4 w-4" />Start fresh</Button>
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
      <div className="grid gap-5 lg:grid-cols-[400px_minmax(0,1fr)]">
        <fieldset disabled={!!busy} className="min-w-0 space-y-5 disabled:opacity-70">
          <section className={panelClass}><h2 className="mb-3 font-semibold">1. Upload your wall</h2>{uploadControl('photo', photo ? 'Replace wall photo' : 'Upload wall photo')}<p className="mt-2 text-xs text-slate-500">Any photo from your phone, including iPhone HEIC — it is converted here. Wall corners are detected automatically; mark windows and drapes with the mask tools. A wall photo is optional when generating artwork.</p>
            {photo && <div className="mt-3 space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="outline" disabled={!!busy || detecting} onClick={() => detectMyWall(false)}><Wand2 className={'mr-2 h-4 w-4' + (detecting ? ' animate-pulse' : '')} />{detecting ? 'Detecting…' : 'Detect wall corners again'}</Button>
                <Button variant="outline" disabled={!!busy || detecting} onClick={() => detectMyWall(true)}>Auto-mask windows & furniture</Button>
              </div>
              <p className="text-xs text-slate-600">{detecting ? 'Working on it. You can enter the wall size now.' : 'The wall corners were placed when you uploaded the photo; drag any point to adjust. Use the mask tools on the photo for windows, drapes and furniture, or try Auto-mask.'}</p>
            </div>}
            <div className="mt-4 grid grid-cols-2 gap-3"><label className="text-sm">Width (inches)<input className={inputClass} type="number" min="1" max="2400" step="0.25" value={width || ''} onChange={e => setWidth(Number(e.target.value))} /></label><label className="text-sm">Height (inches)<input className={inputClass} type="number" min="1" max="2400" step="0.25" value={height || ''} onChange={e => setHeight(Number(e.target.value))} /></label></div>
            <p className="mt-2 flex items-center gap-1 text-xs text-slate-500"><Ruler size={14} />{dimensionsValid ? (width * height / 144).toFixed(1) + ' sq ft' : 'Enter positive wall dimensions.'}</p>
          </section>
          <section className={panelClass}><h2 className="mb-3 font-semibold">2. Choose your design</h2><div className="mb-4 grid gap-2">{([
              { mode: 'library', label: 'Pick a design', hint: 'Ready-to-print designs by industry. No token.' },
              { mode: 'match', label: 'Match my design', hint: 'Upload a design; it is recreated print-ready, with any changes you ask for.' },
              { mode: 'wall', label: 'Design for my wall', hint: 'Upload your wall photo and let the designer propose a design for that room.' },
              { mode: 'ai', label: 'Describe a design', hint: 'Prompt only: a mural or a repeating pattern.' },
              { mode: 'upload', label: 'Use my print-ready file', hint: 'Your own file, placed as supplied. It must meet the print resolution.' },
            ] as const).map(option => <button key={option.mode} type="button" onClick={() => { setDesignMode(option.mode); setArtwork(null); setDesignId(null); if (option.mode === 'match') { setPlacement('repeat'); setRepeatWidth(24); } }} className={'flex items-baseline justify-between gap-3 rounded-lg border px-3 py-2 text-left ' + (designMode === option.mode ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-300' : 'border-slate-200 hover:border-violet-400')}><span className="shrink-0 text-sm font-semibold">{option.label}</span><span className="text-xs text-slate-600">{option.hint}</span></button>)}</div>
            {designMode === 'library' ? <div className="space-y-3">
              {catalog === null ? <p className="text-sm text-slate-600">Loading designs…</p> : catalog.length === 0 ? <p className="text-sm text-slate-600">No ready-to-sell designs are published yet. Describe your own with Create with AI.</p> : <>
                <label className="block text-sm">Industry<select className={inputClass} value={catalogIndustry} onChange={e => setCatalogIndustry(e.target.value)}><option value="all">All ({catalog.length})</option>{[...new Set(catalog.map(r => r.industry))].sort().map(i => <option key={i} value={i}>{i}</option>)}</select></label>
                <div className="grid max-h-[520px] grid-cols-2 gap-2 overflow-y-auto pr-1">{catalog.filter(r => catalogIndustry === 'all' || r.industry === catalogIndustry).map(row => <button key={row.id} type="button" disabled={!!busy} onClick={() => void pickDesign(row)} className={'overflow-hidden rounded-lg border text-left ' + (designId === row.design_id ? 'border-violet-500 ring-2 ring-violet-300' : 'border-slate-200 hover:border-violet-400')}>
                  <div className="aspect-[4/3] bg-slate-100">{catalogThumbs[row.thumb_path || row.master_path] && <img src={catalogThumbs[row.thumb_path || row.master_path]} alt={row.title} className="h-full w-full object-cover" loading="lazy" />}</div>
                  <div className="p-2"><p className="truncate text-xs font-semibold">{row.title}</p><p className="truncate text-[10px] text-slate-500">{row.design_id} · {row.design_type}</p></div>
                </button>)}</div>
                <p className="text-xs text-slate-500">Every design is a fixed production master with its own DesignID. Picking one never spends a token; it loads the approved artwork and its placement.</p>
              </>}
            </div> : designMode === 'ai' || designMode === 'match' || designMode === 'wall' ? <div className="space-y-3">
              <div><p className="text-sm">Design type</p><div className="mt-1 grid grid-cols-3 gap-2">
                <Button size="sm" className="h-auto whitespace-normal px-2 py-2 text-center leading-tight" variant={scaleChoice === 'auto' ? 'default' : 'outline'} onClick={() => setScaleChoice('auto')}>Auto</Button>
                <Button size="sm" className="h-auto whitespace-normal px-2 py-2 text-center leading-tight" variant={scaleChoice === 'cover' ? 'default' : 'outline'} onClick={() => setScaleChoice('cover')}>Mural</Button>
                <Button size="sm" className="h-auto whitespace-normal px-2 py-2 text-center leading-tight" variant={scaleChoice === 'repeat' ? 'default' : 'outline'} onClick={() => setScaleChoice('repeat')}>Pattern</Button>
              </div><p className="mt-1 text-xs text-slate-500">{autoWallScale({ intent, prompt, wallWidthIn: width, chosen: scaleChoice === 'auto' ? null : scaleChoice }).reason}</p></div>
              {intent === 'match' && <>
                {uploadControl('reference', reference ? 'Replace the design to match' : 'Upload the design to match')}
                <p className="text-xs text-slate-500">The designer recreates this design faithfully as a print-ready 4K master: same composition, motifs, palette and scale. Low-resolution files, screenshots and photos of a wall are fine as the source.</p>
              </>}
              {intent === 'wall' && <p className="text-xs text-slate-500">{photo ? 'The designer reads the room in your wall photo and proposes a design for it. Describe a direction if you have one.' : 'Upload your wall photo in step 1 and mark its four corners.'}</p>}
              <label className="block text-sm">{intent === 'match' ? 'Changes to make (optional)' : intent === 'wall' ? 'Direction for the designer (optional)' : 'Describe the design'}<textarea className={inputClass + ' min-h-28'} maxLength={6000} value={prompt} placeholder={intent === 'match' ? 'Keep it exactly as is, or: make the background ivory, fewer flowers…' : intent === 'wall' ? 'Calm, botanical, works with the grey drapes…' : 'Oversized blue botanicals on warm ivory, refined and hand-painted…'} onChange={e => { setPrompt(e.target.value); setArtwork(null); }} /></label>
              {intent === 'prompt' && <label className="block text-sm">Start with a style<select className={inputClass} value="" onChange={e => { setPrompt(WALL_DESIGNS.find(d => d.id === e.target.value)?.prompt || ''); setArtwork(null); }}><option value="">Choose a starting point</option>{WALL_DESIGNS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
              {intent !== 'match' && uploadControl('reference', reference ? 'Replace style reference' : 'Upload a style reference')}
              {intent !== 'match' && <p className="text-xs text-slate-500">Optional inspiration only. Your description is enough to generate a design; no example image is required.</p>}
              {reference && <div className="flex items-center gap-3"><img src={reference.url} alt={intent === 'match' ? 'Design to match' : 'Style reference'} className="h-14 w-14 rounded object-contain" /><Button size="sm" variant="ghost" onClick={() => { setReference(null); setArtwork(null); }}>Remove</Button></div>}
              <p className="text-xs text-slate-500">1 design token or plan render. Usually ready in 1–2 minutes.</p>
              {/* The reason generation is blocked, and any failure, sit beside the button
                  the customer is looking at. The page-top alert alone is off screen here. */}
              {generationBlocker && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">{generationBlocker}</p>}
              {!generationBlocker && previewBlocker && <p role="status" className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">{previewBlocker}</p>}
              {error && !busy && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}
              <Button className="w-full bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-600 text-white" disabled={!!generationBlocker || (intent === 'prompt' && !prompt.trim()) || (intent === 'match' && !reference) || (intent === 'wall' && !photo)} onClick={() => void generate()}><Wand2 className="mr-2 h-4 w-4" />{intent === 'match' ? 'Recreate my design print-ready' : intent === 'wall' ? 'Design for my wall' : 'Generate wall design'}</Button>
            </div> : <div className="space-y-3">{uploadControl('artwork', artwork ? 'Replace artwork' : 'Upload artwork or pattern')}<p className="text-xs text-slate-500">Your artwork is placed as supplied. Pattern size stays under your control.</p></div>}
          </section>
        </fieldset>
        <div className="min-w-0 space-y-5">
          <section id="wall-preview" className={panelClass + ' overflow-hidden'}>
            {/* Every WallPro design originates as a flat rectangle, and the client
                sees both at once: the print master on the left and the same file
                imposed on their photo on the right, the moment the corners exist.
                The tabs only switch the photo pane between the original wall and
                the imposed design; the flat master never leaves the screen. */}
            {photo && <div className="mb-4 flex flex-wrap items-center gap-2">{(['before','after'] as const).map(v => <Button size="sm" variant={(view === v) || (view === 'design' && v === 'before') ? 'default' : 'outline'} key={v} onClick={() => setView(v)} disabled={v === 'after' && !(artwork && wallLocated)}>{v === 'before' ? 'Original wall' : 'On your wall'}</Button>)}
              {artwork && <Button size="sm" variant={view === 'ai' ? 'default' : 'outline'} disabled={!!busy || aiPainting} onClick={() => aiViewCurrent ? setView('ai') : void showAiView()}><Wand2 className={'mr-1 h-3 w-3' + (aiPainting ? ' animate-pulse' : '')} />{aiPainting ? 'Painting AI view…' : aiViewCurrent ? 'AI view' : 'Show me with AI'}</Button>}{rendering && <span className="flex items-center gap-1 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" />Placing the design on your wall</span>}</div>}
            <div className={photo && previewArt ? 'grid gap-4 xl:grid-cols-2' : ''}>
            {previewArt && <div>
              {photo && <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">1 · {artwork ? 'Flat design — the print master' : 'Your uploaded design — not print-ready yet'}{previewArt.width && previewArt.height ? ` · ${previewArt.width} × ${previewArt.height} px` : ''}</p>}
              {/* Pattern size, as PatternPro's slider: the design itself drawn
                  smaller or bigger across the wall, 30% to 300%, with no new
                  generation (owner, 2026-09-12). The panels do not change. */}
              <div className="mb-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" aria-label="Pattern size">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">Pattern size</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">{patternScaleLabel(patternBase, wallBox, scaleDraft)}</span>
                </div>
                <Slider aria-label="Pattern size" min={PATTERN_SCALE_MIN} max={PATTERN_SCALE_MAX} step={PATTERN_SCALE_STEP} value={[scaleDraft]} disabled={!!busy} onValueChange={v => draftPatternScale(v[0])} onValueCommit={v => applyPatternScale(v[0])} />
                <div className="mt-1 flex justify-between text-[11px] text-slate-500"><span>30% smaller</span><span>100% as generated</span><span>300% bigger</span></div>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {PATTERN_SCALE_PRESETS.map(p => <Button key={p} size="sm" variant={scaleDraft === p ? 'default' : 'outline'} className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => applyPatternScale(p)}>{patternScaleWord(p)} {p}%</Button>)}
                  {scaleDraft !== 100 && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => applyPatternScale(100)}><RotateCcw className="mr-1 h-3 w-3" />Reset</Button>}
                </div>
                {/* Bigger spreads the same pixels over more inches, so the
                    honest limit on "bigger" is resolution, never print size:
                    the wall, the panels and the file stay exactly as they are. */}
                {artwork && draftPpi > 0 && <p className={'mt-2 text-xs ' + (draftPpi + 1e-9 >= printSettings.minPpi ? 'text-slate-500' : 'text-amber-700')}>
                  {draftPpi >= printSettings.minPpi
                    ? `${Math.round(draftPpi)} PPI from the design's own pixels — above your ${printSettings.minPpi} PPI minimum. Wall size, panels and print file are unchanged at every size.`
                    : `${Math.round(draftPpi)} PPI from the design's own pixels, under your ${printSettings.minPpi} PPI minimum. The print file stays the same size; Topaz fills the detail in, which invents it rather than recovering it.`}
                  {printSafeMax !== null && printSafeMax < scaleDraft && <> <button type="button" className="underline underline-offset-2" disabled={!!busy} onClick={() => applyPatternScale(printSafeMax)}>Use {printSafeMax}%, the largest fully sharp size</button>.</>}
                </p>}
                <p className="mt-1 text-xs text-slate-500">Same design, drawn smaller or bigger on your wall. Deterministic, no token; the print file rebuilds at this size when you approve.</p>
              </div>
              <div className="flex min-h-80 items-center justify-center rounded-xl bg-slate-100 p-4"><div className="relative inline-block">
              {scaleSettling && draftTile && !maskMode && maskRects.length === 0
                ? <div role="img" aria-label={`Print master across the wall at ${scaleDraft} percent`} className="max-h-[650px] w-[min(100%,650px)] rounded" style={{ aspectRatio: `${width} / ${height}`, backgroundImage: `url(${(tileArtwork || previewArt).url})`, backgroundSize: `${draftTile.fraction * 100}% auto`, backgroundPosition: draftTile.position, backgroundRepeat: 'repeat' }} />
                : <img src={maskMode || maskRects.length > 0 || !flatShown ? previewArt.url : flatShown} alt={maskMode || maskRects.length > 0 || !flatShown ? 'Generated tile' : 'Print master across the wall at the current pattern scale'} className={'max-h-[650px] max-w-full object-contain' + (flatShown && !flatCurrent ? ' opacity-70' : '')} draggable={false} />}
              {(maskMode || maskRects.length > 0) && <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={'absolute inset-0 h-full w-full ' + (maskMode ? 'cursor-crosshair' : 'pointer-events-none')} style={{ touchAction: 'none' }}
                onPointerDown={e => { if (!maskMode) return; e.currentTarget.setPointerCapture(e.pointerId); maskStart.current = maskPoint(e); setMaskDraft({ ...maskStart.current, w: 0, h: 0 }); }}
                onPointerMove={e => { if (!maskMode || !maskStart.current) return; const p = maskPoint(e), s = maskStart.current; setMaskDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) }); }}
                onPointerUp={() => { if (maskDraft && maskDraft.w > 0.01 && maskDraft.h > 0.01) setMaskRects(old => [...old, maskDraft]); maskStart.current = null; setMaskDraft(null); }}>
                {[...maskRects, ...(maskDraft ? [maskDraft] : [])].map((r, i) => <rect key={i} x={r.x * 100} y={r.y * 100} width={r.w * 100} height={r.h * 100} fill="rgba(255,255,255,0.45)" stroke="#7c3aed" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />)}
              </svg>}
              </div></div>
            </div>}
            {photo ? <div>
              {artwork && <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">2 · {view === 'after' && preview ? 'Imposed on your wall' : cornersValid ? 'Your wall' : 'Your wall — mark the four corners to impose the design'}</p>}
              {view === 'ai' && aiView ? <div className="overflow-hidden rounded-xl bg-slate-100"><img src={aiView.url} alt="AI picture of the design on your wall" className="w-full object-contain" /><p className="p-2 text-xs text-slate-500">AI picture for showing the design. The flat master and the production panels are what print.</p></div> :
              <WallPhotoEditor onEditing={setEditingPhoto} url={view === 'after' && preview ? preview : photo.url} alt={view === 'after' && preview ? 'Your design scaled on your wall' : 'Your original wall'} aspect={photo.aspect} busy={!!busy} marking={marking} corners={corners} masks={exclusions} maskUrl={detectedMask?.url ?? null} draft={excludeDraft} showMasks={showMasks} seams={showPrintGuides ? printSeams : []} onPoint={markPoint} onRectangle={(a,b) => { try { finishMask(rectangularWallMask(a,b)); } catch (e) { setError(e instanceof Error ? e.message : 'Choose opposite corners.'); setExcludeDraft([]); } }} onCorners={next => { cornersOrigin.current = 'manual'; setCornerSource('manual'); setCorners(next); }} onMasks={setExclusions} />}
              {/* The corners default to the WHOLE PHOTO so a missed detection never
                  blocks the on-wall view — but then the design covers the ceiling,
                  the floor and the furniture, which reads as "it didn't work"
                  (owner, 2026-09-12). Say which it is instead of leaving her to
                  guess from the picture. */}
              {artwork && !wallLocated && <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                {detecting
                  ? 'Still looking for your wall in this photo. "On your wall" switches on by itself the moment it is found.'
                  : 'Your wall has not been found in this photo yet, so the design cannot be placed on it. Tap "Re-mark wall corners" and tap the four corners of the wall, clockwise from the top left.'}
                {' '}Your print files do not wait for this — they are already correct.
              </p>}
              <label className="mt-3 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={showMasks} onChange={e => setShowMasks(e.target.checked)} />Show glass mask overlay and editing handles</label>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => { cornersOrigin.current = 'manual'; setCornerSource('manual'); setCorners([]); setMarking('wall'); setExcludeDraft([]); setView('before'); }}><RotateCcw className="mr-1 h-3 w-3" />Re-mark wall corners</Button>
                <Button size="sm" variant={marking === 'rectangle' ? 'default' : 'outline'} disabled={!!busy} onClick={() => { setMarking('rectangle'); setShowMasks(true); setExcludeDraft([]); setView('before'); }}>Mask window / drapes</Button>
                <Button size="sm" variant={marking === 'exclude' ? 'default' : 'outline'} disabled={!!busy} onClick={() => { setMarking('exclude'); setShowMasks(true); setExcludeDraft([]); setView('before'); }}>Outline an object</Button>
                {marking === 'exclude' && <Button size="sm" disabled={!!busy || excludeDraft.length < 3} onClick={() => finishMask(excludeDraft)}>Finish mask</Button>}
                {(marking === 'exclude' || marking === 'rectangle') && <>
                  <Button size="sm" variant="ghost" disabled={!!busy || !excludeDraft.length} onClick={() => setExcludeDraft(old => old.slice(0,-1))}>Undo mask point</Button>
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { setExcludeDraft([]); setMarking(cornersValid ? null : 'wall'); }}>Cancel mask</Button>
                </>}
                {!!exclusions.length && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setExclusions(old => old.slice(0,-1))}>Remove last mask</Button>}
                {exclusions.length > 1 && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setExclusions([])}>Clear all masks</Button>}
                {detectedMask && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setDetectedMask(null)}>Clear detected areas</Button>}
              </div>
              <p className="mt-2 text-xs text-slate-600">Mask the window and each drape to keep their original appearance while the design covers the wall around them. Use Outline an object for irregular edges. Select a finished mask and drag its white points to adjust; arrow keys fine-tune a focused point. {exclusions.length > 0 && `${exclusions.length} protected ${exclusions.length === 1 ? 'area' : 'areas'}.`}</p>
              {marking && <p role="status" className="mt-3 text-sm text-violet-700">{marking === 'wall' ? (corners.length >= 4 ? 'Corners are set. Drag a point to adjust, or tap the top-left corner to start over.' : 'Tap corner ' + (corners.length + 1) + ': ' + cornerNames[corners.length] + '. Wall corners control the preview only.') : marking === 'rectangle' ? excludeDraft.length ? 'Now tap the opposite corner. Everything inside the rectangle will stay unchanged.' : 'Drag a box around the window or drapes, or tap two opposite corners.' : 'Tap around the edge of the drapes or object, then choose Finish mask.'}</p>}
              {!marking && cornersValid && <p className="mt-3 text-xs text-slate-500">Measured wall: {width}″ W × {height}″ H. Placement follows the selected corners.</p>}
              {corners.length > 0 && <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Adjust corner positions</summary><div className="mt-2 grid grid-cols-2 gap-2">{corners.map((p,i) => <div key={i}><span>{i+1}. {cornerNames[i]}</span><div className="flex gap-1">{(['x','y'] as const).map(axis => <label key={axis}>{axis} %<input disabled={!!busy} aria-label={'Corner ' + (i+1) + ' ' + axis + ' percent'} type="number" min="0" max="100" step="0.1" className={inputClass} value={Number((p[axis]*100).toFixed(2))} onChange={e => setCorners(old => old.map((q,j) => j === i ? { ...q, [axis]: Number(e.target.value)/100 } : q))} /></label>)}</div></div>)}</div></details>}
            </div> : !artwork && <div className="flex min-h-96 flex-col items-center justify-center rounded-xl bg-slate-100 p-8 text-center"><ImageIcon className="mb-4 h-12 w-12 text-slate-300" /><h2 className="font-semibold">See the design on your wall</h2><p className="mt-2 max-w-sm text-sm text-slate-500">Describe a design and choose Generate wall design, or upload your own artwork. Add a wall photo whenever you want to preview it in your room.</p></div>}
            </div>
            {busy && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-violet-700"><Loader2 className="h-4 w-4 animate-spin" />{busy}…</p>}
          </section>
          <section className={panelClass}><label className="block text-sm">Project name<input className={inputClass} maxLength={200} value={name} onChange={e => setName(e.target.value)} disabled={!!busy} /></label><div className="mt-4 flex flex-wrap gap-2"><Button disabled={!!busy || !artwork || !dimensionsValid || !metrics} onClick={() => void run('Saving project', () => persistCurrent())}><Save className="mr-2 h-4 w-4" />Save project</Button>{preview && !rendering && !busy ? <Button asChild variant="outline"><a href={preview} download="wallpro-wall-preview.png"><Download className="mr-2 h-4 w-4" />Download wall preview</a></Button> : <Button variant="outline" disabled>Download wall preview</Button>}{artworkDownload && artworkDownload.source === (artwork?.path || artwork?.url) ? <Button asChild variant="outline"><a href={artworkDownload.url} download={artworkDownload.name}>Download artwork</a></Button> : <Button variant="outline" disabled={!!busy || !artwork} onClick={() => void prepareArtworkDownload()}>Prepare artwork download</Button>}</div><p className="mt-3 text-xs text-slate-500">The wall photo download is a visual proof. Use Prepare print files below for full-size panel PDFs.</p></section>
          {artwork && <section className={panelClass} aria-label="Refine and approve">
            <h2 className="font-semibold">Refine this design</h2>
            <p className="mt-1 text-sm text-slate-600">Changes are applied to the current version and saved as the next version. Composition and everything you do not mention stay as they are.{currentVersion ? ` Current: V${currentVersion.version_no}${currentVersion.status === 'approved' ? ' (approved)' : ''}.` : ''}</p>
            <div className="mt-3 flex flex-wrap gap-1">{['Change colours', 'Remove an object', 'Add an object', 'Make it busier', 'Make it simpler', 'More negative space', 'Match my reference', 'Extend the design'].map(q => <Button key={q} size="sm" variant="outline" disabled={!!busy} onClick={() => setRefinePrompt(p => (p ? p + ' ' : '') + ({ 'Change colours': 'Change the colours: ', 'Remove an object': 'Remove ', 'Add an object': 'Add ', 'Make it busier': 'Make the design busier with more motifs.', 'Make it simpler': 'Make the design simpler and more minimal.', 'More negative space': 'Keep everything but add more negative space.', 'Match my reference': 'Match the colour in the reference image.', 'Extend the design': 'Extend the design to the right, continuing the same composition.' }[q] || q))}>{q}</Button>)}</div>
            <label className="mt-3 block text-sm">Describe what you want changed<textarea className={inputClass + ' min-h-20'} maxLength={6000} value={refinePrompt} disabled={!!busy} placeholder="Make the flowers smaller and the background charcoal…" onChange={e => setRefinePrompt(e.target.value)} /></label>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant={maskMode ? 'default' : 'outline'} disabled={!!busy} onClick={() => setMaskMode(m => !m)}>{maskMode ? 'Drawing mask: drag boxes on the design' : 'Only change an area'}</Button>
              {maskRects.length > 0 && <><span className="text-xs text-slate-600">{maskRects.length} area{maskRects.length === 1 ? '' : 's'} selected; everything outside is kept pixel for pixel.</span><Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setMaskRects(old => old.slice(0, -1))}>Undo area</Button><Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { setMaskRects([]); setMaskMode(false); }}>Clear</Button></>}
              {uploadControl('reference', reference ? 'Replace reference image' : 'Add a reference image (optional)')}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button className="bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-600 text-white" disabled={!!busy || !refinePrompt.trim()} onClick={() => void refine()}><Wand2 className="mr-2 h-4 w-4" />Refine this design</Button>
              {currentVersion && currentVersion.status !== 'approved' && <Button variant="outline" disabled={!!busy} onClick={() => void approveCurrent()}>Approve V{currentVersion.version_no} for production</Button>}
              {currentVersion?.status === 'approved' && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">V{currentVersion.version_no} approved</span>}
              <span className="text-xs text-slate-500">1 design token per refinement.</span>
            </div>
            {currentVersionId && (entitled
              ? <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs font-semibold text-emerald-900">Print-ready wall file unlocked for this version.</p>
              : <div className="mt-3 flex items-center gap-2">
                  <Button variant="outline" disabled={!!busy} onClick={() => void run('Opening checkout', async () => { window.location.assign(await startWallProCheckout(currentVersionId, 'wallpro_custom_file', '/printpro/wallpro')); })}>Unlock My Print-Ready Wall File — $149</Button>
                  <span className="text-xs text-slate-500">Seamless-verified, panelized to the roll, at your exact wall dimensions.</span>
                </div>)}
            {versions.length > 0 && <div className="mt-4"><p className="text-sm font-semibold">Version history</p>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">{versions.map(v => <button key={v.id} type="button" disabled={!!busy || v.id === currentVersionId} onClick={() => void restoreVersion(v)} className={'w-36 shrink-0 rounded-lg border p-2 text-left text-xs ' + (v.id === currentVersionId ? 'border-violet-500 bg-violet-50' : 'border-slate-200 hover:border-violet-400')}>
                <div className="aspect-[4/3] overflow-hidden rounded bg-slate-100">{versionThumbs[v.artwork_path] && <img src={versionThumbs[v.artwork_path]} alt={'Version ' + v.version_no} className="h-full w-full object-cover" loading="lazy" />}</div>
                <p className="mt-1 font-semibold">V{v.version_no} · {v.kind}{v.status === 'approved' ? ' · approved' : ''}</p>
                <p className="truncate text-slate-500">{v.prompt || v.note || (v.design_id ?? '')}</p>
                {v.id !== currentVersionId && <p className="text-violet-700">Restore</p>}
              </button>)}</div></div>}
          </section>}
          {artwork && versions.length > 0 && (!approvedVersion || approvedVersion.id !== currentVersionId) && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Print files are prepared from the approved version only. {approvedVersion ? `V${approvedVersion.version_no} is approved; restore it or approve the current version.` : 'Approve the current version when the design is right.'}</p>}
          <WallProductionPanels approved={approvedVersion} autoStart={productionKick} busy={!!busy}
            request={{ wallWidthIn: width, wallHeightIn: height, placement, repeatWidthIn: placement === 'repeat' ? repeatWidth : undefined, mirror: !!layout.mirror, bleedIn: printSettings.bleed, overlapIn: printSettings.overlap, panelWidthIn: WALLPRO_PRINT_WIDTH, targetPpi: printSettings.minPpi, wholeWall: true }} />
          <WallPrintOutput artwork={versions.length > 0 ? (approvedVersion && approvedVersion.id === currentVersionId ? tileArtwork : null) : tileArtwork} name={name} projectId={projectId} layout={layout} seamless={seamReceipt} settings={printSettings} onSettings={setPrintSettings} busy={!!busy} run={run} />
        </div>
      </div>
    </div>
  </main>;
}
