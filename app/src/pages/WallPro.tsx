/** WallPro's migrated wall designer. Original creative prompts are in the OS edge
 * function. Physical placement never invokes or changes vehicle production. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Upload, Wand2, Download, Save, ImageIcon, Ruler, RotateCcw, FolderOpen, Loader2, MoveHorizontal, ShieldCheck, LayoutGrid, Settings2, ArrowRight, PlayCircle, Sparkles, Scaling, FileText, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ProfessionalProofSheet } from '@/components/tools/ProfessionalProofSheet';
import { captureWallProof } from '@/lib/wallpro-proof';
import type { DesignProofMetadata } from '@/lib/design-proof-export';
import { WallPhotoEditor } from '@/components/wallpro/WallPhotoEditor';
import { WallPrintOutput } from '@/components/wallpro/WallPrintOutput';
import { BeforeAfter } from '@/components/wallpro/BeforeAfter';
import { WallProHeroProof } from '@/components/wallpro/WallProHeroProof';
import { WallProductionPanels } from '@/components/wallpro/WallProductionPanels';
import { rasterizeDetectionMasks, buildProtectedAreaMask } from '@/lib/wallpro-masks';
import { toWallItems, toggleItem, resetItems, hasOverride, splitItems, itemSummary, serializeWallItems, parseWallItems, wallMaskGuidance, type WallItem } from '@/lib/wallpro-items';
import { accentZoneConfig, isAccentZone, otherZonesWithArtwork, zoneGroupId, zonesInGroup, type WallZone } from '@/lib/wallpro-zones';
import { wallBilling, DEFAULT_WALL_PRINT, planWallPrint, type WallPrintSettings } from '@/lib/wallpro-print-plan';
import { WALL_DESIGN_SKUS, WPW_WALL_FILM_RATE_PER_SQFT, formatMoney, wallProSkuFor, wallQuote } from '@/lib/wallpro-pricing';
import { useStickyOffset, useElementHeight } from '@/lib/use-sticky-offset';
import { wallBrand, WALL_GRADIENT, WALL_CARD, WALL_PAGE_GROUND, WALL_HERO_PROOF, type WallBrandKey } from '@/lib/wallpro-brand';
import { WallProLockup, WallProHeaderRule } from '@/components/wallpro/WallProLockup';
import { ToolAccountMenu } from '@/components/layout/ToolAccountMenu';
import { listWallProofs, wallProofUrl, wallDesignId } from '@/lib/wallpro-api';
import { WallProPrintOffer } from '@/components/wallpro/WallProPrintOffer';
import { WallProFilmOrder } from '@/components/wallpro/WallProFilmOrder';
import { WallProProductDetail } from '@/components/wallpro/WallProProductDetail';
import { WallProSidebar, WallProStepStrip } from '@/components/wallpro/WallProSidebar';
import { WallProStepBoard, WallProOutcomes, activeStepId, type BoardStep } from '@/components/wallpro/WallProStepBoard';
import { useInsideAppShell } from '@/hooks/useIsAppRoute';
import { WALL_DESIGNS } from '@/components/wallpro/galleryData';
import { validWallSize, validWallCorners, wallGenerationBlocker, wallPreviewBlocker, rectangularWallMask, layoutMetrics, WALLPRO_PRINT_WIDTH, homography, projectPoint, UNIT_WALL, type Point, type Placement, type WallLayout, looksLikeWholeFrame } from '@/lib/wallpro-geometry';
import { prepareWallUpload, validateWallUpload, loadWallImage, renderWallPreview, renderZonesPreview, renderFlatWall, canvasBlob } from '@/lib/wallpro-render';
import { measureSeam, blendSeamless, seamLadder, shouldTryBlend, seamlessReceipt, type SeamReport, type SeamlessPreference, type SeamlessReceipt } from '@/lib/wallpro-seamless';
import { AI_VIEW_BADGE, AI_VIEW_EXPLAINER, PRINT_TRUTH_BADGE, PRINT_TRUTH_LINE, aiViewAvailable, canCommitFromView, resolveWallView } from '@/lib/wallpro-ai-view';
import { supabase } from '@/integrations/supabase/client';
import { isAllowlistedAdmin } from '@/lib/admin-allowlist';
import { VIEW_AS_KEY } from '@/hooks/useUserTier';
import { WALL_STYLE_CHIPS, appendStyleChip, autoRepeatWidthIn, autoWallScale, clampPatternScale, patternDrawnWidthIn, patternPpi, patternScaleLabel, patternScaleWord, patternSizeAtScale, flatPaneView, PATTERN_SCALE_MAX, PATTERN_SCALE_MIN, PATTERN_SCALE_PRESETS, PATTERN_SCALE_STEP, type PatternSize, type WallBox } from '@/lib/wallpro-scale';
import { Slider } from '@/components/ui/slider';
import { wallUser, wallFreeReason, saveWallItemsFile, readWallItemsFile, uploadWallAsset, openWallAsset, openWallAssets, generateWall, detectWall, renderWallView, saveWallProject, wallHistory, getWallProject, listWallCatalog, listWallVersions, createWallVersion, approveWallVersion, sha256Hex, wallProEntitlements, startWallProCheckout, type WallAsset, type WallVersion, type WallVersionKind, type WallProEntitlement } from '@/lib/wallpro-api';
import type { WallCatalogRow } from '@/lib/wallpro-catalog';
import { beginAppBusy, endAppBusy } from '@/lib/app-busy';

const cornerNames = ['top left', 'top right', 'bottom right', 'bottom left'];
const inputClass = 'mt-1 w-full rounded-lg border wall-edge bg-[hsl(var(--wall-card))] px-3 py-2 text-sm wall-ink';
/** Read, never retyped — WALL_CARD is the one definition (see wallpro-brand). */
const panelClass = WALL_CARD;
type History = Awaited<ReturnType<typeof wallHistory>>;

/**
 * ONE NUMBERED STEP, WITH A REAL ICON (Trish 2026-09-16: "must show it like
 * this so it shows steps and then the start... with proper icons").
 *
 * WallPro's form is one continuous, deeply conditional flow -- five design
 * intents each with their own fields, a live two-pane preview beside it --
 * not four equal boxes of interchangeable content. Forcing that into a literal
 * side-by-side row would either clip the tallest step or leave the others
 * mostly empty. This keeps the exact same state, handlers and conditions and
 * changes only what a heading says: every phase gets a numbered badge and an
 * icon, so the page reads top-to-bottom as "step 1, step 2, step 3 — then the
 * result", the same narrative the mockup asked for, without reshaping a
 * working, tested form to match a screenshot's grid.
 */
function StepHeading({ n, icon: Icon, children }: { n: number; icon: LucideIcon; children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 font-semibold">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-fuchsia-600 text-xs font-bold text-white">{n}</span>
      <Icon className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
      {children}
    </h2>
  );
}

/** The project a reload reopens when the URL has lost its ?project=. */
const LAST_PROJECT_KEY = 'wallpro:last-project';

/**
 * The wall designer. ONE component, worn by whichever brand is serving it.
 *
 * Owner, 2026-09-14: the WePrintWraps page "should BE the tool". /wall-wrap
 * therefore renders THIS, with brand="weprintwraps" -- not a second page that
 * describes it. Every capability is the same one the DesignProAI route has,
 * because it is literally the same component: photo upload, corner pinning,
 * the five entry paths, style reference, match upload, before/after, and the
 * print files. A copy would have drifted within a week.
 */
export default function WallPro({ brand = 'designpro' }: { brand?: WallBrandKey } = {}) {
  const theme = wallBrand(brand);
  const [params, setParams] = useSearchParams();
  const [projectId, setProjectId] = useState(() => params.get('project') || crypto.randomUUID());
  // Two wraps on one photo (wallpro-zones.ts): a zone is another project row
  // carrying the same wallPath, so versions, production and entitlements all
  // work per zone with nothing new underneath them.
  const [parentProjectId, setParentProjectId] = useState<string | null>(null);
  const [zoneLabel, setZoneLabel] = useState<string | null>(null);
  const [zones, setZones] = useState<WallZone[]>([]);
  const [addingZone, setAddingZone] = useState(false);
  const [newZoneLabel, setNewZoneLabel] = useState('');
  /** The manual mask tools are a correction, not a step: hidden until asked for. */
  const [showMaskTools, setShowMaskTools] = useState(false);
  /** Signed URLs for the OTHER zones' masters, so they can be drawn onto this
   * zone's photo preview. Keyed by storage path. */
  const [zoneArt, setZoneArt] = useState<Record<string, string>>({});
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
  /**
   * Why the next generation is free — 'trial', 'commercialpro', 'privileged',
   * or null when it is charged. Asked BEFORE anything is spent (owner,
   * 2026-09-14: "We shpuld have a try free"), so the button can promise it
   * rather than the customer discovering it at the point of failure. Fails
   * soft: unknown means the page promises nothing, which is the safe way to be
   * wrong about someone's money.
   */
  const [freeReason, setFreeReason] = useState<string | null>(null);
  const entitled = entitlements.length > 0;
  /** Every order number for this version, oldest purchase first — the same
   *  rendering and the same order the QC board shows, so a customer reading
   *  one out and a team member searching for it always match. */
  const orderNumbers = [...entitlements].sort((a, b) => a.paid_at.localeCompare(b.paid_at)).map(e => e.order_number);
  // Ready-to-sell catalog (WrapReady Designs). A pick never regenerates: it
  // loads the approved master and the placement that master was published for.
  const [catalog, setCatalog] = useState<WallCatalogRow[] | null>(null);
  const [catalogThumbs, setCatalogThumbs] = useState<Record<string, string>>({});
  const [catalogIndustry, setCatalogIndustry] = useState('all');
  const [designId, setDesignId] = useState<string | null>(null);
  /**
   * THE LANDING'S "Start designing your wall" HANDS THE BRIEF OVER.
   *
   * Owner, 2026-09-17: the block must WORK end to end, not look like it does.
   * A visitor who types "modern tropical, dark background" on the landing and
   * then finds an empty box in the tool has been made to type it twice, which
   * is worse than not offering the box at all.
   *
   * So the landing navigates with ?prompt= and the tool opens with it already
   * in the brief. Read ONCE on mount: re-reading would fight the customer's own
   * edits every time the URL changed for an unrelated reason.
   */
  const [prompt, setPrompt] = useState(() => params.get('prompt') || '');
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
  const [view, setView] = useState<'before' | 'after' | 'design' | 'ai' | 'compare'>('before');
  const showPrintGuides = false; // Print-seam guides on the photo are an internal aid; the customer page keeps them off.
  const [editingPhoto, setEditingPhoto] = useState(false);
  const [showMasks, setShowMasks] = useState(true);
  const [printSettings, setPrintSettings] = useState<WallPrintSettings>({ ...DEFAULT_WALL_PRINT });
  const [preview, setPreview] = useState<string | null>(null), [rendering, setRendering] = useState(false);
  const [proof, setProof] = useState<{ views: Awaited<ReturnType<typeof captureWallProof>>; name: string; sourceId: string; designId?: string; generationId?: string; projectId: string; wall: NonNullable<DesignProofMetadata['wall']> } | null>(null);
  const [preparingProof, setPreparingProof] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [productionKick, setProductionKick] = useState(0);
  // Pixel-accurate protected areas from detection: one PNG, white where the
  // design must not paint. Preview-only; print panels stay full rectangles.
  const [detectedMask, setDetectedMask] = useState<{ url: string; path: string | null } | null>(null);
  // The opposite of detectedMask: freestanding furniture/equipment detection
  // classified as movable, which the AI view is told to erase and paint
  // through rather than protect (wallpro-occlusion.ts). Preview-only, and
  // never a deterministic guarantee the way detectedMask's recomposite is --
  // best-effort removal is the nature of a generative erase.
  const [removeMask, setRemoveMask] = useState<{ url: string; path: string | null } | null>(null);
  /**
   * THE DETECTED OBJECTS, KEPT AS OBJECTS (owner, 2026-09-17: "if I want them
   * back on wall I simply click on each item and WallPro masks each item with
   * one click").
   *
   * The two masks above are COMPOSITES. Once rasterised there is no "the sofa"
   * to click, so correcting one wrong item used to mean clearing every detected
   * area and hand-drawing the correction. The detector has always returned a
   * labelled, individually-masked list; this holds on to it, and both
   * composites are rebuilt FROM it whenever an item is toggled — so what is
   * protected is always exactly what is currently classed `fixed`.
   */
  const [items, setItems] = useState<WallItem[]>([]);
  // The AI picture of the design on the wall: presentation only, never print.
  const [aiView, setAiView] = useState<{ url: string; path: string; artwork: string; forArtwork: string; forPhoto: string; forScale: string } | null>(null);
  const [aiPainting, setAiPainting] = useState(false);
  // Latest photo and corners, readable from a detection that started earlier.
  const photoRef = useRef<WallAsset | null>(null), cornersRef = useRef<Point[]>([]), exclusionsRef = useRef<Point[][]>([]), artworkRef = useRef<WallAsset | null>(null);
  photoRef.current = photo; cornersRef.current = corners; exclusionsRef.current = exclusions; artworkRef.current = artwork;
  /** Where the detected-item list is stored, so a reopened project is tappable
   * again. Ref-mirrored because several saves run inside async closures that
   * would otherwise persist the path from the render they were created in. */
  const [itemsPath, setItemsPath] = useState<string | null>(null);
  const itemsPathRef = useRef<string | null>(null); itemsPathRef.current = itemsPath;
  // Read by a detection that starts in the same tick a zone is created, before
  // React has committed the state -- an accent zone must never auto-protect
  // the very object it exists to wrap.
  const accentRef = useRef(false);
  accentRef.current = !!parentProjectId;
  // Nobody has to tap corners. A photo starts as the whole frame ('default'),
  // detection tightens it when it can ('detected'), and only a customer's own
  // tap or drag ('manual') is ever protected from being replaced.
  const cornersOrigin = useRef<'default' | 'detected' | 'manual'>('default');
  // The ref drives logic mid-flight; the state drives what the customer is
  // told. 'default' means nobody has found this wall yet and the corners are
  // still the whole photo, so the design covers the ceiling and floor too.
  const [cornerSource, setCornerSource] = useState<'default' | 'detected' | 'manual'>('default');
  /**
   * DID THE DETECTOR ACTUALLY READ THIS WALL (2026-09-22).
   *
   * "Nothing needed protecting on this wall" is a strong claim, and until now
   * it was printed whenever the item list happened to be empty -- including
   * when the detector had returned nothing usable at all. Those are opposite
   * facts and the customer cannot tell them apart from the sentence.
   *
   * A detection whose wall came back as the whole frame has not read the wall,
   * so its masks are not evidence of an unobstructed one either.
   */
  const [wallReadMissed, setWallReadMissed] = useState(false);
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
  /**
   * A FROZEN SENTENCE NEXT TO LIVE STATE WILL EVENTUALLY LIE (2026-09-22).
   *
   * The owner photographed one screen carrying BOTH "Corners set. Nothing on
   * this wall needs keeping — the design covers it all" and, underneath it,
   * "Mark your wall to see the design on it". Two statements about the same
   * wall that cannot both be true.
   *
   * The card is DERIVED — it re-reads `wallLocated` every render and is always
   * right. The notice is a string written once and left there, so any path that
   * later invalidates the corners strands a claim about them on screen. Rather
   * than hunt the one ordering that did it, the contradiction is made
   * structurally impossible: a notice cannot outlive the wall state it was
   * written against.
   *
   * ONLY on the FALSE edge, deliberately. `markPoint` writes "Corners set…"
   * in the same tick that flips this true, and clearing on the true edge would
   * wipe the message the customer is meant to read. Losing the corners is what
   * turns such a message into a lie, and that is the edge this catches.
   */
  const wasLocated = useRef(wallLocated);
  useEffect(() => {
    if (wasLocated.current && !wallLocated) setNotice('');
    wasLocated.current = wallLocated;
  }, [wallLocated]);
  /** Whether the OS AppShell already owns a rail around this page. Read, never
   *  re-derived: it is the same predicate AppShell itself branches on. */
  const insideOsShell = useInsideAppShell();
  /**
   * BRING THE PHOTO TO THE CUSTOMER, NOT THE OTHER WAY ROUND (owner,
   * 2026-09-22: "it's still making me scroll down").
   *
   * Every control that starts a marking mode lives BELOW the photo, so on a
   * phone pressing one left her looking at the buttons while the thing she now
   * has to tap was off screen above. Each of them scrolls the preview into
   * view; the instruction rides on the image itself, so the two arrive
   * together.
   */
  const focusPhoto = () => {
    setTimeout(() => document.getElementById('wall-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  // The AI picture is for one design, one photo and one pattern size; a step
  // Bigger or Smaller makes it stale, the exact-geometry view updates at once,
  // and the tab offers to repaint.
  const scaleKey = placement + '|' + (placement === 'repeat' ? repeatWidth : 0);
  // THE AI VIEW IS AN INTERNAL TOOL NOW (owner, 2026-09-12: "drop the ai view
  // from customer path"). Staff only, and hidden the moment a staff member
  // switches to View as Customer -- the person checking the customer path must
  // not be the one person who cannot see what the customer gets.
  const [staff, setStaff] = useState(false);
  const [viewingAsCustomer, setViewingAsCustomer] = useState(() => {
    try { return localStorage.getItem(VIEW_AS_KEY) === 'free'; } catch { return false; }
  });
  useEffect(() => {
    let live = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) { if (live) setStaff(false); return; }
      if (isAllowlistedAdmin(user.email)) { if (live) setStaff(true); return; }
      const { data: role } = await supabase.from('user_roles').select('role').eq('user_id', user.id).in('role', ['admin', 'tester']).limit(1).maybeSingle();
      if (live) setStaff(!!role);
    });
    // The toggle writes localStorage from another component, so re-read it on
    // focus rather than trusting the value this component mounted with.
    const reread = () => { try { setViewingAsCustomer(localStorage.getItem(VIEW_AS_KEY) === 'free'); } catch { /* keep what we have */ } };
    window.addEventListener('focus', reread);
    window.addEventListener('storage', reread);
    return () => { live = false; window.removeEventListener('focus', reread); window.removeEventListener('storage', reread); };
  }, []);
  const aiAvailable = aiViewAvailable({ staff, viewingAsCustomer });
  // WHERE THE PAGE HEADER STICKS, MEASURED RATHER THAN GUESSED.
  //
  // Owner, 2026-09-12: "One of the items was persistent header yet it's not
  // done on mobile or desktop." It never stuck on either, and the cause was
  // not styling: the app's own site header (components/Header.tsx) is ALSO
  // `sticky top-0`, at z-50. Two stickies pinned to the same offset do not
  // stack -- the higher one wins and the second slides underneath it and is
  // never seen. So this one has to pin at the site header's HEIGHT.
  //
  // That height is content-sized and differs between breakpoints, so it is
  // read off the element instead of hard-coded, and re-read on resize. The
  // selector excludes this header by id, or with the site header absent it
  // would measure itself and pin below its own height.
  //
  // The measurement lives in useStickyOffset now, shared with the WallWrap
  // page, which reproduced this exact bug the first time it was written. The
  // OTHER half of the fix is in index.css: `overflow-x: hidden` on html/body/
  // main under 768px made those elements scroll containers, which disables
  // descendant sticky entirely -- so this header was correctly offset and still
  // scrolled away on a phone. It is `overflow-x: clip` there now.
  const stickyTop = useStickyOffset('wallpro-header');
  /** The page header's own height, so the step strip stacks BELOW it rather
   *  than overlapping it — two sticky bars at one offset do not stack. */
  const headerHeight = useElementHeight('wallpro-header');
  // A comparison needs both halves: the untouched photo and a real composite.
  const canCompare = !!photo && !!artwork && wallLocated && !!preview;
  const billing = wallBilling(width, height, printSettings, WALLPRO_PRINT_WIDTH);
  /** THE PRICE OF THE PATH THEY TOOK. `designMode` IS the SKU (owner's launch
   * list, 2026-09-13: Ready-to-Print $79, Describe $149, Match $149, Design for
   * My Wall $199, File Prep $49, print $3.50/sq ft), so the quote follows the
   * customer's own choice instead of a single hardcoded design fee. */
  const quote = wallQuote({ path: 'design-and-print', designMode, billing });
  useEffect(() => { setView(v => resolveWallView(v, aiAvailable)); }, [aiAvailable]);
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
      wallUser().then(user => saveWallProject(projectId, user.id, name, { wallPath: photo?.path || null, artworkPath: artwork?.path || null, referencePath: reference?.path || null, width, height, placement: next.placement, repeatWidth: next.repeatWidthIn, patternScale: pct, seamPreference, printWidth: WALLPRO_PRINT_WIDTH, printSettings, corners, exclusions, maskPath: detectedMask?.path || null, removeMaskPath: removeMask?.path || null, itemsPath: itemsPathRef.current, parentProjectId, zoneLabel, prompt, designMode, designId, currentVersionId })).catch(() => { /* signed out: the scale still applies on screen */ });
    }, 600);
  }
  // The photo pane opens on the DETERMINISTIC composite, always. It used to
  // open on the AI picture whenever one existed, which made a freehand repaint
  // the first thing a customer saw of their own design (owner, 2026-09-12:
  // "the design it generated and design on photo appear to be different that
  // should never be the case").
  useEffect(() => { if (artwork && photo && wallLocated) setView('after'); }, [!!artwork, !!photo, wallLocated]);
  // The photo pane opens on the AI picture by itself: the model puts the
  // covering on the wall and leaves the window, drapes, shelves and furniture
  // as photographed, with no masks to mark (owner, 2026-09-11: "it should know
  // to not wrap but keep in image"). Once per design-and-photo pair, in the
  // background, never charged; the exact-geometry view stays one tab away.
  const aiAutoKey = useRef<string | null>(null);
  useEffect(() => {
    if (!artwork || !photo || aiViewCurrent || !aiAvailable) return;
    const key = artwork.url + '|' + photo.url;
    if (aiAutoKey.current === key) return;
    aiAutoKey.current = key;
    void paintAiView(artwork, photo, true);
  }, [artwork?.url, photo?.url, aiAvailable]);
  const [history, setHistory] = useState<History | null>(null);
  /** The last project the customer worked on — OFFERED, not opened. See the
   *  restore effect below for why this is a banner and not a page load. */
  const [resumable, setResumable] = useState<{ id: string; name: string } | null>(null);
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
  /** One definition for the Generate gate, shared by the in-form button and
   * the sticky phone bar so the two can never disagree about readiness. */
  const generateDisabled = !!generationBlocker || (intent === 'prompt' && !prompt.trim()) || (intent === 'match' && !reference) || (intent === 'wall' && !photo);
  const generateLabel = intent === 'match' ? 'Recreate my design print-ready' : intent === 'wall' ? 'Design for my wall' : 'Generate wall design';
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
  // WHICH PICTURE THE FLAT PANE SHOWS, AND WHY IT IS NEVER THE BARE TILE.
  //
  // Owner, 2026-09-12, on a matched design: "why does it keep generating the
  // pattern I uploaded to match with much smaller pattern... when I clicked
  // generate it had correct pattern on wall and I had to manually adjust bar
  // just to see it the right size."
  //
  // Nothing was generating small. The generation rows show the scale brain
  // sending exactly what it should (120" wall -> 60" repeat, 142" -> 72",
  // about two across). What she was looking at was the BARE GENERATED TILE:
  // one 60-inch tile, which is HALF the wall, shown in a square box against a
  // reference photograph that depicts a whole wall. Of course it reads as half
  // size -- it is half the wall.
  //
  // `flatShown` already held the previous wall-scale render across a re-render,
  // but on the FIRST paint after a generation there is no previous one, and
  // `renderFlatWall` is an async canvas pass over a 4096-square tile, which on
  // a phone is seconds. That window is what she saw, every time, and it is the
  // window she reached for the slider in -- so the UI was teaching her to
  // enlarge a pattern that was already correct.
  //
  // So the bare tile is now shown ONLY while a refinement mask is being drawn,
  // where it is the right picture because the mask coordinates belong to the
  // tile. Otherwise the pane draws at WALL SCALE from the first frame: the
  // exact canvas when it exists, else the CSS tiling that already backs the
  // slider, which is instant and uses the same geometry. Flat pane, on-wall
  // view and print file now agree from the moment a design lands.
  const flatView = flatPaneView({
    maskActive: maskMode !== null || maskRects.length > 0,
    settling: scaleSettling,
    hasCanvas: !!flatShown,
    hasCssTile: !!draftTile,
  });

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
      // THE BLEND IS ATTEMPTED BEFORE MIRROR IS CHOSEN, NOT AFTER (2026-09-22).
      // `seamLadder` cannot prefer the blend over the flip on a promise — the
      // crossfade has to be run and MEASURED, because whether it closes this
      // particular tile is a fact about these pixels. It is ~one pass over the
      // tile on a canvas she is already looking at, and it is what stands
      // between her design and a kaleidoscope.
      let blended: Uint8ClampedArray | null = null, after: SeamReport | null = null;
      if (shouldTryBlend(before, seamPreference)) {
        blended = blendSeamless(pixels.data, tile.width, tile.height);
        after = measureSeam(blended, tile.width, tile.height);
      }
      const method = seamLadder(before, after, seamPreference);
      let tiled: WallAsset = artwork;
      if (method === 'blend' && blended) {
        ctx.putImageData(new ImageData(blended, tile.width, tile.height), 0, 0);
        const blob = await canvasBlob(tile);
        if (!active) return;
        owned = URL.createObjectURL(blob);
        // Derived deterministically from the stored artwork; never uploaded itself.
        tiled = { url: owned, aspect: artwork.aspect };
      } else {
        // A measured blend that did not close the tile is evidence about the
        // blend, not about what prints. The receipt carries `before` alone so
        // nothing downstream reads a rejected repair as the shipped pixels.
        after = null;
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
    const identity = [photo?.url, previewArt?.url, tileArtwork?.url, JSON.stringify(corners), JSON.stringify(exclusions), detectedMask?.url, editingPhoto, projectId, JSON.stringify(Object.keys(zoneArt).sort())].join('|');
    if (identity !== previewIdentity.current) {
      previewIdentity.current = identity;
      setPreview(null);
      if (previewUrl.current) { URL.revokeObjectURL(previewUrl.current); previewUrl.current = null; }
    }
    canvas.current = null;
    if (editingPhoto || !photo || !previewArt || !tileArtwork || !seamReady || !wallLocated || !dimensionsValid || !metrics) { setRendering(false); return; }
    setRendering(true);
    // Any other zone already wrapped on this same photo is drawn first, so the
    // customer sees the fireplace and the wall together. Each sibling carries
    // its own corners and its own inches; the zone being edited goes on last.
    const passes = [
      ...otherZonesWithArtwork(zones, projectId)
        .filter(z => z.artworkPath && zoneArt[z.artworkPath])
        .map(z => ({ artworkUrl: zoneArt[z.artworkPath!], corners: z.corners, layout: { width: z.width, height: z.height, mode: z.placement, repeatWidth: z.repeatWidth } as WallLayout })),
      { artworkUrl: tileArtwork.url, corners, exclusions, layout, maskUrl: detectedMask?.url ?? null },
    ];
    renderZonesPreview(photo.url, passes, () => version !== previewVersion.current)
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
  }, [photo, artwork, corners, exclusions, detectedMask?.url, width, height, placement, repeatWidth, editingPhoto, seamCurrent, zones, zoneArt, projectId]);
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError(''); setNotice(''); beginAppBusy();
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'The operation could not be completed.'); }
    finally { setBusy(''); endAppBusy(); }
  }

  async function openDesignProof() {
    if (!photo || !preview || !canvas.current || rendering || !artwork || !wallLocated || !billing || !dimensionsValid || !seamReady || scaleSettling || preparingProof || busy || detecting) return;
    const version = previewVersion.current;
    const projectName = name.trim() || 'My wall design';
    const snapshot = { name: zoneLabel ? `${projectName} — ${zoneLabel}` : projectName, sourceId: currentVersionId || projectId,
      designId: currentVersion ? wallDesignId(currentVersion.id) : designId || undefined,
      generationId: currentVersion?.generation_id || undefined, projectId,
      wall: { widthInches: width, heightInches: height, squareFeet: billing.wallSqFt, linearFeet: billing.linearFeet, panels: billing.panels } };
    setPreparingProof(true); setError('');
    try {
      const views = await captureWallProof(photo.url, canvas.current, corners);
      if (version !== previewVersion.current) throw new Error('The wall changed while preparing the proof. Open it again when the preview finishes.');
      setProof({ ...snapshot, views });
    } catch (e) { setError(e instanceof Error ? e.message : 'The proof could not be prepared.'); }
    finally { setPreparingProof(false); }
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
        setPhoto(asset); setCorners([]); cornersOrigin.current = 'default'; setCornerSource('default'); setWallReadMissed(false); setExclusions([]); setDetectedMask(null); setRemoveMask(null); setExcludeDraft([]); setView('before');
        /**
         * ASK FOR THE FOUR CORNERS IMMEDIATELY (owner, 2026-09-18, with a photo
         * uploaded and the page stuck on "Detecting…": "It should ask customer
         * to mark corners and they just touch corners").
         *
         * The page used to open on "Detecting…" and wait. When detection is
         * slow — or, as on the live site tonight, when the request never leaves
         * the browser at all — the customer is left watching a spinner with
         * nothing to do and no idea they are allowed to proceed. Four taps take
         * five seconds, need no network, and cannot fail.
         *
         * So marking mode is ON the moment the photo lands, and the instruction
         * names the next corner by name. Detection still runs in the
         * background and still fills the corners in if it lands FIRST and the
         * customer has not started tapping (`markPoint` flips the origin to
         * 'manual' on the first tap, and detectPhoto already refuses to
         * overwrite hand-marked corners). Whichever arrives first wins; the
         * customer is never blocked on the one that might not arrive.
         *
         * This is the owner's own standing ruling applied one step earlier --
         * 2026-09-11, after auto-masks swallowed a wall: "just have people mark
         * it."
         */
        setMarking('wall');
        void detectInBackground(asset, true);
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
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed wall-edge bg-[hsl(var(--wall-field))] p-4 text-sm font-medium hover:border-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
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
    // ONE-TOUCH MASKING SURVIVES A REOPEN (owner, 2026-09-21). The composites
    // already restored from maskPath/removeMaskPath; without this the photo
    // came back with nothing labelled and nothing tappable, because detection
    // runs only on a fresh upload. Fails soft to today's behaviour.
    setItems([]); setItemsPath(typeof config.itemsPath === 'string' ? config.itemsPath : null);
    if (typeof config.itemsPath === 'string' && config.itemsPath) {
      readWallItemsFile(config.itemsPath)
        .then(payload => setItems(parseWallItems(payload)))
        .catch(() => { /* nothing tappable, exactly as before this existed */ });
    }
    setParentProjectId(isAccentZone(config) ? String(config.parentProjectId) : null);
    setZoneLabel(typeof config.zoneLabel === 'string' && config.zoneLabel.trim() ? config.zoneLabel.trim().slice(0, 40) : null);
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
    setDetectedMask(null); setRemoveMask(null);
    if (typeof config.maskPath === 'string' && config.maskPath) openWallAsset(config.maskPath).then(url => setDetectedMask({ url, path: config.maskPath })).catch(() => { /* the polygons and corners still restore */ });
    if (typeof config.removeMaskPath === 'string' && config.removeMaskPath) openWallAsset(config.removeMaskPath).then(url => setRemoveMask({ url, path: config.removeMaskPath })).catch(() => { /* the protected areas and corners still restore */ });
    setView(art ? 'after' : 'before');
    setName(title || 'Wall design'); setHistory(null);
    if (id) { setProjectId(id); setParams({ project: id }, { replace: true }); }
    /**
     * A REOPENED WALL IS STILL TAPPABLE (owner, 2026-09-21: "No hand drawing I
     * need one touch masks object").
     *
     * Detection runs on a fresh upload and on a new accent zone -- never on a
     * restore. So every reopened project arrived with nothing labelled, and the
     * only masking left on the table was the pencil. Projects saved since the
     * item list became persistent bring their own items back above; this covers
     * the ones that never had any.
     *
     * STRICTLY WHEN THERE IS NOTHING TO LOSE. Applying detection clears
     * hand-drawn areas by design -- the detector's answer and a customer's
     * drawings cannot both claim the same wall -- so a project that carries
     * either is left exactly as the customer left it. And because the list now
     * persists, this costs one detection per project, once, not one per open.
     */
    const nothingToLose = !config.itemsPath && !config.maskPath && !config.removeMaskPath
      && !(Array.isArray(config.exclusions) && config.exclusions.length);
    if (wall && nothingToLose) void detectInBackground(wall, true);
  }
  useEffect(() => {
    // The catalog is browsable without signing in; failures leave the AI path untouched.
    let active = true;
    listWallCatalog().then(async rows => {
      if (!active) return;
      setCatalog(rows);
      if (rows.length && !params.get('project')) setDesignMode('library');
      // A saved room mockup, when one exists, is the listing image: the
      // pattern at its real size on a real wall, caption included.
      setCatalogThumbs(await openWallAssets(rows.flatMap(r => [r.thumb_path || r.master_path, ...(r.mockups?.length ? [r.mockups[0].path] : [])])).catch(() => ({})));
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
    await saveWallProject(projectId, user.id, name, { wallPath: photo?.path || null, artworkPath, referencePath: reference?.path || null, width, height, placement: extra.placement ?? placement, repeatWidth: extra.repeatWidthIn ?? repeatWidth, seamPreference, printWidth: WALLPRO_PRINT_WIDTH, printSettings, corners, exclusions, maskPath: detectedMask?.path || null, removeMaskPath: removeMask?.path || null, itemsPath: itemsPathRef.current, parentProjectId, zoneLabel, prompt, designMode, designId: extra.designId ?? designId, currentVersionId });
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
    // THE CUSTOMER'S TAPS ALWAYS WIN, INCLUDING A HALF-FINISHED SET. `handMarked`
    // only catches four VALID corners, so a detection landing mid-tap used to
    // wipe out the two or three already placed and drop the customer back to the
    // start with no explanation. Any tap at all now counts as theirs.
    const started = cornersOrigin.current === 'manual' && cornersRef.current.length > 0;
    const handMarked = started && validWallCorners(cornersRef.current);
    // A DETECTION THAT RETURNS THE FRAME HAS FOUND NOTHING (2026-09-22).
    // `validWallCorners` accepts UNIT_WALL, so without this the "detected"
    // source is handed a quad covering the whole photograph, `wallLocated`
    // goes true, and the design paints over the ceiling, the floor and an
    // open doorway before the customer has seen her own photo. See
    // looksLikeWholeFrame for why a false negative is the cheap direction.
    const cornersOk = !!found.wall && validWallCorners(found.wall) && !looksLikeWholeFrame(found.wall);
    const applied = !started && cornersOk;
    // Recorded whether or not we apply: a customer mid-tap still deserves an
    // honest mask card afterwards.
    setWallReadMissed(!cornersOk);
    if (applied) { setCorners(found.wall!); cornersOrigin.current = 'detected'; setCornerSource('detected'); }
    // Marking mode closes ONLY when detection actually placed the corners. It
    // opened on upload so the customer can tap straight away; closing it on a
    // detection that found nothing would leave them with no corners AND no
    // prompt, which is the state that reads as a broken page.
    if (applied) setMarking(null);
    // Segmentation masks follow the real outline of a bed, a drape or a shelf,
    // so the wall around them keeps the design. The coarse polygon list is only
    // the fallback when segmentation returned nothing usable.
    // Owner (2026-09-12): DesignPro must automatically know what to protect and
    // what to disregard, using common sense -- a window stays and the covering
    // routes around it, an exercise bike in front of the wall is removed and
    // the covering paints straight through. Masking now runs on every upload
    // (applyMasks is kept only for the manual "Detect wall corners again" /
    // re-run path), classified fixed vs movable by wallpro-occlusion.ts.
    // The list survives as ITEMS as well as being rasterised, so each object
    // stays individually clickable (wallpro-items.ts). splitItems reads what is
    // APPLIED, so once a customer has clicked, the composites follow her and
    // not the detector.
    const detectedItems = toWallItems(found.masks);
    const { fixed, movable } = splitItems(detectedItems);
    // An accent zone wraps a fireplace, a chimney breast or a niche -- exactly
    // the architecture the main wall's pass correctly protects as `fixed`.
    // Protecting it here would refuse to paint the thing the customer chose to
    // wrap, so the protect mask is skipped in a zone. Movable clutter standing
    // in front of it is still removed: that instruction is right either way.
    const accent = accentRef.current;
    const [fixedRaster, movableRaster] = applyMasks && asset.width && asset.height
      ? await Promise.all([
          fixed.length && !accent ? rasterizeDetectionMasks(fixed, asset.width, asset.height).catch(() => null) : null,
          movable.length ? rasterizeDetectionMasks(movable, asset.width, asset.height).catch(() => null) : null,
        ])
      : [null, null];
    if (photoRef.current?.url !== asset.url) return;
    let maskCount = 0, removeCount = 0, labels: string[] = [], removeLabels: string[] = [];
    if (!applyMasks) { /* corners only; hand-drawn masks stay as they are */ }
    else {
      // Items are held whenever masking ran, including when the rasteriser
      // produced nothing usable — the labels are still worth showing, and an
      // item with no raster simply contributes nothing to its composite.
      setItems(detectedItems);
      void persistItems(detectedItems, user.id);
      if (fixedRaster) {
        maskCount = fixed.length; labels = fixed.map(m => m.label);
        const blob = await canvasBlob(fixedRaster);
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
      if (movableRaster) {
        removeCount = movable.length; removeLabels = movable.map(m => m.label);
        const blob = await canvasBlob(movableRaster);
        const url = retain(URL.createObjectURL(blob));
        setRemoveMask({ url, path: null });
        uploadWallAsset({ url, aspect: asset.aspect, file: new File([blob], 'remove-areas.png', { type: 'image/png' }) }, user.id)
          .then(path => setRemoveMask(old => old && old.url === url ? { ...old, path } : old)).catch(() => { /* preview keeps the in-memory mask */ });
      } else setRemoveMask(null);
    }
    setExcludeDraft([]); setShowMasks(true);
    setView(artworkRef.current ? 'after' : 'before'); setError('');
    const cornersNote = accent
      ? 'Mark the four corners of the area you are wrapping, and enter ITS size -- not the whole wall\'s.'
      : started ? 'Kept the corners you marked.'
        : applied ? 'Wall corners placed — drag any point to adjust.'
          // NOT "using the whole photo as the wall": that was a lie the page told
          // whenever detection found nothing, and it left the customer believing
          // a wall had been chosen. Ask for the four taps instead.
          : 'Tap the four corners of your wall, clockwise from the top left.';
    if (accent) setNotice(cornersNote + (removeCount ? ` Anything standing in front of it will be painted through (${[...new Set(removeLabels)].slice(0, 4).join(', ')}).` : '') + ' Nothing here is auto-protected: this zone exists to cover it.');
    else if (!applyMasks) setNotice(cornersNote + ' Use "Mask a closet, door or window" for a single item, or "Protect a busy area" to draw one shape around a whole cluttered wall -- a gallery of frames, a mantel, a shelf -- at once. Masks affect the preview only; print panels stay full.');
    else if (maskCount || removeCount) {
      const parts: string[] = [];
      if (maskCount) parts.push(`kept ${maskCount} area${maskCount === 1 ? '' : 's'} exactly as photographed (${[...new Set(labels)].slice(0, 6).join(', ')})`);
      if (removeCount) parts.push(`the AI picture will paint through ${removeCount} item${removeCount === 1 ? '' : 's'} that would be moved before install (${[...new Set(removeLabels)].slice(0, 6).join(', ')})`);
      setNotice(cornersNote + ' ' + parts.join('; ') + '. Clear detected areas removes them. Masks affect the preview only; print panels stay full.' + (found.notes ? ' ' + found.notes : ''));
    }
    else setNotice(cornersNote + ' The objects could not be outlined precisely, so nothing was masked. Use "Mask a closet, door or window" for the opening, "Protect a busy area" for a cluttered wall, or the AI picture, which keeps the room as photographed without masks.');
  }
  /** Detection never holds the form: it is a preview aid, so it runs beside the
   * customer's typing and a signed-out session or a model failure leaves the
   * upload in place and falls back to hand marking. */
  async function detectInBackground(asset: WallAsset, applyMasks = false) {
    // NEVER ASK THE CUSTOMER TO WAIT. Detection is a convenience that may be
    // slow, may fail, or -- as on 2026-09-18 -- may never leave the browser.
    // The instruction is always the thing they can do right now; if detection
    // lands first it replaces this with "Wall corners placed".
    setDetecting(true);
    setNotice('Tap the four corners of your wall, clockwise from the top left. We are also having a look ourselves — whichever finishes first.');
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
      // Hand-drawn masks and any auto-detected protected areas apply to the AI
      // view too, not only the deterministic "on your wall" composite -- best
      // effort: a mask that fails to build or upload just leaves the AI view
      // running on its prose instruction alone, exactly as it always has.
      let maskPath: string | null = null;
      if ((exclusions.length || detectedMask?.url) && wall.width && wall.height) {
        try {
          const maskCanvas = await buildProtectedAreaMask(exclusions, detectedMask?.url ?? null, wall.width, wall.height);
          if (maskCanvas) {
            const blob = await canvasBlob(maskCanvas);
            maskPath = await uploadWallAsset({ url: wall.url, aspect: wall.aspect, file: new File([blob], 'protected-areas.png', { type: 'image/png' }) }, user.id);
          }
        } catch { /* the AI view still renders from the prose instruction alone */ }
      }
      // Items detected as movable (an exercise bike, a chair -- anything an
      // installer would carry out first) are the opposite instruction: never
      // protected, told to be erased and painted through. wallpro-occlusion.ts
      // owns the fixed/movable split; this just rasterises whatever it decided.
      let removePath: string | null = null;
      if (removeMask?.url && wall.width && wall.height) {
        try {
          const removeCanvas = await buildProtectedAreaMask([], removeMask.url, wall.width, wall.height);
          if (removeCanvas) {
            const blob = await canvasBlob(removeCanvas);
            removePath = await uploadWallAsset({ url: wall.url, aspect: wall.aspect, file: new File([blob], 'remove-areas.png', { type: 'image/png' }) }, user.id);
          }
        } catch { /* the AI view still renders from the prose instruction alone */ }
      }
      const result = await renderWallView({ wallPath, artworkPath, maskPath, removePath, placement, repeatWidthIn: placement === 'repeat' ? repeatWidth : null, wallWidthIn: width, wallHeightIn: height });
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
    // tileArtwork, not artwork: the seam-corrected file is what the
    // deterministic composite and the print file both use, so repainting from
    // the raw generation made the AI view differ from the print on TWO counts
    // rather than one (owner, 2026-09-12).
    if (!photo || !artwork || !tileArtwork) return;
    await paintAiView(tileArtwork, photo, false);
  }
  /**
   * Store the item list beside the masks, and put its path on the project.
   *
   * BEST EFFORT, LIKE THE MASK UPLOADS IT SITS WITH. A failed write leaves the
   * items working in this session and the reopen no worse than it was before
   * this existed -- which is the only honest failure mode for a repair to a
   * thing that did not persist at all.
   */
  async function persistItems(next: WallItem[], owner: string) {
    try {
      const path = next.length ? await saveWallItemsFile(owner, serializeWallItems(next)) : null;
      setItemsPath(path); itemsPathRef.current = path;
      if (projectId) await saveWallProject(projectId, owner, name, { ...liveConfig(), itemsPath: path });
    } catch { /* the list still works in this session */ }
  }
  /**
   * ONE CLICK, THEN BOTH COMPOSITES ARE REBUILT FROM THE ITEMS.
   *
   * Not "add this item to the protect mask": the two masks are re-rasterised
   * from the whole list every time, so a toggle in either direction is exact
   * and there is no way for a composite to drift from the items it represents.
   * The cost is re-rasterising a handful of small PNGs, which is milliseconds
   * and no network call.
   *
   * The upload is best-effort exactly as the detection path's is — a failed
   * upload leaves the in-memory mask working, so a signed-out or offline
   * customer still sees their correction on screen.
   */
  async function applyItems(next: WallItem[]) {
    setItems(next);
    // The tap is persisted too, or reopening the project would hand back the
    // DETECTOR's answer and silently undo the customer's correction.
    wallUser().then(user => persistItems(next, user.id)).catch(() => { /* signed out: the tap still applies on screen */ });
    const asset = photoRef.current;
    if (!asset?.width || !asset.height) return;
    const { fixed, movable } = splitItems(next);
    // An accent zone exists to be wrapped, so nothing in it is auto-protected
    // — the same exemption the detection path makes, restated here because a
    // toggle must not reintroduce a protect mask the zone deliberately skips.
    const accent = accentRef.current;
    const [fixedRaster, movableRaster] = await Promise.all([
      fixed.length && !accent ? rasterizeDetectionMasks(fixed, asset.width, asset.height).catch(() => null) : null,
      movable.length ? rasterizeDetectionMasks(movable, asset.width, asset.height).catch(() => null) : null,
    ]);
    if (photoRef.current?.url !== asset.url) return;
    const user = await wallUser().catch(() => null);
    const publish = async (
      raster: HTMLCanvasElement | null,
      name: string,
      set: typeof setDetectedMask,
    ) => {
      if (!raster) { set(null); return; }
      const blob = await canvasBlob(raster);
      const url = retain(URL.createObjectURL(blob));
      set({ url, path: null });
      if (!user) return;
      uploadWallAsset({ url, aspect: asset.aspect, file: new File([blob], name, { type: 'image/png' }) }, user.id)
        .then(path => set(old => (old && old.url === url ? { ...old, path } : old)))
        .catch(() => { /* the preview keeps the in-memory mask */ });
    };
    await Promise.all([
      publish(fixedRaster, 'protected-areas.png', setDetectedMask),
      publish(movableRaster, 'remove-areas.png', setRemoveMask),
    ]);
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
      await saveWallProject(projectId, user.id, name, { wallPath: photo?.path || null, artworkPath: version.artwork_path, referencePath: reference?.path || null, width, height, placement: version.placement, repeatWidth: version.repeat_width_in ? Number(version.repeat_width_in) : repeatWidth, seamPreference, printWidth: WALLPRO_PRINT_WIDTH, printSettings, corners, exclusions, maskPath: detectedMask?.path || null, removeMaskPath: removeMask?.path || null, itemsPath: itemsPathRef.current, parentProjectId, zoneLabel, prompt, designMode, designId: version.design_id || designId, currentVersionId: version.id });
    });
  }
  async function approveCurrent() {
    if (!currentVersion) return;
    // NEVER FROM THE AI VIEW. Approving starts the 150 PPI panel build and is a
    // statement about the print file; the AI view is a freehand painting of one
    // and its motifs do not match. The guard lives here, on the action, rather
    // than only on who can see the view, so it survives the view ever being put
    // back in front of customers.
    if (!canCommitFromView(view)) {
      setView('after');
      setNotice('That was the artist\u2019s impression, not your print file. This is the real one \u2014 approve from here.');
      return;
    }
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
    // ⛔ THE LAST PROJECT IS OFFERED, NEVER AUTO-OPENED (owner, 2026-09-16:
    // "I see header new UI then instantly goes back to old ui and that old ui
    // just keeps my old beige floral wrap in the konva and I need to do more
    // designs").
    //
    // It used to load itself on any bare /printpro/wallpro, for a real reason
    // (2026-09-11: "It refreshed and they're gone"). The cost was worse than
    // the problem: the page paints fresh, then a second later the whole
    // workspace is replaced by whatever the customer last worked on. That
    // reads as the app reverting to an old version -- the new page is visibly
    // there and then visibly gone -- and it makes starting a NEW design
    // impossible without knowing that "Start fresh" is the escape hatch.
    // Nobody hunting for a blank wall guesses that.
    //
    // So: land blank, and put the last project one click away instead. Nothing
    // is lost -- it is saved, it is in "My wall designs", and the banner names
    // it. An explicit ?project= still opens directly, which is what a shared
    // link and the history list both use.
    let remembered: string | null = null;
    try { remembered = localStorage.getItem(LAST_PROJECT_KEY); } catch { remembered = null; }
    if (!remembered) return;
    getWallProject(remembered)
      .then(project => setResumable({ id: project.id, name: project.name }))
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
  // The other zones wrapped on this same photograph. Signed out or offline
  // just means no switcher: a single zone works exactly as it always has.
  useEffect(() => {
    if (!photo?.path) { setZones([]); return; }
    let active = true;
    const here = { wallPath: photo.path, parentProjectId, zoneLabel, artworkPath: artwork?.path || null, corners, width, height, placement, repeatWidth, patternScale };
    wallHistory()
      .then(rows => { if (active) setZones(zonesInGroup(rows.projects as any[], projectId, here)); })
      .catch(() => { if (active) setZones([]); });
    return () => { active = false; };
  }, [photo?.path, projectId, parentProjectId, zoneLabel, artwork?.path, currentVersionId]);
  // Signed masters for the other zones, for the combined on-photo preview.
  useEffect(() => {
    const paths = otherZonesWithArtwork(zones, projectId).map(z => z.artworkPath!).filter(Boolean);
    if (!paths.length) { setZoneArt({}); return; }
    let active = true;
    openWallAssets(paths).then(map => { if (active) setZoneArt(map); }).catch(() => { if (active) setZoneArt({}); });
    return () => { active = false; };
  }, [zones, projectId]);
  /**
   * THE BAND'S PAIRS — curator rows first, the built-in list as the floor.
   *
   * Owner, 2026-09-15: "just create a container and i can place on admin side."
   * /admin/wallpro-proofs writes those rows, so a before/after no longer needs
   * a release. The built-in list in wallpro-brand.ts is NOT retired by that: an
   * empty table, a missing migration or an unreachable database must never
   * blank the band on the partner's own product page, and a marketing strip is
   * the worst possible place to surface an outage. So rows win when they exist
   * and the bundle answers when they do not.
   */
  const [curatedProofs, setCuratedProofs] = useState<typeof theme.proofs | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const rows = await listWallProofs('wallpro', brand);
      if (!live || !rows.length) return;
      setCuratedProofs(rows.map(r => ({
        before: wallProofUrl(r.before_path),
        after: wallProofUrl(r.after_path),
        alt: r.alt, headline: r.headline, caption: r.caption,
      })));
    })();
    return () => { live = false; };
  }, [brand]);
  /**
   * THE GYM LEADS, ALWAYS (owner, 2026-09-16: "the header must be the one with
   * the fitness wall before and after").
   *
   * Curator rows REPLACE the built-in list rather than extend it, so publishing
   * any row used to take the gym off the front of the band — and the first pair
   * is the only one many visitors ever see. It is put back at the head here and
   * de-duplicated by its own file paths, so a curator who publishes the gym as
   * well gets one copy, not two.
   */
  const bandProofs = useMemo(() => {
    const rest = (curatedProofs ?? theme.proofs)
      .filter(p => !WALL_HERO_PROOF || (p.before !== WALL_HERO_PROOF.before && p.after !== WALL_HERO_PROOF.after));
    // No pinned pair is a real state now that the gym is retracted: whatever a
    // curator has published stands on its own, and nothing is invented to lead it.
    return WALL_HERO_PROOF ? [WALL_HERO_PROOF, ...rest] : rest;
  }, [curatedProofs, theme.proofs]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        // Signed out is its OWN state, not 'trial'. The freebie is still
        // waiting for them, but it now costs an account to claim — so the page
        // must not promise "no account needed" and then ask for one at the
        // button, which is the worst possible order to learn it in.
        if (!data?.user) { if (live) setFreeReason('signed-out'); return; }
        const reason = await wallFreeReason(data.user.id);
        if (live) setFreeReason(reason);
      } catch { if (live) setFreeReason(null); }
    })();
    return () => { live = false; };
    // Re-checked after a generation: the trial is spent by the first one.
  }, [versions.length]);

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
      if (rows.length) {
        setEntitlements(rows);
        // THE ORDER NUMBER, AT THE MOMENT OF PAYMENT (owner, 2026-09-16: "once
        // they pay they must get an order number"). This said "Purchase
        // confirmed" and nothing else, so a customer who had just paid had
        // nothing to write down, quote in an email, or read out on the phone --
        // and the team had nothing to look the payment up by except a Stripe
        // session id. The oldest entitlement is this version's first purchase,
        // which is the one the order is filed under.
        const first = [...rows].sort((a, b) => a.paid_at.localeCompare(b.paid_at))[0];
        setNotice(`Purchase confirmed — your order number is ${first.order_number}. Your print-ready wall file can now be produced.`);
        return;
      }
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
    await saveWallProject(projectId, user.id, designName, { wallPath, artworkPath, referencePath, width, height, placement, repeatWidth, seamPreference, printWidth: WALLPRO_PRINT_WIDTH, printSettings, corners, exclusions, maskPath: detectedMask?.path || null, removeMaskPath: removeMask?.path || null, itemsPath: itemsPathRef.current, parentProjectId, zoneLabel, prompt, designMode, designId, currentVersionId });
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
      try { await saveWallProject(projectId, user.id, result.design_name, { wallPath, artworkPath: result.storage_path, referencePath, width, height, placement, repeatWidth, seamPreference, printWidth: WALLPRO_PRINT_WIDTH, printSettings, corners: liveCorners, exclusions: liveExclusions, maskPath: detectedMask?.path || null, removeMaskPath: removeMask?.path || null, itemsPath: itemsPathRef.current, parentProjectId, zoneLabel, prompt, designMode, currentVersionId }); setParams({ project: projectId }, { replace: true }); }
      catch { setNotice('Artwork is saved in My wall designs. Save this project again to retain the wall placement.'); }
      // V1 of a new session, or the next version when the customer generates
      // again inside an existing project.
      await recordVersion('create', art, { intent, prompt, referencePath, generationId: result.request_id, note: result.design_name, placement, repeatWidthIn: placement === 'repeat' ? repeatWidth : null });
    });
  }
  /** The config this zone is currently sitting on, for a save before leaving it. */
  function liveConfig() {
    return { wallPath: photo?.path || null, artworkPath: artwork?.path || null, referencePath: reference?.path || null, width, height, placement, repeatWidth, patternScale, seamPreference, printWidth: WALLPRO_PRINT_WIDTH, printSettings, corners, exclusions, maskPath: detectedMask?.path || null, removeMaskPath: removeMask?.path || null, itemsPath: itemsPathRef.current, parentProjectId, zoneLabel, prompt, designMode, designId, currentVersionId };
  }
  /**
   * Wrap a SECOND area of the same photograph -- a fireplace in brick beside a
   * mural on the wall behind it (owner, 2026-09-12). It is another project on
   * the same wallPath, so it gets its own corners, its own inches, its own
   * design, its own print files and its own purchase, with nothing new
   * underneath it. The zone being left is saved first so switching back finds
   * it whole.
   */
  async function addAccentZone(label: string) {
    if (!photo?.path) return;
    const zoneName = label.trim().slice(0, 40) || 'Accent zone';
    await run('Adding the zone', async () => {
      const user = await wallUser();
      await saveWallProject(projectId, user.id, name, liveConfig());
      const id = crypto.randomUUID();
      const config = accentZoneConfig({ wallPath: photo.path }, zoneGroupId(projectId, { parentProjectId }), zoneName);
      await saveWallProject(id, user.id, zoneName, config);
      await restore(config, id, zoneName);
      // restore() sets the state, but detection starts in this same tick.
      accentRef.current = true;
      setAddingZone(false); setNewZoneLabel('');
      if (photoRef.current) void detectInBackground(photoRef.current, true);
    });
  }
  /** Move to another zone of this photo, saving the one being left. */
  async function openZone(id: string) {
    if (id === projectId) return;
    await run('Opening the zone', async () => {
      const user = await wallUser().catch(() => null);
      if (user) await saveWallProject(projectId, user.id, name, liveConfig()).catch(() => { /* the zone still opens */ });
      const row = await getWallProject(id);
      await restore(row.config, row.id, row.name);
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
    if (next.length === 4) {
      setMarking(null);
      if (!validWallCorners(next)) setError('Those corners cross or form a narrow area. Mark them clockwise starting at the top left.');
      else {
        setError('');
        if (artwork) setView('after');
        /**
         * THE FOURTH TAP HANDS OVER TO THE NEXT QUESTION (owner, 2026-09-18:
         * "It doesn't let me mask, it hides the tools … it should just state
         * next mark your corners by touching corners, then ask you if you want
         * to mask").
         *
         * The mask tools live behind an "Adjust" link that starts closed, so
         * the moment the corners were set the page went quiet and the customer
         * had no idea masking existed at all. Marking the wall and protecting
         * what is on it are two steps of ONE job, so the second one opens
         * itself when the first finishes, with the overlay on so a tap has
         * something visible to land on.
         *
         * Anything the detector already found stays protected by default --
         * framed photos, a mounted TV, shelves -- so the honest prompt is
         * "check what we kept", not "start masking". Skipping is a real answer:
         * nothing here blocks Generate, and print panels are full rectangles
         * whatever is masked.
         */
        // ONE TOUCH, NOT A PENCIL (owner, 2026-09-21: "No hand drawing I need
        // one touch masks object"). This used to open the DRAWING tools here,
        // which taught every customer that masking means tracing polygons --
        // and produced walls carrying three rectangles labelled "Protected 1,
        // 2, 3" while the objects sat already found and already tappable. The
        // masks are shown; the pencil stays behind its toggle for the one case
        // detection comes back empty.
        setShowMasks(true);
        setNotice('Corners set. ' + wallMaskGuidance({ detecting, items, drawnCount: exclusions.length }).headline
          + ' Or go straight to describing your design — nothing here blocks Generate.');
      }
    }
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

  /**
   * The rail's steps, read from the page's own state. Every `done` here is the
   * same fact a button is gated on -- a rail that congratulated you on a step
   * you had not finished would be worse than no rail.
   */
  /** Scroll a step's own section to the top of the page, under the header. */
  const jumpToStep = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  /**
   * THE FOUR CARDS, EACH REPORTING ITS OWN FACT.
   *
   * The owner's mockup numbering, not the page's old one: making "Select wall
   * area" a numbered step is her answering her own complaint, because that is
   * the step she kept failing to find — it was never a step, it lived inside
   * step 1's photo block below the fold.
   *
   * `detail` is a FACT, never an adjective, the same rule the rail already
   * follows: a decorative checklist tells the customer nothing about where the
   * job actually is. Each action does the work rather than naming another
   * button — the lesson "Mark the corners" already learned.
   */
  const boardSteps: BoardStep[] = [
    { id: 'upload-wall', n: 1, label: 'Upload your wall', icon: Upload, done: !!photo, preview: photo?.url ?? null,
      detail: photo ? `${width}" x ${height}" - ${(width * height / 144).toFixed(1)} sq ft` : 'Any photo from your phone, including iPhone HEIC. JPG, PNG, HEIC, max 20 MB.',
      action: { label: photo ? 'Replace photo' : 'Upload your wall', onClick: () => uploadInputs.current.photo?.click() } },
    { id: 'select-wall-area', n: 2, label: 'Select wall area', icon: Ruler, done: wallLocated, preview: photo?.url ?? null,
      detail: !photo ? 'Upload a wall photo first. Print files never wait for this.'
        : wallLocated ? `Corners set ${cornerSource === 'detected' ? 'automatically' : 'by you'}${exclusions.length || items.length ? ` - ${exclusions.length + items.length} protected` : ''}`
          : detecting ? 'Looking for your wall...' : 'Tap the four corners, clockwise from the top left. We exclude windows, doors and furniture.',
      action: photo ? { label: wallLocated ? 'Re-mark the corners' : 'Mark the corners', onClick: () => {
        cornersOrigin.current = 'manual'; setCornerSource('manual');
        setCorners([]); setMarking('wall'); setExcludeDraft([]); setView('before'); focusPhoto();
      } } : undefined },
    { id: 'choose-design', n: 3, label: 'Describe your design', icon: Settings2, done: !!artwork || prompt.trim().length > 0,
      detail: artwork ? WALL_DESIGN_SKUS[designMode].label : prompt.trim() ? prompt.trim().slice(0, 90) : 'Try "modern tropical, dark background". More ways to start are under it.',
      action: { label: 'Describe it', onClick: () => jumpToStep('choose-design') } },
    { id: 'wall-preview', n: 4, label: 'Generate & preview', icon: ImageIcon, done: !!artwork, preview: artwork?.url ?? null,
      detail: artwork ? (photo && wallLocated ? 'Flat master and imposed on your wall' : 'Flat master ready') : 'Get options in seconds, then print-ready files.',
      action: { label: generateLabel, onClick: () => void generate(), disabled: generateDisabled } },
  ];

  const wallSteps = [
    { id: 'upload-wall', label: 'Your wall', done: width > 0 && height > 0,
      detail: width > 0 && height > 0 ? `${width}" x ${height}" - ${(width * height / 144).toFixed(1)} sq ft` : 'Width and height' },
    { id: 'choose-design', label: 'Your design', done: !!artwork,
      detail: artwork ? WALL_DESIGN_SKUS[designMode].label : 'Five ways in' },
    { id: 'wall-preview', label: 'Preview', done: !!artwork,
      detail: artwork ? (photo ? 'Flat and on your wall' : 'Flat master') : 'After you generate' },
    { id: 'print-files', label: 'Print files', done: !!approvedVersion,
      detail: approvedVersion ? `V${approvedVersion.version_no} approved` : `${WALLPRO_PRINT_WIDTH}" panels, 150 PPI` },
    { id: 'order-printed-film', label: 'Buy film', done: false,
      detail: billing ? `${billing.wallSqFt} sq ft - ${formatMoney(Math.round(billing.wallSqFt * WPW_WALL_FILM_RATE_PER_SQFT * 100))}` : 'Priced by the square foot' },
  ];

  // THE THEME SCOPE. Every WallPro surface colour resolves from the variables
  // this attribute selects (index.css), so the partner page stays light and the
  // DesignProAI page is dark WITHOUT a second component. Scoped here rather
  // than on :root because the OS shell around this page has its own palette.
  return <div data-wall-theme={theme.surface} className={`min-h-screen ${WALL_PAGE_GROUND} lg:flex lg:gap-2 lg:px-6`}>
    {/* THE RAIL FOLLOWS THE CHROME, NOT THE BRAND (owner, 2026-09-22: "it's
        currently confusing and has bad ux").
        It used to be `theme.showPrintOffer &&`, which is true only for
        WePrintWraps -- so DesignProAI had no progress indication at all. The
        real constraint is not the brand: it is that on DesignProAI this page
        sits INSIDE the OS AppShell, which already owns a 240px rail, and a
        second one beside it is the double-sidebar defect fixed on ShopFlow the
        same day. So a rail only where no rail exists; the strip everywhere
        else, from the SAME steps array. */}
    {!insideOsShell && <WallProSidebar
      theme={theme} steps={wallSteps} top={stickyTop + 16} busy={!!busy} freeReason={freeReason}
      onHistory={() => void run('Opening wall designs', async () => setHistory(await wallHistory()))}
      onStartFresh={() => { try { localStorage.removeItem(LAST_PROJECT_KEY); } catch { /* nothing remembered */ } window.location.assign(window.location.pathname); }}
    />}
    <main className="wall-ink min-w-0 flex-1 px-4 py-8 md:px-8">
    <Helmet><title>WallPro — Wall Design & Preview | DesignProAI</title></Helmet>
    <div className="mx-auto max-w-7xl space-y-5">
      {/* PERSISTENT HEADER, ON THE PHONE TOO (owner, 2026-09-12: "give wallpro
          a persistent header even on mobile").
          WallPro is a long single-column page on a phone -- upload, wall size,
          brief, pattern size, two preview panes, print -- so the tool's name
          and its two escape hatches scrolled away within a screen and never
          came back. It sticks to the top now. On a phone it is one compact
          row: the wordmark, then the same two actions as icons (labels stay in
          the accessible name and the tooltip), which is what keeps a sticky
          bar from eating the preview it sits above. The tagline is desktop
          only for the same reason. It bleeds to the screen edges with a
          blurred ground so content scrolling under it stays readable. */}
      <header
        id="wallpro-header"
        style={{ top: stickyTop }}
        className="sticky z-30 -mx-4 bg-black px-4 py-3 text-white md:-mx-8 md:px-8 md:py-4"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          {/* A PROPER HEADER, on both breakpoints (owner, 2026-09-12: "there is
              no break under logo no tagline"). The eyebrow, the wordmark and
              the tagline each get their own line, the way a product header
              reads, rather than the one cramped row this was. The tagline is
              what tells a first-time visitor what WallPro is, so it earns its
              line on a phone too. */}
          {/* The lockup lives in WallProLockup so the case study wears the
              identical brand identity instead of a second copy of it. */}
          <WallProLockup theme={theme} />
          {/* The rail carries these on desktop, so the header would show them
              twice. The rail is hidden below lg (a pinned sidebar on a phone
              eats the screen), so on a phone the header keeps them. Brands
              without a rail keep them at every width. */}
          <div className="flex shrink-0 items-center gap-2">
            <span className={`flex items-center gap-2${theme.showPrintOffer ? ' lg:hidden' : ''}`}>
              <Button variant="outline" size="sm" className="md:h-10 md:px-4" disabled={!!busy} title="Start a blank wall. Saved projects remain in My wall designs." onClick={() => { try { localStorage.removeItem(LAST_PROJECT_KEY); } catch { /* nothing remembered */ } window.location.assign(window.location.pathname); }}>
                <RotateCcw className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">Start fresh</span>
              </Button>
              <Button variant="outline" size="sm" className="md:h-10 md:px-4" disabled={!!busy} title="My wall designs" onClick={() => void run('Opening wall designs', async () => setHistory(await wallHistory()))}>
                <FolderOpen className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">My wall designs</span>
              </Button>
            </span>
            {/* THE ACCOUNT CONTROL, ON THE DESIGNPROAI TOOL PAGE ONLY.
                Removing the marketing <Header> from this route took the only
                user menu an app route had with it: the sidebar carries a plan
                pill and the tool list, no identity and no sign-out. This is the
                far-right slot of the one bar the tool owns -- the standard SaaS
                shape -- and it is what "persistent header" was actually asking
                for, since the bar itself already sticks at top: 0.
                NOT on the partner page: a WePrintWraps visitor has no
                DesignProAI account, and offering them one is our brand on
                somebody else's storefront. */}
            {/* THE FAQ, IN THE HEADER (owner, 2026-09-16: "standard wallpro
                that has header faq page on os.designpro"). The body already
                links it, but the body link sits under the fold on a phone and
                the header is the one bar that never moves. Text, not a button:
                it is a reference, and it must not compete with Generate.
                Hidden on the narrowest widths only because the header's other
                two controls already wrap there; the sidebar carries it. */}
            <Link
              to={theme.showPrintOffer ? '/wall-wrap/faq' : '/printpro/wallpro/faq'}
              className="hidden shrink-0 text-sm font-semibold text-white/80 underline-offset-4 hover:text-white hover:underline sm:inline"
            >
              FAQ
            </Link>
            {!theme.showPrintOffer && <ToolAccountMenu />}
            {!theme.showPrintOffer && <Link to="/wallpro" className="hidden text-sm font-semibold text-white/80 hover:text-white sm:inline">Overview</Link>}
          </div>
        </div>
        {/* THE RULE between the header and the page (owner, 2026-09-14: "Add a
            border blue and white gradiant in between persistent header and
            page"). It replaces the flat slate hairline, and it bleeds past the
            header's own padding so it reads as an edge of the bar rather than a
            line drawn inside it. Two pixels: enough to carry a gradient, not so
            much that it becomes a band of its own. */}
        <WallProHeaderRule />
      </header>
      {/* The progress strip, directly under the header it sticks below. Shown
          at every width inside the OS shell (where there is no WallPro rail)
          and below lg on the partner page (where the rail takes over). One
          `steps` array feeds both -- two lists of the page's own progress
          would drift the first time a step moved. */}
      <WallProStepStrip steps={wallSteps} top={stickyTop + headerHeight} className={insideOsShell ? '' : 'lg:hidden'} />
      {/* PICK UP WHERE YOU LEFT OFF — one click, never automatically.
          This is what replaced the silent auto-restore: the customer lands on
          a blank wall ready for a NEW design, and the one they were last in is
          named right here. It clears itself the moment they start work, so it
          can never sit over a wall they are designing. */}
      {/* `projectId` is NOT the guard: it is seeded with a fresh uuid on every
          mount, so it is always truthy. What means "this page was opened at a
          specific project" is the URL. */}
      {resumable && !photo && !artwork && !params.get('project') && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2.5">
          <p className="text-sm wall-muted">
            Picking up where you left off? Your last design is saved as{' '}
            <strong className="font-semibold wall-ink">{resumable.name || 'Untitled wall'}</strong>.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => {
              setResumable(null);
              void run('Opening your last project', async () => {
                const project = await getWallProject(resumable.id);
                await restore(project.config, project.id, project.name);
              });
            }}>
              <FolderOpen className="mr-2 h-4 w-4" />Reopen it
            </Button>
            {/* Dismiss FORGETS it, so the banner does not come back on every
                load for somebody who has moved on to a new wall. The project
                itself is untouched and still in "My wall designs". */}
            <Button size="sm" variant="ghost" onClick={() => {
              setResumable(null);
              try { localStorage.removeItem(LAST_PROJECT_KEY); } catch { /* nothing remembered */ }
            }}>
              Start something new
            </Button>
          </div>
        </div>
      )}
      {/* The proof band, and ONLY before they start. Its whole job is to answer
          "what does this do?" for someone who has just landed; once a wall photo
          or artwork exists the customer has their own before and after in the
          preview pane, and a stranger's gym is in the way. */}
      {/* ABOVE THE SCROLL (owner, 2026-09-14: "Above scroll custom wall wrap
          design now or like on demand wall wrap design & file output"). The
          headline says what this page DOES beside a room it actually did it to,
          so the claim and its proof are one object. It clears the moment work
          starts -- a customer with their own wall on screen does not need to be
          told what the tool is. */}
      {/* ⚠️ THE HEADLINE IS NOT PART OF THE PROOF, AND GATING IT ON ONE ERASED
          THE PAGE'S OWN MASTHEAD (2026-09-21, caused here).

          This whole section used to require `bandProofs.length > 0`. That read
          as "no example, no band", which is right for the SLIDER and wrong for
          everything beside it: the headline, the sentence that says what the
          tool does, and the two links to the case study and the prices do not
          depend on anybody's photograph.

          Two unrelated removals then emptied the list from both ends. The
          owner's own home came out on 09-18 ("remove my photo ... just show the
          others") -- two entries, because the spa pair and the slat pair are
          the same room. The gym pair came out on 09-21 when its generated
          "after" was found to carry a real company's trademark. WALL_PROOFS hit
          zero, `WallProHeroProof` correctly rendered null, and the gate took
          the masthead down with it. The tool opened on a bare "1. Upload your
          wall" and looked unfinished (owner, 2026-09-22: "Wpw wallpro should
          look like this", against a screenshot of the band).

          So the two are separated. The copy renders whenever the customer has
          not started; the slider renders only when there is something honest to
          put in it, and the grid drops to one column when there is not. Nothing
          is invented to fill the pane -- an empty showcase is still better than
          a padded one, which is exactly why the list is empty. */}
      {/* ── THE HERO (owner, 2026-09-22, against a mockup of this exact block:
             "This is design/order page must look fix it") ──────────────────

          The masthead this replaces was four lines of copy. What the owner
          drew is a HERO: an eyebrow, a three-line headline with the last line
          in the brand gradient, the sentence, two actions, and a row of four
          claims, beside a before/after of a wall this tool actually did.

          THE ACTIONS ARE NOT NEW DOORS. "Start designing" scrolls to step 1,
          which is on this same page a few hundred pixels down; "Watch how it
          works" is the case study that already exists per brand. Neither
          invents a route, and neither is a second way to do something the
          tool already does -- RULE 0.27, one source, never a second
          reconstruction of the product's own front half.

          IT IS ONE COMPONENT ON TWO SURFACES. Every colour here resolves from
          the `wall-*` tokens that `data-wall-theme` selects, so this is the
          dark hero on DesignProAI and the white one on the WePrintWraps page
          without a second copy of the markup. The only per-brand text is the
          sentence that names the printer, which is the whole reason the brand
          table exists. */}
      {!photo && !artwork && (
        <section className={`mx-auto mt-5 grid max-w-6xl items-center gap-6 lg:gap-10 ${bandProofs.length > 0 ? 'lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]' : ''}`}>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-500 md:text-xs">
              From idea to installed
            </p>
            {/* The line break is authored, not left to the measure: "Design a
                wall." must land alone, because it is the promise and the rest
                is the payoff. `text-balance` would re-wrap it per viewport. */}
            <h2 className="mt-3 text-4xl font-extrabold leading-[1.03] tracking-tight wall-ink md:text-5xl">
              Design a wall.<br />Leave with{' '}
              <span className="bg-gradient-to-r from-blue-500 to-fuchsia-500 bg-clip-text text-transparent">
                production files.
              </span>
            </h2>
            <p className="mt-4 max-w-[46ch] text-sm wall-muted md:text-base">
              {/* The partner's name belongs on the partner's page. On DesignProAI
                  the same sentence would promise a printer this page does not
                  sell -- and the whole point of the brand table is that one
                  component can say the true thing on either domain. */}
              {theme.showPrintOffer
                ? <>Designed in WallPro, printed by WePrintWraps. Upload a wall, describe your
                    vision, and take print-ready wall wrap designs — scaled, panelized and ready
                    for production, whether we print them or you do.</>
                : <>Upload a wall, describe your vision, and let WallPro generate print-ready
                    wall wrap designs — scaled, panelized and ready for production.</>}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {/* An anchor, not a router link: step 1 is on this page. */}
              <a
                href="#upload-wall"
                className={`inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-95 ${WALL_GRADIENT}`}
              >
                Start designing <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
              {/* Each brand's own case study. Sending a DesignProAI customer to
                  the partner's version put a printer's logo, a printer's film
                  price and "Order printed film" in front of somebody who came
                  here for the files (owner, 2026-09-16). */}
              <Link
                to={theme.showPrintOffer ? '/wall-wrap/how-it-works' : '/printpro/wallpro/how-it-works'}
                className="inline-flex items-center gap-2 rounded-full border wall-edge px-6 py-3 text-sm font-semibold wall-ink transition hover:border-blue-500"
              >
                <PlayCircle className="h-4 w-4" aria-hidden="true" /> See a real wall, bare to installed
              </Link>
            </div>
            {/* THE FOUR CLAIMS, AND WHY THESE FOUR. Each one is something this
                repository can actually point at: the generator, autoWallScale,
                the 150-PPI production floor, and -- on the partner brand only
                -- the printer standing behind it. The DesignProAI page gets a
                fourth claim about the file formats instead, because "trusted by
                installers" is the PRINTER's claim to make and this page does
                not sell installation. A badge the product cannot back is how a
                tool page starts reading as marketing. */}
            <ul className="mt-7 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
              {[
                { icon: Sparkles, title: 'AI-powered', text: 'design' },
                { icon: Scaling, title: 'Accurate scaling', text: '& panelization' },
                { icon: FileText, title: '150 PPI', text: 'print-ready files' },
                theme.showPrintOffer
                  ? { icon: ShieldCheck, title: 'Trusted by', text: 'installers' }
                  : { icon: ShieldCheck, title: 'TIFF, PDF', text: '& PNG output' },
              ].map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex items-start gap-2">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
                  <span className="text-xs leading-tight wall-muted">
                    <strong className="block font-semibold wall-ink">{title}</strong>{text}
                  </span>
                </li>
              ))}
            </ul>
            {/* The FAQ answers what the case study deliberately does not: the
                price ladder, the 24-hour human check, and what the coloured
                glass on the photo actually means. Same brand, same rule. It is
                a text link and stays one: a third button here would compete
                with Start designing, which is the only action that matters. */}
            <Link
              to={theme.showPrintOffer ? '/wall-wrap/faq' : '/printpro/wallpro/faq'}
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 underline-offset-4 hover:underline"
            >
              Prices &amp; questions <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
          {/* Renders null on an empty list by its own contract, so this is safe
              to mount unconditionally; the grid above is what changes shape. */}
          <WallProHeroProof proofs={bandProofs} />
        </section>
      )}
      {/* THE SECOND DOOR, AT THE TOP WHERE IT BELONGS (owner's #2). The film
          block is the only friction-free money on this page -- no sign-in, no
          token, no design -- and on a wrap printer's site "I already have
          artwork" is a large share of arrivals. It was sitting below two
          thousand pixels of design tool, which asks exactly the wrong question
          of that customer. One slim line puts it one click away without
          competing with the designer for the fold. */}
      {theme.showPrintOffer && !artwork && <a
        href="#order-printed-film"
        onClick={e => { e.preventDefault(); document.getElementById('order-printed-film')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
        /* Owner, 2026-09-15: "the order a printed wrap you have your own art
           should be a blue magenta gradiant white text". It was flat #ec4899,
           which is the tail of the page's own gradient wearing none of its
           head -- so the one bar selling the SECOND product read as a foreign
           object rather than the page's other primary action. It carries
           WALL_GRADIENT now, the same sweep as the Generate buttons, and
           brightens on hover instead of jumping to a different pink. */
        className={`mx-auto mt-4 flex max-w-6xl items-center justify-between gap-3 rounded-xl ${WALL_GRADIENT} px-4 py-3 text-sm text-white shadow-[0_1px_2px_rgba(15,23,42,0.06),0_10px_28px_-12px_rgba(37,99,235,0.45)] transition hover:brightness-110`}
      >
        <span className="text-white/90">
          <strong className="font-semibold text-white">Already have artwork?</strong> Skip the design and order printed film by the square foot.
        </span>
        <span className="shrink-0 font-semibold text-white">Order film &rarr;</span>
      </a>}
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}{error.startsWith('Sign in') && <Link className="ml-2 underline" to="/login" state={{ from: '/printpro/wallpro' }}>Sign in</Link>}</div>}
      {/* WHITE ON WHITE. The owner photographed it on 2026-09-22: a notice card
          with no readable text in it at all.

          `bg-sky-50` is near-white and this element set NO colour, so it
          inherited the page's — which under `data-wall-theme="designpro"` is
          `--wall-ink` at 98% lightness. Light text on a light card. On the
          WePrintWraps theme the inherited ink is near-black and it read fine,
          which is exactly why it survived: the defect only exists on one of the
          two brands this one component serves.

          Every other surface on this page states its colour through the wall
          tokens. This one hardcoded Tailwind sky and therefore opted out of the
          theme while still living inside it. It uses the card tokens now, with
          a blue rule rather than a blue fill, so it is legible on both. */}
      {notice && <p role="status" className="rounded-xl border border-l-4 border-blue-500/70 wall-card p-3 text-sm wall-ink">{notice}</p>}
      {history && <section className={panelClass}><div className="flex items-center justify-between"><h2 className="font-semibold">My wall designs</h2><Button variant="ghost" onClick={() => setHistory(null)}>Close</Button></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">{history.projects.map((p: any) => <Button key={p.id} disabled={!!busy} variant="outline" className="justify-start truncate" onClick={() => void run('Opening project', () => restore(p.config, p.id, p.name))}>{p.name}</Button>)}</div>
        <h3 className="mt-5 text-sm font-semibold">Generated artwork</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">{history.generations.map((g: any) => <button key={g.id} disabled={!!busy || g.state !== 'completed'} className="rounded-lg border p-3 text-left text-sm disabled:opacity-60" onClick={() => void run('Opening artwork', () => restore({ ...g.input, artworkPath: g.artwork_path }, crypto.randomUUID(), g.design_name))}>{g.design_name || 'Wall design'} · {g.state}{g.error && <span className="mt-1 block text-xs text-red-700">{g.error}</span>}</button>)}</div>
        {!history.projects.length && !history.generations.length && <p className="py-4 text-sm wall-muted">Your saved projects will appear here.</p>}
      </section>}
      <div className="grid gap-5 lg:grid-cols-[400px_minmax(0,1fr)]">
        <fieldset disabled={!!busy} className="min-w-0 space-y-5 disabled:opacity-70">
          {/* ── MARK THE WALL, ABOVE THE SCROLL (owner, 2026-09-22) ──────────
              "it doesn't show my photo when I upload, it should show my photo
              as soon as I upload / above scroll a card pops up and tells me to
              pin corners of wall and how do I mask closet?"

              The page already had a notice for this and she never saw it, for
              two compounding reasons. It was gated on `artwork &&` -- so it
              said nothing at all until a design existed -- and it sat inside
              the preview section, thousands of pixels down on a phone. It was
              also unreachable in her case, because the bogus whole-frame
              detection made `wallLocated` TRUE.

              This card is the opposite of all three: no artwork gate, at the
              top where the photo lands, and it states the ONE thing standing
              between her and the on-wall view. Its button does the work rather
              than describing it -- marking mode on, view back to the photo,
              scrolled to the photo -- because "tap Re-mark wall corners" was
              an instruction to find another button. */}
          {photo && !wallLocated && (
            <section className={panelClass + ' border-blue-500/60'} role="status">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-bold wall-ink">
                    {marking === 'wall'
                      ? `Tap the four corners of your wall — ${4 - corners.length} to go`
                      : detecting
                        ? 'Looking for your wall…'
                        : 'Mark your wall to see the design on it'}
                  </h2>
                  <p className="mt-1.5 max-w-[60ch] text-sm wall-muted">
                    {marking === 'wall'
                      ? 'Clockwise from the top left. The design is imposed the moment the fourth corner lands.'
                      : 'Tap the four corners of the wall, clockwise from the top left. It takes about five seconds.'}
                    {' '}<strong className="wall-ink">Your print files do not wait for this</strong> — they are already correct.
                  </p>
                  {/* Her actual question, answered where it was asked. */}
                  {/* IT NAMED A BUTTON THAT NO LONGER EXISTS (2026-09-22).
                      "Change what we keep" was the collapsed text link that hid
                      the masking tools; the UX pass that promoted those tools
                      into the open DELETED it, and this sentence kept pointing
                      at it. So the one card that answers "how do I mask the
                      closet?" sent her looking for a control that is not on the
                      page — the same defect as the print export telling
                      customers to choose a repeat mode with no such control,
                      found the same hour. Name the buttons that are really
                      there, in the words printed on them. */}
                  <p className="mt-2 max-w-[60ch] text-xs wall-muted">
                    A closet opening, a doorway or a window inside the wall: mark
                    the wall first, then use <strong className="wall-ink">Mask a closet,
                    door or window</strong> under the photo and tap its two opposite
                    corners.
                  </p>
                </div>
                {marking !== 'wall' && (
                  <Button
                    size="sm"
                    disabled={!!busy}
                    onClick={() => {
                      cornersOrigin.current = 'manual'; setCornerSource('manual');
                      setCorners([]); setMarking('wall'); setExcludeDraft([]); setView('before');
                      focusPhoto();
                    }}
                  >
                    <Ruler className="mr-2 h-4 w-4" />Mark the corners
                  </Button>
                )}
              </div>
            </section>
          )}
          {/* THE WHOLE JOB IN ONE ROW, ABOVE EVERYTHING (owner, 2026-09-22:
              "It should be like this", with a four-card tool mockup).
              It does no work itself — each card carries its own live state and
              opens its step, which is the owner's own ruling: a photo editor
              at a quarter of the screen cannot be tapped on a phone. */}
          <WallProStepBoard steps={boardSteps} active={activeStepId(boardSteps)} busy={!!busy} onOpen={jumpToStep} />
          {/* What every path ends with, stated as facts the repo can point at:
              the scale brain, the 54" roll, the bleed/overlap plan and the
              TIFF/PDF/PNG set. Shown before the work starts, because "leave
              with production files" is the promise the board is delivering. */}
          {!artwork && <WallProOutcomes />}
          <section id="upload-wall" className={panelClass}><StepHeading n={1} icon={Upload}>Upload your wall</StepHeading>{uploadControl('photo', photo ? 'Replace wall photo' : 'Upload wall photo')}<p className="mt-2 text-xs wall-muted">Any photo from your phone, including iPhone HEIC — it is converted here. Wall corners are detected automatically; mark windows and drapes with the mask tools. A wall photo is optional when generating artwork.</p>
            {photo && <div id="select-wall-area" style={{ scrollMarginTop: stickyTop + 120 }} className="mt-5 space-y-2">
              {/* STEP 2 IS NOW A STEP (owner, 2026-09-22). Marking the wall was
                  never numbered -- it lived unlabelled inside step 1, below the
                  fold on a phone -- which is why "it did not allow me or
                  instruct me to pin corners" and "how do you mask the closet"
                  were the same report twice. It sits inside this section
                  because the photo it acts on is here; the page already holds
                  two step headings in one section. */}
              <StepHeading n={2} icon={Ruler}>Select wall area</StepHeading>
              <p className="-mt-1 mb-1 text-xs wall-muted">Drag the corners to mark your wall. We exclude windows, doors and furniture. Your print files never wait for this.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="outline" disabled={!!busy || detecting} onClick={() => detectMyWall(false)}><Wand2 className={'mr-2 h-4 w-4' + (detecting ? ' animate-pulse' : '')} />{detecting ? 'Detecting…' : 'Detect wall corners again'}</Button>
                <Button variant="outline" disabled={!!busy || detecting} onClick={() => detectMyWall(true)}>Re-detect protected & removable areas</Button>
              </div>
              <p className="text-xs wall-muted">{detecting ? 'Tap the four corners on the photo — you do not have to wait for us. Enter the wall size whenever you like.' : wallMaskGuidance({ detecting, items, drawnCount: exclusions.length }).headline}</p>
            </div>}
            <div className="mt-4 grid grid-cols-2 gap-3"><label className="text-sm">Width (inches)<input className={inputClass} type="number" min="1" max="2400" step="0.25" value={width || ''} onChange={e => setWidth(Number(e.target.value))} /></label><label className="text-sm">Height (inches)<input className={inputClass} type="number" min="1" max="2400" step="0.25" value={height || ''} onChange={e => setHeight(Number(e.target.value))} /></label></div>
            <p className="mt-2 flex items-center gap-1 text-xs wall-muted"><Ruler size={14} />{dimensionsValid ? (width * height / 144).toFixed(1) + ' sq ft' : 'Enter positive wall dimensions.'}</p>
            {/* THE PRINT PRICE, THE MOMENT THE WALL IS MEASURED (owner,
                2026-09-14: "on enter wall size should give price for printed
                wrap from wpw film"). The wall's own square footage at the live
                WePrintWraps rate -- the number a customer can check with a tape
                measure -- so the cost of the thing they came for is answered in
                step 1 rather than four thousand pixels later. It is the film
                only; the design is priced on its own card, because they are
                separate purchases with separate payees. */}
            {/* GATED ON showPrintOffer, like every other print element (owner,
                2026-09-15: the DesignProAI page should not carry the partner's
                marks). This block quoted a WePrintWraps film rate and named
                their material on the DesignProAI-branded page, while the bar,
                the order section and the spec were all correctly hidden there
                -- so one partner's pricing leaked onto a page that hides
                everything else about them. The condition was simply missing. */}
            {theme.showPrintOffer && dimensionsValid && billing && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border wall-edge bg-[hsl(var(--wall-field))] px-3 py-2">
              <span className="text-xs wall-muted">
                Printed film, this wall
                <span className="block text-[11px] wall-muted">{billing.wallSqFt} sq ft × {formatMoney(Math.round(WPW_WALL_FILM_RATE_PER_SQFT * 100))}/sq ft · Avery HP MPI 2610</span>
              </span>
              <span className="text-base font-bold tabular-nums wall-ink">
                {formatMoney(Math.round(billing.wallSqFt * WPW_WALL_FILM_RATE_PER_SQFT * 100))}
              </span>
            </div>}
          </section>
          <section id="choose-design" className={panelClass}><StepHeading n={3} icon={Settings2}>Describe your design</StepHeading>
            {/* THE FIVE PRICED PATHS MOVE UNDER THE BRIEF (owner ruling,
                2026-09-22, asked directly: "Inside step 3, chips on top").
                Describing a design is the default way in, so the picker stops
                being a toll gate in front of it -- but it is NOT hidden: every
                path keeps its own price on its own row, which is the 09-13
                launch rule that the price rides the choice and never a
                checkout. Open by default whenever the customer has already
                chosen a non-default path, so a restored project never buries
                the mode it is actually in. */}
            <details className="mt-4 rounded-lg border wall-edge p-3" open={designMode !== 'ai'}>
              <summary className="cursor-pointer text-sm font-semibold wall-ink">More ways to start &mdash; and what each costs</summary>
              <div className="mt-3"><div className="mb-4 grid gap-2">{([
              { mode: 'library', label: 'Pick a design', hint: 'Ready-to-print designs by industry. No token.' },
              { mode: 'match', label: 'Match my design', hint: 'Upload a design; it is recreated print-ready, with any changes you ask for.' },
              { mode: 'wall', label: 'Design for my wall', hint: 'Upload your wall photo and let the designer propose a design for that room.' },
              { mode: 'ai', label: 'Describe a design', hint: 'Prompt only: a mural or a repeating pattern.' },
              { mode: 'upload', label: 'Use my print-ready file', hint: 'Your own file, placed as supplied. It must meet the print resolution.' },
            ] as const).map(option => <button key={option.mode} type="button" onClick={() => { setDesignMode(option.mode); setArtwork(null); setDesignId(null); if (option.mode === 'match') { setPlacement('repeat'); setRepeatWidth(24); } }} className={'flex items-baseline justify-between gap-3 rounded-lg border px-3 py-2 text-left ' + (designMode === option.mode ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-300' : 'wall-edge hover:border-blue-400')}><span className="shrink-0 text-sm font-semibold">{option.label}</span><span className="text-xs wall-muted">{option.hint}</span>
              {/* The price is on the choice, not buried in a checkout. Each entry
                  path is its own SKU (owner's launch list, 2026-09-13), so the
                  customer picks knowing what it costs. */}
              <span className="shrink-0 text-sm font-bold text-blue-700">{formatMoney(WALL_DESIGN_SKUS[option.mode].cents)}</span></button>)}</div>
            <p className="mb-4 text-[11px] wall-muted">Every design includes print-ready panelized files, checked by our team before release. Printing is {formatMoney(Math.round(WPW_WALL_FILM_RATE_PER_SQFT * 100))} a square foot and is optional — take the files elsewhere if you prefer.</p></div>
            </details>
            {/* STEP 3 (Trish 2026-09-16). Same conditional tree, same state --
                only a heading, so "Pick a design" reads as its own step and
                "Describe/match/upload" reads as its own step, matching what the
                customer actually does next instead of hiding inside step 2. */}
            {/* NOT a numbered step any more (2026-09-22). The owner's board
                runs 1 Upload - 2 Select wall area - 3 Describe - 4 Generate,
                and a second "3" beside it is the two-numbering-systems defect
                the UX pass already removed once. This is the active path's own
                sub-heading. */}
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold wall-ink">
              {(() => { const I = designMode === 'library' ? ImageIcon : Settings2; return <I className="h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />; })()}
              {designMode === 'library' ? 'Pick a ready-made design' : designMode === 'upload' ? 'Add your artwork' : 'Your brief'}
            </h3>
            {designMode === 'library' ? <div className="space-y-3">
              {catalog === null ? <p className="text-sm wall-muted">Loading designs…</p> : catalog.length === 0 ? <p className="text-sm wall-muted">No ready-to-sell designs are published yet. Describe your own with Create with AI.</p> : <>
                <label className="block text-sm">Industry<select className={inputClass} value={catalogIndustry} onChange={e => setCatalogIndustry(e.target.value)}><option value="all">All ({catalog.length})</option>{[...new Set(catalog.map(r => r.industry))].sort().map(i => <option key={i} value={i}>{i}</option>)}</select></label>
                {/* Both sides of this merge kept: main added the room-mockup
                    thumbnail and its caption; this branch moved the selection
                    colour off violet with the rest of the page. */}
                <div className="grid max-h-[520px] grid-cols-2 gap-2 overflow-y-auto pr-1">{catalog.filter(r => catalogIndustry === 'all' || r.industry === catalogIndustry).map(row => <button key={row.id} type="button" disabled={!!busy} onClick={() => void pickDesign(row)} className={'overflow-hidden rounded-lg border text-left ' + (designId === row.design_id ? 'border-blue-500 ring-2 ring-blue-300' : 'wall-edge hover:border-blue-400')}>
                  <div className="aspect-[4/3] bg-[hsl(var(--wall-ground))]">{(() => { const src = (row.mockups?.[0] && catalogThumbs[row.mockups[0].path]) || catalogThumbs[row.thumb_path || row.master_path]; return src ? <img src={src} alt={row.title} className="h-full w-full object-cover" loading="lazy" /> : null; })()}</div>
                  <div className="p-2"><p className="truncate text-xs font-semibold">{row.title}</p><p className="truncate text-[10px] wall-muted">{row.design_id} · {row.design_type}</p>{row.mockups?.[0] && <p className="truncate text-[10px] text-emerald-700">{row.mockups[0].caption}</p>}</div>
                </button>)}</div>
                <p className="text-xs wall-muted">Every design is a fixed production master with its own DesignID. Picking one never spends a token; it loads the approved artwork and its placement.</p>
              </>}
            </div> : designMode === 'ai' || designMode === 'match' || designMode === 'wall' ? <div className="space-y-3">
              <div><p className="text-sm">Design type</p><div className="mt-1 grid grid-cols-3 gap-2">
                <Button size="sm" className="h-auto whitespace-normal px-2 py-2 text-center leading-tight" variant={scaleChoice === 'auto' ? 'default' : 'outline'} onClick={() => setScaleChoice('auto')}>Auto</Button>
                <Button size="sm" className="h-auto whitespace-normal px-2 py-2 text-center leading-tight" variant={scaleChoice === 'cover' ? 'default' : 'outline'} onClick={() => setScaleChoice('cover')}>Mural</Button>
                <Button size="sm" className="h-auto whitespace-normal px-2 py-2 text-center leading-tight" variant={scaleChoice === 'repeat' ? 'default' : 'outline'} onClick={() => setScaleChoice('repeat')}>Pattern</Button>
              </div><p className="mt-1 text-xs wall-muted">{autoWallScale({ intent, prompt, wallWidthIn: width, chosen: scaleChoice === 'auto' ? null : scaleChoice }).reason}</p></div>
              {intent === 'match' && <>
                {uploadControl('reference', reference ? 'Replace the design to match' : 'Upload the design to match')}
                <p className="text-xs wall-muted">The designer recreates this design faithfully as a print-ready 4K master: same composition, motifs, palette and scale. Low-resolution files, screenshots and photos of a wall are fine as the source.</p>
              </>}
              {intent === 'wall' && <p className="text-xs wall-muted">{photo ? 'The designer reads the room in your wall photo and proposes a design for it. Describe a direction if you have one.' : 'Upload your wall photo in step 1 and mark its four corners.'}</p>}
              <label className="block text-sm">{intent === 'match' ? 'Changes to make (optional)' : intent === 'wall' ? 'Direction for the designer (optional)' : 'Describe the design'}<textarea className={inputClass + ' min-h-28'} maxLength={6000} value={prompt} placeholder={intent === 'match' ? 'Keep it exactly as is, or: make the background ivory, fewer flowers…' : intent === 'wall' ? 'Calm, botanical, works with the grey drapes…' : 'Oversized blue botanicals on warm ivory, refined and hand-painted…'} onChange={e => { setPrompt(e.target.value); setArtwork(null); }} /></label>
              {/* THE STYLE CHIPS (owner's mockup, 2026-09-22). They APPEND to
                  the brief rather than replacing it, and they are not a
                  taxonomy: the two personas read prose, so a chip is a word
                  the customer would have typed, saving a phone keyboard. A
                  chip that overwrote the brief would delete the only thing in
                  the request that is actually hers -- the measurement behind
                  the two-persona rule is that the customer's own words were 44
                  characters against 3,342 of persona, so they are the
                  scarcest input on the page and nothing here may spend them. */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {WALL_STYLE_CHIPS.map(chip => <button key={chip} type="button" disabled={!!busy}
                  onClick={() => { setPrompt(appendStyleChip(prompt, chip)); setArtwork(null); }}
                  className="rounded-full border wall-edge px-2.5 py-1 text-xs wall-ink hover:border-blue-400 disabled:opacity-60">{chip}</button>)}
              </div>
              {intent === 'prompt' && <label className="block text-sm">Start with a style<select className={inputClass} value="" onChange={e => { setPrompt(WALL_DESIGNS.find(d => d.id === e.target.value)?.prompt || ''); setArtwork(null); }}><option value="">Choose a starting point</option>{WALL_DESIGNS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
              {intent !== 'match' && uploadControl('reference', reference ? 'Replace style reference' : 'Upload a style reference')}
              {intent !== 'match' && <p className="text-xs wall-muted">Optional inspiration only. Your description is enough to generate a design; no example image is required.</p>}
              {reference && <div className="flex items-center gap-3"><img src={reference.url} alt={intent === 'match' ? 'Design to match' : 'Style reference'} className="h-14 w-14 rounded object-contain" /><Button size="sm" variant="ghost" onClick={() => { setReference(null); setArtwork(null); }}>Remove</Button></div>}
              {freeReason === 'commercialpro'
                ? <p className="text-xs font-semibold text-emerald-700">Included with CommercialPro — no token. Usually ready in 1–2 minutes.</p>
                : freeReason === 'trial'
                  ? <p className="text-xs font-semibold text-emerald-700">Your first design is free. Usually ready in 1–2 minutes.</p>
                  : freeReason === 'signed-out'
                    ? <p className="text-xs font-semibold text-emerald-700">
                        Your first design is free — <Link to="/signup" state={{ from: '/wallwrap-design' }} className="underline">create a free account</Link> to claim it.
                        Pricing film needs no account.
                      </p>
                    : <p className="text-xs wall-muted">1 design token or plan render. Usually ready in 1–2 minutes.</p>}
              {/* The reason generation is blocked, and any failure, sit beside the button
                  the customer is looking at. The page-top alert alone is off screen here. */}
              {generationBlocker && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">{generationBlocker}</p>}
              {!generationBlocker && previewBlocker && <p role="status" className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">{previewBlocker}</p>}
              {error && !busy && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}
              <Button className={`w-full ${WALL_GRADIENT} text-white`} disabled={generateDisabled} onClick={() => void generate()}><Wand2 className="mr-2 h-4 w-4" />{generateLabel}</Button>
            </div> : <div className="space-y-3">{uploadControl('artwork', artwork ? 'Replace artwork' : 'Upload artwork or pattern')}<p className="text-xs wall-muted">Your artwork is placed as supplied. Pattern size stays under your control.</p></div>}
          </section>
        </fieldset>
        <div className="min-w-0 space-y-5">
          {/* scroll-mt clears the sticky header: a finished design scrolls
              itself here, and without it the heading lands underneath. */}
          {/* Scroll margin clears BOTH sticky bars -- the site header, measured
              into stickyTop, plus this page's own -- so the design a finished
              generation scrolls itself to does not land underneath them. */}
          <section id="wall-preview" style={{ scrollMarginTop: stickyTop + 120 }} className={panelClass + ' overflow-hidden'}>
            {/* STEP 4 (Trish 2026-09-16): the result, beside the form that
                produces it. Every WallPro design originates as a flat
                rectangle, and the client sees both at once: the print master
                on the left and the same file imposed on their photo on the
                right, the moment the corners exist. The tabs only switch the
                photo pane between the original wall and the imposed design;
                the flat master never leaves the screen. */}
            <StepHeading n={4} icon={ImageIcon}>Generate &amp; preview</StepHeading>
            {photo && <div className="mb-4 flex flex-wrap items-center gap-2">{(['before','after'] as const).map(v => <Button size="sm" variant={(view === v) || (view === 'design' && v === 'before') ? 'default' : 'outline'} key={v} onClick={() => setView(v)} disabled={v === 'after' && !(artwork && wallLocated)}>{v === 'before' ? 'Original wall' : 'On your wall'}</Button>)}
              {/* Before and after (owner, 2026-09-12: "Before and afters will
                  speak volumes"). Offered only once a real composite exists --
                  a comparison against nothing is a broken picture, not a tease.
                  The after is always the deterministic composite. */}
              {canCompare && <Button size="sm" variant={view === 'compare' ? 'default' : 'outline'} onClick={() => setView('compare')}><MoveHorizontal className="mr-1 h-3 w-3" />Before &amp; after</Button>}
              {artwork && aiAvailable && <Button size="sm" variant={view === 'ai' ? 'default' : 'outline'} disabled={!!busy || aiPainting} onClick={() => aiViewCurrent ? setView('ai') : void showAiView()}><Wand2 className={'mr-1 h-3 w-3' + (aiPainting ? ' animate-pulse' : '')} />{aiPainting ? 'Painting AI view…' : aiViewCurrent ? 'AI view' : 'Show me with AI'}</Button>}{rendering && <span className="flex items-center gap-1 text-xs wall-muted"><Loader2 className="h-3 w-3 animate-spin" />Placing the design on your wall</span>}</div>}
            <div className={photo && previewArt ? 'grid gap-4 xl:grid-cols-2' : ''}>
            {previewArt && <div>
              {/* Say which picture this is. "THE PRINT MASTER · 4096 × 4096 PX"
                  over a wall-scale render read as though the wall were 4096
                  square, and over a bare tile it invited the "my pattern came
                  back small" reading the flatView comment above explains. */}
              {/* ⚠️ THESE PANES CARRY NO NUMBER (owner, 2026-09-22: "it's
                  currently confusing and has bad ux").
                  They used to read "1 ·" and "2 ·" while the page's STEPS are
                  also numbered 1-4 -- and these two live INSIDE step 4. Her
                  screenshot shows "2 · IMPOSED ON YOUR WALL", which reads as
                  step 2, and step 2 is "Choose your design". One numbering
                  system per page: the steps have it, because they are a
                  sequence; these are two views of one result, which is not. */}
              {photo && <p className="mb-2 text-xs font-semibold uppercase tracking-wide wall-muted">{artwork ? 'Flat design — the print master' : 'Your uploaded design — not print-ready yet'}{artwork && flatView !== 'tile' ? ` · across your ${width} × ${height} in wall` : previewArt.width && previewArt.height ? ` · ${previewArt.width} × ${previewArt.height} px` : ''}</p>}
              {/* Pattern size, as PatternPro's slider: the design itself drawn
                  smaller or bigger across the wall, 30% to 300%, with no new
                  generation (owner, 2026-09-12). The panels do not change. */}
              <div className="mb-2 rounded-lg border wall-edge bg-[hsl(var(--wall-card))] px-3 py-2 text-sm" aria-label="Pattern size">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">Pattern size</span>
                  <span className="rounded bg-[hsl(var(--wall-ground))] px-2 py-0.5 font-mono text-xs">{patternScaleLabel(patternBase, wallBox, scaleDraft)}</span>
                </div>
                <Slider aria-label="Pattern size" min={PATTERN_SCALE_MIN} max={PATTERN_SCALE_MAX} step={PATTERN_SCALE_STEP} value={[scaleDraft]} disabled={!!busy} onValueChange={v => draftPatternScale(v[0])} onValueCommit={v => applyPatternScale(v[0])} />
                <div className="mt-1 flex justify-between text-[11px] wall-muted"><span>30% smaller</span><span>100% as generated</span><span>300% bigger</span></div>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {PATTERN_SCALE_PRESETS.map(p => <Button key={p} size="sm" variant={scaleDraft === p ? 'default' : 'outline'} className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => applyPatternScale(p)}>{patternScaleWord(p)} {p}%</Button>)}
                  {scaleDraft !== 100 && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => applyPatternScale(100)}><RotateCcw className="mr-1 h-3 w-3" />Reset</Button>}
                </div>
                {/* Bigger spreads the same pixels over more inches, so the
                    honest limit on "bigger" is resolution, never print size:
                    the wall, the panels and the file stay exactly as they are. */}
                {/* THE NUMBER IS INFORMATION; THE OLD BUTTON WAS BAD ADVICE.
                    "Use 40%, the largest fully sharp size" sat here and, on the
                    owner's own 120-inch wall, 40% of a 60-inch repeat is a
                    24-inch repeat -- four-plus across, the craft-fair density
                    the scale brain exists to prevent. It told customers to undo
                    the measured baseline to chase sharpness that the pipeline
                    already supplies: production runs Topaz per 54-inch panel to
                    reach 150 PPI, which is the whole reason that stage exists.
                    Owner, 2026-09-12: "Keep it lower resolution" -- hold the
                    pattern at the size it should print and accept the native
                    density. The honest figure stays on screen; the call to
                    action that fought the baseline is gone. */}
                {artwork && draftPpi > 0 && <p className={'mt-2 text-xs ' + (draftPpi + 1e-9 >= printSettings.minPpi ? 'wall-muted' : 'wall-muted')}>
                  {draftPpi >= printSettings.minPpi
                    ? `${Math.round(draftPpi)} PPI from the design's own pixels — above your ${printSettings.minPpi} PPI minimum. Wall size, panels and print file are unchanged at every size.`
                    : `${Math.round(draftPpi)} PPI native from the design's own pixels. Production enhances every ${WALLPRO_PRINT_WIDTH}″ panel through Topaz to ${printSettings.minPpi} PPI, so keep the pattern at the size it should print — shrinking it to raise this number is not the fix.`}
                </p>}
                <p className="mt-1 text-xs wall-muted">Same design, drawn smaller or bigger on your wall. Deterministic, no token; the print file rebuilds at this size when you approve.</p>
              </div>
              {/* MIRROR CHANGES HER ARTWORK, SO IT HAS TO SAY SO (2026-09-22).
                  `verified: true` is correct for a mirrored tile -- the join is
                  a column against its own copy -- and that is exactly why the
                  receipt alone could never surface this: every gate read
                  "seamless" and stayed quiet while alternate tiles printed
                  flipped. The method, not the verdict, is what the customer
                  needs, and only in the one case where the wall will not look
                  like the design she approved. */}
              {seamReceipt?.method === 'mirror' && <div className="mb-2 rounded-lg border border-amber-400/60 bg-amber-50/80 px-3 py-2 text-xs dark:bg-amber-500/10">
                <p className="font-semibold text-amber-900 dark:text-amber-200">This tile is being mirrored to join.</p>
                <p className="mt-1 text-amber-900/90 dark:text-amber-100/90">
                  Every other tile is flipped, so your wall will read symmetrically — fine on texture, visible on leaves, figures or lettering. The tile did not join on its own and the blended repair did not close it either.
                </p>
                <Button size="sm" variant="outline" className="mt-2 h-7 px-2 text-xs" disabled={!!busy} onClick={() => setSeamPreference(seamPreference === 'blend' ? 'auto' : 'blend')}>
                  {seamPreference === 'blend' ? 'Back to automatic' : 'Use the blended repeat anyway'}
                </Button>
              </div>}
              <div className="flex min-h-80 items-center justify-center rounded-xl bg-[hsl(var(--wall-ground))] p-4"><div className="relative inline-block">
              {flatView === 'css' && draftTile
                ? <div role="img" aria-label={`Print master across your ${width} by ${height} inch wall at ${scaleDraft} percent`} className="max-h-[650px] w-[min(100%,650px)] rounded" style={{ aspectRatio: `${width} / ${height}`, backgroundImage: `url(${(tileArtwork || previewArt).url})`, backgroundSize: `${draftTile.fraction * 100}% auto`, backgroundPosition: draftTile.position, backgroundRepeat: 'repeat' }} />
                : <img src={flatView === 'canvas' && flatShown ? flatShown : previewArt.url} alt={flatView === 'canvas' ? `Print master across your ${width} by ${height} inch wall at the current pattern scale` : 'Generated tile'} className={'max-h-[650px] max-w-full object-contain' + (flatView === 'canvas' && !flatCurrent ? ' opacity-70' : '')} draggable={false} />}
              {(maskMode || maskRects.length > 0) && <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={'absolute inset-0 h-full w-full ' + (maskMode ? 'cursor-crosshair' : 'pointer-events-none')} style={{ touchAction: 'none' }}
                onPointerDown={e => { if (!maskMode) return; e.currentTarget.setPointerCapture(e.pointerId); maskStart.current = maskPoint(e); setMaskDraft({ ...maskStart.current, w: 0, h: 0 }); }}
                onPointerMove={e => { if (!maskMode || !maskStart.current) return; const p = maskPoint(e), s = maskStart.current; setMaskDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) }); }}
                onPointerUp={() => { if (maskDraft && maskDraft.w > 0.01 && maskDraft.h > 0.01) setMaskRects(old => [...old, maskDraft]); maskStart.current = null; setMaskDraft(null); }}>
                {[...maskRects, ...(maskDraft ? [maskDraft] : [])].map((r, i) => <rect key={i} x={r.x * 100} y={r.y * 100} width={r.w * 100} height={r.h * 100} fill="rgba(255,255,255,0.45)" stroke="#7c3aed" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />)}
              </svg>}
              </div></div>
            </div>}
            {photo ? <div>
              {/* Two wraps on one photo: the mural on the wall, brick on the
                  fireplace. Each zone is its own design and its own purchase. */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {zones.map(z => (
                  <Button key={z.projectId} size="sm" variant={z.projectId === projectId ? 'default' : 'outline'} disabled={!!busy}
                    onClick={() => void openZone(z.projectId)}>
                    {z.zoneLabel || 'Main wall'}{z.artworkPath ? '' : ' · empty'}
                  </Button>
                ))}
                {!addingZone
                  ? <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { setAddingZone(true); setNewZoneLabel('Fireplace'); }} title="Wrap another area of this same photo in a different design">+ Wrap another area</Button>
                  : <span className="flex items-center gap-1">
                      <input className="h-8 w-36 rounded-md border px-2 text-sm" autoFocus value={newZoneLabel} placeholder="Fireplace" maxLength={40}
                        onChange={e => setNewZoneLabel(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') void addAccentZone(newZoneLabel); if (e.key === 'Escape') { setAddingZone(false); setNewZoneLabel(''); } }} />
                      <Button size="sm" disabled={!!busy} onClick={() => void addAccentZone(newZoneLabel)}>Add</Button>
                      <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { setAddingZone(false); setNewZoneLabel(''); }}>Cancel</Button>
                    </span>}
              </div>
              {parentProjectId && <p className="mb-2 rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
                Wrapping <strong>{zoneLabel || 'this area'}</strong> only. Mark its four corners and enter <strong>its</strong> real size, not the whole wall's — the design scales from those inches. It prints and is purchased separately from the main wall.
              </p>}
              {artwork && <p className="mb-2 text-xs font-semibold uppercase tracking-wide wall-muted">{view === 'compare' ? 'Before & after' : view === 'after' && preview ? 'Imposed on your wall' : cornersValid ? 'Your wall' : 'Your wall — mark the four corners to impose the design'}</p>}
              {view === 'compare' && canCompare && preview ? <BeforeAfter before={photo.url} after={preview} alt="Your design on your wall, compared with the original" name={name} /> :
              view === 'ai' && aiView ? <div className="overflow-hidden rounded-xl border wall-edge bg-[hsl(var(--wall-ground))]">
                <div className="relative">
                  <img src={aiView.url} alt="Artist's impression of the design on your wall — not the print file" className="w-full object-contain" />
                  {/* ON the image, because a caption under it sits below the
                      fold on a phone and was read as a footnote. */}
                  <span className="absolute left-2 top-2 rounded-full bg-slate-900/75 px-3 py-1 text-xs font-bold text-white shadow">{AI_VIEW_BADGE}</span>
                </div>
                <p className="p-2 text-xs wall-muted">{AI_VIEW_EXPLAINER}</p>
                <div className="px-2 pb-2"><Button size="sm" variant="outline" onClick={() => setView('after')}>Back to the print geometry</Button></div>
              </div> :
              <div className="relative">
              {/* ⚠️ THE INSTRUCTION LIVES ON THE PHOTO (owner, 2026-09-22:
                  "it's still making me scroll down and instruction doesn't pop
                  up, bad ux").
                  The previous pass put it in the "Your wall photo" block --
                  which is BELOW the image. On a phone the customer is looking
                  at the photo she is tapping, and the words telling her what
                  to tap were off screen. An instruction you have to scroll to
                  find is not an instruction.
                  So it is an overlay pinned to the top of the image itself,
                  inside the same box the taps land in. It only exists while
                  marking, so it never covers the design at rest, and it is
                  pointer-events-none apart from its own two buttons -- a
                  banner that ate the first tap would be worse than silence. */}
              {marking && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-2">
                  <div className="pointer-events-auto rounded-xl border border-blue-400/70 bg-slate-900/92 px-3 py-2 shadow-lg backdrop-blur">
                    <p className="text-[13px] font-semibold leading-snug text-white">
                      {marking === 'wall'
                        ? `Tap the four corners of your wall, clockwise from the top left — ${4 - corners.length} to go`
                        : marking === 'rectangle'
                          ? excludeDraft.length === 0
                            ? 'Tap ONE corner of the closet, door or window'
                            : 'Now tap the OPPOSITE corner'
                          : excludeDraft.length < 3
                            ? `Tap around the area — ${3 - excludeDraft.length} more point${3 - excludeDraft.length === 1 ? '' : 's'}`
                            : 'Keep tapping to refine, then Finish'}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {marking === 'exclude' && <Button size="sm" className="h-7 px-2 text-xs" disabled={!!busy || excludeDraft.length < 3} onClick={() => finishMask(excludeDraft)}>Finish</Button>}
                      <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" disabled={!!busy || (marking === 'wall' ? !corners.length : !excludeDraft.length)}
                        onClick={() => marking === 'wall' ? setCorners(old => old.slice(0, -1)) : setExcludeDraft(old => old.slice(0, -1))}>Undo</Button>
                      <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" disabled={!!busy}
                        onClick={() => { setExcludeDraft([]); setMarking(null); }}>Cancel</Button>
                    </div>
                  </div>
                </div>
              )}
              <WallPhotoEditor onEditing={setEditingPhoto} url={view === 'after' && preview ? preview : photo.url} alt={view === 'after' && preview ? 'Your design scaled on your wall' : 'Your original wall'} aspect={photo.aspect} busy={!!busy} marking={marking} corners={corners} masks={exclusions} maskUrl={detectedMask?.url ?? null} items={items} onToggleItem={id => void applyItems(toggleItem(items, id))} draft={excludeDraft} showMasks={showMasks} seams={showPrintGuides ? printSeams : []} onPoint={markPoint} onRectangle={(a,b) => { try { finishMask(rectangularWallMask(a,b)); } catch (e) { setError(e instanceof Error ? e.message : 'Choose opposite corners.'); setExcludeDraft([]); } }} onCorners={next => { cornersOrigin.current = 'manual'; setCornerSource('manual'); setCorners(next); }} onMasks={setExclusions} />
              </div>}
              {/* THE TRUST SIGNAL (owner, 2026-09-12: "There is no trust signal").
                  The composite is not a preview of the print file, it IS the
                  print file on their wall, and that is the reason to buy. Said
                  positively and backed on the same line by the numbers the same
                  geometry produced, so it is checkable rather than reassuring. */}
              {(view === 'after' || view === 'compare') && preview && billing && <div className="mt-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-emerald-900">
                  <ShieldCheck className="h-4 w-4 shrink-0" />{PRINT_TRUTH_BADGE}
                </p>
                <p className="mt-1 text-xs text-emerald-900">{PRINT_TRUTH_LINE}</p>
                <p className="mt-1 text-xs text-emerald-800">
                  {billing.panels} {billing.panels === 1 ? 'panel' : 'panels'} · {WALLPRO_PRINT_WIDTH}″ roll · {billing.panelLengthIn}″ long · {printSettings.minPpi} PPI · seams {seamReceipt ? 'verified' : 'checked on export'}
                </p>
              </div>}
              {/* The amber "mark your corners" notice that stood here is gone.
                  It said the same thing as the card above step 1, in a second
                  place, worded as an instruction to find a third control
                  ("tap Re-mark wall corners"). One prompt, at the top; the
                  CONTROLS live in the block below, attached to the photo. */}
              {/* Masking runs automatically now, so the page states what it
                  DID instead of asking the customer to do it. The manual tools
                  stay one tap away for a correction, but they no longer read
                  as a required step (owner, 2026-09-12: "system should be auto
                  masking behind the scenes... still shows buttons asking to
                  mask, very confusing"). */}
              {/* ── ONE BLOCK FOR THE PHOTO'S OWN WORK (owner, 2026-09-22) ─────
                  Corners and masking were in THREE places: the card above
                  step 1, a "Change what we keep" text link buried in a
                  paragraph, and the buttons that link revealed. "How do I mask
                  closet?" had no visible answer anywhere on the page.
                  Now: one titled block under the photo, with the two jobs
                  named and their state stated. Nothing hides behind a link —
                  a control the customer cannot see is a control that does not
                  exist. */}
              <div className="mt-3 rounded-xl border wall-edge bg-[hsl(var(--wall-field))] p-3">
                <h3 className="text-xs font-bold uppercase tracking-wide wall-ink">Your wall photo</h3>

                {/* ROW 1 — the wall area itself. */}
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-b wall-edge pb-2.5">
                  <p className="min-w-0 text-xs wall-muted">
                    <strong className="wall-ink">Wall area:</strong>{' '}
                    {marking === 'wall'
                      ? `marking — ${4 - corners.length} corner${4 - corners.length === 1 ? '' : 's'} to go`
                      : wallLocated
                        ? `set${cornerSource === 'detected' ? ' automatically' : ' by you'} — the design is imposed inside it`
                        : detecting ? 'looking…' : 'not set — the design cannot be placed on the photo yet'}
                  </p>
                  <Button size="sm" variant={wallLocated ? 'outline' : 'default'} disabled={!!busy} onClick={() => { cornersOrigin.current = 'manual'; setCornerSource('manual'); setCorners([]); setMarking('wall'); setExcludeDraft([]); setView('before'); focusPhoto(); }}>
                    <RotateCcw className="mr-1.5 h-3 w-3" />{wallLocated ? 'Re-mark' : 'Mark the corners'}
                  </Button>
                </div>

                {/* ROW 2 — what the design paints around.

                    ⚠️ WHILE MARKING, THE ROW IS AN INSTRUCTION, NOT A STATUS
                    (owner, 2026-09-22: "How do you mask the closet? It's not
                    masking"). The button set `marking: 'rectangle'` and said
                    NOTHING, while WallPhotoEditor expects TWO taps — one
                    corner, then the opposite one. So the first tap looked like
                    it had done nothing, and two taps landed close together
                    produced a small box nowhere near the closet. An
                    interaction the customer cannot guess is an interaction
                    that does not work, however correct its geometry. */}
                {marking === 'rectangle' || marking === 'exclude' ? (
                  <div className="mt-2.5 rounded-lg border border-blue-500/60 bg-blue-500/10 p-2.5" role="status">
                    <p className="text-xs font-semibold wall-ink">
                      {marking === 'rectangle'
                        ? excludeDraft.length === 0
                          ? 'Tap ONE corner of the closet, door or window on the photo.'
                          : 'Now tap the OPPOSITE corner — the box is drawn between the two.'
                        : excludeDraft.length < 3
                          ? `Tap around the area to outline it — ${3 - excludeDraft.length} more point${3 - excludeDraft.length === 1 ? '' : 's'} needed.`
                          : 'Keep tapping to refine the outline, then press Finish mask.'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {marking === 'exclude' && <Button size="sm" disabled={!!busy || excludeDraft.length < 3} onClick={() => finishMask(excludeDraft)}>Finish mask</Button>}
                      <Button size="sm" variant="ghost" disabled={!!busy || !excludeDraft.length} onClick={() => setExcludeDraft(old => old.slice(0, -1))}>Undo point</Button>
                      <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { setExcludeDraft([]); setMarking(cornersValid ? null : 'wall'); }}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                <p className="mt-2.5 text-xs wall-muted">
                  <strong className="wall-ink">What we keep:</strong>{' '}
                  {detecting
                    ? 'Finding what to protect on this wall…'
                    : detectedMask || removeMask || exclusions.length
                      ? <>Protected automatically. The design paints around anything fixed and through anything that would be moved before install.{items.length > 0 && <> <strong>Tap any labelled item on the photo to change our mind about it</strong> — {itemSummary(items).kept} kept, {itemSummary(items).through} painted through.</>}{exclusions.length > 0 && ` ${exclusions.length} area${exclusions.length === 1 ? '' : 's'} you marked by hand.`}</>
                      : wallReadMissed
                        ? 'We could not read this wall automatically, so nothing is protected yet. Mark the corners, then tell us what to keep — a closet opening, a doorway, a window.'
                        : 'Nothing needed protecting on this wall.'}
                  {/* ORDER MATTERS, AND THE PAGE NEVER SAID SO. A mask only
                      means anything once the design is placed inside the wall
                      quad, so masking before the corners exist is work the
                      customer cannot see the result of. */}
                  {!wallLocated && <> <strong className="wall-ink">Mark the wall first</strong> — until it is set the design is not placed on the photo, so there is nothing for a mask to cut out of.</>}
                </p>
                )}
                {/* The two masking actions, in the open. A closet opening or a
                    doorway is a rectangle; a cluttered wall is one rough shape
                    around the lot. Named for what the customer is looking at,
                    not for the tool. */}
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant={marking === 'rectangle' ? 'default' : 'outline'} disabled={!!busy} onClick={() => { setMarking('rectangle'); setShowMasks(true); setExcludeDraft([]); setView('before'); focusPhoto(); }}>Mask a closet, door or window</Button>
                  <Button size="sm" variant={marking === 'exclude' ? 'default' : 'outline'} disabled={!!busy} onClick={() => { setMarking('exclude'); setShowMasks(true); setExcludeDraft([]); setView('before'); focusPhoto(); }}>Protect a busy area</Button>
                  <button type="button" className="text-xs font-semibold text-blue-700 underline" onClick={() => setShowMaskTools(v => !v)}>{showMaskTools ? 'Fewer options' : 'More options'}</button>
                </div>
              </div>
              {showMaskTools && <>
              <label className="mt-3 flex items-center gap-2 text-xs wall-muted"><input type="checkbox" checked={showMasks} onChange={e => setShowMasks(e.target.checked)} />Show glass mask overlay and editing handles</label>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {/* Re-mark, Mask-a-closet and Protect-a-busy-area were HERE,
                    behind a text link, which is why "how do I mask closet?"
                    had no visible answer. They are promoted into the block
                    above; what stays here is the per-mask editing that only
                    matters once a mask is being drawn. */}
                {marking === 'exclude' && <Button size="sm" disabled={!!busy || excludeDraft.length < 3} onClick={() => finishMask(excludeDraft)}>Finish mask</Button>}
                {(marking === 'exclude' || marking === 'rectangle') && <>
                  <Button size="sm" variant="ghost" disabled={!!busy || !excludeDraft.length} onClick={() => setExcludeDraft(old => old.slice(0,-1))}>Undo mask point</Button>
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { setExcludeDraft([]); setMarking(cornersValid ? null : 'wall'); }}>Cancel mask</Button>
                </>}
                {!!exclusions.length && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setExclusions(old => old.slice(0,-1))}>Remove last mask</Button>}
                {exclusions.length > 1 && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setExclusions([])}>Clear all masks</Button>}
                {/* An override is reversible in one action, so trying a click
                    costs nothing — which is what makes people try it. */}
                {hasOverride(items) && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void applyItems(resetItems(items))}>Reset to what we detected</Button>}
                {(detectedMask || removeMask) && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { setDetectedMask(null); setRemoveMask(null); setItems([]); }}>Clear detected areas</Button>}
              </div>
              <p className="mt-2 text-xs wall-muted">Tap anything on the photo to keep it as photographed or paint the design through it. Drawing is only for something we missed. For a busy wall -- a gallery of frames, a mantel display, a crowded shelf -- draw ONE rough shape around the whole area with Protect a busy area instead of tracing each item; everything inside stays exactly as photographed. Select a finished mask and drag its white points to adjust; arrow keys fine-tune a focused point. {exclusions.length > 0 && `${exclusions.length} protected ${exclusions.length === 1 ? 'area' : 'areas'}.`}</p>
              </>}
              {marking && <p role="status" className="mt-3 text-sm text-blue-700">{marking === 'wall' ? (corners.length >= 4 ? 'Corners are set. Drag a point to adjust, or tap the top-left corner to start over.' : 'Tap corner ' + (corners.length + 1) + ' of 4: ' + cornerNames[corners.length] + '.') : marking === 'rectangle' ? excludeDraft.length ? 'Now tap the opposite corner. Everything inside the rectangle will stay unchanged.' : 'Drag a box around the window or drapes, or tap two opposite corners.' : 'Tap around the edge of the object, or loosely around a whole busy area at once, then choose Finish mask.'}</p>}
              {!marking && cornersValid && <p className="mt-3 text-xs wall-muted">Measured wall: {width}″ W × {height}″ H. Placement follows the selected corners.</p>}
              {corners.length > 0 && <details className="mt-3 text-xs wall-muted"><summary className="cursor-pointer">Adjust corner positions</summary><div className="mt-2 grid grid-cols-2 gap-2">{corners.map((p,i) => <div key={i}><span>{i+1}. {cornerNames[i]}</span><div className="flex gap-1">{(['x','y'] as const).map(axis => <label key={axis}>{axis} %<input disabled={!!busy} aria-label={'Corner ' + (i+1) + ' ' + axis + ' percent'} type="number" min="0" max="100" step="0.1" className={inputClass} value={Number((p[axis]*100).toFixed(2))} onChange={e => setCorners(old => old.map((q,j) => j === i ? { ...q, [axis]: Number(e.target.value)/100 } : q))} /></label>)}</div></div>)}</div></details>}
            </div> : !artwork && <div className="flex min-h-96 flex-col items-center justify-center rounded-xl bg-[hsl(var(--wall-ground))] p-8 text-center"><ImageIcon className="mb-4 h-12 w-12 text-slate-300" /><h2 className="font-semibold">See the design on your wall</h2><p className="mt-2 max-w-sm text-sm wall-muted">Describe a design and choose Generate wall design, or upload your own artwork. Add a wall photo whenever you want to preview it in your room.</p></div>}
            </div>
            {busy && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-blue-700"><Loader2 className="h-4 w-4 animate-spin" />{busy}…</p>}
          </section>
          <section className={panelClass}><label className="block text-sm">Project name<input className={inputClass} maxLength={200} value={name} onChange={e => setName(e.target.value)} disabled={!!busy} /></label><div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" disabled={!!busy || rendering || detecting || preparingProof || scaleSettling || !photo || !preview || !canvas.current || !artwork || !wallLocated || !billing || !dimensionsValid || !seamReady} onClick={() => void openDesignProof()}>{preparingProof ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}3D Proof</Button><Button disabled={!!busy || !artwork || !dimensionsValid || !metrics} onClick={() => void run('Saving project', () => persistCurrent())}><Save className="mr-2 h-4 w-4" />Save project</Button>{preview && !rendering && !busy ? <Button asChild variant="outline"><a href={preview} download="wallpro-wall-preview.png"><Download className="mr-2 h-4 w-4" />Download wall preview</a></Button> : <Button variant="outline" disabled>Download wall preview</Button>}{artworkDownload && artworkDownload.source === (artwork?.path || artwork?.url) ? <Button asChild variant="outline"><a href={artworkDownload.url} download={artworkDownload.name}>Download artwork</a></Button> : <Button variant="outline" disabled={!!busy || !artwork} onClick={() => void prepareArtworkDownload()}>Prepare artwork download</Button>}</div><p className="mt-3 text-xs wall-muted">3D Proof includes your before photo, finished wall, and a detail close-up. Add a wall photo and locate its corners to prepare it. Use Prepare print files below for full-size panel PDFs.</p></section>
          {artwork && <section className={panelClass} aria-label="Refine and approve">
            <h2 className="font-semibold">Refine this design</h2>
            <p className="mt-1 text-sm wall-muted">Changes are applied to the current version and saved as the next version. Composition and everything you do not mention stay as they are.{currentVersion ? ` Current: V${currentVersion.version_no}${currentVersion.status === 'approved' ? ' (approved)' : ''}.` : ''}</p>
            <div className="mt-3 flex flex-wrap gap-1">{['Change colours', 'Remove an object', 'Add an object', 'Make it busier', 'Make it simpler', 'More negative space', 'Match my reference', 'Extend the design'].map(q => <Button key={q} size="sm" variant="outline" disabled={!!busy} onClick={() => setRefinePrompt(p => (p ? p + ' ' : '') + ({ 'Change colours': 'Change the colours: ', 'Remove an object': 'Remove ', 'Add an object': 'Add ', 'Make it busier': 'Make the design busier with more motifs.', 'Make it simpler': 'Make the design simpler and more minimal.', 'More negative space': 'Keep everything but add more negative space.', 'Match my reference': 'Match the colour in the reference image.', 'Extend the design': 'Extend the design to the right, continuing the same composition.' }[q] || q))}>{q}</Button>)}</div>
            <label className="mt-3 block text-sm">Describe what you want changed<textarea className={inputClass + ' min-h-20'} maxLength={6000} value={refinePrompt} disabled={!!busy} placeholder="Make the flowers smaller and the background charcoal…" onChange={e => setRefinePrompt(e.target.value)} /></label>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant={maskMode ? 'default' : 'outline'} disabled={!!busy} onClick={() => setMaskMode(m => !m)}>{maskMode ? 'Drawing mask: drag boxes on the design' : 'Only change an area'}</Button>
              {maskRects.length > 0 && <><span className="text-xs wall-muted">{maskRects.length} area{maskRects.length === 1 ? '' : 's'} selected; everything outside is kept pixel for pixel.</span><Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setMaskRects(old => old.slice(0, -1))}>Undo area</Button><Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { setMaskRects([]); setMaskMode(false); }}>Clear</Button></>}
              {uploadControl('reference', reference ? 'Replace reference image' : 'Add a reference image (optional)')}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button className={`${WALL_GRADIENT} text-white`} disabled={!!busy || !refinePrompt.trim()} onClick={() => void refine()}><Wand2 className="mr-2 h-4 w-4" />Refine this design</Button>
              {currentVersion && currentVersion.status !== 'approved' && <Button variant="outline" disabled={!!busy} onClick={() => void approveCurrent()}>Approve V{currentVersion.version_no} for production</Button>}
              {currentVersion?.status === 'approved' && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">V{currentVersion.version_no} approved</span>}
              <span className="text-xs wall-muted">1 design token per refinement.</span>
            </div>
            {currentVersionId && (entitled
              ? <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-900">
                  <p className="font-semibold">Print-ready wall file unlocked for this version.</p>
                  {/* THE ORDER NUMBER STAYS ON SCREEN. The confirmation notice
                      is transient -- it is gone on the next action and on any
                      reload -- so a customer who looked away lost the only
                      thing they had to quote. This reads from the entitlement
                      itself, so it survives reload, is identical to what the
                      team sees on the QC board, and needs no state of its own.
                      Selectable and monospaced, because its whole job is to be
                      copied into an email. */}
                  {orderNumbers.length > 0 && <p className="mt-1">
                    {orderNumbers.length > 1 ? 'Order numbers: ' : 'Order number: '}
                    {orderNumbers.map((n, i) => <span key={n}>{i > 0 ? ', ' : ''}<span className="select-all font-mono font-semibold">{n}</span></span>)}
                  </p>}
                </div>
              : <div className="mt-3 flex items-center gap-2">
                  {/* CHARGE FOR THE PATH THEY TOOK. This button used to send
                      'wallpro_custom_file' and say $149 for EVERY entry path,
                      so a customer who picked the $79 catalog design was
                      charged $149 and one who had the $199 room design done
                      was undercharged by $50. designMode is the SKU (owner's
                      launch list, 2026-09-14), so the button now names and
                      charges what they actually chose, and the return path
                      follows the brand's own page so a WePrintWraps customer
                      is not dropped onto the DesignProAI route after paying. */}
                  <Button variant="outline" disabled={!!busy || !canCommitFromView(view)} title={canCommitFromView(view) ? undefined : 'Switch to "On your wall" first — the AI view is not your print file.'} onClick={() => void run('Opening checkout', async () => { window.location.assign(await startWallProCheckout(currentVersionId, wallProSkuFor(designMode), brand === 'weprintwraps' ? '/wallwrap-design' : '/printpro/wallpro')); })}>Unlock my print-ready wall file — {formatMoney(WALL_DESIGN_SKUS[designMode].cents)}</Button>
                  <span className="text-xs wall-muted">{WALL_DESIGN_SKUS[designMode].label} · seamless-verified, panelized to the roll, at your exact wall dimensions.</span>
                </div>)}
            {versions.length > 0 && <div className="mt-4"><p className="text-sm font-semibold">Version history</p>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">{versions.map(v => <button key={v.id} type="button" disabled={!!busy || v.id === currentVersionId} onClick={() => void restoreVersion(v)} className={'w-36 shrink-0 rounded-lg border p-2 text-left text-xs ' + (v.id === currentVersionId ? 'border-blue-500 bg-blue-50' : 'wall-edge hover:border-blue-400')}>
                <div className="aspect-[4/3] overflow-hidden rounded bg-[hsl(var(--wall-ground))]">{versionThumbs[v.artwork_path] && <img src={versionThumbs[v.artwork_path]} alt={'Version ' + v.version_no} className="h-full w-full object-cover" loading="lazy" />}</div>
                <p className="mt-1 font-semibold">V{v.version_no} · {v.kind}{v.status === 'approved' ? ' · approved' : ''}</p>
                <p className="truncate wall-muted">{v.prompt || v.note || (v.design_id ?? '')}</p>
                {v.id !== currentVersionId && <p className="text-blue-700">Restore</p>}
              </button>)}</div></div>}
          </section>}
          {artwork && versions.length > 0 && (!approvedVersion || approvedVersion.id !== currentVersionId) && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Print files are prepared from the approved version only. {approvedVersion ? `V${approvedVersion.version_no} is approved; restore it or approve the current version.` : 'Approve the current version when the design is right.'}</p>}
          <WallProductionPanels approved={approvedVersion} autoStart={productionKick} busy={!!busy}
            request={{ wallWidthIn: width, wallHeightIn: height, placement, repeatWidthIn: placement === 'repeat' ? repeatWidth : undefined, mirror: !!layout.mirror, bleedIn: printSettings.bleed, overlapIn: printSettings.overlap, panelWidthIn: WALLPRO_PRINT_WIDTH, targetPpi: printSettings.minPpi, wholeWall: true }} />
          {/* THE PRICE, FROM THE SAME GEOMETRY THAT PLANS THE PANELS.
              Owner, 2026-09-13: "all printed wrap is priced by the sq ft only."
              This used to lead with the BILLED roll footage — every panel at the
              full 54" width whatever is printed on it — which on this wall reads
              110.25 sq ft against a 94.67 sq ft wall. That overhead is the
              shop's to absorb; quoting it is a price the customer cannot check
              with a tape measure. The panel count and linear feet stay, as
              production facts rather than as the billing basis.
              The design line is the entry path they actually took, at its launch
              price, so what they are paying for is named rather than implied. */}
          {/* ONE PRICE, IN ONE PLACE. This block used to list the design AND
              the film and then a combined Total -- while the printing card
              further down quoted the film again on its own. A customer
              scrolling past both read $480.35, then $331.35, and could not
              tell which one they were paying. Two totals on a purchase page is
              a lost order, not a cosmetic nit.
              So on the partner page this block is the DESIGN purchase only,
              and the printing card below owns the film price and its button.
              Each number appears once, next to the thing that buys it. On the
              DesignProAI route there is no printing card, so the full quote
              stays as it was. */}
          {quote && <div className="rounded-xl border wall-edge bg-[hsl(var(--wall-card))] p-3 text-xs wall-muted">
            {quote.lines
              .filter(line => !(theme.showPrintOffer && line.label === 'Wall wrap film, printed'))
              .map(line => <p key={line.label} className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1 last:border-0">
                <span><strong className="wall-ink">{line.label}</strong> — {line.detail}</span>
                <span className="shrink-0 font-semibold wall-ink">{formatMoney(line.cents)}</span>
              </p>)}
            <p className="mt-1 flex items-baseline justify-between gap-3 border-t wall-edge pt-1">
              <span className="font-semibold wall-ink">{theme.showPrintOffer ? 'Design + print-ready files' : 'Total'}</span>
              <span className="text-sm font-bold wall-ink">{formatMoney(theme.showPrintOffer ? quote.totalCents - (quote.lines.find(l => l.label === 'Wall wrap film, printed')?.cents ?? 0) : quote.totalCents)}</span>
            </p>
            {theme.showPrintOffer && <p className="mt-1 text-[11px] wall-muted">Printing is priced separately below — it is optional, and the files are yours either way.</p>}
            {billing && <p className="mt-1 text-[11px] wall-muted">
              Printed as {billing.panels} {billing.panels === 1 ? 'panel' : 'panels'} × {billing.panelLengthIn}″ long on the {billing.billedWidthIn}″ roll ({billing.linearFeet} linear ft), Avery HP MPI 2610 wall vinyl, matte/luster. Half-inch overlap at every seam.
            </p>}
          </div>}
          <WallPrintOutput artwork={versions.length > 0 ? (approvedVersion && approvedVersion.id === currentVersionId ? tileArtwork : null) : tileArtwork} name={name} projectId={projectId} layout={layout} seamless={seamReceipt} settings={printSettings} onSettings={setPrintSettings} busy={!!busy} run={run} />
          {/* THE PRODUCT PAGE'S THIRD PURCHASE. Owner, 2026-09-14: this is
              "THE Product Page ... that they will purchase design and files
              and print from", and "the print is same wire for WPW orig
              wallproduct" -- so the printing is bought through WooCommerce
              product 70093 exactly as it always was, on the wall size they
              already typed. Design + files are the Stripe checkout above.
              Not shown on the DesignProAI route: that customer came for the
              tool, and the printing is a partner's business. */}
        </div>
      </div>

      {/* ── BELOW THE TOOL: FULL WIDTH ──────────────────────────────────────
          These three used to sit INSIDE the right-hand column of the
          [400px | rest] grid, which meant that once the form ended the page ran
          on for another two thousand pixels with a 400px column of nothing
          beside it (owner, 2026-09-14: "It needs to look like a real tool
          page"). The designer is a two-column workspace; what you buy after it
          is not, and it should use the whole page.

          Order is the customer's: what your design costs to print, then film on
          its own for the buyer who needs no design, then the questions. */}
      {theme.showPrintOffer && <div className="mt-5 space-y-5">
        <WallProPrintOffer billing={billing} />
        {/* THE THIRD THING THIS PAGE SELLS (owner, 2026-09-14: "buttons so they
            can directly buy printed wrap film if they don't need a new
            design"). It takes the wall's own square footage, so a customer who
            measured in step 1 sees a real price without entering anything
            twice -- and needs no design, photo or approved version. */}
        <WallProFilmOrder wallSqFt={billing?.wallSqFt ?? null} />
        {/* The product-page half: the questions and the search terms the wall
            product page answered. A page that REPLACES a product page has to
            answer what it answered, or the questions arrive as phone calls and
            the rankings go elsewhere. */}
        <WallProProductDetail faqHref={theme.showPrintOffer ? '/wall-wrap/faq' : '/printpro/wallpro/faq'} />
      </div>}
    </div>
    {/* On a phone the form and the wall photo stack, so marking corners puts
        Generate a full screen away and the customer scrolls up and down to
        reach it (owner, 2026-09-12: "I'm scrolling down and up just to hit
        generate"). The action follows them instead. `bottom-16` clears the
        app's own bottom nav. */}
    {!artwork && !busy && <div className="fixed inset-x-0 bottom-16 z-40 border-t wall-edge bg-[hsl(var(--wall-card))]/95 p-3 backdrop-blur lg:hidden" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
      <Button className={`w-full ${WALL_GRADIENT} text-white`} disabled={generateDisabled} onClick={() => void generate()}><Wand2 className="mr-2 h-4 w-4" />{generateLabel}</Button>
      {generationBlocker && <p className="mt-1 text-center text-[11px] wall-muted">{generationBlocker}</p>}
    </div>}
    <Dialog open={!!proof} onOpenChange={open => { if (!open) setProof(null); }}>
      <DialogContent className="max-w-[96vw] w-[1500px] max-h-[95vh] overflow-y-auto p-0">
        <DialogTitle className="sr-only">WallPro Design Approval Proof</DialogTitle>
        <DialogDescription className="sr-only">Before, after, and a detail close-up of your wall. Print, download, share, or email the proof.</DialogDescription>
        {proof && <ProfessionalProofSheet views={proof.views} designName={proof.name} finish="Matte / Luster"
          designProof={{ tool: 'wallpro', brand, sourceId: proof.sourceId, designId: proof.designId, generationId: proof.generationId, projectId: proof.projectId, wall: proof.wall }} />}
      </DialogContent>
    </Dialog>
  </main>
  </div>;
}
