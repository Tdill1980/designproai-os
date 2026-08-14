/**
 * AutonomousBuildPanel — Content Studio builds what the Content Director asked for.
 *
 * The Director's queue fills with caption-only drafts ("Plan this week", hook
 * drops, ad copy). Each one then needs a human to open Content Studio, pick a
 * template, generate, export, and attach the image — per post. This panel does
 * that loop unattended.
 *
 * Deliberate boundaries, because this runs without a human watching:
 *  1. IT NEVER PUBLISHES. It only attaches artwork to an existing draft. The
 *     Director remains the one approval gate (approve = scheduled = published).
 *  2. REAL TEMPLATES ONLY. Every build starts from a template already in the
 *     brand's library (wrap-files/canva-templates/{brand}/{type}). A brand with
 *     no template for that format is SKIPPED with the reason shown — it never
 *     invents a layout to fill the gap.
 *  3. BOUNDED. It processes a capped batch, one at a time, and stops on demand.
 *     Every AI bake costs credits, so an unbounded loop is not an option.
 *  4. HONEST PER-ITEM STATUS. Built / skipped / failed with the actual reason,
 *     never a silent pass.
 *
 * The bake itself reuses the exact producer the manual flow uses —
 * `content-studio-ai-copy` in `rewrite_template_image` mode, which returns a
 * finished PNG — so autonomous output is the same artifact as hand-driven
 * output, not a second pipeline.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Bot, Square, RefreshCw, ExternalLink, CheckCircle2, AlertTriangle, SkipForward } from "lucide-react";
import { Link } from "react-router-dom";

/** Director post slug → the brand's template-library folder name. */
const BRAND_FOLDER: Record<string, string> = {
  restylepro: "DesignProAI",
  weprintwraps: "WePrintWraps",
  designproai: "DesignProAI",
  wraptvworld: "WrapTV",
  wraptv: "WrapTV",
  inkandedge: "InkAndEdge",
};

/** Template content-type → Gemini output aspect (the editor defaults to 16:9 without it). */
const TEMPLATE_ASPECT: Record<string, string> = {
  "static-4x5": "4:5", carousel: "1:1", "static-1x1": "1:1",
  story: "9:16", reel: "9:16", "static-9x16": "9:16", "static-16x9": "16:9",
};

/**
 * A post's format → the template types to try, in order. First folder with a
 * template wins; an empty ladder is an honest skip, not a fallback guess.
 */
function templateLadder(post: QueuePost): { types: string[]; format: string } {
  const pt = (post.post_type || "").toLowerCase();
  const platform = (post.platform || "").toLowerCase();
  // The shape can live in EITHER column: the Director's own drafts put it in
  // post_type ("reel"), while the agent's hook/theme drafts put the theme in
  // post_type ("fomo", "premium") and the shape in platform ("reel", "story",
  // "carousel"). Checking only post_type sent those to the static ladder and
  // rendered a 9:16 story as a 4:5 square. Read both.
  const shape = `${pt} ${platform}`;
  if (/\breel\b/.test(shape)) return { types: ["reel", "static-9x16", "story"], format: "Reel" };
  if (/\bstory\b/.test(shape)) return { types: ["story", "static-9x16", "reel"], format: "Story" };
  if (/\bcarousel\b/.test(shape)) return { types: ["carousel", "static-1x1", "static-4x5"], format: "Carousel" };
  if (platform === "x" || platform === "twitter") return { types: ["static-16x9", "static-1x1"], format: "Post" };
  if (platform === "linkedin") return { types: ["static-1x1", "static-4x5"], format: "Post" };
  return { types: ["static-4x5", "static-1x1"], format: "Post" };
}

export interface QueuePost {
  id: string;
  brand: string | null;
  platform: string | null;
  post_type: string | null;
  caption: string | null;
  media_urls: string[] | null;
  created_at: string | null;
  generation_meta?: Record<string, unknown> | null;
}

type Outcome = "pending" | "building" | "built" | "skipped" | "failed";
interface RowState {
  outcome: Outcome;
  detail?: string;
  url?: string;
}

const TONES = ["Hype/Launch", "Educational", "Social Proof", "Behind The Scenes", "Promo/Sale"];

export default function AutonomousBuildPanel() {
  const [queue, setQueue] = useState<QueuePost[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<Record<string, RowState>>({});
  const [tone, setTone] = useState(TONES[0]);
  const [maxItems, setMaxItems] = useState(5);
  const stopRef = useRef(false);

  /** The Director's asks: drafts that have copy but no artwork yet. */
  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("agent_social_posts")
        // `*`, not a column list: `generation_meta` is a late addition and
        // naming a column PostgREST doesn't have fails the WHOLE query, so a
        // deploy that lands ahead of its migration would blank the queue.
        .select("*")
        .eq("status", "draft")
        .order("created_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      const needsArt = ((data || []) as QueuePost[]).filter(
        (p) => !(p.media_urls || []).filter(Boolean).length && (p.caption || "").trim(),
      );
      setQueue(needsArt);
    } catch (e: unknown) {
      toast.error("Couldn't load the Director queue: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  /** First template found for this brand across the format's type ladder. */
  const pickTemplate = async (
    brandFolder: string, types: string[],
  ): Promise<{ url: string; type: string } | null> => {
    for (const type of types) {
      const folder = `canva-templates/${brandFolder}/${type}`;
      const { data } = await supabase.storage
        .from("wrap-files")
        .list(folder, { limit: 50, sortBy: { column: "created_at", order: "desc" } });
      const usable = (data || []).filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
      if (!usable.length) continue;
      // Rotate rather than always taking the newest, so a batch doesn't render
      // ten identical-looking posts off one template.
      const pick = usable[Math.floor(Math.random() * usable.length)];
      const { data: urlData } = supabase.storage
        .from("wrap-files")
        .getPublicUrl(`${folder}/${pick.name}`);
      return { url: urlData.publicUrl, type };
    }
    return null;
  };

  /** Build ONE post's artwork. Returns the outcome; never throws. */
  const buildOne = async (post: QueuePost): Promise<RowState> => {
    const brandSlug = (post.brand || "restylepro").toLowerCase();
    const brandFolder = BRAND_FOLDER[brandSlug];
    if (!brandFolder) return { outcome: "skipped", detail: `No template library for brand "${post.brand}"` };

    const { types, format } = templateLadder(post);
    const tpl = await pickTemplate(brandFolder, types);
    if (!tpl) {
      return {
        outcome: "skipped",
        detail: `No ${types.join(" / ")} template in the ${brandFolder} library — upload one in Templates`,
      };
    }

    // Same producer as the manual flow: template in, finished PNG out.
    const { data, error } = await supabase.functions.invoke("content-studio-ai-copy", {
      body: {
        imageUrl: tpl.url,
        brand: brandFolder,
        format,
        tone,
        context: post.caption || "",
        templateAspect: TEMPLATE_ASPECT[tpl.type] || "4:5",
        mode: "rewrite_template_image",
      },
    });
    if (error) {
      let reason = error.message || String(error);
      // supabase-js hides the real cause in the raw Response — read it, so a
      // failure says WHY instead of "non-2xx status code".
      try {
        const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
        if (ctx && typeof ctx.json === "function") {
          const body = await ctx.json();
          if (body?.error) reason = body.error;
        }
      } catch { /* keep the original message */ }
      return { outcome: "failed", detail: reason };
    }
    if (data?.error) return { outcome: "failed", detail: String(data.error) };
    if (!data?.editedImageBase64) {
      return { outcome: "failed", detail: data?.imageEditError || "the image editor returned no image" };
    }

    // Store the finished artwork, then attach it to the Director's draft.
    const mime = data.editedImageMimeType || "image/png";
    const bytes = Uint8Array.from(atob(data.editedImageBase64), (c) => c.charCodeAt(0));
    const path = `content-studio-deploys/autonomous-${post.id}-${Date.now()}.${mime.split("/")[1] || "png"}`;
    const { error: upErr } = await supabase.storage
      .from("wrap-files")
      .upload(path, new Blob([bytes], { type: mime }), { contentType: mime, upsert: false });
    if (upErr) return { outcome: "failed", detail: "upload failed: " + upErr.message };
    const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);

    // Provenance: this is AI-baked artwork off a real template, not a
    // human-composed design. A reviewer should know which they're seeing.
    const provenance = {
      ...(post.generation_meta || {}),
      autonomous_build: {
        at: new Date().toISOString(),
        template: tpl.url,
        template_type: tpl.type,
        brand_folder: brandFolder,
        tone,
        producer: "content-studio-ai-copy:rewrite_template_image",
      },
    };
    const table = () => (supabase as unknown as {
      from: (t: string) => {
        update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> };
      };
    }).from("agent_social_posts");

    let { error: updErr } = await table()
      .update({ media_urls: [urlData.publicUrl], generation_meta: provenance })
      .eq("id", post.id);
    // Attaching the ARTWORK is the job; provenance is a bonus. If the
    // generation_meta column isn't there yet (migration not applied), retry
    // without it rather than lose a finished build over a metadata field.
    if (updErr && /generation_meta/.test(updErr.message)) {
      ({ error: updErr } = await table()
        .update({ media_urls: [urlData.publicUrl] })
        .eq("id", post.id));
    }
    if (updErr) return { outcome: "failed", detail: "saved the image but couldn't attach it: " + updErr.message };

    return { outcome: "built", detail: `${tpl.type} template`, url: urlData.publicUrl };
  };

  const run = async () => {
    const batch = queue.slice(0, maxItems);
    if (!batch.length) { toast.info("Nothing in the Director queue needs artwork."); return; }
    stopRef.current = false;
    setRunning(true);
    let built = 0, skipped = 0, failed = 0;
    for (const post of batch) {
      if (stopRef.current) break;
      setState((s) => ({ ...s, [post.id]: { outcome: "building" } }));
      const result = await buildOne(post);
      setState((s) => ({ ...s, [post.id]: result }));
      if (result.outcome === "built") built++;
      else if (result.outcome === "skipped") skipped++;
      else failed++;
    }
    setRunning(false);
    const parts = [`${built} built`];
    if (skipped) parts.push(`${skipped} skipped`);
    if (failed) parts.push(`${failed} failed`);
    if (built) {
      toast.success(`${parts.join(" · ")} — review and approve them in the Content Director.`);
    } else {
      toast.error(`${parts.join(" · ")} — nothing was attached. See the reasons below.`);
    }
    loadQueue();
  };

  const icon = (o: Outcome) =>
    o === "built" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
      : o === "skipped" ? <SkipForward className="h-3.5 w-3.5 text-amber-600" />
      : o === "failed" ? <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
      : o === "building" ? <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-600" />
      : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-blue-600" />
            <span className="text-sm font-bold text-gray-900">Autonomous mode</span>
          </div>
          <p className="mt-1 max-w-xl text-[13px] leading-snug text-gray-600">
            Builds the artwork the{" "}
            <Link to="/admin/content-director" className="font-semibold text-blue-600 hover:underline">
              Content Director
            </Link>{" "}
            asked for. It takes each caption-only draft, lays it onto one of that brand's real
            templates, and attaches the finished image to the draft.{" "}
            <span className="font-semibold text-gray-900">Nothing publishes</span> — you still
            approve every post in the Director.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={loadQueue} disabled={loading || running}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/70 p-2.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Tone</span>
        <select
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          disabled={running}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900"
        >
          {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="ml-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">Build at most</span>
        <select
          value={maxItems}
          onChange={(e) => setMaxItems(Number(e.target.value))}
          disabled={running}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900"
        >
          {[1, 3, 5, 10, 20].map((n) => <option key={n} value={n}>{n} post{n === 1 ? "" : "s"}</option>)}
        </select>
        <span className="text-[11px] text-gray-500">each build uses AI credits</span>

        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <Button
              size="sm"
              variant="outline"
              className="border-red-200 text-red-600 hover:bg-red-50"
              onClick={() => { stopRef.current = true; toast.info("Stopping after the current post…"); }}
            >
              <Square className="mr-1.5 h-3.5 w-3.5" /> Stop
            </Button>
          ) : (
            <Button
              size="sm"
              className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] font-bold text-white hover:opacity-90"
              onClick={run}
              disabled={loading || !queue.length}
            >
              <Bot className="mr-1.5 h-3.5 w-3.5" />
              Build {Math.min(maxItems, queue.length)} from the Director
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3">
        {loading ? (
          <p className="text-xs text-gray-500">Reading the Director queue…</p>
        ) : !queue.length ? (
          <p className="text-xs text-gray-500">
            Every draft in the Director already has artwork. New asks appear here after
            “Plan this week” runs in the Director.
          </p>
        ) : (
          <>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">
              {queue.length} draft{queue.length === 1 ? "" : "s"} waiting on artwork
            </p>
            <div className="space-y-1.5">
              {queue.slice(0, Math.max(maxItems, 5)).map((p) => {
                const st = state[p.id];
                return (
                  <div key={p.id} className="flex items-start gap-2 rounded-lg border border-gray-100 bg-white px-2.5 py-2">
                    <span className="mt-0.5 shrink-0">{icon(st?.outcome || "pending")}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                          {p.brand || "unknown brand"}
                        </span>
                        {p.post_type && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">{p.post_type}</span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-gray-700">{p.caption}</p>
                      {st?.detail && (
                        <p className={`mt-1 text-[11px] ${
                          st.outcome === "built" ? "text-emerald-700"
                            : st.outcome === "skipped" ? "text-amber-700" : "text-red-600"
                        }`}>
                          {st.detail}
                        </p>
                      )}
                    </div>
                    {st?.url && (
                      <a href={st.url} target="_blank" rel="noreferrer" className="shrink-0">
                        <img src={st.url} alt="" className="h-12 w-12 rounded object-cover" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <Link
        to="/admin/content-director"
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline"
      >
        Review and approve in the Content Director <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}
