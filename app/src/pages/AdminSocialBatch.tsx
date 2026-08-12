/**
 * AdminSocialBatch — turn-key 20-at-a-time social post generator.
 *
 * Picks a template from social_templates + a tool focus + a hook type +
 * 20 tagged renders, then for each render:
 *   1. Renders the Konva canvas with that render slotted in → PNG
 *   2. Calls content-studio-ai-copy for AI hook/headline/body/cta
 *   3. Uploads PNG to storage
 *   4. Inserts an agent_social_posts row (Content Calendar entry)
 *
 * After the batch finishes:
 *   - Inserts ONE slack_agent_tasks row (Engine Room "review" card)
 *     with the full batch attached as metadata
 *   - Builds a downloadable .zip of all 20 PNGs
 *   - Links to /admin/content-calendar and /engine-room
 *
 * Render source: marketplace_listings filtered by tag (preferred), or
 * color_visualizations filtered by tool_source + vehicle as fallback.
 */
import { useState, useMemo, useRef, useEffect } from "react";
import { Stage, Layer, Rect, Text, Image as KonvaImage } from "react-konva";
import Konva from "konva";
import JSZip from "jszip";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Download, Calendar, ListChecks, ImagePlus, Loader2 } from "lucide-react";

// ── Constants (mirror AdminContentStudio + content-hook-recipes) ──────
// Restricted to the tools that actually populate color_visualizations.tool_source
// today (ColorPro + MyVehiclePro). Adding DesignProAI / GraphicsPro / FadeWraps
// / PatternPro / RevisionStudioIQ requires a follow-up PR that either:
//   1) Backfills tool_source on existing rows AND patches their edge functions
//      to set it on new inserts, OR
//   2) Adds a per-tool render-source map (e.g. PatternPro → wbty_orders)
// Without one of those, those tools would pull random color_visualizations
// rows because the query has no way to filter — that ships visually wrong
// posts to the calendar, which is worse than not offering the tool yet.
const TOOL_OPTIONS = [
  { value: "ColorPro", label: "ColorPro™" },
  { value: "MyVehiclePro", label: "MyVehiclePro™" },
];
const HOOK_TYPE_OPTIONS = [
  { value: "pain_aware", label: "Pain-Aware (default)" },
  { value: "education_first", label: "Education-First" },
  { value: "us_vs_them", label: "Us vs Them" },
  { value: "feature_callout", label: "Feature Callout" },
];

// ── Types ─────────────────────────────────────────────────────────────
type CanvasElement = {
  id: string;
  type: "rect" | "text" | "image";
  x: number; y: number; width: number; height: number;
  fill?: string;
  opacity?: number;
  cornerRadius?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontStyle?: string;
  align?: string;
  verticalAlign?: string;
  imageSrc?: string;
  slot?: string;
  alt?: string;
};

type SocialTemplate = {
  id: string;
  name: string;
  description: string | null;
  brand: string;
  format: string;
  width: number;
  height: number;
  hook_type: string;
  tools: string[];
  slot_count: number;
  background_color: string;
  thumbnail_url: string | null;
  canvas_state: { elements: CanvasElement[] };
};

type RenderRow = {
  id: string;
  url: string;          // primary render URL we'll slot into the template
  source: "marketplace" | "color_visualizations";
  vehicle: string;      // "2024 Ford F-150" etc.
  meta: Record<string, unknown>;
};

type BatchResult = {
  renderRow: RenderRow;
  pngUrl: string;
  pngBlob: Blob;
  copy: { hook: string; headline: string; body: string; cta: string };
  postId?: string;
};

type BatchStage = "configure" | "running" | "done";

// ── Helpers ───────────────────────────────────────────────────────────
function pickFirstUrl(jsonish: unknown): string | null {
  // marketplace_listings.render_urls and color_visualizations.render_urls
  // are stored as JSONB. Could be {front:"...", side:"..."} or [".."] or
  // a single string. Pick whichever arrives.
  if (!jsonish) return null;
  if (typeof jsonish === "string") return jsonish;
  if (Array.isArray(jsonish)) {
    return jsonish.find((v) => typeof v === "string") || null;
  }
  if (typeof jsonish === "object") {
    const obj = jsonish as Record<string, unknown>;
    // Prefer 'front' / 'driver_side' / 'hero', else first string value
    const preferred = ["front", "driver_side", "hero", "primary", "main"];
    for (const k of preferred) {
      if (typeof obj[k] === "string") return obj[k] as string;
    }
    for (const v of Object.values(obj)) {
      if (typeof v === "string") return v;
    }
  }
  return null;
}

// Eager font preload — Google Fonts uses font-display:swap which lets the
// page paint before fonts arrive. document.fonts.ready only resolves
// once *triggered* loads finish. Force-load every brand font weight so
// the off-screen Konva renders inside the batch loop don't capture
// Arial/serif fallback. Same fix as AdminContentStudio (PR 2).
const BRAND_FONTS = ["Poppins", "Oswald", "Inter", "Montserrat", "Bebas Neue"];

async function ensureFontsLoaded(): Promise<void> {
  if (typeof document === "undefined" || !(document as any).fonts) return;
  const fonts = (document as any).fonts;
  await Promise.allSettled(
    BRAND_FONTS.flatMap((f) => [
      fonts.load(`400 16px "${f}"`),
      fonts.load(`700 16px "${f}"`),
    ]),
  );
  await fonts.ready;
}

// Load an image and resolve once it's actually painted-in.
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

// Map AI copy fields to template text-slot names. The edge function returns
// {hook, headline, body, cta}; templates carry {headline, subhead, body, cta}
// where headline = hook (the scroll-stopper) and subhead = supporting line.
function applyTextSlots(
  elements: CanvasElement[],
  copy: { hook: string; headline: string; body: string; cta: string },
): CanvasElement[] {
  const map: Record<string, string> = {
    headline: copy.hook,
    subhead: copy.headline,
    body: copy.body,
    cta: copy.cta,
  };
  return elements.map((el) => {
    if (el.type !== "text" || !el.slot) return el;
    const replacement = map[el.slot];
    return replacement && replacement.trim() ? { ...el, text: replacement } : el;
  });
}

// How many distinct render slots does this template have? (counts unique
// slot=render-N image elements). Defaults to 1 if no slots exist.
function getSlotCount(elements: CanvasElement[]): number {
  const slots = new Set<string>();
  for (const el of elements) {
    if (el.type === "image" && el.slot) slots.add(el.slot);
  }
  return Math.max(1, slots.size);
}

// ── Page ──────────────────────────────────────────────────────────────
export default function AdminSocialBatch() {
  const [stage, setStage] = useState<BatchStage>("configure");

  // Configure state
  const [templates, setTemplates] = useState<SocialTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [tool, setTool] = useState<string>("ColorPro");
  const [hookType, setHookType] = useState<string>("pain_aware");
  const [count, setCount] = useState<number>(20);
  const [scheduleStartDate, setScheduleStartDate] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [cadenceDays, setCadenceDays] = useState<number>(1);
  const [tagFilter, setTagFilter] = useState<string>("");

  // Running state
  const [renderQueue, setRenderQueue] = useState<RenderRow[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const [engineRoomCardId, setEngineRoomCardId] = useState<string | null>(null);

  // Off-screen Konva stage. The stage renders dynamic elements + a slot
  // map (slot id → loaded HTMLImageElement). Each batch iteration mutates
  // these so the stage shows that iteration's render+text before toDataURL.
  const stageRef = useRef<Konva.Stage | null>(null);
  const [currentElements, setCurrentElements] = useState<CanvasElement[]>([]);
  const [slotImages, setSlotImages] = useState<Record<string, HTMLImageElement>>({});

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) || null,
    [templates, templateId],
  );

  // Load templates on mount
  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase as any)
        .from("social_templates")
        .select("id,name,description,brand,format,width,height,hook_type,tools,slot_count,background_color,thumbnail_url,canvas_state")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) {
        toast.error(`Failed to load templates: ${error.message}`);
        return;
      }
      setTemplates((data || []) as SocialTemplate[]);
    })();
  }, []);

  // Auto-pick first matching template when tool/hookType changes
  useEffect(() => {
    if (!templateId && templates.length > 0) {
      const match = templates.find(
        (t) => t.tools.includes(tool) && t.hook_type === hookType,
      ) || templates[0];
      setTemplateId(match.id);
    }
  }, [templates, tool, hookType, templateId]);

  // Eager-load fonts once on mount
  useEffect(() => {
    ensureFontsLoaded().catch(() => { /* non-fatal */ });
  }, []);

  // Initialise the stage with the template's default elements as soon as
  // a template is selected so the off-screen Konva tree is mounted before
  // the run loop starts (required for stageRef to be non-null).
  useEffect(() => {
    if (!selectedTemplate) { setCurrentElements([]); return; }
    setCurrentElements(selectedTemplate.canvas_state?.elements || []);
  }, [selectedTemplate]);

  // ── Fetch tagged renders for the batch ─────────────────────────────
  async function fetchRenders(targetCount: number): Promise<RenderRow[]> {
    const tagsToTry = tagFilter.trim()
      ? tagFilter.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    // 1) marketplace_listings — filter by tags overlap, else fall through
    const out: RenderRow[] = [];
    if (tagsToTry.length > 0) {
      const { data } = await (supabase as any)
        .from("marketplace_listings")
        .select("id,title,render_urls,vehicle_make,vehicle_model,vehicle_year,tags")
        .overlaps("tags", tagsToTry)
        .limit(targetCount);
      for (const row of data || []) {
        const url = pickFirstUrl(row.render_urls);
        if (!url) continue;
        out.push({
          id: row.id,
          url,
          source: "marketplace",
          vehicle: [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean).join(" "),
          meta: { title: row.title, tags: row.tags },
        });
        if (out.length >= targetCount) break;
      }
    }

    // 2) Fall back to color_visualizations (tool-keyed) if we still need more
    if (out.length < targetCount) {
      const remaining = targetCount - out.length;
      const tableTool = tool === "ColorPro" ? "ColorPro"
        : tool === "MyVehiclePro" ? "MyVehiclePro"
        : null; // other tools don't populate tool_source on color_visualizations

      const queryCv = async (withToolFilter: boolean) => {
        let q = (supabase as any)
          .from("color_visualizations")
          .select("id,render_urls,vehicle_make,vehicle_model,vehicle_year,tool_source")
          .not("render_urls", "is", null)
          .limit(remaining);
        if (withToolFilter && tableTool) q = q.eq("tool_source", tableTool);
        const { data } = await q;
        return (data || []) as any[];
      };

      // Prefer tool-keyed renders, but the vast majority of rows have a NULL
      // tool_source, so a strict eq() filter returns nothing for ColorPro /
      // MyVehiclePro and the batch silently finds "no renders". Fall back to
      // ANY render when the tool-filtered query comes back empty.
      let rows = await queryCv(true);
      if (rows.length === 0) rows = await queryCv(false);

      for (const row of rows) {
        const url = pickFirstUrl(row.render_urls);
        if (!url) continue;
        out.push({
          id: row.id,
          url,
          source: "color_visualizations",
          vehicle: [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean).join(" "),
          meta: { tool: row.tool_source },
        });
        if (out.length >= targetCount) break;
      }
    }

    return out;
  }

  // ── Render the current Konva stage to a PNG blob ──────────────────
  async function rasterizeCurrent(): Promise<Blob> {
    if (!stageRef.current) throw new Error("Stage not mounted");
    await ensureFontsLoaded();
    // Give react-konva one more tick to commit the swapped image
    await new Promise((r) => setTimeout(r, 30));
    const dataUrl = stageRef.current.toDataURL({
      mimeType: "image/png",
      pixelRatio: 1,
    });
    const res = await fetch(dataUrl);
    return await res.blob();
  }

  // ── Upload PNG to storage and return public URL ───────────────────
  async function uploadPng(blob: Blob, name: string): Promise<string> {
    const path = `social-batch/${Date.now()}-${name}.png`;
    const { error } = await supabase.storage
      .from("wrap-files")
      .upload(path, blob, { contentType: "image/png", upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from("wrap-files").getPublicUrl(path);
    return data.publicUrl;
  }

  // ── Get AI copy for one render via the edge function ──────────────
  // Pass the *render URL* (not a finished template PNG) so Claude grounds
  // copy in the specific vehicle/color/finish. The edge function works in
  // text-only mode too (PR 1) — we still pass an image because it produces
  // sharper, vehicle-specific hooks ("Tired of explaining what TeckWrap
  // Chrome Rose Gold actually looks like?" beats generic pain copy).
  async function generateCopy(imageUrl: string | undefined, vehicleHint: string): Promise<BatchResult["copy"]> {
    const fmt = (selectedTemplate?.format || "post-4x5").startsWith("reel") ? "Reel"
      : (selectedTemplate?.format || "post-4x5").startsWith("carousel") ? "Carousel"
      : "Post";
    const ctx = [
      vehicleHint && `Vehicle: ${vehicleHint}`,
      tagFilter && `Tags: ${tagFilter}`,
    ].filter(Boolean).join(". ");

    const { data, error } = await supabase.functions.invoke("content-studio-ai-copy", {
      body: {
        imageUrl,
        brand: "RestyleProAI",
        format: fmt,
        tone: "Hype/Launch",
        focusTools: [tool],
        hookType,
        context: ctx || undefined,
      },
    });
    if (error) throw new Error(error.message || "Copy generation failed");
    if (data?.error) throw new Error(data.error);
    return {
      hook: data?.hook || "",
      headline: data?.headline || "",
      body: data?.body || "",
      cta: data?.cta || "",
    };
  }

  // ── Insert calendar entry (agent_social_posts) ────────────────────
  async function insertCalendarPost(
    pngUrl: string,
    copy: BatchResult["copy"],
    scheduledDate: string,
  ): Promise<string | undefined> {
    const caption = [copy.hook, copy.body, copy.cta].filter(Boolean).join("\n\n");
    const { data, error } = await (supabase as any)
      .from("agent_social_posts")
      .insert({
        brand: "restylepro",
        platform: "instagram",
        post_type: "feed",
        // Content Director is the gate: batch posts queue for approval with
        // their proposed slot in scheduled_date. Approve = scheduled = published.
        status: "needs_review",
        scheduled_date: scheduledDate,
        caption,
        media_urls: [pngUrl],
        hashtags: ["#restyleproai", "#vehiclewrap", `#${tool.toLowerCase()}`],
      })
      .select("id")
      .single();
    if (error) {
      console.error("[social-batch] calendar insert failed:", error);
      return undefined;
    }
    return data?.id as string;
  }

  // ── Insert Engine Room batch card (slack_agent_tasks) ─────────────
  async function insertEngineRoomCard(allResults: BatchResult[]): Promise<string | null> {
    const tpl = selectedTemplate;
    const { data, error } = await (supabase as any)
      .from("slack_agent_tasks")
      .insert({
        brand: "restylepro",
        title: `Batch: ${allResults.length} ${tool} ${hookType.replace("_", "-")} posts`,
        task_type: "social_post",
        status: "review",
        priority: "high",
        assigned_to: "trish",
        description: `Generated ${allResults.length} cream/white/black ${hookType} posts using template "${tpl?.name}". Proposed slots across ${cadenceDays === 1 ? "consecutive days" : `every ${cadenceDays} days`} starting ${scheduleStartDate} — awaiting Content Director approval before anything publishes.`,
        due_date: scheduleStartDate ? new Date(scheduleStartDate + "T10:00:00Z").toISOString() : null,
        metadata: {
          template_id: tpl?.id,
          template_name: tpl?.name,
          tool,
          hook_type: hookType,
          schedule_start_date: scheduleStartDate,
          cadence_days: cadenceDays,
          post_ids: allResults.map((r) => r.postId).filter(Boolean),
          png_urls: allResults.map((r) => r.pngUrl),
          thumbnail_url: allResults[0]?.pngUrl || null,
        },
      })
      .select("id")
      .single();
    if (error) {
      console.error("[social-batch] engine room card insert failed:", error);
      return null;
    }
    return data?.id as string;
  }

  // ── Build a zip from all the PNG blobs ────────────────────────────
  async function buildZip(allResults: BatchResult[]): Promise<string> {
    const zip = new JSZip();
    allResults.forEach((r, i) => {
      const safeName = `${String(i + 1).padStart(2, "0")}-${tool}-${hookType}.png`;
      zip.file(safeName, r.pngBlob);
    });
    const blob = await zip.generateAsync({ type: "blob" });
    return URL.createObjectURL(blob);
  }

  // ── Run the full batch ────────────────────────────────────────────
  // Per-item flow:
  //   1. Generate AI copy from the render image (vehicle-specific)
  //   2. Apply text slots → currentElements (AI text on image)
  //   3. Load slot images (one per render-N image element)
  //   4. Wait for fonts + state commit + image paint
  //   5. Rasterize → upload → calendar entry
  //
  // Multi-slot templates: a single batch item consumes slot_count renders.
  // We fetch count × slot_count renders up front and assign them to slots
  // by index — item i, slot k uses queue[i*slotCount + k].
  async function runBatch() {
    if (!selectedTemplate) {
      toast.error("Pick a template first");
      return;
    }
    setStage("running");
    setResults([]);
    setZipUrl(null);
    setEngineRoomCardId(null);

    const baseElements = selectedTemplate.canvas_state?.elements || [];
    const slotCount = getSlotCount(baseElements);
    const slotIds: string[] = baseElements
      .filter((el) => el.type === "image" && el.slot)
      .map((el) => el.slot as string);

    // 1) Fetch tagged renders — count × slotCount because each item
    // consumes slotCount distinct renders (e.g. before/after).
    const targetCount = count * slotCount;
    const queue = await fetchRenders(targetCount);
    if (queue.length === 0) {
      toast.error("No matching renders found. Loosen the tag filter or try a different tool.");
      setStage("configure");
      return;
    }
    setRenderQueue(queue);
    const itemsPossible = Math.floor(queue.length / slotCount);
    if (itemsPossible < count) {
      toast.warning(`Only ${itemsPossible} ${slotCount > 1 ? `× ${slotCount}-slot ` : ""}renders matched — generating ${itemsPossible}.`);
    }
    const itemsToRun = Math.min(count, itemsPossible);

    // 2) Loop
    const batchResults: BatchResult[] = [];
    const startDate = new Date(scheduleStartDate + "T10:00:00Z");

    for (let i = 0; i < itemsToRun; i++) {
      setCurrentIndex(i);
      // Each item gets slotCount renders; the first one is the "lead"
      // render shown in slot-1 and used for AI vision context.
      const itemRenders = queue.slice(i * slotCount, i * slotCount + slotCount);
      const leadRender = itemRenders[0];

      try {
        // 2a) AI copy first (uses lead render image for context)
        let copy: BatchResult["copy"];
        try {
          copy = await generateCopy(leadRender.url, leadRender.vehicle);
        } catch (err: any) {
          console.warn("[social-batch] copy failed for item", i, err?.message);
          copy = { hook: "", headline: "", body: `${selectedTemplate.name} — ${leadRender.vehicle}`, cta: "Try it free" };
        }

        // 2b) Inject AI copy into text slots → dynamic elements
        const dynamicElements = applyTextSlots(baseElements, copy);
        setCurrentElements(dynamicElements);

        // 2c) Load slot images in parallel
        const newSlotImages: Record<string, HTMLImageElement> = {};
        await Promise.all(
          slotIds.map(async (slotId, k) => {
            const url = (itemRenders[k] || leadRender).url;
            try { newSlotImages[slotId] = await loadImage(url); } catch (_) { /* skip — slot stays empty */ }
          }),
        );
        setSlotImages(newSlotImages);

        // 2d) Wait for React commit + Konva repaint + fonts
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => setTimeout(r, 200));
        await ensureFontsLoaded();
        // Stage must be mounted by now (template has been selected for at
        // least one render cycle); poll patiently if not. A single slow item
        // (React commit / ref re-attach after a state update) must not fail the
        // whole batch, so wait generously and force a repaint each tick.
        let waited = 0;
        while (!stageRef.current && waited < 8000) {
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          await new Promise((r) => setTimeout(r, 50)); waited += 50;
        }
        if (!stageRef.current) throw new Error("Konva stage not ready (mount timed out)");

        // 2e) Rasterize
        const pngBlob = await rasterizeCurrent();
        const pngUrl = await uploadPng(pngBlob, `${selectedTemplate.id}-${i + 1}`);

        // 2f) Calendar entry
        const scheduledDate = new Date(startDate);
        scheduledDate.setDate(scheduledDate.getDate() + i * cadenceDays);
        const postId = await insertCalendarPost(pngUrl, copy, scheduledDate.toISOString().slice(0, 10));

        const result: BatchResult = { renderRow: leadRender, pngUrl, pngBlob, copy, postId };
        batchResults.push(result);
        setResults((prev) => [...prev, result]);
      } catch (err: any) {
        console.error(`[social-batch] failed item ${i}:`, err);
        toast.error(`Item ${i + 1} failed: ${err?.message || "unknown"}`);
      }
    }

    // 3) Engine Room card + zip
    const cardId = await insertEngineRoomCard(batchResults);
    setEngineRoomCardId(cardId);

    if (batchResults.length > 0) {
      try {
        const url = await buildZip(batchResults);
        setZipUrl(url);
      } catch (zipErr: any) {
        console.error("[social-batch] zip failed:", zipErr);
        toast.error("Zip build failed — individual PNG URLs are still available.");
      }
    }

    // Reset stage to defaults so a re-run doesn't display the last item's text
    setCurrentElements(baseElements);
    setSlotImages({});
    setStage("done");
    toast.success(`Generated ${batchResults.length} posts.`);
  }

  // ── Render ────────────────────────────────────────────────────────
  // Use currentElements (which the run loop mutates per iteration with
  // AI copy injected into text slots). Falls back to template defaults
  // when not yet running so the operator sees a preview.
  const tpl = selectedTemplate;
  const elements = currentElements.length > 0
    ? currentElements
    : (tpl?.canvas_state?.elements || []);

  return (
    <div style={{ minHeight: "100vh", background: "#F5F5F0", padding: "24px 20px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <Link to="/admin/content-studio" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#555", textDecoration: "none", marginBottom: 16 }}>
          <ArrowLeft size={14} /> Back to Content Studio
        </Link>

        <h1 style={{ fontSize: 30, fontWeight: 800, color: "#0A0A0A", marginBottom: 6 }}>
          Social Batch — 20 at a time
        </h1>
        <p style={{ fontSize: 14, color: "#555", marginBottom: 24 }}>
          Pick a template + 20 tagged renders → batch generates publish-ready PNGs with AI copy. Each batch creates one Engine Room card and 20 scheduled Content Calendar entries.
        </p>

        {/* ── CONFIGURE ────────────────────────────────────────────── */}
        {stage === "configure" && (
          <Card style={{ padding: 24, background: "#fff", border: "1px solid #e5e5e0" }}>
            <div style={{ display: "grid", gap: 18, gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <Label>Template</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger><SelectValue placeholder="Pick a template" /></SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} — {t.format} — slots: {t.slot_count}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {tpl && (
                  <p style={{ fontSize: 12, color: "#666", marginTop: 6 }}>{tpl.description}</p>
                )}
              </div>

              <div>
                <Label>Tool</Label>
                <Select value={tool} onValueChange={setTool}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TOOL_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                  ColorPro + MyVehiclePro for now — they're the only tools whose renders are tagged by tool today. DesignProAI / FadeWraps / PatternPro coming once their renders set tool_source.
                </p>
              </div>

              <div>
                <Label>Hook</Label>
                <Select value={hookType} onValueChange={setHookType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOOK_TYPE_OPTIONS.map((h) => (
                      <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Count</Label>
                <Input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, +e.target.value || 20)))} />
              </div>

              <div>
                <Label>Tag filter (comma-separated, optional)</Label>
                <Input value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} placeholder="e.g. red, fleet, before-after" />
                <p style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                  Filters marketplace_listings.tags. Leave blank to fall back to color_visualizations by tool.
                </p>
              </div>

              <div>
                <Label>Schedule starts (first calendar entry)</Label>
                <Input type="date" value={scheduleStartDate} onChange={(e) => setScheduleStartDate(e.target.value)} />
              </div>

              <div>
                <Label>Cadence (days between posts)</Label>
                <Input type="number" min={1} max={14} value={cadenceDays} onChange={(e) => setCadenceDays(Math.max(1, +e.target.value || 1))} />
              </div>
            </div>

            <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
              <Button onClick={runBatch} disabled={!templateId} size="lg" style={{ background: "#0A0A0A", color: "#fff" }}>
                <ImagePlus size={16} style={{ marginRight: 6 }} />
                Generate {count} posts
              </Button>
            </div>
          </Card>
        )}

        {/* ── RUNNING ─────────────────────────────────────────────── */}
        {stage === "running" && tpl && (
          <Card style={{ padding: 24, background: "#fff", border: "1px solid #e5e5e0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <Loader2 size={20} className="animate-spin" />
              <strong>Generating {currentIndex + 1} / {renderQueue.length}…</strong>
            </div>
            <div style={{ background: "#eee", height: 6, borderRadius: 3, overflow: "hidden" }}>
              <div style={{ background: "#0A0A0A", height: "100%", width: `${((currentIndex + 1) / Math.max(1, renderQueue.length)) * 100}%`, transition: "width 0.3s" }} />
            </div>
            <p style={{ fontSize: 12, color: "#666", marginTop: 12 }}>
              Each item: render PNG → upload → AI copy → calendar entry. Don't close this tab.
            </p>
            {results.length > 0 && (
              <div style={{ marginTop: 16, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
                {results.map((r, i) => (
                  <img key={i} src={r.pngUrl} alt="" style={{ width: "100%", aspectRatio: `${tpl.width} / ${tpl.height}`, objectFit: "cover", borderRadius: 4 }} />
                ))}
              </div>
            )}
          </Card>
        )}

        {/* ── DONE ────────────────────────────────────────────────── */}
        {stage === "done" && tpl && (
          <Card style={{ padding: 24, background: "#fff", border: "1px solid #e5e5e0" }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
              Batch complete — {results.length} posts ready
            </h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
              {zipUrl && (
                <Button asChild size="lg" style={{ background: "#0A0A0A", color: "#fff" }}>
                  <a href={zipUrl} download={`social-batch-${tool}-${hookType}.zip`}>
                    <Download size={16} style={{ marginRight: 6 }} /> Download .zip ({results.length} PNGs)
                  </a>
                </Button>
              )}
              <Button asChild variant="outline">
                <Link to="/admin/marketing-hub?tab=calendar"><Calendar size={16} style={{ marginRight: 6 }} /> View on Calendar</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/engine-room"><ListChecks size={16} style={{ marginRight: 6 }} /> View in Engine Room</Link>
              </Button>
              <Button variant="ghost" onClick={() => { setStage("configure"); setResults([]); setZipUrl(null); setEngineRoomCardId(null); }}>
                Run another batch
              </Button>
            </div>

            {engineRoomCardId && (
              <p style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
                Engine Room card created (ID: <code>{engineRoomCardId}</code>) — status: review · priority: high
              </p>
            )}

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
              {results.map((r, i) => (
                <div key={i} style={{ background: "#FAFAF7", border: "1px solid #ececec", borderRadius: 6, overflow: "hidden" }}>
                  <img src={r.pngUrl} alt="" style={{ width: "100%", aspectRatio: `${tpl.width} / ${tpl.height}`, objectFit: "cover", display: "block" }} />
                  <div style={{ padding: 10 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "#0A0A0A", margin: 0 }}>{r.copy.hook || "(no hook)"}</p>
                    {r.copy.body && (
                      <p style={{ fontSize: 11, color: "#666", margin: "4px 0 0 0", lineHeight: 1.4 }}>{r.copy.body.slice(0, 120)}{r.copy.body.length > 120 ? "…" : ""}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ── HIDDEN OFF-SCREEN KONVA STAGE ────────────────────────── */}
        {/* Mounted whenever we have a template; positioned off-screen so
            the user never sees it. The stage is what we toDataURL each
            iteration of the batch loop. */}
        {tpl && (
          <div style={{ position: "fixed", left: -100000, top: 0, pointerEvents: "none" }} aria-hidden>
            <Stage
              ref={(node) => { stageRef.current = node; }}
              width={tpl.width}
              height={tpl.height}
            >
              <Layer>
                <Rect x={0} y={0} width={tpl.width} height={tpl.height} fill={tpl.background_color || "#FFFFFF"} />
                {elements.map((el) => {
                  if (el.type === "rect") {
                    return (
                      <Rect
                        key={el.id}
                        x={el.x} y={el.y} width={el.width} height={el.height}
                        fill={el.fill || "#000000"}
                        opacity={el.opacity ?? 1}
                        cornerRadius={el.cornerRadius}
                      />
                    );
                  }
                  if (el.type === "text") {
                    return (
                      <Text
                        key={el.id}
                        x={el.x} y={el.y} width={el.width} height={el.height}
                        text={el.text || ""}
                        fontSize={el.fontSize || 32}
                        fontFamily={el.fontFamily || "Poppins"}
                        fontStyle={el.fontStyle}
                        fill={el.fill || "#0A0A0A"}
                        align={el.align as any}
                        verticalAlign={el.verticalAlign as any}
                      />
                    );
                  }
                  if (el.type === "image" && el.slot) {
                    // Slotted image — fill with the loaded image for this
                    // specific slot. Multi-slot templates (e.g. ColorPro
                    // before/after) get distinct renders per slot from the
                    // batch loop. If a slot's image hasn't loaded yet, we
                    // skip rendering the element so the toDataURL doesn't
                    // capture half-loaded state.
                    const img = slotImages[el.slot];
                    if (!img) return null;
                    return (
                      <KonvaImage
                        key={el.id}
                        x={el.x} y={el.y} width={el.width} height={el.height}
                        image={img}
                      />
                    );
                  }
                  return null;
                })}
              </Layer>
            </Stage>
          </div>
        )}
      </div>
    </div>
  );
}
