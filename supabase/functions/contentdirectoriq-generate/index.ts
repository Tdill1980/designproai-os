/**
 * contentdirectoriq-generate — ContentDirectorIQ's brand-grounded generation
 * orchestrator. It does NOT invent brand strategy: the Brand Pillars Library
 * (brand_pillars) and the Brand Hooks Library (content_hooks, the /admin/hooks
 * manager) are the authoritative strategy sources; the footage
 * (media_sources + content_moments) is the only truth a script may claim.
 *
 * Actions:
 *   analyze         { brand, sourceMediaId, projectId?, campaignId?, title? }
 *                   → creates/loads a content_projects row, maps every usable
 *                     transcript moment onto the brand's EXISTING pillars, and
 *                     persists the sanitized matches. Only pillars the footage
 *                     actually supports survive.
 *   eligible_hooks  { projectId, pillarId?, platform?, audienceId?,
 *                     awarenessLevel?, objective?, transcriptBackedOnly? }
 *                   → filters the brand's approved hook library.
 *   generate        { projectId, pillarId, hookTemplateId?, audienceId?,
 *                     awarenessLevel?, platform?, objective?, outputFormat?,
 *                     directives? }
 *                   → concept + script version + per-line provenance. Every
 *                     claim is validated against footage or approved brand
 *                     knowledge; anything unverifiable is FLAGGED, never
 *                     silently shipped.
 *   revise          { scriptVersionId, directives[], hookTemplateId?, pillarId? }
 *                   → new script_versions row on the same concept.
 *   approve         { scriptVersionId, approvedBy }        (human gate)
 *   reject          { scriptVersionId, rejectedBy }
 *   send_to_editor  { scriptVersionId }
 *                   → requires APPROVED status. Emits a VideoBlueprint into
 *                     the EXISTING editor pipeline via the video-render
 *                     function (never a second renderer, never direct
 *                     video_render_jobs writes).
 *
 * Copy model: OpenAI gpt-4o (same brain as content-studio-ai-copy).
 * Brand voice: _shared/brand-os.ts blocks + brand_content_brains config.
 * Edit craft: _shared/editor-os.ts getEditorBrief().
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadBrandBlock } from "../_shared/brand-os.ts";
import { getEditorBrief } from "../_shared/editor-os.ts";
import {
  assertBrandLibraryAccess,
  buildEvidenceCounts,
  filterEligibleHooks,
  findBlockedLanguage,
  hasUnresolvedSlots,
  resolveProvenance,
  sanitizePillarMatches,
  selectEditingBrain,
  REVISION_DIRECTIVES,
  type BrandHookTemplate,
  type BrandPillar,
  type ScriptLineDraft,
  type StrategyMetadata,
  type TranscriptMoment,
} from "../_shared/content-director-iq.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/** brand slug → brand-os block key */
function brandBlockKey(brand: string): string {
  if (brand === "weprintwraps") return "WePrintWraps";
  if (brand === "wraptvworld") return "WrapTV";
  if (brand === "inkandedge") return "InkAndEdge";
  return "RestyleProAI"; // designproai / restylepro share the DesignProAI block
}

async function callOpenAIJson(system: string, user: string): Promise<Record<string, unknown>> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const res = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(text);
}

// ── Loaders ──────────────────────────────────────────────────────────────────

async function loadBrain(supabase: ReturnType<typeof sb>, brand: string) {
  const { data, error } = await supabase
    .from("brand_content_brains").select("*").eq("brand", brand).maybeSingle();
  if (error) throw new Error(`brand_content_brains: ${error.message}`);
  if (!data) throw new Error(`No brand_content_brains row for '${brand}' — seed it before generating.`);
  return data;
}

async function loadPillars(supabase: ReturnType<typeof sb>, brand: string): Promise<BrandPillar[]> {
  const { data, error } = await supabase
    .from("brand_pillars").select("*")
    .eq("brand", brand).eq("active", true).order("sort_order");
  if (error) throw new Error(`brand_pillars: ${error.message}`);
  return (data ?? []) as BrandPillar[];
}

async function loadProject(supabase: ReturnType<typeof sb>, projectId: string) {
  const { data, error } = await supabase
    .from("content_projects").select("*").eq("id", projectId).maybeSingle();
  if (error) throw new Error(`content_projects: ${error.message}`);
  if (!data) throw new Error(`Project ${projectId} not found`);
  return data;
}

async function loadMoments(supabase: ReturnType<typeof sb>, sourceMediaId: string): Promise<TranscriptMoment[]> {
  const { data, error } = await supabase
    .from("content_moments")
    .select("id, start_time, end_time, speaker, verbatim_quote, visual_description, hook_score, soundbite_score, broll_score")
    .eq("source_id", sourceMediaId)
    .order("start_time");
  if (error) throw new Error(`content_moments: ${error.message}`);
  return (data ?? []) as TranscriptMoment[];
}

// ── analyze: footage → pillar matches ────────────────────────────────────────

async function actionAnalyze(body: Record<string, unknown>) {
  const supabase = sb();
  const brand = String(body.brand ?? "");
  let project: Record<string, unknown> | null = null;

  if (body.projectId) {
    project = await loadProject(supabase, String(body.projectId));
  } else {
    if (!brand || !body.sourceMediaId) {
      return json({ error: "brand and sourceMediaId (or projectId) required" }, 400);
    }
    const { data: media, error: mErr } = await supabase
      .from("media_sources").select("id, title, storage_url, transcript")
      .eq("id", String(body.sourceMediaId)).maybeSingle();
    if (mErr || !media) return json({ error: mErr?.message || "media source not found" }, 404);
    const { data: created, error: cErr } = await supabase
      .from("content_projects")
      .insert({
        brand,
        campaign_id: body.campaignId ?? null,
        title: body.title ?? media.title ?? "Untitled project",
        source_media_id: media.id,
        source_video_url: media.storage_url,
        transcript: media.transcript,
        created_by: body.createdBy ?? "contentdirectoriq",
      })
      .select("*").single();
    if (cErr) return json({ error: cErr.message }, 500);
    project = created;
  }

  const projBrand = String(project!.brand);
  const pillars = await loadPillars(supabase, projBrand);
  if (pillars.length === 0) return json({ error: `No active brand_pillars for '${projBrand}'` }, 400);
  const moments = project!.source_media_id
    ? await loadMoments(supabase, String(project!.source_media_id))
    : [];
  if (moments.length === 0 && !project!.transcript) {
    return json({ error: "Project has no transcript moments and no transcript — parse the footage first." }, 400);
  }

  const system = `You are ContentDirectorIQ's evidence analyst for the brand below.
Your ONLY job is to map real transcript/footage moments onto the brand's EXISTING
content pillars. You never invent pillars, never stretch weak evidence, and only
recommend a pillar when the footage genuinely supports it.

${await loadBrandBlock(brandBlockKey(projBrand))}

Return strict JSON: {"matches":[{"pillarSlug":string,"sourceSegmentIds":string[],
"relevanceScore":0..1,"evidenceStrength":0..1,"recommendedFormats":string[],
"recommendedAudience":string[]}]}. sourceSegmentIds MUST be ids copied verbatim
from the provided moments. Omit pillars the footage does not support.`;

  const user = JSON.stringify({
    pillars: pillars.map((p) => ({
      slug: p.slug, name: p.name, description: p.description,
      evidence_guidance: p.evidence_guidance,
      recommended_formats: p.recommended_formats,
      recommended_audiences: p.recommended_audiences,
    })),
    transcript_excerpt: String(project!.transcript ?? "").slice(0, 12000),
    moments: moments.map((m) => ({
      id: m.id, start: m.start_time, end: m.end_time, speaker: m.speaker,
      quote: m.verbatim_quote, visual: m.visual_description,
      hook_score: m.hook_score,
    })),
  });

  const raw = await callOpenAIJson(system, user);
  const matches = sanitizePillarMatches(
    (raw.matches ?? []) as never[],
    pillars,
    new Set(moments.map((m) => m.id)),
  );

  const { error: upErr } = await supabase
    .from("content_projects")
    .update({ pillar_matches: matches })
    .eq("id", project!.id);
  if (upErr) return json({ error: upErr.message }, 500);

  return json({ project_id: project!.id, brand: projBrand, matches, momentCount: moments.length });
}

// ── eligible_hooks ───────────────────────────────────────────────────────────

async function actionEligibleHooks(body: Record<string, unknown>) {
  const supabase = sb();
  const project = await loadProject(supabase, String(body.projectId));
  const brand = String(project.brand);
  const brain = await loadBrain(supabase, brand);

  let pillarSlug: string | undefined;
  if (body.pillarId) {
    const { data: pillar } = await supabase
      .from("brand_pillars").select("brand, slug").eq("id", String(body.pillarId)).maybeSingle();
    if (pillar) {
      assertBrandLibraryAccess(brand, pillar.brand, brain.cross_brand_allowed ?? []);
      pillarSlug = pillar.slug;
    }
  }

  const { data: hooks, error } = await supabase
    .from("content_hooks").select("*").eq("brand", brand).eq("active", true);
  if (error) return json({ error: error.message }, 500);

  // Evidence actually available in this project (for transcript-backed-only).
  const matches = (project.pillar_matches ?? []) as Array<{ pillarSlug: string; sourceSegmentIds: string[] }>;
  const availableEvidence = ["transcript"];
  if (matches.some((m) => (m.sourceSegmentIds ?? []).length > 0)) {
    availableEvidence.push("workflow_demonstration", "product_demo");
  }
  if ((brain.proof_points ?? []).length > 0) availableEvidence.push("verified_fact", "verified_cost");
  if ((brain.offers ?? []).length > 0) availableEvidence.push("verified_offer");

  const eligible = filterEligibleHooks((hooks ?? []) as BrandHookTemplate[], {
    pillarSlug,
    platform: body.platform ? String(body.platform) : undefined,
    audienceId: body.audienceId ? String(body.audienceId) : undefined,
    awarenessLevel: body.awarenessLevel ? String(body.awarenessLevel) : undefined,
    objective: body.objective ? String(body.objective) : undefined,
    availableEvidenceTypes: body.transcriptBackedOnly ? availableEvidence : undefined,
  });

  return json({ brand, pillarSlug: pillarSlug ?? null, hooks: eligible });
}

// ── generate / revise ────────────────────────────────────────────────────────

interface GenContext {
  supabase: ReturnType<typeof sb>;
  project: Record<string, unknown>;
  brain: Record<string, unknown>;
  pillar: BrandPillar;
  hook: BrandHookTemplate | null;
  moments: TranscriptMoment[];
  directives: string[];
  audienceId?: string;
  awarenessLevel?: string;
  platform?: string;
  objective?: string;
  outputFormat?: string;
}

async function generateScriptPackage(ctx: GenContext) {
  const brand = String(ctx.project.brand);
  const proofPoints = (ctx.brain.proof_points ?? []) as Array<{ fact: string }>;
  const offers = (ctx.brain.offers ?? []) as Array<Record<string, unknown>>;
  const prohibited = (ctx.brain.prohibited_claims ?? []) as string[];
  const required = (ctx.brain.required_terminology ?? []) as string[];
  const audiences = (ctx.brain.audiences ?? []) as Array<{ id: string; label: string; description?: string }>;
  const audience = audiences.find((a) => a.id === ctx.audienceId);
  const directiveText = ctx.directives
    .map((d) => REVISION_DIRECTIVES[d] ?? d)
    .filter(Boolean);

  // Appropriate editing brain, selected by content type: the edit doctrine
  // comes from editor-os; the script craft (esp. long-form from raw footage)
  // comes from the brain block.
  const editingBrain = selectEditingBrain(ctx.outputFormat, ctx.objective);
  const editorFormat = editingBrain.format === "promo" ? "promo" : editingBrain.format;

  const system = `You are ContentDirectorIQ, the content strategist for ONE brand.
The footage provides the truth. The brand pillar library determines what story
matters. The hooks library determines how that story earns attention. The
platform rules determine how it is packaged. You NEVER fabricate evidence,
statistics, costs, quotes, or product claims.

${await loadBrandBlock(brandBlockKey(brand))}

${getEditorBrief(editorFormat as "short" | "longform" | "promo")}

${editingBrain.scriptCraft}

## THE SELECTED PILLAR (the story that matters — stay inside it)
${ctx.pillar.name} (${ctx.pillar.slug})
${ctx.pillar.description ?? ""}
Evidence guidance: ${ctx.pillar.evidence_guidance ?? "n/a"}

${ctx.hook ? `## THE APPROVED HOOK STRUCTURE (how the story earns attention)
Hook family: ${ctx.hook.hook_type ?? "curated"}
Template: ${ctx.hook.text}
Fill any {{slot}} placeholders ONLY from the provided approved facts, offers, or
verbatim transcript evidence. If a slot cannot be filled from provided evidence,
LEAVE THE PLACEHOLDER UNRESOLVED — never invent a number or claim.
${(ctx.hook.blocked_language ?? []).length ? `Blocked language for this hook: ${ctx.hook.blocked_language!.join(", ")}` : ""}` : `## HOOK
No hook template selected — open with the strongest transcript-backed moment.`}

## HARD RULES
- PROHIBITED (never write these): ${prohibited.join(" · ") || "n/a"}
- Required terminology (use exactly, with correct marks): ${required.join(" · ") || "n/a"}
- Every script line MUST cite its evidence: transcript segment ids (verbatim
  from the provided moments), a factIndex into approvedFacts, or evidenceType
  "none" for pure connective tissue (keep those rare and claim-free).
- Do not put claims in connective lines. A claim without evidence is a defect.

## OUTPUT — strict JSON only
{"title":string,"angle":string,"hook":string,"caption":string,"cta":string,
 "lines":[{"role":"hook"|"body"|"proof"|"demo"|"cta"|"broll","text":string,
   "segmentIds":string[],"startTime":number|null,"endTime":number|null,
   "evidenceType":"transcript"|"product_demo"|"verified_fact"|"verified_offer"|"none",
   "factIndex":number|null,"visualDirection":string}],
 "editPlanNotes":string}`;

  const user = JSON.stringify({
    brief: {
      audience: audience ?? ctx.audienceId ?? "unspecified",
      awarenessLevel: ctx.awarenessLevel ?? "problem_aware",
      platform: ctx.platform ?? "meta",
      objective: ctx.objective ?? "awareness",
      outputFormat: ctx.outputFormat ?? "instagram_reel",
      platformRules: (ctx.brain.platform_rules as Record<string, unknown>)?.[ctx.platform ?? "meta"] ?? {},
      directives: directiveText,
    },
    approvedFacts: proofPoints.map((p, i) => ({ factIndex: i, fact: p.fact })),
    offers,
    transcript_excerpt: String(ctx.project.transcript ?? "").slice(0, 10000),
    moments: ctx.moments.map((m) => ({
      id: m.id, start: m.start_time, end: m.end_time, speaker: m.speaker,
      quote: m.verbatim_quote, visual: m.visual_description,
    })),
  });

  const raw = await callOpenAIJson(system, user);

  // ── Validate every line's provenance honestly ──────────────────────────────
  const momentIds = new Set(ctx.moments.map((m) => m.id));
  const momentById = new Map(ctx.moments.map((m) => [m.id, m]));
  const flags: string[] = [];
  const rawLines = Array.isArray(raw.lines) ? raw.lines as Array<Record<string, unknown>> : [];

  const lines: ScriptLineDraft[] = rawLines.map((l) => {
    const segIds = (Array.isArray(l.segmentIds) ? l.segmentIds : [])
      .map(String).filter((id) => momentIds.has(id));
    const provenance = resolveProvenance(
      {
        evidenceType: l.evidenceType as string,
        transcriptSegmentIds: segIds,
        factIndex: typeof l.factIndex === "number" ? l.factIndex : null,
      },
      momentIds,
      proofPoints.length,
    );
    const first = segIds.length ? momentById.get(segIds[0]) : undefined;
    const blocked = findBlockedLanguage(String(l.text ?? ""), prohibited, ctx.hook?.blocked_language ?? []);
    if (blocked.length) flags.push(`blocked_language:${blocked.join(",")}`);
    return {
      role: String(l.role ?? "body"),
      text: String(l.text ?? ""),
      transcriptSegmentIds: segIds,
      startTime: typeof l.startTime === "number" ? l.startTime : first?.start_time ?? null,
      endTime: typeof l.endTime === "number" ? l.endTime : first?.end_time ?? null,
      evidenceType: (l.evidenceType as string) ?? null,
      provenanceStatus: blocked.length ? "unverified" : provenance,
      visualDirection: (l.visualDirection as string) ?? null,
    };
  }).filter((l) => l.text.trim().length > 0);

  const hookText = String(raw.hook ?? "");
  if (hasUnresolvedSlots(hookText)) flags.push("hook_missing_evidence");
  if (findBlockedLanguage(hookText, prohibited, ctx.hook?.blocked_language ?? []).length) {
    flags.push("hook_blocked_language");
  }
  const unverified = lines.filter((l) => l.provenanceStatus === "unverified").length;
  if (unverified > 0) flags.push(`unverified_lines:${unverified}`);

  return {
    title: String(raw.title ?? ""),
    angle: String(raw.angle ?? ""),
    hook: hookText,
    caption: String(raw.caption ?? ""),
    cta: String(raw.cta ?? ""),
    lines,
    editPlanNotes: String(raw.editPlanNotes ?? ""),
    flags,
    editingBrain,
  };
}

/** The renderer draws overlays as SINGLE drawtext lines (~84px, no wrap) —
 *  long strings run off the 1080px frame. Wrap to short stacked lines and
 *  cap at 3; drawtext renders literal newlines as line breaks. */
function wrapOverlay(text: string, maxLine = 12, maxLines = 4): string | undefined {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return undefined;
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur ? cur.length + 1 : 0) + w.length <= maxLine) {
      cur = cur ? `${cur} ${w}` : w;
    } else {
      if (cur) lines.push(cur);
      if (lines.length >= maxLines) return lines.join("\n"); // keep it punchy, drop the tail
      cur = w.length > maxLine ? w.slice(0, maxLine) : w;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.join("\n");
}

/** Build the edit plan for the EXISTING editor (src/types/VideoBlueprint.ts shape). */
function buildEditPlan(
  project: Record<string, unknown>,
  pkg: { title: string; hook: string; caption: string; cta: string; lines: ScriptLineDraft[] },
  platform?: string,
  brainFormat?: string,
  moments: TranscriptMoment[] = [],
) {
  const clipUrl = String(project.source_video_url ?? "");
  const purposeFor = (role: string) =>
    role === "hook" ? "hook"
    : role === "cta" ? "cta"
    : role === "proof" || role === "demo" ? "proof"
    : role === "broll" ? "b_roll"
    : "proof";
  const brand = String(project.brand);
  const captionStyle = brand === "weprintwraps" || brand === "wraptvworld" ? "sabri"
    : brand === "inkandedge" ? "clean" : "dara";

  const timed = pkg.lines.filter(
    (l) => typeof l.startTime === "number" && typeof l.endTime === "number" && (l.endTime as number) > (l.startTime as number),
  );
  let scenes = timed.map((l, i) => ({
    sceneId: `scene-${i + 1}`,
    clipId: l.transcriptSegmentIds[0] ?? `line-${i}`,
    clipUrl,
    start: Number(l.startTime),
    end: Number(l.endTime),
    purpose: purposeFor(l.role),
    // Hook rides high and short; other beats sit low. Everything wrapped so
    // nothing runs off the frame.
    text: wrapOverlay(l.role === "hook" ? pkg.hook || l.text : l.text),
    textPosition: "bottom",
    animation: captionStyle === "sabri" ? "punch" : "fade",
    cutReason: `${l.role} · ${l.provenanceStatus}`,
  }));
  // DETERMINISTIC FALLBACK: if the script's lines carried no usable
  // timecodes, the footage's scored moments ARE the shot list — cut the top
  // moments (up to 6, ≤5s takes) and lay the script text over them in order.
  // The editor never returns an empty timeline for real footage.
  if (scenes.length === 0 && moments.length > 0) {
    const usable = moments
      .filter((m) => typeof m.start_time === "number" && typeof m.end_time === "number" && (m.end_time as number) > (m.start_time as number))
      .sort((a, b) => (b.hook_score ?? b.broll_score ?? 0) - (a.hook_score ?? a.broll_score ?? 0))
      .slice(0, 6)
      .sort((a, b) => (a.start_time as number) - (b.start_time as number));
    const overlayTexts = [pkg.hook, ...pkg.lines.filter((l) => l.role !== "hook").map((l) => l.text)];
    scenes = usable.map((m, i) => {
      const start = Number(m.start_time);
      const end = Math.min(Number(m.end_time), start + 5);
      return {
        sceneId: `scene-${i + 1}`,
        clipId: m.id,
        clipUrl,
        start,
        end,
        purpose: i === 0 ? "hook" : i === usable.length - 1 ? "cta" : "b_roll",
        text: wrapOverlay(overlayTexts[i] ?? ""),
        textPosition: "bottom",
        animation: captionStyle === "sabri" ? "punch" : "fade",
        cutReason: `moment fallback · ${m.visual_description?.slice(0, 60) ?? "scored moment"}`,
      };
    });
  }
  const totalDuration = scenes.reduce((s, sc) => s + (sc.end - sc.start), 0);
  const longform = brainFormat === "longform";

  return {
    id: `cdiq-${crypto.randomUUID().slice(0, 8)}`,
    platform: platform === "youtube_shorts" || platform === "youtube_long_form" ? "youtube"
      : platform === "meta" ? "facebook" : "instagram",
    totalDuration,
    scenes,
    endCard: pkg.cta
      ? { duration: 2.5, text: wrapOverlay(pkg.title || pkg.hook, 12, 3) ?? "", cta: wrapOverlay(pkg.cta, 18, 2) ?? pkg.cta }
      : undefined,
    source: "ai",
    brand,
    format: longform ? undefined : "reel",
    aspectRatio: longform ? "16:9" : "9:16",
    captionStyle,
    caption: pkg.caption,
    title: pkg.title,
    // The renderer strips clip audio unless told otherwise — a silent rough
    // cut is never the editor's intent. Native audio leads; any music ducks
    // to a bed under it (renderer's documentary mix).
    keepNativeAudio: true,
  };
}

/** Auto-pick a soundtrack from the house music library (video_music_library)
 *  by the editing register — high energy for reels/ads, calmer otherwise. */
async function pickMusic(
  supabase: ReturnType<typeof sb>,
  brainFormat?: string,
): Promise<{ url: string; bpm: number | null } | null> {
  try {
    const { data: tracks } = await supabase
      .from("video_music_library")
      .select("storage_url, energy, mood, bpm")
      .limit(60);
    if (!tracks?.length) return null;
    const wantHigh = brainFormat !== "longform";
    const ranked = [...tracks].sort((a, b) => {
      const ea = String(a.energy ?? "").toLowerCase().includes("high") ? 1 : 0;
      const eb = String(b.energy ?? "").toLowerCase().includes("high") ? 1 : 0;
      return wantHigh ? eb - ea : ea - eb;
    });
    const t = ranked[0];
    return t?.storage_url ? { url: t.storage_url, bpm: t.bpm ? Number(t.bpm) : null } : null;
  } catch {
    return null;
  }
}

/** EDIT TO THE MUSIC (installs): snap each take to whole 4-beat bars of the
 *  chosen track so cuts land on the beat. Takes only ever shrink (never
 *  overrun their source moment); minimum one bar. */
function snapScenesToBeat(scenes: Array<{ start: number; end: number }>, bpm: number | null) {
  if (!bpm || bpm < 40 || bpm > 220) return;
  const bar = (60 / bpm) * 4;
  for (const s of scenes) {
    const dur = s.end - s.start;
    const bars = Math.max(1, Math.floor(dur / bar));
    const snapped = bars * bar;
    if (snapped <= dur) s.end = s.start + snapped;
  }
}

async function actionGenerate(body: Record<string, unknown>, revised?: {
  conceptId: string; version: number;
}) {
  const supabase = sb();
  const project = await loadProject(supabase, String(body.projectId));
  // The renderable clip can change after project creation (the parser
  // repoints media_sources.storage_url to the hydrated video/1080p proxy) —
  // always cut from the CURRENT one, not the frozen copy.
  if (project.source_media_id) {
    const { data: media } = await supabase
      .from("media_sources").select("storage_url").eq("id", String(project.source_media_id)).maybeSingle();
    if (media?.storage_url) project.source_video_url = media.storage_url;
  }
  const brand = String(project.brand);
  const brain = await loadBrain(supabase, brand);
  const crossAllowed = (brain.cross_brand_allowed ?? []) as string[];

  const { data: pillar, error: pErr } = await supabase
    .from("brand_pillars").select("*").eq("id", String(body.pillarId)).maybeSingle();
  if (pErr || !pillar) return json({ error: pErr?.message || "Pillar not found" }, 404);
  assertBrandLibraryAccess(brand, pillar.brand, crossAllowed);

  let hook: BrandHookTemplate | null = null;
  if (body.hookTemplateId) {
    const { data: h, error: hErr } = await supabase
      .from("content_hooks").select("*").eq("id", String(body.hookTemplateId)).maybeSingle();
    if (hErr || !h) return json({ error: hErr?.message || "Hook template not found" }, 404);
    assertBrandLibraryAccess(brand, h.brand, crossAllowed);
    hook = h as BrandHookTemplate;
  }

  // Evidence scope: the pillar match's cited segments first, all moments as fallback.
  const allMoments = project.source_media_id
    ? await loadMoments(supabase, String(project.source_media_id))
    : [];
  const matches = (project.pillar_matches ?? []) as Array<{ pillarId: string; pillarSlug: string; sourceSegmentIds: string[]; relevanceScore: number; evidenceStrength: number }>;
  const match = matches.find((m) => m.pillarId === pillar.id || m.pillarSlug === pillar.slug);
  const scoped = match
    ? allMoments.filter((m) => match.sourceSegmentIds.includes(m.id))
    : [];
  const moments = scoped.length ? scoped : allMoments;

  const directives = Array.isArray(body.directives) ? (body.directives as string[]) : [];
  const pkg = await generateScriptPackage({
    supabase, project, brain, pillar: pillar as BrandPillar, hook, moments, directives,
    audienceId: body.audienceId ? String(body.audienceId) : undefined,
    awarenessLevel: body.awarenessLevel ? String(body.awarenessLevel) : undefined,
    platform: body.platform ? String(body.platform) : undefined,
    objective: body.objective ? String(body.objective) : undefined,
    outputFormat: body.outputFormat ? String(body.outputFormat) : undefined,
  });

  const audiences = (brain.audiences ?? []) as Array<{ id: string; label: string }>;
  const strategy: StrategyMetadata = {
    brand,
    pillarSlug: pillar.slug,
    pillarName: pillar.name,
    hookTemplateId: hook?.id ?? null,
    hookFamily: hook?.hook_type ?? null,
    hookText: pkg.hook,
    audienceId: body.audienceId ? String(body.audienceId) : null,
    audienceLabel: audiences.find((a) => a.id === body.audienceId)?.label ?? null,
    awarenessLevel: body.awarenessLevel ? String(body.awarenessLevel) : null,
    platform: body.platform ? String(body.platform) : null,
    objective: body.objective ? String(body.objective) : null,
    outputFormat: body.outputFormat ? String(body.outputFormat) : null,
    editingBrain: { format: pkg.editingBrain.format, label: pkg.editingBrain.label },
    evidenceCounts: buildEvidenceCounts(pkg.lines),
    directives,
    flags: pkg.flags,
  };

  // Persist: concept (unless revising) → script_version → script_lines.
  let conceptId = revised?.conceptId;
  if (!conceptId) {
    const { data: concept, error: cErr } = await supabase
      .from("content_concepts")
      .insert({
        content_project_id: project.id,
        brand,
        brand_pillar_id: pillar.id,
        hook_template_id: hook?.id ?? null,
        audience_id: strategy.audienceId,
        awareness_level: strategy.awarenessLevel,
        platform: strategy.platform,
        objective: strategy.objective,
        output_format: strategy.outputFormat,
        title: pkg.title,
        angle: pkg.angle,
        evidence: pkg.lines.map((l) => ({
          kind: l.evidenceType ?? "none",
          segmentIds: l.transcriptSegmentIds,
          provenance: l.provenanceStatus,
        })),
        pillar_match: match ?? {},
        status: "draft",
      })
      .select("id").single();
    if (cErr) return json({ error: cErr.message }, 500);
    conceptId = concept.id;
  }

  const editPlan = buildEditPlan(project, pkg, strategy.platform ?? undefined, pkg.editingBrain.format, moments);

  const { data: version, error: vErr } = await supabase
    .from("script_versions")
    .insert({
      content_concept_id: conceptId,
      version: revised?.version ?? 1,
      brand_pillar_id: pillar.id,
      hook_template_id: hook?.id ?? null,
      strategy_metadata: strategy,
      hook_text: pkg.hook,
      caption: pkg.caption,
      cta: pkg.cta,
      edit_plan: editPlan,
      status: "draft",
    })
    .select("id, version").single();
  if (vErr) return json({ error: vErr.message }, 500);

  const lineRows = pkg.lines.map((l, i) => ({
    script_version_id: version.id,
    line_index: i,
    role: l.role,
    text: l.text,
    transcript_segment_ids: l.transcriptSegmentIds,
    start_time: l.startTime,
    end_time: l.endTime,
    evidence_type: l.evidenceType,
    provenance_status: l.provenanceStatus,
    visual_direction: l.visualDirection,
  }));
  if (lineRows.length) {
    const { error: lErr } = await supabase.from("script_lines").insert(lineRows);
    if (lErr) return json({ error: lErr.message }, 500);
  }

  return json({
    concept_id: conceptId,
    script_version_id: version.id,
    version: version.version,
    strategy,
    package: { ...pkg, editPlan },
  });
}

async function actionRevise(body: Record<string, unknown>) {
  const supabase = sb();
  const { data: prev, error } = await supabase
    .from("script_versions")
    .select("id, version, content_concept_id, brand_pillar_id, hook_template_id, strategy_metadata")
    .eq("id", String(body.scriptVersionId)).maybeSingle();
  if (error || !prev) return json({ error: error?.message || "Script version not found" }, 404);
  const { data: concept } = await supabase
    .from("content_concepts").select("content_project_id, audience_id, awareness_level, platform, objective, output_format")
    .eq("id", prev.content_concept_id).maybeSingle();
  if (!concept) return json({ error: "Concept not found" }, 404);

  return actionGenerate(
    {
      projectId: concept.content_project_id,
      pillarId: body.pillarId ?? prev.brand_pillar_id,
      hookTemplateId: body.hookTemplateId ?? prev.hook_template_id,
      audienceId: body.audienceId ?? concept.audience_id,
      awarenessLevel: body.awarenessLevel ?? concept.awareness_level,
      platform: concept.platform,
      objective: concept.objective,
      outputFormat: concept.output_format,
      directives: body.directives ?? [],
    },
    { conceptId: prev.content_concept_id, version: (prev.version ?? 1) + 1 },
  );
}

// ── Human gate + editor handoff ──────────────────────────────────────────────

async function actionApprove(body: Record<string, unknown>, approve: boolean) {
  const supabase = sb();
  const status = approve ? "approved" : "rejected";
  const { data: version, error } = await supabase
    .from("script_versions")
    .update({
      status,
      approved_by: String(body.approvedBy ?? body.rejectedBy ?? "admin"),
      approved_at: new Date().toISOString(),
    })
    .eq("id", String(body.scriptVersionId))
    .select("id, content_concept_id").single();
  if (error) return json({ error: error.message }, 500);
  await supabase.from("content_concepts").update({
    status,
    approved_by: String(body.approvedBy ?? body.rejectedBy ?? "admin"),
    approved_at: new Date().toISOString(),
  }).eq("id", version.content_concept_id);
  return json({ script_version_id: version.id, status });
}

async function actionSendToEditor(body: Record<string, unknown>, roughCut = false) {
  const supabase = sb();
  const { data: version, error } = await supabase
    .from("script_versions").select("*").eq("id", String(body.scriptVersionId)).maybeSingle();
  if (error || !version) return json({ error: error?.message || "Script version not found" }, 404);
  // Owner spec ordering: the AI editor renders the ROUGH CUT first, the human
  // reviews the actual video, THEN approves. So render_rough_cut works on a
  // draft; send_to_editor (the post-approval export) still requires approval.
  if (!roughCut && version.status !== "approved") {
    return json({ error: "Human approval required before sending to the editor. Approve the script first." }, 403);
  }
  const editPlan = version.edit_plan as Record<string, unknown>;
  if (!Array.isArray(editPlan?.scenes) || (editPlan.scenes as unknown[]).length === 0) {
    return json({ error: "Edit plan has no scenes — the script has no timecoded, evidence-backed lines to cut from." }, 400);
  }
  // Honest guard: an audio-only catalog (no hydrated video/proxy) cannot be
  // cut into a video. Re-parse the source so the 1080p proxy hydrates.
  const firstClip = String((editPlan.scenes as Array<{ clipUrl?: string }>)[0]?.clipUrl ?? "");
  if (/\.(mp3|m4a|wav|aac)(\?|$)/i.test(firstClip)) {
    return json({ error: "This source was cataloged audio-only (no renderable video in storage). Re-parse the footage — the parser now hydrates a 1080p proxy for large masters — then regenerate." }, 409);
  }

  // Older stored plans predate the keepNativeAudio default — a silent cut is
  // never the editor's intent, so set it at render time too.
  if (editPlan.keepNativeAudio === undefined) editPlan.keepNativeAudio = true;
  const brainFormat = ((version.strategy_metadata as Record<string, unknown>)
    ?.editingBrain as Record<string, unknown> | undefined)?.format as string | undefined;

  // MUSIC RULE (owner, 2026-07-28): people talking = documentary/reel — their
  // voice IS the audio, no bed. INSTALL/b-roll cuts (no speech) ALWAYS get
  // music, and the edit snaps to the music: takes cut on whole 4-beat bars.
  const { count: spokenLines } = await supabase
    .from("script_lines")
    .select("id", { count: "exact", head: true })
    .eq("script_version_id", version.id)
    .eq("provenance_status", "transcript_verified");
  // The SOURCE's own transcript is the truth about whether people talk in
  // this footage — script lines can miss citations on a given generation.
  let sourceHasSpeech = false;
  const { data: concept } = await supabase
    .from("content_concepts").select("content_project_id").eq("id", version.content_concept_id).maybeSingle();
  if (concept) {
    const { data: proj } = await supabase
      .from("content_projects").select("transcript").eq("id", concept.content_project_id).maybeSingle();
    sourceHasSpeech = ((proj?.transcript ?? "") as string).trim().length > 40;
  }
  let musicUrl: string | null = null;
  if ((spokenLines ?? 0) === 0 && !sourceHasSpeech) {
    const track = await pickMusic(supabase, brainFormat);
    if (track) {
      musicUrl = track.url;
      snapScenesToBeat(editPlan.scenes as Array<{ start: number; end: number }>, track.bpm);
    }
  }

  // Hand off to the EXISTING editor pipeline (video-render → video_render_jobs
  // → ffmpeg worker → CutEditor for human refinement).
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/video-render`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({
      blueprint: editPlan,
      music_url: musicUrl,
      brand: (version.strategy_metadata as Record<string, unknown>)?.brand,
      source_ref: `contentdirectoriq:${version.id}`,
    }),
  });
  const renderData = await res.json().catch(() => ({}));
  if (!res.ok || renderData?.ok === false) {
    return json({ error: `video-render: ${renderData?.error ?? res.status}` }, 502);
  }

  await supabase.from("script_versions")
    .update({
      // A rough cut keeps the version in draft — approval happens AFTER the
      // human watches the render.
      ...(roughCut ? {} : { status: "sent_to_editor" }),
      render_job_id: renderData.render_job_id ?? null,
    })
    .eq("id", version.id);
  if (!roughCut) {
    await supabase.from("content_concepts")
      .update({ status: "sent_to_editor" })
      .eq("id", version.content_concept_id);
  }

  return json({
    script_version_id: version.id,
    render_job_id: renderData.render_job_id ?? null,
    final_url: renderData.final_url ?? null,
    thumbnail_url: renderData.thumbnail_url ?? null,
    status: renderData.final_url ? "rendered" : "processing",
  });
}

// ── Router ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    switch (action) {
      case "analyze": return await actionAnalyze(body);
      case "eligible_hooks": return await actionEligibleHooks(body);
      case "generate": return await actionGenerate(body);
      case "revise": return await actionRevise(body);
      case "approve": return await actionApprove(body, true);
      case "reject": return await actionApprove(body, false);
      case "render_rough_cut": return await actionSendToEditor(body, true);
      case "send_to_editor": return await actionSendToEditor(body);
      default:
        return json({ error: `Unknown action '${action}'. Valid: analyze, eligible_hooks, generate, revise, approve, reject, send_to_editor` }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
