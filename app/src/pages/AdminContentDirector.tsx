// AdminContentDirector — THE one approval queue (/admin/content-director)
//
// One central Content Director over every brand and channel. Every generator
// (marketing-agent, workforce content-agent, Video Studio, Content Studio)
// lands drafts in agent_social_posts / agent_email_campaigns; this page is
// the single gate. APPROVE = SCHEDULED = PUBLISHED: approving assigns the
// next open slot from the weekly programming grid (or the draft's own slot)
// and content-deploy publishes it automatically — IG, FB, and the
// WrapTVWorld site rotation. No second review step anywhere.
import IdeasLane from "@/components/admin/IdeasLane";
import FootageIdeasLane from "@/components/admin/FootageIdeasLane";
import AssistLane from "@/components/brandboard/AssistLane";
import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { makeCreativeForPost, type MakeCreativeResult } from "@/lib/makeCreative";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { HelpCircle, ChevronDown, ListChecks, CalendarDays, X, Clock } from "lucide-react";
import { ColorTabRow, type ColorOption } from "@/components/admin/ColorTabs";
import { brandMeta, channelMeta, teamFor } from "@/lib/content-tags";
import MarketingSuiteGuide from "@/components/admin/MarketingSuiteGuide";
import MarketingSystemMap from "@/components/admin/MarketingSystemMap";
import ShotListTab from "@/components/admin/ShotListTab";
import ChannelAngleCard from "@/components/admin/ChannelAngleCard";
import AdsPerformancePanel from "@/components/admin/AdsPerformancePanel";
import ResendAudiencesCard from "@/components/admin/ResendAudiencesCard";
import VideoEditTicketEditor from "@/components/admin/VideoEditTicketEditor";
import { cn } from "@/lib/utils";
import { splitBySurface, brandBoardLinkFor, posterFor } from "@/lib/contentOsRouting";
import {
  VIDEO_EDIT_FILE_ACCEPT,
  defaultVideoEditTicket,
  editTicketFromGenerationMeta,
  nextVideoEditTicketState,
  validateVideoEditFile,
  videoEditBrandForSeries,
  withVideoEditTicket,
  type VideoEditSeries,
  type VideoEditTicket,
} from "@/lib/videoEditTicket";
import { uploadVideoEditSource } from "@/lib/videoEditTicketUpload";

/** Collapsible "read me" card — same pattern as the Studio Board explainer. */
function HowThisWorks() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <HelpCircle className="h-5 w-5 shrink-0 text-blue-500" />
          <span className="text-sm font-bold text-gray-900">How this page works — read me</span>
          <span className="hidden text-xs text-gray-400 sm:inline">How to plan, approve, schedule and publish — and where tasks &amp; calendar fit.</span>
        </span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-4 text-sm text-gray-700">
          <p className="mb-3">
            <span className="font-semibold text-gray-900">What this page is.</span> The Content Director is the{" "}
            <span className="font-semibold">one approval queue for every brand and channel</span>. Everything the
            system generates — the workforce content agent, Video Studio renders, Content Studio, the Director's own
            weekly plan — lands here as a draft. Nothing publishes until you approve it, and approving is the ONLY
            step: <span className="font-semibold">approve = scheduled = published</span>.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">
                <ListChecks className="h-3.5 w-3.5" /> The weekly routine (in order)
              </p>
              <ol className="space-y-1.5 text-[13px] leading-snug text-gray-700">
                <li><span className="font-semibold">1. Plan this week</span> — fills every open programming slot (Mon before/after, Tue story + The Wrap email, Wed social proof, Thu demo, Fri repost winner) with drafts built from real library media, one per slot. The Tuesday issue of The Wrap generates automatically.</li>
                <li><span className="font-semibold">2. Review each card</span> — read the caption, check the media. Edit later revisions in Content Studio if needed.</li>
                <li><span className="font-semibold">3. Approve →</span> the post takes its programming slot (shown on the card) and flips to <span className="font-mono text-xs">scheduled</span>. Want a different time? Pick one in the date field BEFORE hitting Approve.</li>
                <li><span className="font-semibold">4. Reject</span> — keeps the record (<span className="font-mono text-xs">rejected</span>), never publishes.</li>
                <li><span className="font-semibold">5. Done.</span> No second review step anywhere — publishing is automatic from here.</li>
              </ol>
            </div>

            <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">
                <CalendarDays className="h-3.5 w-3.5" /> What happens after Approve
              </p>
              <ul className="space-y-1.5 text-[13px] leading-snug text-gray-700">
                <li><span className="font-semibold">Publishing:</span> the content-deploy cron runs every 5 minutes and ships each scheduled post at its time — Instagram, Facebook, or the WrapTVWorld site rotation (newest 12 per show stay live, older auto-archive).</li>
                <li><span className="font-semibold">Email (The Wrap):</span> approving flips the campaign to <span className="font-mono text-xs">approved</span>; the daily agent run pushes it to Klaviyo as a draft — it never sends without you.</li>
                <li><span className="font-semibold">Calendar:</span> every approval writes an entry to the Content Calendar (the Marketing Hub calendar tab), so the week's schedule is always visible there.</li>
                <li><span className="font-semibold">Tasks:</span> generator QC cards live on the Marketing Hub board as usual, and a publish that fails 3 times automatically raises a high-priority Engine Room task card — failures never die silently.</li>
                <li><span className="font-semibold">"Going out automatically"</span> (below) is the live outbound queue; "The standing weekly schedule" at the bottom is the recurring grid everything maps onto.</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface QueueItem {
  kind: "social_post" | "email_campaign";
  id: string;
  brand: string;
  platform?: string;
  post_type?: string;
  caption?: string | null;
  hashtags?: string[] | null;
  media_urls?: string[] | null;
  scheduled_date?: string | null;
  created_by?: string | null;
  created_at?: string;
  generation_meta?: Record<string, unknown> | null;
  campaign_name?: string;
  subject_line?: string;
  preview_text?: string;
  proposed_slot?: { id: string; label: string; when: string } | null;
  /** Poster frame, joined from the render in director_queue. Without it an
   *  unpostered <video> paints a black rectangle and the card looks empty. */
  thumbnail_url?: string | null;
  /** Set while a creative is COMPOSING — the render is in flight and
   *  reattach.js will attach it. Without this the card is indistinguishable
   *  from an untouched one and gets built twice. */
  building?: { render_job_id: string; since?: string | null } | null;
}

interface DirectorData {
  queue: QueueItem[];
  scheduled: QueueItem[];
  programming: { id: string; label: string }[];
  /** True inventory vs what this response carries — see marketing-agent. */
  totals?: {
    social_drafts: number;
    email_drafts: number;
    shown_social: number;
    shown_email: number;
    truncated: number;
  };
}

const BRAND_LABEL: Record<string, string> = {
  restylepro: "RestylePro", weprintwraps: "WePrintWraps", designproai: "DesignProAI",
  wraptvworld: "WrapTVWorld", inkandedge: "Ink & Edge", thewrap: "The Wrap",
};

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", wraptv_site: "WrapTVWorld site", email: "Email",
};

const fmtWhen = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

function Chip({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "blue" | "pink" }) {
  const tones = {
    gray: "bg-gray-100 text-gray-600",
    blue: "bg-blue-50 text-blue-600",
    pink: "bg-pink-50 text-pink-600",
  };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export default function AdminContentDirector() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // DEEP LINK FROM THE BRAND BOARD. "Edit" on a designed card used to land on
  // this page with 200 cards and no way to find the one you clicked. ?post=<id>
  // scrolls to it and rings it, so viewing a design leads straight to editing it.
  //
  // WARNING — this effect must NOT reference `data`. It did, and `data` is
  // declared ~60 lines below by useQuery, so the dependency array hit the
  // temporal dead zone: "Cannot access 'data' before initialization" threw on
  // every render and the whole page went blank — Shot List and Scripts with
  // it, mid-shoot. Depend only on things declared above this line.
  const focusPostId = searchParams.get("post");
  const focusRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!focusPostId) return;
    // The queue renders after its fetch, so poll briefly for the card rather
    // than depending on query state that lives further down the component.
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      const el = focusRef.current || document.getElementById(`post-${focusPostId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        clearInterval(t);
      } else if (tries > 20) {
        clearInterval(t);   // give up quietly; the card may not be in the queue
      }
    }, 250);
    return () => clearInterval(t);
  }, [focusPostId]);
  const [tab, setTabState] = useState<"queue" | "shotlist" | "ads" | "lists">(
    searchParams.get("tab") === "shotlist"
      ? "shotlist"
      : searchParams.get("tab") === "ads"
        ? "ads"
        : searchParams.get("tab") === "lists"
          ? "lists"
          : "queue",
  );
  const setTab = (next: "queue" | "shotlist" | "ads" | "lists") => {
    setTabState(next);
    setSearchParams(next === "queue" ? {} : { tab: next }, { replace: true });
  };
  const [customWhen, setCustomWhen] = useState<Record<string, string>>({});
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // Upload-your-own-campaign form (DesignProAI is the primary brand default)
  const [showUpload, setShowUpload] = useState(false);
  const [upBrand, setUpBrand] = useState("designproai");
  const [upPlatform, setUpPlatform] = useState("instagram");
  const [upCaption, setUpCaption] = useState("");
  const [upFile, setUpFile] = useState<File | null>(null);
  const [upMode, setUpMode] = useState<"post" | "video_edit">("post");
  const [upSeries, setUpSeries] = useState<VideoEditSeries>("behind_the_install");
  const [upBusy, setUpBusy] = useState(false);
  const [upProgress, setUpProgress] = useState(0);

  const uploadCampaign = async () => {
    if (!upCaption.trim() && !upFile && upMode === "post") { toast.error("Add a caption or a file (or both)."); return; }
    if (upMode === "video_edit" && upFile) {
      const fileError = validateVideoEditFile(upFile);
      if (fileError) { toast.error(fileError); return; }
    }
    setUpBusy(true);
    setUpProgress(0);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw new Error("Sign in again before adding this card.");
      const postId = crypto.randomUUID();
      const targetBrand = upMode === "video_edit" ? videoEditBrandForSeries(upSeries) : upBrand;

      if (upMode === "video_edit") {
        let ticket: VideoEditTicket = {
          ...defaultVideoEditTicket(upSeries),
          owner_id: userData.user.id,
          requested_edits: upCaption.trim(),
          updated_at: new Date().toISOString(),
        };
        const { data: inserted, error: insertError } = await (supabase as any).from("agent_social_posts").insert({
          id: postId,
          brand: targetBrand,
          platform: upPlatform,
          post_type: "video_edit_ticket",
          caption: upCaption.trim() || `Video edit ticket — ${upSeries.replaceAll("_", " ")}`,
          media_urls: [],
          generation_meta: withVideoEditTicket({}, ticket),
          status: "draft",
          created_by: `content-director:${userData.user.id}`,
        }).select("id, brand").single();
        if (insertError) throw insertError;
        if (!inserted || inserted.id !== postId || inserted.brand !== targetBrand) {
          throw new Error("The new ticket did not match the selected brand.");
        }

        // The card is real before upload starts. If the network drops, the
        // ticket stays visible and the source can be attached again on-card.
        if (upFile) {
          const uploaded = await uploadVideoEditSource({
            file: upFile,
            brand: targetBrand,
            postId,
            onProgress: setUpProgress,
          });
          ticket = {
            ...ticket,
            source_video_url: uploaded.publicUrl,
            state: nextVideoEditTicketState({ ...ticket, source_video_url: uploaded.publicUrl }),
            progress: "Source uploaded — edit brief ready",
            updated_at: new Date().toISOString(),
          };
          const { data: updated, error: updateError } = await (supabase as any)
            .from("agent_social_posts")
            .update({ generation_meta: withVideoEditTicket({}, ticket) })
            .eq("id", postId)
            .eq("brand", targetBrand)
            .select("id, brand")
            .single();
          if (updateError) throw updateError;
          if (!updated || updated.brand !== targetBrand) throw new Error("The source could not be attached to this brand's ticket.");
        }

        toast.success("Video edit ticket created — its brief and source stay editable on this card.");
        setSearchParams({ post: postId }, { replace: true });
        setUpCaption(""); setUpFile(null); setShowUpload(false); setUpProgress(0);
        qc.invalidateQueries({ queryKey: ["content-director-queue"] });
        return;
      }

      let mediaUrl: string | null = null;
      if (upFile) {
        const ext = upFile.name.split(".").pop() || "bin";
        const path = `uploads/${userData.user.id}/${targetBrand}/${postId}.${ext}`;
        const { error: upErr } = await (supabase as any).storage.from("wrap-files").upload(path, upFile, {
          upsert: false,
          contentType: upFile.type || undefined,
        });
        if (upErr) throw upErr;
        mediaUrl = (supabase as any).storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
      }
      const { data: inserted, error } = await (supabase as any).from("agent_social_posts").insert({
        id: postId,
        brand: targetBrand,
        platform: upPlatform,
        post_type: "feed",
        caption: upCaption.trim(),
        media_urls: mediaUrl ? [mediaUrl] : [],
        // director_queue lists social posts with status "draft" — inserting
        // "needs_review" made uploads invisible in the Director's own queue.
        status: "draft",
        created_by: `content-director:${userData.user.id}`,
      }).select("id, brand").single();
      if (error) throw error;
      if (!inserted || inserted.brand !== targetBrand) throw new Error("The new post did not match the selected brand.");
      toast.success("Uploaded into the queue — edit or approve it below like any draft.");
      setUpCaption(""); setUpFile(null); setShowUpload(false);
      qc.invalidateQueries({ queryKey: ["content-director-queue"] });
    } catch (e: any) {
      toast.error(String(e.message ?? e));
    } finally { setUpBusy(false); }
  };

  const { data, isLoading } = useQuery<DirectorData>({
    queryKey: ["content-director-queue"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("marketing-agent", { body: { action: "director_queue" } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as DirectorData;
    },
    refetchInterval: 30000,
  });

  // ⚡ MAKE THE CREATIVE — a text-only draft is not reviewable: there is
  // nothing to look at, so approving it is a guess. This composes the actual
  // asset from the caption + REAL Asset Library imagery (never invented
  // pixels), attaches it to the post, and records which assets it used so the
  // provenance is visible before a human approves. Refuses honestly when the
  // library has nothing to build from.
  const [creativeFor, setCreativeFor] = useState<string | null>(null);
  const [creativeInfo, setCreativeInfo] = useState<Record<string, MakeCreativeResult>>({});
  const makeCreative = useMutation({
    mutationFn: async (item: QueueItem) => {
      setCreativeFor(item.id);
      const res = await makeCreativeForPost({
        id: item.id, brand: item.brand, caption: item.caption, post_type: item.post_type,
      });
      return { id: item.id, res };
    },
    onSuccess: ({ id, res }) => {
      setCreativeFor(null);
      setCreativeInfo((c) => ({ ...c, [id]: res }));
      if (res.ok) {
        toast.success(`Creative built from ${res.usedAssets.length} library asset(s) — review it, then approve.`);
        qc.invalidateQueries({ queryKey: ["content-director-queue"] });
      } else {
        toast.error(res.refusedBecause || "Couldn't build the creative");
      }
    },
    onError: (e: Error) => { setCreativeFor(null); toast.error(e.message); },
  });

  // ✏️ FIX WITH AI — refine the copy in place, right where you're judging it.
  // The retired Content Review page owned this; the Director inherited its
  // traffic but not this affordance, leaving `revise_copy` live server-side
  // with no caller. Viewing a weak caption on the board and having to leave
  // to fix it is how drafts get approved as-is.
  const [fixFor, setFixFor] = useState<string | null>(null);
  const [fixText, setFixText] = useState("");
  const [fixedCaptions, setFixedCaptions] = useState<Record<string, string>>({});
  const fixCopy = useMutation({
    mutationFn: async ({ item, instruction }: { item: QueueItem; instruction: string }) => {
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: {
          action: "revise_copy",
          brand: item.brand || "weprintwraps",
          caption: fixedCaptions[item.id] ?? item.caption ?? "",
          instruction,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const caption = String(data?.caption || "");
      if (!caption) throw new Error("the AI returned no revision — try a more specific instruction");
      const hashtags = Array.isArray(data?.hashtags) ? data.hashtags.map(String) : undefined;
      // Persist, so the fix survives a refresh and is what actually publishes.
      const { error: updErr } = await (supabase as any)
        .from("agent_social_posts")
        .update({ caption, ...(hashtags?.length ? { hashtags } : {}) })
        .eq("id", item.id);
      if (updErr) throw new Error("revised it but couldn't save: " + updErr.message);
      return { id: item.id, caption };
    },
    onSuccess: ({ id, caption }) => {
      setFixedCaptions((c) => ({ ...c, [id]: caption }));
      setFixFor(null); setFixText("");
      toast.success("Copy updated — read it, then approve.");
      qc.invalidateQueries({ queryKey: ["content-director-queue"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Attach the creative directly — upload an image/video onto a copy-only
  // draft (the alternative to "Make the creative" when the asset already
  // exists on this device).
  const attachMedia = useMutation({
    mutationFn: async ({ item, file }: { item: QueueItem; file: File }) => {
      const ext = file.name.split(".").pop() || "bin";
      const path = `uploads/queue-${item.id}-${Date.now()}.${ext}`;
      const { error: upErr } = await (supabase as any).storage.from("wrap-files").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const url = (supabase as any).storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
      const { error } = await (supabase as any).from("agent_social_posts")
        .update({ media_urls: [url] }).eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Creative attached to this card.");
      qc.invalidateQueries({ queryKey: ["content-director-queue"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Attach a clip the AI sourced. Same write as a hand upload — the only
   * difference is where the URL came from, which is recorded so a human can
   * tell a sourced clip from an uploaded one later.
   */
  const attachUrl = useMutation({
    mutationFn: async ({ item, url }: { item: QueueItem; url: string }) => {
      const { error } = await (supabase as any).from("agent_social_posts")
        .update({ media_urls: [url], updated_at: new Date().toISOString() })
        .eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["content-director-queue"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: async (item: QueueItem) => {
      const body: Record<string, unknown> = { action: "director_approve" };
      if (item.kind === "email_campaign") body.campaign_id = item.id;
      else body.post_id = item.id;
      const when = customWhen[item.id];
      if (when) body.scheduled_date = new Date(when).toISOString();
      const { data, error } = await supabase.functions.invoke("marketing-agent", { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d) => {
      toast.success(
        d.status === "approved"
          ? "Approved — pushed to Klaviyo on the next agent run."
          : `Scheduled for ${fmtWhen(d.scheduled_date)}${d.slot ? ` (${d.slot})` : ""} — publishes automatically.`,
      );
      qc.invalidateQueries({ queryKey: ["content-director-queue"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: async (item: QueueItem) => {
      const body: Record<string, unknown> = { action: "director_reject" };
      if (item.kind === "email_campaign") body.campaign_id = item.id;
      else body.post_id = item.id;
      const { data, error } = await supabase.functions.invoke("marketing-agent", { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast.success("Rejected.");
      qc.invalidateQueries({ queryKey: ["content-director-queue"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // The X on a card — a hard delete, distinct from Reject (which keeps the
  // record as "rejected"). For a draft you just don't want cluttering the
  // queue at all, not one worth keeping a rejection record for.
  const deleteItem = useMutation({
    mutationFn: async (item: QueueItem) => {
      const table = item.kind === "email_campaign" ? "agent_email_campaigns" : "agent_social_posts";
      const { error } = await (supabase as any).from(table).delete().eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted.");
      qc.invalidateQueries({ queryKey: ["content-director-queue"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const planWeek = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("marketing-agent", { body: { action: "director_plan_week" } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d) => {
      toast.success(d.created?.length ? `${d.created.length} drafts planned into this week's grid.` : d.note || "Week already planned.");
      qc.invalidateQueries({ queryKey: ["content-director-queue"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // THE SURFACE BOUNDARY, applied before anything else reads the queue.
  // This page approves IDEAS; a piece that is already MADE belongs to the Brand
  // Board, where it can be seen full size and actually edited (song, logo,
  // ticker, copy) rather than waved through. Before this the same post sat on
  // both pages with two approve buttons that meant different things, and a
  // finished reel rendered as a full-width player wedged into the idea queue.
  // Rule: src/lib/contentOsRouting.ts.
  //
  // Splitting FIRST also keeps the filter chips honest — counted off the same
  // set the grid renders, so a chip can never promise cards the grid won't show.
  const { ideas: allIdeas, made: allMade } = splitBySurface(data?.queue ?? []);
  const allQueue = allIdeas;
  const allScheduled = data?.scheduled ?? [];

  // Color-coded sort dimensions — brand · channel · team — from the queue.
  const itBrand = (it: QueueItem) => (it.brand || "other").toLowerCase();
  const itChannel = (it: QueueItem) => (it.kind === "email_campaign" ? "email" : (it.platform || "other").toLowerCase());
  const itTeam = (it: QueueItem) => teamFor(it.created_by).key;
  const buildOptions = (fn: (it: QueueItem) => string, meta: (k: string) => { label: string; color: string }): ColorOption[] => {
    const c: Record<string, number> = {};
    for (const it of allQueue) c[fn(it)] = (c[fn(it)] || 0) + 1;
    return Object.keys(c).sort((a, b) => c[b] - c[a]).map((k) => ({ key: k, label: meta(k).label, color: meta(k).color, count: c[k] }));
  };
  // Coarse content type — the owner wants landing pages/websites separable
  // from the social stream at a glance ("should have a button for landing
  // pages and websites").
  const itType = (it: QueueItem) => {
    const pt = (it.post_type || "").toLowerCase();
    if (["landing_page", "website", "page", "webpage"].includes(pt)) return "pages";
    if (it.kind === "email_campaign") return "email";
    return "social";
  };
  const TYPE_META: Record<string, { label: string; color: string }> = {
    pages: { label: "Landing Pages & Websites", color: "#8b5cf6" },
    social: { label: "Social", color: "#3b82f6" },
    email: { label: "Email", color: "#f59e0b" },
  };
  const brandOptions = buildOptions(itBrand, (k) => brandMeta(k));
  const channelOptions = buildOptions(itChannel, (k) => channelMeta(k));
  const teamOptions = buildOptions(itTeam, (k) => teamFor(k === "agent" ? "marketing-agent" : k));
  const typeOptions = buildOptions(itType, (k) => TYPE_META[k] || { label: k, color: "#64748b" });

  const passes = (it: QueueItem) =>
    (brandFilter === "all" || itBrand(it) === brandFilter) &&
    (channelFilter === "all" || itChannel(it) === channelFilter) &&
    (teamFilter === "all" || itTeam(it) === teamFilter) &&
    (typeFilter === "all" || itType(it) === typeFilter);
  const queue = allIdeas.filter(passes);
  const made = allMade.filter(passes);
  const scheduled = allScheduled.filter(passes);

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="mb-5"><MarketingSystemMap page="director" /></div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-gray-500">Every brand's content · one approval queue</div>
            <h1 className="mt-1 text-4xl font-bold text-gray-900">
              Content{" "}
              <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Director</span>
            </h1>
            <p className="mt-2 max-w-xl text-sm text-gray-600">
              Every post the tools create lands here as a draft. You approve it — it publishes itself
              (Instagram, Facebook, email, the WrapTVWorld site). Nothing goes out without your OK,
              and nothing needs a second step after it.
            </p>
          </div>
          <div className="text-right">
            <Button
              onClick={() => planWeek.mutate()}
              disabled={planWeek.isPending}
              className="bg-gray-900 text-white hover:bg-gray-800"
            >
              {planWeek.isPending ? "Planning…" : "Plan this week"}
            </Button>
            <p className="mt-1.5 max-w-[220px] text-[11px] leading-snug text-gray-500">
              Fills every open slot in this week's schedule with fresh drafts for you to approve.
            </p>
          </div>
        </div>

        {/* Queue vs Shot List — the Shot List turns this page's plan into
            filmable items; the queue is where finished/text content is
            approved. Same page, two lenses. */}
        {/* The active lens carries the suite's blue→pink gradient — the same
            accent this page uses for its heading rules and primary actions.
            Flat gray-900 made these read as disabled next to everything else. */}
        <div className="mt-5 flex gap-2">
          <button
            onClick={() => setTab("queue")}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-bold transition-shadow",
              tab === "queue"
                ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white shadow-sm"
                : "border border-gray-300 bg-white text-gray-600 hover:border-gray-400",
            )}
          >
            Content Queue
          </button>
          <button
            onClick={() => setTab("shotlist")}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-bold transition-shadow",
              tab === "shotlist"
                ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white shadow-sm"
                : "border border-gray-300 bg-white text-gray-600 hover:border-gray-400",
            )}
          >
            🎬 Shot List
          </button>
          <button
            onClick={() => setTab("ads")}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-bold transition-shadow",
              tab === "ads"
                ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white shadow-sm"
                : "border border-gray-300 bg-white text-gray-600 hover:border-gray-400",
            )}
          >
            📊 AdsPro
          </button>
          <button
            onClick={() => setTab("lists")}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-bold transition-shadow",
              tab === "lists"
                ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white shadow-sm"
                : "border border-gray-300 bg-white text-gray-600 hover:border-gray-400",
            )}
          >
            📇 Lists
          </button>
          {/* Scripts sit one tap from the Shot List (owner 2026-08-04) —
              per-shot beats live on each card; full scripts/transcripts are
              Script Studio's, so this is a door, not a third tab. */}
          <Link
            to="/admin/script-studio"
            className="rounded-full border border-gray-300 bg-white px-4 py-1.5 text-sm font-bold text-gray-600 hover:border-gray-400"
          >
            📜 Scripts
          </Link>
        </div>

        {tab === "shotlist" && (
          <div className="mt-6">
            <ShotListTab />
          </div>
        )}

        {tab === "ads" && (
          <div className="mt-6">
            <AdsPerformancePanel />
          </div>
        )}

        {/* Lists — the contact lists that live in Resend. They were invisible
            to the app (Resend was send-only), so they couldn't be counted or
            exported to a Meta Custom Audience. */}
        {tab === "lists" && (
          <div className="mt-6">
            <ResendAudiencesCard />
          </div>
        )}

        {tab === "queue" && (
        <>
        {/* ── THE LANE THIS PAGE NOW OWNS ─────────────────────────────────────
            Owner, 2026-08-10: "Brand Board = finished work you can look at and
            use. Content Director = the queue of ideas waiting on your approval…
            everything refused or pending goes to Content Director where you act
            on it."

            The refused pieces were diagnosed on the Brand Board and could only
            be diagnosed there — the board printed the reason and offered the
            Assist, on the same screen somebody opens to look at finished work.
            The measurement that put them there stands (they really are not
            edits); the placement was wrong.

            It leads the queue, ABOVE the ideas, because a refusal is the only
            thing here that is already paid for: the idea was approved, the
            footage was chosen, the pipeline stopped one step short. Unsticking
            one is worth more than approving a new idea, and it is the shortest
            path from this page to a finished cut.

            `boardAttention.LANE_BY_KEY.stuck.surface === "director"` is the same
            fact stated once, so the board's ribbon and this page cannot disagree
            about who owns the pile. */}
        <div className="mt-6">
          <AssistLane brand={brandFilter === "all" ? null : brandFilter} />
        </div>

        {/* IDEAS FIRST. The loop the owner described — square cards showing
            ideas, approve, and the content gets made — did not exist:
            content_hooks held 534 ideas that nothing consumed, while this page
            only ever showed things that were already made. Ideas lead now,
            because the queue below is downstream of them. */}
        <div className="mt-6">
          <IdeasLane />
        </div>

        {/* …AND THE FOOTAGE GETS TO PROPOSE TOO.
            The lane above reads content_hooks — strategy written from brand
            doctrine. Measured 2026-08-07: 534 rows, 525 active. Meanwhile the
            footage had already produced its own candidates (11,675 moments
            across 356 clips, 3,653 carrying a verbatim line) and they proposed
            nothing, so a human approved a claim and the matcher then went
            hunting for a clip to fit it — evidence chosen after the claim.
            This lane inverts that: the footage speaks first, and approving
            hands the card to the SAME fan-out, so there is one pipeline rather
            than two. It carries the brand filter because the doctrine's
            declared interests — the "interest-based" half of the ranking —
            differ per brand. */}
        <div className="mt-6">
          <FootageIdeasLane brand={brandFilter} />
        </div>

        {/* The whole suite, in order — this page is its gate, so the map lives
            here first. Same component on every marketing page. */}
        <div className="mt-6">
          <MarketingSuiteGuide />
        </div>

        {/* Connected tools — the creation surfaces that feed this queue.
            The retired Content Review page carried these links; people used
            them to FIND the tools, so the Director (where its redirect lands)
            must carry them too. */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Connected tools</span>
          {[
            { to: "/admin/content-studio", label: "🎨 Content Studio" },
            { to: "/admin/composer", label: "✨ Composer" },
            { to: "/admin/script-studio", label: "🎬 Script Studio (Transcripts)" },
            { to: "/engine-room?tab=assets", label: "📚 Asset Library" },
            { to: "/admin/mightymail", label: "✉️ MightyMail" },
          ].map((t) => (
            <Link
              key={t.to}
              to={t.to}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              {t.label}
            </Link>
          ))}
        </div>

        {/* The whole page in three steps — always visible, no accordion to
            open. The detailed read-me card below stays for the fine print. */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            {
              n: "1",
              title: "Content gets created",
              body: "Drafts arrive from the tools above, from “Plan this week”, or add your own below.",
            },
            {
              n: "2",
              title: "You approve it",
              body: "Review each card in “Waiting on you”. Approve = it takes a publish time. Reject = it never goes out.",
            },
            {
              n: "3",
              title: "It publishes itself",
              body: "Every approved post ships automatically at its time — watch “Going out automatically” below.",
            },
          ].map((s) => (
            <div key={s.n} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-xs font-bold text-white">{s.n}</span>
                <span className="text-sm font-bold text-gray-900">{s.title}</span>
              </div>
              <p className="mt-2 text-[13px] leading-snug text-gray-600">{s.body}</p>
            </div>
          ))}
        </div>

        <HowThisWorks />

        {/* Upload / create your own campaign — flows into the same queue */}
        <div className="mt-6 rounded-xl border border-pink-200 bg-pink-50/40 shadow-sm">
          <button onClick={() => setShowUpload((o) => !o)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
            <span className="text-sm font-bold text-gray-900">➕ Add a post or video edit ticket to the queue</span>
            <ChevronDown className={`h-5 w-5 text-gray-400 transition-transform ${showUpload ? "rotate-180" : ""}`} />
          </button>
          {showUpload && (
            <div className="border-t border-pink-100 px-4 py-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <select value={upMode} onChange={(e) => setUpMode(e.target.value as "post" | "video_edit")} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold">
                  <option value="post">Social post</option>
                  <option value="video_edit">Video edit ticket</option>
                </select>
                <select
                  value={upMode === "video_edit" ? videoEditBrandForSeries(upSeries) : upBrand}
                  onChange={(e) => setUpBrand(e.target.value)}
                  disabled={upMode === "video_edit"}
                  title={upMode === "video_edit" ? "Brand is locked to the selected show series" : undefined}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                >
                  {Object.entries(BRAND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={upPlatform} onChange={(e) => setUpPlatform(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
                  <option value="instagram">Instagram</option><option value="facebook">Facebook</option>
                  <option value="x">X</option><option value="linkedin">LinkedIn</option>
                  <option value="pinterest">Pinterest</option><option value="youtube_shorts">YouTube Short</option>
                </select>
                {upMode === "video_edit" && (
                  <select value={upSeries} onChange={(e) => setUpSeries(e.target.value as VideoEditSeries)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
                    <option value="behind_the_install">Behind the Install — music video</option>
                    <option value="behind_the_brand">Behind the Brand — documentary / talking</option>
                    <option value="weprintwraps">WePrintWraps content</option>
                  </select>
                )}
                <label className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium cursor-pointer hover:border-pink-400">
                  {upFile ? upFile.name.slice(0, 24) : upMode === "video_edit" ? "🎬 Attach MP4 / MOV / WebM" : "📎 Attach image/video"}
                  <input type="file" accept={upMode === "video_edit" ? VIDEO_EDIT_FILE_ACCEPT : "image/*,video/*"} className="hidden" onChange={(e) => setUpFile(e.target.files?.[0] ?? null)} />
                </label>
              </div>
              <textarea value={upCaption} onChange={(e) => setUpCaption(e.target.value)} rows={3}
                placeholder={upMode === "video_edit" ? "Requested edits, hook, pacing, talking sections, CTA…" : "Caption / campaign copy…"} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-pink-400" />
              {upBusy && upMode === "video_edit" && upFile && (
                <div className="text-xs font-semibold text-fuchsia-700">Uploading source… {upProgress}%</div>
              )}
              <Button onClick={uploadCampaign} disabled={upBusy} className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white font-bold">
                {upBusy ? (upMode === "video_edit" && upFile ? `Uploading ${upProgress}%` : "Saving…") : upMode === "video_edit" ? "Create edit ticket" : "Add to queue"}
              </Button>
            </div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            {/* COPY only. This used to print the server's whole draft total,
                which now includes the made pieces this page hands to the Brand
                Board — a number counting cards that aren't here is the same lie
                as the truncated count below it. Both halves are stated. */}
            <div className="text-2xl font-bold text-gray-900">{queue.length}</div>
            <div className="mt-0.5 text-xs text-gray-500">Copy waiting on you</div>
            {made.length > 0 && (
              <div className="mt-0.5 text-[11px] font-medium text-emerald-600">
                + {made.length} made · on the Brand Board
              </div>
            )}
            {/* When the queue can't carry everything, SAY SO. The old header
                printed the query's limit as if it were the count, so a
                truncated queue looked complete. */}
            {!!data?.totals?.truncated && (
              <div className="mt-0.5 text-[11px] font-medium text-amber-600">
                {data.totals.truncated} older draft{data.totals.truncated === 1 ? "" : "s"} not loaded
              </div>
            )}
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-2xl font-bold text-gray-900">{scheduled.length}</div>
            <div className="mt-0.5 text-xs text-gray-500">Approved — going out automatically</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-2xl font-bold text-gray-900">{data?.programming?.length ?? 0}</div>
            <div className="mt-0.5 text-xs text-gray-500">Standing slots in the weekly schedule</div>
          </div>
        </div>

        {/* THE queue */}
        <h2 className="mt-10 text-lg font-bold text-gray-900">1 · Waiting on you</h2>
        <p className="mt-1 text-sm text-gray-500">
          Copy waiting for your OK — approve or reject each card, and everything after that is automatic.
          Pieces that are already <span className="font-semibold text-gray-700">made</span> are approved and
          edited on the <Link to="/admin/brand-board" className="font-semibold text-blue-600 hover:underline">Brand Board</Link>.
        </p>
        <div className="mt-2 h-px bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />

        {/* Color-coded sort rows — brand · social channel · team member */}
        {allQueue.length > 0 && (
          <div className="mt-4 space-y-2 rounded-xl border border-gray-200 bg-white p-3">
            <ColorTabRow label="Brand" options={brandOptions} active={brandFilter} onSelect={setBrandFilter} allCount={allQueue.length} />
            <ColorTabRow label="Channel" options={channelOptions} active={channelFilter} onSelect={setChannelFilter} allCount={allQueue.length} />
            <ColorTabRow label="Team" options={teamOptions} active={teamFilter} onSelect={setTeamFilter} allCount={allQueue.length} />
            <ColorTabRow label="Type" options={typeOptions} active={typeFilter} onSelect={setTypeFilter} allCount={allQueue.length} />
          </div>
        )}
        {isLoading && <p className="mt-4 text-sm text-gray-500">Loading the queue…</p>}
        {!isLoading && queue.length === 0 && (
          <p className="mt-4 text-sm text-gray-500">
            {made.length > 0 ? (
              <>
                No copy is waiting on you — but {made.length} finished piece{made.length === 1 ? " is" : "s are"}{" "}
                <Link to="/admin/brand-board" className="font-semibold text-blue-600 hover:underline">on the Brand Board</Link>{" "}
                for approval or edits.
              </>
            ) : (
              <>
                Nothing is waiting for your approval. Hit "Plan this week" (top right) to fill this week's
                schedule with fresh drafts, or create something in Content Studio / Composer — it lands here.
              </>
            )}
          </p>
        )}

        {/* HANDED OVER — made pieces, stated not hidden.
            Routing them away silently would read as "the Director lost my
            content", which is the same failure as an empty view that explains
            nothing. Each one shows its poster and links straight to its card on
            the board, so the handoff lands on the PIECE. */}
        {!isLoading && made.length > 0 && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                ✅ Already made — {made.length} piece{made.length === 1 ? "" : "s"}
              </span>
              <span className="text-[11px] text-emerald-800/70">
                Approved and edited on the Brand Board, where you can see them full size.
              </span>
              <Link
                to="/admin/brand-board"
                className="ml-auto rounded-md bg-gradient-to-r from-[#3b82f6] to-[#ec4899] px-2.5 py-1 text-[11px] font-bold text-white hover:opacity-90"
              >
                Open Brand Board →
              </Link>
            </div>
            <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1">
              {made.map((item) => (
                <Link
                  key={item.id}
                  to={brandBoardLinkFor(item)}
                  title={item.caption || item.campaign_name || "Open on the Brand Board"}
                  className="group w-24 shrink-0"
                >
                  <img
                    src={posterFor(item) || ""}
                    alt=""
                    className="aspect-square w-24 rounded-lg border border-emerald-200 bg-white object-contain group-hover:border-pink-400"
                  />
                  <div className="mt-1 truncate text-[10px] font-semibold text-gray-600">
                    {brandMeta(item.brand).label}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {queue.map((item) => (
            <div
              key={item.id}
              id={`post-${item.id}`}
              ref={item.id === focusPostId ? focusRef : undefined}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm",
                item.id === focusPostId ? "border-blue-500 ring-2 ring-blue-400 ring-offset-2" : "border-gray-200",
              )}
              style={item.id === focusPostId ? undefined : { borderColor: `${brandMeta(item.brand).color}55` }}
            >
              {/* Brand band — same hard color coding as the Shot List cards */}
              <div className="flex items-center gap-1.5 px-2.5 py-1" style={{ backgroundColor: brandMeta(item.brand).color }}>
                <span className="truncate text-[10px] font-extrabold uppercase tracking-wide text-white">{brandMeta(item.brand).label}</span>
                <span className="shrink-0 rounded bg-white/20 px-1.5 text-[9px] font-bold text-white">
                  {channelMeta(item.kind === "email_campaign" ? "email" : item.platform).label}
                </span>
                {item.post_type && <span className="shrink-0 rounded bg-white/20 px-1.5 text-[9px] font-bold text-white">{item.post_type}</span>}
                {item.created_by && (
                  <span className="ml-auto mr-6 hidden truncate text-[9px] font-semibold text-white/80 sm:inline">{teamFor(item.created_by).label}</span>
                )}
              </div>
              <button
                onClick={() => {
                  if (window.confirm("Delete this card? This can't be undone.")) deleteItem.mutate(item);
                }}
                disabled={deleteItem.isPending}
                title="Delete this card"
                className="absolute right-1.5 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/30 text-white hover:bg-rose-600"
              >
                <X className="h-3 w-3" />
              </button>
              {item.media_urls?.[0] && (
                /\.(mp4|mov)(\?|$)/i.test(item.media_urls[0]) ? (
                  // `#t=0.5` is a media fragment: the browser paints the frame
                  // at half a second instead of frame zero. Every cut opens on
                  // a dark frame — the BTI treatment used to bake a black title
                  // card, and even without it frame zero is a fade-in — so an
                  // unpostered <video> renders a black rectangle and the card
                  // looks empty until you press play. Reviewing content you
                  // cannot see is not reviewing.
                  //
                  // The frame is a SQUARE and the media is `object-contain`.
                  // It used to be a short wide box (`h-40`) with `object-cover`,
                  // which cropped a 9:16 reel down to a letterbox slice of its
                  // middle — the reviewer saw a stretched-looking strip instead
                  // of the post. Contain never crops and never distorts; the
                  // unused area is just the card's own background.
                  <video
                    src={`${item.media_urls[0]}#t=0.5`}
                    poster={item.thumbnail_url || undefined}
                    controls
                    playsInline
                    preload="metadata"
                    className="aspect-square w-full bg-slate-900 object-contain"
                  />
                ) : (
                  <img src={item.media_urls[0]} alt="" className="aspect-square w-full bg-gray-100 object-contain" />
                )
              )}
              <div className="flex flex-1 flex-col p-3">
                {item.kind === "email_campaign" ? (
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{item.campaign_name}</div>
                    <div className="mt-1 text-sm text-gray-600">{item.subject_line}</div>
                    {item.preview_text && <div className="mt-1 text-xs text-gray-500">{item.preview_text}</div>}
                  </div>
                ) : (
                  <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-[13px] leading-snug text-gray-700">
                    {fixedCaptions[item.id] ?? item.caption}
                  </p>
                )}
                {!!item.hashtags?.length && (
                  <p className="mt-1.5 truncate text-[11px] text-gray-400" title={item.hashtags.join(" ")}>{item.hashtags.join(" ")}</p>
                )}
                <div className="mt-3 text-xs font-semibold text-gray-500">
                  {item.scheduled_date && new Date(item.scheduled_date) > new Date()
                    ? <>Slot: {fmtWhen(item.scheduled_date)}</>
                    : item.proposed_slot
                      ? <>Next slot: {item.proposed_slot.label} → {fmtWhen(item.proposed_slot.when)}</>
                      : item.kind === "email_campaign"
                        ? <>Pushes to Klaviyo as a draft on approval</>
                        : <>No programming slot — publishes within 5 minutes of approval</>}
                </div>
                {item.kind === "social_post" && (
                  <VideoEditTicketEditor
                    item={{ id: item.id, brand: item.brand, generation_meta: item.generation_meta }}
                    initiallyOpen={item.id === focusPostId}
                    onSaved={() => qc.invalidateQueries({ queryKey: ["content-director-queue"] })}
                  />
                )}
                {/* COMPOSING — work in flight, said plainly. This card used to
                    look exactly like an untouched one while its render was
                    running, so the obvious move was to press the button again
                    and spend a second render for the same file. */}
                {item.kind === "social_post" && !editTicketFromGenerationMeta(item.generation_meta) && !item.media_urls?.[0] && item.building && (
                  <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2">
                    <Clock className="h-4 w-4 shrink-0 animate-pulse text-blue-600" />
                    <div className="text-[11px] leading-snug text-blue-900">
                      <span className="font-semibold">Composing the creative…</span>{" "}
                      It attaches itself when the render finishes — usually within five minutes.
                      {item.building.since && (
                        <> Started {fmtWhen(item.building.since)}.</>
                      )}
                    </div>
                  </div>
                )}
                {/* ANGLES PER CHANNEL — read the angle, then source or upload.
                    Shown on every social card, with or without media, because
                    the angle is a decision about the IDEA and does not depend
                    on whether a clip is attached yet. */}
                {item.kind === "social_post" && !editTicketFromGenerationMeta(item.generation_meta) && (
                  <div className="mt-2.5">
                    <ChannelAngleCard
                      idea={fixedCaptions[item.id] ?? item.caption ?? ""}
                      brand={item.brand}
                      onFootageChosen={(_c, url) => attachUrl.mutate({ item, url })}
                      onUploadRequested={() => toast("Use “📎 Upload creative” below to attach your own file.")}
                    />
                  </div>
                )}
                {item.kind === "social_post" && !editTicketFromGenerationMeta(item.generation_meta) && !item.media_urls?.[0] && !item.building && (
                  <div className="mt-2.5 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        size="sm"
                        className="h-7 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-xs text-white hover:opacity-90"
                        disabled={makeCreative.isPending}
                        onClick={() => makeCreative.mutate(item)}
                        title="Compose the actual post image from this copy + real footage/photos in the Asset Library"
                      >
                        {creativeFor === item.id ? "Building…" : "⚡ Make the creative"}
                      </Button>
                      {/* …or the creative already exists on this device — attach it directly */}
                      <label className="inline-flex h-7 cursor-pointer items-center rounded-md border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700 hover:border-pink-400">
                        {attachMedia.isPending ? "Uploading…" : "📎 Upload creative"}
                        <input type="file" accept="image/*,video/*" className="hidden" disabled={attachMedia.isPending}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) attachMedia.mutate({ item, file: f });
                            e.currentTarget.value = "";
                          }} />
                      </label>
                      <span className="w-full text-[10px] text-gray-500">
                        Copy only — build the asset with AI, or upload the finished creative.
                      </span>
                    </div>
                    {creativeInfo[item.id] && !creativeInfo[item.id].ok && (
                      <p className="mt-1.5 text-[11px] text-amber-700">{creativeInfo[item.id].refusedBecause}</p>
                    )}
                  </div>
                )}
                {creativeInfo[item.id]?.usedAssets?.length ? (
                  <p className="mt-2 text-[11px] text-gray-400">
                    Built from: {creativeInfo[item.id].usedAssets.map((a) => a.title).join(" · ")}
                  </p>
                ) : null}
                {/* Refine the copy without leaving the board. */}
                {item.kind === "social_post" && !editTicketFromGenerationMeta(item.generation_meta) && (
                  fixFor === item.id ? (
                    <div className="mt-3 flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={fixText}
                        onChange={(e) => setFixText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && fixText.trim() && !fixCopy.isPending) {
                            fixCopy.mutate({ item, instruction: fixText.trim() });
                          }
                          if (e.key === "Escape") { setFixFor(null); setFixText(""); }
                        }}
                        placeholder='What should change? e.g. "punchier hook, add a CTA"'
                        className="h-8 flex-1 rounded-md border border-gray-300 px-2 text-xs text-gray-900 outline-none focus:border-pink-400"
                      />
                      <Button
                        size="sm"
                        className="h-8 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-xs text-white"
                        disabled={fixCopy.isPending || !fixText.trim()}
                        onClick={() => fixCopy.mutate({ item, instruction: fixText.trim() })}
                      >
                        {fixCopy.isPending ? "Fixing…" : "Fix"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs"
                        onClick={() => { setFixFor(null); setFixText(""); }}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setFixFor(item.id); setFixText(""); }}
                      className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                    >
                      ✏️ Fix with AI
                    </button>
                  )
                )}
                {!editTicketFromGenerationMeta(item.generation_meta) && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    className="bg-gray-900 text-white hover:bg-gray-800"
                    disabled={approve.isPending}
                    onClick={() => approve.mutate(item)}
                  >
                    Approve →
                  </Button>
                  <Button size="sm" variant="outline" disabled={reject.isPending} onClick={() => reject.mutate(item)}>
                    Reject
                  </Button>
                  {item.kind === "social_post" && (
                    <input
                      type="datetime-local"
                      value={customWhen[item.id] || ""}
                      onChange={(e) => setCustomWhen((s) => ({ ...s, [item.id]: e.target.value }))}
                      className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600"
                      title="Optional: override the slot with a custom publish time"
                    />
                  )}
                </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* What's scheduled */}
        <h2 className="mt-12 text-lg font-bold text-gray-900">2 · Going out automatically</h2>
        <p className="mt-1 text-sm text-gray-500">
          Already approved — each one publishes itself at the time shown. Nothing left for you to do here.
        </p>
        <div className="mt-2 h-px bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
        {scheduled.length === 0 && <p className="mt-4 text-sm text-gray-500">Nothing scheduled yet — approve a card above and it moves down here.</p>}
        <div className="mt-4 space-y-2">
          {scheduled.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm shadow-sm">
              <div className="flex min-w-0 items-center gap-2">
                <Chip tone="blue">{BRAND_LABEL[p.brand] || p.brand}</Chip>
                <Chip tone="pink">{PLATFORM_LABEL[p.platform || ""] || p.platform}</Chip>
                <span className="truncate text-gray-700">{p.caption}</span>
              </div>
              <span className="shrink-0 font-semibold text-gray-500">{fmtWhen(p.scheduled_date)}</span>
            </div>
          ))}
        </div>

        {/* The programming grid */}
        <h2 className="mt-12 text-lg font-bold text-gray-900">3 · The standing weekly schedule</h2>
        <p className="mt-1 text-sm text-gray-500">
          The recurring slots every week runs on. "Plan this week" drafts one post per open slot, and
          approving a card assigns it the next open slot from this list.
        </p>
        <div className="mt-2 h-px bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(data?.programming ?? []).map((s) => (
            <div key={s.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 shadow-sm">
              {s.label}
            </div>
          ))}
        </div>
        </>
        )}
      </div>
    </div>
  );
}
