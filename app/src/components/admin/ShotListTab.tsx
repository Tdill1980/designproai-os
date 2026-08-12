/**
 * ShotListTab — Marketing Director's filming tracker.
 *
 * Planned shot → filmed → uploaded → AI-edited → Marketing Board approval.
 * Upload is per-shot (never a shared pool); AI editing reuses video-render,
 * the same pipeline every other Engine Room tool uses; the finished render
 * lands on the Marketing/Approval Board automatically (send-render-to-board)
 * and syncs its status back here by shot id. No competing board, no second
 * media library — see src/lib/shotList.ts for the reused plumbing.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Film, Upload, Sparkles, ExternalLink, DollarSign, Star, Crop, Eye, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { brandMeta } from "@/lib/content-tags";
import {
  SHOT_STATUSES, EDIT_TYPES, uploadRawFootageToShot, attachRawFootageUrlToShot, enqueueShotEdit,
  type ShotListItem, type ShotStatus, type EditType,
} from "@/lib/shotList";
import ShotPhotoCropEditor from "@/components/admin/ShotPhotoCropEditor";
import { Link, useSearchParams } from "react-router-dom";
import {
  partitionRows, resolveScript, scriptLabel, scriptBody, needsScript,
  scriptStudioLink, isMasterScript, type ShotRow,
} from "@/lib/shotScriptLink";
import { isToday, todayStamp } from "@/lib/shootDay";
import ShotCallSheet from "@/components/admin/ShotCallSheet";
import type { CropPresetKey } from "@/lib/cropMath";
import { assetThumb } from "@/lib/assetThumb";

const db = supabase as any;
const BRANDS = ["weprintwraps", "restylepro", "designproai", "wraptvworld", "inkandedge", "thewrap"];
const PRIORITY_TINT: Record<string, string> = {
  high: "bg-rose-100 text-rose-800", medium: "bg-amber-100 text-amber-800", low: "bg-slate-100 text-slate-600",
};

/** Which MEDIUM a shot needs on the day — the camera crew reads this off the
 *  card. The list serves BOTH video and photo work (owner 2026-08-04): photo
 *  content types are stills; everything else needs moving footage, so video
 *  is the default for rows that predate the taxonomy. */
const PHOTO_TYPES = new Set(["photo", "carousel_assets", "static_ad"]);
const shotMedium = (ct?: string | null): "video" | "photo" =>
  PHOTO_TYPES.has(String(ct || "")) ? "photo" : "video";
const MEDIUM_BADGE: Record<"video" | "photo", { label: string; cls: string }> = {
  video: { label: "🎥 VIDEO", cls: "bg-indigo-600 text-white" },
  photo: { label: "📷 PHOTO", cls: "bg-teal-600 text-white" },
};

/** The regular on-camera team — always offered in the on-camera editor. */
const CORE_CAST = ["Trish", "Amanda", "Jackson", "Xavier"];
/** Brands offered in the ecosystem-repurpose picker — mirrors
 *  REPURPOSE_BRAND_DEFAULTS in marketing-agent/index.ts. */
const REPURPOSE_BRAND_LABELS: Record<string, string> = {
  wraptvworld: "WrapTVWorld", weprintwraps: "WePrintWraps", inkandedge: "Ink & Edge",
  "trish-founder": "🎙️ Trish (Founder)",
};
/** "Trish + Amanda", "Trish or Jackson", "Jackson (camera)" → clean names. */
const parseCast = (v?: string | null): string[] =>
  String(v || "")
    .split(/\s*(?:\+|\/|,| or | and | & )\s*/i)
    .map((s) => s.trim().replace(/\(.*\)$/, "").trim())
    .filter((s) => s.length > 1);

/** One color per pipeline status — the same hue everywhere that status
 *  appears: filter pills, card badges, and the detail quick-move row. */
const STATUS_COLOR: Record<ShotStatus, string> = {
  planned: "#64748b",          // slate — not started
  ready_to_film: "#3b82f6",    // blue — queued for camera
  filmed: "#8b5cf6",           // violet — captured
  uploaded: "#06b6d4",         // cyan — footage in
  ai_editing: "#f59e0b",       // amber — machine working
  ready_for_review: "#f97316", // orange — needs eyes
  approved: "#10b981",         // emerald — complete
  published: "#16a34a",        // green — shipped
};

/** Thumbnails for a shot's uploaded raw footage — viewable, not a Konva canvas. */
function useShotAssets(assetIds: string[]) {
  return useQuery({
    queryKey: ["shot-list-assets", assetIds.slice().sort().join(",")],
    queryFn: async () => {
      if (!assetIds.length) return [];
      const { data, error } = await db.from("agent_media_assets")
        .select("id, storage_url, asset_type, original_filename, title, thumbnail_url, drive_file_id")
        .in("id", assetIds);
      if (error) throw error;
      return data || [];
    },
    enabled: assetIds.length > 0,
  });
}

function useShotList() {
  return useQuery({
    queryKey: ["shot-list-items"],
    queryFn: async () => {
      const { data, error } = await db.from("shot_list_items").select("*").order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as ShotListItem[];
    },
    refetchInterval: 20000,
  });
}

const emptyDraft = {
  brand: "weprintwraps", campaign: "", content_type: "reel", shot_title: "",
  filming_instruction: "", responsible_person: "", on_camera_person: "",
  location: "", props: "", priority: "medium" as const, due_date: "",
  hook: "", cta: "", platform: "", notes: "",
};

export default function ShotListTab() {
  const qc = useQueryClient();
  const { data: shots = [], isLoading } = useShotList();
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<ShotStatus | "all">("planned");
  const [mediumFilter, setMediumFilter] = useState<"all" | "video" | "photo">("all");
  const [personFilter, setPersonFilter] = useState<string>("all");
  const [repurposeBrands, setRepurposeBrands] = useState<string[]>(["wraptvworld", "weprintwraps", "inkandedge"]);
  const [ideaText, setIdeaText] = useState("");
  const [creating, setCreating] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [openShot, setOpenShot] = useState<ShotListItem | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [linkingScript, setLinkingScript] = useState(false);
  // TODAY'S SHOOT — the short list. The board is a 97-item backlog; a crew
  // needs the handful dated today, not everything that has ever been planned.
  const [showToday, setShowToday] = useState(false);
  const todayCount = useMemo(
    () => (shots || []).filter((s: ShotListItem) => isToday(s.due_date)).length,
    [shots],
  );

  /** Put a shot on today's list (or take it off) — see shootDay.ts. */
  const setToday = async (shot: ShotListItem, on: boolean) => {
    const { error } = await db.from("shot_list_items")
      .update({ due_date: on ? todayStamp() : null, updated_at: new Date().toISOString() })
      .eq("id", shot.id);
    if (error) { toast.error(error.message); return; }
    toast.success(on ? "Added to today's shoot." : "Taken off today's list.");
    if (openShot?.id === shot.id) await refreshOpenShot(shot.id);
    qc.invalidateQueries({ queryKey: ["shot-list-items"] });
  };

  // Scripts and shots live in ONE table — split them once, here.
  const { scripts: scriptRows, shots: shotRows } = useMemo(
    () => partitionRows((shots || []) as unknown as ShotRow[]),
    [shots],
  );

  // The script behind the open card: the explicit link first, then an exact
  // campaign match, then an honest gap. Never a fuzzy guess.
  const openScript = useMemo(
    () => (openShot ? resolveScript(openShot as unknown as ShotRow, scriptRows) : null),
    [openShot, scriptRows],
  );

  // DEEP LINK — ?shot=<id> opens that card. Script Studio points here so a
  // script can send you to the exact card where the footage gets uploaded;
  // before this the open card was local state and unreachable from anywhere.
  useEffect(() => {
    const want = searchParams.get("shot");
    if (!want || openShot?.id === want) return;
    const found = (shots || []).find((s: ShotListItem) => s.id === want);
    if (found) setOpenShot(found);
  }, [searchParams, shots, openShot?.id]);

  // Link / unlink this card's script.
  const setScriptLink = async (scriptId: string | null) => {
    if (!openShot) return;
    setLinkingScript(true);
    const { error } = await db.from("shot_list_items")
      .update({ script_id: scriptId, updated_at: new Date().toISOString() })
      .eq("id", openShot.id);
    setLinkingScript(false);
    if (error) { toast.error(error.message); return; }
    toast.success(scriptId ? "Script linked to this shot." : "Script unlinked.");
    await refreshOpenShot(openShot.id);
    qc.invalidateQueries({ queryKey: ["shot-list-items"] });
  };
  const { data: shotAssets = [] } = useShotAssets(openShot?.raw_asset_ids || []);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [attachingUrl, setAttachingUrl] = useState(false);
  // Preview-before-save: picked files stage here (local object URLs) and only
  // upload when the user confirms — nothing persists on pick alone.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const pendingPreviews = useMemo(
    () => pendingFiles.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [pendingFiles],
  );
  useEffect(() => () => { pendingPreviews.forEach((p) => URL.revokeObjectURL(p.url)); }, [pendingPreviews]);
  // Konva crop editor: which uploaded photo is being cropped.
  const [cropSource, setCropSource] = useState<{ url: string; parentId: string } | null>(null);
  const [viewer, setViewer] = useState<{ url: string; type: string; assetId?: string } | null>(null);
  const [savingCrop, setSavingCrop] = useState(false);

  const refreshOpenShot = async (id: string) => {
    const { data } = await db.from("shot_list_items").select("*").eq("id", id).single();
    if (data) setOpenShot(data);
  };

  // Cover thumbnails for the card grid — one query for every shot's cover.
  const coverIds = useMemo(
    () => Array.from(new Set(shots.map((s) => s.cover_asset_id || s.raw_asset_ids?.[0]).filter(Boolean))) as string[],
    [shots],
  );
  const { data: coverAssets = [] } = useQuery({
    queryKey: ["shot-list-covers", coverIds.slice().sort().join(",")],
    queryFn: async () => {
      if (!coverIds.length) return [];
      const { data, error } = await db.from("agent_media_assets")
        .select("id, storage_url, asset_type, thumbnail_url, drive_file_id").in("id", coverIds);
      if (error) throw error;
      return data || [];
    },
    enabled: coverIds.length > 0,
  });
  const coverUrl = (id?: string | null) => coverAssets.find((a: any) => a.id === id)?.storage_url as string | undefined;
  /** Card-face media: the starred cover, else the FIRST upload — image or video. */
  const cardMedia = (s: ShotListItem) => {
    const a = coverAssets.find((x: any) => x.id === (s.cover_asset_id || s.raw_asset_ids?.[0]));
    if (!a) return undefined;
    const t = assetThumb(a);
    return t.kind === "none" ? undefined : t;
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!draft.shot_title.trim()) throw new Error("Give the shot a title");
      const { error } = await db.from("shot_list_items").insert({
        ...draft,
        due_date: draft.due_date ? new Date(draft.due_date).toISOString() : null,
        created_by: "manual",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Shot added");
      setCreating(false); setDraft(emptyDraft); setShowDetail(false);
      qc.invalidateQueries({ queryKey: ["shot-list-items"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteShot = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("shot_list_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Shot deleted");
      qc.invalidateQueries({ queryKey: ["shot-list-items"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ShotStatus }) => {
      const { error } = await db.from("shot_list_items").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shot-list-items"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const runEdit = useMutation({
    mutationFn: async ({ shot, editType }: { shot: ShotListItem; editType: EditType }) => {
      const res = await enqueueShotEdit(shot, editType);
      if (!res.ok) throw new Error(res.error || "Edit failed to enqueue");
      return res;
    },
    onSuccess: () => {
      toast.success("AI edit queued — this shot will move to Ready for Review when it lands on the board.");
      qc.invalidateQueries({ queryKey: ["shot-list-items"] });
      setOpenShot(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Owner spec 2026-08-04: one filmed moment must become a DIFFERENT piece
   *  PER BRAND (its own angle, its own voice) — not the same caption with a
   *  tagline swapped. Fires marketing-agent's repurpose_across_brands, which
   *  writes N distinct drafts (per-brand, and per-format within a brand)
   *  straight into the Content Director queue. */
  const repurposeAcrossBrands = useMutation({
    mutationFn: async (shot: ShotListItem) => {
      if (!repurposeBrands.length) throw new Error("Pick at least one brand");
      const moment = [
        shot.shot_title,
        shot.filming_instruction,
        shot.on_camera_person ? `On camera: ${shot.on_camera_person}.` : "",
        shot.location ? `Location: ${shot.location}.` : "",
        shot.notes,
      ].filter(Boolean).join("\n");
      const media_url = shotAssets.find((a: any) => a.storage_url)?.storage_url || null;
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "repurpose_across_brands", moment, shot_list_item_id: shot.id, media_url, brands: repurposeBrands },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data as { posts: unknown[]; slot_count: number };
    },
    onSuccess: (data) => {
      toast.success(`🌐 ${data.posts?.length ?? 0} pieces drafted across ${repurposeBrands.length} brand${repurposeBrands.length === 1 ? "" : "s"} — review in Content Queue.`, { duration: 8000 });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // "Give the Director an idea" — type or dictate (the device keyboard's own
  // mic button handles voice-to-text; nothing custom needed here) a rough
  // idea and AI structures it into a card, the same way ideas get turned
  // into shots by hand elsewhere on this board.
  const submitIdea = useMutation({
    mutationFn: async () => {
      const idea = ideaText.trim();
      if (!idea) throw new Error("Type or dictate an idea first");
      const brandHint = brandFilter !== "all" ? brandFilter : "wraptvworld";
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "shot_list_idea", idea, brand: brandHint },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data.shot;
    },
    onSuccess: (shot) => {
      toast.success(`Added: "${shot?.shot_title}"`);
      setIdeaText("");
      qc.invalidateQueries({ queryKey: ["shot-list-items"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Picking files STAGES them for preview; savePending() actually uploads. */
  const stageFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setPendingFiles((cur) => [...cur, ...Array.from(files)]);
    if (fileRef.current) fileRef.current.value = "";
  };

  /** Owner spec 2026-08-04: "once we add a date and upload it moves card and
   *  AI creates fresh director ideas." Footage landing on a DATED shot
   *  auto-advances the card to Uploaded and asks the Director to refill the
   *  board with fresh planned ideas — the list feeds itself while the crew
   *  films. Undated shots keep manual status control. */
  const advanceAfterUpload = async (shotId: string) => {
    const { data: s } = await db.from("shot_list_items").select("*").eq("id", shotId).single();
    if (!s?.due_date) return;
    if (["planned", "ready_to_film", "filmed"].includes(s.status)) {
      await db.from("shot_list_items")
        .update({ status: "uploaded", updated_at: new Date().toISOString() }).eq("id", shotId);
      toast.success("Card moved to Uploaded ✓");
      qc.invalidateQueries({ queryKey: ["shot-list-items"] });
      await refreshOpenShot(shotId);
    }
    // Fire-and-forget: a refill failure never blocks the upload flow.
    supabase.functions.invoke("marketing-agent", {
      body: { action: "shot_list_fresh_ideas", brand: s.brand, completedTitle: s.shot_title },
    }).then(({ data }: any) => {
      const n = data?.shots?.length || 0;
      if (n) {
        toast.success(`💡 Director added ${n} fresh idea${n > 1 ? "s" : ""} to the list`);
        qc.invalidateQueries({ queryKey: ["shot-list-items"] });
      }
    }).catch(() => {});
  };

  const savePending = async () => {
    if (!pendingFiles.length || !openShot) return;
    setUploading(true);
    const res = await uploadRawFootageToShot(openShot, pendingFiles);
    setUploading(false);
    setPendingFiles([]);
    // Say what actually happens next. Upload now queues the transcription
    // AND the first AI cut on its own (src/lib/shotList.ts) — a toast that
    // only says "saved" hides the fact that work is already underway.
    if (res.ok) toast.success(`${res.ok} file(s) saved — transcribing and cutting a first edit now. It lands in Brand Board when it renders.`);
    // The real reason, not just a count — a permission refusal used to show as
    // "1 upload(s) failed" with nothing to act on.
    if (res.fail || res.errors.length) {
      toast.error(res.errors[0] || `${res.fail} upload(s) failed`, { duration: 8000 });
    }
    qc.invalidateQueries({ queryKey: ["shot-list-items"] });
    if (res.assetIds.length) {
      await refreshOpenShot(openShot.id);
      await advanceAfterUpload(openShot.id);
    }
  };

  const setCover = useMutation({
    mutationFn: async ({ shotId, assetId }: { shotId: string; assetId: string | null }) => {
      const { error } = await db.from("shot_list_items")
        .update({ cover_asset_id: assetId, updated_at: new Date().toISOString() }).eq("id", shotId);
      if (error) throw error;
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ["shot-list-items"] });
      if (openShot) await refreshOpenShot(openShot.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Confirmed Konva crop → upload as a NEW asset; the original is untouched. */
  const saveCrop = async (file: File, preset: CropPresetKey) => {
    if (!openShot || !cropSource) return;
    setSavingCrop(true);
    const res = await uploadRawFootageToShot(openShot, [file], {
      derived_from: cropSource.parentId,
      crop_preset: preset,
    });
    setSavingCrop(false);
    if (res.ok) {
      toast.success(`Saved ${preset} crop (original kept)`);
      setCropSource(null);
      qc.invalidateQueries({ queryKey: ["shot-list-items"] });
      await refreshOpenShot(openShot.id);
    } else {
      toast.error(res.errors[0] || "Crop upload failed", { duration: 8000 });
    }
  };

  const doAttachUrl = async () => {
    if (!urlDraft.trim() || !openShot) return;
    setAttachingUrl(true);
    const res = await attachRawFootageUrlToShot(openShot, urlDraft);
    setAttachingUrl(false);
    if (res.ok) {
      toast.success("Link added — transcribing and cutting a first edit now. It lands in Brand Board when it renders.");
      setUrlDraft("");
      qc.invalidateQueries({ queryKey: ["shot-list-items"] });
      const { data } = await db.from("shot_list_items").select("*").eq("id", openShot.id).single();
      if (data) setOpenShot(data);
      await advanceAfterUpload(openShot.id);
    } else {
      toast.error(res.error || "Could not add that link");
    }
  };

  // People come from who is actually ON CAMERA across the board. Rows carry
  // combos ("Trish + Amanda", "Trish or Jackson"), so the field is TOKENIZED
  // into individual names and matching is substring — "Jackson" finds his
  // solo pieces AND the counter bit with Amanda. CORE_CAST is always offered
  // in the on-camera editor even before anyone has a card.
  const people = useMemo(() => {
    const set = new Set<string>(CORE_CAST);
    for (const s of shots) for (const name of parseCast(s.on_camera_person)) set.add(name);
    return Array.from(set).sort();
  }, [shots]);
  const personMatches = (s: ShotListItem) =>
    personFilter === "all" ||
    String(s.on_camera_person || "").toLowerCase().includes(personFilter.toLowerCase());

  const filtered = shots.filter((s) =>
    (brandFilter === "all" || s.brand === brandFilter) &&
    (locationFilter === "all" || s.location === locationFilter) &&
    (mediumFilter === "all" || shotMedium(s.content_type) === mediumFilter) &&
    personMatches(s));
  const locations = Array.from(new Set(shots.map((s) => s.location).filter(Boolean))) as string[];
  const grouped = (status: ShotStatus) => filtered.filter((s) => s.status === status);
  const hasAdToday = filtered.some((s) => {
    const t = `${s.campaign || ""} ${s.content_type || ""} ${s.shot_title}`.toLowerCase();
    return t.includes("ad") || t.includes("money") || t.includes("promo") || t.includes("offer");
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-gray-500" />
          <h2 className="text-lg font-bold text-gray-900">Shot List</h2>
          <span className="text-xs text-gray-500">Planned → filmed → uploaded → AI-edited → approved</span>
        </div>
        <Button size="sm" onClick={() => setCreating(true)} className="bg-gray-900 text-white hover:bg-gray-800">
          + New shot
        </Button>
      </div>

      {/* Standing rule: keep at least one revenue/ad idea in every day's list. */}
      <div className={cn(
        "mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold",
        hasAdToday ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900",
      )}>
        <DollarSign className="h-3.5 w-3.5 shrink-0" />
        {hasAdToday
          ? "At least one revenue/ad shot is on this list — good."
          : "Standing rule: every day's shot list should include at least one ad / money-making idea. None found in the current filter — add one."}
      </div>

      {/* Give the Director an idea — type it, or dictate with the keyboard's
          own mic button. AI structures it into a card below. */}
      <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
          <Sparkles className="h-3.5 w-3.5 text-blue-600" />💡 Give the Director an idea
        </div>
        <div className="mt-1.5 flex flex-col gap-1.5 sm:flex-row">
          <Textarea
            value={ideaText}
            onChange={(e) => setIdeaText(e.target.value)}
            placeholder='Type or dictate — e.g. "do a funny one about Jackson messing up the squeegee, WrapTVWorld, high priority"'
            rows={2}
            className="flex-1 bg-white text-sm text-gray-900 placeholder:text-gray-400"
          />
          <Button
            disabled={submitIdea.isPending || !ideaText.trim()}
            onClick={() => submitIdea.mutate()}
            className="shrink-0 bg-blue-600 text-white hover:bg-blue-700"
          >
            {submitIdea.isPending ? "Loading…" : "Load it in"}
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {/* "All" carries the suite gradient, matching the ColorTabRow pattern
            the queue's own brand/channel/team filters use. The per-brand chips
            below already carry their own brandMeta colour. */}
        <button onClick={() => setBrandFilter("all")} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold", brandFilter === "all" ? "border-transparent bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white" : "border-gray-300 bg-white text-gray-700")}>
          All ({shots.length})
        </button>
        {BRANDS.map((b) => {
          const n = shots.filter((s) => s.brand === b).length;
          const m = brandMeta(b);
          return (
            <button key={b} onClick={() => setBrandFilter(b)}
              className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold", brandFilter === b ? "text-white" : "bg-white")}
              style={brandFilter === b
                ? { backgroundColor: m.color, borderColor: m.color }
                : { color: m.color, borderColor: `${m.color}66` }}>
              {m.label} ({n})
            </button>
          );
        })}
      </div>

      {locations.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 self-center">Location</span>
          <button onClick={() => setLocationFilter("all")} className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", locationFilter === "all" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-600")}>
            All
          </button>
          {locations.map((loc) => (
            <button key={loc} onClick={() => setLocationFilter(loc)}
              className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", locationFilter === loc ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-600")}>
              {loc}
            </button>
          ))}
        </div>
      )}

      {/* TODAY'S SHOOT — the whole board is a backlog; this is the day's work.
          One tap swaps the 97-card grid for a short call sheet grouped by
          script, which is what a crew can actually carry around. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setShowToday((v) => !v)}
          className={cn("rounded-full border px-3 py-1.5 text-xs font-bold transition",
            showToday
              ? "border-transparent bg-gradient-to-r from-blue-600 to-pink-600 text-white"
              : "border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:text-blue-600")}
        >
          🎬 Today's shoot ({todayCount})
        </button>
        {showToday && (
          <span className="text-[11px] text-gray-500">
            Showing only what's dated today — tap again for the full board.
          </span>
        )}
      </div>

      {showToday && (
        <div className="mt-3">
          <ShotCallSheet rows={shots as unknown as ShotRow[]} />
        </div>
      )}

      {/* Medium — the list serves BOTH video and photo shoots. The video guy
          filters to 🎥 and gets his can't-miss list with script direction on
          each card; the photo side filters to 📷. */}
      <div className={cn("mt-3 flex flex-wrap items-center gap-1.5", showToday && "hidden")}>
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Medium</span>
        {(["all", "video", "photo"] as const).map((m) => (
          <button key={m} onClick={() => setMediumFilter(m)}
            className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold",
              mediumFilter === m
                ? m === "video" ? "border-indigo-600 bg-indigo-600 text-white"
                  : m === "photo" ? "border-teal-600 bg-teal-600 text-white"
                  : "border-gray-900 bg-gray-900 text-white"
                : "border-gray-300 bg-white text-gray-600")}>
            {m === "all" ? "All" : MEDIUM_BADGE[m].label}
            {" "}({m === "all" ? filtered.length : shots.filter((s) =>
              (brandFilter === "all" || s.brand === brandFilter) &&
              (locationFilter === "all" || s.location === locationFilter) &&
              shotMedium(s.content_type) === m).length})
          </button>
        ))}
      </div>

      {/* Person — a DROPDOWN (owner 2026-08-04: "must show drop down to view
          by person"). Each team member picks their name and the grid becomes
          their task list; combos count for every person in them. */}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Person</span>
        <select
          value={personFilter}
          onChange={(e) => setPersonFilter(e.target.value)}
          className={cn(
            "h-10 rounded-full border px-3 pr-8 text-sm font-bold",
            personFilter === "all"
              ? "border-gray-300 bg-white text-gray-700"
              : "border-fuchsia-600 bg-fuchsia-600 text-white",
          )}
        >
          <option value="all">🎤 Everyone</option>
          {people.map((p) => {
            const n = shots.filter((s) =>
              (brandFilter === "all" || s.brand === brandFilter) &&
              String(s.on_camera_person || "").toLowerCase().includes(p.toLowerCase())).length;
            return <option key={p} value={p}>🎤 {p} ({n})</option>;
          })}
        </select>
        {personFilter !== "all" && (
          <span className="text-xs font-semibold text-fuchsia-700">{personFilter}'s task list</span>
        )}
      </div>

      {/* Status tabs — replaces the old 8-column Kanban, which squeezed into
          long, skinny columns on a laptop screen. One status at a time (or
          All), shown as a normal card grid instead. */}
      <div className={cn("mt-4 flex flex-wrap gap-1.5", showToday && "hidden")}>
        <button onClick={() => setStatusFilter("all")}
          className={cn("rounded-full border px-3 py-1.5 text-xs font-bold", statusFilter === "all" ? "border-transparent bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white" : "border-gray-300 bg-white text-gray-700")}>
          All ({filtered.length})
        </button>
        {SHOT_STATUSES.map((col) => {
          const n = grouped(col.key).length;
          const c = STATUS_COLOR[col.key];
          return (
            <button key={col.key} onClick={() => setStatusFilter(col.key)}
              className={cn("rounded-full border px-3 py-1.5 text-xs font-bold", statusFilter === col.key ? "text-white" : "bg-white")}
              style={statusFilter === col.key
                ? { backgroundColor: c, borderColor: c }
                : { color: c, borderColor: `${c}66` }}>
              {col.label} ({n})
            </button>
          );
        })}
      </div>

      {/* Standard square cards — uniform size, hard brand color coding:
          solid brand band on top, solid status pill on the bottom. */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {(statusFilter === "all" ? filtered : grouped(statusFilter)).map((s) => (
          <Card key={s.id} onClick={() => setOpenShot(s)}
            className="group relative flex aspect-square cursor-pointer flex-col overflow-hidden border border-gray-200 bg-white p-0 hover:shadow-md"
            style={{ borderColor: `${brandMeta(s.brand).color}55` }}>
            {/* Brand band — the color coding, unmissable */}
            <div className="flex shrink-0 items-center gap-1 px-2 py-1 pr-6" style={{ backgroundColor: brandMeta(s.brand).color }}>
              <span className="truncate text-[10px] font-extrabold uppercase tracking-wide text-white">{brandMeta(s.brand).label}</span>
              <span className={cn("ml-auto shrink-0 rounded px-1 text-[9px] font-bold", PRIORITY_TINT[s.priority])}>{s.priority}</span>
            </div>
            {/* X — delete a shot/idea not worth filming. stopPropagation or it also opens the card. */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete "${s.shot_title}"? This can't be undone.`)) deleteShot.mutate(s.id);
              }}
              disabled={deleteShot.isPending}
              title="Delete this shot"
              className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/25 p-0.5 text-white hover:bg-rose-600"
            >
              <X className="h-3 w-3" />
            </button>
            {cardMedia(s) && (
              <div className="h-1/3 w-full shrink-0 overflow-hidden bg-gray-100">
                {cardMedia(s)!.kind === "video"
                  ? <video src={cardMedia(s)!.src} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  : cardMedia(s)!.kind === "audio"
                    ? <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-400">🎵 audio</div>
                    : <img src={cardMedia(s)!.src} alt="" className="h-full w-full object-cover" loading="lazy" />}
              </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col p-2">
              <div className="text-[13px] font-semibold leading-snug text-gray-900 line-clamp-2">{s.shot_title}</div>
              {s.filming_instruction && (
                <div className={cn("mt-0.5 text-[11px] leading-snug text-gray-500", cardMedia(s) ? "line-clamp-2" : "line-clamp-4")}>
                  {s.filming_instruction}
                </div>
              )}
              {!s.filming_instruction && s.campaign && <div className="mt-0.5 truncate text-[10px] text-gray-500">{s.campaign}</div>}
              <div className="mt-auto flex items-center gap-1.5 pt-1">
                {/* Status pill — solid status color, always visible */}
                <span className="rounded-full px-2 py-0.5 text-[9px] font-bold text-white" style={{ backgroundColor: STATUS_COLOR[s.status] }}>
                  {SHOT_STATUSES.find((c) => c.key === s.status)?.label}
                </span>
                {/* Medium badge — video or photo, so the crew never guesses */}
                <span className={cn("rounded-full px-1.5 py-0.5 text-[8px] font-bold", MEDIUM_BADGE[shotMedium(s.content_type)].cls)}>
                  {MEDIUM_BADGE[shotMedium(s.content_type)].label}
                </span>
                {/* One-tap door to this shot's corresponding script (the
                    dialog's amber Script/direction box). Amber when it has
                    one; rose when a video shot is missing direction. */}
                {(s.notes || s.filming_instruction) ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpenShot(s); }}
                    className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold text-amber-800 hover:bg-amber-200"
                  >
                    📜 Script
                  </button>
                ) : shotMedium(s.content_type) === "video" ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpenShot(s); }}
                    className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[8px] font-bold text-rose-700 hover:bg-rose-200"
                  >
                    📜 No script!
                  </button>
                ) : null}
                <span className="ml-auto flex items-center gap-1.5 text-[9px] text-gray-400">
                  {/* Shoot date on the OUTSIDE of the card (owner 2026-08-04)
                      — red when overdue, bold when today. */}
                  {s.due_date && (() => {
                    const d = s.due_date.slice(0, 10), today = new Date().toISOString().slice(0, 10);
                    return (
                      <span className={cn("font-bold", d < today ? "text-rose-500" : d === today ? "text-gray-900" : "text-gray-500")}>
                        📅 {d === today ? "TODAY" : d.slice(5)}
                      </span>
                    );
                  })()}
                  {s.raw_asset_ids?.length ? <span>{s.raw_asset_ids.length}📎</span> : null}
                  {s.notes?.startsWith("REQUIRED") && <span className="font-bold text-rose-500">REQ</span>}
                </span>
              </div>
            </div>
          </Card>
        ))}
        {(statusFilter === "all" ? filtered : grouped(statusFilter)).length === 0 && (
          <div className="col-span-full py-8 text-center text-xs text-gray-400">Nothing here</div>
        )}
      </div>
      {isLoading && <p className="mt-2 text-xs text-gray-400">Loading…</p>}

      {/* ── New shot ───────────────────────────────────────────────────── */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="bg-white text-gray-900 max-w-lg max-h-[85vh] overflow-y-auto" style={{ width: "min(92vw, 34rem)", maxWidth: "34rem" }}>
          <DialogHeader><DialogTitle className="text-gray-900">New shot</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="col-span-1">
              <span className="text-xs font-semibold text-gray-600">Brand</span>
              <select value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5">
                {BRANDS.map((b) => <option key={b} value={b}>{brandMeta(b).label}</option>)}
              </select>
            </label>
            <label className="col-span-1">
              <span className="text-xs font-semibold text-gray-600">Content type</span>
              <select value={draft.content_type} onChange={(e) => setDraft({ ...draft, content_type: e.target.value })} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5">
                {EDIT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
            <label className="col-span-2">
              <span className="text-xs font-semibold text-gray-600">Shot title *</span>
              <Input value={draft.shot_title} onChange={(e) => setDraft({ ...draft, shot_title: e.target.value })} placeholder="e.g. Amanda studio intro — WrapTVWorld" />
            </label>
            {/* PLANNING DETAIL, FOLDED AWAY. This dialog asks for 14 fields
                because it was built to PLAN a shoot before filming. Dropping in
                footage you already have needs three: brand, type, title. Owner,
                2026-08-06: "It's making me write a book." Everything below is
                optional and hidden until asked for — nothing was removed, so a
                real planned shoot can still carry all of it. */}
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              className="col-span-2 mt-1 flex items-center gap-1 text-left text-xs font-semibold text-blue-600 hover:text-pink-600"
            >
              {showDetail ? "− Hide" : "+ Add"} shoot details (campaign, location, hook, CTA…)
              <span className="font-normal text-gray-400">— all optional</span>
            </button>

            {showDetail && (<>
            <label className="col-span-2">
              <span className="text-xs font-semibold text-gray-600">Campaign</span>
              <Input value={draft.campaign} onChange={(e) => setDraft({ ...draft, campaign: e.target.value })} placeholder="e.g. WPW production-pack promo (ad)" />
            </label>
            <label className="col-span-2">
              <span className="text-xs font-semibold text-gray-600">Exact filming instruction</span>
              <Textarea rows={2} value={draft.filming_instruction} onChange={(e) => setDraft({ ...draft, filming_instruction: e.target.value })} />
            </label>
            <label><span className="text-xs font-semibold text-gray-600">Person responsible</span>
              <Input value={draft.responsible_person} onChange={(e) => setDraft({ ...draft, responsible_person: e.target.value })} /></label>
            <label><span className="text-xs font-semibold text-gray-600">Person on camera</span>
              <Input value={draft.on_camera_person} onChange={(e) => setDraft({ ...draft, on_camera_person: e.target.value })} /></label>
            <label><span className="text-xs font-semibold text-gray-600">Location</span>
              <Input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="WrapTVWorld Studio, Royalty Wraps OC" /></label>
            <label><span className="text-xs font-semibold text-gray-600">Props / equipment</span>
              <Input value={draft.props} onChange={(e) => setDraft({ ...draft, props: e.target.value })} /></label>
            <label><span className="text-xs font-semibold text-gray-600">Priority</span>
              <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as any })} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5">
                <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select></label>
            <label><span className="text-xs font-semibold text-gray-600">Due date</span>
              <Input type="date" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} /></label>
            <label><span className="text-xs font-semibold text-gray-600">Hook</span>
              <Input value={draft.hook} onChange={(e) => setDraft({ ...draft, hook: e.target.value })} /></label>
            <label><span className="text-xs font-semibold text-gray-600">CTA</span>
              <Input value={draft.cta} onChange={(e) => setDraft({ ...draft, cta: e.target.value })} /></label>
            <label className="col-span-2"><span className="text-xs font-semibold text-gray-600">Notes</span>
              <Textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
            </>)}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              disabled={create.isPending || !draft.shot_title.trim()}
              title={!draft.shot_title.trim() ? "A title is the only thing this needs" : undefined}
              onClick={() => create.mutate()}
              className="bg-gray-900 text-white hover:bg-gray-800"
            >
              {create.isPending ? "Adding…" : "Add shot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Shot detail: upload + AI edit + status ────────────────────── */}
      <Dialog open={!!openShot} onOpenChange={(o) => {
        if (o) return;
        setOpenShot(null);
        // Drop ?shot= on close, or the deep link immediately re-opens the card.
        if (searchParams.get("shot")) {
          const next = new URLSearchParams(searchParams);
          next.delete("shot");
          setSearchParams(next, { replace: true });
        }
      }}>
        {openShot && (
          <DialogContent
            className="bg-white text-gray-900 max-w-lg max-h-[85vh] overflow-y-auto border-l-4"
            style={{ borderLeftColor: brandMeta(openShot.brand).color, width: "min(92vw, 34rem)", maxWidth: "34rem" }}
          >
            <DialogHeader><DialogTitle className="text-lg leading-snug text-gray-900">{openShot.shot_title}</DialogTitle></DialogHeader>

            <div className="flex flex-wrap gap-1.5 text-xs">
              <Badge style={{ backgroundColor: brandMeta(openShot.brand).color, color: "white" }}>{brandMeta(openShot.brand).label}</Badge>
              {openShot.campaign && <Badge variant="secondary">{openShot.campaign}</Badge>}
              <Badge className={PRIORITY_TINT[openShot.priority]}>{openShot.priority} priority</Badge>
              <Badge style={{ backgroundColor: STATUS_COLOR[openShot.status], color: "white" }}>{SHOT_STATUSES.find((s) => s.key === openShot.status)?.label}</Badge>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm text-gray-700">
              {openShot.filming_instruction && <div className="col-span-2"><b>Instruction:</b> {openShot.filming_instruction}</div>}
              {openShot.responsible_person && <div><b>Responsible:</b> {openShot.responsible_person}</div>}
              {openShot.on_camera_person && <div><b>On camera:</b> {openShot.on_camera_person}</div>}
              {openShot.location && <div><b>Location:</b> {openShot.location}</div>}
              {openShot.props && <div><b>Props:</b> {openShot.props}</div>}
              {openShot.due_date && <div><b>Due:</b> {new Date(openShot.due_date).toLocaleDateString()}</div>}
              {/* One tap onto (or off) today's shoot — the same due_date the
                  board sorts by, so "today's list" and "the shoot date" stay
                  one idea instead of two that drift. */}
              <div className="col-span-2">
                <button
                  onClick={() => setToday(openShot, !isToday(openShot.due_date))}
                  className={cn("rounded-full border px-3 py-1 text-[11px] font-bold transition",
                    isToday(openShot.due_date)
                      ? "border-transparent bg-gradient-to-r from-blue-600 to-pink-600 text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:text-blue-600")}
                >
                  {isToday(openShot.due_date) ? "🎬 On today's shoot — tap to remove" : "＋ Add to today's shoot"}
                </button>
              </div>
              {openShot.hook && <div className="col-span-2"><b>Hook:</b> {openShot.hook}</div>}
              {openShot.cta && <div className="col-span-2"><b>CTA:</b> {openShot.cta}</div>}
              {openShot.platform && <div><b>Platform:</b> {openShot.platform}</div>}
              {openShot.campaign && <div><b>Campaign:</b> {openShot.campaign}</div>}
              {/* Script / direction — video shots MUST carry beats so the
                  camera crew has can't-miss direction; photo shots carry shot
                  notes. Long-form scripts live in Script Studio. */}
              {openShot.notes && (
                <div className="col-span-2 whitespace-pre-wrap rounded-md bg-amber-50 p-2 text-[13px] text-amber-900">
                  <b>{shotMedium(openShot.content_type) === "video" ? "🎬 Script / direction (video):" : "📷 Shot notes (photo):"}</b> {openShot.notes}
                </div>
              )}
              {shotMedium(openShot.content_type) === "video" && !openShot.notes && !openShot.filming_instruction && (
                <div className="col-span-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-[12px] font-semibold text-rose-700">
                  🎬 Video shot with NO script direction — add the beats (edit this shot) so camera can't miss.
                </div>
              )}
              {/* THE SCRIPT THIS SHOT IS FILMED FROM.
                  Scripts and shots are rows in the same table, but nothing
                  ever linked one to the other — the campaign string was the
                  only join and it drifts ("DesignPro" vs "DesignPro — founder
                  series"), so scripts sat orphaned while their shots showed
                  no words. This is the real link, and it says which kind it
                  is: an explicit link, or a campaign-name coincidence. */}
              {!isMasterScript(openShot as unknown as ShotRow) && (
                <div className="col-span-2 rounded-md border border-blue-200 bg-blue-50/60 p-2">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-blue-700">
                    📜 Script
                    {openScript?.match === "campaign" && (
                      <span className="rounded bg-amber-100 px-1 text-[9px] font-semibold normal-case text-amber-700">
                        matched by campaign — confirm
                      </span>
                    )}
                  </div>

                  {openScript?.script ? (
                    <>
                      <div className="text-[13px] font-semibold text-gray-900">
                        {scriptLabel(openScript.script)}
                      </div>
                      {scriptBody(openScript.script) && (
                        <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[12px] leading-snug text-gray-700">
                          {scriptBody(openScript.script)}
                        </p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Link to={scriptStudioLink(openScript.script.id)} target="_blank"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
                          <ExternalLink className="h-3 w-3" />Open in Script Studio
                        </Link>
                        {openScript.match === "campaign" ? (
                          <button onClick={() => setScriptLink(openScript.script!.id)} disabled={linkingScript}
                            className="text-xs font-semibold text-emerald-700 hover:underline">
                            Confirm this script
                          </button>
                        ) : (
                          <button onClick={() => setScriptLink(null)} disabled={linkingScript}
                            className="text-xs font-medium text-gray-500 hover:text-red-600 hover:underline">
                            Unlink
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className={cn("text-[12px]", needsScript(openShot as unknown as ShotRow) ? "font-semibold text-rose-700" : "text-gray-600")}>
                        {needsScript(openShot as unknown as ShotRow)
                          ? "No script linked — this shot needs words before it can be filmed."
                          : "No script linked."}
                      </p>
                      {scriptRows.length > 0 && (
                        <select
                          defaultValue=""
                          disabled={linkingScript}
                          onChange={(e) => e.target.value && setScriptLink(e.target.value)}
                          className="mt-1.5 h-8 w-full rounded-md border border-blue-300 bg-white px-2 text-xs text-gray-900"
                        >
                          <option value="">Link a script…</option>
                          {scriptRows.map((sc) => (
                            <option key={sc.id} value={sc.id}>
                              {scriptLabel(sc)}{sc.campaign ? ` · ${sc.campaign}` : ""}
                            </option>
                          ))}
                        </select>
                      )}
                      <Link to={scriptStudioLink()} target="_blank"
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
                        <ExternalLink className="h-3 w-3" />Write one in Script Studio
                      </Link>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* On camera — WHO must be filmed in this segment (owner
                2026-08-04: "add a person to card… they need to be filmed in
                the same segment"). Tap a name to add/remove; saves instantly
                and feeds the Person dropdown. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-gray-700">🎤 On camera</span>
              {people.map((p) => {
                const cast = parseCast(openShot.on_camera_person);
                const active = cast.some((c) => c.toLowerCase() === p.toLowerCase());
                return (
                  <button
                    key={p}
                    onClick={async () => {
                      const next = active
                        ? cast.filter((c) => c.toLowerCase() !== p.toLowerCase())
                        : [...cast, p];
                      const value = next.length ? next.join(" + ") : null;
                      const { error } = await db.from("shot_list_items")
                        .update({ on_camera_person: value, updated_at: new Date().toISOString() })
                        .eq("id", openShot.id);
                      if (error) { toast.error(error.message); return; }
                      setOpenShot({ ...openShot, on_camera_person: value });
                      qc.invalidateQueries({ queryKey: ["shot-list-items"] });
                      toast.success(value ? `On camera: ${value}` : "On camera cleared");
                    }}
                    className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold",
                      active ? "border-fuchsia-600 bg-fuchsia-600 text-white" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50")}
                  >
                    {active ? "✓ " : "+ "}{p}
                  </button>
                );
              })}
            </div>

            {/* Shoot date — set it here, one tap. A DATED shot auto-moves to
                Uploaded when its footage saves, and triggers fresh Director
                ideas (owner 2026-08-04). */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-700">📅 Shoot date</span>
              <Input
                type="date"
                value={openShot.due_date ? openShot.due_date.slice(0, 10) : ""}
                onChange={async (e) => {
                  const v = e.target.value || null;
                  const { error } = await db.from("shot_list_items")
                    .update({ due_date: v, updated_at: new Date().toISOString() }).eq("id", openShot.id);
                  if (error) { toast.error(error.message); return; }
                  setOpenShot({ ...openShot, due_date: v });
                  qc.invalidateQueries({ queryKey: ["shot-list-items"] });
                  if (v) toast.success("Shoot date set — uploading footage will now move this card automatically");
                }}
                className="h-8 w-40 bg-white text-xs text-gray-900"
              />
            </div>

            {/* status quick-move + one-tap complete for required shots */}
            <div className="flex flex-wrap items-center gap-1">
              {SHOT_STATUSES.map((s) => (
                <button key={s.key} onClick={() => setStatus.mutate({ id: openShot.id, status: s.key })}
                  className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                    openShot.status === s.key ? "text-white" : "bg-white hover:bg-gray-50")}
                  style={openShot.status === s.key
                    ? { backgroundColor: STATUS_COLOR[s.key], borderColor: STATUS_COLOR[s.key] }
                    : { color: STATUS_COLOR[s.key], borderColor: `${STATUS_COLOR[s.key]}66` }}>
                  {s.label}
                </button>
              ))}
              {openShot.status !== "approved" && openShot.status !== "published" && (
                <button onClick={() => setStatus.mutate({ id: openShot.id, status: "approved" })}
                  className="ml-auto rounded-full border border-emerald-600 bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100">
                  ✓ Mark complete
                </button>
              )}
            </div>

            {/* upload — scoped to THIS shot only. Saved assets get per-thumbnail
                actions: ★ set cover · crop (photos, opens the Konva editor) ·
                view. New picks stage as previews and only save on confirm. */}
            <div className="rounded-lg border border-dashed border-gray-300 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700"><Upload className="h-3.5 w-3.5" />Raw footage for this shot ({openShot.raw_asset_ids?.length || 0})</div>
              {shotAssets.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                  {shotAssets.map((a: any) => {
                    const isCover = openShot.cover_asset_id === a.id;
                    // assetThumb, not a raw <video src>: a bare mp4 tag paints
                    // black until it's seeked, and a Drive share link is a web
                    // page with no frame at all. Both read as "my upload is
                    // missing" when the file is actually there.
                    const thumb = assetThumb(a);
                    return (
                      <div key={a.id} className={cn("relative overflow-hidden rounded-md border bg-gray-100",
                        isCover ? "border-amber-400 ring-1 ring-amber-400" : "border-gray-200")}>
                        <div className="aspect-square">
                          {thumb.kind === "image"
                            ? <img src={thumb.src} alt="" className="h-full w-full object-cover" loading="lazy" />
                            : thumb.kind === "video"
                              ? <video src={thumb.src} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                              : thumb.kind === "audio"
                                ? <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-400">🎵 audio</div>
                                : <div className="flex h-full w-full items-center justify-center px-1 text-center text-[9px] text-gray-400">no preview</div>}
                        </div>
                        <div className="flex items-center justify-center gap-1 bg-white/95 py-0.5">
                          <button title={isCover ? "Cover image" : "Set as cover"}
                            onClick={() => setCover.mutate({ shotId: openShot.id, assetId: isCover ? null : a.id })}
                            className={cn("rounded p-0.5", isCover ? "text-amber-500" : "text-gray-400 hover:text-amber-500")}>
                            <Star className="h-3.5 w-3.5" fill={isCover ? "currentColor" : "none"} />
                          </button>
                          {a.asset_type === "image" && (
                            <button title="Crop / reposition"
                              onClick={() => setCropSource({ url: a.storage_url, parentId: a.id })}
                              className="rounded p-0.5 text-gray-400 hover:text-gray-700">
                              <Crop className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button title="View big"
                            onClick={() => setViewer({ url: a.storage_url, type: a.asset_type, assetId: a.id })}
                            className="rounded p-0.5 text-gray-400 hover:text-gray-700">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* staged picks — previewable, nothing saved until confirmed */}
              {pendingPreviews.length > 0 && (
                <div className="mt-2 rounded-md border border-blue-200 bg-blue-50/50 p-2">
                  <div className="text-[11px] font-bold text-blue-800">Preview — not saved yet</div>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                    {pendingPreviews.map((p, i) => (
                      <div key={i} className="relative aspect-square overflow-hidden rounded-md border border-blue-200 bg-white">
                        {p.file.type.startsWith("video/")
                          ? <video src={p.url} muted className="h-full w-full object-cover" />
                          : p.file.type.startsWith("audio/")
                            ? <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-400">🎵 audio</div>
                            : <img src={p.url} alt="" className="h-full w-full object-cover" />}
                        <button onClick={() => setPendingFiles((cur) => cur.filter((_, j) => j !== i))}
                          className="absolute right-0.5 top-0.5 rounded-full bg-black/60 px-1 text-[10px] text-white">✕</button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <Button size="sm" disabled={uploading} onClick={savePending}
                      className="h-7 bg-blue-600 text-[11px] text-white hover:bg-blue-700">
                      {uploading ? "Saving…" : `Save ${pendingFiles.length} file(s)`}
                    </Button>
                    <Button size="sm" variant="outline" disabled={uploading} className="h-7 text-[11px]"
                      onClick={() => setPendingFiles([])}>
                      Discard
                    </Button>
                  </div>
                </div>
              )}

              {/* PHONE-FIRST upload (owner 2026-08-04: "must have upload
                  ability so we can upload using smart phones"). The bare
                  native file input was a tiny control easily missed next to
                  the URL bar — now two big buttons: pick from the phone's
                  library, or open the camera and record straight into the
                  shot. Both stage for preview; Save file(s) uploads. */}
              <input ref={fileRef} type="file" accept="video/*,image/*,audio/*" multiple className="hidden"
                onChange={(e) => stageFiles(e.target.files)} disabled={uploading} />
              <input ref={cameraRef} type="file" accept="video/*,image/*" capture="environment" className="hidden"
                onChange={(e) => stageFiles(e.target.files)} disabled={uploading} />
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="h-12 w-full bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-sm font-bold text-white"
                >
                  📤 Upload from this phone
                </Button>
                <Button
                  onClick={() => cameraRef.current?.click()}
                  disabled={uploading}
                  variant="outline"
                  className="h-12 w-full border-gray-300 text-sm font-bold text-gray-800"
                >
                  🎥 Record now (camera)
                </Button>
              </div>

              {/* Mobile-friendly alternative to a device upload — paste a
                  direct link (Drive share link, Dropbox, any direct file URL)
                  instead of uploading over a slow on-site connection. */}
              <div className="mt-2 flex items-center gap-1.5 border-t border-dashed border-gray-200 pt-2">
                <Input
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  placeholder="…or paste a video/photo URL (Drive, Dropbox, direct link)"
                  className="h-8 flex-1 text-xs bg-white text-gray-900 placeholder:text-gray-400"
                />
                <Button size="sm" variant="outline" className="h-8 shrink-0 text-[11px]"
                  disabled={attachingUrl || !urlDraft.trim()} onClick={doAttachUrl}>
                  {attachingUrl ? "Adding…" : "Add link"}
                </Button>
              </div>
            </div>

            {/* AI edit — these are BUTTONS, not tags: tapping one is the
                trigger, there is no separate submit. They were being read as
                status labels ("is Reel lit because it's used for a reel?"), so
                the one that was actually built stays lit and says so. */}
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700"><Sparkles className="h-3.5 w-3.5" />Send to AI edit</div>
              <p className="mb-1.5 text-[11px] text-gray-500">
                Tap what you want the AI to CUT this footage into — tapping sends it. Not a label:
                nothing here describes the footage.
                {openShot.edit_type && (
                  <> Already built as <b className="text-gray-700">{EDIT_TYPES.find((t) => t.key === openShot.edit_type)?.label}</b> — tap another to build that version too.</>
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {EDIT_TYPES.map((t) => {
                  const built = openShot.edit_type === t.key;
                  return (
                    <Button key={t.key} size="sm" variant="outline"
                      className={cn("h-7 text-[11px]", built && "border-emerald-500 bg-emerald-50 font-bold text-emerald-700 hover:bg-emerald-100")}
                      title={built ? "Already built as this — tap to rebuild" : `Build a ${t.label.toLowerCase()} from this shot's footage`}
                      disabled={runEdit.isPending || !openShot.raw_asset_ids?.length}
                      onClick={() => runEdit.mutate({ shot: openShot, editType: t.key })}>
                      {built ? `✓ ${t.label}` : t.label}
                    </Button>
                  );
                })}
              </div>
              {!openShot.raw_asset_ids?.length && (
                <p className="mt-1 text-[11px] text-amber-700">
                  Upload footage first — pick files above, then tap <b>Save file(s)</b> (choosing a file only stages it).
                </p>
              )}
            </div>

            {/* Repurpose across the ecosystem — ONE moment, a DIFFERENT
                piece PER BRAND (owner 2026-08-04: "each one of these brands
                would then have sub categories... single piece of content AI
                is repurposing... giving it a different hook and caption").
                WrapTVWorld gets the culture/studio angle, WePrintWraps gets
                the product story across X/thread/LinkedIn/Pinterest (each
                with its OWN hook), Ink & Edge gets an editorial feature. */}
            {!!openShot.raw_asset_ids?.length && (
              <div className="rounded-lg border border-fuchsia-200 bg-fuchsia-50/50 p-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                  <Sparkles className="h-3.5 w-3.5 text-fuchsia-600" />Repurpose across the ecosystem
                </div>
                <p className="mb-1.5 text-[11px] text-gray-500">
                  One tap = a different piece per brand below, each in that brand's own voice — never the same caption reused.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.keys(REPURPOSE_BRAND_LABELS).map((b) => {
                    const active = repurposeBrands.includes(b);
                    return (
                      <button key={b} type="button"
                        onClick={() => setRepurposeBrands((cur) => active ? cur.filter((x) => x !== b) : [...cur, b])}
                        className={cn("rounded-full border px-2 py-0.5 text-[11px] font-bold",
                          active ? "border-fuchsia-600 bg-fuchsia-600 text-white" : "border-gray-300 bg-white text-gray-600")}>
                        {active ? "✓ " : "+ "}{REPURPOSE_BRAND_LABELS[b]}
                      </button>
                    );
                  })}
                </div>
                <Button size="sm"
                  className="mt-2 h-8 bg-gradient-to-r from-fuchsia-600 to-purple-600 text-[11px] font-bold text-white"
                  disabled={repurposeAcrossBrands.isPending || !repurposeBrands.length}
                  onClick={() => repurposeAcrossBrands.mutate(openShot)}>
                  {repurposeAcrossBrands.isPending ? "Writing…" : `🌐 Fire — write ${repurposeBrands.length} brand${repurposeBrands.length === 1 ? "" : "s"}' content`}
                </Button>
              </div>
            )}

            {openShot.board_task_id && (
              <a href="/engine-room/approvals" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
                <ExternalLink className="h-3 w-3" />View on the Marketing Approval Board
              </a>
            )}
            <DialogFooter><Button variant="outline" onClick={() => setOpenShot(null)}>Close</Button></DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* Big viewer — see exactly what was uploaded. Photos hand off to the
          Konva crop editor; videos just play. */}
      <Dialog open={!!viewer} onOpenChange={(o) => !o && setViewer(null)}>
        {viewer && (
          <DialogContent className="bg-black/95 text-white border-0 p-2" style={{ width: "min(96vw, 60rem)", maxWidth: "60rem" }}>
            <DialogHeader><DialogTitle className="sr-only">Media viewer</DialogTitle></DialogHeader>
            {/^https?:\/\/(drive|docs)\.google\.com/.test(viewer.url) ? (
              // A Drive share link can't be played inline — show Drive's own
              // poster and hand off, rather than a black box that looks broken.
              <div className="flex flex-col items-center gap-3 py-4">
                <img src={assetThumb({ storage_url: viewer.url, asset_type: viewer.type }).src}
                  alt="" className="max-h-[65vh] w-auto max-w-full rounded-md" />
                <a href={viewer.url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-blue-300 hover:underline">
                  <ExternalLink className="h-3.5 w-3.5" />Open in Google Drive
                </a>
              </div>
            ) : viewer.type === "video" ? (
              <video src={viewer.url} controls autoPlay playsInline className="mx-auto max-h-[80vh] w-auto max-w-full rounded-md bg-black" />
            ) : viewer.type === "audio" ? (
              <audio src={viewer.url} controls autoPlay className="w-full" />
            ) : (
              <img src={viewer.url} alt="" className="mx-auto max-h-[80vh] w-auto max-w-full rounded-md" />
            )}
            <div className="flex justify-center gap-2 pb-1">
              {viewer.type === "image" && viewer.assetId && (
                <Button size="sm" variant="outline" className="h-8 border-white/40 bg-transparent text-white hover:bg-white/10"
                  onClick={() => { setCropSource({ url: viewer.url, parentId: viewer.assetId! }); setViewer(null); }}>
                  ✂️ Crop / reposition
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-8 border-white/40 bg-transparent text-white hover:bg-white/10"
                onClick={() => setViewer(null)}>Close</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* Konva crop editor — reposition + preset crop; saves a NEW asset,
          original preserved. */}
      <ShotPhotoCropEditor
        sourceUrl={cropSource?.url ?? null}
        saving={savingCrop}
        onConfirm={saveCrop}
        onClose={() => setCropSource(null)}
      />
    </div>
  );
}
