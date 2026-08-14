/**
 * BrandCast — upload the install, broadcast everywhere.
 *
 * The upload-first AI video editor + multi-channel content creator:
 *   1. Shoot on your phone during an install → drop videos + photos here.
 *   2. FAST CUT: instant deterministic cut from YOUR footage (hook frame,
 *      photos interleaved) + AI captions + opt-in matched music → renders
 *      for Reel / Story / YouTube Short (+ long-form when the footage is long).
 *   3. The parser transcribes + vision-scores the uploads in the background;
 *      STORY EDIT then recuts from the hook-scored moments — dead air is cut
 *      out by construction, natural audio kept.
 *   4. CONTENT PACK: the OpenAI brain writes Blog, X, Substack, LinkedIn,
 *      IG and FB posts + YouTube metadata per ecosystem brand, grounded in
 *      the real transcript.
 *
 * ── THE SHOW PICKER (2026-08-07) ────────────────────────────────────────────
 * The two editors — `musicVideoEditor` and `editorCraft` — were built, wired
 * into `useBrandCast` and deployed, and were UNREACHABLE from this screen. The
 * hook routes on `showFormat`; nothing here ever passed one, so `routeEditor`
 * answered "no show chosen" on every run and the legacy planners cut everything
 * while the whole feature sat merged and invisible. A control that renders a
 * choice but never passes it is the same failure in a nicer costume, which is
 * why `tests/brandcast-show-picker.test.ts` asserts the value reaching the hook
 * rather than the picker existing.
 *
 * Three rules this screen keeps:
 *   1. THE PREVIEW COMES FROM `previewRoute`. It calls the identical
 *      `routeEditor` the cut calls, so what is shown before pressing cut and
 *      what actually happens cannot disagree. Nothing here re-derives a route.
 *   2. THE REFUSAL BLOCKS THE CUT. `formatFits` writes a full sentence naming
 *      what is missing AND the show to cut instead; it is rendered verbatim and
 *      the cut buttons go unavailable. Silent b-roll must never ship with a
 *      documentary's title on it.
 *   3. THE MUSIC EDITOR'S FALLBACK IS VISIBLE. A cut that did not land on the
 *      beat says so on screen. A fallback the operator cannot see is a music
 *      editor that quietly is not one.
 */
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { assetThumb } from "@/lib/assetThumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Upload, Radio, Copy, Download, X, FolderOpen, Clapperboard, Ban, Music } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useBrandCast, CAST_FORMATS, CAST_BRANDS, LONGFORM_THRESHOLD_S,
  type CastFormat, type BrandPack, type CoreStory, type LibraryPick,
  type CastEditorReport,
} from "@/hooks/useBrandCast";
import {
  TREATMENT_META, TREATMENT_ORDER, formatsFor,
  type BtiCredit, type CastTreatment,
} from "@/lib/castTreatments";
import { INGEST_TAGS } from "@/lib/ingestTags";
import {
  buildUsageMap, rankByFreshness, isFresh, summarise, usageFor, usageLabel,
} from "@/lib/clipFreshness";
import { musicPolicyForClips, transcriptHasSpeech } from "@/lib/musicPolicy";
import { tint } from "@/lib/content-tags";
// THE SHOW DECIDES THE EDITOR. `formatsForBrand` is the brand's own show list,
// `FORMAT_PACE` the difference between the two editors in one number. The ROUTE
// is never computed here — `previewRoute` owns that, so the preview and the cut
// ask the same question of the same function.
import { FORMAT_PACE, formatsForBrand, type ShowFormat } from "@/lib/showFormats";
// `REQUIREMENT_SIGNALS` is the ONE place a boolean this app can vouch for
// becomes a requirement string a show can demand. `formatFits` matches those
// strings by exact lowercase equality, so a hand-typed near-miss reads as a
// refusal that looks like a footage problem. Nothing here types one.
import { REQUIREMENT_SIGNALS, type DeclaredFacts, type EditorRoute } from "@/lib/editorRouter";
// THE ECOSYSTEM COLOUR FORMULA, and the two editors' own colours. `ChannelAngleCard`
// documents why a gradient was wrong for identity — tinted when idle, SOLID in
// its own colour with white text when active. `EditorBrainPanel` already assigns
// each editor its colour; importing that map is what stops a third mapping from
// existing — a hex copied here would drift the day one of them changes.
import { EDITOR_META } from "@/components/admin/EditorBrainPanel";

const PIECE_LABELS: Array<[keyof Omit<BrandPack, "brand" | "ai">, string]> = [
  ["blog", "Blog"], ["x", "X"], ["substack", "Substack"],
  ["linkedin", "LinkedIn"], ["instagram", "Instagram"], ["facebook", "Facebook"],
  ["youtube", "YouTube"],
];

function pieceText(key: string, piece: any): string {
  if (piece == null) return "";
  if (typeof piece === "string") return piece;
  if (key === "blog" || key === "substack") return `${piece.title || piece.subject || ""}\n\n${piece.body_markdown || ""}`.trim();
  if (key === "youtube") return `${piece.title || ""}\n\n${piece.description || ""}${piece.tags?.length ? `\n\nTags: ${piece.tags.join(", ")}` : ""}`.trim();
  return JSON.stringify(piece);
}

// ═══════════════════════════════════════════════════════════════════════════
// PURE HELPERS — no clock, no randomness, no network, no React.
//
// Exported and locked by `tests/brandcast-show-picker.test.ts`. The component
// below only arranges what these return; every rule a human could argue with
// lives here, where it can be run.
// ═══════════════════════════════════════════════════════════════════════════

/** The neutral chip colour, for the "no show" option. Slate, not a brand hue. */
const NEUTRAL = "#64748B";

// ─── The show picker ─────────────────────────────────────────────────────────

export interface ShowPicker {
  /** The brand's own shows, from `formatsForBrand`. */
  shows: ShowFormat[];
  hasShows: boolean;
  /** ALWAYS a sentence — including, especially, when there is nothing to pick. */
  message: string;
}

/**
 * The shows this brand actually has.
 *
 * A brand with none is a real answer and gets a sentence saying what that costs
 * (no editor is chosen, no reason is recorded) and where the fix lives. An empty
 * control with no explanation reads as a broken screen.
 */
export function showPickerFor(brand?: string | null, label?: string | null): ShowPicker {
  const shows = formatsForBrand(brand);
  const name = String(label || brand || "This brand").trim() || "This brand";
  return {
    shows,
    hasShows: shows.length > 0,
    message: shows.length
      ? `${name} has ${shows.length} show${shows.length === 1 ? "" : "s"}. Pick one and the SHOW decides which editor cuts — that decision, and its reason, are shown before anything is cut.`
      : `${name} has no shows declared in showFormats.ts, so there is nothing to pick here. This footage can still be cut, but by the legacy planners — which choose no editor and write down no reason. Declare a show in showFormats.ts to route it.`,
  };
}

// ─── Declared signals ────────────────────────────────────────────────────────

export interface DeclarableSignal {
  /** The `DeclaredFacts` key the router reads. Never a free string. */
  key: keyof DeclaredFacts;
  /** The LITERAL requirement string, taken from the router's own constant. */
  signal: string;
  label: string;
  /** Why this one can only be declared, or why a human might override it. */
  why: string;
  /** FALSE when the UI derives it rather than the operator ticking it. */
  manual: boolean;
}

/**
 * The signals a human (or this screen) can vouch for, keyed by the flag the
 * router understands.
 *
 * `signal` is read from `REQUIREMENT_SIGNALS`, never typed out. `formatFits`
 * compares requirement strings by exact lowercase equality, so dropping the
 * hyphen out of the walk-through requirement would silently satisfy nothing,
 * forever — and the resulting permanent refusal would read like a footage
 * problem rather than a typo. The test asserts each `signal` is a member of
 * `knownRequirements()`, and that no requirement literal is typed in this file.
 */
export const DECLARABLE_SIGNALS: readonly DeclarableSignal[] = [
  {
    key: "tour",
    signal: REQUIREMENT_SIGNALS.hasTour,
    label: "This is a walk-through / tour",
    why: "No content type in the Asset Library means \"tour\", so nothing can ever infer this from a clip row — it exists only if somebody says so.",
    manual: true,
  },
  {
    key: "personOnCamera",
    signal: REQUIREMENT_SIGNALS.hasPersonOnCamera,
    label: "There is a person on camera",
    why: "Read from the clip's content type where the taxonomy says so (documentary / ugc / unboxing). Tick it when the footage has a face and the label does not.",
    manual: true,
  },
  {
    key: "musicTrack",
    signal: REQUIREMENT_SIGNALS.hasMusicTrack,
    label: "A track is resolved for this cut",
    why: "Derived from the music toggle and the content rule — a talking clip blocks the bed, and a blocked track is not a track.",
    manual: false,
  },
  {
    key: "ticker",
    signal: REQUIREMENT_SIGNALS.hasTicker,
    label: "Shop names / IG handles are in for the ticker",
    // Behind the Install requires this, and it is the one requirement that can
    // NEVER be measured: the names are a person's claim about whose work is on
    // screen. Inferring one would credit a shop that never touched the vehicle.
    why: "The bottom crawl credits the shops. Type the names and handles in the Cut Editor — nothing in the system can invent a handle, so this only exists if somebody enters it.",
    manual: true,
  },
];

/** Signals this app MEASURES off the clip rows. Never ticked by a human. */
export const MEASURED_SIGNALS: readonly string[] = [
  REQUIREMENT_SIGNALS.hasSpeech,
  REQUIREMENT_SIGNALS.hasPersonOnCamera,
  // Read off the taxonomy — and off EVERY use a clip serves, not just its one
  // stored label, so a clip filed as the interview it also is still counts as
  // the install it always was.
  REQUIREMENT_SIGNALS.hasInstallFootage,
];

/**
 * Ticked boxes → the `DeclaredFacts` the hook hands to `footageFactsFrom`.
 *
 * Booleans only. `footageFactsFrom` is the single place a boolean becomes a
 * requirement string, and this keeps it that way: nothing between this screen
 * and the router ever carries a requirement literal.
 */
export function declarationsFor(
  ticked?: Partial<Record<keyof DeclaredFacts, boolean>> | null,
): DeclaredFacts {
  const out: DeclaredFacts = {};
  for (const s of DECLARABLE_SIGNALS) if (ticked?.[s.key] === true) out[s.key] = true;
  return out;
}

// ─── The gate ────────────────────────────────────────────────────────────────

export interface CutGate {
  canFastCut: boolean;
  canStoryEdit: boolean;
  /** The ROUTER's own refusal sentence, verbatim. Null when nothing is refused. */
  refusal: string | null;
  /** Which button the chosen show's editor is driven by. */
  runs: "fastCut" | "storyEdit" | null;
  /** Why the other button is unavailable for this show. */
  otherButton: string | null;
  /** Waiting on the parser — a different thing from a refusal, so it is a different field. */
  waiting: string | null;
}

/**
 * WHICH BUTTON MAY BE PRESSED, and why the others may not.
 *
 * A refusal closes BOTH cut buttons. That is the point of the whole feature: the
 * hook would throw the same refusal a second later, but a button that looks
 * pressable and then errors teaches an operator to ignore refusals. The sentence
 * is the router's — never re-worded here, or the screen and the error would say
 * two different things about one decision.
 *
 * With no show chosen the legacy planners still run exactly as before. That is
 * not an endorsement; it is the pre-existing behaviour, and the picker says
 * plainly what running without a show costs.
 */
export function cutGate(input: {
  showChosen: boolean;
  route?: EditorRoute | null;
  momentsReady?: boolean;
}): CutGate {
  const momentsReady = input.momentsReady === true;
  const parseWait =
    "Story Edit reads the parsed transcript + scored moments. The parser lands them within about ten minutes of upload; until then there is nothing to cut from.";

  if (!input.showChosen) {
    return {
      canFastCut: true,
      canStoryEdit: momentsReady,
      refusal: null,
      runs: null,
      otherButton: null,
      waiting: momentsReady ? null : parseWait,
    };
  }

  const route = input.route ?? null;
  if (!route?.ok) {
    return {
      canFastCut: false,
      canStoryEdit: false,
      // The router always writes one; the fallback exists so a null can never
      // render as an empty refusal box.
      refusal: route?.refusal || "This footage cannot honestly be cut as that show.",
      runs: null,
      otherButton: null,
      waiting: null,
    };
  }

  const runs: "fastCut" | "storyEdit" = route.editor === "music" ? "fastCut" : "storyEdit";
  const label = route.format?.label || "This show";
  const otherButton =
    runs === "fastCut"
      ? `${label} is cut by the music editor, which Fast Cut drives. Story Edit only drives the intelligence editor — it would refuse this show.`
      : `${label} is cut by the intelligence editor, which Story Edit drives. Fast Cut only drives the music editor — it would refuse this show.`;

  return {
    canFastCut: runs === "fastCut",
    canStoryEdit: runs === "storyEdit" && momentsReady,
    refusal: null,
    runs,
    otherButton,
    waiting: runs === "storyEdit" && !momentsReady ? parseWait : null,
  };
}

// ─── The music editor's honest fallback ──────────────────────────────────────

export interface BeatLine {
  format: CastFormat;
  /** TRUE only when the cut actually landed on the beat. */
  matched: boolean;
  /** Which fallback ran, when one did. */
  fallback: string | null;
  /** A sentence, always. */
  text: string;
}

/**
 * What the music editor DID, per format — including when it did not cut to the
 * beat.
 *
 * `planMusicVideoScenes` falls back to arithmetic below beat confidence and
 * flags it. Rendering only the successes would make the music editor look like
 * it always lands, and the one thing an operator needs to know about a music cut
 * is whether it is actually one. Formats with no `beatMatched` were not cut by
 * the music editor at all and are left out rather than shown as failures.
 */
export function beatReportLines(report?: CastEditorReport | null): BeatLine[] {
  return (report?.formats || [])
    .filter((f) => typeof f.beatMatched === "boolean")
    .map((f) => {
      const matched = f.beatMatched === true;
      const fallback = matched ? null : String(f.fallback || "no beat grid");
      const bpm = Number.isFinite(Number(f.bpm)) && Number(f.bpm) > 0 ? Math.round(Number(f.bpm)) : null;
      const conf = Number.isFinite(Number(f.confidence)) ? Math.round(Number(f.confidence) * 100) : null;
      return {
        format: f.format,
        matched,
        fallback,
        text: matched
          ? `Cut to the beat${bpm ? ` — ${bpm} BPM` : ""}${conf === null ? "" : `, ${conf}% beat confidence`}, ` +
            `${f.actionMatched ?? 0} of ${f.scenes} shot(s) landing on an accent.`
          : `NOT cut to the beat (${fallback}) — this cut is arithmetic, not beat-driven. ` +
            (f.notes?.[0] || "The music editor fell back to the deterministic planner."),
      };
    });
}

export default function BrandCast({ onQueued }: { onQueued?: () => void }) {
  const {
    session, progress, busy, uploadFootage, addFromLibrary, clearSession,
    fastCut, storyEdit, buildContentPacks, sendToApprovalBoard,
    // The editor decision and its paperwork. `previewRoute` is the SAME
    // `routeEditor` the cut runs — this screen never derives a second one.
    previewRoute, editorReport,
  } = useBrandCast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [showLib, setShowLib] = useState(false);
  const [libSel, setLibSel] = useState<Record<string, LibraryPick>>({});
  const [libSearch, setLibSearch] = useState("");
  const [libType, setLibType] = useState<string>("all");
  // FRESH FIRST. 322 of 405 raw videos had never been used in any render —
  // the footage was there, nothing ever showed what had already been spent.
  const [freshOnly, setFreshOnly] = useState(false);
  // Real pool size, so "showing N" can never be mistaken for "that's all there is".
  const libTotal = useRef<number | null>(null);
  const [topic, setTopic] = useState("");
  const [brand, setBrand] = useState("weprintwraps");
  const [packBrands, setPackBrands] = useState<string[]>(["weprintwraps", "wraptvworld"]);
  const [withMusic, setWithMusic] = useState(false);
  const [formats, setFormats] = useState<CastFormat[]>(["reel", "short"]);
  const [treatment, setTreatment] = useState<CastTreatment>("organic");
  const [credit, setCredit] = useState<BtiCredit>({});
  // THE BRAND BUG. The renderer has always taken logo:false / logoUrl /
  // logoPosition per cut and the Cut Editor exposes all three — BrandCast
  // never did, so a new cut always got the brand default in the top-right and
  // the only way to change it was to render first and re-edit afterwards.
  const [logo, setLogo] = useState<"brand" | "none" | "custom">("brand");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoPosition, setLogoPosition] = useState<"tr" | "tl" | "br" | "bl">("tr");
  const [packs, setPacks] = useState<BrandPack[]>([]);
  const [story, setStory] = useState<CoreStory | null>(null);
  const [packTab, setPackTab] = useState("");
  // THE SHOW. Empty string = no show chosen, which is a real, named state (the
  // legacy planners), not a default show. `showFormats.ts` is explicit that
  // there is no house default and there must not be one.
  const [showFormatKey, setShowFormatKey] = useState<string>("");
  // What the operator vouches for that no clip row can record.
  const [ticked, setTicked] = useState<Partial<Record<keyof DeclaredFacts, boolean>>>({});

  const totalFootage = useMemo(
    () => (session?.uploads || []).reduce((t, u) => t + u.duration, 0),
    [session],
  );
  const longformReady = totalFootage >= LONGFORM_THRESHOLD_S;

  // Parse progress for this session's uploads (transcripts + moments feed
  // Story Edit and ground the content packs).
  const { data: parseState } = useQuery({
    queryKey: ["brandcast-parse", session?.tag],
    enabled: !!session?.tag,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data: jobs } = await (supabase as any)
        .from("video_parse_jobs")
        .select("id, status")
        .contains("tags", [session!.tag]);
      const { data: sources } = await (supabase as any)
        .from("media_sources")
        .select("id")
        .ilike("filename", `${session!.tag}-%`)
        .limit(50);
      const ids = (sources || []).map((s: any) => s.id);
      let momentCount = 0;
      if (ids.length) {
        const { count } = await (supabase as any)
          .from("content_moments")
          .select("id", { count: "exact", head: true })
          .in("source_id", ids);
        momentCount = count || 0;
      }
      const parsed = (jobs || []).filter((j: any) => ["complete", "skipped"].includes(j.status)).length;
      return { total: (jobs || []).length, parsed, moments: momentCount };
    },
  });
  const momentsReady = (parseState?.moments || 0) > 0;

  // Clip library (agent_media_assets) — pick existing footage, no re-upload.
  const { data: libItems } = useQuery({
    queryKey: ["brandcast-library", libSearch, libType],
    enabled: showLib,
    queryFn: async () => {
      // EVERY CUT WAS DRAWN FROM THE SAME ~40 CLIPS.
      //
      // This asked for the newest 60 rows of agent_media_assets, unfiltered.
      // The library holds 419 raw videos; only 40 of those 60 rows were video,
      // and 11 slots were spent on content_type 'render'/'audio_master' — which
      // CLAUDE.md says must never be in the raw pool at all ("RAW ONLY … the
      // library is what you cut FROM"). So roughly 9% of the footage was ever
      // offered, the same 9% every session, and the whole 98-clip December
      // shoot was invisible. That is why every music video showed the same
      // installers: the picker could not see anything else.
      let q = (supabase as any)
        .from("agent_media_assets")
        .select("id, title, original_filename, storage_url, thumbnail_url, drive_file_id, asset_type, content_type, tags, source_folder", { count: "exact" })
        .not("storage_url", "is", null)
        // Renders and archived audio masters are finished output, not source.
        .not("content_type", "in", "(render,audio_master)");
      if (libType !== "all") q = q.contains("tags", [libType]);
      if (libSearch.trim()) {
        const term = `%${libSearch.trim()}%`;
        q = q.or(`title.ilike.${term},original_filename.ilike.${term},source_folder.ilike.${term}`);
      }
      const { data, count } = await q.order("created_at", { ascending: false }).limit(300);
      libTotal.current = count ?? null;
      return ((data || []) as any[])
        .filter((a) => !/\.(mp3|wav|m4a|aac)(\?.*)?$/i.test(a.storage_url || ""))
        .map((a): LibraryPick => ({
          id: String(a.id),
          url: a.storage_url,
          name: a.title || a.original_filename || "clip",
          kind: a.asset_type === "image" ? "image" : "video",
          // Drives the music rule — documentary/UGC never get a bed.
          contentType: a.content_type ?? null,
          // Kept so the tile can resolve a real picture (a Drive link is a web
          // page — <video src> on it renders black).
          thumbnailUrl: a.thumbnail_url ?? null,
          driveFileId: a.drive_file_id ?? null,
          assetType: a.asset_type ?? null,
          hasSpeech: false, // filled below once the speech set resolves
        }));
    },
  });

  // WHICH CLIPS HAVE SOMEONE TALKING. media_sources holds the Whisper
  // transcripts; a clip with real words is original-content material and must
  // never end up under a music bed (owner rule 2026-08-05). content_type would
  // not have caught this — it is NULL on all 419 raw videos.
  const { data: speechSet } = useQuery({
    queryKey: ["brandcast-speech"],
    enabled: showLib,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("media_sources")
        .select("storage_url, transcript")
        .not("transcript", "is", null)
        .limit(1000);
      const set = new Set<string>();
      for (const r of (data || []) as Array<{ storage_url?: string; transcript?: string }>) {
        if (r.storage_url && transcriptHasSpeech(r.transcript)) set.add(r.storage_url);
      }
      return set;
    },
  });

  // What every past render actually used. video_render_jobs.blueprint carries
  // scenes[].clipUrl, so this is a complete usage history that nothing was
  // reading — it is what makes "fresh" a fact rather than a guess.
  const { data: clipUsage } = useQuery({
    queryKey: ["brandcast-clip-usage"],
    enabled: showLib,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("video_render_jobs")
        .select("blueprint, created_at")
        .order("created_at", { ascending: false })
        .limit(400);
      return buildUsageMap((data || []) as any[]);
    },
  });

  // Unused footage first, then least-used, then least-recently-used. The old
  // newest-first order is exactly why the same clips kept winning.
  const rankedLib = useMemo(() => {
    const usage = clipUsage ?? new Map();
    const withSpeech = (libItems || []).map((c) => ({ ...c, hasSpeech: speechSet?.has(c.url) ?? false }));
    const all = rankByFreshness(withSpeech, usage);
    return freshOnly ? all.filter((c) => isFresh(usage, c.url)) : all;
  }, [libItems, clipUsage, freshOnly, speechSet]);

  // Talking clips currently selected — a music bed over these is the exact
  // thing the owner rule forbids.
  const talkingPicked = useMemo(
    () => Object.values(libSel).filter((p) => speechSet?.has(p.url)).length,
    [libSel, speechSet],
  );

  const freshStats = useMemo(
    () => summarise(libItems || [], clipUsage ?? new Map()),
    [libItems, clipUsage],
  );

  // ── WHICH SHOW, AND WHICH EDITOR CUTS IT ──────────────────────────────────
  const picker = useMemo(
    () => showPickerFor(brand, CAST_BRANDS.find((b) => b.slug === brand)?.label),
    [brand],
  );
  const chosenShow = useMemo(
    () => picker.shows.find((s) => s.key === showFormatKey) || null,
    [picker, showFormatKey],
  );

  // "A music track" is a requirement of the Cribs show, and a track the content
  // rule blocks is not a track. `musicPolicyForClips` is the ONE implementation
  // of that rule — this reads it rather than restating it.
  const musicVerdict = useMemo(
    () => musicPolicyForClips((session?.uploads || []).map((u) => ({ contentType: u.contentType, hasSpeech: u.hasSpeech }))),
    [session],
  );
  const trackLikely = withMusic && musicVerdict.allowMusic;

  // The declarations the router reads. Booleans in, `DeclaredFacts` out —
  // `footageFactsFrom` (inside `previewRoute`) is the only place these become
  // requirement strings.
  const declared = useMemo(
    () => declarationsFor({ ...ticked, musicTrack: ticked.musicTrack === true || trackLikely }),
    [ticked, trackLikely],
  );

  // THE PREVIEW IS THE CUT'S OWN ANSWER. `previewRoute` runs the identical
  // `routeEditor` with the identical facts, so what is on screen and what
  // happens on press cannot disagree. Re-deriving it here is precisely the bug
  // `editorRouter.ts` exists as a module to prevent.
  const preview = useMemo(
    () => previewRoute({ showFormat: showFormatKey || null, brand, declared }),
    [previewRoute, showFormatKey, brand, declared],
  );

  const gate = useMemo(
    () => cutGate({ showChosen: !!showFormatKey, route: preview.route, momentsReady }),
    [showFormatKey, preview, momentsReady],
  );

  const beatLines = useMemo(() => beatReportLines(editorReport), [editorReport]);

  const toggleLibPick = (p: LibraryPick) =>
    setLibSel((cur) => {
      const next = { ...cur };
      if (next[p.id]) delete next[p.id]; else next[p.id] = p;
      return next;
    });

  const doAddFromLibrary = async () => {
    const picks = Object.values(libSel);
    if (!picks.length) { toast.error("Tap the clips you want first"); return; }
    if (!session && !topic.trim()) { toast.error("Say what the job is first — it drives the hook and the story"); return; }
    try {
      await addFromLibrary(picks, session?.topic || topic.trim());
      setLibSel({});
      setShowLib(false);
      toast.success(`${picks.length} library clip(s) added to the session`);
    } catch (e: any) { toast.error(e?.message || "Add from library failed"); }
  };

  const stageFiles = (files: File[] | FileList | null) => {
    if (!files) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("video/") || f.type.startsWith("image/"));
    if (!list.length) { toast.error("Drop videos or photos"); return; }
    setStaged((cur) => [...cur, ...list]);
  };

  const toggleFormat = (f: CastFormat) =>
    setFormats((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));

  // Formats are scoped to the treatment: an ad in 9:16 competes with organic
  // Reels for the same placement, and BTI in 4:5 crops the lower third off.
  const allowedFormats = formatsFor(treatment) as CastFormat[];

  const pickTreatment = (t: CastTreatment) => {
    setTreatment(t);
    // Drop any selected format the new treatment can't render, and fall back
    // to its first — otherwise the Cut button silently does nothing.
    const allowed = formatsFor(t) as CastFormat[];
    setFormats((cur) => {
      const kept = cur.filter((f) => allowed.includes(f));
      return kept.length ? kept : [allowed[0]];
    });
  };

  const togglePackBrand = (slug: string) =>
    setPackBrands((cur) => (cur.includes(slug) ? cur.filter((x) => x !== slug) : [...cur, slug]));

  const doUpload = async () => {
    if (!staged.length) { toast.error("Pick the install footage first"); return; }
    if (!topic.trim()) { toast.error("Say what the job is — it drives the hook, captions and copy"); return; }
    try {
      await uploadFootage(staged, topic.trim(), brand);
      setStaged([]);
      if (fileRef.current) fileRef.current.value = "";
      toast.success("Footage staged — parse queued. Build your cut below.");
    } catch (e: any) { toast.error(e?.message || "Upload failed"); }
  };

  // A brand owns its shows. Switching brands cannot leave another brand's show
  // selected — the router would refuse it ("Behind the Brand is wraptvworld's
  // show, not weprintwraps's"), which is correct but reads as a bug when the
  // operator never chose that combination.
  const pickBrand = (slug: string) => {
    setBrand(slug);
    if (showFormatKey && !formatsForBrand(slug).some((f) => f.key === showFormatKey)) setShowFormatKey("");
  };

  const doFastCut = async () => {
    if (!formats.length) { toast.error("Pick at least one format"); return; }
    // THE REFUSAL BLOCKS THE CUT. The button is already unavailable; this is the
    // second lock, for a keyboard press or a stale render.
    if (!gate.canFastCut) { toast.error(gate.refusal || gate.otherButton || "Fast Cut is not available for this show."); return; }
    try {
      // `showFormat` IS the wire. Without it `routeEditor` answers "no show
      // chosen" and the legacy planner cuts — which is what made both editors
      // unreachable from this screen for as long as they have existed.
      const results = await fastCut({
        formats, brand, topic: session?.topic || topic, withMusic, treatment, credit, logo, logoUrl, logoPosition,
        showFormat: showFormatKey || null,
        declared,
      });
      const ok = results.filter((r) => r.ok).length;
      if (ok) { toast.success(`${ok} render(s) queued — watch them in Renders`); onQueued?.(); }
      results.filter((r) => !r.ok).forEach((r) => toast.error(`${CAST_FORMATS[r.format].label}: ${r.error}`));
    } catch (e: any) { toast.error(e?.message || "Fast cut failed"); }
  };

  const doStoryEdit = async () => {
    if (!formats.length) { toast.error("Pick at least one format"); return; }
    if (!gate.canStoryEdit) { toast.error(gate.refusal || gate.waiting || gate.otherButton || "Story Edit is not available for this show."); return; }
    try {
      const { results } = await storyEdit({
        formats, brand, topic: session?.topic || topic, treatment, credit, logo, logoUrl, logoPosition,
        showFormat: showFormatKey || null,
        declared,
      });
      const ok = results.filter((r) => r.ok).length;
      if (ok) { toast.success(`Story edit queued (${ok} render(s)) — dead air is out, natural sound stays`); onQueued?.(); }
      results.filter((r) => !r.ok).forEach((r) => toast.error(`${CAST_FORMATS[r.format].label}: ${r.error}`));
    } catch (e: any) { toast.error(e?.message || "Story edit failed"); }
  };

  const doPacks = async () => {
    if (!packBrands.length) { toast.error("Pick at least one brand for the packs"); return; }
    try {
      const out = await buildContentPacks(packBrands, session?.topic || topic);
      setPacks(out.packs);
      setStory(out.story);
      setPackTab(out.packs[0]?.brand || "");
      toast.success(
        `${out.packs.length} brand pack(s) written${out.story ? " from the footage's core story" : ""}` +
        `${out.packs.some((p) => !p.ai) ? " (some fell back to templates — check the AI brain deploy)" : ""}`,
      );
    } catch (e: any) { toast.error(e?.message || "Content packs failed"); }
  };

  const doSendToBoard = async () => {
    try {
      const out = await sendToApprovalBoard(packs, session?.topic || topic);
      toast.success(`${out.cards} pack(s) sent to Content Review (${out.attachments} render(s) attached) — approve at /engine-room/approvals`);
    } catch (e: any) { toast.error(e?.message || "Send to board failed"); }
  };

  const downloadPacks = () => {
    const md = packs.map((p) => {
      const label = CAST_BRANDS.find((b) => b.slug === p.brand)?.label || p.brand;
      const pieces = PIECE_LABELS
        .map(([key, name]) => {
          const t = pieceText(key, (p as any)[key]);
          return t ? `## ${name}\n\n${t}` : "";
        })
        .filter(Boolean).join("\n\n---\n\n");
      return `# ${label}\n\n${pieces}`;
    }).join("\n\n\n");
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `brandcast-pack-${(session?.tag || "content").slice(-6)}.md`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const activePack = packs.find((p) => p.brand === packTab);

  return (
    <Card className="border-gray-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg text-gray-900">
          <Radio className="w-5 h-5 text-[#ec4899]" /> BrandCast
          <span className="text-xs font-normal text-gray-500 ml-2">drop your footage → AI makes the videos + the posts → you approve</span>
        </CardTitle>
        <div className="flex flex-wrap gap-3 text-[11px] text-gray-500 mt-1">
          <span><b className="text-gray-800">1.</b> Drop footage (or pick from the library)</span>
          <span><b className="text-gray-800">2.</b> AI cuts the videos + writes the posts</span>
          <span><b className="text-gray-800">3.</b> Approve → it lands on the calendar → publishes</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── 1. Drop zone ── */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); stageFiles(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition ${dragging ? "border-[#3b82f6] bg-blue-50" : "border-gray-300 bg-gray-50 hover:border-gray-400"}`}
        >
          <input
            ref={fileRef} type="file" accept="video/*,image/*" multiple hidden
            onChange={(e) => { stageFiles(e.target.files); if (fileRef.current) fileRef.current.value = ""; }}
          />
          <Upload className="w-7 h-7 mx-auto text-[#3b82f6] mb-1.5" />
          <p className="text-sm font-semibold text-gray-900">
            {staged.length ? `${staged.length} file(s) ready — add more or stage below` : "Drop install videos + photos here"}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">or tap to browse — phone camera works too</p>
        </div>
        {staged.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {staged.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-gray-100 border border-gray-200 px-2 py-0.5 text-[11px] text-gray-700">
                {f.type.startsWith("video/") ? "🎬" : "🖼"} {f.name.slice(0, 28)}
                <button onClick={() => setStaged((cur) => cur.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}
        <div className="rounded-lg border border-gray-200 p-3 space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder='What is this job? e.g. "Matte black Escalade full wrap for Summit Realty"'
              value={topic} onChange={(e) => setTopic(e.target.value)}
              className="flex-1 bg-white text-gray-900 border-gray-300 placeholder:text-gray-400"
            />
            <Button variant="outline" onClick={() => setShowLib((s) => !s)} className="shrink-0">
              <FolderOpen className="w-4 h-4 mr-1.5" /> {showLib ? "Close library" : "Pick from library"}
            </Button>
            <Button onClick={doUpload} disabled={busy || !staged.length}
              className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] hover:opacity-90 text-white font-semibold shrink-0">
              {busy && progress.stage === "upload" ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{progress.detail}</> : "Stage Footage"}
            </Button>
          </div>
          {showLib && (
            <div className="space-y-2">
              {/* SEARCH + TYPE. Without these the picker only ever showed the
                  newest slice of the library, so every cut was built from the
                  same handful of clips. */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={libSearch}
                  onChange={(e) => setLibSearch(e.target.value)}
                  placeholder="Search the library — name, filename or shoot (e.g. ghost-industries)"
                  className="flex-1 bg-white text-sm text-gray-900"
                />
                <select
                  value={libType}
                  onChange={(e) => setLibType(e.target.value)}
                  className="h-9 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700"
                >
                  <option value="all">All types</option>
                  {INGEST_TAGS.map((t) => (
                    <option key={t.key} value={t.key}>{t.emoji} {t.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setFreshOnly((v) => !v)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-bold transition ${
                    freshOnly
                      ? "border-transparent bg-emerald-600 text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:border-emerald-400 hover:text-emerald-700"
                  }`}
                >
                  ✨ Never used ({freshStats.fresh})
                </button>
                <span className="text-[11px] text-gray-500">
                  {freshStats.fresh} of {freshStats.total} here have never been cut
                  {freshStats.total ? ` (${freshStats.freshPercent}%)` : ""} — unused footage is sorted first.
                </span>
              </div>
              <p className="text-[11px] text-gray-500">
                Showing {rankedLib.length}
                {libTotal.current != null && libTotal.current > (libItems || []).length
                  ? ` of ${libTotal.current} in the pool — narrow it with search or a type`
                  : " clip(s)"}
                . Finished renders and audio masters are excluded — this is what you cut FROM.
              </p>
              {talkingPicked > 0 && (
                <p className="rounded-md bg-indigo-50 px-2 py-1.5 text-[11px] font-medium text-indigo-800">
                  🎤 {talkingPicked} selected clip{talkingPicked === 1 ? " has" : "s have"} someone talking —
                  this cut stays original content with its own sound. Music is off.
                </p>
              )}
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 max-h-64 overflow-y-auto pr-1">
                {rankedLib.map((p) => (
                  <button key={p.id} onClick={() => toggleLibPick(p)}
                    className={`overflow-hidden rounded-lg border text-left transition ${libSel[p.id] ? "border-[#3b82f6] ring-2 ring-[#3b82f6]/30" : "border-gray-200 hover:border-gray-300"}`}>
                    <div className="relative">
                      {/* How worn this clip is. Silence means never cut. */}
                      {(() => {
                        const lbl = usageLabel(usageFor(clipUsage ?? new Map(), p.url));
                        if (speechSet?.has(p.url)) {
                          return (
                            <span className="absolute left-1 top-1 z-10 rounded bg-indigo-600/90 px-1 text-[9px] font-bold text-white"
                              title="Someone is talking in this clip — original content, never a music video">
                              🎤 talking
                            </span>
                          );
                        }
                        return lbl ? (
                          <span className="absolute left-1 top-1 z-10 rounded bg-black/70 px-1 text-[9px] font-bold text-amber-300">
                            {lbl}
                          </span>
                        ) : (
                          <span className="absolute left-1 top-1 z-10 rounded bg-emerald-600/90 px-1 text-[9px] font-bold text-white">
                            new
                          </span>
                        );
                      })()}
                      {p.kind === "video"
                        ? (() => {
                            const t = assetThumb({ asset_type: (p as any).assetType || "video", storage_url: p.url, thumbnail_url: (p as any).thumbnailUrl, drive_file_id: (p as any).driveFileId });
                            if (t.kind === "image") return <img src={t.src} alt={p.name} loading="lazy" className="h-20 w-full bg-gray-100 object-cover" />;
                            if (t.kind === "video") return <video playsInline src={t.src} preload="metadata" muted className="h-20 w-full bg-black object-cover" />;
                            return <div className="flex h-20 w-full items-center justify-center bg-slate-100 text-[10px] text-slate-400">no preview</div>;
                          })()
                        : <img src={p.url} alt={p.name} className="h-20 w-full object-cover bg-gray-100" loading="lazy" />}
                      {libSel[p.id] && <span className="absolute left-1 top-1 rounded-full bg-[#3b82f6] px-1.5 text-[10px] font-bold text-white">✓</span>}
                    </div>
                    <div className="truncate px-1.5 py-1 text-[10px] text-gray-600">{p.name}</div>
                  </button>
                ))}
                {!(libItems || []).length && <p className="col-span-full text-sm text-gray-500">Library is empty — upload above or run a Drive sync.</p>}
              </div>
              <Button size="sm" onClick={doAddFromLibrary} disabled={busy || !Object.keys(libSel).length}
                className="bg-gray-900 hover:bg-gray-800 text-white font-semibold">
                + Add {Object.keys(libSel).length || ""} selected to session
              </Button>
            </div>
          )}
          {session && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
              <Badge variant="outline" className="border-gray-300">{session.uploads.filter((u) => u.kind === "video").length} video(s)</Badge>
              <Badge variant="outline" className="border-gray-300">{session.uploads.filter((u) => u.kind === "image").length} photo(s)</Badge>
              <Badge variant="outline" className="border-gray-300">{Math.round(totalFootage)}s footage</Badge>
              {parseState && (
                <Badge className={momentsReady ? "bg-green-50 text-green-700 border-green-300" : "bg-gray-100 text-gray-600 border-gray-300"}>
                  parse {parseState.parsed}/{parseState.total} · {parseState.moments} moments
                </Badge>
              )}
              <span className="text-gray-400">“{session.topic}”</span>
              <button onClick={() => { clearSession(); setPacks([]); }} className="ml-auto inline-flex items-center gap-1 text-gray-400 hover:text-red-500">
                <X className="w-3 h-3" /> new session
              </button>
            </div>
          )}
        </div>

        {/* ── 2. Cut controls ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Primary brand (stamps the videos)</div>
            <div className="flex flex-wrap gap-1.5">
              {CAST_BRANDS.map((b) => (
                <button key={b.slug} onClick={() => pickBrand(b.slug)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${brand === b.slug ? "border-transparent bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}>
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          {/* WHAT THIS CUT IS FOR. The renderer has always been able to make
              all three; until now nothing could ask for anything but organic —
              the Behind The Install broadcast pack shipped with no caller at
              all, so the MTV furniture was unreachable from any button. */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Treatment</div>
            <div className="flex flex-wrap gap-1.5">
              {TREATMENT_ORDER.map((t) => (
                <button key={t} onClick={() => pickTreatment(t)} title={TREATMENT_META[t].blurb}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${treatment === t ? "border-transparent bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}>
                  {TREATMENT_META[t].label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-gray-500">{TREATMENT_META[treatment].blurb}</p>
          </div>

          {/* THE BRAND BUG — choose it here, not after the render. */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Logo</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {([
                ["brand", "Brand default"],
                ["none", "No logo"],
                ["custom", "Custom…"],
              ] as Array<[typeof logo, string]>).map(([k, label]) => (
                <button key={k} onClick={() => setLogo(k)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${logo === k ? "border-transparent bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}>
                  {label}
                </button>
              ))}
              {logo !== "none" && ([
                ["tr", "↗ Top right"],
                ["tl", "↖ Top left"],
                ["br", "↘ Bottom right"],
              ] as Array<[typeof logoPosition, string]>).map(([k, label]) => (
                <button key={k} onClick={() => setLogoPosition(k)}
                  title={k.startsWith("b") && treatment === "bti" ? "Bottom collides with the ticker and lower thirds on a BTI cut" : undefined}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${logoPosition === k ? "border-transparent bg-blue-600 text-white" : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"}`}>
                  {label}
                </button>
              ))}
            </div>
            {logo === "custom" && (
              <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://… PNG with transparency"
                className="mt-1.5 h-8 bg-white text-xs text-gray-900" />
            )}
            {logo === "custom" && !logoUrl.trim() && (
              <p className="mt-1 text-[11px] text-amber-600">
                No URL yet — this will fall back to the brand logo rather than render nothing.
              </p>
            )}
            {treatment === "bti" && logoPosition.startsWith("b") && (
              <p className="mt-1 text-[11px] text-amber-600">
                On a BTI cut the bottom carries the ticker and lower thirds — the logo will overlap them.
              </p>
            )}
          </div>

          {/* The BTI furniture. Every one of these renders on screen verbatim,
              so they are typed by a human — nothing here is generated. Leave a
              field empty and that piece simply doesn't render. */}
          {treatment === "bti" && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Episode credits <span className="normal-case font-normal text-gray-400">— typed, never generated. Blank = not rendered.</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {([
                  ["shop", "Shop (e.g. Ghost Industries)"],
                  ["city", "City (e.g. Mesa, Arizona)"],
                  ["handle", "@handle"],
                  ["episode", "Episode no. (014)"],
                  ["series", "Series strap (WRAP ROCK)"],
                  ["songTitle", "Song title (NOW PLAYING)"],
                  ["songArtist", "Song artist"],
                  ["qrUrl", "Submission URL (end-card QR)"],
                ] as Array<[keyof BtiCredit, string]>).map(([key, ph]) => (
                  <Input key={key} value={(credit[key] as string) || ""} placeholder={ph}
                    onChange={(e) => setCredit((c) => ({ ...c, [key]: e.target.value }))}
                    className="h-8 border-gray-300 bg-white text-xs" />
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Formats</div>
            <div className="flex flex-wrap gap-1.5">
              {allowedFormats.map((f) => {
                const locked = f === "longform" && !longformReady;
                return (
                  <button key={f} onClick={() => !locked && toggleFormat(f)} disabled={locked}
                    title={locked ? `Long-form unlocks at ${LONGFORM_THRESHOLD_S / 60}+ min of footage` : undefined}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${locked ? "border-gray-200 bg-gray-50 text-gray-300" : formats.includes(f) ? "border-transparent bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}>
                    {CAST_FORMATS[f].label}
                  </button>
                );
              })}
              <button onClick={() => {
                  if (!withMusic && talkingPicked > 0) {
                    toast.error(
                      `${talkingPicked} selected clip${talkingPicked === 1 ? " has" : "s have"} talking — cut it as original content. A track would bury them.`,
                    );
                    return;
                  }
                  setWithMusic((m) => !m);
                }}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${withMusic ? "border-transparent bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}>
                🎵 {withMusic ? "Matched music ON" : "Add matched music"}
              </button>
            </div>
          </div>
        </div>

        {/* ── THE SHOW — chosen BEFORE anything is cut ─────────────────────
            The show decides the editor. This block exists because both editors
            were merged, wired and unreachable: nothing on this screen passed
            `showFormat`, so the router answered "no show chosen" every time. */}
        <div className="rounded-lg border border-gray-200 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Clapperboard className="h-4 w-4 text-[#3b82f6]" />
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              The show — it decides which editor cuts
            </span>
          </div>
          <p className="text-[11px] text-gray-500">{picker.message}</p>

          {picker.hasShows && (
            <div className="flex flex-wrap gap-1.5">
              {/* THE ECOSYSTEM COLOUR FORMULA: tinted idle, SOLID in its own
                  colour with white text when active (see ChannelAngleCard —
                  a gradient here would make the two editors read the same). */}
              <button
                onClick={() => setShowFormatKey("")}
                title="Run the legacy planners — no editor is chosen and no reason is recorded."
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-all",
                  !showFormatKey ? "border-transparent text-white shadow-sm" : "hover:shadow-sm",
                )}
                style={
                  !showFormatKey
                    ? { backgroundColor: NEUTRAL }
                    : { backgroundColor: tint(NEUTRAL), borderColor: tint(NEUTRAL, 0.4), color: NEUTRAL }
                }
              >
                No show (legacy)
              </button>
              {picker.shows.map((s) => {
                const color = EDITOR_META[s.editor].color;
                const on = showFormatKey === s.key;
                return (
                  <button
                    key={s.key}
                    onClick={() => setShowFormatKey(on ? "" : s.key)}
                    title={s.reference}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold transition-all",
                      on ? "border-transparent text-white shadow-sm" : "hover:shadow-sm",
                    )}
                    style={
                      on
                        ? { backgroundColor: color }
                        : { backgroundColor: tint(color), borderColor: tint(color, 0.4), color }
                    }
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* WHAT THE OPERATOR CAN VOUCH FOR. Booleans only — `footageFactsFrom`
              turns them into the requirement strings, so no literal is typed
              anywhere on this screen. */}
          {picker.hasShows && (
            <div className="flex flex-wrap items-center gap-1.5">
              {DECLARABLE_SIGNALS.filter((s) => s.manual).map((s) => {
                const on = ticked[s.key] === true;
                return (
                  <button
                    key={String(s.key)}
                    onClick={() => setTicked((t) => ({ ...t, [s.key]: !t[s.key] }))}
                    title={`${s.why} It satisfies the requirement “${s.signal}”.`}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all",
                      on
                        ? "border-transparent bg-gray-900 text-white"
                        : "border-gray-300 bg-white text-gray-600 hover:border-gray-400",
                    )}
                  >
                    {on ? "✓ " : ""}{s.label}
                  </button>
                );
              })}
              <span className="text-[11px] text-gray-500">
                {trackLikely
                  ? "🎵 A track is declared for this cut — the show may demand one."
                  : withMusic
                    ? `🎵 No track will reach this cut — ${musicVerdict.reason}`
                    : "🎵 No track requested, so a show that needs one will be refused until you turn matched music on."}
              </span>
            </div>
          )}

          {/* THE CHOICE, WITH ITS REASON — before anything is cut. */}
          {chosenShow && (() => {
            const meta = EDITOR_META[chosenShow.editor];
            const pace = FORMAT_PACE[chosenShow.editor];
            return (
              <div
                className="rounded-lg border p-2.5"
                style={{ borderColor: tint(meta.color, 0.4), backgroundColor: tint(meta.color, 0.06) }}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase text-white"
                    style={{ backgroundColor: meta.color }}
                  >
                    {meta.label}
                  </span>
                  <span className="text-sm font-bold text-gray-900">{chosenShow.label}</span>
                  <span className="text-[11px] text-gray-500">{chosenShow.reference}</span>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-gray-700">
                  <span className="font-semibold">Why this editor:</span> {chosenShow.because}
                </p>
                <p className="mt-1 text-[11px] leading-snug text-gray-500">
                  <span className="font-semibold">Pace:</span> shots from {pace.minShot}s, typically {pace.typicalShot}s. {meta.cuts}
                </p>
                <ol className="mt-1.5 ml-4 list-decimal text-[11px] leading-snug text-gray-600">
                  {chosenShow.structure.map((line, i) => <li key={i}>{line}</li>)}
                </ol>
              </div>
            );
          })()}

          {/* THE ROUTE — `previewRoute`'s answer, used as returned. */}
          {showFormatKey && preview.route.ok && (
            <p className="rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] leading-snug text-emerald-900">
              {preview.route.reason}
            </p>
          )}

          {/* THE REFUSAL — rendered verbatim, and the cut buttons go with it. */}
          {showFormatKey && !preview.route.ok && (
            <div className="rounded-md bg-amber-50 px-2 py-2 text-[11px] leading-snug text-amber-900">
              <p className="flex gap-1 font-semibold">
                <Ban className="mt-0.5 h-3 w-3 shrink-0" />
                {preview.route.refusal}
              </p>
              {preview.reading.undeclared.length > 0 && (
                <ul className="mt-1.5 ml-4 list-disc text-amber-800">
                  {preview.reading.undeclared.map((u, i) => <li key={i}>{u}</li>)}
                </ul>
              )}
              {preview.route.alternatives.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">Cut it as:</span>
                  {preview.route.alternatives.map((a) => (
                    <button
                      key={a.key}
                      onClick={() => setShowFormatKey(a.key)}
                      className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                      style={{
                        backgroundColor: tint(EDITOR_META[a.editor].color),
                        borderColor: tint(EDITOR_META[a.editor].color, 0.4),
                        color: EDITOR_META[a.editor].color,
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {preview.reading.evidence.length > 0 && (
            <p className="text-[11px] leading-snug text-gray-500">
              <span className="font-semibold">What the footage shows:</span> {preview.reading.evidence.join(" ")}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={doFastCut} disabled={busy || !session?.uploads.length || !gate.canFastCut}
            title={gate.refusal || (gate.runs === "storyEdit" ? gate.otherButton || undefined : undefined) || "Instant deterministic cut from your uploads"}
            className="flex-1 min-w-[12rem] bg-gradient-to-r from-[#3b82f6] to-[#ec4899] hover:opacity-90 text-white font-semibold">
            {busy && ["cut", "captions", "render", "music"].includes(progress.stage)
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{progress.detail}</>
              : gate.runs === "fastCut" && chosenShow
                ? `⚡ Fast Cut — ${chosenShow.label}, music editor`
                : "⚡ Fast Cut — instant, from your uploads"}
          </Button>
          <Button variant="outline" onClick={doStoryEdit} disabled={busy || !gate.canStoryEdit}
            title={gate.refusal || gate.waiting || (gate.runs === "fastCut" ? gate.otherButton || undefined : undefined) || "Recut from the transcript + vision moments — dead air removed, natural sound kept"}
            className="flex-1 min-w-[12rem]">
            {busy && progress.stage === "parse"
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : gate.runs === "storyEdit" && chosenShow
                ? `🎬 Story Edit — ${chosenShow.label}, intelligence editor${momentsReady ? "" : " (parsing…)"}`
                : `🎬 Story Edit${momentsReady ? "" : " (parsing…)"}`}
          </Button>
        </div>
        {/* WHY A BUTTON IS UNAVAILABLE — a disabled control with no sentence is
            the thing that gets reported as "the button does nothing". */}
        {gate.refusal && <p className="text-[11px] leading-snug text-amber-700">{gate.refusal}</p>}
        {!gate.refusal && gate.otherButton && <p className="text-[11px] leading-snug text-gray-500">{gate.otherButton}</p>}
        {!gate.refusal && gate.waiting && <p className="text-[11px] leading-snug text-gray-500">{gate.waiting}</p>}
        {progress.stage === "error" && <p className="text-sm text-red-600">{progress.error}</p>}
        {progress.stage === "queued" && <p className="text-sm text-green-600">{progress.detail}</p>}

        {/* THE MUSIC EDITOR'S HONEST FALLBACK — visible after the cut. A cut
            that did not land on the beat says so; a fallback the operator
            cannot see is a music editor that quietly is not one. */}
        {beatLines.length > 0 && (
          <div
            className="rounded-lg border p-2.5 space-y-1"
            style={{ borderColor: tint(EDITOR_META.music.color, 0.4), backgroundColor: tint(EDITOR_META.music.color, 0.06) }}
          >
            <div className="flex items-center gap-1.5">
              <Music className="h-3.5 w-3.5" style={{ color: EDITOR_META.music.color }} />
              <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: EDITOR_META.music.color }}>
                Music editor — did it land on the beat?
              </span>
            </div>
            {beatLines.map((l) => (
              <p
                key={l.format}
                className={cn(
                  "rounded px-2 py-1 text-[11px] leading-snug",
                  l.matched ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900",
                )}
              >
                <span className="font-semibold">{CAST_FORMATS[l.format].label}:</span> {l.text}
              </p>
            ))}
          </div>
        )}

        {/* ── 3. Content packs ── */}
        <div className="rounded-lg border border-gray-200 p-3 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Five anchors for the big players — Blog · X · LinkedIn · Meta (IG/FB) · YouTube (+ Substack), per brand. AI extracts the core story from the footage first; every anchor tells it.</div>
          <div className="flex flex-wrap gap-1.5">
            {CAST_BRANDS.map((b) => (
              <button key={b.slug} onClick={() => togglePackBrand(b.slug)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${packBrands.includes(b.slug) ? "border-transparent bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}>
                {b.label}
              </button>
            ))}
            <Button size="sm" onClick={doPacks} disabled={busy || !session}
              className="ml-auto bg-gradient-to-r from-[#3b82f6] to-[#ec4899] hover:opacity-90 text-white font-semibold">
              {busy && progress.stage === "pack" ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />{progress.detail}</> : "✍️ Write the packs"}
            </Button>
          </div>
          {!momentsReady && session && (
            <p className="text-[11px] text-gray-400">Packs write best once the parse lands (real transcript grounding) — you can run them now and re-run later.</p>
          )}
          {story && (
            <div className="rounded-lg border border-[#ec4899]/30 bg-pink-50/50 p-3 space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#ec4899]">The core story — extracted from your footage</div>
              <p className="text-sm font-semibold text-gray-900">{story.headline}</p>
              {story.hook && <p className="text-xs text-gray-700 italic">Hook: "{story.hook}"</p>}
              {story.narrative && <p className="text-xs text-gray-600">{story.narrative}</p>}
              {Array.isArray(story.beats) && story.beats.length > 0 && (
                <ol className="text-xs text-gray-600 list-decimal ml-4">
                  {story.beats.map((b, i) => <li key={i}>{b}</li>)}
                </ol>
              )}
              {Array.isArray(story.quotes) && story.quotes.length > 0 && (
                <p className="text-[11px] text-gray-500">💬 {story.quotes.slice(0, 2).map((q) => `"${q}"`).join(" · ")}</p>
              )}
            </div>
          )}
          {packs.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {packs.map((p) => (
                  <button key={p.brand} onClick={() => setPackTab(p.brand)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium ${packTab === p.brand ? "border-transparent bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700"}`}>
                    {CAST_BRANDS.find((b) => b.slug === p.brand)?.label || p.brand}{!p.ai && " ⚠"}
                  </button>
                ))}
                <Button size="sm" variant="outline" className="ml-auto" onClick={downloadPacks}>
                  <Download className="w-3 h-3 mr-1" /> All packs (.md)
                </Button>
                <Button size="sm" onClick={doSendToBoard} disabled={busy}
                  title="One approval card per brand on Content Review (/engine-room/approvals), finished renders attached. Nothing publishes until a human approves — approving the card's IG draft publishes via content-deploy."
                  className="bg-gray-900 hover:bg-gray-800 text-white font-semibold">
                  {busy && progress.stage === "board" ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />{progress.detail}</> : "📋 Send to Approval Board"}
                </Button>
              </div>
              {activePack && (
                <div className="space-y-1.5">
                  {PIECE_LABELS.map(([key, name]) => {
                    const text = pieceText(key, (activePack as any)[key]);
                    if (!text) return null;
                    return (
                      <div key={key} className="rounded border border-gray-200 bg-gray-50 p-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{name}</span>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                            onClick={() => { navigator.clipboard?.writeText(text); toast.success(`${name} copied`); }}>
                            <Copy className="w-3 h-3 mr-1" /> copy
                          </Button>
                        </div>
                        <p className="text-xs text-gray-700 whitespace-pre-wrap line-clamp-6">{text}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
