/**
 * canva-brandboard — attach Canva output to an existing BrandBoard draft.
 *
 * Invariants:
 *  - agent_social_posts is created first by the client and post_id is required.
 *  - only DesignProAI and WePrintWraps are Canva production lanes.
 *  - the draft, request and optional source must be the same canonical brand.
 *  - this function never approves, schedules, posts, or creates another card.
 *  - statics attach one stable PNG export to the same draft.
 *  - Reels attach Canva edit identity only; media_urls remains empty until a
 *    real MP4 edit is attached through the video workflow.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  canvaFetch,
  ensureFreshTokens,
  getAdminClient,
  getUserFromAuthHeader,
  loadTokens,
  uploadCanvaAsset,
  type CanvaTokens,
} from "../_shared/canva-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const CANVA_BRANDS = new Set(["designproai", "weprintwraps"]);
const MAX_POLLS = 30;
const POLL_MS = 700;

type CanvaBrand = "designproai" | "weprintwraps";
type CanvaKind = "image" | "reel";
type JsonRecord = Record<string, unknown>;
type DraftRow = {
  id: string;
  brand: string;
  post_type: string | null;
  status: string | null;
  media_urls: string[] | null;
  scheduled_date: string | null;
  posted_date: string | null;
  canva_design_id: string | null;
  generation_meta: JsonRecord | null;
};

function json(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function canonicalBrand(value: unknown): CanvaBrand | null {
  const brand = String(value || "").trim().toLowerCase();
  return CANVA_BRANDS.has(brand) ? brand as CanvaBrand : null;
}

function safeId(value: unknown, label: string): string {
  const id = String(value || "").trim();
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`${label}_invalid`);
  return id;
}

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

async function canvaJson(tokens: CanvaTokens, path: string, init: RequestInit = {}): Promise<JsonRecord> {
  const res = await canvaFetch(tokens, path, init);
  const body = await res.json().catch(() => ({})) as JsonRecord;
  if (!res.ok) throw new Error(`Canva ${res.status}: ${JSON.stringify(body).slice(0, 240)}`);
  return body;
}

async function pollJob(tokens: CanvaTokens, path: string): Promise<JsonRecord> {
  for (let i = 0; i < MAX_POLLS; i++) {
    const body = await canvaJson(tokens, path);
    const job = object(body.job);
    const status = String(job.status || "");
    if (status === "success") return job;
    if (status === "failed") throw new Error(`canva_job_failed: ${JSON.stringify(job.error || {}).slice(0, 180)}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error("canva_job_timed_out");
}

async function callerTokens(req: Request): Promise<CanvaTokens> {
  const user = await requireCanvaOperator(req);
  const tokens = await loadTokens(user.id);
  if (!tokens) throw new Error("canva_not_connected");
  return await ensureFreshTokens(tokens);
}

async function requireUser(req: Request): Promise<{ id: string }> {
  const authHeader = req.headers.get("Authorization") || "";
  const user = authHeader ? await getUserFromAuthHeader(authHeader) : null;
  if (!user) throw new Error("authentication_required");
  return user;
}

async function requireCanvaOperator(req: Request): Promise<{ id: string }> {
  const user = await requireUser(req);
  const admin = getAdminClient();
  const [adminRole, moderatorRole] = await Promise.all([
    admin.rpc("has_role", { _user_id: user.id, _role: "admin" }),
    admin.rpc("has_role", { _user_id: user.id, _role: "moderator" }),
  ]);
  if (adminRole.error || moderatorRole.error) throw new Error("canva_operator_authorization_failed");
  if (adminRole.data !== true && moderatorRole.data !== true) throw new Error("canva_operator_forbidden");
  return user;
}

async function listTemplates(tokens: CanvaTokens) {
  const templates: JsonRecord[] = [];
  let continuation = "";
  for (let page = 0; page < 5; page++) {
    const url = new URL("https://api.canva.com/rest/v1/brand-templates");
    url.searchParams.set("dataset", "non_empty");
    if (continuation) url.searchParams.set("continuation", continuation);
    const body = await canvaJson(tokens, url.toString());
    for (const raw of Array.isArray(body.items) ? body.items : []) {
      const item = object(raw);
      const thumbnail = object(item.thumbnail);
      templates.push({
        id: String(item.id || ""),
        title: String(item.title || "Untitled"),
        thumbnail: String(thumbnail.url || "") || null,
        width: thumbnail.width == null ? null : Number(thumbnail.width),
        height: thumbnail.height == null ? null : Number(thumbnail.height),
      });
    }
    continuation = String(body.continuation || "");
    if (!continuation) break;
  }
  return templates;
}

async function templateDataset(tokens: CanvaTokens, templateId: string) {
  const body = await canvaJson(tokens, `/brand-templates/${safeId(templateId, "canva_template_id")}/dataset`);
  return Object.entries(object(body.dataset)).map(([name, definition]) => ({
    name,
    type: String(object(definition).type || "text"),
  }));
}

async function configAction(req: Request) {
  await requireCanvaOperator(req);
  const { data, error } = await getAdminClient().from("brand_canva_templates")
    .select("brand, template_id, template_title, field_map, reel_template_id, reel_template_title, reel_field_map")
    .in("brand", [...CANVA_BRANDS]);
  if (error) throw new Error(`canva_config: ${error.message}`);
  return { ok: true, action: "config", maps: data || [], canonical_brands: [...CANVA_BRANDS] };
}

async function mapAction(req: Request, body: JsonRecord) {
  const brand = canonicalBrand(body.brand);
  if (!brand) throw new Error("unsupported_canva_brand");
  const kind = String(body.kind || "image").trim().toLowerCase() as CanvaKind;
  if (kind !== "image" && kind !== "reel") throw new Error("canva_kind_invalid");
  const templateId = safeId(body.template_id, "canva_template_id");
  const tokens = await callerTokens(req);
  const fields = await templateDataset(tokens, templateId);
  const title = String(body.template_title || "").trim() || null;
  const row = kind === "reel"
    ? { brand, reel_template_id: templateId, reel_template_title: title, reel_field_map: fields, updated_at: new Date().toISOString() }
    : { brand, template_id: templateId, template_title: title, field_map: fields, updated_at: new Date().toISOString() };
  const { error } = await getAdminClient().from("brand_canva_templates").upsert(row, { onConflict: "brand" });
  if (error) throw new Error(`canva_map: ${error.message}`);
  return { ok: true, action: "map", brand, canonical_brand: brand, kind, template_id: templateId, fields };
}

async function loadDraft(postId: string, requestedBrand: CanvaBrand): Promise<DraftRow> {
  const admin = getAdminClient();
  const { data, error } = await admin.from("agent_social_posts")
    .select("id, brand, post_type, status, media_urls, scheduled_date, posted_date, canva_design_id, generation_meta")
    .eq("id", postId)
    .maybeSingle();
  if (error) throw new Error(`brandboard_draft_lookup: ${error.message}`);
  if (!data) throw new Error("brandboard_draft_not_found");
  const row = data as DraftRow;
  if (canonicalBrand(row.brand) !== requestedBrand) throw new Error("brandboard_draft_brand_mismatch");
  if (row.status !== "draft") throw new Error("brandboard_draft_required");
  if (row.scheduled_date || row.posted_date) throw new Error("brandboard_draft_must_be_unscheduled");
  return row;
}

async function validateSameBrandSource(row: DraftRow, brand: CanvaBrand): Promise<void> {
  const source = object(object(row.generation_meta).source);
  if (!source.id && !source.table && !source.brand) return;
  if (canonicalBrand(source.brand) !== brand) throw new Error("brandboard_source_brand_mismatch");
  const table = String(source.table || "");
  if (table !== "video_render_jobs" && table !== "agent_media_assets") {
    throw new Error("brandboard_source_table_invalid");
  }
  const id = String(source.id || "").trim();
  if (!id) throw new Error("brandboard_source_id_required");
  const { data, error } = await getAdminClient().from(table)
    .select("id, brand")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`brandboard_source_lookup: ${error.message}`);
  if (!data || canonicalBrand(data.brand) !== brand) throw new Error("brandboard_source_not_same_brand");
}

async function mappedTemplate(brand: CanvaBrand, kind: CanvaKind) {
  const { data, error } = await getAdminClient().from("brand_canva_templates")
    .select("brand, template_id, field_map, reel_template_id, reel_field_map")
    .eq("brand", brand)
    .maybeSingle();
  if (error) throw new Error(`canva_template_lookup: ${error.message}`);
  const templateId = kind === "reel" ? data?.reel_template_id : data?.template_id;
  const fields = kind === "reel" ? data?.reel_field_map : data?.field_map;
  if (!templateId) throw new Error(kind === "reel" ? "canva_reel_template_not_mapped" : "canva_image_template_not_mapped");
  return {
    id: safeId(templateId, "canva_template_id"),
    fields: Array.isArray(fields) ? fields as Array<{ name?: unknown; type?: unknown }> : [],
  };
}

/**
 * FILL THE TEMPLATE'S IMAGE FIELD WITH A REAL ASSET.
 *
 * Owner, 2026-08-13: creatives must use "our photos screen stills, videos
 * stored in library and googledrive… that is the product."
 *
 * `autofillText` filters to `type === "text"`, so the `hero_image` field both
 * mapped templates expose was never filled and every creative carried Canva's
 * placeholder photo. Text on somebody else's stock picture is not a creative.
 *
 * Returns the fields to MERGE into the autofill payload; an empty object when
 * the template has no image slot or no asset was uploaded, so a text-only
 * template still works exactly as before.
 */
function autofillImage(
  fields: Array<{ name?: unknown; type?: unknown }>,
  assetId: string | null,
): Record<string, { type: "image"; asset_id: string }> {
  if (!assetId) return {};
  const imageField = fields
    .map((field) => ({ name: String(field.name || "").trim(), type: String(field.type || "").toLowerCase() }))
    .find((field) => field.name && field.type === "image");
  if (!imageField) return {};
  return { [imageField.name]: { type: "image", asset_id: assetId } };
}

function autofillText(
  fields: Array<{ name?: unknown; type?: unknown }>,
  copy: { headline: string; subhead?: string; cta?: string },
) {
  const textFields = fields
    .map((field) => ({ name: String(field.name || "").trim(), type: String(field.type || "").toLowerCase() }))
    .filter((field) => field.name && field.type === "text");
  const used = new Set<string>();
  const take = (patterns: RegExp[]) => {
    const field = textFields.find((candidate) =>
      !used.has(candidate.name) && patterns.some((pattern) => pattern.test(candidate.name))
    );
    if (field) used.add(field.name);
    return field;
  };
  const headline = take([/^(headline|title|hook)$/i, /headline|main.?title|hero.?title|hook/i]) ||
    (textFields.length === 1 ? textFields[0] : undefined);
  if (!headline) throw new Error("canva_template_missing_semantic_headline_field");
  used.add(headline.name);
  const subhead = take([/^(subhead|subtitle|body|description)$/i, /sub.?head|sub.?title|support|body|description/i]);
  const cta = take([/^(cta|button|action)$/i, /cta|button|action|footer/i]);
  const data: Record<string, { type: "text"; text: string }> = {
    [headline.name]: { type: "text", text: copy.headline.slice(0, 240) },
  };
  if (subhead && copy.subhead) data[subhead.name] = { type: "text", text: copy.subhead.slice(0, 240) };
  if (cta && copy.cta) data[cta.name] = { type: "text", text: copy.cta.slice(0, 80) };
  return data;
}

async function autofillDesign(
  tokens: CanvaTokens,
  templateId: string,
  data: Record<string, { type: "text"; text: string }>,
) {
  const started = await canvaJson(tokens, "/autofills", {
    method: "POST",
    body: JSON.stringify({ brand_template_id: templateId, data }),
  });
  const initial = object(started.job);
  if (!initial.id && initial.status !== "success") throw new Error("canva_autofill_job_missing");
  const job = initial.status === "success"
    ? initial
    : await pollJob(tokens, `/autofills/${safeId(initial.id, "canva_autofill_job_id")}`);
  const design = object(object(job.result).design);
  const designId = safeId(design.id, "canva_design_id");
  return { designId, design };
}

function designMeta(value: JsonRecord) {
  const urls = object(value.urls);
  const thumbnail = object(value.thumbnail);
  return {
    editUrl: String(urls.edit_url || "").trim() || null,
    viewUrl: String(urls.view_url || "").trim() || null,
    thumbnailUrl: String(thumbnail.url || "").trim() || null,
  };
}

async function getDesign(tokens: CanvaTokens, designId: string): Promise<JsonRecord> {
  const body = await canvaJson(tokens, `/designs/${safeId(designId, "canva_design_id")}`);
  const design = object(body.design);
  return Object.keys(design).length ? design : body;
}

async function rehost(
  sourceUrl: string,
  path: string,
  contentType: string,
): Promise<string> {
  const source = await fetch(sourceUrl);
  if (!source.ok) throw new Error(`canva_download_${source.status}`);
  const bytes = new Uint8Array(await source.arrayBuffer());
  const admin = getAdminClient();
  const { error } = await admin.storage.from("wrap-files").upload(path, bytes, {
    contentType: source.headers.get("content-type") || contentType,
    upsert: true,
  });
  if (error) throw new Error(`canva_storage: ${error.message}`);
  return admin.storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
}

async function exportStatic(tokens: CanvaTokens, brand: CanvaBrand, designId: string): Promise<string> {
  const started = await canvaJson(tokens, "/exports", {
    method: "POST",
    body: JSON.stringify({ design_id: designId, format: { type: "png" } }),
  });
  const initial = object(started.job);
  if (!initial.id && initial.status !== "success") throw new Error("canva_export_job_missing");
  const job = initial.status === "success"
    ? initial
    : await pollJob(tokens, `/exports/${safeId(initial.id, "canva_export_job_id")}`);
  const result = object(job.result);
  const urls = Array.isArray(result.urls) ? result.urls : Array.isArray(job.urls) ? job.urls : [];
  const sourceUrl = String(urls[0] || "").trim();
  if (!sourceUrl) throw new Error("canva_export_returned_no_url");
  return await rehost(sourceUrl, `marketing-designs/${brand}/canva-${designId}.png`, "image/png");
}

async function stableThumbnail(brand: CanvaBrand, designId: string, url: string | null) {
  if (!url) return null;
  try {
    return await rehost(url, `marketing-designs/${brand}/canva-${designId}-thumb.png`, "image/png");
  } catch (error) {
    console.warn(`[canva-brandboard] thumbnail rehost failed: ${String(error).slice(0, 180)}`);
    return null;
  }
}

async function queueBrandBoardReview(postId: string, brand: CanvaBrand): Promise<void> {
  const admin = getAdminClient();
  const { data } = await admin.from("slack_agent_tasks")
    .select("id")
    .eq("task_type", "social_post")
    .contains("metadata", { social_post_id: postId })
    .limit(1);
  if (data?.length) return;
  const { error } = await admin.from("slack_agent_tasks").insert({
    brand,
    task_type: "social_post",
    status: "pending",
    priority: "medium",
    title: "Review Canva draft in BrandBoard",
    description: "Review and approve this draft in BrandBoard.",
    created_by: "canva-brandboard",
    metadata: { social_post_id: postId },
  });
  if (error) throw new Error(`brandboard_review_task: ${error.message}`);
}

async function designAction(req: Request, body: JsonRecord) {
  const brand = canonicalBrand(body.brand);
  if (!brand) throw new Error("unsupported_canva_brand");
  const postId = safeId(body.post_id, "post_id");
  const kind = String(body.kind || "image").trim().toLowerCase() as CanvaKind;
  if (kind !== "image" && kind !== "reel") throw new Error("canva_kind_invalid");
  const headline = String(body.headline || "").trim();
  if (!headline) throw new Error("headline_required");

  const draft = await loadDraft(postId, brand);
  await validateSameBrandSource(draft, brand);
  const isReelCard = /^(reel|short|story)$/i.test(String(draft.post_type || ""));
  if ((kind === "reel") !== isReelCard) throw new Error("brandboard_draft_kind_mismatch");

  const tokens = await callerTokens(req);
  const template = await mappedTemplate(brand, kind);
  // THE IMAGE IS THE CREATIVE. A library/Drive photo is uploaded into Canva
  // and dropped into the template's image slot; without it the design is a
  // caption over a stock placeholder. Failing to upload must not lose the
  // creative, so a bad asset degrades to text-only and SAYS so on the card.
  let assetId: string | null = null;
  let imageNote: string | null = null;
  const imageUrl = String(body.image_url || "").trim();
  if (imageUrl) {
    try {
      assetId = await uploadCanvaAsset(tokens, imageUrl, String(body.image_name || headline));
    } catch (error) {
      imageNote = `image not used: ${String(error).slice(0, 140)}`;
      console.warn(`[canva-brandboard] ${imageNote}`);
    }
  }

  const data = {
    ...autofillText(template.fields, {
      headline,
      subhead: body.subhead ? String(body.subhead) : undefined,
      cta: body.cta ? String(body.cta) : undefined,
    }),
    ...autofillImage(template.fields, assetId),
  };
  const created = await autofillDesign(tokens, template.id, data);
  let design = created.design;
  try { design = await getDesign(tokens, created.designId); }
  catch (error) {
    console.warn(`[canva-brandboard] design metadata unavailable: ${String(error).slice(0, 180)}`);
  }
  const meta = designMeta(design);
  const thumbnailUrl = await stableThumbnail(brand, created.designId, meta.thumbnailUrl);
  const url = kind === "image" ? await exportStatic(tokens, brand, created.designId) : null;
  const state = kind === "image" ? "exported_static" : "editable_reel";
  const publishable = kind === "image";
  const previous = object(draft.generation_meta);

  const { data: updated, error: updateError } = await getAdminClient().from("agent_social_posts").update({
    canva_design_id: created.designId,
    canva_template_thumbnail_url: thumbnailUrl,
    media_urls: kind === "image" ? [url] : [],
    status: "draft",
    scheduled_date: null,
    posted_date: null,
    generation_meta: {
      ...previous,
      approval_boundary: "brandboard",
      canva: {
        engine: "canva",
        state,
        publishable,
        template_id: template.id,
        design_id: created.designId,
        edit_url: meta.editUrl,
        view_url: meta.viewUrl,
        thumbnail_url: thumbnailUrl,
        export_url: url,
        requires_real_mp4_export: kind === "reel",
        requires_brandboard_approval: true,
        // WHAT PICTURE IS ON IT. A creative built on a real library asset and
        // one that silently fell back to the template placeholder look the
        // same on the card, so the row says which happened.
        hero_asset_id: assetId,
        hero_image_url: assetId ? imageUrl : null,
        image_note: imageNote,
        attached_at: new Date().toISOString(),
      },
    },
  }).eq("id", postId).eq("brand", brand).eq("status", "draft").select("id").maybeSingle();
  if (updateError) throw new Error(`brandboard_draft_update: ${updateError.message}`);
  if (!updated?.id) throw new Error("brandboard_draft_changed_during_canva_operation");
  await queueBrandBoardReview(postId, brand);

  return {
    ok: true,
    action: "design",
    post_id: postId,
    brand,
    canonical_brand: brand,
    template_id: template.id,
    design_id: created.designId,
    edit_url: meta.editUrl,
    view_url: meta.viewUrl,
    thumbnail_url: thumbnailUrl,
    url,
    state,
    publishable,
  };
}

async function linkAction(req: Request, body: JsonRecord) {
  const brand = canonicalBrand(body.brand);
  if (!brand) throw new Error("unsupported_canva_brand");
  const postId = safeId(body.post_id, "post_id");
  const designId = safeId(body.design_id, "canva_design_id");
  const draft = await loadDraft(postId, brand);
  if (draft.canva_design_id !== designId) throw new Error("brandboard_design_mismatch");
  const tokens = await callerTokens(req);
  const meta = designMeta(await getDesign(tokens, designId));
  const thumbnailUrl = await stableThumbnail(brand, designId, meta.thumbnailUrl);
  const previous = object(draft.generation_meta);
  const previousCanva = object(previous.canva);
  const state = String(previousCanva.state || "editable_design");
  const publishable = state === "exported_static" && (draft.media_urls || []).length > 0;
  const { data: updated, error } = await getAdminClient().from("agent_social_posts").update({
    canva_template_thumbnail_url: thumbnailUrl,
    status: "draft",
    scheduled_date: null,
    posted_date: null,
    generation_meta: {
      ...previous,
      canva: {
        ...previousCanva,
        edit_url: meta.editUrl,
        view_url: meta.viewUrl,
        thumbnail_url: thumbnailUrl,
        links_refreshed_at: new Date().toISOString(),
      },
    },
  }).eq("id", postId).eq("brand", brand).eq("status", "draft").select("id").maybeSingle();
  if (error) throw new Error(`brandboard_link_update: ${error.message}`);
  if (!updated?.id) throw new Error("brandboard_draft_changed_during_link_refresh");
  return {
    ok: true,
    action: "link",
    post_id: postId,
    brand,
    canonical_brand: brand,
    template_id: previousCanva.template_id || null,
    design_id: designId,
    edit_url: meta.editUrl,
    view_url: meta.viewUrl,
    thumbnail_url: thumbnailUrl,
    url: publishable ? String((draft.media_urls || [])[0] || "") || null : null,
    state,
    publishable,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({})) as JsonRecord;
    const action = String(body.action || "design").trim().toLowerCase();
    if (action === "design") return json(await designAction(req, body));
    if (action === "link") return json(await linkAction(req, body));
    if (action === "config") return json(await configAction(req));
    if (action === "templates") return json({ ok: true, action, templates: await listTemplates(await callerTokens(req)) });
    if (action === "map") return json(await mapAction(req, body));
    return json({ ok: false, error: "unsupported_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "authentication_required" ? 401
      : message === "canva_not_connected" ? 409
      : /not_found/.test(message) ? 404
      : /forbidden/.test(message) ? 403
      : /invalid|required|mismatch|unsupported|draft/.test(message) ? 400
      : 502;
    return json({ ok: false, error: message.slice(0, 300) }, status);
  }
});
